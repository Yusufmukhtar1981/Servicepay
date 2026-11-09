import 'dart:async';
import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:servicepay_app/services/keke_session_api.dart';
import 'package:servicepay_app/services/pin_session_client.dart';
import 'package:servicepay_app/services/session_store.dart';

String token(String id, String kind) =>
    'test.${base64Url.encode(utf8.encode(jsonEncode({'id': id, 'kind': kind})))}.signature';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  final fare = Uri.parse('https://api.example.invalid/api/keke-fare/estimate');
  final rides = Uri.parse('https://api.example.invalid/api/keke-rides');
  late String old;
  late String renewed;
  setUp(() async {
    SharedPreferences.setMockInitialValues({});
    await SessionStore.clear();
    old = token('customer-a', 'old');
    renewed = token('customer-a', 'new');
    await SessionStore.writeSession(old,
        refreshToken: token('customer-a', 'refresh'));
  });
  tearDown(() => SessionStore.clear());

  test('fare uses secure session after legacy keys have been removed', () async {
    final client = MockClient((request) async {
      expect(request.headers['Authorization'], 'Bearer $old');
      expect(request.url, fare);
      expect(jsonDecode(request.body)['distanceKm'], 3.5);
      return http.Response('{"fare":{"totalFare":700}}', 200);
    });
    await http.runWithClient(() async {
      final response = await KekeSessionApi.post(fare,
          headers: {'Content-Type': 'application/json',
            'Authorization': 'Bearer obsolete'},
          body: jsonEncode({'distanceKm': 3.5, 'waitingMinutes': 0}));
      expect(jsonDecode(response.body)['fare']['totalFare'], 700);
    }, () => client);
    expect((await SharedPreferences.getInstance()).getString('auth_token'), isNull);
  });

  test('expired fare, active ride and booking share a single refresh', () async {
    var refreshes = 0;
    final calls = <String, int>{};
    final gate = Completer<void>();
    final client = MockClient((request) async {
      if (request.url.path.endsWith('/auth/refresh')) {
        refreshes++;
        await gate.future;
        return http.Response(jsonEncode({
          'success': true, 'token': renewed,
          'refreshToken': token('customer-a', 'new-refresh'),
        }), 200);
      }
      calls.update(request.url.path, (n) => n + 1, ifAbsent: () => 1);
      if (request.headers['Authorization'] == 'Bearer $old') {
        return http.Response('{"message":"Invalid or expired token."}', 401);
      }
      expect(request.headers['Authorization'], 'Bearer $renewed');
      return http.Response('{"ride":{"id":"test-ride"}}', 200);
    });
    await http.runWithClient(() async {
      final requests = [
        KekeSessionApi.post(fare, body: '{}'),
        KekeSessionApi.get(rides.resolve('keke-rides/active')),
        KekeSessionApi.post(rides, body: '{"paymentMethod":"WALLET"}'),
      ];
      await Future<void>.delayed(const Duration(milliseconds: 15));
      gate.complete();
      expect((await Future.wait(requests)).every((r) => r.statusCode == 200), isTrue);
    }, () => client);
    expect(refreshes, 1);
    expect(calls.values, everyElement(2));
    expect(await SessionStore.readToken(), renewed);
    expect(await SessionStore.readRefreshToken(),
        token('customer-a', 'new-refresh'));
  });

  test('invalid refresh never loops or clears a still stored session', () async {
    var calls = 0;
    await http.runWithClient(() async {
      await expectLater(KekeSessionApi.get(rides),
          throwsA(isA<PinSessionInvalid>()));
    }, () => MockClient((_) async {
      calls++;
      return http.Response('{}', 401);
    }));
    expect(calls, 2);
    expect(await SessionStore.readToken(), old);
  });

  test('a repeated 401 is retried only once', () async {
    var business = 0;
    await http.runWithClient(() async {
      await expectLater(KekeSessionApi.get(rides),
          throwsA(isA<PinSessionInvalid>()));
    }, () => MockClient((request) async {
      if (request.url.path.endsWith('/refresh')) {
        return http.Response(jsonEncode({'success': true,
          'token': renewed, 'refreshToken': token('customer-a', 'r2')}), 200);
      }
      business++;
      return http.Response('{}', 401);
    }));
    expect(business, 2);
  });

  for (final status in [400, 403, 409, 429, 500]) {
    test('HTTP $status is returned unchanged without refresh or replay', () async {
      var calls = 0;
      await http.runWithClient(() async {
        expect((await KekeSessionApi.post(rides, body: '{}')).statusCode, status);
      }, () => MockClient((_) async {
        calls++;
        return http.Response('{"message":"Actual provider-independent reason"}', status);
      }));
      expect(calls, 1);
    });
  }

  for (final error in <Exception>[
    TimeoutException('test'), http.ClientException('offline'),
  ]) {
    test('${error.runtimeType} never replays an uncertain booking', () async {
      var calls = 0;
      await http.runWithClient(() async {
        await expectLater(KekeSessionApi.post(rides, body: '{}'), throwsA(same(error)));
      }, () => MockClient((_) async { calls++; throw error; }));
      expect(calls, 1);
      expect(KekeSessionApi.errorMessage(error), isNot(contains('sign in')));
    });
  }

  test('refresh outage is not a logout or a fare-calculation error', () async {
    await http.runWithClient(() async {
      await expectLater(KekeSessionApi.post(fare, body: '{}'), throwsStateError);
    }, () => MockClient((request) async => http.Response('{}',
        request.url.path.endsWith('/refresh') ? 503 : 401)));
    expect(await SessionStore.readToken(), old);
    expect(KekeSessionApi.errorMessage(StateError('test')), contains('renewal'));
    expect(KekeSessionApi.errorMessage(PinSessionInvalid()), contains('sign in'));
  });

  test('account switch cannot replay a booking under another customer', () async {
    var bookingCalls = 0;
    await http.runWithClient(() async {
      await expectLater(KekeSessionApi.post(rides, body: '{}'),
          throwsA(isA<PinSessionInvalid>()));
    }, () => MockClient((_) async {
      bookingCalls++;
      await SessionStore.writeSession(token('customer-b', 'access'),
          refreshToken: token('customer-b', 'refresh'));
      return http.Response('{}', 401);
    }));
    expect(bookingCalls, 1);
  });

  test('unresolved booking survives restart and cannot reserve twice', () async {
    expect(await KekeBookingGuard.isUnresolved(), false);
    final key = await KekeBookingGuard.reserve();
    expect(await KekeBookingGuard.isUnresolved(), true);
    await expectLater(KekeBookingGuard.reserve(), throwsStateError);
    final stored = Map<String, Object>.from({
      key: (await SharedPreferences.getInstance()).getString(key)!,
    });
    SharedPreferences.setMockInitialValues(stored);
    expect(await KekeBookingGuard.isUnresolved(), true);
    await KekeBookingGuard.resolved(key);
    expect(await KekeBookingGuard.isUnresolved(), false);
  });

  test('booking safety state is account-scoped and contains no credentials', () async {
    final key = await KekeBookingGuard.reserve();
    final value = (await SharedPreferences.getInstance()).getString(key)!;
    expect(value, isNot(contains(old)));
    await SessionStore.writeSession(token('customer-b', 'access'));
    expect(await KekeBookingGuard.isUnresolved(), false);
    await SessionStore.writeSession(old);
    expect(await KekeBookingGuard.isUnresolved(), true);
  });
}

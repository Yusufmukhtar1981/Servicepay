import 'dart:async';
import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:servicepay_app/services/session_store.dart';
import 'package:servicepay_app/services/pin_session_client.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  final endpoint = Uri.parse('https://api.example.invalid/api/transaction-pin/create');
  setUp(() async {
    SharedPreferences.setMockInitialValues({});
    await SessionStore.clear();
    await SessionStore.writeSession('old-access', refreshToken: 'old-refresh');
  });
  tearDown(() => SessionStore.clear());
  test('PIN request retries once after rotating the secure refresh credential', () async {
    var pins = 0, refreshes = 0;
    final client = MockClient((request) async {
      if (request.url.path.endsWith('/refresh')) {
        refreshes++;
        expect(jsonDecode(request.body)['refreshToken'], 'old-refresh');
        return http.Response('{"success":true,"token":"new-access","refreshToken":"new-refresh"}', 200);
      }
      pins++;
      return http.Response('{"success":true}', pins == 1 ? 401 : 201);
    });
    expect((await PinSessionClient.post(client, endpoint, {'pin': '2580'})).statusCode, 201);
    expect(pins, 2); expect(refreshes, 1);
    expect(await SessionStore.readRefreshToken(), 'new-refresh');
    expect((await SharedPreferences.getInstance()).getString('auth_token'), isNull);
  });
  test('concurrent PIN requests share one refresh request', () async {
    var refreshes = 0;
    final gate = Completer<void>();
    final client = MockClient((request) async {
      if (request.url.path.endsWith('/refresh')) {
        refreshes++; await gate.future;
        return http.Response('{"success":true,"token":"new-access","refreshToken":"new-refresh"}', 200);
      }
      return http.Response('{}', request.headers['Authorization'] == 'Bearer old-access' ? 401 : 201);
    });
    final a = PinSessionClient.post(client, endpoint, {});
    final b = PinSessionClient.post(client, endpoint, {});
    await Future<void>.delayed(const Duration(milliseconds: 10));
    gate.complete();
    await Future.wait([a,b]);
    expect(refreshes, 1);
  });
  test('invalid refresh and repeated unauthorized PIN response never loop', () async {
    var calls = 0;
    final client = MockClient((request) async {
      calls++;
      return http.Response('{}', 401);
    });
    await expectLater(PinSessionClient.post(client, endpoint, {}), throwsA(isA<PinSessionInvalid>()));
    expect(calls, 2);
  });
  test('a newer login prevents a stale refresh from overwriting its session', () async {
    await SessionStore.writeSession('another-login', refreshToken: 'another-refresh');
    expect(await SessionStore.writeSession('stale-refresh',
        refreshToken: 'stale', expectedAccessToken: 'old-access'), false);
    expect(await SessionStore.readToken(), 'another-login');
    expect(await SessionStore.readRefreshToken(), 'another-refresh');
  });
}

import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:servicepay_app/services/api_service.dart';
import 'package:shared_preferences/shared_preferences.dart';

const _delay = Duration(milliseconds: 60);
const _networksUri =
    'https://api.servicepay.ng/api/clubkonnect/airtime/networks';

http.Response _json(Map<String, dynamic> body, {int status = 200}) =>
    http.Response(jsonEncode(body), status,
        headers: {'content-type': 'application/json'});

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() async {
    SharedPreferences.setMockInitialValues({'auth_token': 'session-a'});
  });

  test('benchmark: overlapping identical GETs coalesce only while in flight',
      () async {
    var requests = 0;
    final client = MockClient((request) async {
      requests++;
      await Future<void>.delayed(_delay);
      return _json({
        'success': true,
        'networks': [
          {'name': 'MTN'}
        ],
      });
    });

    await http.runWithClient(() async {
      final uri = Uri.parse(_networksUri);
      final baselineTimer = Stopwatch()..start();
      await Future.wait([
        http.get(uri, headers: {'Authorization': 'Bearer session-a'}),
        http.get(uri, headers: {'Authorization': 'Bearer session-a'}),
      ]);
      baselineTimer.stop();
      final baselineCalls = requests;

      requests = 0;
      final optimizedTimer = Stopwatch()..start();
      final results = await Future.wait([
        ApiService.getAirtimeNetworks(),
        ApiService.getAirtimeNetworks(),
      ]);
      optimizedTimer.stop();
      final optimizedCalls = requests;

      expect(baselineCalls, 2);
      expect(optimizedCalls, 1);
      expect(results, hasLength(2));
      // Mutation from one waiter must not be observable by another.
      (results.first['networks'] as List).clear();
      expect((results.last['networks'] as List), hasLength(1));
      expect(results.first, isNot(same(results.last)));

      debugPrint(
        'controlled 60ms fake-server benchmark: '
        'before=$baselineCalls calls/${baselineTimer.elapsedMilliseconds}ms; '
        'after=$optimizedCalls calls/${optimizedTimer.elapsedMilliseconds}ms',
      );

      // Completed responses are never reused as a cache.
      await ApiService.getAirtimeNetworks();
      expect(requests, 2);
    }, () => client);
  });

  test('does not coalesce across session tokens', () async {
    final observedTokens = <String>[];
    final firstStarted = Completer<void>();
    final client = MockClient((request) async {
      observedTokens.add(request.headers['Authorization']!);
      if (!firstStarted.isCompleted) firstStarted.complete();
      await Future<void>.delayed(_delay);
      return _json({'success': true});
    });

    await http.runWithClient(() async {
      final first = ApiService.getAirtimeNetworks();
      await firstStarted.future;
      await (await SharedPreferences.getInstance())
          .setString('auth_token', 'session-b');
      final second = ApiService.getAirtimeNetworks();
      await Future.wait([first, second]);
      expect(observedTokens.toSet(), {
        'Bearer session-a',
        'Bearer session-b',
      });
      expect(observedTokens, hasLength(2));
    }, () => client);
  });

  test('different catalog endpoints remain separate requests', () async {
    var requests = 0;
    final paths = <String>[];
    final client = MockClient((request) async {
      requests++;
      paths.add(request.url.path);
      await Future<void>.delayed(_delay);
      return _json({'success': true, 'plans': []});
    });

    await http.runWithClient(() async {
      await Future.wait([
        ApiService.getAirtimeNetworks(),
        ApiService.getDataPlans(network: 'MTN'),
      ]);
      expect(requests, 2);
      expect(paths.toSet(), {
        '/api/clubkonnect/airtime/networks',
        '/api/clubkonnect/data-plans/MTN',
      });
    }, () => client);
  });

  test('a failed in-flight request is removed before the next attempt',
      () async {
    var requests = 0;
    final client = MockClient((_) async {
      requests++;
      await Future<void>.delayed(_delay);
      if (requests == 1) throw StateError('controlled fake server failure');
      return _json({'success': true, 'networks': []});
    });

    await http.runWithClient(() async {
      await expectLater(ApiService.getAirtimeNetworks(), throwsStateError);
      final fresh = await ApiService.getAirtimeNetworks();
      expect(fresh['success'], true);
      expect(requests, 2);
    }, () => client);
  });
}

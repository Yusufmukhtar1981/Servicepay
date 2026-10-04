import 'dart:async';
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../lib/branch_manager/branch_counter_api.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  test('renewed sessions retain the same account retry storage', () async {
    SharedPreferences.setMockInitialValues({});
    String token = 'header.${base64Url.encode(utf8.encode(jsonEncode({
          'id': 'same-staff-account',
          'iat': 1
        })))}.signature';
    final store = CounterPendingIntentStore(tokenReader: () async => token);
    final original = await store.keyForAccount();
    expect(await store.write({'idempotencyKey': 'original-key'}), isTrue);
    token = 'header.${base64Url.encode(utf8.encode(jsonEncode({
          'id': 'same-staff-account',
          'iat': 2
        })))}.signature';
    expect(await store.keyForAccount(), original);
    expect((await store.read())?['idempotencyKey'], 'original-key');
  });

  test('counter reads stop waiting when the server never responds', () async {
    final api = BranchCounterHttpApi(
      client: MockClient((_) => Completer<http.Response>().future),
      tokenReader: () async => 'fixture-token',
      requestTimeout: const Duration(milliseconds: 5),
    );
    await expectLater(api.loadConfig(), throwsA(isA<TimeoutException>()));
  });

  test('timed-out creation retains the caller supplied retry key', () async {
    final keys = <String?>[];
    final api = BranchCounterHttpApi(
      client: MockClient((request) {
        keys.add(request.headers['Idempotency-Key']);
        return Completer<http.Response>().future;
      }),
      tokenReader: () async => 'fixture-token',
      requestTimeout: const Duration(milliseconds: 5),
    );
    for (var attempt = 0; attempt < 2; attempt++) {
      await expectLater(
        api.createOrder({'kind': 'DELIVERY'},
            quoteToken: 'fixture-quote', idempotencyKey: 'same-durable-key'),
        throwsA(isA<TimeoutException>()),
      );
    }
    expect(keys, ['same-durable-key', 'same-durable-key']);
  });
}

import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:servicepay_app/phone_financing/phone_financing_api.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() {
    SharedPreferences.setMockInitialValues({'auth_token': 'token-123'});
  });

  test('uses hardened application route and full typed body', () async {
    late http.Request captured;
    final api = PhoneFinancingApi(client: MockClient((request) async {
      captured = request;
      return http.Response('{"success":true,"application":{}}', 201);
    }));
    await api.submit({
      'productId': 'phone/1',
      'occupation': 'Tailor',
      'monthlyIncome': 185000.0,
      'residentialAddress': '12 Marina Road',
      'state': 'Lagos',
      'lga': 'Eti-Osa',
      'employer': 'Maju Studio',
      'preferredDurationWeeks': 24,
      'consentAccepted': true,
      'consent': true,
    });
    expect(captured.url.path, '/api/phone-financing/applications');
    final body = jsonDecode(captured.body) as Map<String, dynamic>;
    expect(body['monthlyIncome'], 185000.0);
    expect(body['preferredDurationWeeks'], 24);
    expect(body['consentAccepted'], isTrue);
  });

  test('uses exact payment routes, PIN, and persisted idempotency key', () async {
    final requests = <http.Request>[];
    final api = PhoneFinancingApi(client: MockClient((request) async {
      requests.add(request);
      return http.Response('{"success":true}', 201);
    }));
    final key = await api.pendingKey('installment_finance-1');
    await api.pay('finance-1', 8765.5, '1234', key);
    expect(requests.single.url.path, '/api/phone-financing/finance/finance-1/pay');
    expect(requests.single.headers['idempotency-key'], key);
    expect(jsonDecode(requests.single.body), {'amount': 8765.5, 'transactionPin': '1234'});
    expect(await api.pendingKey('installment_finance-1'), key);
    await api.completeKey('installment_finance-1');
    expect(await api.pendingKey('installment_finance-1'), isNot(key));
  });

  test('preserves idempotency key after an unsuccessful payment', () async {
    final api = PhoneFinancingApi(client: MockClient((_) async => http.Response('{"message":"Incorrect transaction PIN."}', 401)));
    final key = await api.pendingKey('deposit-app-1');
    await expectLater(api.deposit('app-1', 40000, '0000', key), throwsA(isA<PhoneFinancingException>()));
    expect(await api.pendingKey('deposit-app-1'), key);
  });

  test('uses the server payment-history endpoint', () async {
    late http.Request captured;
    final api = PhoneFinancingApi(client: MockClient((request) async {
      captured = request;
      return http.Response('{"success":true,"payments":[]}', 200);
    }));
    final response = await api.payments('finance 1');
    expect(captured.url.toString(), contains('/api/phone-financing/finance/finance%201/payments'));
    expect(response['payments'], isEmpty);
  });
}
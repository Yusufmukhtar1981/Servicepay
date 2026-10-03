import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:servicepay_app/services/api_service.dart';
import 'package:servicepay_app/services/session_store.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUp(() async {
    SharedPreferences.setMockInitialValues({});
    await SessionStore.writeToken('fixture-session');
  });
  for (final network in ['MTN', 'AIRTEL', 'GLO', '9MOBILE']) {
    test('$network DATA serializes the same key in body and both headers',
        () async {
      const key = 'data-0123456789abcdefghijklmnopqrstuv';
      var calls = 0;
      await http.runWithClient(() async {
        final result = await ApiService.buyData(
          network: network,
          phone: '08012345678',
          planCode: 'fixture-plan',
          amount: 100,
          transactionPin: '0000',
          idempotencyKey: key,
        );
        expect(result['status'], 'PENDING');
      },
          () => MockClient((request) async {
                calls++;
                expect(request.url.toString(),
                    'https://api.servicepay.ng/api/clubkonnect/data');
                expect(request.headers['Idempotency-Key'], key);
                expect(request.headers['X-Idempotency-Key'], key);
                final body = jsonDecode(request.body);
                expect(body['idempotencyKey'], key);
                expect(body['transactionPin'], '0000');
                expect(body['network'], network);
                return http.Response(
                    '{"success":true,"status":"PENDING","reference":"DATA-fixture"}',
                    200);
              }));
      expect(calls, 1);
    });
  }
  test('internal key errors are never displayed verbatim', () async {
    await http.runWithClient(() async {
      final result = await ApiService.buyData(
          network: 'MTN',
          phone: '08012345678',
          planCode: 'fixture-plan',
          amount: 100,
          transactionPin: '0000',
          idempotencyKey: 'fixture-request');
      expect(result['message'],
          'Unable to complete your data purchase. Please try again.');
    },
        () => MockClient((_) async => http.Response(
            '{"success":false,"message":"A valid idempotencyKey is required for data purchases."}',
            400)));
  });
}

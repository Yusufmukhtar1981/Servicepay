import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';
import 'package:servicepay_app/edupay/edupay_api.dart';

class _Client extends http.BaseClient {
  http.Request? last;
  int status = 200;
  dynamic response = {'success': true};
  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) async {
    last = request as http.Request;
    return http.StreamedResponse(
      Stream.value(utf8.encode(jsonEncode(response))),
      status,
      headers: {'content-type': 'application/json'},
    );
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUp(() async {
    SharedPreferences.setMockInitialValues({'auth_token': 'test-token'});
  });

  test('contribution uses backend keys and idempotency header', () async {
    final client = _Client();
    final api = EduPayApi(client: client);
    await api.contribute('plan-1', 12500, '4821', idempotencyKey: 'same-key');
    expect(client.last?.url.path, '/api/edupay/plans/plan-1/contributions');
    expect(client.last?.headers['authorization'], 'Bearer test-token');
    expect(client.last?.headers['idempotency-key'], 'same-key');
    expect(jsonDecode(client.last!.body), {
      'amount': 12500.0,
      'transactionPin': '4821',
    });
  });

  test('authenticated sponsor contribution uses token route and PIN', () async {
    final client = _Client();
    final api = EduPayApi(client: client);
    await api.sponsorContribute('invite-token', 5000, '1234',
        idempotencyKey: 'sponsor-key');
    expect(
        client.last?.url.path, '/api/edupay/sponsor/invite-token/contribute');
    expect(client.last?.headers['idempotency-key'], 'sponsor-key');
    expect(jsonDecode(client.last!.body)['transactionPin'], '1234');
  });

  test('disabled response preserves authoritative backend code', () async {
    final client = _Client()
      ..status = 403
      ..response = {
        'success': false,
        'code': 'EDUPAY_DISABLED',
        'message': 'temporarily unavailable',
      };
    expect(
      () => EduPayApi(client: client).createPlan({}),
      throwsA(isA<EduPayException>()
          .having((e) => e.code, 'code', 'EDUPAY_DISABLED')),
    );
  });

  test('history reads contributions, repayments, and ledger from customer API',
      () async {
    final client = _Client()
      ..response = {
        'success': true,
        'contributions': [
          {'id': 'contribution-1'}
        ],
        'repayments': [
          {'id': 'repayment-1'}
        ],
        'ledger': [],
      };
    final history = await EduPayApi(client: client).history();
    expect(client.last?.url.path, '/api/edupay/history');
    expect(history['contributions'], isNotEmpty);
    expect(history['repayments'], isNotEmpty);
  });

  test('catalogue uses the authoritative customer catalogue endpoint',
      () async {
    final client = _Client()
      ..response = {
        'success': true,
        'schools': [],
        'sessions': [],
        'terms': [],
        'classes': [],
      };
    final catalogue = await EduPayApi(client: client).catalogue('school-1');
    expect(client.last?.url.path, '/api/edupay/schools/school-1/catalogue');
    expect(catalogue['classes'], isEmpty);
  });
}

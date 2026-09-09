import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:servicepay_app/admin/admin_phone_financing_api.dart';
import 'package:shared_preferences/shared_preferences.dart';

class _RecordingClient extends http.BaseClient {
  http.Request? request;
  @override
  Future<http.StreamedResponse> send(http.BaseRequest value) async {
    request = value as http.Request;
    return http.StreamedResponse(
      Stream<List<int>>.value(
          utf8.encode('{"success":true,"metrics":{"overdue":2}}')),
      200,
      headers: const {'content-type': 'application/json'},
    );
  }
}

void main() {
  setUp(() =>
      SharedPreferences.setMockInitialValues({'auth_token': 'admin-token'}));

  test('dashboard uses the phone-financing admin route and bearer token',
      () async {
    final client = _RecordingClient();
    final api = AdminPhoneFinancingApi(client: client);
    final result = await api.dashboard();

    expect(result['metrics']['overdue'], 2);
    expect(client.request!.url.path, '/api/phone-financing/admin/dashboard');
    expect(client.request!.headers['authorization'], 'Bearer admin-token');
  });

  test('provider request records disabled enforcement payload', () async {
    final client = _RecordingClient();
    final api = AdminPhoneFinancingApi(client: client);
    await api.providerRequest('finance-7', 'RESTRICT',
        idempotencyKey: 'request-1');

    expect(client.request!.method, 'POST');
    expect(client.request!.url.path,
        '/api/phone-financing/admin/finance/finance-7/provider-request');
    expect(jsonDecode(client.request!.body), {
      'action': 'RESTRICT',
      'provider': 'NONE',
      'idempotencyKey': 'request-1',
    });
  });

  test('activation uses the dedicated server-state endpoint', () async {
    final client = _RecordingClient();
    final api = AdminPhoneFinancingApi(client: client);
    await api.setProductActive('product-3', false);

    expect(client.request!.method, 'PATCH');
    expect(client.request!.url.path,
        '/api/phone-financing/admin/products/product-3/deactivate');
    expect(jsonDecode(client.request!.body), <String, dynamic>{});
  });

  test('refund uses recovery route with idempotency evidence', () async {
    final client = _RecordingClient();
    final api = AdminPhoneFinancingApi(client: client);
    await api.refundDeposit('application-9',
        reason: 'Reservation expired', idempotencyKey: 'refund-key');

    expect(client.request!.method, 'POST');
    expect(client.request!.url.path,
        '/api/phone-financing/admin/applications/application-9/refund-deposit');
    expect(client.request!.headers['idempotency-key'], 'refund-key');
    expect(jsonDecode(client.request!.body)['reason'], 'Reservation expired');
  });
}

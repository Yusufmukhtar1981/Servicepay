import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:servicepay_app/logistics/logistics_api.dart';

void main() {
  test('lists only server-provided branch queue records', () async {
    late http.Request captured;
    final LogisticsApi api = LogisticsApi(
      tokenLoader: () async => 'token',
      baseUrl: 'https://api.servicepay.ng/api',
      client: MockClient((http.Request request) async {
        captured = request;
        return http.Response(
          '{"shipments":[{"_id":"s-1","trackingNumber":"SPX-1"}]}',
          200,
        );
      }),
    );

    final List<Map<String, dynamic>> rows = await api.list(
      'branch',
      'shipments',
      query: const <String, String>{'status': 'AWAITING_PICKUP'},
    );

    expect(captured.url.path, '/api/branch/logistics/interstate/shipments');
    expect(captured.url.queryParameters['status'], 'AWAITING_PICKUP');
    expect(captured.headers['authorization'], 'Bearer token');
    expect(rows.single['trackingNumber'], 'SPX-1');
  });

  test('surfaces API permission failure messages', () async {
    late http.Request captured;
    final LogisticsApi api = LogisticsApi(
      tokenLoader: () async => 'token',
      client: MockClient((http.Request request) async {
        captured = request;
        return http.Response(
          '{"message":"Not assigned to this shipment"}',
          403,
        );
      }),
    );

    await expectLater(
      api.request(
          'POST', '/rider/logistics/interstate/shipments/a/verify-delivery',
          body: const <String, dynamic>{'otp': '123456'}),
      throwsA(isA<LogisticsApiException>().having(
        (LogisticsApiException error) => error.message,
        'message',
        'Not assigned to this shipment',
      )),
    );
    expect(
      captured.url.path,
      '/api/rider/logistics/interstate/shipments/a/verify-delivery',
    );
    expect(captured.method, 'POST');
  });

  test('uses the canonical admin interstate overview path', () async {
    late http.Request captured;
    final LogisticsApi api = LogisticsApi(
      tokenLoader: () async => 'token',
      baseUrl: 'https://api.servicepay.ng/api',
      client: MockClient((http.Request request) async {
        captured = request;
        return http.Response('{"overview":{"totalShipments":4}}', 200);
      }),
    );

    final Map<String, dynamic> response = await api.request(
      'GET',
      '/admin/logistics/interstate/overview',
    );

    expect(captured.url.path, '/api/admin/logistics/interstate/overview');
    expect(response['overview']['totalShipments'], 4);
  });

  test('uses the canonical rider OTP dispatch path', () async {
    late http.Request captured;
    final LogisticsApi api = LogisticsApi(
      tokenLoader: () async => 'token',
      baseUrl: 'https://api.servicepay.ng/api',
      client: MockClient((http.Request request) async {
        captured = request;
        return http.Response('{"success":true}', 200);
      }),
    );

    await api.request(
      'POST',
      '/rider/logistics/interstate/shipments/shipment-1/delivery-otp',
    );

    expect(
      captured.url.path,
      '/api/rider/logistics/interstate/shipments/shipment-1/delivery-otp',
    );
    expect(captured.method, 'POST');
  });

  test('sends an allowed trip transition to the canonical admin endpoint',
      () async {
    late http.Request captured;
    final LogisticsApi api = LogisticsApi(
      tokenLoader: () async => 'token',
      baseUrl: 'https://api.servicepay.ng/api',
      client: MockClient((http.Request request) async {
        captured = request;
        return http.Response('{"trip":{"status":"DEPARTED"}}', 200);
      }),
    );

    await api.request(
      'PATCH',
      '/admin/logistics/interstate/trips/trip-1/status',
      body: const <String, dynamic>{'status': 'DEPARTED'},
    );

    expect(
      captured.url.path,
      '/api/admin/logistics/interstate/trips/trip-1/status',
    );
    expect(captured.method, 'PATCH');
    expect(captured.body, '{"status":"DEPARTED"}');
  });

  test('sends verified actual weight through the branch status endpoint',
      () async {
    late http.Request captured;
    final LogisticsApi api = LogisticsApi(
      tokenLoader: () async => 'token',
      baseUrl: 'https://api.servicepay.ng/api',
      client: MockClient((http.Request request) async {
        captured = request;
        return http.Response(
            '{"shipment":{"status":"VERIFIED_AT_ORIGIN_HUB"}}', 200);
      }),
    );

    await api.request(
      'PATCH',
      '/branch/logistics/interstate/shipments/shipment-1/status',
      body: const <String, dynamic>{
        'status': 'VERIFIED_AT_ORIGIN_HUB',
        'verifiedWeightKg': 2.5,
      },
    );

    expect(
      captured.url.path,
      '/api/branch/logistics/interstate/shipments/shipment-1/status',
    );
    expect(captured.method, 'PATCH');
    expect(
      captured.body,
      '{"status":"VERIFIED_AT_ORIGIN_HUB","verifiedWeightKg":2.5}',
    );
  });

  test('retains persisted additional-payment state from a 409 response',
      () async {
    final LogisticsApi api = LogisticsApi(
      tokenLoader: () async => 'token',
      client: MockClient((_) async => http.Response(
          '{"code":"ADDITIONAL_PAYMENT_REQUIRED","message":"Payment is due","shipment":{"status":"ADDITIONAL_PAYMENT_REQUIRED"}}',
          409)),
    );

    await expectLater(
      api.request('PATCH', '/branch/logistics/interstate/shipments/s/status',
          body: const <String, dynamic>{'status': 'VERIFIED_AT_ORIGIN_HUB'}),
      throwsA(isA<LogisticsApiException>()
          .having((LogisticsApiException e) => e.code, 'code',
              'ADDITIONAL_PAYMENT_REQUIRED')
          .having((LogisticsApiException e) => e.data?['status'], 'status',
              'ADDITIONAL_PAYMENT_REQUIRED')),
    );
  });

  test('sends audited fallback confirmation to its canonical branch endpoint',
      () async {
    late http.Request captured;
    final LogisticsApi api = LogisticsApi(
      tokenLoader: () async => 'branch-token',
      baseUrl: 'https://api.servicepay.ng/api',
      client: MockClient((http.Request request) async {
        captured = request;
        return http.Response('{"shipment":{"status":"DELIVERED"}}', 200);
      }),
    );

    await api.request(
      'PATCH',
      '/branch/logistics/interstate/shipments/shipment-1/confirm-delivery-fallback',
      body: const <String, dynamic>{
        'reason': 'Receiver identity was confirmed by branch supervisor.',
        'evidenceUrls': <String>['https://evidence.servicepay.ng/proof.jpg'],
      },
    );

    expect(
      captured.url.path,
      '/api/branch/logistics/interstate/shipments/shipment-1/confirm-delivery-fallback',
    );
    expect(captured.method, 'PATCH');
    expect(captured.headers['authorization'], 'Bearer branch-token');
    expect(
      captured.body,
      '{"reason":"Receiver identity was confirmed by branch supervisor.","evidenceUrls":["https://evidence.servicepay.ng/proof.jpg"]}',
    );
  });
}

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:servicepay_app/services/business_partner_api_service.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() {
    SharedPreferences.setMockInitialValues(<String, Object>{
      'auth_token': 'partner-token',
    });
  });

  test('uses the scoped business partner endpoint and bearer session',
      () async {
    late http.Request request;
    final BusinessPartnerApiService api = BusinessPartnerApiService(
      client: MockClient((http.Request value) async {
        request = value;
        return http.Response(
            '{"success":true,"applications":{"solar":[]}}', 200);
      }),
    );

    await api.applications();

    expect(request.url.path, '/api/business-partner/applications');
    expect(request.headers['authorization'], 'Bearer partner-token');
  });

  test('surfaces a server error instead of returning an empty response',
      () async {
    final BusinessPartnerApiService api = BusinessPartnerApiService(
      client: MockClient((http.Request _) async =>
          http.Response('{"success":false,"message":"Access denied"}', 403)),
    );

    await expectLater(
        api.dashboard(), throwsA(isA<BusinessPartnerApiException>()));
  });

  test('sends only scoped assignment and verification-review payloads',
      () async {
    final List<http.Request> requests = <http.Request>[];
    final BusinessPartnerApiService api = BusinessPartnerApiService(
      client: MockClient((http.Request request) async {
        requests.add(request);
        return http.Response('{"success":true}', 200);
      }),
    );

    await api.assignApplication(
        applicationId: 'app 1',
        type: 'SOLAR',
        officerId: 'officer-1',
        note: 'Route visit');
    await api.reviewVerification(
        applicationId: 'app 1',
        type: 'PHONE',
        decision: 'RETURNED',
        note: 'Missing address evidence');

    expect(requests[0].url.toString(),
        contains('/api/business-partner/applications/app%201/assign'));
    expect(requests[0].body, contains('"officerId":"officer-1"'));
    expect(
        requests[1].url.toString(),
        contains(
            '/api/business-partner/applications/app%201/verification-review'));
    expect(requests[1].body, contains('"decision":"RETURNED"'));
  });

  test('loads notifications through the scoped endpoint', () async {
    late http.Request captured;
    final BusinessPartnerApiService api = BusinessPartnerApiService(
      client: MockClient((http.Request request) async {
        captured = request;
        return http.Response('{"success":true,"notifications":[]}', 200);
      }),
    );
    await api.notifications(filters: <String, String>{'status': 'UNREAD'});
    expect(captured.url.path, '/api/business-partner/notifications');
    expect(captured.url.queryParameters['status'], 'UNREAD');
  });

  test('uses transaction id rather than display reference for detail',
      () async {
    late http.Request captured;
    final BusinessPartnerApiService api = BusinessPartnerApiService(
      client: MockClient((http.Request request) async {
        captured = request;
        return http.Response('{"success":true,"transaction":{}}', 200);
      }),
    );

    await api.getTransaction(id: '507f1f77bcf86cd799439011');

    expect(captured.url.path,
        '/api/business-partner/transactions/507f1f77bcf86cd799439011');
  });

  test('maps read-only commission wallet to ledger contract and filters',
      () async {
    late http.Request captured;
    final BusinessPartnerApiService api = BusinessPartnerApiService(
      client: MockClient((http.Request request) async {
        captured = request;
        return http.Response(
            '{"success":true,"wallet":{},"ledger":[],"pagination":{}}', 200);
      }),
    );

    await api.commissionWallet(filters: <String, String>{
      'page': '2',
      'limit': '25',
      'dateFrom': '2026-01-01',
    });

    expect(captured.url.path, '/api/business-partner/commission-wallet');
    expect(captured.url.queryParameters, <String, String>{
      'page': '2',
      'limit': '25',
      'dateFrom': '2026-01-01',
    });
  });

  test('keeps customer and transaction filter aliases server-compatible',
      () async {
    final List<http.Request> requests = <http.Request>[];
    final BusinessPartnerApiService api = BusinessPartnerApiService(
      client: MockClient((http.Request request) async {
        requests.add(request);
        return http.Response('{"success":true}', 200);
      }),
    );

    await api.customers(filters: <String, String>{
      'q': 'Ada',
      'kyc': 'true',
      'officerId': 'officer-1',
      'page': '3',
      'limit': '8',
    });
    await api.transactions(filters: <String, String>{
      'q': 'TX-1',
      'serviceType': 'AIRTIME',
      'officerId': 'officer-1',
      'page': '2',
      'limit': '10',
    });

    expect(requests[0].url.queryParameters['q'], 'Ada');
    expect(requests[0].url.queryParameters['kyc'], 'true');
    expect(requests[0].url.queryParameters['page'], '3');
    expect(requests[1].url.queryParameters['serviceType'], 'AIRTIME');
    expect(requests[1].url.queryParameters['page'], '2');
  });

  test('creates a possession-verified customer without credentials', () async {
    late http.Request captured;
    final BusinessPartnerApiService api = BusinessPartnerApiService(
      client: MockClient((http.Request request) async {
        captured = request;
        return http.Response(
            '{"success":true,"customer":{"id":"customer-1"}}', 201);
      }),
    );

    await api.createCustomer(
      fullName: 'Ada Lovelace',
      phone: '08012345678',
      email: 'ada@example.com',
      officerId: '507f1f77bcf86cd799439011',
    );

    expect(captured.url.path, '/api/business-partner/customers');
    expect(captured.body, contains('"fullName":"Ada Lovelace"'));
    expect(captured.body, contains('"officerId":"507f1f77bcf86cd799439011"'));
    expect(captured.body, isNot(contains('password')));
    expect(captured.body, isNot(contains('mustChangePassword')));
  });
}

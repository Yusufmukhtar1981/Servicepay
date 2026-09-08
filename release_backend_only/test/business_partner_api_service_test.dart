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
}

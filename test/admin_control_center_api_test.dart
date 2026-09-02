import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:servicepay_app/admin/admin_control_center_api.dart';
import 'package:shared_preferences/shared_preferences.dart';

class _Client extends http.BaseClient {
  http.Request? request;
  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) async {
    this.request = request as http.Request;
    return http.StreamedResponse(
      Stream<List<int>>.value(utf8.encode('{"items":[]}')),
      200,
      headers: const <String, String>{'content-type': 'application/json'},
    );
  }
}

void main() {
  setUp(() => SharedPreferences.setMockInitialValues(
      <String, Object>{'auth_token': 'admin-token'}));

  test('control module request is authenticated and sends bounded filters',
      () async {
    final _Client client = _Client();
    final AdminControlCenterApi api = AdminControlCenterApi(client: client);

    await api.module('audit-logs',
        search: 'account-7', filter: 'warning', page: 2);

    expect(client.request!.url.path, '/api/admin/control-center/audit-logs');
    expect(client.request!.url.queryParameters, <String, String>{
      'page': '2',
      'limit': '25',
      'search': 'account-7',
      'action': 'warning'
    });
    expect(client.request!.headers['authorization'], 'Bearer admin-token');
  });

  test('maps cards to the production endpoint contract', () {
    expect(AdminControlCenterApi.modulePaths, <String, String>{
      'audit-logs': 'audit-logs',
      'security-events': 'security-events',
      'access-logs': 'access-logs',
      'data-exports': 'exports/history',
      'backups': 'readiness',
      'privacy-controls': 'privacy-requests',
      'executive-dashboard': 'analytics/executive',
      'service-performance': 'analytics/services',
      'transaction-analytics': 'analytics/transactions',
      'customer-analytics': 'analytics/customers',
    });
  });

  test('creates a CSV export with a POST and bounded dates', () async {
    final _Client client = _Client();
    final AdminControlCenterApi api = AdminControlCenterApi(client: client);

    await api.exportDataset('AUDIT',
        from: DateTime(2024, 1, 2), to: DateTime(2024, 1, 31));

    expect(client.request!.method, 'POST');
    expect(client.request!.url.path,
        '/api/admin/control-center/exports/AUDIT.csv');
    expect(client.request!.url.queryParameters,
        <String, String>{'start': '2024-01-02', 'end': '2024-01-31'});
    expect(jsonDecode(client.request!.body), <String, dynamic>{});
  });

  test('submits the backend subjectUser privacy field', () async {
    final _Client client = _Client();
    final AdminControlCenterApi api = AdminControlCenterApi(client: client);

    await api.createPrivacyRequest(
        <String, dynamic>{'type': 'ACCESS', 'subjectUser': 'user-9'});

    expect(client.request!.method, 'POST');
    expect(
        client.request!.url.path, '/api/admin/control-center/privacy-requests');
    expect(jsonDecode(client.request!.body)['subjectUser'], 'user-9');
  });

  test('maps audit and privacy filters to supported query keys', () async {
    final _Client client = _Client();
    final AdminControlCenterApi api = AdminControlCenterApi(client: client);
    await api.module('audit-logs', filter: 'LOGIN');
    expect(client.request!.url.queryParameters['action'], 'LOGIN');
    await api.module('privacy-controls', filter: 'OPEN');
    expect(client.request!.url.queryParameters['status'], 'OPEN');
  });

  test('maps numeric access filters to statusCode and text to method',
      () async {
    final _Client client = _Client();
    final AdminControlCenterApi api = AdminControlCenterApi(client: client);
    await api.module('access-logs', filter: '403');
    expect(client.request!.url.queryParameters['statusCode'], '403');
    expect(client.request!.url.queryParameters.containsKey('method'), isFalse);
    await api.module('access-logs', filter: 'POST');
    expect(client.request!.url.queryParameters['method'], 'POST');
    expect(
        client.request!.url.queryParameters.containsKey('statusCode'), isFalse);
  });

  test('sends privacy status and note together', () async {
    final _Client client = _Client();
    final AdminControlCenterApi api = AdminControlCenterApi(client: client);
    await api.updatePrivacyRequest('request-1',
        <String, dynamic>{'status': 'COMPLETED', 'note': 'Anonymized'});
    expect(jsonDecode(client.request!.body),
        <String, String>{'status': 'COMPLETED', 'note': 'Anonymized'});
  });

  test('sends only security event filters accepted by its endpoint', () async {
    final _Client client = _Client();
    final AdminControlCenterApi api = AdminControlCenterApi(client: client);

    await api.module('security-events',
        eventType: 'LOGIN_FAILURE',
        severity: 'HIGH',
        workflow: 'OPEN',
        outcome: 'FAILED',
        start: DateTime(2024, 2, 1),
        end: DateTime(2024, 2, 7),
        limit: 50);

    expect(client.request!.url.queryParameters, <String, String>{
      'page': '1',
      'limit': '50',
      'start': '2024-02-01',
      'end': '2024-02-07',
      'eventType': 'LOGIN_FAILURE',
      'severity': 'HIGH',
      'status': 'OPEN',
      'outcome': 'FAILED',
    });
  });

  test('patches security workflow actions with investigation note', () async {
    final _Client client = _Client();
    final AdminControlCenterApi api = AdminControlCenterApi(client: client);

    await api.updateSecurityEvent('event-1',
        action: 'RESOLVE', note: 'Investigated and confirmed remediation.');

    expect(client.request!.method, 'PATCH');
    expect(client.request!.url.path,
        '/api/admin/control-center/security-events/event-1');
    expect(jsonDecode(client.request!.body), <String, String>{
      'action': 'RESOLVE',
      'note': 'Investigated and confirmed remediation.'
    });
  });

  test('rejects date ranges over the backend maximum', () async {
    final _Client client = _Client();
    final AdminControlCenterApi api = AdminControlCenterApi(client: client);
    expect(
        () => api.module('audit-logs',
            start: DateTime(2024, 1, 1), end: DateTime(2024, 5, 1)),
        throwsA(isA<AdminControlApiException>()));
  });
}

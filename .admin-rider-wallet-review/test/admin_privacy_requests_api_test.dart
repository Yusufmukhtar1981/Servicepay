import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../lib/admin/admin_privacy_requests_api.dart';

void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues(<String, Object>{
      'auth_token': 'admin-token',
    });
  });

  test('lists privacy requests with authenticated filters', () async {
    late http.Request captured;
    final api = AdminPrivacyRequestsApi(
      baseUrl: 'https://example.test/requests',
      client: MockClient((request) async {
        captured = request;
        return http.Response(
          jsonEncode(<String, dynamic>{
            'success': true,
            'data': <String, dynamic>{'items': <dynamic>[]},
          }),
          200,
        );
      }),
    );
    await api.list(search: 'SP-PR', status: 'PENDING');
    expect(captured.headers['authorization'], 'Bearer admin-token');
    expect(captured.url.queryParameters['search'], 'SP-PR');
    expect(captured.url.queryParameters['status'], 'PENDING');
    api.close();
  });

  test('submits approved status and review note', () async {
    late http.Request captured;
    final api = AdminPrivacyRequestsApi(
      baseUrl: 'https://example.test/requests',
      client: MockClient((request) async {
        captured = request;
        return http.Response(
          jsonEncode(<String, dynamic>{'success': true, 'data': {}}),
          200,
        );
      }),
    );
    await api.update(
      'request-id',
      status: 'APPROVED',
      note: 'Identity details verified.',
    );
    expect(captured.method, 'PATCH');
    expect(jsonDecode(captured.body)['status'], 'APPROVED');
    expect(jsonDecode(captured.body)['note'], 'Identity details verified.');
    api.close();
  });
}

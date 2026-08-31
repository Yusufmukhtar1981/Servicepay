import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:servicepay_app/admin/admin_calls_api.dart';

void main() {
  setUp(() => SharedPreferences.setMockInitialValues(
        <String, Object>{'auth_token': 'calls-token'},
      ));

  test('lists call metadata with bounded list query parameters', () async {
    late http.Request request;
    final AdminCallsApi api = AdminCallsApi(
      baseUrl: 'https://example.test/api/admin/calls',
      client: MockClient((http.Request value) async {
        request = value;
        return http.Response(jsonEncode(<String, dynamic>{
          'success': true,
          'calls': <Object>[],
          'pagination': <String, int>{'page': 1, 'totalPages': 1},
        }), 200);
      }),
    );

    await api.list(
      page: 1,
      limit: 20,
      status: 'ENDED',
      startDate: DateTime(2026, 1, 1),
      endDate: DateTime(2026, 1, 2),
    );

    expect(request.method, 'GET');
    expect(request.url.path, '/api/admin/calls');
    expect(request.headers['authorization'], 'Bearer calls-token');
    expect(request.url.queryParameters, <String, String>{
      'page': '1',
      'limit': '20',
      'status': 'ENDED',
      'startDate': '2026-01-01',
      'endDate': '2026-01-02',
    });
    api.close();
  });
}
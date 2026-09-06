import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:servicepay_app/admin/admin_branch_management_api.dart';

void main() {
  setUp(() => SharedPreferences.setMockInitialValues(
        <String, Object>{'auth_token': 'branch-admin-token'},
      ));

  test('lists branches through the production branch route contract', () async {
    late http.Request request;
    final api = AdminBranchManagementApi(
      baseUrl: 'https://example.test/api/branches',
      usersUrl: 'https://example.test/api/admin/users',
      client: MockClient((value) async {
        request = value;
        return http.Response(
            jsonEncode(<String, dynamic>{
              'success': true,
              'branches': <Map<String, dynamic>>[
                <String, dynamic>{'_id': 'b1', 'code': 'SP-KANO-001'}
              ],
            }),
            200);
      }),
    );

    final branches = await api.list();

    expect(request.method, 'GET');
    expect(request.url.path, '/api/branches');
    expect(request.headers['authorization'], 'Bearer branch-admin-token');
    expect(branches.single['code'], 'SP-KANO-001');
    api.close();
  });

  test('creates branch with the existing POST route', () async {
    late http.Request request;
    final api = AdminBranchManagementApi(
      baseUrl: 'https://example.test/api/branches',
      client: MockClient((value) async {
        request = value;
        return http.Response(
            jsonEncode(<String, dynamic>{
              'success': true,
              'branch': <String, dynamic>{'_id': 'b1'}
            }),
            201);
      }),
    );
    final payload = <String, dynamic>{
      'name': 'Kano Branch',
      'code': 'SP-KANO-001',
      'state': 'Kano',
      'lga': 'Nassarawa',
      'address': 'ServicePay Office',
      'phone': '08000000000',
      'email': 'kano@example.test',
      'openingDate': '2026-08-31',
      'assignedModules': <String>['DATA'],
    };

    await api.create(payload);

    expect(request.method, 'POST');
    expect(request.url.path, '/api/branches');
    expect(jsonDecode(request.body), payload);
    api.close();
  });

  test('uses existing status and manager assignment routes', () async {
    final requests = <http.Request>[];
    final api = AdminBranchManagementApi(
      baseUrl: 'https://example.test/api/branches',
      client: MockClient((value) async {
        requests.add(value);
        return http.Response(
            jsonEncode(<String, dynamic>{
              'success': true,
              'branch': <String, dynamic>{'_id': 'branch-1'}
            }),
            200);
      }),
    );

    await api.setStatus('branch-1', 'ACTIVE');
    await api.assignManager('branch-1', managerId: 'staff-1');

    expect(requests[0].method, 'PUT');
    expect(requests[0].url.path, '/api/branches/branch-1/activate');
    expect(jsonDecode(requests[0].body), <String, dynamic>{'status': 'ACTIVE'});
    expect(requests[1].url.path, '/api/branches/branch-1/manager');
    expect(jsonDecode(requests[1].body),
        <String, dynamic>{'managerId': 'staff-1'});
    api.close();
  });

  test('surfaces backend validation messages', () async {
    final api = AdminBranchManagementApi(
      baseUrl: 'https://example.test/api/branches',
      client: MockClient((_) async => http.Response(
          jsonEncode(<String, dynamic>{
            'success': false,
            'message': 'Branch code already exists.'
          }),
          409)),
    );

    expect(
      () => api.create(<String, dynamic>{}),
      throwsA(isA<AdminBranchException>().having(
          (error) => error.message, 'message', 'Branch code already exists.')),
    );
    api.close();
  });
}

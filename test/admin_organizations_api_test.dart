import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:servicepay_app/admin/admin_organizations_api.dart';
import 'package:servicepay_app/admin/admin_organizations_screen.dart';
import 'package:servicepay_app/admin/admin_permissions.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('uses canonical organization paths and status bodies', () async {
    final requests = <http.Request>[];
    final client = MockClient((request) async {
      requests.add(request);
      return http.Response('{}', 200);
    });
    final api = AdminOrganizationsApi(
      client: client,
      baseUrl: 'https://example.test/api',
      authToken: '',
    );

    await api.summary();
    await api.list(status: 'PENDING_VERIFICATION', search: 'Acme');
    await api.wallet('org-1');
    await api.updateStatus('org-1', 'VERIFIED');
    await api.updateWalletFreeze('org-1', true);

    expect(requests[0].url.toString(),
        'https://example.test/api/admin/organizations/summary');
    expect(requests[0].method, 'GET');
    expect(requests[1].url.toString(),
        'https://example.test/api/admin/organizations?status=PENDING_VERIFICATION&search=Acme');
    expect(requests[1].method, 'GET');
    expect(requests[2].url.path, '/api/admin/organizations/org-1/wallet');
    expect(requests[3].url.path, '/api/admin/organizations/org-1/status');
    expect(
        jsonDecode(requests[3].body), <String, dynamic>{'status': 'VERIFIED'});
    expect(requests[4].url.path, '/api/admin/organizations/org-1/wallet');
    expect(jsonDecode(requests[4].body), <String, dynamic>{
      'status': 'FROZEN',
      'frozen': true,
    });
  });

  test('status action gates match organization review transitions', () {
    expect(
      organizationStatusPermission('VERIFIED'),
      AdminPermissions.organizationsReview,
    );
    expect(
      organizationStatusPermission('REJECTED'),
      AdminPermissions.organizationsReview,
    );
    expect(
      organizationStatusPermission('SUSPENDED'),
      AdminPermissions.organizationsStatusManage,
    );
    expect(
      organizationStatusPermission('VERIFIED', currentStatus: 'SUSPENDED'),
      AdminPermissions.organizationsStatusManage,
    );
  });
}

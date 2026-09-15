import 'dart:io';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:servicepay_app/organizations/organizations_api.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  test('document uploads declare the backend MIME for bytes and paths',
      () async {
    TestWidgetsFlutterBinding.ensureInitialized();
    SharedPreferences.setMockInitialValues({'auth_token': 'test-token'});
    final requests = <http.Request>[];
    final client = MockClient((request) async {
      requests.add(request);
      return http.Response('{"success":true,"document":{"id":"doc-1"}}', 200);
    });
    final api = OrganizationsApi(
        client: client, baseUrl: 'https://example.test/api/organizations');

    await api.uploadOrganizationDocument(
        organizationId: 'org-1',
        documentType: 'GOVERNING_DOCUMENT',
        filePath: '',
        name: 'constitution.pdf',
        bytes: Uint8List.fromList([1, 2, 3]));
    final file = File('${Directory.systemTemp.path}/kyb-upload.jpg');
    await file.writeAsBytes([1, 2, 3]);
    await api.uploadOrganizationDocument(
        organizationId: 'org-1',
        documentType: 'REGISTRATION_CERTIFICATE',
        filePath: file.path,
        name: 'certificate.jpg');

    final bodies = requests.map((r) => String.fromCharCodes(r.bodyBytes));
    expect(
        bodies.first.toLowerCase(), contains('content-type: application/pdf'));
    expect(bodies.last.toLowerCase(), contains('content-type: image/jpeg'));
    await file.delete();
  });
}

import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:servicepay_app/admin/admin_permissions.dart';
import 'package:servicepay_app/admin/admin_session_service.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  test('authoritative profile refresh replaces cached admin permissions',
      () async {
    SharedPreferences.setMockInitialValues(<String, Object>{
      'auth_token': 'admin-token',
      'user_role': 'ADMIN',
      'admin_effective_permissions': <String>[AdminPermissions.financeView],
    });
    final AdminSessionService service = AdminSessionService(
      client: MockClient((http.Request request) async {
        expect(request.url.path, '/api/auth/profile');
        expect(request.headers['authorization'], 'Bearer admin-token');
        return http.Response(
          jsonEncode(<String, dynamic>{
            'data': <String, dynamic>{
              'user': <String, dynamic>{
                'role': 'STAFF',
                'status': 'ACTIVE',
                'permissions': <String>[AdminPermissions.supportView],
              },
            },
          }),
          200,
        );
      }),
    );

    final AdminAccess access = await service.refresh();

    expect(access.has(AdminPermissions.supportView), isTrue);
    expect(access.has(AdminPermissions.financeView), isFalse);
    expect((await SharedPreferences.getInstance()).getString('user_role'),
        'STAFF');
  });

  test('expired authoritative profile clears admin session safely', () async {
    SharedPreferences.setMockInitialValues(<String, Object>{
      'auth_token': 'expired-token',
      'user_role': 'STAFF',
      'admin_effective_permissions': <String>[AdminPermissions.supportView],
    });
    final AdminSessionService service = AdminSessionService(
      client: MockClient(
        (http.Request request) async => http.Response('Unauthorized', 401),
      ),
    );

    await expectLater(
        service.refresh(), throwsA(isA<AdminSessionExpiredException>()));

    final SharedPreferences prefs = await SharedPreferences.getInstance();
    expect(prefs.getString('auth_token'), isNull);
    expect(prefs.getString('user_role'), isNull);
    expect(prefs.getStringList('admin_effective_permissions'), isNull);
  });
}

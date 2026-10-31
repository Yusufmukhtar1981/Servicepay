import 'dart:convert';

import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:servicepay_app/admin/admin_permissions.dart';
import 'package:servicepay_app/admin/admin_session_service.dart';
import 'package:servicepay_app/services/session_store.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  const MethodChannel secureStorageChannel =
      MethodChannel('plugins.it_nomads.com/flutter_secure_storage');
  late Map<String, String> secureValues;

  setUp(() async {
    secureValues = <String, String>{};
    SharedPreferences.setMockInitialValues(<String, Object>{});
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(secureStorageChannel, (MethodCall call) async {
      final Map<dynamic, dynamic> arguments =
          call.arguments is Map ? call.arguments as Map : <dynamic, dynamic>{};
      final String key = arguments['key']?.toString() ?? '';
      switch (call.method) {
        case 'write':
          secureValues[key] = arguments['value']?.toString() ?? '';
          return null;
        case 'read':
          return secureValues[key];
        case 'delete':
          secureValues.remove(key);
          return null;
        case 'deleteAll':
          secureValues.clear();
          return null;
        default:
          return null;
      }
    });
    await SessionStore.clear();
  });

  tearDown(() {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(secureStorageChannel, null);
  });

  test('authoritative profile refresh replaces cached admin permissions',
      () async {
    SharedPreferences.setMockInitialValues(<String, Object>{
      'user_role': 'ADMIN',
      'admin_effective_permissions': <String>[AdminPermissions.financeView],
    });
    expect(await SessionStore.writeSessionVerified('admin-token'), isTrue);
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
    final SharedPreferences prefs = await SharedPreferences.getInstance();
    expect(prefs.getString('user_role'), 'STAFF');
    expect(prefs.getString('auth_token'), isNull);
  });

  test('expired authoritative profile clears admin session safely', () async {
    SharedPreferences.setMockInitialValues(<String, Object>{
      'user_role': 'STAFF',
      'admin_effective_permissions': <String>[AdminPermissions.supportView],
    });
    expect(await SessionStore.writeSessionVerified('expired-token'), isTrue);
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
    expect(await SessionStore.readToken(), isNull);
  });
}

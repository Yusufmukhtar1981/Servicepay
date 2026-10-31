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
        .setMockMethodCallHandler(secureStorageChannel,
            (MethodCall call) async {
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

  for (final int workspaceStatus in <int>[200, 403]) {
    test(
        'legacy production staff profile requires workspace proof $workspaceStatus',
        () async {
      expect(await SessionStore.writeSessionVerified('staff-token'), isTrue);
      int probes = 0;
      final AdminSessionService service = AdminSessionService(
        client: MockClient((http.Request request) async {
          expect(request.headers['authorization'], 'Bearer staff-token');
          if (request.url.path == '/api/auth/profile') {
            // Matches formatUser: staffRole is projected without scopeType.
            return http.Response(
                jsonEncode(<String, dynamic>{
                  'user': <String, dynamic>{
                    'role': 'STAFF',
                    'status': 'ACTIVE',
                    'isStaff': true,
                    'staffRole': <String, dynamic>{
                      'name': 'CUSTOMER_SUPPORT',
                      'permissions': <String>['support.workspace.view'],
                    },
                    'permissions': <String>['support.workspace.view'],
                  },
                }),
                200);
          }
          expect(request.method, 'GET');
          expect(request.url.path, '/api/admin/staff-workspace/overview');
          probes++;
          return http.Response(
            jsonEncode(<String, dynamic>{
              'success': workspaceStatus == 200,
              'data': <String, dynamic>{'role': 'CUSTOMER_SUPPORT'},
            }),
            workspaceStatus,
          );
        }),
      );
      if (workspaceStatus == 200) {
        final AdminAccess access = await service.refresh();
        expect(access.isGlobalCustomerSupportStaff, isTrue);
        expect(access.isFullAccess, isFalse);
        expect(access.has(AdminPermissions.financeView), isFalse);
      } else {
        await expectLater(service.refresh(), throwsException);
        final SharedPreferences prefs = await SharedPreferences.getInstance();
        expect(prefs.getString('admin_access_scope'), isNull);
      }
      expect(probes, 1);
    });
  }

  for (final String roleName in <String>[
    'CUSTOMER_SUPPORT',
    'OPERATIONS_MANAGER',
  ]) {
    for (final bool authorized in <bool>[true, false]) {
      test(
          'unpopulated production STAFF profile $roleName authorized=$authorized',
          () async {
        await SessionStore.writeSessionVerified('unpopulated-staff-token');
        int probes = 0;
        final AdminSessionService service = AdminSessionService(
          client: MockClient((http.Request request) async {
            expect(request.headers['authorization'],
                'Bearer unpopulated-staff-token');
            if (request.url.path == '/api/auth/profile') {
              return http.Response(
                  jsonEncode(<String, dynamic>{
                    'user': <String, dynamic>{
                      'role': 'STAFF',
                      'status': 'ACTIVE',
                      'isStaff': true,
                      'jobTitle': '',
                      'staffRole': null,
                      'permissions': <String>[],
                    },
                  }),
                  200);
            }
            expect(request.method, 'GET');
            expect(request.url.path, '/api/admin/staff-workspace/overview');
            probes++;
            return http.Response(
                jsonEncode(<String, dynamic>{
                  'success': authorized,
                  'data': <String, dynamic>{
                    'role': roleName,
                    if (roleName == 'OPERATIONS_MANAGER')
                      'transactions': <String, dynamic>{},
                  },
                }),
                authorized ? 200 : 403);
          }),
        );
        if (authorized) {
          final AdminAccess access = await service.refresh();
          expect(access.isGlobalCustomerSupportStaff,
              roleName == 'CUSTOMER_SUPPORT');
          expect(
              access.isGlobalOperationsStaff, roleName == 'OPERATIONS_MANAGER');
          expect(access.permissions, <String>{
            roleName == 'CUSTOMER_SUPPORT'
                ? AdminPermissions.supportWorkspaceView
                : AdminPermissions.operationsWorkspaceView,
          });
          expect(access.isFullAccess, isFalse);
          expect(access.has(AdminPermissions.staffCreate), isFalse);
          expect(access.has(AdminPermissions.financeView), isFalse);
        } else {
          await expectLater(service.refresh(), throwsException);
          expect(
              (await SharedPreferences.getInstance())
                  .getStringList('admin_effective_permissions'),
              isNull);
        }
        expect(probes, 1);
      });
    }
  }

  for (final String unsupportedRole in <String>[
    'HEAD_OFFICE',
    'GENERAL_STAFF',
    'OPERATIONS_MANAGER',
  ]) {
    test(
        'workspace proof never invents unsupported capability $unsupportedRole',
        () async {
      await SessionStore.writeSessionVerified('staff-token');
      final AdminSessionService service = AdminSessionService(
        client: MockClient((http.Request request) async => http.Response(
            jsonEncode(request.url.path == '/api/auth/profile'
                ? <String, dynamic>{
                    'user': <String, dynamic>{
                      'role': 'STAFF',
                      'isStaff': true,
                      'permissions': <String>[],
                    },
                  }
                : <String, dynamic>{
                    'success': true,
                    'data': <String, dynamic>{'role': unsupportedRole},
                  }),
            200)),
      );
      // OPERATIONS_MANAGER without the permission-gated operations payload
      // must not gain operations visibility merely from a role name.
      await expectLater(service.refresh(), throwsException);
      expect(
          (await SharedPreferences.getInstance())
              .getStringList('admin_effective_permissions'),
          isNull);
    });
  }

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

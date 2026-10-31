import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:servicepay_app/admin/admin_dashboard_screen.dart';
import 'package:servicepay_app/admin/admin_permissions.dart';
import 'package:servicepay_app/admin/main_navigation.dart';
import 'package:servicepay_app/admin/admin_session_service.dart';
import 'package:servicepay_app/admin/admin_staff_workspace_screens.dart';
import 'package:servicepay_app/login_routing.dart';
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

  test('workspace routing requires verified role, scope, and permission', () {
    final Map<String, dynamic> operationsProfile = <String, dynamic>{
      'role': 'STAFF',
      'isStaff': true,
      'jobTitle': 'OPERATIONS_MANAGER',
      'scopeType': 'GLOBAL',
      'permissions': <String>['operations.workspace.view', 'users.view'],
      'staffRoleId': <String, dynamic>{
        'scopeType': 'GLOBAL',
        'permissions': <String>['operations.workspace.view', 'users.view'],
      },
    };

    expect(
      globalStaffWorkspaceForRole('STAFF', operationsProfile),
      'OPERATIONS',
    );
    expect(
      AdminMainNavigation.visibleDestinationLabels(
        AdminAccess.fromUser(operationsProfile),
      ),
      <String>['Operations overview'],
    );

    final Map<String, dynamic> branchScopedSupport =
        <String, dynamic>{
      'role': 'STAFF',
      'isStaff': true,
      'jobTitle': 'CUSTOMER_SUPPORT',
      'scopeType': 'BRANCH',
      'branchId': 'branch-7',
      'permissions': <String>['support.workspace.view'],
      'staffRoleId': <String, dynamic>{
        'scopeType': 'BRANCH',
        'permissions': <String>['support.workspace.view'],
      },
    };
    expect(
      globalStaffWorkspaceForRole('STAFF', branchScopedSupport),
      isNull,
    );
    expect(
      AdminMainNavigation.visibleDestinationLabels(
        AdminAccess.fromUser(branchScopedSupport),
      ),
      isNot(contains('Customer support desk')),
    );
  });

  testWidgets(
      'global support staff reload uses secure session and renders support workspace',
      (WidgetTester tester) async {
    expect(await SessionStore.writeSessionVerified('replacement-session'),
        isTrue);
    final SharedPreferences prefs = await SharedPreferences.getInstance();
    expect(prefs.getString('auth_token'), isNull);
    bool profileRequestedWithSecureToken = false;
    final Map<String, dynamic> profile = <String, dynamic>{
      'role': 'STAFF',
      'isStaff': true,
      'status': 'ACTIVE',
      'jobTitle': 'CUSTOMER_SUPPORT',
      'branchId': 'stale-assignment-does-not-change-global-scope',
      'permissions': <String>[
        'support.workspace.view',
        'users.view',
        'support.view',
      ],
      'staffRoleId': <String, dynamic>{
        '_id': 'role-support',
        'scopeType': 'GLOBAL',
        'permissions': <String>[
          'support.workspace.view',
          'users.view',
          'support.view',
        ],
      },
    };
    final AdminSessionService service = AdminSessionService(
      client: MockClient((http.Request request) async {
        expect(request.url.path, '/api/auth/profile');
        profileRequestedWithSecureToken =
            request.headers['authorization'] ==
                'Bearer replacement-session';
        return http.Response(
          jsonEncode(<String, dynamic>{
            'success': true,
            'data': <String, dynamic>{'user': profile},
          }),
          200,
        );
      }),
    );

    final Widget home = authenticatedHomeForLogin(
      'STAFF',
      mustChangePassword: false,
      user: profile,
      adminSessionService: service,
    );
    await tester.pumpWidget(MaterialApp(home: home));
    await tester.pumpAndSettle();

    expect(profileRequestedWithSecureToken, isTrue);
    expect(prefs.getString('auth_token'), isNull);
    expect(find.byType(CustomerSupportDashboard), findsOneWidget);
    expect(find.text('Customer support desk').first, findsOneWidget);
    expect(find.byType(AdminMainNavigation), findsOneWidget);
    expect(find.byType(AdminDashboardScreen), findsNothing);
    expect(find.text('No Admin modules are assigned to this account.'),
        findsNothing);
  });

  testWidgets(
      'staff navigation mounts destinations on visit and preserves visited state',
      (WidgetTester tester) async {
    await SessionStore.writeSessionVerified('branch-staff-session');
    final AdminSessionService service = AdminSessionService(
      client: MockClient((http.Request request) async => http.Response(
            jsonEncode(<String, dynamic>{
              'data': <String, dynamic>{
                'user': <String, dynamic>{
                  'role': 'STAFF',
                  'isStaff': true,
                  'status': 'ACTIVE',
                  'jobTitle': 'GENERAL_STAFF',
                  'scopeType': 'BRANCH',
                  'accessScope': <String, dynamic>{'type': 'BRANCH'},
                  'permissions': <String>['users.view', 'support.view'],
                },
              },
            }),
            200,
          )),
    );
    await tester.pumpWidget(MaterialApp(
      home: AdminMainNavigation(
        sessionService: service,
        initialDestinationLabel: 'Users',
        destinationOverrides: <String, Widget>{
          'Users': const _StatefulProbe(label: 'Users'),
          'Support': const _StatefulProbe(label: 'Support'),
        },
      ),
    ));
    await tester.pumpAndSettle();

    expect(find.byKey(const ValueKey<String>('probe-Users')), findsOneWidget);
    expect(find.byKey(const ValueKey<String>('probe-Support')), findsNothing);

    await tester.tap(find.text('Support').last);
    await tester.pumpAndSettle();
    expect(find.text('Support count: 0'), findsOneWidget);
    expect(find.byKey(const ValueKey<String>('probe-Support')), findsOneWidget);
    await tester.tap(find.text('Increment'));
    await tester.pumpAndSettle();
    expect(find.text('Support count: 1'), findsOneWidget);

    await tester.tap(find.text('Users').last);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Support').last);
    await tester.pumpAndSettle();
    expect(find.text('Support count: 1'), findsOneWidget);
  });
}

class _StatefulProbe extends StatefulWidget {
  const _StatefulProbe({required this.label});

  final String label;

  @override
  State<_StatefulProbe> createState() => _StatefulProbeState();
}

class _StatefulProbeState extends State<_StatefulProbe> {
  int count = 0;

  @override
  Widget build(BuildContext context) => Scaffold(
        key: ValueKey<String>('probe-${widget.label}'),
        body: Center(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              Text('${widget.label} count: $count'),
              FilledButton(
                onPressed: () => setState(() => count++),
                child: const Text('Increment'),
              ),
            ],
          ),
        ),
      );
}

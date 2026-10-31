import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:servicepay_app/login_screen.dart';
import 'package:servicepay_app/main_navigation.dart';
import 'package:servicepay_app/forced_password_change_screen.dart';
import 'package:servicepay_app/services/session_store.dart';
import 'package:servicepay_app/startup_session_gate.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  const secureStorageChannel =
      MethodChannel('plugins.it_nomads.com/flutter_secure_storage');

  setUp(() async {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(secureStorageChannel, (_) async => null);
    SharedPreferences.setMockInitialValues(<String, Object>{});
    await SessionStore.clear();
  });
  tearDown(() {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(secureStorageChannel, null);
  });

  Future<SharedPreferences> preferences() => SharedPreferences.getInstance();

  testWidgets('logged-out customer reaches Login without a network request',
      (WidgetTester tester) async {
    SharedPreferences.setMockInitialValues(<String, Object>{});
    var requestCount = 0;
    final MockClient client = MockClient((http.Request request) async {
      requestCount += 1;
      return http.Response('{}', 500);
    });

    await tester.pumpWidget(
      MaterialApp(
        home: StartupSessionGate(
          client: client,
          preferencesLoader: preferences,
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.byType(LoginScreen), findsOneWidget);
    expect(find.text('Welcome back'), findsOneWidget);
    expect(requestCount, 0);
  });

  testWidgets('valid customer session reaches the existing dashboard router',
      (WidgetTester tester) async {
    SharedPreferences.setMockInitialValues(<String, Object>{
      'auth_token': 'valid-customer-token',
    });
    final MockClient client = MockClient((http.Request request) async {
      expect(
          request.url.toString(), '${StartupSessionGate.baseUrl}/auth/profile');
      expect(request.headers['Authorization'], 'Bearer valid-customer-token');
      return http.Response(
        jsonEncode(<String, Object>{
          'success': true,
          'data': <String, Object>{
            'user': <String, Object>{
              '_id': 'customer-1',
              'role': 'CUSTOMER',
              'status': 'ACTIVE',
            },
          },
        }),
        200,
        headers: <String, String>{'content-type': 'application/json'},
      );
    });

    await tester.pumpWidget(
      MaterialApp(
        home: StartupSessionGate(
          client: client,
          preferencesLoader: preferences,
        ),
      ),
    );
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 250));

    expect(find.byType(MainNavigation), findsOneWidget);
    expect(find.text('Preparing your account…'), findsNothing);
  });

  testWidgets('saved temporary staff session gates before protected profile',
      (WidgetTester tester) async {
    SharedPreferences.setMockInitialValues(<String, Object>{
      'auth_token': 'temporary-staff-token',
      'must_change_password': true,
      'forced_password_user_context': jsonEncode(<String, Object>{
        '_id': 'branch-staff-42',
        'role': 'STAFF',
        'status': 'ACTIVE',
        'isStaff': true,
        'branchId': 'branch-1',
        'jobTitle': 'BRANCH_OPERATIONS_OFFICER',
        'branchStaffPermissions': <String>['branch.dashboard.view'],
      }),
    });
    var requestCount = 0;
    final MockClient client = MockClient((http.Request request) async {
      requestCount++;
      return http.Response('{}', 500);
    });

    await tester.pumpWidget(
      MaterialApp(
        home: StartupSessionGate(
          client: client,
          preferencesLoader: preferences,
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.byType(ForcedPasswordChangeScreen), findsOneWidget);
    expect(find.byType(MainNavigation), findsNothing);
    expect(requestCount, 0);
    expect(tester.takeException(), isNull);
  });

  testWidgets('PASSWORD_CHANGE_REQUIRED profile response restores cached role',
      (WidgetTester tester) async {
    SharedPreferences.setMockInitialValues(<String, Object>{
      'auth_token': 'temporary-staff-token',
      'user_role': 'STAFF',
      'login_routing_context': jsonEncode(<String, Object>{
        '_id': 'branch-staff-42',
        'role': 'STAFF',
        'status': 'ACTIVE',
        'isStaff': true,
        'branchId': 'branch-1',
        'jobTitle': 'BRANCH_OPERATIONS_OFFICER',
        'branchStaffPermissions': <String>['branch.dashboard.view'],
      }),
    });
    var requestCount = 0;
    final MockClient client = MockClient((http.Request request) async {
      requestCount++;
      return http.Response(
        jsonEncode(<String, Object>{
          'success': false,
          'code': 'PASSWORD_CHANGE_REQUIRED',
          'message':
              'You must change your temporary password before continuing.',
        }),
        403,
      );
    });

    await tester.pumpWidget(
      MaterialApp(
        home: StartupSessionGate(
          client: client,
          preferencesLoader: preferences,
        ),
      ),
    );
    await tester.pumpAndSettle();

    final ForcedPasswordChangeScreen screen =
        tester.widget<ForcedPasswordChangeScreen>(
      find.byType(ForcedPasswordChangeScreen),
    );
    expect(screen.role, 'STAFF');
    expect(screen.staffUser['branchId'], 'branch-1');
    expect(requestCount, 1);
    expect((await preferences()).getBool('must_change_password'), isTrue);
    expect(find.byType(MainNavigation), findsNothing);
  });

  testWidgets('legacy rider token restores and migrates after browser reopen',
      (WidgetTester tester) async {
    SharedPreferences.setMockInitialValues(<String, Object>{
      'accessToken': 'legacy-rider-token',
    });
    final MockClient client = MockClient((http.Request request) async {
      expect(request.headers['Authorization'], 'Bearer legacy-rider-token');
      return http.Response(
        jsonEncode(<String, Object>{
          'success': true,
          'user': <String, Object>{
            '_id': 'rider-1',
            'role': 'DELIVERY_RIDER',
            'status': 'ACTIVE',
          },
        }),
        200,
      );
    });

    await tester.pumpWidget(
      MaterialApp(
        home: StartupSessionGate(
          client: client,
          preferencesLoader: preferences,
        ),
      ),
    );
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 250));

    expect(await SessionStore.readToken(), 'legacy-rider-token');
    expect((await preferences()).getString('accessToken'), isNull);
    expect(find.text('Preparing your account…'), findsNothing);
  });

  testWidgets('invalid stored session is cleared and routed to Login',
      (WidgetTester tester) async {
    SharedPreferences.setMockInitialValues(<String, Object>{
      'auth_token': 'expired-token',
      'user_role': 'CUSTOMER',
    });
    final MockClient client = MockClient(
      (http.Request request) async => http.Response(
        jsonEncode(<String, Object>{'message': 'Unauthorized'}),
        401,
      ),
    );

    await tester.pumpWidget(
      MaterialApp(
        home: StartupSessionGate(
          client: client,
          preferencesLoader: preferences,
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.byType(LoginScreen), findsOneWidget);
    final SharedPreferences prefs = await preferences();
    expect(prefs.getString('auth_token'), isNull);
    expect(prefs.getString('user_role'), isNull);
  });

  testWidgets('profile timeout shows Retry and Sign Out without clearing token',
      (WidgetTester tester) async {
    tester.view.physicalSize = const Size(320, 640);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    SharedPreferences.setMockInitialValues(<String, Object>{
      'auth_token': 'temporarily-unverified-token',
    });
    final MockClient client = MockClient((http.Request request) async {
      await Completer<void>().future;
      return http.Response('{}', 200);
    });

    await tester.pumpWidget(
      MaterialApp(
        home: StartupSessionGate(
          client: client,
          preferencesLoader: preferences,
          requestTimeout: const Duration(milliseconds: 100),
        ),
      ),
    );
    await tester.pump(const Duration(milliseconds: 150));
    await tester.pumpAndSettle();

    expect(
      find.text("We couldn't prepare your account right now."),
      findsOneWidget,
    );
    expect(find.byKey(const Key('startup-retry')), findsOneWidget);
    expect(find.byKey(const Key('startup-sign-out')), findsOneWidget);
    expect(await SessionStore.readToken(), 'temporarily-unverified-token');
    expect((await preferences()).getString('auth_token'), isNull);
    expect(tester.takeException(), isNull);
  });
}

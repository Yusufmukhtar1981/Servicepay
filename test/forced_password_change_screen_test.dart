import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:servicepay_app/forced_password_change_screen.dart';
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
    await SessionStore.writeToken('temporary-session-token');
  });

  tearDown(() {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(secureStorageChannel, null);
  });

  Future<void> enterValidValues(
    WidgetTester tester, {
    String current = 'Temporary123!',
    String next = 'Replacement123!',
    String? confirm,
  }) async {
    await tester.enterText(
      find.byKey(const Key('temporary-password-field')),
      current,
    );
    await tester.enterText(
      find.byKey(const Key('new-password-field')),
      next,
    );
    await tester.enterText(
      find.byKey(const Key('confirm-password-field')),
      confirm ?? next,
    );
  }

  Future<void> tapSubmit(WidgetTester tester) async {
    await tester.ensureVisible(find.byKey(const Key('forced-password-submit')));
    await tester.pump();
    await tester.tap(find.byKey(const Key('forced-password-submit')));
  }

  testWidgets('shows three password fields with visibility controls',
      (WidgetTester tester) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: ForcedPasswordChangeScreen(role: 'BRANCH_MANAGER'),
      ),
    );

    expect(find.text('Temporary password'), findsOneWidget);
    expect(find.text('New password'), findsOneWidget);
    expect(find.text('Confirm new password'), findsOneWidget);
    expect(find.byType(TextFormField), findsNWidgets(3));
    expect(find.byIcon(Icons.visibility_off_outlined), findsNWidgets(3));
    expect(tester.takeException(), isNull);
  });

  testWidgets('enforces backend password strength and confirmation locally',
      (WidgetTester tester) async {
    var requestCount = 0;
    final MockClient client = MockClient((http.Request request) async {
      requestCount++;
      return http.Response('{}', 500);
    });
    await tester.pumpWidget(
      MaterialApp(
        home: ForcedPasswordChangeScreen(
          role: 'STAFF',
          client: client,
        ),
      ),
    );

    await enterValidValues(tester, next: 'lowercase123!');
    await tapSubmit(tester);
    await tester.pump();
    expect(find.text('Add at least one uppercase letter.'), findsOneWidget);
    expect(requestCount, 0);

    await tester.enterText(
      find.byKey(const Key('new-password-field')),
      'Replacement123!',
    );
    await tester.enterText(
      find.byKey(const Key('confirm-password-field')),
      'Different123!',
    );
    await tapSubmit(tester);
    await tester.pump();
    expect(find.text('New passwords do not match.'), findsOneWidget);
    expect(requestCount, 0);
  });

  testWidgets('wrong current password does not replace or clear the session',
      (WidgetTester tester) async {
    final MockClient client =
        MockClient((http.Request request) async => http.Response(
              jsonEncode(<String, Object>{
                'success': false,
                'message': 'Current password is incorrect.',
              }),
              401,
            ));
    final SharedPreferences preferences = await SharedPreferences.getInstance();
    await preferences.setBool('must_change_password', true);
    await tester.pumpWidget(
      MaterialApp(
        home: ForcedPasswordChangeScreen(
          role: 'STAFF',
          client: client,
        ),
      ),
    );
    await enterValidValues(tester, current: 'Wrong123!');
    await tapSubmit(tester);
    await tester.pumpAndSettle();

    expect(find.text('Current password is incorrect.'), findsOneWidget);
    expect(find.byType(ForcedPasswordChangeScreen), findsOneWidget);
    expect(await SessionStore.readToken(), 'temporary-session-token');
    expect(preferences.getBool('must_change_password'), isTrue);
  });

  testWidgets('missing temporary token offers sign-in without making request',
      (WidgetTester tester) async {
    await SessionStore.clear();
    var requestCount = 0;
    final MockClient client = MockClient((http.Request request) async {
      requestCount++;
      return http.Response('{}', 500);
    });
    await tester.pumpWidget(
      MaterialApp(
        home: ForcedPasswordChangeScreen(
          role: 'STAFF',
          client: client,
          onRelogin: () {},
        ),
      ),
    );
    await enterValidValues(tester);
    await tapSubmit(tester);
    await tester.pumpAndSettle();

    expect(requestCount, 0);
    expect(find.byKey(const Key('forced-password-relogin')), findsOneWidget);
    expect(
        find.textContaining('session is no longer available'), findsOneWidget);
  });

  testWidgets('sends exact fields and routes only after persisting replacement',
      (WidgetTester tester) async {
    Map<String, dynamic>? requestBody;
    final MockClient client = MockClient((http.Request request) async {
      requestBody = Map<String, dynamic>.from(jsonDecode(request.body) as Map);
      expect(request.method, 'PUT');
      expect(request.url.path, '/api/auth/change-password');
      expect(
        request.headers['authorization'],
        'Bearer temporary-session-token',
      );
      return http.Response(
        jsonEncode(<String, Object>{
          'success': true,
          'message': 'Password changed successfully.',
          'token': 'replacement-session-token',
        }),
        200,
        headers: const <String, String>{'content-type': 'application/json'},
      );
    });
    final SharedPreferences preferences = await SharedPreferences.getInstance();
    await preferences.setBool('must_change_password', true);
    await preferences.setString(
      'forced_password_user_context',
      jsonEncode(<String, Object>{'role': 'BRANCH_MANAGER'}),
    );
    await tester.pumpWidget(
      MaterialApp(
        home: ForcedPasswordChangeScreen(
          role: 'BRANCH_MANAGER',
          client: client,
          authenticatedHomeBuilder: (_) => const Text('Authorized workspace'),
        ),
      ),
    );
    await enterValidValues(tester);
    await tapSubmit(tester);
    await tester.pumpAndSettle();

    expect(requestBody, <String, dynamic>{
      'currentPassword': 'Temporary123!',
      'newPassword': 'Replacement123!',
      'confirmPassword': 'Replacement123!',
    });
    expect(await SessionStore.readToken(), 'replacement-session-token');
    expect(secureValues.values, contains('replacement-session-token'));
    expect(preferences.getBool('must_change_password'), isNull);
    expect(preferences.getString('forced_password_user_context'), isNull);
    expect(find.text('Authorized workspace'), findsOneWidget);
  });

  testWidgets('successful response without replacement token requires sign-in',
      (WidgetTester tester) async {
    final MockClient client =
        MockClient((http.Request request) async => http.Response(
              jsonEncode(<String, Object>{
                'success': true,
                'message': 'Password changed successfully.',
              }),
              200,
            ));
    final SharedPreferences preferences = await SharedPreferences.getInstance();
    await preferences.setBool('must_change_password', true);
    await tester.pumpWidget(
      MaterialApp(
        home: ForcedPasswordChangeScreen(
          role: 'STAFF',
          client: client,
          onRelogin: () {},
        ),
      ),
    );
    await enterValidValues(tester);
    await tapSubmit(tester);
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('forced-password-relogin')), findsOneWidget);
    expect(find.textContaining('refreshed session was not returned'),
        findsOneWidget);
    expect(await SessionStore.readToken(), isNull);
    expect(preferences.getBool('must_change_password'), isNull);
  });

  testWidgets('supports short mobile keyboard viewport and desktop width',
      (WidgetTester tester) async {
    tester.view.physicalSize = const Size(360, 500);
    tester.view.devicePixelRatio = 1;
    tester.view.viewInsets = const FakeViewPadding(bottom: 230);
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    addTearDown(tester.view.resetViewInsets);
    await tester.pumpWidget(
      const MaterialApp(
        home: ForcedPasswordChangeScreen(role: 'STAFF'),
      ),
    );
    expect(find.byType(SingleChildScrollView), findsOneWidget);
    expect(tester.takeException(), isNull);

    tester.view.viewInsets = const FakeViewPadding();
    tester.view.physicalSize = const Size(1440, 1000);
    await tester.pump();
    expect(find.text('Set a new password to continue'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}

import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:servicepay_app/forgot_password_screen.dart';
import 'package:servicepay_app/profile_screen.dart';
import 'package:servicepay_app/services/customer_account_recovery.dart';
import 'package:servicepay_app/services/session_store.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  const secureChannel =
      MethodChannel('plugins.it_nomads.com/flutter_secure_storage');
  final secureValues = <String, String>{};

  setUp(() async {
    secureValues.clear();
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(secureChannel, (call) async {
      final args = Map<String, dynamic>.from(call.arguments as Map);
      final key = args['key']?.toString();
      if (call.method == 'write' && key != null) {
        secureValues[key] = args['value'].toString();
      }
      if (call.method == 'delete' && key != null) secureValues.remove(key);
      if (call.method == 'read') return secureValues[key];
      return null;
    });
    SharedPreferences.setMockInitialValues({});
    await SessionStore.clear();
    await SessionStore.writeToken('customer-secure-token');
    expect((await SharedPreferences.getInstance()).getString('auth_token'),
        isNull);
  });

  tearDown(() async {
    await SessionStore.clear();
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(secureChannel, null);
  });

  testWidgets('phone recovery respects disabled SMS availability',
      (tester) async {
    var challengeCalls = 0;
    final client = MockClient((request) async {
      if (request.url.path.endsWith('/account-recovery/methods')) {
        expect(request.method, 'GET');
        expect(request.headers['Authorization'], isNull);
        return http.Response(
          '{"success":true,"smsAvailable":false,"requiresVerifiedPhone":true}',
          200,
        );
      }
      challengeCalls++;
      return http.Response('{}', 200);
    });
    await tester.pumpWidget(MaterialApp(
      home:
          ForgotPasswordScreen(client: client, urlLauncher: (_) async => true),
    ));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('phone-recovery-unavailable')), findsOneWidget);
    expect(
        tester
            .widget<OutlinedButton>(
              find.byKey(const Key('phone-recovery-submit')),
            )
            .onPressed,
        isNull);
    expect(challengeCalls, 0);
  });

  testWidgets(
      'anonymous PIN recovery sends correct payload and opens HTTPS URL',
      (tester) async {
    var challengeCalls = 0;
    Uri? launched;
    final client = MockClient((request) async {
      if (request.url.path.endsWith('/account-recovery/methods')) {
        return http.Response(
          '{"success":true,"smsAvailable":true,"requiresVerifiedPhone":true}',
          200,
        );
      }
      challengeCalls++;
      expect(request.method, 'POST');
      expect(request.headers['Authorization'], isNull);
      expect(jsonDecode(request.body), {
        'phone': '08012345678',
        'action': 'PIN_RECOVERY',
      });
      return http.Response(
        '{"success":true,"challengeId":"b519a88d-0d95-48c2-85dd-b86c9139ac66","customerEntryUrl":"https://api.servicepay.ng/account-recovery/page?challenge=test","expiresAt":"2030-01-01T00:00:00Z"}',
        200,
      );
    });
    await tester.pumpWidget(MaterialApp(
      home: ForgotPasswordScreen(
        client: client,
        urlLauncher: (uri) async {
          launched = uri;
          return true;
        },
      ),
    ));
    await tester.pumpAndSettle();
    final dropdown = find.byType(DropdownButtonFormField<String>);
    await tester.ensureVisible(dropdown);
    await tester.tap(dropdown);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Recover transaction PIN').last);
    await tester.pumpAndSettle();
    final phoneField = find.byType(TextFormField).last;
    await tester.ensureVisible(phoneField);
    await tester.enterText(phoneField, '08012345678');
    await tester.pump();
    final submit = find.byKey(const Key('phone-recovery-submit'));
    await tester.ensureVisible(submit);
    await tester.tap(submit);
    await tester.pumpAndSettle();
    expect(challengeCalls, 1);
    expect(launched?.path, '/account-recovery/page');
    expect(launched?.origin, 'https://api.servicepay.ng');
    expect(find.textContaining('If the details match'), findsNothing);
  });

  testWidgets(
      'duplicate phone-recovery taps make one request; launch failure is recoverable',
      (tester) async {
    final pending = Completer<http.Response>();
    var challengeCalls = 0;
    final client = MockClient((request) async {
      if (request.url.path.endsWith('/account-recovery/methods')) {
        return http.Response(
          '{"success":true,"smsAvailable":true,"requiresVerifiedPhone":true}',
          200,
        );
      }
      challengeCalls++;
      return pending.future;
    });
    await tester.pumpWidget(MaterialApp(
      home:
          ForgotPasswordScreen(client: client, urlLauncher: (_) async => false),
    ));
    await tester.pumpAndSettle();
    final phoneField = find.byType(TextFormField).last;
    await tester.ensureVisible(phoneField);
    await tester.enterText(phoneField, '08012345678');
    await tester.pump();
    final submit = find.byKey(const Key('phone-recovery-submit'));
    await tester.ensureVisible(submit);
    await tester.tap(submit);
    await tester.pump();
    await tester.tap(submit);
    await tester.pump();
    expect(challengeCalls, 1);
    pending.complete(http.Response(
      '{"success":true,"customerEntryUrl":"https://api.servicepay.ng/account-recovery/page?challenge=test","expiresAt":"2030-01-01T00:00:00Z"}',
      200,
    ));
    await tester.pumpAndSettle();
    expect(challengeCalls, 1);
    expect(find.textContaining('request was received'), findsOneWidget);
    expect(find.byKey(const Key('phone-recovery-pending')), findsOneWidget);
    await tester.ensureVisible(find.byKey(const Key('open-pending-recovery')));
    await tester.tap(find.byKey(const Key('open-pending-recovery')));
    await tester.pumpAndSettle();
    expect(challengeCalls, 1);
  });

  testWidgets('recovery errors are generic and do not reveal server details',
      (tester) async {
    final client = MockClient((request) async {
      if (request.url.path.endsWith('/account-recovery/methods')) {
        return http.Response(
          '{"success":true,"smsAvailable":true,"requiresVerifiedPhone":true}',
          200,
        );
      }
      return http.Response(
        '{"success":false,"message":"No account exists for 08012345678"}',
        404,
      );
    });
    await tester.pumpWidget(MaterialApp(
      home:
          ForgotPasswordScreen(client: client, urlLauncher: (_) async => true),
    ));
    await tester.pumpAndSettle();
    final phoneField = find.byType(TextFormField).last;
    await tester.ensureVisible(phoneField);
    await tester.enterText(phoneField, '08012345678');
    await tester.pump();
    final submit = find.byKey(const Key('phone-recovery-submit'));
    await tester.ensureVisible(submit);
    await tester.tap(submit);
    await tester.pumpAndSettle();
    expect(find.textContaining('No account exists'), findsNothing);
    expect(find.textContaining('If the details match an eligible account'),
        findsOneWidget);
  });

  test('rejects untrusted, insecure, userinfo and wrong-path entry URLs',
      () async {
    for (final value in [
      'https://evil.example/account-recovery/page',
      'http://api.servicepay.ng/account-recovery/page',
      'https://user@api.servicepay.ng/account-recovery/page',
      'https://@api.servicepay.ng/account-recovery/page',
      'https://api.servicepay.ng/customer/otp',
    ]) {
      final client = MockClient((request) async => http.Response(
            jsonEncode({
              'success': true,
              'customerEntryUrl': value,
              'expiresAt': '2030-01-01T00:00:00Z',
            }),
            200,
          ));
      final service = CustomerAccountRecoveryService(
        client: client,
        baseUrl: 'https://api.servicepay.ng/api',
        launch: (_) async => true,
      );
      await expectLater(
        service.requestPhoneChallenge(
          phone: '08012345678',
          action: 'PASSWORD_RESET',
        ),
        throwsA(isA<RecoveryRequestException>()),
      );
    }
  });

  testWidgets('profile verification uses SessionStore token and existing phone',
      (tester) async {
    var verificationCalls = 0;
    final client = MockClient((request) async {
      if (request.url.path == '/api/auth/profile') {
        return http.Response(
          '{"success":true,"user":{"fullName":"Amina Yusuf","phone":"08012345678","role":"CUSTOMER","phoneVerified":false}}',
          200,
        );
      }
      if (request.url.path == '/api/kyc/status') {
        return http.Response('{"success":true}', 200);
      }
      if (request.url.path ==
          '/api/account-recovery/phone-verification/challenge') {
        verificationCalls++;
        expect(
            request.headers['Authorization'], 'Bearer customer-secure-token');
        expect(jsonDecode(request.body), {'currentPassword': 'Password123!'});
        return http.Response(
          '{"success":true,"customerEntryUrl":"https://api.servicepay.ng/account-recovery/page?challenge=verify"}',
          200,
        );
      }
      return http.Response('{"success":true}', 200);
    });
    Uri? launched;
    var launchCalls = 0;
    await tester.pumpWidget(MaterialApp(
      home: ProfileScreen(
        client: client,
        urlLauncher: (uri) async {
          launchCalls++;
          launched = uri;
          return launchCalls > 1;
        },
      ),
    ));
    await tester.pumpAndSettle();
    await tester.scrollUntilVisible(find.text('Verify existing phone'), 300);
    await tester.tap(find.text('Verify existing phone'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField).last, 'Password123!');
    await tester.tap(find.text('Continue'));
    await tester.pumpAndSettle();
    expect(verificationCalls, 1);
    expect(launched?.origin, 'https://api.servicepay.ng');
    expect(launched?.path, '/account-recovery/page');
    expect(find.text('Open secure page'), findsOneWidget);
    await tester.ensureVisible(find.text('Open secure page'));
    await tester.tap(find.text('Open secure page'));
    await tester.pumpAndSettle();
    expect(launchCalls, 2);
    expect(verificationCalls, 1);
    expect(find.textContaining('sign in again'), findsOneWidget);
    expect((await SharedPreferences.getInstance()).getString('auth_token'),
        isNull);
  });
}

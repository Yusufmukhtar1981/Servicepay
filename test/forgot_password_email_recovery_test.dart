import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:servicepay_app/forgot_password_screen.dart';

Widget _app(http.Client client) {
  return MaterialApp(
    home: ForgotPasswordScreen(
      client: client,
      urlLauncher: (_) async => true,
    ),
  );
}

http.Response _smsUnavailable() => http.Response(
      '{"success":true,"smsAvailable":false,"requiresVerifiedPhone":true}',
      200,
    );

Future<void> _expectRecoveryError(
  WidgetTester tester, {
  required int statusCode,
  required String message,
}) async {
  final client = MockClient((request) async {
    if (request.url.path.endsWith('/account-recovery/methods')) {
      return _smsUnavailable();
    }
    return http.Response(
      jsonEncode({'success': false, 'message': message}),
      statusCode,
    );
  });

  await tester.pumpWidget(_app(client));
  await tester.pumpAndSettle();
  await tester.enterText(
    find.byType(TextFormField).first,
    'customer@example.com',
  );
  await tester.ensureVisible(find.text('Send Reset Link'));
  await tester.tap(find.text('Send Reset Link'));
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 400));
  expect(find.text(message), findsOneWidget);
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('successful email request uses generic, accurate recovery copy',
      (tester) async {
    final client = MockClient((request) async {
      if (request.url.path.endsWith('/account-recovery/methods')) {
        return _smsUnavailable();
      }
      return http.Response('{"success":true,"message":"Email sent"}', 200);
    });

    await tester.pumpWidget(_app(client));
    await tester.pumpAndSettle();
    await tester.enterText(
      find.byType(TextFormField).first,
      'customer@example.com',
    );
    await tester.ensureVisible(find.text('Send Reset Link'));
    await tester.tap(find.text('Send Reset Link'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));

    expect(find.text('Request submitted'), findsOneWidget);
    final successCopy = tester.widget<Text>(
      find.byKey(const Key('forgot-password-success-message')),
    );
    expect(
      successCopy.data,
      contains('If a ServicePay account exists for customer@example.com'),
    );
    expect(successCopy.data, contains('may be sent'));
    expect(successCopy.data, isNot(contains('has been sent')));
    expect(find.textContaining('Spam and Promotions'), findsOneWidget);
    expect(find.textContaining('contact ServicePay Support'), findsOneWidget);

    final expiry = find.byKey(const Key('forgot-password-expiry-message'));
    await tester.ensureVisible(expiry);
    expect(find.textContaining('expires after 15 minutes'), findsOneWidget);
    expect(find.textContaining('20 minutes'), findsNothing);
  });

  testWidgets('resend uses the same address and enforces a 60-second cooldown',
      (tester) async {
    final requestEmails = <String>[];
    final client = MockClient((request) async {
      if (request.url.path.endsWith('/account-recovery/methods')) {
        return _smsUnavailable();
      }
      requestEmails.add(
        (jsonDecode(request.body) as Map<String, dynamic>)['email'] as String,
      );
      return http.Response('{"success":true}', 200);
    });

    await tester.pumpWidget(_app(client));
    await tester.pumpAndSettle();
    await tester.enterText(
      find.byType(TextFormField).first,
      'customer@example.com',
    );
    await tester.ensureVisible(find.text('Send Reset Link'));
    await tester.tap(find.text('Send Reset Link'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));

    final resend = find.byKey(const Key('forgot-password-resend'));
    await tester.ensureVisible(resend);
    expect(tester.widget<TextButton>(resend).onPressed, isNull);
    expect(find.text('Request another link in 60s'), findsOneWidget);
    expect(requestEmails, ['customer@example.com']);

    await tester.pump(const Duration(seconds: 59));
    expect(find.text('Request another link in 1s'), findsOneWidget);
    expect(tester.widget<TextButton>(resend).onPressed, isNull);

    await tester.pump(const Duration(seconds: 1));
    expect(tester.widget<TextButton>(resend).onPressed, isNotNull);
    await tester.tap(resend);
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));

    expect(requestEmails, ['customer@example.com', 'customer@example.com']);
    expect(find.text('Request another link in 60s'), findsOneWidget);
  });

  testWidgets('email submission prevents overlapping requests', (tester) async {
    final pending = Completer<http.Response>();
    var requestCount = 0;
    final client = MockClient((request) async {
      if (request.url.path.endsWith('/account-recovery/methods')) {
        return _smsUnavailable();
      }
      requestCount++;
      return pending.future;
    });

    await tester.pumpWidget(_app(client));
    await tester.pumpAndSettle();
    await tester.enterText(
      find.byType(TextFormField).first,
      'customer@example.com',
    );
    await tester.ensureVisible(find.text('Send Reset Link'));
    await tester.tap(find.text('Send Reset Link'));
    await tester.pump();
    await tester.tap(find.text('Sending...'));
    await tester.pump();

    expect(requestCount, 1);
    pending.complete(http.Response('{"success":true}', 200));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));
    expect(requestCount, 1);
    expect(find.text('Request submitted'), findsOneWidget);
  });

  testWidgets('429 rate-limit response remains visible', (tester) async {
    await _expectRecoveryError(
      tester,
      statusCode: 429,
      message: 'Please wait before trying again.',
    );
  });

  testWidgets('503 service error response remains visible', (tester) async {
    await _expectRecoveryError(
      tester,
      statusCode: 503,
      message: 'Recovery is temporarily unavailable.',
    );
  });
}

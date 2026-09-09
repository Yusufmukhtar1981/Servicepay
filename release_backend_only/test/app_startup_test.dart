import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:servicepay_app/main.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues(<String, Object>{});
  });

  testWidgets('mounts the login app without waiting for optional services',
      (WidgetTester tester) async {
    await tester.pumpWidget(const ServicePayApp());
    await tester.pumpAndSettle();

    expect(find.text('Welcome back'), findsOneWidget);
    expect(find.text('Sign in'), findsOneWidget);
    expect(find.text('Preparing your account…'), findsNothing);
  });

  testWidgets('shows visible startup UI before services are ready',
      (WidgetTester tester) async {
    final Completer<void> services = Completer<void>();

    await tester.pumpWidget(
      ServicePayBootstrap(
        initializeServices: () => services.future,
        startupTimeout: const Duration(minutes: 1),
      ),
    );

    expect(find.text('ServicePay'), findsOneWidget);
    expect(find.text('Preparing your account…'), findsOneWidget);
    expect(find.byType(CircularProgressIndicator), findsOneWidget);

    services.complete();
    await tester.pumpAndSettle();

    expect(find.text('Welcome back'), findsOneWidget);
  });

  testWidgets('falls back to login when startup services fail',
      (WidgetTester tester) async {
    await tester.pumpWidget(
      ServicePayBootstrap(
        initializeServices: () => Future<void>.error(
          StateError('plugin unavailable'),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Welcome back'), findsOneWidget);
    expect(find.text('Sign in'), findsOneWidget);
  });

  testWidgets('falls back to login when startup services time out',
      (WidgetTester tester) async {
    final Completer<void> services = Completer<void>();

    await tester.pumpWidget(
      ServicePayBootstrap(
        initializeServices: () => services.future,
        startupTimeout: const Duration(milliseconds: 100),
      ),
    );
    await tester.pump(const Duration(milliseconds: 150));
    await tester.pumpAndSettle();

    expect(find.text('Welcome back'), findsOneWidget);
    expect(find.text('Sign in'), findsOneWidget);
  });
}

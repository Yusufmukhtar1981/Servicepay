import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:servicepay_app/help_support_screen.dart';
import 'package:servicepay_app/login_screen.dart';
import 'package:servicepay_app/servicepay_theme.dart';
import 'package:servicepay_app/servicepay_ui.dart';
import 'package:shared_preferences/shared_preferences.dart';

double _contrastRatio(Color foreground, Color background) {
  final double foregroundLuminance = foreground.computeLuminance();
  final double backgroundLuminance = background.computeLuminance();
  final double lighter = foregroundLuminance > backgroundLuminance
      ? foregroundLuminance
      : backgroundLuminance;
  final double darker = foregroundLuminance > backgroundLuminance
      ? backgroundLuminance
      : foregroundLuminance;
  return (lighter + 0.05) / (darker + 0.05);
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('Customer sign-in fields stay readable and password stays obscured',
      (WidgetTester tester) async {
    SharedPreferences.setMockInitialValues({});
    await tester.binding.setSurfaceSize(const Size(390, 844));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await tester.pumpWidget(MaterialApp(
      theme: ServicePayTheme.customer(),
      home: const LoginScreen(),
    ));
    await tester.pump();

    final Finder fields = find.byType(TextField);
    await tester.enterText(fields.first, 'customer@example.com');
    await tester.enterText(fields.last, 'UI-only-sample1');
    expect(tester.widget<TextField>(fields.first).controller?.text,
        'customer@example.com');
    expect(tester.widget<TextField>(fields.last).obscureText, isTrue);
    for (final InputDecorator field
        in tester.widgetList<InputDecorator>(find.byType(InputDecorator))) {
      expect(field.decoration.fillColor, ServicePayColors.surfaceRaised);
    }
    for (final EditableText field
        in tester.widgetList<EditableText>(find.byType(EditableText))) {
      expect(_contrastRatio(field.style.color!, ServicePayColors.surfaceRaised),
          greaterThanOrEqualTo(4.5));
    }
    final Text heading = tester.widget<Text>(find.text('Welcome back'));
    expect(_contrastRatio(heading.style!.color!, ServicePayColors.surface),
        greaterThanOrEqualTo(4.5));
    expect(tester.takeException(), isNull);
  });

  test('customer theme keeps controls touch-friendly and consistent', () {
    final ThemeData theme = ServicePayTheme.customer();

    expect(ServicePayColors.canvas, const Color(0xFF062A22));
    expect(ServicePayColors.accent, const Color(0xFF20D69A));
    expect(ServicePayColors.brand, const Color(0xFF078553));
    expect(theme.colorScheme.primary, ServicePayColors.accent);
    expect(theme.colorScheme.onPrimary, ServicePayColors.onAccent);
    expect(theme.scaffoldBackgroundColor, ServicePayColors.canvas);
    expect(theme.cardTheme.elevation, greaterThan(0));
    expect(
      theme.filledButtonTheme.style?.minimumSize?.resolve({}),
      const Size(64, 48),
    );
    expect(theme.inputDecorationTheme.filled, isTrue);
  });

  test('green brand and readable text meet contrast targets', () {
    expect(_contrastRatio(Colors.white, ServicePayColors.brand),
        greaterThanOrEqualTo(4.5));
    expect(_contrastRatio(ServicePayColors.onAccent, ServicePayColors.accent),
        greaterThanOrEqualTo(4.5));
    for (final Color background in <Color>[
      ServicePayColors.canvas,
      ServicePayColors.surface,
      ServicePayColors.surfaceRaised,
    ]) {
      expect(_contrastRatio(ServicePayColors.ink, background),
          greaterThanOrEqualTo(4.5));
      expect(_contrastRatio(ServicePayColors.muted, background),
          greaterThanOrEqualTo(4.5));
      expect(_contrastRatio(ServicePayColors.accent, background),
          greaterThanOrEqualTo(4.5));
      for (final Color semantic in <Color>[
        ServicePayColors.danger,
        ServicePayColors.warning,
        ServicePayColors.info,
      ]) {
        expect(_contrastRatio(semantic, background), greaterThanOrEqualTo(4.5));
      }
    }
  });

  testWidgets('help and support forms fit required responsive widths',
      (WidgetTester tester) async {
    const sizes = <Size>[
      Size(320, 760),
      Size(360, 800),
      Size(390, 844),
      Size(412, 915),
      Size(768, 900),
      Size(1180, 900),
    ];

    for (final Size size in sizes) {
      await tester.binding.setSurfaceSize(size);
      await tester.pumpWidget(
        MaterialApp(
          theme: ServicePayTheme.customer(),
          home: const HelpSupportScreen(),
        ),
      );
      await tester.pump();
      expect(tester.takeException(), isNull, reason: 'Help screen at $size');

      await tester.pumpWidget(
        MaterialApp(
          theme: ServicePayTheme.customer(),
          home: const SupportRequestScreen(
            initialCategory: 'TRANSACTION',
            initialSubject: 'Issue with a transaction',
            transactionSummary:
                'Transfer\nReference: SPT-LONG-REFERENCE-1234567890\nAmount: ₦20,000.00\nStatus: PROCESSING',
          ),
        ),
      );
      await tester.pump();
      expect(tester.takeException(), isNull, reason: 'Support form at $size');
    }

    await tester.binding.setSurfaceSize(null);
  });

  testWidgets('status pills use customer-friendly labels',
      (WidgetTester tester) async {
    await tester.pumpWidget(
      MaterialApp(
        theme: ServicePayTheme.customer(),
        home: const Scaffold(
          body: Wrap(
            children: [
              ServicePayStatusPill(status: 'IN_REVIEW'),
              ServicePayStatusPill(
                status: 'WAITING_ON_CUSTOMER',
                label: 'AWAITING CUSTOMER',
              ),
            ],
          ),
        ),
      ),
    );

    expect(find.text('In Review'), findsOneWidget);
    expect(find.text('AWAITING CUSTOMER'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('support form does not shorten backend-valid ticket details',
      (WidgetTester tester) async {
    await tester.pumpWidget(
      MaterialApp(
        theme: ServicePayTheme.customer(),
        home: const SupportRequestScreen(),
      ),
    );

    final String subject = List<String>.filled(200, 'S').join();
    final String description = List<String>.filled(3500, 'D').join();
    final Finder fields = find.byType(TextField);

    await tester.enterText(fields.at(0), subject);
    await tester.enterText(fields.at(1), description);

    expect(tester.widget<TextField>(fields.at(0)).controller?.text, subject);
    expect(
      tester.widget<TextField>(fields.at(1)).controller?.text,
      description,
    );
  });
}

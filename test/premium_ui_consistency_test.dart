import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:servicepay_app/help_support_screen.dart';
import 'package:servicepay_app/servicepay_theme.dart';
import 'package:servicepay_app/servicepay_ui.dart';

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

  test('customer theme keeps controls touch-friendly and consistent', () {
    final ThemeData theme = ServicePayTheme.light();

    expect(ServicePayColors.brand, const Color(0xFF087A45));
    expect(ServicePayColors.brandSoft, const Color(0xFFE8F5EC));
    expect(theme.colorScheme.primary, ServicePayColors.brand);
    expect(theme.colorScheme.onPrimary, Colors.white);
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
    expect(_contrastRatio(ServicePayColors.ink, Colors.white),
        greaterThanOrEqualTo(4.5));
    expect(_contrastRatio(ServicePayColors.muted, Colors.white),
        greaterThanOrEqualTo(4.5));
    expect(
      _contrastRatio(ServicePayColors.brand, ServicePayColors.brandSoft),
      greaterThanOrEqualTo(4.5),
    );
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
          theme: ServicePayTheme.light(),
          home: const HelpSupportScreen(),
        ),
      );
      await tester.pump();
      expect(tester.takeException(), isNull, reason: 'Help screen at $size');

      await tester.pumpWidget(
        MaterialApp(
          theme: ServicePayTheme.light(),
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
        theme: ServicePayTheme.light(),
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
        theme: ServicePayTheme.light(),
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

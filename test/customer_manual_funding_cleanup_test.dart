import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:servicepay_app/dashboard_screen.dart';
import 'package:servicepay_app/main_navigation.dart';
import 'package:servicepay_app/servicepay_theme.dart';
import 'package:flutter/rendering.dart';
import 'package:servicepay_app/manual_funding_screen.dart';
import 'package:servicepay_app/wallet_screen.dart';

void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues(<String, Object>{
      'user_role': 'CUSTOMER',
      'user_name': 'Test Customer',
      'wallet_balance': 1000.0,
    });
  });

  testWidgets('customer dashboard and navigation omit manual funding',
      (WidgetTester tester) async {
    await tester.binding.setSurfaceSize(const Size(390, 844));
    addTearDown(() => tester.binding.setSurfaceSize(null));

    await tester.pumpWidget(const MaterialApp(home: MainNavigation()));
    await tester.pump(const Duration(milliseconds: 150));

    expect(find.text('Fund Wallet'), findsNothing);
    expect(find.text('Manual Funding'), findsNothing);
    expect(find.text('Wallet'), findsOneWidget);
    expect(find.text('Transfer'), findsNothing);
    expect(find.text('Withdrawal'), findsNothing);
  });

  testWidgets('customer services omit Wallet Funding',
      (WidgetTester tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1200));
    addTearDown(() => tester.binding.setSurfaceSize(null));

    await tester.pumpWidget(const MaterialApp(home: DashboardScreen()));
    await tester.pump(const Duration(milliseconds: 150));

    expect(find.text('Wallet Funding'), findsNothing);
    expect(find.byKey(const Key('dashboard-transfer-action')), findsNothing);
    expect(find.byKey(const Key('dashboard-withdraw-action')), findsNothing);
  });

  testWidgets('legacy manual funding destination resolves to Wallet',
      (WidgetTester tester) async {
    await tester.pumpWidget(
      const MaterialApp(home: ManualFundingScreen()),
    );
    await tester.pump();

    expect(find.byType(WalletScreen), findsOneWidget);
    expect(find.text('Manual Funding'), findsNothing);
  });

  testWidgets('Wallet hides removed actions but preserves Generate Statement',
      (WidgetTester tester) async {
    await tester.binding.setSurfaceSize(const Size(390, 844));
    addTearDown(() => tester.binding.setSurfaceSize(null));

    await tester.pumpWidget(const MaterialApp(home: WalletScreen()));
    await tester.pump(const Duration(milliseconds: 150));

    expect(find.text('Fund Wallet'), findsNothing);
    expect(find.text('Manual Funding'), findsNothing);
    expect(find.text('Transfer'), findsNothing);
    expect(find.text('Withdraw'), findsNothing);
    expect(find.text('Generate Statement'), findsOneWidget);
    expect(find.text('QR Pay'), findsNothing);
  });

  testWidgets('Customer navigation stays readable on narrow large-text screens',
      (WidgetTester tester) async {
    addTearDown(() => tester.binding.setSurfaceSize(null));
    for (final double width in [320, 390]) {
      await tester.binding.setSurfaceSize(Size(width, 844));
      for (final double scale in [1, 2]) {
        await tester.pumpWidget(MaterialApp(
          theme: ServicePayTheme.customer(),
          home: MediaQuery(
            data: MediaQueryData(
              size: Size(width, 844),
              textScaler: TextScaler.linear(scale),
            ),
            child: const MainNavigation(),
          ),
        ));
        await tester.pump(const Duration(milliseconds: 150));
        final Finder label = find.text('Transactions');
        expect(label, findsOneWidget);
        expect(tester.widget<Text>(label).style?.fontSize, 14);
        final RenderParagraph paragraph =
            tester.renderObject<RenderParagraph>(label);
        expect(paragraph.didExceedMaxLines, isFalse);
        expect(tester.getBottomRight(label).dy, lessThanOrEqualTo(844));
        expect(tester.takeException(), isNull);
        await tester.pumpWidget(const SizedBox.shrink());
        await tester.pump();
      }
    }
  });
}

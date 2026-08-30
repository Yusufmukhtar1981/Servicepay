import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:servicepay_app/dashboard_screen.dart';
import 'package:servicepay_app/main_navigation.dart';
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
    expect(find.text('Transfer'), findsOneWidget);
    expect(find.text('Withdraw'), findsOneWidget);
  });

  testWidgets('customer services omit Wallet Funding',
      (WidgetTester tester) async {
    await tester.binding.setSurfaceSize(const Size(800, 1200));
    addTearDown(() => tester.binding.setSurfaceSize(null));

    await tester.pumpWidget(const MaterialApp(home: DashboardScreen()));
    await tester.pump(const Duration(milliseconds: 150));

    expect(find.text('Wallet Funding'), findsNothing);
    expect(find.byKey(const Key('dashboard-transfer-action')), findsOneWidget);
    expect(find.byKey(const Key('dashboard-withdraw-action')), findsOneWidget);
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

  testWidgets('Wallet preserves transfer and withdrawal without manual funding',
      (WidgetTester tester) async {
    await tester.binding.setSurfaceSize(const Size(390, 844));
    addTearDown(() => tester.binding.setSurfaceSize(null));

    await tester.pumpWidget(const MaterialApp(home: WalletScreen()));
    await tester.pump(const Duration(milliseconds: 150));

    expect(find.text('Fund Wallet'), findsNothing);
    expect(find.text('Manual Funding'), findsNothing);
    expect(find.text('Transfer'), findsWidgets);
    expect(find.text('Withdraw'), findsWidgets);
  });
}

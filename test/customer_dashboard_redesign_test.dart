import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:servicepay_app/dashboard_screen.dart';
import 'package:servicepay_app/main_navigation.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() {
    SharedPreferences.setMockInitialValues(<String, Object>{
      'user_name': 'Ada Okafor',
      'user_role': 'CUSTOMER',
      'wallet_balance': 24500.0,
    });
  });

  testWidgets('shows the premium customer dashboard essentials',
      (WidgetTester tester) async {
    await tester.binding.setSurfaceSize(const Size(320, 760));
    addTearDown(() => tester.binding.setSurfaceSize(null));

    await tester.pumpWidget(const MaterialApp(home: DashboardScreen()));
    await tester.pump(const Duration(milliseconds: 100));

    expect(find.text('ServicePay'), findsOneWidget);
    expect(find.text('Simple. Secure. Instant.'), findsOneWidget);
    expect(find.text('Ada'), findsOneWidget);
    expect(find.byKey(const Key('dashboard-refresh-tool')), findsOneWidget);
    expect(find.byKey(const Key('dashboard-history-tool')), findsOneWidget);
    expect(find.byKey(const Key('dashboard-help-tool')), findsOneWidget);
    expect(find.byKey(const Key('dashboard-settings-tool')), findsOneWidget);
    expect(find.text('Available Balance'), findsOneWidget);
    expect(find.text('Invite & Earn'), findsOneWidget);
    expect(find.text('Airtime'), findsOneWidget);
    expect(find.text('Electricity'), findsOneWidget);

    await tester.tap(find.byKey(const Key('dashboard-refresh-tool')));
    await tester.pump();
    await tester.tap(find.byKey(const Key('dashboard-refresh-tool')));
    await tester.pump();

    expect(tester.takeException(), isNull);
  });

  testWidgets('keeps the customer QR scan route in main navigation',
      (WidgetTester tester) async {
    await tester.pumpWidget(const MaterialApp(home: MainNavigation()));
    await tester.pump(const Duration(milliseconds: 100));

    expect(find.text('Home'), findsOneWidget);
    expect(find.text('Transactions'), findsOneWidget);
    expect(find.text('Wallet'), findsOneWidget);
    expect(find.text('Profile'), findsOneWidget);
    expect(find.text('Scan'), findsOneWidget);

    await tester.tap(find.byKey(const Key('customer-qr-navigation')));
    await tester.pump(const Duration(milliseconds: 400));

    expect(find.text('ServicePay QR Pay'), findsOneWidget);
  });
}

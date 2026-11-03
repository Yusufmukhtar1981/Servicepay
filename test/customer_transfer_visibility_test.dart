import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:servicepay_app/main_navigation.dart';
import 'package:servicepay_app/wallet_screen.dart';

void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues(<String, Object>{
      'user_name': 'Test Customer',
      'user_role': 'CUSTOMER',
      'wallet_balance': 24500.0,
    });
  });

  for (final double width in <double>[360, 1440]) {
    testWidgets('navigation and service search hide Transfer at width $width',
        (WidgetTester tester) async {
      await tester.binding.setSurfaceSize(Size(width, 900));
      addTearDown(() => tester.binding.setSurfaceSize(null));
      await tester.pumpWidget(const MaterialApp(home: MainNavigation()));
      await tester.pump(const Duration(milliseconds: 150));
      expect(find.text('Transfer'), findsNothing);
      expect(find.byKey(const Key('dashboard-transfer-action')), findsNothing);
      expect(find.text('Wallet'), findsWidgets);
      expect(find.text('Transactions'), findsWidgets);
      expect(find.text('Data'), findsWidgets);
      expect(find.text('Airtime'), findsWidgets);

      await tester.ensureVisible(find.byKey(const Key('customer-all-services')));
      await tester.tap(find.byKey(const Key('customer-all-services')));
      await tester.pump();
      await tester.pump(const Duration(seconds: 1));
      expect(find.text('ServicePay Transfer'), findsNothing);
      await tester.enterText(find.byType(TextField).last, 'ServicePay Transfer');
      await tester.pump();
      expect(
          find.byWidgetPredicate((Widget widget) =>
              widget is Text && widget.data == 'ServicePay Transfer'),
          findsNothing);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox.shrink());
    });

    testWidgets('Wallet hides Transfer without losing other actions at $width',
        (WidgetTester tester) async {
      await tester.binding.setSurfaceSize(Size(width, 1000));
      addTearDown(() => tester.binding.setSurfaceSize(null));
      await tester.pumpWidget(const MaterialApp(home: WalletScreen()));
      await tester.pump(const Duration(milliseconds: 150));
      expect(find.text('Transfer'), findsNothing);
      await tester.scrollUntilVisible(find.text('Withdraw'), 300,
          scrollable: find.byType(Scrollable).first);
      expect(find.text('QR Pay'), findsNothing);
      expect(find.text('Withdraw'), findsWidgets);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox.shrink());
    });
  }

  test('all customer shortcut sources omit Transfer navigation', () {
    for (final String path in <String>[
      'lib/dashboard_screen.dart',
      'lib/wallet_screen.dart',
      'lib/main_navigation.dart',
    ]) {
      final String source = File(path).readAsStringSync();
      expect(source, isNot(contains("import 'transfer_screen.dart'")));
      expect(source, isNot(contains('const TransferScreen(')));
      expect(source, isNot(contains("label: 'Transfer'")));
      expect(source, isNot(contains("title: 'ServicePay Transfer'")));
    }
    expect(File('lib/business_wallet_screen.dart').readAsStringSync(),
        isNot(contains("title: 'Transfer'")));
    // Historical rendering and transfer implementations remain in the release.
    expect(File('lib/transfer_screen.dart').existsSync(), isTrue);
    expect(File('lib/bank_transfer_screen.dart').existsSync(), isTrue);
    expect(File('lib/transactions_screen.dart').existsSync(), isTrue);
    expect(File('lib/dashboard_screen.dart').readAsStringSync(),
        contains('const WithdrawalScreen()'));
  });
}

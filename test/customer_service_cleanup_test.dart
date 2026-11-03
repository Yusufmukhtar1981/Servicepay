import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:servicepay_app/dashboard_screen.dart';
import 'package:servicepay_app/servicepay_feature_hub_screen.dart';
import 'package:servicepay_app/services/customer_service_visibility.dart';

const hiddenLabels = <String>[
  'QR Pay', 'QR Payment', 'Group Ajo', 'Group Wallet / Ajo',
  'Business Wallet', 'Pay-by-Link', 'ServicePay Call', 'Request Money',
  'Financial Services', 'Transfer', 'ServicePay Transfer',
];
const preserved = <String>[
  'Wallet', 'Virtual Account', 'Data', 'Airtime', 'Electricity', 'Withdrawal',
  'NIN Verification', 'Marketplace', 'Delivery', 'Logistics', 'Solar',
  'Empowerment', 'ServicePay Amana', 'EduPay', 'Profile', 'Transaction History',
];

void main() {
  setUp(() => SharedPreferences.setMockInitialValues(<String, Object>{
    'user_name': 'Test Customer', 'user_role': 'CUSTOMER',
    'wallet_balance': 24500.0,
  }));
  test('hidden services and aliases cannot return through configuration', () {
    for (final label in hiddenLabels) {
      expect(isHiddenCustomerService(label), isTrue, reason: label);
    }
    for (final name in preserved) {
      expect(isHiddenCustomerService(name), isFalse, reason: name);
      expect(promotesHiddenCustomerService(name), isFalse, reason: name);
    }
    for (final name in <String>[
      'OPEN_QR_PAY', '/group-wallet', 'Try Business Wallet today',
      'pay-by-link', 'ServicePayCall', 'Request Money now',
    ]) {
      expect(promotesHiddenCustomerService(name), isTrue, reason: name);
    }
    // Ordinary wallet funding must not disappear with Transfer navigation.
    expect(promotesHiddenCustomerService('Transfer to your virtual account to fund your wallet'),
        isFalse);
  });
  test('Mini Apps removes hidden records, not retained services in old groups', () {
    expect(isCustomerMiniAppVisible({'routeKey': 'businessWallet'}), isFalse);
    expect(isCustomerMiniAppVisible({'name': 'Group Wallet / Ajo'}), isFalse);
    expect(isCustomerMiniAppVisible({'slug': 'pay-by-link'}), isFalse);
    expect(isCustomerMiniAppVisible({'name': 'Financial Services'}), isFalse);
    expect(isCustomerMiniAppVisible({'routeKey': 'cards', 'name': 'Cards',
      'category': 'Financial Services'}), isTrue);
    expect(customerMiniAppCategory('Financial Services'), 'Other Services');
    expect(customerMiniAppCategory('Delivery & Logistics'), 'Delivery & Logistics');
  });
  for (final width in <double>[320, 390, 1440]) {
    testWidgets('service catalogue cleanup and preservation at $width',
        (tester) async {
      await tester.binding.setSurfaceSize(Size(width, 900));
      addTearDown(() => tester.binding.setSurfaceSize(null));
      await tester.pumpWidget(const MaterialApp(home: DashboardScreen()));
      await tester.pump(const Duration(milliseconds: 150));
      expect(find.text('₦24,500.00'), findsOneWidget);
      expect(find.text('Data'), findsWidgets);
      expect(find.text('Airtime'), findsWidgets);
      await tester.ensureVisible(find.byKey(const Key('customer-all-services')));
      await tester.tap(find.byKey(const Key('customer-all-services')));
      await tester.pump();
      await tester.pump(const Duration(seconds: 1));
      for (final label in hiddenLabels) {
        await tester.enterText(find.byType(TextField).last, label);
        await tester.pump();
        expect(find.byWidgetPredicate((w) => w is Text && w.data == label),
            findsNothing, reason: label);
      }
      for (final name in <String>[
        'Electricity', 'Withdrawal', 'Marketplace', 'ServicePay Solar',
        'Empowerment', 'ServicePay Amana', 'EduPay', 'Delivery',
      ]) {
        await tester.enterText(find.byType(TextField).last, name);
        await tester.pump();
        expect(find.byWidgetPredicate((w) => w is Text && w.data == name),
            findsWidgets, reason: name);
      }
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox.shrink());
    });
  }
  testWidgets('legacy feature hub keeps only retained destinations', (tester) async {
    await tester.pumpWidget(const MaterialApp(home: ServicePayFeatureHubScreen()));
    for (final label in hiddenLabels) {
      expect(find.text(label), findsNothing);
    }
    expect(find.text('Community Agent Locator'), findsOneWidget);
  });
  test('no customer shortcuts instantiate hidden screens; implementations remain', () {
    const files = <String>['dashboard_screen.dart', 'wallet_screen.dart',
      'profile_screen.dart', 'main_navigation.dart', 'mini_apps_screen.dart',
      'servicepay_feature_hub_screen.dart', 'public_website_screen.dart'];
    for (final file in files) {
      final source = File('lib/$file').readAsStringSync();
      for (final type in <String>['QrPayScreen', 'GroupWalletScreen',
        'BusinessWalletScreen', 'PayByLinkScreen', 'VoiceCallScreen',
        'RequestMoneyScreen']) {
        expect(source.contains('$type('), isFalse, reason: '$file: $type');
      }
    }
    for (final file in <String>['qr_pay_screen.dart', 'group_wallet_screen.dart',
      'business_wallet_screen.dart', 'pay_by_link_screen.dart',
      'voice_call_screen.dart', 'request_money_screen.dart',
      'transfer_screen.dart', 'transactions_screen.dart']) {
      expect(File('lib/$file').existsSync(), isTrue, reason: file);
    }
  });
}

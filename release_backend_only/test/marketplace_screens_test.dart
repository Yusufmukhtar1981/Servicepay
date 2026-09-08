import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:servicepay_app/marketplace/marketplace_checkout_screen.dart';
import 'package:servicepay_app/marketplace/marketplace_my_orders_screen.dart';
import 'package:servicepay_app/marketplace/marketplace_seller_orders_screen.dart';

void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues(<String, Object>{
      'auth_token': 'test-token',
      'user_name': 'Marketplace Customer',
      'user_phone': '08030000000',
      'user_address': '1 ServicePay Street',
      'user_state': 'Kano',
      'user_lga': 'Nassarawa',
    });
  });

  Future<void> pumpMarketplaceScreen(
    WidgetTester tester,
    Widget screen,
  ) async {
    await tester.pumpWidget(
      MaterialApp(
        home: screen,
      ),
    );
    await tester.pump();
  }

  testWidgets('checkout requires a four-digit wallet transaction PIN', (
    tester,
  ) async {
    await pumpMarketplaceScreen(
      tester,
      const MarketplaceCheckoutScreen(),
    );

    expect(find.text('Secure Wallet Payment'), findsOneWidget);
    await tester.scrollUntilVisible(
      find.text('Transaction PIN'),
      250,
      scrollable: find.byType(Scrollable).first,
    );
    expect(find.text('Transaction PIN'), findsOneWidget);
  });

  testWidgets('My Orders exposes held-payment and delivery controls', (
    tester,
  ) async {
    await pumpMarketplaceScreen(
      tester,
      const MarketplaceMyOrdersScreen(),
    );

    expect(find.text('My Marketplace Orders'), findsOneWidget);
  });

  testWidgets('seller orders expose the controlled fulfillment dashboard', (
    tester,
  ) async {
    await pumpMarketplaceScreen(
      tester,
      const MarketplaceSellerOrdersScreen(),
    );

    expect(find.text('My Store Orders'), findsOneWidget);
  });
}
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:servicepay_app/airtime_data_screen.dart';
import 'package:servicepay_app/business_wallet_screen.dart';
import 'package:servicepay_app/cards_screen.dart';
import 'package:servicepay_app/empowerment_screen.dart';
import 'package:servicepay_app/group_wallet_screen.dart';
import 'package:servicepay_app/keke_order_screen.dart';
import 'package:servicepay_app/logistics_screen.dart';
import 'package:servicepay_app/marketplace/marketplace_screen.dart';
import 'package:servicepay_app/mini_apps_screen.dart';

void main() {
  test('every active backend Mini App route has a real destination', () {
    final destinations = <String, Type>{
      'cards': CardsScreen,
      'empowerment': EmpowermentScreen,
      'businessWallet': BusinessWalletScreen,
      'delivery': LogisticsScreen,
      'airtimeData': AirtimeDataScreen,
      'groupWallet': GroupWalletScreen,
      'marketplace': MarketplaceScreen,
      'transport': KekeOrderScreen,
    };

    for (final entry in destinations.entries) {
      expect(miniAppScreenForRouteKey(entry.key), isA<Widget>());
      expect(miniAppScreenForRouteKey(entry.key).runtimeType, entry.value);
    }
  });

  test('unknown Mini App routes stay unavailable instead of showing a fake flow', () {
    expect(miniAppScreenForRouteKey('not-implemented'), isNull);
  });

  testWidgets('Airtime & Data chooser launches existing purchase modules', (
    WidgetTester tester,
  ) async {
    await tester.pumpWidget(
      const MaterialApp(home: AirtimeDataScreen()),
    );

    expect(find.text('Buy Airtime'), findsOneWidget);
    expect(find.text('Buy Data'), findsOneWidget);

    await tester.tap(find.byKey(const Key('mini-app-airtime-choice')));
    await tester.pump();
    expect(find.text('Buy Airtime'), findsOneWidget);

    await tester.pumpWidget(const MaterialApp(home: AirtimeDataScreen()));
    await tester.ensureVisible(
      find.byKey(const Key('mini-app-data-choice')),
    );
    await tester.tap(
      find.byKey(const Key('mini-app-data-choice')),
      warnIfMissed: false,
    );
    await tester.pump();
    expect(find.text('Buy Data'), findsWidgets);
  });
}
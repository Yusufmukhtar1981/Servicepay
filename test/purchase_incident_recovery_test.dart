import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:servicepay_app/airtime_screen.dart';
import 'package:servicepay_app/data_screen.dart';
import 'package:servicepay_app/services/data_purchase_intent.dart';
import 'data_phone_pending_test.dart' show IntentStorage;

void main() {
  testWidgets(
      'Airtime keeps waiting for a verified catalogue beyond four seconds',
      (tester) async {
    final catalog = Completer<Map<String, dynamic>>();
    await tester.pumpWidget(MaterialApp(
        home: AirtimeScreen(
      loadBeneficiaries: () async => [],
      loadNetworks: () => catalog.future,
    )));
    await tester.pump(const Duration(seconds: 5));
    expect(find.textContaining('could not be loaded'), findsNothing);
    await tester.enterText(find.byType(TextField).first, '08012345678');
    catalog.complete({
      'success': true,
      'data': [
        {'displayName': 'MTN', 'networkId': 1},
        {'displayName': 'Airtel', 'networkId': 2},
        {'displayName': 'Glo', 'networkId': 3},
        {'displayName': '9mobile', 'networkId': 4},
      ]
    });
    await tester.pumpAndSettle();
    final dropdown = tester
        .widget<DropdownButton<String>>(find.byType(DropdownButton<String>));
    expect(dropdown.items!.length, 4);
    expect(find.textContaining('could not be loaded'), findsNothing);
  });

  testWidgets(
      'Airtime shows reauthentication rather than false provider outage',
      (tester) async {
    await tester.pumpWidget(MaterialApp(
        home: AirtimeScreen(
      loadBeneficiaries: () async => [],
      loadNetworks: () async => {'success': false, 'httpStatus': 401},
    )));
    await tester.pumpAndSettle();
    expect(find.text('Sign in again'), findsOneWidget);
    expect(find.textContaining('Your session has expired'), findsOneWidget);
    expect(find.text('Retry loading networks'), findsNothing);
  });

  testWidgets(
      'expired DATA status retains the old key and denies independent spend',
      (tester) async {
    tester.view.physicalSize = const Size(1000, 1400);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final intent = DataPurchaseIntent(
        storage: IntentStorage(), accountId: () async => 'customer');
    final key = await intent.keyForSubmission(
        network: 'MTN', phone: '08012345678', planCode: 'x', price: 100);
    int purchases = 0;
    await tester.pumpWidget(MaterialApp(
        home: DataScreen(
      purchaseIntent: intent,
      loadBeneficiaries: () async => [],
      loadPlans: (_) async => {
        'success': true,
        'plans': [
          {'code': 'x', 'name': '1GB', 'price': 100},
        ]
      },
      statusQuery: (_) async =>
          {'httpStatus': 401, 'authenticationRequired': true, 'pending': true},
      purchase: (_) async {
        purchases++;
        return {};
      },
    )));
    await tester.pumpAndSettle();
    expect(find.text('Sign in again'), findsOneWidget);
    expect(find.textContaining('Sign in required'), findsOneWidget);
    expect(find.text('Start a separate purchase'), findsNothing);
    expect((await intent.pending())!['key'], key);
    expect(purchases, 0);
    await tester.enterText(find.byType(TextField).first, '+2348012345678');
    expect(
        tester.widget<TextField>(find.byType(TextField).first).controller!.text,
        '+2348012345678');
  });
}

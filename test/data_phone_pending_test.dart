import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:servicepay_app/data_screen.dart';
import 'package:servicepay_app/services/data_phone.dart';
import 'package:servicepay_app/services/data_purchase_intent.dart';

class IntentStorage implements DataPurchaseIntentStorage {
  final entries = <String, String>{};
  bool failArchive = false;
  @override
  Future<String?> read(String key) async => entries[key];
  @override
  Future<void> write(String key, String value) async {
    if (failArchive && key.endsWith('.retained')) throw StateError('disk full');
    entries[key] = value;
  }

  @override
  Future<void> delete(String key) async => entries.remove(key);
}

void main() {
  test('normalizes all requested Nigerian mobile formats safely', () {
    for (final number in [
      '08012345678',
      '07012345678',
      '08112345678',
      '09012345678',
      '09112345678'
    ]) {
      expect(normalizeDataPhone(number), number);
      expect(normalizeDataPhone('+234${number.substring(1)}'), number);
      expect(normalizeDataPhone('234${number.substring(1)}'), number);
    }
    expect(normalizeDataPhone('+234 801 234 5678'), '08012345678');
    expect(normalizeDataPhone('abc08012345678'), contains('abc'));
  });

  test(
      'explicit separate purchase retains old key and fails closed on storage failure',
      () async {
    final storage = IntentStorage();
    final intent =
        DataPurchaseIntent(storage: storage, accountId: () async => 'a');
    final old = await intent.keyForSubmission(
        network: 'MTN', phone: '08012345678', planCode: 'x', price: 100);
    storage.failArchive = true;
    await expectLater(intent.retainForSeparatePurchase(old), throwsStateError);
    expect((await intent.pending())!['key'], old);
    storage.failArchive = false;
    await intent.retainForSeparatePurchase(old);
    expect(await intent.pending(), isNull);
    expect((await intent.retained()).single['key'], old);
    final fresh = await intent.keyForSubmission(
        network: 'MTN', phone: '08012345678', planCode: 'x', price: 100);
    expect(fresh, isNot(old));
    expect((await intent.retained()).single['key'], old);
    await intent.finishRetained(old);
    expect(await intent.retained(), isEmpty);
    expect((await intent.pending())!['key'], fresh);
  });

  testWidgets(
      'phone remains focusable and editable during catalogue load and pending recovery',
      (tester) async {
    tester.view.physicalSize = const Size(1000, 1200);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final storage = IntentStorage();
    final intent =
        DataPurchaseIntent(storage: storage, accountId: () async => 'a');
    await intent.keyForSubmission(
        network: 'MTN', phone: '08012345678', planCode: 'x', price: 100);
    final plans = Completer<Map<String, dynamic>>();
    int purchases = 0, queries = 0;
    await tester.pumpWidget(MaterialApp(
        home: DataScreen(
      purchaseIntent: intent,
      loadBeneficiaries: () async => [],
      loadPlans: (_) => plans.future,
      statusQuery: (_) async {
        queries++;
        return {'status': 'PENDING', 'pending': true};
      },
      purchase: (_) async {
        purchases++;
        return {};
      },
    )));
    await tester.pump(const Duration(milliseconds: 50));
    final input = find.byType(TextField).first;
    await tester.tap(input);
    await tester.pump();
    expect(tester.testTextInput.isVisible, true);
    await tester.enterText(input, '+2348012345678');
    expect(tester.widget<TextField>(input).controller!.text, '+2348012345678');
    await tester.enterText(input, '0801234567');
    expect(tester.widget<TextField>(input).controller!.text, '0801234567');
    plans.complete({
      'success': true,
      'plans': [
        {'code': 'x', 'name': '1GB SME', 'price': 100}
      ]
    });
    await tester.pumpAndSettle();
    expect(queries, 1);
    expect(purchases, 0);
    expect((await intent.pending())!['key'], isNotEmpty);
    expect(
        tester
            .widget<FilledButton>(
                find.widgetWithText(FilledButton, 'Buy').first)
            .onPressed,
        isNull);
  });

  testWidgets(
      'stale UNKNOWN allows only acknowledged new intent while keeping original query-only',
      (tester) async {
    tester.view.physicalSize = const Size(1000, 1400);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final storage = IntentStorage();
    final intent =
        DataPurchaseIntent(storage: storage, accountId: () async => 'a');
    final old = await intent.keyForSubmission(
        network: 'MTN', phone: '08012345678', planCode: 'x', price: 100);
    int submits = 0;
    await tester.pumpWidget(MaterialApp(
        home: DataScreen(
      purchaseIntent: intent,
      loadBeneficiaries: () async => [],
      loadPlans: (_) async => {
        'success': true,
        'plans': [
          {'code': 'x', 'name': '1GB SME', 'price': 100}
        ]
      },
      statusQuery: (key) async {
        expect(key, old);
        return {
          'status': 'UNKNOWN',
          'pending': true,
          'manualReviewRequired': true,
          'allowSeparatePurchase': true
        };
      },
      purchase: (_) async {
        submits++;
        return {};
      },
    )));
    await tester.pumpAndSettle();
    expect(find.textContaining('Earlier request needs review'), findsOneWidget);
    expect(find.textContaining('Your transaction is being processed'),
        findsNothing);
    await tester.tap(find.text('Start a separate purchase'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Start separate purchase'));
    await tester.pumpAndSettle();
    expect(await intent.pending(), isNull);
    expect((await intent.retained()).single['key'], old);
    expect(submits, 0, reason: 'acknowledgement never buys or resends');
    expect(find.text('Check status'), findsOneWidget);
  });
}

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:servicepay_app/data_screen.dart';
import 'package:servicepay_app/services/data_purchase_intent.dart';
import 'package:servicepay_app/widgets/pending_purchase_warning.dart';

class MemoryIntentStorage implements DataPurchaseIntentStorage {
  final values = <String, String>{};
  bool failArchive = false;
  @override
  Future<String?> read(String key) async => values[key];
  @override
  Future<void> write(String key, String value) async {
    if (failArchive && key.endsWith('.retained')) {
      throw StateError('archive unavailable');
    }
    values[key] = value;
  }

  @override
  Future<void> delete(String key) async {
    values.remove(key);
  }
}

Future<void> _pumpDataBuy(
  WidgetTester tester,
  DataPurchaseIntent intent,
  List<Map<String, dynamic>> sent,
) async {
  await tester.pumpWidget(MaterialApp(
      home: DataScreen(
    purchaseIntent: intent,
    pendingContext: (_) async => {
      'success': true,
      'pendingCount': 1,
      'matchingPendingCount': 1,
    },
    loadBeneficiaries: () async => [],
    loadPlans: (_) async => {
      'success': true,
      'plans': [
        {'code': 'x', 'name': '1GB SME', 'price': 100}
      ],
    },
    purchase: (request) async {
      sent.add(request);
      return {'status': 'PENDING', 'pending': true};
    },
  )));
  await tester.pumpAndSettle();
  await tester.enterText(find.byType(TextField).first, '08012345678');
  await tester.tap(find.text('Buy').first);
  await tester.pumpAndSettle();
}

void main() {
  test(
      'completion and archival are serialized without dropping the next pending identity',
      () async {
    final intent = DataPurchaseIntent(
        storage: MemoryIntentStorage(), accountId: () async => 'serial-owner');
    final old = await intent.keyForSubmission(
        network: 'MTN', phone: '08012345678', planCode: 'x', price: 100);
    await intent.retainForSeparatePurchase(old);
    final next = await intent.keyForSubmission(
        network: 'MTN', phone: '08012345678', planCode: 'x', price: 100);
    await Future.wait(
        [intent.finishRetained(old), intent.retainForSeparatePurchase(next)]);
    expect((await intent.retained()).single['key'], next);
    expect(await intent.pending(), isNull);
  });
  testWidgets(
      'pending same-plan DATA requires acknowledgement then submits once with a fresh key',
      (tester) async {
    tester.view.physicalSize = const Size(1000, 1500);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final intent = DataPurchaseIntent(
        storage: MemoryIntentStorage(), accountId: () async => 'owner');
    final old = await intent.keyForSubmission(
        network: 'MTN', phone: '08012345678', planCode: 'x', price: 100);
    final sent = <Map<String, dynamic>>[];
    await tester.pumpWidget(MaterialApp(
        home: DataScreen(
      purchaseIntent: intent,
      pendingContext: (_) async =>
          {'success': true, 'pendingCount': 1, 'matchingPendingCount': 1},
      loadBeneficiaries: () async => [],
      loadPlans: (_) async => {
        'success': true,
        'plans': [
          {'code': 'x', 'name': '1GB SME', 'price': 100}
        ]
      },
      purchase: (request) async {
        sent.add(request);
        return {
          'status': 'PENDING',
          'pending': true,
          'reference': 'DATA-new-independent'
        };
      },
    )));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField).first, '08012345678');
    expect(
        tester
            .widget<FilledButton>(
                find.widgetWithText(FilledButton, 'Buy').first)
            .onPressed,
        isNotNull);
    await tester.tap(find.text('Buy').first);
    await tester.pumpAndSettle();
    expect(find.textContaining('same number and plan'), findsOneWidget);
    expect(sent, isEmpty);
    expect((await intent.pending())!['key'], old);
    await tester.tap(find.text('I understand — new purchase'));
    await tester.tap(find.text('I understand — new purchase'),
        warnIfMissed: false);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Buy Data').last);
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField).last, '0000');
    await tester.tap(find.text('Confirm'));
    await tester.tap(find.text('Confirm'), warnIfMissed: false);
    await tester.pumpAndSettle();
    expect(sent, hasLength(1));
    expect(sent.single['idempotencyKey'], isNot(old));
    expect(sent.single['acknowledgePendingPurchase'], true);
    expect((await intent.retained()).single['key'], old);
    expect((await intent.pending())!['key'], sent.single['idempotencyKey']);
    expect(
        tester
            .widget<FilledButton>(
                find.widgetWithText(FilledButton, 'Buy').first)
            .onPressed,
        isNotNull);
    await tester.pumpWidget(const SizedBox());
  });

  testWidgets('canceling separate-charge consent keeps same-product active key',
      (tester) async {
    final storage = MemoryIntentStorage();
    final intent = DataPurchaseIntent(
        storage: storage, accountId: () async => 'cancel-consent');
    final old = await intent.keyForSubmission(
        network: 'MTN', phone: '08012345678', planCode: 'x', price: 100);
    final sent = <Map<String, dynamic>>[];
    await _pumpDataBuy(tester, intent, sent);
    await tester.tap(find.text('Cancel').last);
    await tester.pumpAndSettle();
    expect((await intent.pending())!['key'], old);
    expect(await intent.retained(), isEmpty);
    expect(sent, isEmpty);
    await tester.pumpWidget(const SizedBox());
  });

  testWidgets('canceling PIN after consent keeps same-product active key',
      (tester) async {
    final storage = MemoryIntentStorage();
    final intent = DataPurchaseIntent(
        storage: storage, accountId: () async => 'cancel-pin');
    final old = await intent.keyForSubmission(
        network: 'MTN', phone: '08012345678', planCode: 'x', price: 100);
    final sent = <Map<String, dynamic>>[];
    await _pumpDataBuy(tester, intent, sent);
    await tester.tap(find.text('I understand — new purchase'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Buy Data').last);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Cancel').last);
    await tester.pumpAndSettle();
    expect((await intent.pending())!['key'], old);
    expect(await intent.retained(), isEmpty);
    expect(sent, isEmpty);
    await tester.pumpWidget(const SizedBox());
  });

  testWidgets('archive failure after PIN preserves old key and sends nothing',
      (tester) async {
    final storage = MemoryIntentStorage();
    final intent = DataPurchaseIntent(
        storage: storage, accountId: () async => 'archive-fail');
    final old = await intent.keyForSubmission(
        network: 'MTN', phone: '08012345678', planCode: 'x', price: 100);
    final sent = <Map<String, dynamic>>[];
    await _pumpDataBuy(tester, intent, sent);
    await tester.tap(find.text('I understand — new purchase'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Buy Data').last);
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField).last, '0000');
    storage.failArchive = true;
    await tester.tap(find.text('Confirm'));
    await tester.pumpAndSettle();
    expect((await intent.pending())!['key'], old);
    expect(await intent.retained(), isEmpty);
    expect(sent, isEmpty);
    expect(find.textContaining('No new purchase was started'), findsOneWidget);
    await tester.pumpWidget(const SizedBox());
  });

  for (final service in ['DATA', 'AIRTIME']) {
    testWidgets(
        '$service warning cancellation cannot authorise or dispatch a purchase',
        (tester) async {
      bool? decision;
      await tester.pumpWidget(MaterialApp(
          home: Builder(
              builder: (context) => TextButton(
                  onPressed: () async {
                    decision = await acknowledgeNewBillPurchase(context,
                        load: (_) async => {
                              'success': true,
                              'pendingCount': 1,
                              'matchingPendingCount': 1
                            },
                        service: service,
                        phone: '08012345678',
                        network: 'MTN',
                        localPending: true);
                  },
                  child: const Text('New purchase')))));
      await tester.tap(find.text('New purchase'));
      await tester.pumpAndSettle();
      expect(find.textContaining('Both purchases could be delivered'),
          findsOneWidget);
      await tester.tap(find.text('Cancel'));
      await tester.pumpAndSettle();
      expect(decision, isNull);
    });
  }
}

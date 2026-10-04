import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:servicepay_app/data_screen.dart';
import 'package:servicepay_app/services/data_purchase_intent.dart';
import 'package:servicepay_app/widgets/purchase_processing.dart';

class MemoryIntent implements DataPurchaseIntentStorage {
  final entries = <String, String>{};
  @override
  Future<String?> read(String key) async => entries[key];
  @override
  Future<void> write(String key, String value) async {
    entries[key] = value;
  }

  @override
  Future<void> delete(String key) async {
    entries.remove(key);
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  for (final width in <double>[320, 360, 390]) {
    testWidgets(
        'processing stays visible after scrolling on ${width.toInt()}px mobile',
        (tester) async {
      tester.view.physicalSize = Size(width, 800);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final result = Completer<Map<String, dynamic>>();
      int submits = 0;
      await tester.pumpWidget(MaterialApp(
          home: DataScreen(
        loadBeneficiaries: () async => [],
        purchaseIntent: DataPurchaseIntent(
            storage: MemoryIntent(), accountId: () async => 'mobile-test'),
        loadPlans: (_) async => {
          'success': true,
          'plans': List.generate(
              15,
              (index) => {
                    'code': 'DATA-MTN-$index',
                    'name': '1GB SME $index',
                    'price': 100
                  }),
        },
        purchase: (_) {
          submits++;
          return result.future;
        },
      )));
      await tester.pumpAndSettle();
      await tester.enterText(find.byType(TextField).first, '08012345678');
      await tester.drag(find.byType(CustomScrollView), const Offset(0, -420));
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.text('Buy').first);
      await tester.tap(find.text('Buy').first);
      await tester.pumpAndSettle();
      await tester.tap(find.text('Buy Data').last);
      await tester.pumpAndSettle();
      await tester.enterText(find.byType(TextField).last, '0000');
      await tester.tap(find.text('Confirm'));
      await tester.tap(find.text('Confirm'), warnIfMissed: false);
      await tester.pump();
      expect(
          tester
              .widget<PurchaseProcessing>(find.byType(PurchaseProcessing))
              .processing,
          isTrue);
      await tester.pump(const Duration(milliseconds: 200));
      final bounds =
          tester.getRect(find.text('Processing your data purchase...'));
      expect(bounds.top, greaterThanOrEqualTo(0));
      expect(bounds.bottom, lessThan(800));
      expect(bounds.left, greaterThanOrEqualTo(0));
      expect(bounds.right, lessThanOrEqualTo(width));
      expect(submits, 1);
      await tester.pump(const Duration(seconds: 2));
      expect(find.text('Processing your data purchase...'), findsOneWidget);
      expect(submits, 1);
      result.complete({
        'success': true,
        'status': 'SUCCESSFUL',
        'reference': 'DATA-mobile-proof',
        'amount': 100
      });
      await tester.pump();
      await tester.pumpAndSettle();
      expect(find.text('Processing your data purchase...'), findsNothing);
      expect(find.text('Data Purchase Successful'), findsOneWidget);
      expect(submits, 1);
      expect(tester.takeException(), isNull);
    });
  }
  for (final finalStatus in ['SUCCESSFUL', 'FAILED', 'PENDING', 'UNKNOWN']) {
    testWidgets('PIN immediately processes once then renders $finalStatus',
        (tester) async {
      tester.view.physicalSize = const Size(1000, 1200);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final storage = MemoryIntent();
      final intent = DataPurchaseIntent(
          storage: storage, accountId: () async => 'test-customer');
      final result = Completer<Map<String, dynamic>>();
      int submits = 0;
      String? submittedKey;
      await tester.pumpWidget(MaterialApp(
          home: DataScreen(
        loadBeneficiaries: () async => [],
        purchaseIntent: intent,
        loadPlans: (_) async => {
          'success': true,
          'plans': [
            {'code': 'DATA-MTN-test', 'name': '1GB SME', 'price': 100},
          ]
        },
        purchase: (request) {
          submittedKey = request['idempotencyKey'] as String;
          submits++;
          return result.future;
        },
      )));
      await tester.pumpAndSettle();
      await tester.enterText(find.byType(TextField).first, '08012345678');
      await tester.tap(find.text('Buy').first);
      await tester.pumpAndSettle();
      await tester.tap(find.text('Buy Data').last);
      await tester.pumpAndSettle();
      final confirmedKey = storage.entries.values.single;
      expect(confirmedKey, contains('"submitted":false'));
      await tester.enterText(find.byType(TextField).last, '0000');
      await tester.tap(find.text('Confirm'));
      await tester.tap(find.text('Confirm'), warnIfMissed: false);
      await tester.pump();
      expect(
          tester
              .widget<PurchaseProcessing>(find.byType(PurchaseProcessing))
              .processing,
          isTrue,
          reason:
              'progress is enabled on the first frame, before the API completes');
      await tester.pump(const Duration(milliseconds: 400));
      expect(submits, 1);
      expect(confirmedKey, contains(submittedKey!));
      expect(find.text('Processing your data purchase...'), findsOneWidget);
      final progressBounds =
          tester.getRect(find.text('Processing your data purchase...'));
      expect(progressBounds.top, greaterThanOrEqualTo(0));
      expect(progressBounds.bottom, lessThanOrEqualTo(1200));
      expect(find.text('Data Purchase Successful'), findsNothing);
      final phoneField = tester.widget<TextField>(find.byType(TextField).first);
      expect(phoneField.enabled, true,
          reason: 'processing does not disable the next beneficiary input');
      expect(await tester.binding.handlePopRoute(), true);
      await tester.pump();
      expect(find.byType(DataScreen), findsOneWidget);
      result.complete({
        'success': finalStatus != 'FAILED',
        'status': finalStatus,
        'reference': 'DATA-proof',
        'amount': 100,
        'dispatchStatus': finalStatus == 'FAILED' ? 'REFUNDED' : 'UNKNOWN',
        'message': finalStatus == 'FAILED'
            ? 'Provider rejected the purchase; refund confirmed.'
            : 'Result',
      });
      await tester.pumpAndSettle();
      expect(find.text('Processing your data purchase...'), findsNothing);
      expect(submits, 1);
      expect(find.text('Data Purchase Successful'),
          finalStatus == 'SUCCESSFUL' ? findsOneWidget : findsNothing);
      expect(storage.entries.isEmpty,
          finalStatus == 'SUCCESSFUL' || finalStatus == 'FAILED');
      if (finalStatus == 'PENDING' || finalStatus == 'UNKNOWN') {
        await tester.pumpWidget(const SizedBox());
        await tester.pumpWidget(MaterialApp(
            home: DataScreen(
          loadBeneficiaries: () async => [],
          purchaseIntent: DataPurchaseIntent(
              storage: storage, accountId: () async => 'test-customer'),
          loadPlans: (_) async => {'success': true, 'plans': []},
          purchase: (_) async {
            submits++;
            return {};
          },
          statusQuery: (_) async =>
              {'success': true, 'status': 'PENDING', 'reference': 'DATA-proof'},
        )));
        await tester.pumpAndSettle();
        expect(find.textContaining('Transaction Pending'), findsOneWidget);
        await tester.tap(find.text('Check existing request'));
        await tester.pumpAndSettle();
        expect(submits, 1,
            reason: 'reopening and checking status never purchases again');
        expect(storage.entries, isNotEmpty);
      }
    });
  }
  test('acceptance, a missing reference and unknown failure are not delivery',
      () {
    expect(purchaseOutcome({'success': true, 'status': 'PENDING'}),
        PurchasePhase.pending);
    expect(purchaseOutcome({'success': true, 'status': 'SUCCESSFUL'}),
        PurchasePhase.pending);
    expect(purchaseOutcome({'success': false, 'httpStatus': 500}),
        PurchasePhase.pending);
    expect(purchaseOutcome({'success': false, 'httpStatus': 400}),
        PurchasePhase.failed);
  });
}

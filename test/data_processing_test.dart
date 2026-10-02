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
        purchase: (_) {
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
      await tester.enterText(find.byType(TextField).last, '0000');
      await tester.tap(find.text('Confirm'));
      await tester.tap(find.text('Confirm'), warnIfMissed: false);
      await tester.pump(const Duration(milliseconds: 400));
      expect(submits, 1);
      expect(find.text('Processing your data purchase...'), findsOneWidget);
      expect(find.text('Data Purchase Successful'), findsNothing);
      expect(find.byType(ModalBarrier), findsWidgets);
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

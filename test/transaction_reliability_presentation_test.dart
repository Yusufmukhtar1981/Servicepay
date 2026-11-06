import 'package:flutter_test/flutter_test.dart';
import 'package:servicepay_app/transaction_presentation.dart';

void main() {
  test('canonical bill labels do not rewrite financial filters', () {
    for (final service in ['DATA', 'AIRTIME', 'ELECTRICITY']) {
      for (final item in {
        'CREATED': 'PROCESSING',
        'PROCESSING': 'PROCESSING',
        'PENDING_VERIFICATION': 'AWAITING CONFIRMATION',
        'MANUAL_REVIEW': 'UNDER REVIEW',
        'REFUNDED': 'REFUNDED',
      }.entries) {
        final tx = TransactionPresentation({
          'serviceType': service, 'status': 'PENDING',
          'lifecycleState': item.key,
        });
        expect(tx.status, 'PENDING');
        expect(tx.statusLabel, item.value);
      }
    }
  });
}

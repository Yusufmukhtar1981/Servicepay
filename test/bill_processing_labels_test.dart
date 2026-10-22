import 'package:flutter_test/flutter_test.dart';
import 'package:servicepay_app/transaction_presentation.dart';

void main() {
  test('bill verification label does not change financial status or polling',
      () {
    const view = TransactionPresentation({
      'serviceType': 'DATA',
      'status': 'PENDING',
      'processingStatus': 'PENDING_VERIFICATION',
    });
    expect(view.statusLabel, 'PENDING VERIFICATION');
    expect(view.status, 'PENDING');
  });
  test('terminal financial status cannot be overridden by stale recovery state',
      () {
    for (final status in ['SUCCESSFUL', 'FAILED', 'REFUNDED']) {
      final view = TransactionPresentation({
        'serviceType': 'AIRTIME',
        'status': status,
        'processingStatus': 'PENDING_VERIFICATION',
      });
      expect(view.statusLabel, view.status);
    }
  });
  test('older releases and other services retain their existing labels', () {
    const view = TransactionPresentation({
      'serviceType': 'ELECTRICITY',
      'status': 'PENDING',
      'processingStatus': 'PENDING_VERIFICATION',
    });
    expect(view.statusLabel, 'PENDING');
  });
}

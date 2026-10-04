import 'package:flutter_test/flutter_test.dart';
import '../lib/services/electricity_payment_result.dart';

void main() {
  test('only a terminal transaction status releases Electricity recovery', () {
    for (final status in ['SUCCESSFUL', 'success', ' SUCCESSFUL ']) {
      expect(electricityPaymentStatus({'status': status}), 'SUCCESSFUL');
    }
    expect(electricityPaymentStatus({'status': 'FAILED'}), 'FAILED');
    for (final result in [
      <String, dynamic>{'success': true},
      <String, dynamic>{'status': 200},
      <String, dynamic>{'status': true},
      <String, dynamic>{'status': 'UNKNOWN'},
      <String, dynamic>{'status': 'processing'},
    ]) {
      expect(electricityPaymentStatus(result), 'PENDING');
    }
    expect(electricityPaymentStatus({'status': 'SUCCESSFUL'}, pending: true),
        'PENDING');
  });
  test('status refresh accepts numeric amount strings without inventing values',
      () {
    expect(electricityPaymentAmount({'amount': '5000'}), 5000);
    expect(electricityPaymentAmount({'amount': 5000}), 5000);
    for (final value in [null, 'NaN', 'Infinity', 0, -1, 'unavailable']) {
      expect(() => electricityPaymentAmount({'amount': value}),
          throwsFormatException);
    }
  });
}

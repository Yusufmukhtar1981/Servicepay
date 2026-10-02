import 'package:flutter_test/flutter_test.dart';
import '../lib/transaction_presentation.dart';

void main() {
  test('Electricity history retains token, units, account and references', () {
    final row = TransactionPresentation({
      'serviceType': 'ELECTRICITY', 'status': 'SUCCESSFUL', 'reference': 'ELC-unit-history',
      'providerResponse': {'electricity': {
        'customerName': 'Unit account', 'meterNumber': '62130123456',
        'electricityCompany': 'Unit DISCO', 'meterType': 'prepaid',
        'meterToken': '1234 5678 9012 3456 7890', 'units': '12.34',
        'providerReference': 'unit-provider-reference',
      }},
    });
    final details = Map.fromEntries(row.details);
    expect(details['Token'], '1234 5678 9012 3456 7890');
    expect(details['Units'], '12.34');
    expect(details['Meter number'], '62130123456');
    expect(details['Provider reference'], 'unit-provider-reference');
    expect(row.reference, 'ELC-unit-history');
  });
}
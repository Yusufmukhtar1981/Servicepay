import 'package:flutter_test/flutter_test.dart';
import 'package:flutter/material.dart';
import '../lib/transaction_presentation.dart';
import '../lib/receipt_screen.dart';

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
  final normalized = {
    'id': 'transaction:unit-id',
    'transactionId': 'unit-id',
    'source': 'TRANSACTION',
    'type': 'Electricity',
    'status': 'SUCCESSFUL',
    'reference': 'ELC-normalized-history',
    'amount': 2000,
    'metadata': {
      'serviceType': 'ELECTRICITY',
      'providerResponse': {
        'electricity': {
          'customerName': 'Unit account',
          'meterNumber': '62130123456',
          'electricityCompany': 'Unit DISCO',
          'meterType': 'prepaid',
          'meterToken': '1234 5678 9012 3456 7890',
          'units': '',
          'providerReference': 'ELC-normalized-history',
        },
      },
    },
  };
  test('normalized API history exposes actual token without inventing units', () {
    final row = TransactionPresentation(normalized);
    final details = Map<String, String>.fromEntries(row.details);
    expect(details['Token'], '1234 5678 9012 3456 7890');
    expect(details['Meter number'], '62130123456');
    expect(details['DISCO'], 'Unit DISCO');
    expect(details['Customer'], 'Unit account');
    expect(details['Units'], isNull);
    expect(details['Provider reference'], 'ELC-normalized-history');
    expect(row.lookupId, 'transaction:unit-id');
  });
  test('non-Electricity history does not display embedded electricity fields', () {
    final row = TransactionPresentation({
      ...normalized,
      'type': 'Data',
      'metadata': {
        ...(normalized['metadata'] as Map),
        'serviceType': 'DATA',
      },
    });
    expect(Map.fromEntries(row.details).containsKey('Token'), isFalse);
  });
  testWidgets('history receipt visibly renders the persisted prepaid token',
      (tester) async {
    final row = TransactionPresentation(normalized);
    await tester.pumpWidget(MaterialApp(
      home: ReceiptScreen(
        serviceName: row.title,
        amount: '₦2000.00',
        status: row.status,
        reference: row.reference,
        date: 'Unit test date',
        details: Map<String, String>.fromEntries(row.details),
      ),
    ));
    await tester.pumpAndSettle();
    await tester.scrollUntilVisible(
      find.text('1234 5678 9012 3456 7890'),
      200,
    );
    expect(find.text('Token'), findsOneWidget);
    expect(find.text('1234 5678 9012 3456 7890'), findsOneWidget);
    expect(find.text('Units'), findsNothing);
  });
  testWidgets('Electricity receipt still hides authentication credentials',
      (tester) async {
    await tester.pumpWidget(const MaterialApp(
      home: ReceiptScreen(
        serviceName: 'Electricity',
        amount: '2000.00',
        status: 'SUCCESSFUL',
        reference: 'ELC-unit-privacy',
        date: 'Unit test date',
        details: {
          'Token': 'eyJhbGciOiJIUzI1NiJ9.unit.signature',
          'Access token': '12345678901234567890',
          'Transaction PIN': '1234',
          'Password': 'must-not-appear',
          'Authorization': 'Bearer must-not-appear',
          'Secret': 'must-not-appear',
          'Meter number': '62130123456',
        },
      ),
    ));
    await tester.pumpAndSettle();
    for (final text in [
      'eyJhbGciOiJIUzI1NiJ9.unit.signature',
      '12345678901234567890',
      '1234',
      'must-not-appear',
      'Bearer must-not-appear',
    ]) {
      expect(find.text(text), findsNothing);
    }
    expect(find.text('62130123456'), findsOneWidget);
  });
}
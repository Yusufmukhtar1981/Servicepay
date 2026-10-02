import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import '../lib/receipt_screen.dart';
import '../lib/transaction_presentation.dart';
import '../lib/customer_receipt_privacy.dart';
import '../lib/airtime_screen.dart';

void main() {
  test('public delivery state retains Airtime terminal and retry safety', () {
    final intent = AirtimePurchaseIntent();
    final delivered = <String, dynamic>{
      'deliveryStatus': 'SUCCEEDED',
      'status': 'SUCCESSFUL',
      'httpStatus': 200,
      'reference': 'SP-unit',
    };
    expect(intent.isTerminalResult(delivered), isTrue);
    expect(intent.isDeliveredAccountingPending(delivered), isFalse);
    expect(
        intent.isTerminalResult({
          ...delivered,
          'deliveryStatus': 'UNKNOWN',
          'status': 'PENDING',
        }),
        isFalse);
  });
  for (final service in [
    'Data',
    'Airtime',
    'Electricity',
    'Cable TV',
    'Transfer'
  ]) {
    for (final status in ['SUCCESSFUL', 'FAILED', 'PENDING']) {
      testWidgets(
          '$service $status receipt hides upstream details and uses official logo',
          (tester) async {
        await tester.pumpWidget(MaterialApp(
            home: ReceiptScreen(
          serviceName: service,
          amount: '2000.00',
          reference: 'SP-unit-public',
          date: 'Unit date',
          status: status,
          details: const {
            'Recipient': 'Unit recipient',
            'Provider': 'TELECOM_ABODE',
            'Provider reference': 'private-upstream',
            'API information': 'private-api',
            'Routing': 'private-route',
            'Narration': 'Telecom Abode delivery',
          },
        )));
        await tester.pumpAndSettle();
        expect(find.text('Unit recipient'), findsOneWidget);
        expect(find.text('ServicePay delivery'), findsOneWidget);
        expect(find.text('TELECOM_ABODE'), findsNothing);
        expect(find.text('private-upstream'), findsNothing);
        expect(find.text('private-api'), findsNothing);
        expect(find.text('private-route'), findsNothing);
        final image = tester.widget<Image>(find.byType(Image).first);
        expect((image.image as AssetImage).assetName,
            'assets/image/servicepay_logo.png');
      });
    }
  }
  test(
      'sanitized normalized history keeps fulfillment and not provider details',
      () {
    final row = TransactionPresentation({
      'type': 'Electricity',
      'reference': 'SP-unit',
      'status': 'SUCCESSFUL',
      'metadata': {
        'serviceType': 'ELECTRICITY',
        'fulfillment': {
          'meterNumber': '62130123456',
          'meterToken': '1234-5678-9012-3456-7890',
          'customerName': 'Unit customer',
          'electricityCompany': 'Kano Electric',
          'meterType': 'prepaid',
          'units': '12.5',
        }
      },
    });
    final details = Map.fromEntries(row.details);
    expect(details['Token'], '1234-5678-9012-3456-7890');
    expect(details['Units'], '12.5');
    expect(details['Customer'], 'Unit customer');
    expect(details.containsKey('Provider'), isFalse);
    expect(details.containsKey('Provider reference'), isFalse);
  });
  test(
      'Cable claim code and serial survive, privacy filtering is shared by exports',
      () {
    final details = Map.fromEntries(TransactionPresentation({
      'type': 'Cable TV',
      'fulfillment': {
        'voucherCode': 'claim-code',
        'serialNumber': 'serial',
        'smartcardNumber': '1234567890',
        'cableCompany': 'DStv',
        'packageName': 'Unit package'
      },
    }).details);
    expect(details['Activation code'], 'claim-code');
    expect(details['Voucher serial'], 'serial');
    expect(details['TV service'], 'DStv');
    expect(isPrivateReceiptLabel('Provider response'), isTrue);
    expect(customerReceiptText('Clubkonnect purchase'), 'ServicePay purchase');
  });
}

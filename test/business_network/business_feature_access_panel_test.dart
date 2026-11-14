import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:servicepay_app/business_network/business_feature_access_panel.dart';

void main() {
  testWidgets('availability states stay honest and history remains readable',
      (tester) async {
    await tester.pumpWidget(const MaterialApp(
      home: Scaffold(
        body: BusinessFeatureAccessPanel(
          title: 'Service availability',
          kind: 'AGENT',
          featureAccess: [
            {
              'key': 'data',
              'label': 'Data',
              'ready': true,
              'categories': {'AGENT': 'ENABLED'},
            },
            {
              'key': 'directory',
              'label': 'Customer directory',
              'ready': false,
              'history': true,
              'categories': {
                'AGENT': {
                  'state': 'MAINTENANCE',
                  'reason': 'Paused for review'
                },
              },
            },
            {
              'key': 'vouchers',
              'label': 'Voucher PINs',
              'ready': false,
              'categories': {'AGENT': 'COMING_SOON'},
            },
            {
              'key': 'electricity',
              'label': 'Electricity',
              'ready': true,
              'categories': {'CUSTOMER': 'ENABLED'},
            },
          ],
        ),
      ),
    ));

    expect(find.text('Available'), findsOneWidget);
    expect(find.text('Maintenance'), findsOneWidget);
    expect(find.text('Coming soon'), findsOneWidget);
    expect(find.text('Not confirmed for AGENT'), findsOneWidget);
    expect(find.text('Paused for review'), findsOneWidget);
    expect(find.text('Existing history remains accessible.'), findsOneWidget);
  });
}

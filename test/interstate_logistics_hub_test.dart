import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:servicepay_app/interstate_logistics_screen.dart';
import 'package:servicepay_app/servicepay_theme.dart';

void main() {
  testWidgets('logistics hub exposes the customer interstate entry points',
      (WidgetTester tester) async {
    await tester.pumpWidget(
      MaterialApp(
        theme: ServicePayTheme.light(),
        home: const InterstateLogisticsHub(),
      ),
    );

    expect(find.text('Send Interstate Parcel'), findsOneWidget);
    expect(find.text('Track Parcel'), findsOneWidget);
    expect(find.text('My Shipments'), findsOneWidget);
  });

  testWidgets('logistics hub opens the interstate wizard',
      (WidgetTester tester) async {
    await tester.pumpWidget(
      MaterialApp(
        theme: ServicePayTheme.light(),
        home: const InterstateLogisticsHub(),
      ),
    );

    await tester.tap(find.text('Send Interstate Parcel'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 350));

    expect(find.byType(InterstateShipmentWizard), findsOneWidget);
    expect(find.byType(AppBar), findsOneWidget);
  });

  testWidgets('route states are chosen before an unsupported pair is shown',
      (WidgetTester tester) async {
    await tester.pumpWidget(MaterialApp(
      theme: ServicePayTheme.light(),
      home: InterstateShipmentWizard(
        routesLoader: () async => <Map<String, dynamic>>[
          <String, dynamic>{
            'id': 'kano-abuja',
            'originState': 'KANO',
            'destinationState': 'ABUJA',
          },
          <String, dynamic>{
            'id': 'abuja-kano',
            'originState': 'ABUJA',
            'destinationState': 'KANO',
          },
          <String, dynamic>{
            'id': 'kano-lagos',
            'originState': 'KANO',
            'destinationState': 'LAGOS',
          },
          <String, dynamic>{
            'id': 'kano-kano-branches',
            'originState': 'KANO',
            'destinationState': 'KANO',
          },
        ],
      ),
    ));
    await tester.pump();

    expect(find.byKey(const Key('interstate-unsupported-route')), findsNothing);
    await tester.tap(find.byKey(const Key('interstate-pickup-state')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('KANO').last);
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('interstate-destination-state')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('ABUJA').last);
    await tester.pumpAndSettle();
    expect(find.text('KANO → ABUJA'), findsOneWidget);

    await tester.tap(find.byKey(const Key('interstate-pickup-state')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('ABUJA').last);
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('interstate-destination-state')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('LAGOS').last);
    await tester.pumpAndSettle();
    expect(
        find.byKey(const Key('interstate-unsupported-route')), findsOneWidget);
  });

  testWidgets(
      'empty active configuration is not presented as an unsupported pair',
      (WidgetTester tester) async {
    await tester.pumpWidget(MaterialApp(
      theme: ServicePayTheme.light(),
      home: InterstateShipmentWizard(
          routesLoader: () async => <Map<String, dynamic>>[]),
    ));
    await tester.pump();

    expect(find.text('No active interstate routes are configured right now.'),
        findsOneWidget);
    expect(find.byKey(const Key('interstate-unsupported-route')), findsNothing);
  });

  testWidgets('same-state-pair routes retain backend names and delivery times',
      (WidgetTester tester) async {
    await tester.pumpWidget(MaterialApp(
      theme: ServicePayTheme.light(),
      home: InterstateShipmentWizard(
        routesLoader: () async => <Map<String, dynamic>>[
          <String, dynamic>{
            'id': 'kano-abuja-central',
            'name': 'Kano Central to Abuja Main',
            'originState': 'KANO',
            'destinationState': 'ABUJA',
            'standardDeliveryTime': '1–2 business days',
          },
          <String, dynamic>{
            'id': 'kano-abuja-east',
            'name': 'Kano East to Abuja Garki',
            'originState': 'KANO',
            'destinationState': 'ABUJA',
            'standardDeliveryTime': '2–3 business days',
          },
        ],
      ),
    ));
    await tester.pump();

    await tester.tap(find.byKey(const Key('interstate-pickup-state')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('KANO').last);
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('interstate-destination-state')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('ABUJA').last);
    await tester.pumpAndSettle();

    expect(find.text('Kano Central to Abuja Main'), findsOneWidget);
    expect(find.text('1–2 business days'), findsOneWidget);
    expect(find.text('Kano East to Abuja Garki'), findsOneWidget);
    expect(find.text('2–3 business days'), findsOneWidget);
  });

  testWidgets(
      'complete customer flow preserves directed route through quote, review, create and payment',
      (WidgetTester tester) async {
    await tester.binding.setSurfaceSize(const Size(1000, 1100));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    final List<Map<String, dynamic>> requests = <Map<String, dynamic>>[];
    await tester.pumpWidget(MaterialApp(
      theme: ServicePayTheme.light(),
      home: InterstateShipmentWizard(
        routesLoader: () async => <Map<String, dynamic>>[
          <String, dynamic>{
            'id': 'kano-abuja',
            'name': 'Kano Central to Abuja Main',
            'originState': 'KANO',
            'destinationState': 'ABUJA',
            'standardDeliveryTime': '2–3 business days',
            'expressEnabled': true,
          },
        ],
        transactionPinLoader: () async => '1234',
        postRequest: (String path, Map<String, dynamic> body,
            {String? idempotencyKey}) async {
          requests.add(<String, dynamic>{
            'path': path,
            'body': body,
            'idempotencyKey': idempotencyKey,
          });
          if (path == '/quote') {
            return <String, dynamic>{
              'success': true,
              'quote': <String, dynamic>{
                'quoteId': 'quote-1',
                'version': 'route-v1',
                'expiresAt': DateTime.now()
                    .add(const Duration(minutes: 10))
                    .toIso8601String(),
                'total': 7800,
                'expectedDelivery': '2–3 business days',
              },
            };
          }
          if (path == '/shipments') {
            return <String, dynamic>{
              'success': true,
              'shipment': <String, dynamic>{'_id': 'shipment-1'},
            };
          }
          return <String, dynamic>{
            'success': true,
            'shipment': <String, dynamic>{
              '_id': 'shipment-1',
              'trackingNumber': 'SPX-TEST-1',
              'status': 'PAID',
            },
          };
        },
      ),
    ));
    await tester.pump();

    await tester.tap(find.byKey(const Key('interstate-pickup-state')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('KANO').last);
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('interstate-destination-state')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('ABUJA').last);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Kano Central to Abuja Main'));
    await tester.tap(find.text('Continue'));
    await tester.pumpAndSettle();

    for (final MapEntry<String, String> field in <String, String>{
      'Sender name': 'Yusuf Sender',
      'Sender phone': '08012345678',
      'Pickup LGA': 'Nassarawa',
      'Pickup address': 'Kano pickup address',
      'Receiver full name': 'Abuja Receiver',
      'Receiver phone': '08087654321',
      'Destination LGA': 'Garki',
      'Full delivery address': 'Abuja delivery address',
    }.entries) {
      await tester.enterText(
          find.widgetWithText(TextFormField, field.key), field.value);
    }
    await tester.tap(find.text('Continue'));
    await tester.pumpAndSettle();

    for (final MapEntry<String, String> field in <String, String>{
      'Parcel description': 'Sealed business documents',
      'Quantity': '1',
      'Declared value (₦)': '25000',
      'Weight (KG)': '2.5',
      'Length': '40',
      'Width': '25',
      'Height': '10',
    }.entries) {
      await tester.enterText(
          find.widgetWithText(TextFormField, field.key), field.value);
    }
    await tester.tap(find.text(
        'I confirm this parcel contains no prohibited, illegal or dangerous goods.'));
    await tester.tap(find.text('Continue'));
    await tester.pumpAndSettle();

    await tester.tap(find.text('Get live quote'));
    await tester.pumpAndSettle();
    expect(find.text('Price review'), findsOneWidget);
    await tester.tap(find.text('Continue'));
    await tester.pumpAndSettle();
    expect(find.text('PIN & payment'), findsOneWidget);
    await tester.tap(find.text('Pay securely'));
    await tester.pumpAndSettle();

    expect(find.text('Shipment paid successfully'), findsOneWidget);
    expect(find.text('SPX-TEST-1'), findsOneWidget);
    expect(requests.map((request) => request['path']),
        <String>['/quote', '/shipments', '/shipments/shipment-1/pay']);
    expect(requests.first['body']['routeId'], 'kano-abuja');
    expect(requests.first['body']['originState'], 'KANO');
    expect(requests.first['body']['destinationState'], 'ABUJA');
    expect(requests[1]['body']['quoteId'], 'quote-1');
    expect(requests[1]['body']['quoteVersion'], 'route-v1');
    expect(requests[2]['body']['transactionPin'], '1234');
    expect(requests[2]['idempotencyKey'], isNotEmpty);
    expect(
        requests[2]['body']['idempotencyKey'], requests[2]['idempotencyKey']);
  });
}

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:servicepay_app/rider/rider_main_navigation.dart';

void main() {
  testWidgets(
    'rider details show pickup, receiver, route, and delivery note',
    (WidgetTester tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: RiderDeliveryDetailsPage(
            delivery: <String, dynamic>{
              'trackingNumber': 'SP-DELIVERY-TEST',
              'status': 'ASSIGNED',
              'senderName': 'Pickup Customer',
              'senderPhone': '08030000001',
              'pickupAddress': '12 Pickup Road, Kano',
              'receiverName': 'Receiver Customer',
              'receiverPhone': '08030000002',
              'deliveryAddress': '7 Receiver Close, Kano',
              'packageName': 'Delivery item',
              'packageDescription': 'Handle with care.',
              'deliveryFee': 1500,
              'customerId': <String, dynamic>{
                'fullName': 'Account Profile Name',
                'phone': '08039999999',
              },
            },
          ),
        ),
      );

      expect(find.text('Pickup Name'), findsOneWidget);
      expect(find.text('Pickup Customer'), findsOneWidget);
      expect(find.text('Pickup Phone'), findsOneWidget);
      expect(find.text('08030000001'), findsOneWidget);
      expect(find.text('12 Pickup Road, Kano'), findsOneWidget);
      expect(find.text('Receiver Customer'), findsOneWidget);
      expect(find.text('08030000002'), findsOneWidget);
      expect(find.text('7 Receiver Close, Kano'), findsOneWidget);

      await tester.drag(
        find.byType(ListView),
        const Offset(0, -600),
      );
      await tester.pumpAndSettle();

      expect(find.text('Handle with care.'), findsOneWidget);
      expect(find.text('₦1500'), findsOneWidget);
    },
  );
}
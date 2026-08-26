import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:servicepay_app/create_delivery_screen.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues(<String, Object>{});
  });

  testWidgets(
    'shows the simplified fixed-fee delivery request form',
    (WidgetTester tester) async {
      await tester.pumpWidget(
        const MaterialApp(
          home: CreateDeliveryScreen(),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.text('Create Delivery Request'), findsOneWidget);
      expect(find.text('Use my profile details'), findsOneWidget);
      expect(find.text('Pickup Name'), findsOneWidget);
      expect(find.text('Pickup Phone Number'), findsOneWidget);
      expect(find.text('Pickup Address'), findsOneWidget);
      expect(find.text('Receiver Name'), findsOneWidget);
      expect(find.text('Receiver Phone'), findsOneWidget);
      expect(find.text('Receiver Address'), findsOneWidget);
      expect(
        find.text('Delivery Note / Item Description'),
        findsOneWidget,
      );
      expect(find.text('Delivery Fee'), findsOneWidget);
      expect(find.text('₦1,500'), findsOneWidget);
      expect(find.text('Request Delivery'), findsOneWidget);

      expect(find.text('Pickup State'), findsNothing);
      expect(find.text('Destination State'), findsNothing);
      expect(find.text('Package Name'), findsNothing);
      expect(find.text('Package Weight in KG'), findsNothing);
    },
  );

  testWidgets(
    'profile details autofill pickup fields and remain editable',
    (WidgetTester tester) async {
      SharedPreferences.setMockInitialValues(<String, Object>{
        'user_name': 'Profile Customer',
        'user_phone': '08030000003',
        'user_address': '5 Profile Street, Kano',
      });

      await tester.pumpWidget(
        const MaterialApp(
          home: CreateDeliveryScreen(),
        ),
      );
      await tester.pumpAndSettle();

      await tester.tap(find.text('Use my profile details'));
      await tester.pump();

      expect(find.text('Profile Customer'), findsOneWidget);
      expect(find.text('08030000003'), findsOneWidget);
      expect(find.text('5 Profile Street, Kano'), findsOneWidget);

      final Finder pickupName =
          find.widgetWithText(TextFormField, 'Pickup Name');
      await tester.enterText(
        pickupName,
        'Edited Pickup Customer',
      );

      expect(find.text('Edited Pickup Customer'), findsOneWidget);
    },
  );
}
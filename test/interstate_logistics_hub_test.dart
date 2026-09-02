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
}

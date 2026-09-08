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
}

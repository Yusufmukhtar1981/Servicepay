import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:servicepay_app/trust/trust_dashboard_entry.dart';

void main() {
  testWidgets('opens the existing Trust search screen from the dashboard',
      (WidgetTester tester) async {
    await tester.pumpWidget(
      const MaterialApp(home: Scaffold(body: TrustDashboardEntry())),
    );

    final Finder trustEntry = find.text('ServicePay Trust');
    expect(trustEntry, findsOneWidget);
    expect(find.text('Verify Before You Pay'), findsOneWidget);

    await tester.tap(trustEntry);
    await tester.pumpAndSettle();

    expect(find.text('Search by phone, Trust ID, or business name'),
        findsOneWidget);
  });
}

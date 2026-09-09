import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:servicepay_app/help_support_screen.dart';
import 'package:servicepay_app/services/support_api_service.dart';

void main() {
  testWidgets('help center shows official contact and safety guidance',
      (WidgetTester tester) async {
    await tester.pumpWidget(
      const MaterialApp(home: HelpSupportScreen()),
    );
    expect(find.textContaining('09136151515'), findsOneWidget);
    expect(find.text('Choose an issue'), findsOneWidget);
    expect(find.text('Transaction Issues'), findsOneWidget);
    expect(find.text('Search FAQs'), findsOneWidget);
    expect(find.textContaining('will never ask'), findsOneWidget);
  });

  testWidgets('support request pre-fills trusted transaction context',
      (WidgetTester tester) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: SupportRequestScreen(
          initialCategory: 'TRANSACTION',
          initialSubject: 'Issue with Data',
          transactionLookupId: 'transaction:123',
          transactionSummary:
              'Data\nReference: DATA-100\nAmount: ₦500.00\nStatus: PENDING',
        ),
      ),
    );
    expect(find.text('Issue with Data'), findsOneWidget);
    expect(find.textContaining('Reference: DATA-100'), findsOneWidget);
    expect(find.text('Submit ticket'), findsOneWidget);
  });

  test('support status labels preserve backend values', () {
    expect(
      SupportTicket(<String, dynamic>{'status': 'IN_PROGRESS'}).statusLabel,
      'IN REVIEW',
    );
    expect(
      SupportTicket(
        <String, dynamic>{'status': 'WAITING_ON_CUSTOMER'},
      ).statusLabel,
      'AWAITING CUSTOMER',
    );
  });
}

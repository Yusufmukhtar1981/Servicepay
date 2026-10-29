import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:servicepay_app/ai_support_screen.dart';
import 'package:servicepay_app/services/support_api_service.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('customer ticket label maps waiting-for-customer safely', () {
    expect(
      SupportTicket(<String, dynamic>{'status': 'WAITING_FOR_CUSTOMER'})
          .statusLabel,
      'WAITING FOR YOU',
    );
    expect(
      SupportTicket(<String, dynamic>{'status': 'WAITING_ON_CUSTOMER'})
          .statusLabel,
      'WAITING FOR YOU',
    );
  });

  testWidgets('support screen discloses AI, safety and language fallbacks',
      (tester) async {
    SharedPreferences.setMockInitialValues(<String, Object>{});
    await tester.pumpWidget(
      const MaterialApp(home: AiSupportScreen()),
    );
    await tester.pumpAndSettle();

    expect(find.textContaining('AI assistant'), findsOneWidget);
    expect(find.textContaining('password, transaction PIN, or OTP'),
        findsOneWidget);
    expect(find.textContaining('Hausa text support remains available'),
        findsOneWidget);
    expect(find.byKey(const Key('ai-support-select-record')), findsOneWidget);
    expect(find.textContaining('Transaction ID'), findsNothing);
    expect(find.text('Auto'), findsOneWidget);
    await tester.tap(find.byType(DropdownButton<String>));
    await tester.pumpAndSettle();
    expect(find.text('English'), findsOneWidget);
    expect(find.text('Hausa'), findsOneWidget);
    expect(find.text('My support tickets'), findsNothing);
    expect(find.byTooltip('My support tickets'), findsOneWidget);
  });
}

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:servicepay_app/reset_transaction_pin_screen.dart';

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({'auth_token': 'token'}));

  Future<void> pumpScreen(WidgetTester tester, {http.Client? client}) async {
    await tester.pumpWidget(
      MaterialApp(
        home: ResetTransactionPinScreen(client: client),
      ),
    );
  }

  testWidgets('shows the reset fields and action', (WidgetTester tester) async {
    await pumpScreen(tester);

    expect(find.text('Reset Transaction PIN'), findsNWidgets(2));
    expect(find.byKey(const Key('reset-pin-current-password')), findsOneWidget);
    expect(find.byKey(const Key('reset-pin-new-pin')), findsOneWidget);
    expect(find.byKey(const Key('reset-pin-confirm-pin')), findsOneWidget);
    expect(
      find.byKey(const Key('reset-transaction-pin-submit')),
      findsOneWidget,
    );
  });

  testWidgets('shows local validation errors before making a request',
      (WidgetTester tester) async {
    await pumpScreen(tester);

    await tester.enterText(
      find.byKey(const Key('reset-pin-current-password')),
      'Password123!',
    );
    await tester.enterText(
      find.byKey(const Key('reset-pin-new-pin')),
      '123',
    );
    await tester.enterText(
      find.byKey(const Key('reset-pin-confirm-pin')),
      '123',
    );
    await tester.tap(
      find.byKey(const Key('reset-transaction-pin-submit')),
    );
    await tester.pump();

    expect(
      find.text('Transaction PIN must contain exactly 4 digits.'),
      findsOneWidget,
    );
  });

  testWidgets('shows mismatch validation before making a request',
      (WidgetTester tester) async {
    await pumpScreen(tester);

    await tester.enterText(
      find.byKey(const Key('reset-pin-current-password')),
      'Password123!',
    );
    await tester.enterText(
      find.byKey(const Key('reset-pin-new-pin')),
      '2580',
    );
    await tester.enterText(
      find.byKey(const Key('reset-pin-confirm-pin')),
      '1357',
    );
    await tester.tap(
      find.byKey(const Key('reset-transaction-pin-submit')),
    );
    await tester.pump();

    expect(find.text('Transaction PINs do not match.'), findsOneWidget);
  });

  testWidgets('does not accept a success false reset PIN response',
      (tester) async {
    final client = MockClient((_) async => http.Response(
        '{"success":false,"message":"Password is incorrect"}', 200));
    await pumpScreen(tester, client: client);
    await tester.enterText(
        find.byKey(const Key('reset-pin-current-password')), 'Password123!');
    await tester.enterText(find.byKey(const Key('reset-pin-new-pin')), '2580');
    await tester.enterText(
        find.byKey(const Key('reset-pin-confirm-pin')), '2580');
    await tester.tap(find.byKey(const Key('reset-transaction-pin-submit')));
    await tester.pump();
    expect(find.text('Password is incorrect'), findsOneWidget);
  });
}

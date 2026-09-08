import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:servicepay_app/change_transaction_pin_screen.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() => SharedPreferences.setMockInitialValues({'auth_token': 'token'}));

  Future<void> pump(WidgetTester tester, http.Client client) async {
    await tester.pumpWidget(
        MaterialApp(home: ChangeTransactionPinScreen(client: client)));
  }

  Future<void> enterPins(WidgetTester tester) async {
    await tester.enterText(find.byKey(const Key('change-pin-current')), '2580');
    await tester.enterText(find.byKey(const Key('change-pin-new')), '4826');
    await tester.enterText(find.byKey(const Key('change-pin-confirm')), '4826');
  }

  testWidgets('sends the canonical change PIN request and accepts success',
      (tester) async {
    var called = false;
    final client = MockClient((request) async {
      called = true;
      expect(request.method, 'PUT');
      expect(request.url.path, '/api/transaction-pin/change');
      expect(jsonDecode(request.body), {
        'currentPin': '2580',
        'newPin': '4826',
        'confirmNewPin': '4826',
      });
      return http.Response('{"success":true,"message":"PIN updated"}', 200);
    });
    await pump(tester, client);
    await enterPins(tester);
    await tester.tap(find.byKey(const Key('change-transaction-pin-submit')));
    await tester.pump();
    expect(called, isTrue);
  });

  testWidgets('shows a wrong current PIN server error', (tester) async {
    final client = MockClient((_) async => http.Response(
        '{"success":false,"message":"Current PIN is incorrect"}', 400));
    await pump(tester, client);
    await enterPins(tester);
    await tester.tap(find.byKey(const Key('change-transaction-pin-submit')));
    await tester.pump();
    expect(find.text('Current PIN is incorrect'), findsOneWidget);
  });

  testWidgets('prevents duplicate change PIN submissions', (tester) async {
    final response = Completer<http.Response>();
    var calls = 0;
    final client = MockClient((_) {
      calls++;
      return response.future;
    });
    await pump(tester, client);
    await enterPins(tester);
    final button = find.byKey(const Key('change-transaction-pin-submit'));
    await tester.tap(button);
    await tester.pump();
    await tester.tap(button);
    await tester.pump();
    expect(calls, 1);
    response.complete(http.Response('{"success":true}', 200));
  });
}

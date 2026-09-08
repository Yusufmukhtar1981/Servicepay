import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:servicepay_app/transaction_pin_screen.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUp(() => SharedPreferences.setMockInitialValues({'auth_token': 'token'}));

  testWidgets('does not treat a success false create PIN body as successful',
      (tester) async {
    var calls = 0;
    final client = MockClient((request) async {
      calls++;
      expect(jsonDecode(request.body), {'pin': '2580', 'confirmPin': '2580'});
      return http.Response(
          '{"success":false,"message":"PIN already exists"}', 200);
    });
    await tester
        .pumpWidget(MaterialApp(home: TransactionPinScreen(client: client)));
    final fields = find.byType(TextField);
    await tester.enterText(fields.at(0), '2580');
    await tester.enterText(fields.at(1), '2580');
    await tester.tap(find.text('Create PIN'));
    await tester.pump();
    expect(calls, 1);
    expect(find.text('PIN already exists'), findsOneWidget);
  });
}

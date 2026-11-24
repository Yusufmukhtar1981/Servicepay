import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:servicepay_app/login_screen.dart';
import 'package:servicepay_app/services/login_identifier.dart';

void main() {
  test('canonical email and Nigerian phone inputs preserve identity', () {
    expect(normalizePasswordLoginIdentifier(' Customer@Example.com '), 'customer@example.com');
    for (final input in ['08012345678', '2348012345678', '+2348012345678', ' +234 (801) 234-5678 ']) {
      expect(normalizePasswordLoginIdentifier(input), '08012345678');
    }
    for (final input in ['', 'not an email', '080123', '8012345678', '+12348012345678', '08012345678abc']) {
      expect(normalizePasswordLoginIdentifier(input), isNull);
    }
  });
  for (final identifier in ['Customer@Example.com', '08012345678', '2348012345678', '+2348012345678']) {
    testWidgets('login submits normalized identifier and unchanged password: $identifier', (tester) async {
      SharedPreferences.setMockInitialValues({});
      await tester.binding.setSurfaceSize(const Size(390, 844));
      addTearDown(() => tester.binding.setSurfaceSize(null));
      final requests = <http.Request>[];
      await http.runWithClient(() async {
        await tester.pumpWidget(const MaterialApp(home: LoginScreen(returnToCaller: true)));
        await tester.pumpAndSettle();
        expect(find.text('Email address or phone number'), findsOneWidget);
        final field = tester.widget<TextField>(find.byType(TextField).first);
        expect(field.keyboardType, TextInputType.text);
        expect(field.autocorrect, isFalse);
        expect(field.enableSuggestions, isFalse);
        expect(field.autofillHints, contains(AutofillHints.username));
        await tester.enterText(find.byType(TextField).at(0), identifier);
        await tester.enterText(find.byType(TextField).at(1), 'Synthetic-Password-317!');
        tester.testTextInput.hide();
        await tester.ensureVisible(find.text('Sign in'));
        await tester.tap(find.text('Sign in'));
        await tester.pumpAndSettle();
        expect(requests, hasLength(1));
        final body = jsonDecode(requests.single.body) as Map<String, dynamic>;
        expect(body, {'identifier': normalizePasswordLoginIdentifier(identifier), 'password': 'Synthetic-Password-317!'});
        expect(requests.single.url.path, '/api/auth/login');
        expect(find.text('Incorrect email, phone number or password.'), findsOneWidget);
      }, () => MockClient((request) async {
        requests.add(request);
        return http.Response(jsonEncode({'success': false, 'message': 'Incorrect email, phone number or password.'}), 401);
      }));
    });
  }
  testWidgets('malformed identifier is blocked before any network request', (tester) async {
    SharedPreferences.setMockInitialValues({});
    var requests = 0;
    await http.runWithClient(() async {
      await tester.pumpWidget(const MaterialApp(home: LoginScreen(returnToCaller: true)));
      await tester.pumpAndSettle();
      await tester.enterText(find.byType(TextField).at(0), '08012');
      await tester.enterText(find.byType(TextField).at(1), 'Synthetic-Password-317!');
      tester.testTextInput.hide();
      await tester.ensureVisible(find.text('Sign in'));
      await tester.tap(find.text('Sign in')); await tester.pumpAndSettle();
      expect(requests, 0);
      expect(find.textContaining('Enter a valid email or Nigerian phone number'), findsOneWidget);
    }, () => MockClient((_) async { requests++; return http.Response('{}', 500); }));
  });
}

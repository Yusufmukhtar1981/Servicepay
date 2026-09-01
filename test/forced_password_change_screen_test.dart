import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:servicepay_app/forced_password_change_screen.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() {
    SharedPreferences.setMockInitialValues(<String, Object>{
      'auth_token': 'temporary-session-token',
    });
  });

  testWidgets('shows three spaced password fields with visibility controls',
      (tester) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: ForcedPasswordChangeScreen(role: 'BRANCH_MANAGER'),
      ),
    );

    expect(find.text('Temporary password'), findsWidgets);
    expect(find.text('New password'), findsOneWidget);
    expect(find.text('Confirm new password'), findsOneWidget);
    expect(find.byType(TextField), findsNWidgets(3));
    expect(find.byIcon(Icons.visibility_outlined), findsNWidgets(3));
    expect(tester.takeException(), isNull);
  });

  testWidgets('validates locally before making a request', (tester) async {
    var requestCount = 0;
    final client = MockClient((request) async {
      requestCount += 1;
      return http.Response('{}', 500);
    });

    await tester.pumpWidget(
      MaterialApp(
        home: ForcedPasswordChangeScreen(
          role: 'BRANCH_MANAGER',
          client: client,
        ),
      ),
    );

    await tester.tap(find.byKey(const Key('forced-password-submit')));
    await tester.pump();

    expect(find.text('Enter your temporary password.'), findsOneWidget);
    expect(requestCount, 0);
  });

  testWidgets('sends the exact backend fields and stores replacement token',
      (tester) async {
    Map<String, dynamic>? requestBody;
    final client = MockClient((request) async {
      requestBody = Map<String, dynamic>.from(jsonDecode(request.body) as Map);
      expect(request.method, 'PUT');
      expect(request.url.path, '/api/auth/change-password');
      expect(
        request.headers['authorization'],
        'Bearer temporary-session-token',
      );
      return http.Response(
        jsonEncode(<String, Object>{
          'success': true,
          'message': 'Password changed successfully.',
          'token': 'replacement-session-token',
        }),
        200,
        headers: const <String, String>{'content-type': 'application/json'},
      );
    });

    await tester.pumpWidget(
      MaterialApp(
        home: ForcedPasswordChangeScreen(
          role: 'BRANCH_MANAGER',
          client: client,
        ),
      ),
    );

    await tester.enterText(
      find.byKey(const Key('temporary-password-field')),
      'Temporary123!',
    );
    await tester.enterText(
      find.byKey(const Key('new-password-field')),
      'Replacement123!',
    );
    await tester.enterText(
      find.byKey(const Key('confirm-password-field')),
      'Replacement123!',
    );
    await tester.tap(find.byKey(const Key('forced-password-submit')));
    await tester.pumpAndSettle();

    expect(requestBody, <String, dynamic>{
      'currentPassword': 'Temporary123!',
      'newPassword': 'Replacement123!',
      'confirmPassword': 'Replacement123!',
    });
    final preferences = await SharedPreferences.getInstance();
    expect(preferences.getString('auth_token'), 'replacement-session-token');
  });
}

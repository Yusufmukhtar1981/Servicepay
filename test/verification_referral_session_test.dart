import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:servicepay_app/id_verification_screen.dart';
import 'package:servicepay_app/referral_screen.dart';
import 'package:servicepay_app/services/session_store.dart';

void main() {
  setUp(() async {
    SharedPreferences.setMockInitialValues({});
    await SessionStore.clear();
    await SessionStore.writeToken('current-session-only');
  });
  tearDown(() async => SessionStore.clear());

  testWidgets('Referral uses the current session without legacy preference tokens', (tester) async {
    final headers = <String?>[];
    final client = MockClient((request) async {
      headers.add(request.headers['Authorization']);
      return http.Response(jsonEncode({
        'success': true, 'referralCode': 'SP-TEST-1234567890',
        'referredCount': 0, 'referrals': [],
      }), 200);
    });
    await tester.pumpWidget(MaterialApp(home: ReferralScreen(client: client)));
    await tester.pumpAndSettle();
    expect(headers, ['Bearer current-session-only']);
    expect(find.text('SP-TEST-1234567890'), findsOneWidget);
    expect((await SharedPreferences.getInstance()).getString('auth_token'), isNull);
  });

  testWidgets('NIN history uses the current session without recreating legacy tokens', (tester) async {
    final headers = <String?>[];
    await http.runWithClient(() async {
      await tester.pumpWidget(const MaterialApp(home: IdVerificationScreen()));
      await tester.pumpAndSettle();
    }, () => MockClient((request) async {
      if (request.url.path.endsWith('/nin/history')) {
        headers.add(request.headers['Authorization']);
      }
      return http.Response('{"success":true,"data":[]}', 200);
    }));
    expect(headers, ['Bearer current-session-only']);
    expect((await SharedPreferences.getInstance()).getString('auth_token'), isNull);
  });
}

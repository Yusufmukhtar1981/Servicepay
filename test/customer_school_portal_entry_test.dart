import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:servicepay_app/dashboard_screen.dart';
import 'package:shared_preferences/shared_preferences.dart';

http.Response _response(http.Request request, bool eligible) {
  if (request.url.path.endsWith('/settings/public')) {
    return http.Response('{"settings":{"services":{}}}', 200);
  }
  if (request.url.path.endsWith('/edupay/school/handoff/options')) {
    return http.Response(
      eligible
          ? '{"success":true,"schools":[{"schoolId":"school-1","schoolName":"Greenfield Academy","role":"OWNER"}]}'
          : '{"success":true,"schools":[]}',
      200,
    );
  }
  if (request.url.path.endsWith('/wallet')) return http.Response('{"walletBalance":1000}', 200);
  if (request.url.path.endsWith('/notifications')) return http.Response('{"notifications":[]}', 200);
  if (request.url.path.endsWith('/transactions')) return http.Response('{"transactions":[]}', 200);
  return http.Response('{"success":true}', 200);
}

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({
        'auth_token': 'customer-token',
        'user_name': 'School Owner',
      }));

  testWidgets('shows School Portal only for backend-approved memberships', (tester) async {
    await tester.pumpWidget(MaterialApp(
      home: DashboardScreen(
        schoolPortalSupported: true,
        client: MockClient((request) async => _response(request, true)),
      ),
    ));
    for (var index = 0; index < 8; index++) {
      await tester.pump(const Duration(milliseconds: 100));
    }
    expect(find.byKey(const Key('customer-school-portal-card')), findsOneWidget);
  });

  testWidgets('hides School Portal without backend eligibility', (tester) async {
    await tester.pumpWidget(MaterialApp(
      home: DashboardScreen(
        schoolPortalSupported: true,
        client: MockClient((request) async => _response(request, false)),
      ),
    ));
    for (var index = 0; index < 8; index++) {
      await tester.pump(const Duration(milliseconds: 100));
    }
    expect(find.byKey(const Key('customer-school-portal-card')), findsNothing);
  });
}
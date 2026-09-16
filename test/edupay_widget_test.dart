import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';
import 'package:servicepay_app/edupay/edupay_api.dart';
import 'package:servicepay_app/edupay/edupay_screen.dart';

class _DashboardClient extends http.BaseClient {
  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) async {
    final path = request.url.path;
    final body = path.endsWith('/dashboard')
        ? {
            'success': true,
            'settings': {'enabled': true},
            'summary': {}
          }
        : path.endsWith('/plans')
            ? {'success': true, 'plans': []}
            : path.endsWith('/children')
                ? {'success': true, 'children': []}
                : path.endsWith('/repayments')
                    ? {'success': true, 'repayments': []}
                    : {'success': true, 'schools': []};
    return http.StreamedResponse(
      Stream.value(utf8.encode(jsonEncode(body))),
      200,
      headers: {'content-type': 'application/json'},
    );
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  testWidgets('EduPay renders authoritative empty overview state',
      (tester) async {
    SharedPreferences.setMockInitialValues({'auth_token': 'test-token'});
    await tester.pumpWidget(
      MaterialApp(
        home: EduPayScreen(api: EduPayApi(client: _DashboardClient())),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('School fees, made manageable.'), findsOneWidget);
    expect(find.text('No plans yet'), findsNothing);
    expect(find.text('ServicePay EduPay'), findsNothing);
  });
}

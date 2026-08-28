import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:servicepay_app/admin/admin_phone_financing_screen.dart';
import 'package:servicepay_app/admin/admin_phone_financing_api.dart';
import 'package:shared_preferences/shared_preferences.dart';

class _WorkspaceClient extends http.BaseClient {
  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) async {
    final body = request.url.path.endsWith('/dashboard')
        ? {'success': true, 'metrics': {'applications': 3, 'active': 1, 'overdue': 0, 'completed': 2}}
        : {'success': true, 'products': [], 'applications': [], 'devices': [], 'finance': []};
    return http.StreamedResponse(Stream.value(utf8.encode(jsonEncode(body))), 200);
  }
}

void main() {
  testWidgets('workspace exposes operational tabs and disabled-provider posture',
      (tester) async {
    SharedPreferences.setMockInitialValues({'auth_token': 'test-token'});
    await tester.pumpWidget(MaterialApp(
      home: AdminPhoneFinancingScreen(api: AdminPhoneFinancingApi(client: _WorkspaceClient())),
    ));
    await tester.pumpAndSettle();

    expect(find.text('Phone Financing Control Room'), findsOneWidget);
    expect(find.text('Products'), findsOneWidget);
    expect(find.text('Applications'), findsAtLeastNWidgets(1));
    expect(find.text('IMEI inventory'), findsNothing);
    expect(find.text('Provider enforcement is disabled'), findsOneWidget);
    expect(find.textContaining('Restriction and restore actions only record'),
        findsOneWidget);

    await tester.tap(find.text('Products'));
    await tester.pumpAndSettle();
    expect(find.text('Phone products'), findsOneWidget);
    expect(find.text('No phone products yet. Add the first financed product.'),
        findsOneWidget);
  });
}
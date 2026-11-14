import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:servicepay_app/business_network/business_hub_screen.dart';
import 'package:servicepay_app/business_network/business_network_api.dart';

void main() {
  testWidgets(
      'switching type restores an existing Merchant draft without overwriting it',
      (tester) async {
    tester.view.physicalSize = const Size(800, 1400);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    Map<String, dynamic> merchant = {
      'kind': 'MERCHANT',
      'status': 'DRAFT',
      'revision': 7,
      'networkId': 'SPN-1234567890ABCDEF',
      'details': {
        'businessName': 'Saved Merchant business',
        'businessCategory': 'Retail',
        'preferredServices': ['DATA'],
      },
    };
    Map<String, dynamic>? saved;
    final client = MockClient((request) async {
      if (request.method == 'PUT') {
        expect(request.url.path, '/api/business-network/applications/MERCHANT');
        saved = jsonDecode(request.body) as Map<String, dynamic>;
        merchant = {...merchant, 'revision': 8, 'details': saved};
        return http.Response(
            jsonEncode({
              'success': true,
              'data': {'profile': merchant},
            }),
            200);
      }
      return http.Response(
          jsonEncode({
            'success': true,
            'data': {
              'customer': {'_id': 'local-user', 'fullName': 'Local test owner'},
              'applications': [merchant],
              'memberships': [],
              'categories': ['Retail'],
              'supportedServices': ['DATA'],
            },
          }),
          200);
    });
    addTearDown(client.close);
    await tester.pumpWidget(MaterialApp(
        home: BusinessHubScreen(
      api: BusinessNetworkApi(
          client: client,
          tokenProvider: () async => 'local-test-token',
          baseUrl: 'https://local.test.invalid/api'),
    )));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Become an Agent'));
    await tester.pumpAndSettle();
    final nameField = find.ancestor(
        of: find.text('Business / shop name'),
        matching: find.byType(TextFormField));
    await tester.enterText(nameField, 'Unsaved Agent name');
    await tester.tap(find.text('SME Merchant'));
    await tester.pumpAndSettle();
    expect(find.text('Saved Merchant business'), findsOneWidget);
    expect(find.text('Unsaved Agent name'), findsNothing);
    await tester.scrollUntilVisible(find.text('Save draft'), 350,
        scrollable: find.byType(Scrollable).first, maxScrolls: 30);
    await tester.tap(find.text('Save draft'));
    await tester.pumpAndSettle();
    expect(saved?['businessName'], 'Saved Merchant business');
    expect(saved?['revision'], 7);
    expect(saved?['kind'], 'MERCHANT');
  });
}

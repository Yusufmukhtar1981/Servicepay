import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:servicepay_app/business_network/business_network_api.dart';
import 'package:servicepay_app/business_network/merchant_funding_notice.dart';

void main() {
  testWidgets('Merchant funding notice uses server policy, not a wallet balance',
      (tester) async {
    final client = MockClient((request) async {
      expect(request.method, 'GET');
      expect(request.url.path, '/api/business-network/funding-policy');
      expect(request.headers['authorization'], 'Bearer fixture-token');
      return http.Response(jsonEncode({
        'success': true,
        'data': {'category': 'MERCHANT', 'minimumKobo': 5000000},
      }), 200);
    });
    final api = BusinessNetworkApi(client: client,
      tokenProvider: () async => 'fixture-token',
      baseUrl: 'https://example.invalid/api');
    await tester.pumpWidget(MaterialApp(
      home: Scaffold(body: MerchantFundingNotice(api: api)),
    ));
    await tester.pumpAndSettle();
    expect(find.textContaining('₦50000.00'), findsOneWidget);
    expect(find.textContaining('not a minimum wallet balance'), findsOneWidget);
    expect(find.textContaining('credit protection'), findsOneWidget);
    await tester.pumpWidget(const SizedBox.shrink());
    client.close();
  });

  testWidgets('Customer funding does not show a Merchant minimum', (tester) async {
    final client = MockClient((_) async => http.Response(jsonEncode({
      'success': true,
      'data': {'category': 'CUSTOMER', 'minimumKobo': 10000},
    }), 200));
    final api = BusinessNetworkApi(client: client,
      tokenProvider: () async => 'fixture-token',
      baseUrl: 'https://example.invalid/api');
    await tester.pumpWidget(MaterialApp(
      home: MerchantFundingNotice(api: api),
    ));
    await tester.pumpAndSettle();
    expect(find.textContaining('Merchant minimum'), findsNothing);
    await tester.pumpWidget(const SizedBox.shrink());
    client.close();
  });

  testWidgets('policy failure does not invent an amount', (tester) async {
    final client = MockClient((_) async => http.Response(
      jsonEncode({'success': false, 'message': 'Unavailable'}), 503));
    final api = BusinessNetworkApi(client: client,
      tokenProvider: () async => 'fixture-token',
      baseUrl: 'https://example.invalid/api');
    await tester.pumpWidget(MaterialApp(
      home: MerchantFundingNotice(api: api),
    ));
    await tester.pumpAndSettle();
    expect(find.textContaining('could not be confirmed'), findsOneWidget);
    expect(find.textContaining('50000'), findsNothing);
    await tester.pumpWidget(const SizedBox.shrink());
    client.close();
  });
}

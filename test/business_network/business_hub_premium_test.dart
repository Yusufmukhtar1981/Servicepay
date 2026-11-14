import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:servicepay_app/business_network/business_hub_screen.dart';
import 'package:servicepay_app/business_network/business_network_api.dart';

Future<void> _showPremiumDashboard(
    WidgetTester tester, MockClient client) async {
  await tester.pumpWidget(MaterialApp(
    home: BusinessHubScreen(
      api: BusinessNetworkApi(
        client: client,
        tokenProvider: () async => 'customer-token',
        baseUrl: 'https://api.test.invalid/api',
      ),
    ),
  ));
  await tester.pumpAndSettle();
  await _scrollToText(tester, find.text('My Agent Dashboard'));
  await tester.tap(find.text('My Agent Dashboard'));
  await tester.pumpAndSettle();
}

Future<void> _scrollToText(WidgetTester tester, Finder target) async {
  final scrollable = find
      .byWidgetPredicate(
        (widget) =>
            widget is Scrollable && widget.axisDirection == AxisDirection.down,
      )
      .first;
  await tester.scrollUntilVisible(
    target,
    260,
    maxScrolls: 30,
    scrollable: scrollable,
  );
}

void main() {
  testWidgets(
      'owner premium tools read exact DTOs and retry expense idempotently',
      (tester) async {
    tester.view.physicalSize = const Size(800, 3000);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final expenseBodies = <Map<String, dynamic>>[];
    var expenseAttempts = 0;
    final requested = <Uri>[];
    final client = MockClient((request) async {
      requested.add(request.url);
      final path = request.url.path;
      if (path.endsWith('/me')) {
        return http.Response(
          jsonEncode({
            'success': true,
            'data': {
              'customer': {'fullName': 'Ada Okafor', '_id': 'customer-1'},
              'applications': [],
              'memberships': [
                {
                  'kind': 'AGENT',
                  'profileId': 'agent-7',
                  'networkId': 'SPN-1234567890ABCDEF',
                  'status': 'APPROVED',
                  'isOwner': true,
                }
              ],
              'categories': [],
              'supportedServices': [],
              'serviceCatalogue': {'AGENT': [], 'MERCHANT': []},
            },
          }),
          200,
        );
      }
      if (path.endsWith('/dashboard/agent')) {
        return http.Response(
          jsonEncode({
            'success': true,
            'data': {
              'profile': {
                '_id': 'agent-7',
                'networkId': 'SPN-1234567890ABCDEF',
                'kind': 'AGENT',
                'status': 'APPROVED',
                'details': {'businessName': 'Ada Market'},
              },
              'summary': {'total': 2, 'successful': 2, 'volumeKobo': 23000},
              'features': {},
            },
          }),
          200,
        );
      }
      if (path.endsWith('/transactions/agent')) {
        return http.Response(
            jsonEncode({
              'success': true,
              'data': {'items': [], 'total': 0}
            }),
            200);
      }
      if (path.endsWith('/commissions/agent')) {
        return http.Response(
          jsonEncode({
            'success': true,
            'data': {
              'items': [],
              'total': 0,
              'totals': {
                'earnedKobo': 0,
                'pendingKobo': 0,
                'paidKobo': 0,
                'reversedKobo': 0,
                'recoveryKobo': 0,
              },
            },
          }),
          200,
        );
      }
      if (path.endsWith('/tools/AGENT')) {
        expect(request.url.queryParameters, {
          'profileId': 'agent-7',
          'period': 'month',
        });
        return http.Response(
          jsonEncode({
            'success': true,
            'data': {
              'profileId': 'agent-7',
              'networkId': 'SPN-1234567890ABCDEF',
              'kind': 'AGENT',
              'period': 'month',
              'stats': {'transactions': 4, 'volumeKobo': 52000},
              'lifetime': {'transactions': 18, 'volumeKobo': 281000},
              'ranking': {
                'rank': 2,
                'participants': 13,
                'metric': 'verified transactions',
                'period': 'month',
              },
              'transactionSummary': {
                'total': 5,
                'successful': 4,
                'pending': 0,
                'failed': 1,
                'refunded': 0,
                'volumeKobo': 52000,
              },
              'expenses': {'amountKobo': 4500, 'count': 1},
              'commissionIncomeKobo': 950,
              'netCommissionAfterExpensesKobo': -3550,
              'bestSellingServices': [
                {'service': 'AIRTIME', 'count': 3, 'volumeKobo': 24000}
              ],
              'salesRevenueKobo': null,
              'revenueDescription':
                  'ServicePay reports purchase volume, not owner resale revenue.',
              'loyalty': {
                'earned': 4,
                'reversed': 0,
                'available': 4,
                'expired': 0,
                'items': [],
                'cashValueKobo': 0,
                'redemptionEnabled': false,
              },
              'goals': [],
              'levels': [],
              'campaigns': [],
              'referralCode': 'ADA-SP',
              'referralRewardAuthority':
                  'Existing ServicePay referral programme; no duplicate rewards created.',
              'publicProfile': false,
              'publicProfilePath': null,
              'features': {
                'merchantQr': false,
                'payByLink': false,
                'automaticPayouts': false,
              },
              'capabilityReasons': {
                'rechargeVouchers':
                    'Official /recharge_card docs exist; price and recovery remain unverified.',
                'dataVouchers':
                    'Official /data_card docs exist; catalogue and request examples conflict.',
                'specialPurchasePricing': 'No discounted price admission.',
                'bulkPurchases': 'No verified batch contract.',
                'merchantQr': 'Profile QR is not a payment request.',
                'payByLink': 'No verified collection provider.',
                'automaticPayouts': 'Manual authorized settlement only.',
              },
            },
          }),
          200,
        );
      }
      if (path.endsWith('/vouchers/AGENT')) {
        expect(request.url.queryParameters['profileId'], 'agent-7');
        return http.Response(
          jsonEncode({
            'success': true,
            'data': {
              'enabled': false,
              'inventoryVerified': false,
              'items': [],
              'message': 'No live voucher purchase or stock is verified.',
              'contract': {
                'enabled': false,
                'airtime': {
                  'documentation':
                      'https://telecomabode.com.ng/documentation/airtimepin-request',
                  'issue': '/recharge_card',
                },
                'data': {
                  'documentation':
                      'https://telecomabode.com.ng/documentation/datapin-request',
                  'issue': '/data_card',
                  'catalogueVerified': false,
                },
                'prerequisites': [
                  'Authoritative pre-purchase price/availability',
                  'Verified duplicate-request and timeout recovery',
                  'Dedicated voucher encryption key',
                  'Printer/device verification',
                ],
              },
              'capabilityReasons': {
                'rechargeVouchers':
                    'Official /recharge_card docs exist; price and recovery remain unverified.',
                'dataVouchers':
                    'Official /data_card docs exist; catalogue and request examples conflict.',
              },
            },
          }),
          200,
        );
      }
      if (path.endsWith('/directory/AGENT') && request.method == 'GET') {
        expect(request.url.queryParameters['profileId'], 'agent-7');
        return http.Response(
          jsonEncode({
            'success': true,
            'data': {
              'items': [
                {
                  '_id': 'contact-4',
                  'name': 'Musa Bello',
                  'phone': '08011112222',
                  'email': '',
                  'consentAt': '2026-05-01T10:00:00Z',
                }
              ]
            },
          }),
          200,
        );
      }
      if (path.endsWith('/expenses/AGENT') && request.method == 'GET') {
        expect(request.url.queryParameters['profileId'], 'agent-7');
        return http.Response(
          jsonEncode({
            'success': true,
            'data': {
              'walletDebit': false,
              'items': [
                {
                  'metadata': {
                    'amountKobo': 4500,
                    'description': 'Packaging',
                    'reference': 'RCPT-22',
                  },
                  'createdAt': '2026-05-03T10:00:00Z',
                }
              ],
            },
          }),
          200,
        );
      }
      if (path.endsWith('/expenses/AGENT') && request.method == 'POST') {
        final body = jsonDecode(request.body) as Map<String, dynamic>;
        expenseBodies.add(body);
        expenseAttempts++;
        expect(request.url.queryParameters['profileId'], 'agent-7');
        if (expenseAttempts == 1) {
          return http.Response(
            jsonEncode({'success': false, 'message': 'Temporary failure'}),
            503,
          );
        }
        return http.Response(
          jsonEncode({
            'success': true,
            'data': {
              'walletDebit': false,
              'expense': {'metadata': body},
            },
          }),
          201,
        );
      }
      return http.Response(
        jsonEncode({'success': false, 'message': 'Unexpected route: $path'}),
        404,
      );
    });
    await _showPremiumDashboard(tester, client);

    await _scrollToText(tester, find.text('Owner business tools'));
    expect(find.text('Period transactions'), findsOneWidget);
    expect(find.text('4'), findsAtLeastNWidgets(1));
    expect(find.textContaining('not cash'), findsOneWidget);
    expect(find.textContaining('ADA-SP'), findsOneWidget);
    expect(find.textContaining('Verified rank 2 of 13'), findsOneWidget);
    expect(find.textContaining('Business sales revenue'), findsOneWidget);
    expect(find.textContaining('resale revenue'), findsOneWidget);
    expect(find.textContaining('/recharge_card'), findsNWidgets(2));
    expect(requested.any((uri) => uri.path.endsWith('/tools/AGENT')), isTrue);
    expect(
      requested.any((uri) =>
          uri.path.endsWith('/directory/AGENT') &&
          uri.queryParameters['profileId'] == 'agent-7'),
      isTrue,
    );

    await _scrollToText(tester, find.text('Record expense'));
    await tester.tap(find.text('Record expense'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField).at(0), '123.45');
    await tester.enterText(find.byType(TextField).at(1), 'Shop supplies');
    await tester.tap(find.text('Save expense'));
    await tester.pumpAndSettle();
    expect(find.text('Temporary failure'), findsOneWidget);
    final key = expenseBodies.single['idempotencyKey'];
    expect(expenseBodies.single['amountKobo'], 12345);
    expect(expenseBodies.single['description'], 'Shop supplies');

    await tester.tap(find.text('Save expense'));
    await tester.pumpAndSettle();
    expect(expenseAttempts, 2);
    expect(expenseBodies.last['idempotencyKey'], key);
    expect(expenseBodies.last['amountKobo'], 12345);
    expect(find.textContaining('wallet balances'), findsOneWidget);
    client.close();
  });
}

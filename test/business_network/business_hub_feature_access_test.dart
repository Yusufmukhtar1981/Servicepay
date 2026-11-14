import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:servicepay_app/airtime_screen.dart';
import 'package:servicepay_app/business_network/business_feature_access_panel.dart';
import 'package:servicepay_app/business_network/business_hub_screen.dart';
import 'package:servicepay_app/business_network/business_network_api.dart';
import 'package:servicepay_app/data_screen.dart';

Future<void> _openPurchaseScreen(
  WidgetTester tester,
  String service, {
  bool staffMembership = false,
}) async {
  final client = MockClient((request) async {
    final path = request.url.path;
    dynamic data = {};
    if (path.endsWith('/me')) {
      data = {
        'customer': {'fullName': 'Ada Okafor', '_id': 'customer-1'},
        'applications': [],
        'memberships': [
          {
            'kind': 'AGENT',
            'profileId': 'agent-1',
            'status': 'APPROVED',
            if (staffMembership) ...{
              'role': 'STAFF',
              'permissions': ['reports', 'payments'],
            } else
              'isOwner': true,
          }
        ],
      };
    } else if (path.endsWith('/dashboard/agent')) {
      data = {
        'profile': {
          '_id': 'agent-1',
          'kind': 'AGENT',
          'status': 'APPROVED',
        },
        'summary': {},
        'featureAccess': [
          {
            'key': 'airtime',
            'label': 'Airtime',
            'ready': true,
            'history': true,
            'categories': {'AGENT': 'ENABLED'},
          }
        ],
        'pricingContext': {
          'businessKind': 'AGENT',
          'walletAuthority': 'AUTHENTICATED_CUSTOMER_ONLY',
        },
      };
    } else if (path.endsWith('/transactions/agent')) {
      data = {'items': [], 'total': 0};
    } else if (path.endsWith('/commissions/agent')) {
      data = {
        'items': [],
        'total': 0,
        'totals': {
          'earnedKobo': 0,
          'pendingKobo': 0,
          'paidKobo': 0,
          'reversedKobo': 0,
          'recoveryKobo': 0,
        },
      };
    } else if (path.endsWith('/tools/AGENT')) {
      data = {};
    } else if (path.endsWith('/directory/AGENT') ||
        path.endsWith('/expenses/AGENT')) {
      data = {'items': []};
    } else if (path.endsWith('/vouchers/AGENT')) {
      data = {'enabled': false, 'inventoryVerified': false, 'items': []};
    } else {
      return http.Response(
        jsonEncode({'success': false, 'message': 'Unexpected request'}),
        404,
      );
    }
    return http.Response(
      jsonEncode({'success': true, 'data': data}),
      200,
    );
  });
  addTearDown(client.close);
  await tester.pumpWidget(MaterialApp(
    home: BusinessHubScreen(
      api: BusinessNetworkApi(
        client: client,
        tokenProvider: () async => 'test-token',
        baseUrl: 'https://api.test.invalid/api',
      ),
    ),
  ));
  await tester.pumpAndSettle();
  await tester.tap(find.text('My Agent Dashboard'));
  await tester.pumpAndSettle();
  final cta = find.text('Pay a bill from my account');
  await tester.scrollUntilVisible(
    cta,
    260,
    scrollable: find
        .byWidgetPredicate((widget) =>
            widget is Scrollable && widget.axisDirection == AxisDirection.down)
        .first,
  );
  await tester.tap(cta);
  await tester.pumpAndSettle();
  await tester.tap(find.text(service).last);
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 350));
}

Future<void> _closePurchaseScreen(WidgetTester tester) async {
  final screen = find.byWidgetPredicate(
    (widget) => widget is AirtimeScreen || widget is DataScreen,
  );
  Navigator.of(tester.element(screen)).pop();
  await tester.pumpAndSettle();
  // The purchase screens bound catalogue loading with a timeout. Advance fake
  // time after disposal so the test leaves no pending timer behind.
  await tester.pump(const Duration(seconds: 40));
}

void main() {
  testWidgets('approved Agent purchase passes AGENT to Airtime screen',
      (tester) async {
    await _openPurchaseScreen(tester, 'Airtime');
    expect(find.byType(AirtimeScreen), findsOneWidget);
    expect(
        tester.widget<AirtimeScreen>(find.byType(AirtimeScreen)).businessKind,
        'AGENT');
    await _closePurchaseScreen(tester);
  });

  testWidgets('approved Agent purchase passes AGENT to Data screen',
      (tester) async {
    await _openPurchaseScreen(tester, 'Data');
    expect(find.byType(DataScreen), findsOneWidget);
    expect(tester.widget<DataScreen>(find.byType(DataScreen)).businessKind,
        'AGENT');
    await _closePurchaseScreen(tester);
  });

  testWidgets('staff membership alone does not confer business pricing',
      (tester) async {
    await _openPurchaseScreen(
      tester,
      'Airtime',
      staffMembership: true,
    );
    expect(find.byType(AirtimeScreen), findsOneWidget);
    expect(
      tester.widget<AirtimeScreen>(find.byType(AirtimeScreen)).businessKind,
      isNull,
    );
    await _closePurchaseScreen(tester);
  });

  testWidgets('feature matrix explains availability and preserves history',
      (tester) async {
    await tester.pumpWidget(const MaterialApp(
      home: Scaffold(
        body: BusinessFeatureAccessPanel(
          title: 'Business feature status',
          kind: 'AGENT',
          featureAccess: [
            {
              'key': 'airtime',
              'label': 'Airtime',
              'ready': true,
              'history': true,
              'categories': {'AGENT': 'ENABLED'},
            },
            {
              'key': 'directory',
              'label': 'Customer directory',
              'ready': false,
              'reason': 'Paused by ServicePay',
              'history': true,
              'categories': {
                'AGENT': {'state': 'MAINTENANCE'},
              },
            },
            {
              'key': 'vouchers',
              'label': 'Voucher PINs',
              'ready': false,
              'categories': {'AGENT': 'COMING_SOON'},
            },
          ],
        ),
      ),
    ));
    expect(find.text('Available'), findsOneWidget);
    expect(find.text('Maintenance'), findsOneWidget);
    expect(find.text('Coming soon'), findsOneWidget);
    expect(find.text('Paused by ServicePay'), findsOneWidget);
    expect(find.text('Existing history remains accessible.'), findsNWidgets(2));
  });

  testWidgets('legacy feature matrix omission does not invent status UI',
      (tester) async {
    final client = MockClient((_) async => http.Response(
          jsonEncode({
            'success': true,
            'data': {
              'customer': {'fullName': 'Ada'},
              'applications': [],
              'memberships': [],
            },
          }),
          200,
        ));
    await tester.pumpWidget(MaterialApp(
      home: BusinessHubScreen(
        api: BusinessNetworkApi(
          client: client,
          tokenProvider: () async => 'test-token',
          baseUrl: 'https://api.test.invalid/api',
        ),
      ),
    ));
    await tester.pumpAndSettle();
    expect(find.text('Service availability'), findsNothing);
    client.close();
  });
}

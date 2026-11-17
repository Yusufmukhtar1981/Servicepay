import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

import 'package:servicepay_app/management/management_api.dart';
import 'package:servicepay_app/management/management_dashboard_screen.dart';

void main() {
  testWidgets('renders scoped reporting from an injected API without live credentials',
      (tester) async {
    final client = MockClient((request) async {
      expect(request.url.path, endsWith('/management/analytics/overview'));
      return http.Response(jsonEncode({
        'success': true,
        'data': {
          'period': {'preset': 'THIS_MONTH', 'timezone': 'Africa/Lagos'},
          'scope': {'role': 'AGENT'},
          'kpis': {
            'totalCustomers': 18,
            'newCustomers': 4,
            'activeCustomers': 11,
            'inactiveCustomers': 7,
            'totalTransactions': 23,
            'successfulTransactions': 19,
            'failedTransactions': 2,
            'pendingTransactions': 2,
            'ownRecordedCommission': 340.5,
          },
          'previous': {
            'totalCustomers': 15,
            'newCustomers': 2,
            'activeCustomers': 8,
            'totalTransactions': 17,
            'successfulTransactions': 15,
            'failedTransactions': 1,
            'pendingTransactions': 1,
            'ownRecordedCommission': 280,
          },
          'weekly': [
            {'at': '2025-01-06', 'transactions': 8, 'successful': 7, 'successfulValue': 1200},
            {'at': '2025-01-13', 'transactions': 15, 'successful': 12, 'successfulValue': 2100},
          ],
          'monthly': [],
          'definitions': {
            'active': 'Successful transaction in period',
            'commission': 'Own recorded commission',
          },
        },
      }), 200);
    });
    final api = ManagementApi(
      client: client,
      tokenReader: () async => 'widget-test-token',
    );

    await tester.pumpWidget(MaterialApp(
      home: ManagementDashboardScreen(role: 'AGENT', api: api),
    ));
    await tester.pumpAndSettle();

    expect(find.text('Management workspace'), findsOneWidget);
    expect(find.text('Customers'), findsOneWidget);
    expect(find.text('18'), findsOneWidget);
    expect(find.text('Own recorded commission'), findsOneWidget);
    expect(find.textContaining('BRM'), findsNothing);
    expect(find.textContaining('CM'), findsNothing);
    expect(find.text('Transaction activity'), findsOneWidget);
  });

  testWidgets('team rows distinguish period inactivity from suspended account status',
      (tester) async {
    tester.view.physicalSize = const Size(1200, 900);
    tester.view.devicePixelRatio = 1;
    final client = MockClient((request) async {
      if (request.url.path.endsWith('/management/analytics/teams')) {
        expect(request.url.queryParameters['period'], isNotNull);
        return http.Response(jsonEncode({
          'success': true,
          'data': {
            'items': [
              {
                '_id': 'assigned-aggregator',
                'fullName': 'Ada Okafor',
                'role': 'AGENT',
                'state': 'Lagos',
                'zone': 'South West',
                'status': 'SUSPENDED',
                'performance': {
                  'transactions': 6,
                  'successful': 0,
                  'activeInPeriod': false,
                  'lastTransactionAt': null,
                },
              },
            ],
            'total': 1,
            'page': 1,
            'limit': 25,
            'totalPages': 1,
          },
        }), 200);
      }
      return http.Response(jsonEncode({
        'success': true,
        'data': {
          'scope': {'id': 'manager-1', 'name': 'Lagos', 'role': 'STATE_MANAGER'},
          'kpis': {'totalCustomers': 0},
          'previous': {},
          'weekly': [],
          'monthly': [],
          'definitions': {},
        },
      }), 200);
    });
    final api = ManagementApi(
      client: client,
      tokenReader: () async => 'widget-test-token',
    );

    await tester.pumpWidget(MaterialApp(
      home: ManagementDashboardScreen(role: 'STATE_MANAGER', api: api),
    ));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Team Management'));
    await tester.pumpAndSettle();

    expect(find.text('Aggregator · Lagos · South West'), findsOneWidget);
    expect(find.text('Account: SUSPENDED'), findsOneWidget);
    expect(find.text('Inactive in period'), findsOneWidget);

    await tester.tap(find.text('Ada Okafor'));
    await tester.pumpAndSettle();
    expect(find.textContaining('suspended account, reporting only'), findsOneWidget);
    tester.view.resetPhysicalSize();
    tester.view.resetDevicePixelRatio();
  });

  testWidgets('editing a target keeps subject, period, start day and revision key fixed',
      (tester) async {
    tester.view.physicalSize = const Size(1200, 1000);
    tester.view.devicePixelRatio = 1;
    Map<String, dynamic>? posted;
    final client = MockClient((request) async {
      if (request.method == 'POST') {
        posted = jsonDecode(request.body) as Map<String, dynamic>;
        return http.Response(
            jsonEncode({'success': true, 'data': {'id': 'target-1', 'revision': 5}}),
            200);
      }
      if (request.url.path.endsWith('/management/analytics/targets')) {
        return http.Response(jsonEncode({
          'success': true,
          'data': {
            'canManage': true,
            'items': [
              {
                '_id': 'target-1',
                'subjectName': 'Ada Okafor',
                'values': {'transactions': 10},
                'management': {
                  'subjectId': 'assigned-aggregator',
                  'period': 'MONTHLY',
                  'startsAt': '2025-06-01T23:00:00.000Z',
                  'endsAt': '2025-06-30T23:00:00.000Z',
                  'revision': 4,
                },
                'progress': {
                  'transactions': {'target': 10, 'actual': 6, 'percent': 60},
                },
              },
            ],
          },
        }), 200);
      }
      if (request.url.path.endsWith('/management/analytics/teams')) {
        return http.Response(jsonEncode({
          'success': true,
          'data': {
            'items': [
              {'_id': 'assigned-aggregator', 'fullName': 'Ada Okafor'},
            ],
          },
        }), 200);
      }
      return http.Response(jsonEncode({
        'success': true,
        'data': {
          'scope': {'id': 'manager-1', 'name': 'Lagos'},
          'kpis': {'newCustomers': 1, 'activeCustomers': 1, 'inactiveCustomers': 0},
          'previous': {},
          'weekly': [],
          'monthly': [],
          'definitions': {},
        },
      }), 200);
    });

    await tester.pumpWidget(MaterialApp(
      home: ManagementDashboardScreen(
        role: 'STATE_MANAGER',
        initialSection: 'Marketing',
        api: ManagementApi(client: client, tokenReader: () async => 'test'),
      ),
    ));
    await tester.pumpAndSettle();
    expect(find.byType(LinearProgressIndicator), findsWidgets);
    await tester.tap(find.byTooltip('Edit target'));
    await tester.pumpAndSettle();

    final selectors = tester
        .widgetList<DropdownButtonFormField<String>>(
            find.byType(DropdownButtonFormField<String>))
        .toList();
    expect(selectors, hasLength(2));
    expect(selectors[0].onChanged, isNull);
    expect(selectors[1].onChanged, isNull);
    expect(find.text('2025-06-02'), findsOneWidget);

    await tester.tap(find.text('Save target'));
    await tester.pumpAndSettle();
    expect(posted, isNotNull);
    expect(posted!['subjectId'], 'assigned-aggregator');
    expect(posted!['period'], 'MONTHLY');
    expect(posted!['startDate'], '2025-06-02');
    expect(posted!['revision'], 4);
    tester.view.resetPhysicalSize();
    tester.view.resetDevicePixelRatio();
  });
}

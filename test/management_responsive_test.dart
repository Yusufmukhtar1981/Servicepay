import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:servicepay_app/management/management_api.dart';
import 'package:servicepay_app/management/management_dashboard_screen.dart';

void main() {
  for (final role in ['AGENT', 'STATE_MANAGER', 'ZONAL_MANAGER']) {
    for (final width in [390.0, 1440.0]) {
      testWidgets('$role all sections fit ${width.toInt()}px', (tester) async {
        tester.view.physicalSize = Size(width, 1000);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);
        final api = ManagementApi(tokenReader: () async => 'local-only-token',
          client: MockClient((r) async {
            final endpoint = r.url.path.split('/').last;
            final data = switch (endpoint) {
              'overview' => {
                'scope': {'id': 'manager', 'name': 'Assigned scope', 'role': role},
                'kpis': {'totalCustomers': 100, 'newCustomers': 5, 'activeCustomers': 30,
                  'inactiveCustomers': 70, 'totalTransactions': 400, 'totalValue': 120000,
                  'successfulTransactions': 380, 'failedTransactions': 10, 'pendingTransactions': 8,
                  'refundedTransactions': 2, 'totalAgents': 8, 'activeAgents': 6, 'inactiveAgents': 2,
                  'ownRecordedCommission': 24},
                'previous': {'totalTransactions': 300}, 'definitions': {},
                'weekly': [{'at': '2026-11-15T23:00:00Z', 'transactions': 400}],
                'monthly': [{'at': '2026-10-31T23:00:00Z', 'transactions': 400}],
              },
              'transactions' => {
                'total': 1, 'page': 1, 'totalPages': 1,
                'items': [{'_id': 'tx', 'reference': 'REFERENCE-LOCAL-ONLY',
                  'customerId': {'fullName': 'Disposable Example Customer', 'phone': '08000000000'},
                  'serviceType': 'ELECTRICITY', 'amount': 123456789, 'status': 'SUCCESSFUL',
                  'provider': 'TEST_ONLY', 'createdAt': '2026-11-17T12:00:00Z'}],
              },
              'leaderboard' => {'items': [{'id': 'agent', 'name': 'Disposable Aggregator Example',
                'role': 'AGENT', 'rank': 1, 'state': 'KADUNA', 'transactions': 400,
                'successfulValue': 123456789.56, 'newCustomers': 6, 'achievementPercent': 123.456}]},
              'targets' => {'items': [], 'canManage': role != 'AGENT'},
              'teams' => {'total': 1, 'page': 1, 'totalPages': 1,
                'items': [{'_id': 'agent', 'fullName': 'Disposable Aggregator Example',
                  'role': 'AGENT', 'state': 'KADUNA', 'zone': 'NORTH', 'status': 'ACTIVE',
                  'performance': {'transactions': 4, 'successful': 3, 'activeInPeriod': true}}]},
              _ => <String, dynamic>{},
            };
            return http.Response(jsonEncode({'success': true, 'data': data}), 200);
          }));
        for (final section in ['Dashboard', 'Transactions', 'Performance', 'Marketing', 'Team Management', 'Reports']) {
          await tester.pumpWidget(MaterialApp(home: ManagementDashboardScreen(
            key: ValueKey('$role-$width-$section'), role: role, initialSection: section, api: api)));
          await tester.pumpAndSettle();
          expect(tester.takeException(), isNull, reason: '$role/$section/$width must not overflow');
          expect(find.textContaining('BRM'), findsNothing);
        }
      });
    }
  }
}

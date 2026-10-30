import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:servicepay_app/branch_manager/branch_manager_operations_screen.dart';
import 'package:servicepay_app/services/session_store.dart';
import 'package:shared_preferences/shared_preferences.dart';

Map<String, dynamic> _reportResponse() => <String, dynamic>{
      'success': true,
      'count': 1,
      'transactions': <Map<String, dynamic>>[
        <String, dynamic>{
          'reference': 'SPAY-123456',
          'serviceType': 'DELIVERY',
          'amount': 2400,
          'status': 'SUCCESSFUL',
          'createdAt': '2026-08-31T10:00:00.000Z',
        },
      ],
      'metrics': <String, dynamic>{
        'revenue': 999999,
        'revenueBasis': 'NON_ADDITIVE_OPERATIONAL_VALUE_NOT_RECONCILED_REVENUE',
        'deliveries': <String, dynamic>{
          'operations': <String, dynamic>{
            'total': 41,
            'today': 7,
            'pending': 8,
            'assigned': 4,
            'inTransit': 3,
            'delivered': 19,
            'cancelled': 2,
            'failed': 1,
            'unclassified': 4,
            'activeRiders': 5,
            'deliveredPercent': 46.3,
            'localOrders': 31,
            'interstateOrders': 10,
            'rawStatuses': <String, dynamic>{'PENDING_PICKUP': 8},
            'lifecycle': <String, dynamic>{'CREATED': 41},
            'financial': <String, dynamic>{
              'grossOrderValue': 88740,
              'recordedPaidValue': 56280,
              'unpaidValue': 10850,
              'refundedValue': 1360,
              'recordedRiderCommissions': 4970,
              'operationalExpenses': null,
              'reconciledProfit': null,
              'estimatedNetEarnings': null,
              'basis': 'Confirmed server-side delivery records.',
              'attribution': 'Fees attributed to origin branch only.',
              'limitations': <String>['Not a reconciled ledger.'],
            },
          },
        },
      },
    };

Future<void> _pump(
  WidgetTester tester, {
  required List<String> permissions,
  required http.Client client,
}) async {
  tester.view.devicePixelRatio = 1;
  tester.view.physicalSize = const Size(360, 800);
  addTearDown(tester.view.reset);
  await tester.pumpWidget(MaterialApp(
    home: BranchManagerOperationsScreen(
      view: BranchOperationsView.reports,
      permissions: permissions,
      httpClient: client,
    ),
  ));
  for (int frame = 0; frame < 6; frame++) {
    await tester.pump(const Duration(milliseconds: 100));
  }
}

Future<void> _advance(WidgetTester tester) async {
  for (int frame = 0; frame < 6; frame++) {
    await tester.pump(const Duration(milliseconds: 100));
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUp(() async {
    SharedPreferences.setMockInitialValues(<String, Object>{});
    await SessionStore.writeToken('branch-report-token');
  });
  tearDown(SessionStore.clear);

  testWidgets('report filters and populated operations render at mobile width',
      (WidgetTester tester) async {
    final List<Uri> requested = <Uri>[];
    final MockClient client = MockClient((http.Request request) async {
      requested.add(request.url);
      return http.Response(jsonEncode(_reportResponse()), 200);
    });

    await _pump(tester, permissions: const <String>[], client: client);
    expect(find.byKey(const Key('branch-report-delivery-summary')),
        findsOneWidget);
    expect(find.text('Delivery orders'), findsOneWidget);
    expect(find.text('41'), findsWidgets);
    expect(find.text('Interstate orders'), findsOneWidget);
    expect(find.text('Recorded paid delivery fees'), findsNothing);
    expect(find.text('Operational expenses'), findsNothing);
    expect(find.text('999,999'), findsNothing);
    expect(find.textContaining('non-additive operational activity'),
        findsOneWidget);

    await tester.ensureVisible(find.byKey(const Key('branch-report-module')));
    await tester.tap(find.byKey(const Key('branch-report-module')));
    await _advance(tester);
    await tester.tap(find.text('DELIVERY').last);
    await _advance(tester);
    await tester.ensureVisible(find.byKey(const Key('branch-report-status')));
    await tester.tap(find.byKey(const Key('branch-report-status')));
    await _advance(tester);
    await tester.tap(find.text('FAILED').last);
    await _advance(tester);
    await tester.enterText(
      find.byKey(const Key('branch-report-staff-id')),
      'staff-17',
    );
    await tester.tap(find.byKey(const Key('branch-report-apply')));
    await _advance(tester);

    expect(requested.last.path, '/api/branches/reports');
    expect(requested.last.queryParameters, <String, String>{
      'module': 'DELIVERY',
      'status': 'FAILED',
      'staffId': 'staff-17',
    });
    await tester.tap(find.byKey(const Key('branch-report-print')));
    await _advance(tester);
    expect(find.text('Report print preview is available in a web browser.'),
        findsOneWidget);
    expect(tester.takeException(), isNull);
    client.close();
  });

  testWidgets(
      'finance-approved report shows recorded labels and unavailable values',
      (WidgetTester tester) async {
    final MockClient client = MockClient((http.Request request) async =>
        http.Response(jsonEncode(_reportResponse()), 200));

    await _pump(
      tester,
      permissions: const <String>['branch.finance.view'],
      client: client,
    );
    expect(find.byKey(const Key('branch-report-delivery-summary')),
        findsOneWidget);

    expect(find.text('Recorded paid delivery fees'), findsOneWidget);
    expect(find.text('Recorded refunds'), findsOneWidget);
    expect(find.text('Recorded rider commissions'), findsOneWidget);
    expect(find.text('₦56,280'), findsOneWidget);
    expect(find.text('₦1,360'), findsOneWidget);
    expect(find.text('₦4,970'), findsOneWidget);
    expect(find.text('Operational expenses'), findsOneWidget);
    expect(find.text('Reconciled profit'), findsOneWidget);
    expect(find.text('Estimated net earnings'), findsOneWidget);
    expect(find.text('Unavailable'), findsNWidgets(3));
    expect(find.text('999,999'), findsNothing);
    expect(tester.takeException(), isNull);
    client.close();
  });
}

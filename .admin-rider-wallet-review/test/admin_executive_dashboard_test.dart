import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:servicepay_app/admin/admin_executive_dashboard_screen.dart';
import 'package:servicepay_app/admin/admin_permissions.dart';

Map<String, dynamic> metric(dynamic value, {bool available = true}) => {
      'available': available,
      'value': available ? value : null,
      if (!available) 'reason': 'Not available for this staff role.',
    };

Map<String, dynamic> executiveData({
  bool restricted = false,
  bool empty = false,
}) {
  final transactions = restricted ? metric(null, available: false) : metric(14);
  return {
    'generatedAt': '2026-08-30T12:00:00.000Z',
    'kpis': {
      'totalCustomers':
          restricted ? metric(null, available: false) : metric(120),
      'activeCustomers':
          restricted ? metric(null, available: false) : metric(95),
      'totalWalletBalance':
          restricted ? metric(null, available: false) : metric(250000.50),
      'todayTransactionVolume': transactions,
      'todayTransactionValue':
          restricted ? metric(null, available: false) : metric(48000),
      'successfulTransactions':
          restricted ? metric(null, available: false) : metric(10),
      'pendingTransactions':
          restricted ? metric(null, available: false) : metric(2),
      'failedTransactions':
          restricted ? metric(null, available: false) : metric(2),
      'pendingWithdrawals': metric(null, available: false),
      'pendingKycReviews':
          restricted ? metric(null, available: false) : metric(3),
      'activeRiders': restricted ? metric(null, available: false) : metric(8),
      'pendingSolarApplications': metric(null, available: false),
      'totalAgentsAggregators':
          restricted ? metric(null, available: false) : metric(22),
      'totalManagers': restricted ? metric(null, available: false) : metric(6),
      'totalBranchManagers':
          restricted ? metric(null, available: false) : metric(4),
      'totalBranches': metric(null, available: false),
    },
    'comparisons': {
      'transactionVolume': empty ? null : 8.4,
      'transactionValue': null,
      'successfulTransactions': null,
    },
    'operations': {
      'transactionsToday': transactions,
      'transfers': restricted ? metric(null, available: false) : metric(4),
      'withdrawals': metric(null, available: false),
      'airtime': restricted ? metric(null, available: false) : metric(2),
      'data': restricted ? metric(null, available: false) : metric(3),
      'electricity': restricted ? metric(null, available: false) : metric(1),
      'delivery': restricted ? metric(null, available: false) : metric(2),
      'marketplace': metric(null, available: false),
      'solar': metric(null, available: false),
    },
    'performance': {
      'series': empty
          ? []
          : [
              {
                'date': '2026-08-30',
                'successful': 10,
                'pending': 2,
                'failed': 2,
                'value': 48000,
              }
            ],
    },
    'attention': {
      'pendingKyc': restricted ? null : 3,
      'pendingWithdrawals': null,
      'failedTransactions': restricted ? null : 2,
      'pendingDeliveries': restricted ? null : 2,
      'unresolvedSupport': null,
      'pendingSolar': null,
    },
    'activity': restricted || empty
        ? []
        : [
            {
              'actor': 'ServicePay system',
              'action': 'Transaction recorded',
              'target': 'SP-100',
              'service': 'TRANSFER',
              'amount': 12000,
              'status': 'SUCCESSFUL',
              'time': '2026-08-30T11:00:00.000Z',
            }
          ],
    'health': {
      'backend': metric('Operational'),
      'database': metric('Operational'),
      'authentication': metric('Operational'),
      'email': metric(null, available: false),
      'providers': metric(null, available: false),
    },
    'exports': [
      {'label': 'CSV executive report', 'format': 'csv', 'available': true},
    ],
  };
}

Widget harness({
  required Future<Map<String, dynamic>> Function(String) loader,
  required AdminAccess access,
  ValueChanged<String>? onOpenModule,
}) {
  return MaterialApp(
    home: AdminExecutiveDashboardScreen(
      dashboardLoader: loader,
      initialAccess: access,
      onOpenModule: onOpenModule,
    ),
  );
}

Future<void> scrollTo(WidgetTester tester, Finder target) {
  return tester.scrollUntilVisible(
    target,
    500,
    scrollable: find.byType(Scrollable).first,
  );
}

void main() {
  testWidgets('renders real executive sections and authorized actions',
      (tester) async {
    final opened = <String>[];
    await tester.pumpWidget(
      harness(
        loader: (_) async => executiveData(),
        access: const AdminAccess(role: 'HEAD_OFFICE', permissions: <String>{}),
        onOpenModule: opened.add,
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Executive Command Center'), findsOneWidget);
    expect(find.text('120'), findsOneWidget);
    expect(find.text('₦250,000.50'), findsOneWidget);
    expect(find.text('↑ 8.4% vs previous period'), findsOneWidget);
    for (final label in const [
      'Total Customers',
      'Active Customers',
      'Total Customer Wallet Balance',
      'Today’s Transaction Volume',
      'Today’s Transaction Value',
      'Successful Transactions',
      'Pending Transactions',
      'Failed Transactions',
      'Pending Withdrawals',
      'Pending KYC Reviews',
      'Active Riders',
      'Pending Solar Applications',
      'Total Agents / Aggregators',
      'Total Managers',
      'Total Branch Managers',
      'Total Branches',
    ]) {
      expect(find.text(label), findsOneWidget);
    }
    await scrollTo(tester, find.text('Live Operations Overview'));
    expect(find.text('Live Operations Overview'), findsOneWidget);
    await scrollTo(tester, find.text('Transaction Performance'));
    expect(find.text('Transaction Performance'), findsOneWidget);
    expect(find.text('Attention Required'), findsOneWidget);
    await scrollTo(tester, find.text('System Health'));
    expect(find.text('System Health'), findsOneWidget);
    await scrollTo(tester, find.text('Recent Critical Activity'));
    expect(find.text('Recent Critical Activity'), findsOneWidget);
    await scrollTo(tester, find.text('Quick Admin Actions'));
    expect(find.text('Quick Admin Actions'), findsOneWidget);
    expect(find.text('Review KYC'), findsOneWidget);

    await tester.tap(find.text('View Transactions'));
    expect(opened, contains('transactions'));
  });

  testWidgets('uses period-aware labels for multi-day reporting',
      (tester) async {
    await tester.pumpWidget(
      harness(
        loader: (_) async => executiveData(),
        access: const AdminAccess(role: 'HEAD_OFFICE', permissions: <String>{}),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('7 Days'));
    await tester.pumpAndSettle();
    expect(find.text('7-day Transaction Volume'), findsOneWidget);
    expect(find.text('Today’s Transaction Volume'), findsNothing);
  });

  testWidgets('restricted staff sees only permitted quick actions',
      (tester) async {
    await tester.pumpWidget(
      harness(
        loader: (_) async => executiveData(restricted: true),
        access: const AdminAccess(
          role: 'STAFF',
          permissions: {'dashboard.view', 'transactions.view'},
        ),
      ),
    );
    await tester.pumpAndSettle();

    await scrollTo(tester, find.text('Quick Admin Actions'));
    expect(find.text('View Transactions'), findsOneWidget);
    expect(find.text('Fintech Control Center'), findsOneWidget);
    expect(find.text('Review KYC'), findsNothing);
    expect(find.text('Support Tickets'), findsNothing);
    expect(find.text('Send Customer Email'), findsNothing);
  });

  testWidgets('delegated report exporter sees CSV without audit permission',
      (tester) async {
    await tester.pumpWidget(
      harness(
        loader: (_) async => executiveData(restricted: true),
        access: const AdminAccess(
          role: 'STAFF',
          permissions: {'dashboard.view', 'reports.export'},
        ),
      ),
    );
    await tester.pumpAndSettle();
    await scrollTo(tester, find.text('CSV executive report'));
    expect(find.text('CSV executive report'), findsOneWidget);
  });

  testWidgets('renders empty and safe unavailable states', (tester) async {
    await tester.pumpWidget(
      harness(
        loader: (_) async => executiveData(empty: true),
        access: const AdminAccess(role: 'HEAD_OFFICE', permissions: <String>{}),
      ),
    );
    await tester.pumpAndSettle();

    await scrollTo(
      tester,
      find.text('No transaction activity in this period.'),
    );
    expect(
        find.text('No transaction activity in this period.'), findsOneWidget);
    await scrollTo(tester, find.text('System Health'));
    expect(find.text('Not checked'), findsNWidgets(2));
  });

  testWidgets('shows a safe API error and can retry', (tester) async {
    await tester.pumpWidget(
      harness(
        loader: (_) async => throw Exception('API temporarily unavailable'),
        access: const AdminAccess(role: 'HEAD_OFFICE', permissions: <String>{}),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Executive dashboard unavailable'), findsOneWidget);
    expect(find.text('API temporarily unavailable'), findsOneWidget);
    expect(find.text('Try again'), findsOneWidget);
  });

  testWidgets('deduplicates simultaneous refresh requests', (tester) async {
    var calls = 0;
    final refresh = Completer<Map<String, dynamic>>();
    Future<Map<String, dynamic>> loader(String _) {
      calls += 1;
      if (calls == 1) return Future.value(executiveData());
      return refresh.future;
    }

    await tester.pumpWidget(
      harness(
        loader: loader,
        access: const AdminAccess(role: 'HEAD_OFFICE', permissions: <String>{}),
      ),
    );
    await tester.pumpAndSettle();

    final button = find.byKey(const Key('admin-executive-refresh'));
    await tester.tap(button);
    await tester.tap(button);
    await tester.pump();
    expect(calls, 2);

    refresh.complete(executiveData());
    await tester.pumpAndSettle();
  });

  testWidgets('stays overflow-free on mobile and desktop', (tester) async {
    for (final size in const [
      Size(360, 800),
      Size(800, 1000),
      Size(1440, 1000),
    ]) {
      tester.view.physicalSize = size;
      tester.view.devicePixelRatio = 1;
      await tester.pumpWidget(
        harness(
          loader: (_) async => executiveData(),
          access:
              const AdminAccess(role: 'HEAD_OFFICE', permissions: <String>{}),
        ),
      );
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
    }
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
  });
}

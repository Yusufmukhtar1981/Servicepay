import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:servicepay_app/branch_manager/branch_manager_dashboard_api.dart';
import 'package:servicepay_app/branch_manager/branch_manager_dashboard_screen.dart';
import 'package:servicepay_app/branch_manager/branch_counter_api.dart';
import 'package:servicepay_app/branch_manager/branch_counter_screen.dart';
import 'package:servicepay_app/login_screen.dart';
import 'package:shared_preferences/shared_preferences.dart';

class _DashboardApi implements BranchManagerDashboardApi {
  _DashboardApi({
    this.empty = false,
    this.managerName = 'Ada Manager',
  });

  final bool empty;
  final String managerName;
  String? lastStartDate;
  String? lastEndDate;

  @override
  Future<BranchManagerDashboard> loadDashboard({
    String? startDate,
    String? endDate,
  }) async {
    lastStartDate = startDate;
    lastEndDate = endDate;
    return BranchManagerDashboard(
      branch: const <String, dynamic>{
        'name': 'Ikeja Branch',
        'code': 'IKJ',
        'status': 'ACTIVE',
        'lga': 'Ikeja',
        'state': 'Lagos',
      },
      manager: <String, dynamic>{
        'name': managerName,
        'staffId': 'SP-001',
      },
      period: const <String, dynamic>{},
      periods: const <Map<String, dynamic>>[],
      targets: empty
          ? const <Map<String, dynamic>>[]
          : const <Map<String, dynamic>>[
              <String, dynamic>{
                'metric': 'Collections',
                'period': 'September 2026',
                'target': 1000000,
                'actual': 725000,
                'status': 'ON_TRACK',
              },
            ],
      approvals: empty
          ? const <Map<String, dynamic>>[]
          : const <Map<String, dynamic>>[
              <String, dynamic>{'name': 'SUBMITTED', 'value': 3},
            ],
      staff: empty
          ? const <Map<String, dynamic>>[]
          : const <Map<String, dynamic>>[
              <String, dynamic>{
                'fullName': 'Ada Manager',
                'jobTitle': 'Branch Manager',
                'status': 'ACTIVE',
              },
            ],
      reports: const <Map<String, dynamic>>[],
      modules: const <Map<String, dynamic>>[
        <String, dynamic>{'name': 'DELIVERY'},
        <String, dynamic>{'name': 'MARKETPLACE'},
      ],
      permissions: const <String>[
        'branch.customers.create',
        'branch.approvals.submit',
        'branch.reports.view',
        'branch.delivery.manage',
      ],
      openRequests: 2,
      metrics: empty
          ? const <String, dynamic>{}
          : const <String, dynamic>{
              'transactions': <String, dynamic>{
                'count': 18,
                'value': 540000,
              },
              'transactionStatuses': <String, dynamic>{
                'SUCCESSFUL': 15,
                'PENDING': 2,
                'FAILED': 1,
              },
              'customerSummary': <String, dynamic>{
                'active': 40,
                'total': 44,
              },
              'staffSummary': <String, dynamic>{
                'active': 8,
                'total': 9,
              },
              'revenue': 580000,
              'transactionTrend': <Map<String, dynamic>>[
                <String, dynamic>{
                  '_id': '2026-09-01',
                  'count': 18,
                  'value': 540000,
                  'successful': 15,
                  'pending': 2,
                  'failed': 1,
                },
              ],
              'deliveries': <String, dynamic>{'count': 4, 'value': 12000},
              'marketplace': <String, dynamic>{'count': 3, 'value': 28000},
              'recentTransactions': <Map<String, dynamic>>[
                <String, dynamic>{
                  'reference': 'SPAY-123456',
                  'serviceType': 'AIRTIME',
                  'amount': 2500,
                  'status': 'SUCCESSFUL',
                },
              ],
            },
    );
  }
}

Future<void> _pumpAt(
  WidgetTester tester,
  Size size,
  BranchManagerDashboardApi api, {
  ValueChanged<String>? onAction,
  BranchCounterApi? counterApi,
  double textScale = 1,
}) async {
  tester.view.devicePixelRatio = 1;
  tester.view.physicalSize = size;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(
    MaterialApp(
      builder: (BuildContext context, Widget? child) => MediaQuery(
        data: MediaQuery.of(context)
            .copyWith(textScaler: TextScaler.linear(textScale)),
        child: child!,
      ),
      home: BranchManagerDashboardScreen(
        api: api,
        counterApi: counterApi ?? _CounterDashboardApi(),
        onAction: onAction,
      ),
    ),
  );
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('shows branch identity, compact KPIs and reporting period',
      (WidgetTester tester) async {
    final _DashboardApi api = _DashboardApi();
    await _pumpAt(tester, const Size(430, 900), api);

    expect(find.text('Ikeja Branch'), findsOneWidget);
    expect(find.text('IKJ'), findsOneWidget);
    expect(find.text('Ada Manager'), findsOneWidget);
    expect(find.text('Reporting period'), findsOneWidget);
    await tester.scrollUntilVisible(
      find.text('Transactions'),
      300,
      scrollable: find.byType(Scrollable).first,
    );
    expect(find.text('Transactions'), findsOneWidget);
    expect(find.text('18'), findsWidgets);
    expect(api.lastStartDate, isNotNull);
    expect(api.lastEndDate, api.lastStartDate);
    expect(tester.takeException(), isNull);
  });

  testWidgets('period selection reloads the branch-scoped endpoint',
      (WidgetTester tester) async {
    final _DashboardApi api = _DashboardApi();
    await _pumpAt(tester, const Size(430, 900), api);
    final String? today = api.lastStartDate;

    await tester.tap(find.text('7 Days'));
    await tester.pumpAndSettle();

    expect(api.lastStartDate, isNot(today));
    expect(api.lastEndDate, isNotNull);
    expect(tester.takeException(), isNull);
  });

  testWidgets('permission-aware quick action invokes the host route callback',
      (WidgetTester tester) async {
    final _DashboardApi api = _DashboardApi();
    String? action;
    await _pumpAt(
      tester,
      const Size(430, 900),
      api,
      onAction: (String value) => action = value,
    );

    await tester.scrollUntilVisible(
      find.text('Register customer'),
      450,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.tap(find.text('Register customer'));
    await tester.pump();

    expect(action, 'customer');
    expect(find.text('Manage staff'), findsNothing);
    expect(tester.takeException(), isNull);
  });

  for (final Size size in <Size>[
    const Size(360, 800),
    const Size(430, 900),
    const Size(768, 1024),
    const Size(1280, 900),
  ]) {
    testWidgets('has no overflow at ${size.width.toInt()}px',
        (WidgetTester tester) async {
      await _pumpAt(tester, size, _DashboardApi());
      await tester.fling(
          find.byType(Scrollable).first, const Offset(0, -5000), 5000);
      await tester.pumpAndSettle();
      expect(find.text('Reports & modules'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });
  }

  testWidgets('shows useful empty states without fabricated values',
      (WidgetTester tester) async {
    await _pumpAt(tester, const Size(430, 900), _DashboardApi(empty: true));
    await tester.scrollUntilVisible(
      find.text('No targets have been assigned for this period.'),
      450,
      scrollable: find.byType(Scrollable).first,
    );
    expect(
      find.text('No targets have been assigned for this period.'),
      findsOneWidget,
    );
    expect(tester.takeException(), isNull);
  });

  testWidgets('long manager identity remains constrained on a narrow screen',
      (WidgetTester tester) async {
    await _pumpAt(
      tester,
      const Size(360, 800),
      _DashboardApi(
        managerName:
            'A very long branch manager name that must never widen the header',
      ),
    );
    expect(tester.takeException(), isNull);
  });

  testWidgets(
      'logout confirms, clears the session and removes dashboard history',
      (WidgetTester tester) async {
    SharedPreferences.setMockInitialValues(<String, Object>{
      'auth_token': 'test-token',
      'refresh_token': 'test-refresh-token',
      'user_id': 'manager-id',
      'user_role': 'BRANCH_MANAGER',
      'branch_id': 'branch-id',
      'branch_dashboard_cache': 'sensitive-cache',
    });
    await _pumpAt(tester, const Size(430, 900), _DashboardApi());

    await tester.tap(find.byKey(const Key('branch-manager-profile-menu')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Logout'));
    await tester.pumpAndSettle();

    expect(
      find.text('Are you sure you want to log out?'),
      findsOneWidget,
    );

    await tester.tap(find.byKey(const Key('branch-manager-confirm-logout')));
    await tester.pumpAndSettle();

    final SharedPreferences preferences = await SharedPreferences.getInstance();
    expect(preferences.getString('auth_token'), isNull);
    expect(preferences.getString('refresh_token'), isNull);
    expect(preferences.getString('user_id'), isNull);
    expect(preferences.getString('branch_id'), isNull);
    expect(find.byType(BranchManagerDashboardScreen), findsNothing);
    expect(find.byType(LoginScreen), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('navigation exposes only permitted branch workspaces',
      (WidgetTester tester) async {
    await _pumpAt(tester, const Size(430, 900), _DashboardApi());

    await tester.tap(find.byKey(const Key('branch-manager-navigation')));
    await tester.pumpAndSettle();

    final Finder sheet = find.byType(BottomSheet);
    expect(
      find.descendant(of: sheet, matching: find.text('Branch workspace')),
      findsOneWidget,
    );
    expect(
      find.descendant(of: sheet, matching: find.text('Customers')),
      findsOneWidget,
    );
    expect(
      find.descendant(of: sheet, matching: find.text('Reports')),
      findsOneWidget,
    );
    expect(
      find.descendant(of: sheet, matching: find.text('Branch staff')),
      findsNothing,
    );
    expect(
      find.descendant(of: sheet, matching: find.text('Transactions')),
      findsNothing,
    );
    expect(tester.takeException(), isNull);
  });

  testWidgets(
      'delivery counter section is above fold at phone, tablet, desktop and enlarged text',
      (WidgetTester tester) async {
    for (final (Size, double) scenario in <(Size, double)>[
      (const Size(360, 800), 1),
      (const Size(768, 1024), 1),
      (const Size(1280, 900), 1),
      (const Size(360, 800), 1.7),
    ]) {
      await _pumpAt(
        tester,
        scenario.$1,
        _DashboardApi(),
        counterApi: _CounterDashboardApi(),
        textScale: scenario.$2,
      );
      final Rect section = tester
          .getRect(find.byKey(const Key('branch-delivery-dashboard-section')));
      expect(section.top, greaterThanOrEqualTo(0));
      expect(
        tester.getRect(find.byKey(const Key('branch-delivery-create'))).bottom,
        lessThanOrEqualTo(scenario.$1.height),
        reason:
            'primary counter action should be visible without scrolling at ${scenario.$1.width}px / ${scenario.$2}x',
      );
      expect(find.text('CREATE DELIVERY ORDER'), findsOneWidget);
      expect(find.text('View Orders'), findsOneWidget);
      expect(find.text('Search / Track Order'), findsOneWidget);
      expect(find.text('Print / Reprint Receipt'), findsOneWidget);
      expect(tester.takeException(), isNull);
    }
  });

  testWidgets('create action opens the existing parcel creation form',
      (WidgetTester tester) async {
    SharedPreferences.setMockInitialValues(
        <String, Object>{'user_id': 'manager-1'});
    final _CounterDashboardApi counter = _CounterDashboardApi();
    await _pumpAt(
      tester,
      const Size(430, 900),
      _DashboardApi(),
      counterApi: counter,
    );

    await tester.tap(find.byKey(const Key('branch-delivery-create')));
    await tester.pumpAndSettle();
    expect(find.byType(BranchCounterCreateScreen), findsOneWidget);
    expect(counter.configCalls, 1);
    expect(tester.takeException(), isNull);
  });

  testWidgets('view orders and search actions open the existing order list',
      (WidgetTester tester) async {
    SharedPreferences.setMockInitialValues(
        <String, Object>{'user_id': 'manager-1'});
    final _CounterDashboardApi counter = _CounterDashboardApi();
    await _pumpAt(
      tester,
      const Size(430, 900),
      _DashboardApi(),
      counterApi: counter,
    );
    await tester.tap(find.byKey(const Key('branch-delivery-action-orders')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('counter-search')), findsOneWidget);
    expect(counter.listCalls, greaterThan(0));
    expect(tester.takeException(), isNull);
  });

  testWidgets(
      'search and print actions focus the list and give receipt guidance',
      (WidgetTester tester) async {
    SharedPreferences.setMockInitialValues(
        <String, Object>{'user_id': 'manager-1'});
    await _pumpAt(
      tester,
      const Size(430, 900),
      _DashboardApi(),
      counterApi: _CounterDashboardApi(),
    );
    await tester.tap(find.byKey(const Key('branch-delivery-action-search')));
    await tester.pumpAndSettle();
    expect(find.textContaining('Search by tracking number'), findsOneWidget);
    expect(find.byKey(const Key('counter-search')), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('print action explains how to open A4 or Thermal receipt',
      (WidgetTester tester) async {
    SharedPreferences.setMockInitialValues(
        <String, Object>{'user_id': 'manager-1'});
    await _pumpAt(
      tester,
      const Size(430, 900),
      _DashboardApi(),
      counterApi: _CounterDashboardApi(),
    );
    await tester.tap(find.byKey(const Key('branch-delivery-action-print')));
    await tester.pumpAndSettle();
    expect(find.textContaining('choose A4 or Thermal receipt'), findsOneWidget);
    expect(find.byKey(const Key('counter-search')), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('delivery stats use API values and expose retry when unavailable',
      (WidgetTester tester) async {
    final _CounterDashboardApi counter = _CounterDashboardApi();
    await _pumpAt(
      tester,
      const Size(430, 900),
      _DashboardApi(),
      counterApi: counter,
    );
    expect(find.text('7'), findsOneWidget);
    expect(find.text('2'), findsWidgets);
    expect(find.text('₦18,450'), findsOneWidget);

    counter.failStats = true;
    await tester.tap(find.byTooltip('Refresh delivery stats'));
    await tester.pumpAndSettle();
    expect(find.text('Unable to load counter stats'), findsOneWidget);
    expect(find.text('Retry'), findsOneWidget);
    await tester.tap(find.text('Retry'));
    await tester.pumpAndSettle();
    expect(find.text('Unable to load counter stats'), findsNothing);
    expect(counter.listCalls, 3);
    expect(tester.takeException(), isNull);
  });

  testWidgets('delivery section follows existing module and permission guards',
      (WidgetTester tester) async {
    final _DashboardApi noPermission = _DashboardApi();
    await _pumpAt(tester, const Size(430, 900), noPermission,
        counterApi: _CounterDashboardApi());
    expect(find.byKey(const Key('branch-delivery-dashboard-section')),
        findsOneWidget);

    for (final BranchManagerDashboardApi guardedApi
        in <BranchManagerDashboardApi>[
      _DashboardApiWithoutDelivery(),
      _DashboardApiMissingPermission(),
      _DashboardApiMissingModule(),
    ]) {
      await tester.pumpWidget(const SizedBox.shrink());
      await tester.pumpWidget(MaterialApp(
        home: BranchManagerDashboardScreen(
          key: ValueKey<String>(
              'guard-test-dashboard-${guardedApi.runtimeType}'),
          api: guardedApi,
          counterApi: _CounterDashboardApi(),
        ),
      ));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('branch-delivery-dashboard-section')),
          findsNothing);
    }
    expect(tester.takeException(), isNull);
  });
}

class _DashboardApiWithoutDelivery extends _DashboardApi {
  @override
  Future<BranchManagerDashboard> loadDashboard({
    String? startDate,
    String? endDate,
  }) async {
    final BranchManagerDashboard source =
        await super.loadDashboard(startDate: startDate, endDate: endDate);
    return _copyDashboard(
      source,
      modules: const <Map<String, dynamic>>[
        <String, dynamic>{'name': 'MARKETPLACE'},
      ],
      permissions: const <String>['branch.reports.view'],
    );
  }
}

class _DashboardApiMissingPermission extends _DashboardApi {
  @override
  Future<BranchManagerDashboard> loadDashboard({
    String? startDate,
    String? endDate,
  }) async =>
      _copyDashboard(
        await super.loadDashboard(startDate: startDate, endDate: endDate),
        permissions: const <String>['branch.reports.view'],
      );
}

class _DashboardApiMissingModule extends _DashboardApi {
  @override
  Future<BranchManagerDashboard> loadDashboard({
    String? startDate,
    String? endDate,
  }) async =>
      _copyDashboard(
        await super.loadDashboard(startDate: startDate, endDate: endDate),
        modules: const <Map<String, dynamic>>[
          <String, dynamic>{'name': 'MARKETPLACE'},
        ],
      );
}

BranchManagerDashboard _copyDashboard(
  BranchManagerDashboard source, {
  List<Map<String, dynamic>>? modules,
  List<String>? permissions,
}) =>
    BranchManagerDashboard(
      branch: source.branch,
      manager: source.manager,
      period: source.period,
      periods: source.periods,
      targets: source.targets,
      approvals: source.approvals,
      staff: source.staff,
      reports: source.reports,
      modules: modules ?? source.modules,
      permissions: permissions ?? source.permissions,
      openRequests: source.openRequests,
      metrics: source.metrics,
    );

class _CounterDashboardApi implements BranchCounterApi {
  int configCalls = 0;
  int listCalls = 0;
  bool failStats = false;

  @override
  Future<Map<String, dynamic>> loadConfig() async {
    configCalls++;
    return <String, dynamic>{
      'branch': <String, dynamic>{'name': 'Ikeja', 'state': 'Lagos'},
      'routes': <Map<String, dynamic>>[],
      'canConfirmPayments': false,
    };
  }

  @override
  Future<Map<String, dynamic>> listOrders({
    required String status,
    required String search,
    required int page,
  }) async {
    listCalls++;
    if (failStats && listCalls == 2) {
      throw const CounterApiException('Unable to load counter stats');
    }
    return <String, dynamic>{
      'orders': <Map<String, dynamic>>[],
      'stats': <String, dynamic>{
        'todayOrders': 7,
        'pendingPickup': 2,
        'inTransit': 3,
        'delivered': 4,
        'todayRevenue': 18450,
      },
      'page': page,
      'total': 0,
    };
  }

  @override
  Future<Map<String, dynamic>> quote(Map<String, dynamic> draft) async =>
      <String, dynamic>{};
  @override
  Future<Map<String, dynamic>> createOrder(Map<String, dynamic> draft,
          {required String quoteToken, required String idempotencyKey}) async =>
      <String, dynamic>{};
  @override
  Future<Map<String, dynamic>> getOrder(String kind, String id) async =>
      <String, dynamic>{};
  @override
  Future<Map<String, dynamic>> submitPaymentEvidence(String kind, String id,
          {required String reference, required String note}) async =>
      <String, dynamic>{};
  @override
  Future<Map<String, dynamic>> confirmPayment(String kind, String id,
          {required String reference, required String note}) async =>
      <String, dynamic>{};
  @override
  Future<Map<String, dynamic>> cancelOrder(String kind, String id) async =>
      <String, dynamic>{};
  @override
  Future<Map<String, dynamic>> getReceipt(String kind, String id,
          {required String layout}) async =>
      <String, dynamic>{};
  @override
  Future<void> recordPrintEvent(String kind, String id,
      {required bool reprint, required String layout}) async {}
}

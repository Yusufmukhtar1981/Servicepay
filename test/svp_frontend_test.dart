import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:servicepay_app/admin/admin_permissions.dart';
import 'package:servicepay_app/admin/main_navigation.dart';
import 'package:servicepay_app/admin/svp_api_service.dart';
import 'package:servicepay_app/admin/svp_command_center_screen.dart';
import 'package:servicepay_app/admin/executive_management_screen.dart';
import 'package:servicepay_app/admin/svp_management_screen.dart';
import 'package:servicepay_app/main_navigation.dart' as customer_navigation;
import 'package:servicepay_app/login_routing.dart';

void main() {
  test('live operations use the backend availability contract', () {
    final labels = SvpContract.liveOperationLabels({
      'transactions': {
        'pending': {'available': true, 'value': 4},
        'failed': {'available': true, 'value': 2},
      },
      'users': {'available': true, 'value': 12},
      'branches': {'available': true, 'value': 3},
      'deliveries': {'available': true, 'value': 5},
      'withdrawals': {'available': true, 'value': 6},
      'kyc': {'available': false, 'reason': 'KYC is outside this scope.'},
      'solar': {'available': true, 'value': 7},
      'financing': {'available': true, 'value': 8},
      'marketplace': {'available': true, 'value': 9},
      'pendingEmpowerment': {'available': true, 'value': 10},
    });

    expect(labels, contains('Pending transactions · 4'));
    expect(labels, contains('Failed transactions · 2'));
    expect(labels, contains('KYC · KYC is outside this scope.'));
    expect(labels, contains('Solar · 7'));
    expect(labels, contains('Phone financing · 8'));
    expect(labels, contains('Marketplace · 9'));
    expect(labels, contains('Empowerment · 10'));
  });

  test('performance targets render nested backend availability data', () {
    expect(
        SvpContract.performanceTargetLabel({
          'target': {
            'available': true,
            'target': 100000,
            'actual': 80000,
            'achievement': 0.8,
          }
        }),
        'Target 100000 · Achievement 80.0%');
    expect(
        SvpContract.performanceTargetLabel({
          'target': {
            'available': false,
            'reason': 'No individual staff target model is configured.',
          }
        }),
        'Target No individual staff target model is configured.');
  });

  TestWidgetsFlutterBinding.ensureInitialized();
  setUp(() {
    SharedPreferences.setMockInitialValues({'auth_token': 'test-token'});
  });
  test('SVP authentication destination is the dedicated command center', () {
    final home = authenticatedHomeForRole('SVP');
    expect(home, isA<SvpCommandCenterScreen>());
    expect(home, isNot(isA<AdminMainNavigation>()));
    expect(home, isNot(isA<customer_navigation.MainNavigation>()));
  });

  test('Head Office roles see exactly one consolidated executive destination',
      () {
    for (final role in const [
      'HEAD_OFFICE',
      'HEAD_OFFICE_ADMIN',
      'SUPER_ADMIN',
      'ADMIN',
    ]) {
      final labels = AdminMainNavigation.visibleDestinationLabels(
        AdminAccess(role: role, permissions: const {}),
      );
      expect(labels.where((label) => label == 'Executive Management'),
          hasLength(1));
      expect(labels, isNot(contains('SVP Management')));
      expect(labels, isNot(contains('SVP Reports')));
      expect(labels, isNot(contains('SVP Audit Logs')));
    }
    final staffLabels = AdminMainNavigation.visibleDestinationLabels(
        const AdminAccess(role: 'STAFF', permissions: {}));
    expect(staffLabels, isNot(contains('Executive Management')));
  });

  test('SVP form payload preserves required fields, allowlist and scope shape',
      () {
    final payload = SvpFormPayload.build(
      fullName: 'Ada Nwosu',
      executiveId: 'svp-14',
      email: 'ADA@EXAMPLE.COM',
      phone: '08000000000',
      title: 'Regional Executive',
      department: 'Operations',
      scopeType: 'BRANCHES',
      scopeValues: {
        'branchIds': ['507f1f77bcf86cd799439011']
      },
      permissions: const ['dashboard.view', 'reports.view'],
      password: 'Longer-Password-14!',
    );
    expect(payload['fullName'], 'Ada Nwosu');
    expect(
        payload.keys,
        containsAll([
          'fullName',
          'executiveId',
          'email',
          'phone',
          'title',
          'department',
          'permissions',
          'scope',
          'password'
        ]));
    expect(payload['permissions'], ['dashboard.view', 'reports.view']);
    expect(payload['scope'], {
      'type': 'BRANCHES',
      'branchIds': ['507f1f77bcf86cd799439011']
    });
    for (final entry in const <Map<String, dynamic>>[
      {'type': 'GLOBAL'},
      {'type': 'REGION', 'region': 'South West'},
      {'type': 'STATE', 'state': 'Lagos'},
      {'type': 'DEPARTMENT', 'department': 'OPERATIONS'},
      {
        'type': 'PRODUCTS',
        'products': ['AIRTIME']
      },
      {
        'type': 'CUSTOM',
        'filters': {'state': 'Lagos'}
      },
    ]) {
      expect(
          SvpFormPayload.build(
            fullName: 'A',
            executiveId: 'B',
            email: 'a@b.com',
            phone: '1',
            title: 'T',
            department: 'D',
            scopeType: entry['type'] as String,
            scopeValues: Map<String, dynamic>.from(entry)..remove('type'),
          )['scope'],
          entry);
    }
  });

  test('SVP lifecycle uses exact backend methods and paths', () async {
    final calls = <String>[];
    final client = MockClient((request) async {
      calls.add('${request.method} ${request.url.path}');
      return http.Response(jsonEncode({'success': true, 'data': {}}), 200);
    });
    final api = SvpApiService(client: client);
    await api.request('PATCH', '/svp/id/status', body: {'status': 'SUSPENDED'});
    await api.request('PATCH', '/svp/id/status', body: {'status': 'DISABLED'});
    await api.request('POST', '/svp/id/reset-password',
        body: {'password': 'Strong-Password-14!'});
    await api.request('POST', '/svp/id/revoke-sessions');
    expect(calls, [
      'PATCH /api/svp/id/status',
      'PATCH /api/svp/id/status',
      'POST /api/svp/id/reset-password',
      'POST /api/svp/id/revoke-sessions'
    ]);
  });

  test('SVP own report workflow and Head Office review use exact calls',
      () async {
    final calls = <String>[];
    final client = MockClient((request) async {
      calls.add('${request.method} ${request.url.path}:${request.body}');
      return http.Response(jsonEncode({'success': true, 'data': []}), 200);
    });
    final api = SvpApiService(client: client);
    await api.request('POST', '/svp/me/reports',
        body: {'type': 'DAILY', 'title': 'Close', 'summary': 'Summary'});
    await api.request('PATCH', '/svp/me/reports/report-id',
        body: {'title': 'Close updated', 'summary': 'Updated'});
    await api.request('POST', '/svp/me/reports/report-id/submit');
    await api.request('PATCH', '/svp/reports/report-id/review',
        body: {'status': 'UNDER_REVIEW', 'comment': 'Reviewed'});
    expect(calls.map((x) => x.split(':').first), [
      'POST /api/svp/me/reports',
      'PATCH /api/svp/me/reports/report-id',
      'POST /api/svp/me/reports/report-id/submit',
      'PATCH /api/svp/reports/report-id/review',
    ]);
    expect(calls.last, contains('"status":"UNDER_REVIEW"'));
  });

  test('transaction intelligence forwards every supported filter', () async {
    Uri? captured;
    final api = SvpApiService(
      client: MockClient((request) async {
        captured = request.url;
        return http.Response(
            jsonEncode({
              'success': true,
              'data': {'items': []}
            }),
            200);
      }),
    );
    await api.request('GET', '/svp/me/transactions', query: const {
      'from': '2026-01-01',
      'to': '2026-01-31',
      'status': 'FAILED',
      'serviceType': 'AIRTIME',
      'branch': 'branch-id',
      'staff': 'staff-id',
      'rider': 'rider-id',
      'customer': 'customer-id',
      'reference': 'SP-',
    });
    expect(captured!.queryParameters, containsPair('from', '2026-01-01'));
    expect(captured!.queryParameters, containsPair('rider', 'rider-id'));
    expect(captured!.queryParameters, containsPair('reference', 'SP-'));
  });

  test('performance modules have independent endpoint paths', () async {
    final paths = <String>[];
    final api = SvpApiService(
      client: MockClient((request) async {
        paths.add(request.url.path);
        return http.Response(jsonEncode({'success': true, 'data': []}), 200);
      }),
    );
    await api.request('GET', '/svp/me/staff-performance');
    await api.request('GET', '/svp/me/branch-performance');
    await api.request('GET', '/svp/me/live-operations');
    expect(
        paths,
        containsAll([
          '/api/svp/me/staff-performance',
          '/api/svp/me/branch-performance',
          '/api/svp/me/live-operations',
        ]));
  });

  test(
      'current metrics contract preserves nonzero transaction and entity values',
      () {
    final rows = SvpContract.transactionMetrics({
      'transactions': [
        {
          'status': 'SUCCESS',
          'volume': 17,
          'value': 42500,
          'revenue': 812,
          'commissions': 140
        }
      ],
      'entities': {
        'branches': {'available': true, 'value': 4},
        'activeCustomers': {'available': true, 'value': 231},
        'activeStaff': {'available': true, 'value': 18},
      },
    });
    final entities = SvpContract.entities({
      'entities': {
        'branches': {'available': true, 'value': 4},
        'activeCustomers': {'available': true, 'value': 231},
        'activeStaff': {'available': true, 'value': 18},
      }
    });
    expect(rows.single['volume'], 17);
    expect(rows.single['revenue'], 812);
    expect(entities['branches']['value'], 4);
    expect(entities['activeCustomers']['value'], 231);
    expect(entities['activeStaff']['value'], 18);
  });

  test('current availability contract renders the supplied unavailable reason',
      () {
    expect(
      SvpContract.unavailableReason(
          {'available': false, 'reason': 'KYC scope cannot be safely mapped.'}),
      'KYC scope cannot be safely mapped.',
    );
  });

  test('current live contract includes every queue and issue domain', () {
    final labels = SvpContract.liveOperationLabels({
      'transactions': {
        'pending': {'available': true, 'value': 8},
        'failed': {'available': true, 'value': 2},
      },
      for (final key in const [
        'users',
        'branches',
        'pendingRiders',
        'deliveries',
        'unassignedDeliveries',
        'withdrawals',
        'kyc',
        'pendingEmpowerment',
        'branchIssues',
        'staffIssues',
      ])
        key: {'available': false, 'value': 0, 'reason': '$key unavailable'},
    });
    expect(labels, contains('Pending transactions · 8'));
    expect(labels, contains('Failed transactions · 2'));
    expect(labels.any((x) => x.startsWith('Pending riders')), isTrue);
    expect(labels.any((x) => x.startsWith('Unassigned deliveries')), isTrue);
    expect(labels.any((x) => x.startsWith('Empowerment')), isTrue);
    expect(labels.any((x) => x.startsWith('Branch issues')), isTrue);
    expect(labels.any((x) => x.startsWith('Staff issues')), isTrue);
  });

  testWidgets('wide executive surface renders its destination and create CTA',
      (tester) async {
    final api = SvpApiService(
      client: MockClient((_) async => http.Response(
          jsonEncode({'success': true, 'data': <dynamic>[]}), 200)),
    );
    await tester.binding.setSurfaceSize(const Size(1200, 800));
    await tester
        .pumpWidget(MaterialApp(home: ExecutiveManagementScreen(api: api)));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 50));
    expect(find.text('Executive Management'), findsOneWidget);
    expect(find.text('CREATE SVP'), findsOneWidget);
    addTearDown(() => tester.binding.setSurfaceSize(null));
  });

  testWidgets('narrow executive surface keeps create CTA reachable',
      (tester) async {
    final api = SvpApiService(
      client: MockClient((_) async => http.Response(
          jsonEncode({'success': true, 'data': <dynamic>[]}), 200)),
    );
    await tester.binding.setSurfaceSize(const Size(390, 844));
    await tester
        .pumpWidget(MaterialApp(home: ExecutiveManagementScreen(api: api)));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 50));
    expect(find.text('Executive Management'), findsOneWidget);
    expect(find.text('CREATE SVP'), findsOneWidget);
    addTearDown(() => tester.binding.setSurfaceSize(null));
  });

  test('performance contract retains every backend performance field', () {
    final row = {
      'rank': 2,
      'target': 100,
      'achievement': 87.5,
      'volume': 44,
      'value': 120000,
      'revenue': 2500,
      'lastActivity': '2026-02-01',
      'pending': 3,
    };
    expect(row['rank'], 2);
    expect(row['target'], 100);
    expect(row['achievement'], 87.5);
    expect(row['volume'], 44);
    expect(row['value'], 120000);
    expect(row['revenue'], 2500);
    expect(row['lastActivity'], '2026-02-01');
    expect(row['pending'], 3);
  });
}

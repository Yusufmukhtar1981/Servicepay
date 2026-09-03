import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:servicepay_app/admin/admin_branch_management_api.dart';
import 'package:servicepay_app/admin/admin_branch_management_screen.dart';
import 'package:servicepay_app/admin/admin_permissions.dart';
import 'package:shared_preferences/shared_preferences.dart';

class _BranchApi implements AdminBranchManagementApi {
  _BranchApi({this.targetRows = const <Map<String, dynamic>>[]});
  final List<Map<String, dynamic>> targetRows;

  @override
  Future<List<Map<String, dynamic>>> approvals({String? branchId}) async =>
      <Map<String, dynamic>>[];
  @override
  Future<void> assignManager(String branchId, String userId,
      {String? jobTitle}) async {}
  @override
  Future<void> removeManager(String branchId) async {}
  @override
  Future<void> assignMember(String branchId, String userId,
      {String? jobTitle}) async {}
  @override
  Future<Map<String, dynamic>> branch(String branchId) async =>
      <String, dynamic>{};
  @override
  Future<List<Map<String, dynamic>>> branches() async => <Map<String, dynamic>>[
        <String, dynamic>{
          'id': 'b1',
          'name': 'Ikeja Branch',
          'code': 'IKJ',
          'status': 'ACTIVE',
          'targets': targetRows,
        }
      ];
  @override
  Future<Map<String, dynamic>> createBranch(
          Map<String, dynamic> values) async =>
      values;
  @override
  Future<Map<String, dynamic>> createTarget(
          Map<String, dynamic> values) async =>
      values;
  @override
  Future<void> reviewApproval(String id, String decision,
      {String? reviewNote}) async {}
  @override
  Future<Map<String, dynamic>> dashboard({String? branchId}) async =>
      <String, dynamic>{};
  @override
  Future<List<Map<String, dynamic>>> members(String branchId) async =>
      <Map<String, dynamic>>[];
  @override
  Future<List<Map<String, dynamic>>> targets({String? branchId}) async =>
      targetRows;
  @override
  Future<Map<String, dynamic>> updateTargetProgress(
          String targetId, num actual) async =>
      <String, dynamic>{};
  @override
  Future<BranchOverview> overview() async => const BranchOverview(
      metrics: <String, dynamic>{'activeBranches': 1},
      topBranches: <Map<String, dynamic>>[],
      attentionBranches: <Map<String, dynamic>>[]);
  @override
  Future<void> removeMember(String branchId, String userId) async {}
  @override
  Future<List<Map<String, dynamic>>> reports() async =>
      <Map<String, dynamic>>[];
  @override
  Future<List<Map<String, dynamic>>> audit() async => <Map<String, dynamic>>[];
  @override
  Future<void> setBranchStatus(String branchId, String status,
      {String? reason}) async {}
  @override
  Future<List<Map<String, dynamic>>> operationalRequests(
          {String? branchId}) async =>
      <Map<String, dynamic>>[];
  @override
  Future<Map<String, dynamic>> submitOperationalRequest(
          Map<String, dynamic> values,
          {required String idempotencyKey}) async =>
      values;
  @override
  Future<Map<String, dynamic>> updateBranch(
          String branchId, Map<String, dynamic> values) async =>
      values;
}

class _CaptureClient extends http.BaseClient {
  final List<http.BaseRequest> requests = <http.BaseRequest>[];
  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) async {
    requests.add(request);
    return http.StreamedResponse(
        Stream<List<int>>.value(utf8.encode('{"data":{}}')), 200);
  }
}

void main() {
  Widget screen(AdminAccess access, {_BranchApi? api}) => MaterialApp(
      home: AdminBranchManagementScreen(
          access: access, api: api ?? _BranchApi()));

  testWidgets('Head Office controls are visible', (WidgetTester tester) async {
    await tester.pumpWidget(screen(
        const AdminAccess(role: 'HEAD_OFFICE', permissions: <String>{})));
    await tester.pumpAndSettle();
    expect(find.text('Branch command center'), findsOneWidget);
    expect(find.byKey(const Key('branch-create-button')), findsOneWidget);
    expect(find.text('Top branches'), findsOneWidget);
  });

  testWidgets('branch manager has no Head Office controls',
      (WidgetTester tester) async {
    await tester.pumpWidget(screen(const AdminAccess(
        role: 'BRANCH_MANAGER',
        permissions: <String>{AdminPermissions.branchDashboardView})));
    await tester.pumpAndSettle();
    expect(find.text('Ikeja Branch'), findsOneWidget);
    expect(find.text('Branch command center'), findsNothing);
    expect(find.byKey(const Key('branch-create-button')), findsNothing);
  });

  testWidgets('Delivery and Solar modules remain isolated',
      (WidgetTester tester) async {
    await tester.pumpWidget(
        screen(const AdminAccess(role: 'BRANCH_MANAGER', permissions: <String>{
      AdminPermissions.branchDashboardView,
      AdminPermissions.branchDeliveryView,
      AdminPermissions.branchSolarView,
    })));
    await tester.pumpAndSettle();
    expect(find.text('Delivery operations'), findsOneWidget);
    expect(find.text('Solar operations'), findsOneWidget);
    expect(find.text('Marketplace operations'), findsNothing);
    expect(find.text('Empowerment operations'), findsNothing);
  });

  testWidgets('Marketplace and Empowerment modules remain isolated',
      (WidgetTester tester) async {
    await tester.pumpWidget(
        screen(const AdminAccess(role: 'BRANCH_MANAGER', permissions: <String>{
      AdminPermissions.branchDashboardView,
      AdminPermissions.branchMarketplaceView,
      AdminPermissions.branchEmpowermentView,
    })));
    await tester.pumpAndSettle();
    expect(find.text('Marketplace operations'), findsOneWidget);
    expect(find.text('Empowerment operations'), findsOneWidget);
    expect(find.text('Delivery operations'), findsNothing);
    expect(find.text('Solar operations'), findsNothing);
  });

  testWidgets('target displays 75 percent progress',
      (WidgetTester tester) async {
    await tester.pumpWidget(screen(
        const AdminAccess(role: 'BRANCH_MANAGER', permissions: <String>{
          AdminPermissions.branchDashboardView,
          AdminPermissions.branchTargetsView,
        }),
        api: _BranchApi(targetRows: <Map<String, dynamic>>[
          <String, dynamic>{
            'name': 'Collections',
            'achieved': 75,
            'target': 100
          }
        ])));
    await tester.pumpAndSettle();
    expect(find.text('75 / 100 (75%)'), findsOneWidget);
    expect(
        tester
            .widget<LinearProgressIndicator>(
                find.byKey(const Key('branch-target-progress')))
            .value,
        0.75);
  });

  test('request submission and approval review use bearer API contract',
      () async {
    SharedPreferences.setMockInitialValues(
        <String, Object>{'auth_token': 'abc'});
    final _CaptureClient client = _CaptureClient();
    final AdminBranchManagementHttpApi api = AdminBranchManagementHttpApi(
        client: client, baseUrl: 'https://unit.test/api');
    await api.submitOperationalRequest(<String, dynamic>{
      'type': 'GENERAL',
      'title': 'Need float',
      'description': 'Need float'
    }, idempotencyKey: 'request-1');
    await api.reviewApproval('a1', 'APPROVED');
    expect(client.requests[0].url.path, '/api/branches/operational-requests');
    expect(client.requests[0].method, 'POST');
    expect(client.requests[0].headers['authorization'], 'Bearer abc');
    expect(client.requests[0].headers['idempotency-key'], 'request-1');
    expect(utf8.decode((client.requests[0] as http.Request).bodyBytes),
        contains('Need float'));
    expect(client.requests[1].url.path, '/api/branches/approvals/a1/review');
    expect(client.requests[1].method, 'PUT');
  });

  test('branch creation preserves backend manager DTO contracts', () async {
    SharedPreferences.setMockInitialValues(
        <String, Object>{'auth_token': 'abc'});
    final _CaptureClient client = _CaptureClient();
    final AdminBranchManagementHttpApi api = AdminBranchManagementHttpApi(
        client: client, baseUrl: 'https://unit.test/api');
    await api.createBranch(<String, dynamic>{
      'code': 'IKJ',
      'name': 'Ikeja',
      'address': '1 Main St',
      'state': 'Lagos',
      'lga': 'Ikeja',
      'phone': '08000000000',
      'email': 'branch@example.com',
      'openingDate': '2025-01-01',
      'assignedModules': <String>['DELIVERY'],
      'manager': <String, dynamic>{
        'fullName': 'Ada Manager',
        'phone': '08000000001',
        'email': 'ada@example.com',
      },
    });
    final Map<String, dynamic> body = jsonDecode(
        utf8.decode((client.requests.single as http.Request).bodyBytes));
    expect(body['manager']['fullName'], 'Ada Manager');
    expect(body['manager']['phone'], '08000000001');
    expect(body['manager'].containsKey('password'), isFalse);
    expect(body.containsKey('managerId'), isFalse);
  });
}

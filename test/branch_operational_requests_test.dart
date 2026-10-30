import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:servicepay_app/branch_manager/branch_operational_requests_api.dart';
import 'package:servicepay_app/branch_manager/branch_operational_requests_screen.dart';
import 'package:servicepay_app/branch_manager/branch_manager_staff_api.dart';

class _RequestsApi implements BranchOperationalRequestsApi {
  bool? lastUpdateAssignment;
  String? lastAssignedStaffId;
  String? lastUpdateStatus;
  final List<Map<String, dynamic>> rows = <Map<String, dynamic>>[
    <String, dynamic>{
      '_id': 'request-1',
      'type': 'DELIVERY',
      'title': 'Parcel shelf repair',
      'description': 'One counter shelf is loose.',
      'status': 'OPEN',
      'createdAt': '2026-08-31T10:00:00.000Z',
    },
  ];

  @override
  Future<List<Map<String, dynamic>>> list() async => rows;

  @override
  Future<Map<String, dynamic>> create({
    required String type,
    required String title,
    required String description,
  }) async {
    final Map<String, dynamic> row = <String, dynamic>{
      'type': type,
      'title': title,
      'description': description,
      'status': 'OPEN',
      'createdAt': '2026-08-31T11:00:00.000Z',
    };
    rows.insert(0, row);
    return row;
  }

  @override
  Future<Map<String, dynamic>> update({
    required String requestId,
    String? assignedStaffId,
    bool updateAssignment = false,
    String? status,
    required String reason,
  }) async {
    lastUpdateAssignment = updateAssignment;
    lastAssignedStaffId = assignedStaffId;
    lastUpdateStatus = status;
    final Map<String, dynamic> row = rows
        .firstWhere((Map<String, dynamic> item) => item['_id'] == requestId);
    if (updateAssignment) row['assignedStaffId'] = assignedStaffId;
    if (status != null) row['status'] = status;
    row['updatedBy'] = 'staff-manager';
    row['reason'] = reason;
    return row;
  }
}

class _StaffApi implements BranchManagerStaffApi {
  String? requestedBranch;
  String? requestedStatus;

  @override
  Future<List<BranchStaff>> list(String branchId,
      {String? search, String? status}) async {
    requestedBranch = branchId;
    requestedStatus = status;
    return <BranchStaff>[
      BranchStaff(<String, dynamic>{
        '_id': 'active-staff-1',
        'fullName': 'Amina Branch Staff',
        'status': 'ACTIVE',
      }),
      BranchStaff(<String, dynamic>{
        '_id': 'inactive-staff-2',
        'fullName': 'Inactive Staff',
        'status': 'SUSPENDED',
      }),
    ];
  }

  @override
  Future<({BranchStaff staff, TemporaryCredentials credentials})> create(
          String branchId, Map<String, dynamic> input) async =>
      (staff: BranchStaff(input), credentials: TemporaryCredentials({}));

  @override
  Future<BranchStaff> update(
          String branchId, String staffId, Map<String, dynamic> input) async =>
      BranchStaff(input);

  @override
  Future<BranchStaff> setStatus(
          String branchId, String staffId, String status) async =>
      BranchStaff(<String, dynamic>{'status': status});

  @override
  Future<TemporaryCredentials> resetPassword(
          String branchId, String staffId) async =>
      TemporaryCredentials(<String, dynamic>{});
}

void main() {
  test('operational request API uses the existing branch route and body',
      () async {
    final List<http.Request> requests = <http.Request>[];
    final BranchOperationalRequestsHttpApi api =
        BranchOperationalRequestsHttpApi(
      baseUrl: 'https://example.test/api',
      tokenReader: () async => 'branch-token',
      client: MockClient((http.Request request) async {
        requests.add(request);
        if (request.method == 'GET') {
          return http.Response(
              '{"success":true,"requests":[{"title":"Existing request"}]}',
              200);
        }
        return http.Response(
            '{"success":true,"request":{"title":"New request"}}', 201);
      }),
    );

    final List<Map<String, dynamic>> listed = await api.list();
    final Map<String, dynamic> created = await api.create(
      type: 'delivery',
      title: 'Rider terminal issue',
      description: 'The branch rider terminal needs inspection.',
    );
    await api.update(
      requestId: 'request-1',
      assignedStaffId: 'active-staff-1',
      updateAssignment: true,
      status: 'IN_PROGRESS',
      reason: 'Assigned an active team member to inspect the terminal.',
    );

    expect(listed.single['title'], 'Existing request');
    expect(created['title'], 'New request');
    expect(requests.map((http.Request request) => request.url.path), <String>[
      '/api/branches/operational-requests',
      '/api/branches/operational-requests',
      '/api/branches/operational-requests/request-1',
    ]);
    expect(requests[0].method, 'GET');
    expect(requests[1].method, 'POST');
    expect(jsonDecode(requests[1].body), <String, dynamic>{
      'type': 'DELIVERY',
      'title': 'Rider terminal issue',
      'description': 'The branch rider terminal needs inspection.',
      'metadata': <String, dynamic>{},
    });
    expect(requests[1].headers['authorization'], 'Bearer branch-token');
    expect(requests[2].method, 'PATCH');
    expect(
        requests[2].url.path, '/api/branches/operational-requests/request-1');
    expect(jsonDecode(requests[2].body), <String, dynamic>{
      'assignedStaffId': 'active-staff-1',
      'status': 'IN_PROGRESS',
      'reason': 'Assigned an active team member to inspect the terminal.',
    });
  });

  testWidgets('request history is visible and authorized request submits',
      (WidgetTester tester) async {
    final _RequestsApi api = _RequestsApi();
    await tester.pumpWidget(MaterialApp(
      home: BranchOperationalRequestsScreen(
        api: api,
        canView: true,
        canSubmit: true,
      ),
    ));
    await tester.pumpAndSettle();
    expect(find.text('Parcel shelf repair'), findsOneWidget);
    expect(find.text('OPEN'), findsOneWidget);

    await tester.tap(find.byKey(const Key('new-operational-request')));
    await tester.pumpAndSettle();
    await tester.enterText(
        find.byKey(const Key('operational-request-type')), 'delivery');
    await tester.enterText(
        find.byKey(const Key('operational-request-title')), 'Rider terminal');
    await tester.enterText(
      find.byKey(const Key('operational-request-description')),
      'Please inspect the branch rider terminal.',
    );
    await tester.tap(find.byKey(const Key('submit-operational-request')));
    await tester.pumpAndSettle();

    expect(api.rows.first['type'], 'DELIVERY');
    expect(find.text('Rider terminal'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('manager can assign active branch staff and update status',
      (WidgetTester tester) async {
    final _RequestsApi api = _RequestsApi();
    final _StaffApi staffApi = _StaffApi();
    await tester.pumpWidget(MaterialApp(
      home: BranchOperationalRequestsScreen(
        api: api,
        staffApi: staffApi,
        branchId: 'branch-7',
        canView: true,
        canSubmit: true,
        canManage: true,
      ),
    ));
    await tester.pumpAndSettle();
    expect(staffApi.requestedBranch, 'branch-7');
    expect(staffApi.requestedStatus, 'ACTIVE');
    expect(find.text('Manage'), findsOneWidget);
    expect(find.text('Inactive Staff'), findsNothing);

    await tester
        .tap(find.byKey(const Key('manage-operational-request-request-1')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('operational-request-status')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('IN PROGRESS').last);
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('operational-request-assignee')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Amina Branch Staff').last);
    await tester.pumpAndSettle();
    await tester.enterText(
      find.byKey(const Key('operational-request-reason')),
      'Assigned an active branch staff member.',
    );
    await tester.tap(find.byKey(const Key('save-operational-request')));
    await tester.pumpAndSettle();

    expect(api.rows.single['status'], 'IN_PROGRESS');
    expect(api.rows.single['assignedStaffId'], 'active-staff-1');
    expect(
        api.rows.single['reason'], 'Assigned an active branch staff member.');
    expect(tester.takeException(), isNull);
  });

  testWidgets('ordinary branch staff can only progress their assigned task',
      (WidgetTester tester) async {
    final _RequestsApi api = _RequestsApi();
    api.rows.single['assignedStaffId'] = 'actor-7';
    await tester.pumpWidget(MaterialApp(
      home: BranchOperationalRequestsScreen(
        api: api,
        actorId: 'actor-7',
        canView: true,
        canSubmit: false,
      ),
    ));
    await tester.pumpAndSettle();
    expect(find.text('Manage'), findsNothing);
    expect(find.text('Start task'), findsOneWidget);

    await tester
        .tap(find.byKey(const Key('start-own-operational-request-request-1')));
    await tester.pumpAndSettle();
    await tester.enterText(
      find.byKey(const Key('own-operational-request-reason')),
      'Started the assigned parcel shelf repair task.',
    );
    await tester.tap(find.byKey(const Key('save-own-operational-request')));
    await tester.pumpAndSettle();
    expect(api.lastUpdateStatus, 'IN_PROGRESS');
    expect(api.lastUpdateAssignment, isFalse);
    expect(api.lastAssignedStaffId, isNull);
    expect(api.rows.single['status'], 'IN_PROGRESS');
    expect(find.text('Complete task'), findsOneWidget);
    expect(find.text('Manage'), findsNothing);

    await tester.tap(
        find.byKey(const Key('complete-own-operational-request-request-1')));
    await tester.pumpAndSettle();
    await tester.enterText(
      find.byKey(const Key('own-operational-request-reason')),
      'Completed the assigned shelf repair task.',
    );
    await tester.tap(find.byKey(const Key('save-own-operational-request')));
    await tester.pumpAndSettle();
    expect(api.lastUpdateStatus, 'RESOLVED');
    expect(api.lastUpdateAssignment, isFalse);
    expect(api.rows.single['assignedStaffId'], 'actor-7');
    expect(api.rows.single['status'], 'RESOLVED');
    expect(find.text('Complete task'), findsNothing);
    expect(find.text('Manage'), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('staff cannot progress another person or terminal request',
      (WidgetTester tester) async {
    final _RequestsApi api = _RequestsApi();
    api.rows.single['assignedStaffId'] = 'other-actor';
    await tester.pumpWidget(MaterialApp(
      home: BranchOperationalRequestsScreen(
        api: api,
        actorId: 'actor-7',
        canView: true,
        canSubmit: false,
      ),
    ));
    await tester.pumpAndSettle();
    expect(find.text('Start task'), findsNothing);
    expect(find.text('Complete task'), findsNothing);
    expect(find.text('Manage'), findsNothing);

    api.rows.single['assignedStaffId'] = 'actor-7';
    api.rows.single['status'] = 'CANCELLED';
    await tester.pumpWidget(MaterialApp(
      home: BranchOperationalRequestsScreen(
        api: api,
        actorId: 'actor-7',
        canView: true,
        canSubmit: false,
      ),
    ));
    await tester.pumpAndSettle();
    expect(find.text('Start task'), findsNothing);
    expect(find.text('Complete task'), findsNothing);
    expect(find.text('Manage'), findsNothing);
  });
}

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:servicepay_app/admin/admin_list_workspaces.dart';

class _FakeAdminListApi implements AdminListWorkspaceApi {
  int usersCalls = 0;

  @override
  Future<AdminListPage> transactions({
    required int page,
    required String search,
    required String status,
    required String serviceType,
  }) async =>
      const AdminListPage(
        records: <Map<String, dynamic>>[
          <String, dynamic>{
            'reference': 'TX-001',
            'status': 'SUCCESS',
            'serviceType': 'AIRTIME',
            'amount': 100,
          },
        ],
        page: 1,
        totalPages: 1,
        total: 1,
      );

  @override
  Future<AdminListPage> users({
    required int page,
    required String search,
    required String role,
    required String status,
  }) async {
    usersCalls++;
    return const AdminListPage(
      records: <Map<String, dynamic>>[
        <String, dynamic>{
          'fullName': 'Ada Customer',
          'email': 'ada@example.com',
          'role': 'CUSTOMER',
          'status': 'ACTIVE',
        },
      ],
      page: 1,
      totalPages: 1,
      total: 1,
    );
  }
}

void main() {
  testWidgets('users workspace renders backend records and safe details',
      (WidgetTester tester) async {
    final _FakeAdminListApi api = _FakeAdminListApi();
    await tester.pumpWidget(
      MaterialApp(home: AdminUsersScreen(api: api)),
    );
    await tester.pumpAndSettle();

    expect(find.text('Ada Customer'), findsOneWidget);
    expect(find.text('CUSTOMER • ACTIVE'), findsOneWidget);
    await tester.tap(find.text('Ada Customer'));
    await tester.pumpAndSettle();
    expect(find.text('User details'), findsOneWidget);
    expect(find.text('Email: ada@example.com'), findsOneWidget);
    expect(api.usersCalls, 1);
  });

  testWidgets('transactions workspace renders its protected-list response',
      (WidgetTester tester) async {
    await tester.pumpWidget(
      MaterialApp(home: AdminTransactionsScreen(api: _FakeAdminListApi())),
    );
    await tester.pumpAndSettle();

    expect(find.text('TX-001'), findsOneWidget);
    expect(find.textContaining('AIRTIME • SUCCESS'), findsOneWidget);
  });
}

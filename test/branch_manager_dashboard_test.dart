import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:servicepay_app/branch_manager/branch_manager_dashboard_api.dart';
import 'package:servicepay_app/branch_manager/branch_manager_dashboard_screen.dart';

class _DashboardApi implements BranchManagerDashboardApi {
  @override
  Future<BranchManagerDashboard> loadDashboard() async =>
      const BranchManagerDashboard(
        branch: <String, dynamic>{
          'name': 'Ikeja Branch',
          'code': 'IKJ',
          'status': 'ACTIVE',
        },
        periods: <Map<String, dynamic>>[
          <String, dynamic>{'period': 'March 2025', 'status': 'OPEN'}
        ],
        targets: <Map<String, dynamic>>[
          <String, dynamic>{'metric': 'Collections', 'status': 'ON_TRACK'}
        ],
        approvals: <Map<String, dynamic>>[],
        staff: <Map<String, dynamic>>[
          <String, dynamic>{'name': 'Ada Manager', 'role': 'Manager'}
        ],
        reports: <Map<String, dynamic>>[],
        modules: <Map<String, dynamic>>[
          <String, dynamic>{'name': 'DELIVERY'}
        ],
      );
}

void main() {
  testWidgets('shows manager branch identity and assigned workspaces',
      (WidgetTester tester) async {
    await tester.pumpWidget(
        MaterialApp(home: BranchManagerDashboardScreen(api: _DashboardApi())));
    await tester.pumpAndSettle();

    expect(find.text('Ikeja Branch'), findsOneWidget);
    expect(find.text('Reporting periods'), findsOneWidget);
    expect(find.text('Targets'), findsOneWidget);
    expect(find.text('Branch staff'), findsOneWidget);
    expect(find.text('Assigned modules'), findsOneWidget);
    expect(find.text('DELIVERY'), findsOneWidget);
  });
}

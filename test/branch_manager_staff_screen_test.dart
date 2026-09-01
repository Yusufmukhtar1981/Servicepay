import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:servicepay_app/branch_manager/branch_manager_staff_api.dart';
import 'package:servicepay_app/branch_manager/branch_manager_staff_screen.dart';

class _StaffApi implements BranchManagerStaffApi {
  @override
  Future<List<BranchStaff>> list(String branchId,
          {String? search, String? status}) async =>
      <BranchStaff>[
        BranchStaff(<String, dynamic>{
          '_id': 'staff-1',
          'fullName': 'Ada Staff',
          'phone': '08000000000',
          'department': 'OPERATIONS',
          'jobTitle': 'Officer',
          'status': 'ACTIVE'
        })
      ];
  @override
  Future<({BranchStaff staff, TemporaryCredentials credentials})> create(
          String branchId, Map<String, dynamic> input) async =>
      (
        staff: BranchStaff(input),
        credentials: const TemporaryCredentials(<String, dynamic>{
          'identifier': '08000000000',
          'temporaryPassword': 'temporary'
        })
      );
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
      const TemporaryCredentials(<String, dynamic>{
        'identifier': '08000000000',
        'temporaryPassword': 'temporary'
      });
}

void main() {
  testWidgets('shows branch staff returned by the scoped API', (tester) async {
    await tester.pumpWidget(MaterialApp(
        home:
            BranchManagerStaffScreen(branchId: 'branch-1', api: _StaffApi())));
    await tester.pumpAndSettle();
    expect(find.text('Ada Staff'), findsOneWidget);
    expect(find.byKey(const Key('branch-staff-create')), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}

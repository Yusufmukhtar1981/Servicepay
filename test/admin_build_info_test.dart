import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:servicepay_app/admin/admin_build_info.dart';
import 'package:servicepay_app/admin/admin_dashboard_screen.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('Admin Dashboard visibly exposes build identification',
      (tester) async {
    SharedPreferences.setMockInitialValues({
      'user_name': 'Head Office',
      'user_role': 'HEAD_OFFICE',
    });

    await tester.pumpWidget(
      const MaterialApp(home: AdminDashboardScreen()),
    );
    await tester.pumpAndSettle();

    expect(find.text(AdminBuildInfo.label), findsOneWidget);
  });
}
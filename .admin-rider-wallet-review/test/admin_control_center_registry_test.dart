import 'package:flutter_test/flutter_test.dart';
import 'package:servicepay_app/admin/admin_control_center_screen.dart';
import 'package:servicepay_app/admin/fintech_screen_registry.dart';

void main() {
  const expected = <String, String>{
    'Audit Logs': 'audit-logs',
    'Security Events': 'security-events',
    'Access Logs': 'access-logs',
    'Data Exports': 'data-exports',
    'Backups': 'backups',
    'Privacy Controls': 'privacy-controls',
    'Executive Dashboard': 'executive-dashboard',
    'Service Performance': 'service-performance',
    'Transaction Analytics': 'transaction-analytics',
    'Customer Analytics': 'customer-analytics',
  };

  test(
    'production Control Center labels resolve to real module workspaces',
    () {
      for (final entry in expected.entries) {
        expect(controlCenterModuleIdForTitle(entry.key), entry.value);
        final screen = fintechScreenForTitle(entry.key);
        expect(screen, isA<AdminControlCenterScreen>());
        expect(
          (screen! as AdminControlCenterScreen).initialModuleId,
          entry.value,
        );
      }
    },
  );
}

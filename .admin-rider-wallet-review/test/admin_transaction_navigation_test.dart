import 'package:flutter_test/flutter_test.dart';
import 'package:servicepay_app/admin/main_navigation.dart';
import 'package:servicepay_app/admin/admin_permissions.dart';

void main() {
  test('full-access Admin roles retain both transaction destinations', () {
    for (final String role in <String>[
      'HEAD_OFFICE',
      'ADMIN',
      'SUPER_ADMIN',
      'HEAD_OFFICE_ADMIN',
    ]) {
      expect(
        canAccessAdminNavigationModule(
          role: role,
          permissions: <String>{},
          permission: AdminPermissions.transactionsView,
        ),
        isTrue,
      );
      expect(
        canAccessAdminNavigationModule(
          role: role,
          permissions: <String>{},
          permission: AdminPermissions.transactionIntelligenceView,
        ),
        isTrue,
      );
    }
  });

  test('staff permissions keep the two destinations independently gated', () {
    expect(
      canAccessAdminNavigationModule(
        role: 'STAFF',
        permissions: <String>{AdminPermissions.transactionsView},
        permission: AdminPermissions.transactionsView,
      ),
      isTrue,
    );
    expect(
      canAccessAdminNavigationModule(
        role: 'STAFF',
        permissions: <String>{AdminPermissions.transactionsView},
        permission: AdminPermissions.transactionIntelligenceView,
      ),
      isFalse,
    );
    expect(
      canAccessAdminNavigationModule(
        role: 'STAFF',
        permissions: <String>{
          AdminPermissions.transactionIntelligenceView,
        },
        permission: AdminPermissions.transactionsView,
      ),
      isFalse,
    );
    expect(
      canAccessAdminNavigationModule(
        role: 'STAFF',
        permissions: <String>{
          AdminPermissions.transactionIntelligenceView,
        },
        permission: AdminPermissions.transactionIntelligenceView,
      ),
      isTrue,
    );
  });

  test('unauthorized staff receive neither transaction destination', () {
    expect(
      canAccessAdminNavigationModule(
        role: 'STAFF',
        permissions: <String>{},
        permission: AdminPermissions.transactionsView,
      ),
      isFalse,
    );
    expect(
      canAccessAdminNavigationModule(
        role: 'STAFF',
        permissions: <String>{},
        permission: AdminPermissions.transactionIntelligenceView,
      ),
      isFalse,
    );
  });
}
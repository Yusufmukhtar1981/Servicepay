import 'package:flutter_test/flutter_test.dart';
import 'package:servicepay_app/admin/admin_permissions.dart';

void main() {
  test('Head Office retains full access', () {
    const AdminAccess access = AdminAccess(
      role: 'HEAD_OFFICE',
      permissions: <String>{},
    );

    expect(access.isFullAccess, isTrue);
    expect(access.has(AdminPermissions.rolesDelete), isTrue);
  });

  test('staff access exposes only assigned modules', () {
    const AdminAccess access = AdminAccess(
      role: 'STAFF',
      permissions: <String>{
        AdminPermissions.dashboardView,
        AdminPermissions.supportView,
      },
    );

    expect(access.has(AdminPermissions.dashboardView), isTrue);
    expect(access.has(AdminPermissions.supportView), isTrue);
    expect(access.has(AdminPermissions.rolesView), isFalse);
    expect(access.has(AdminPermissions.walletsView), isFalse);
  });

  test('server user payload hydrates role, permissions, and scope', () {
    final AdminAccess access = AdminAccess.fromUser(<String, dynamic>{
      'role': 'STATE_MANAGER',
      'permissions': <String>[AdminPermissions.usersView],
      'accessScope': <String, dynamic>{'type': 'STATE', 'state': 'Lagos'},
    });

    expect(access.role, 'STATE_MANAGER');
    expect(access.has(AdminPermissions.usersView), isTrue);
    expect(access.scope['type'], 'STATE');
    expect(access.scope['state'], 'Lagos');
  });

  test('legacy notification permissions keep Email Center access', () {
    const AdminAccess access = AdminAccess(
      role: 'STAFF',
      permissions: <String>{
        AdminPermissions.notificationsView,
        AdminPermissions.notificationsCreate,
        AdminPermissions.notificationsSend,
      },
    );

    expect(access.has(AdminPermissions.communicationsView), isTrue);
    expect(access.has(AdminPermissions.emailCampaignCreate), isTrue);
    expect(access.has(AdminPermissions.emailCampaignSend), isTrue);
    expect(access.has(AdminPermissions.emailCampaignHistoryView), isTrue);
    expect(access.has(AdminPermissions.emailCampaignManage), isTrue);
  });

  test('transaction intelligence has an explicit read permission', () {
    const AdminAccess access = AdminAccess(
      role: 'STAFF',
      permissions: <String>{AdminPermissions.transactionIntelligenceView},
    );
    expect(access.has(AdminPermissions.transactionIntelligenceView), isTrue);
    expect(
      access.has(AdminPermissions.transactionIntelligenceRequery),
      isFalse,
    );
  });
}

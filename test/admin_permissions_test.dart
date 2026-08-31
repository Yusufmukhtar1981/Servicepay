import 'package:flutter_test/flutter_test.dart';
import 'package:servicepay_app/admin/admin_permissions.dart';

void main() {
  test('Head Office retains full access', () {
    const AdminAccess access =
        AdminAccess(role: 'HEAD_OFFICE', permissions: <String>{});

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
      'accessScope': <String, dynamic>{
        'type': 'STATE',
        'state': 'Lagos',
      },
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
        access.has(AdminPermissions.transactionIntelligenceRequery), isFalse);
  });

  test('fraud risk permissions are explicitly isolated', () {
    const AdminAccess access = AdminAccess(
      role: 'STAFF',
      permissions: <String>{AdminPermissions.fraudRiskView},
    );
    expect(access.has(AdminPermissions.fraudRiskView), isTrue);
    expect(access.has(AdminPermissions.fraudRiskInvestigate), isFalse);
    expect(access.has(AdminPermissions.fraudRiskRulesManage), isFalse);
    expect(AdminPermissions.fraudRiskExport, 'fraud_risk.export');
    expect(AdminPermissions.fraudRiskRestrict, 'fraud_risk.restrict');
  });

  test('Support Staff is limited to support and dashboard', () {
    final AdminAccess access = AdminAccess.fromUser(<String, dynamic>{
      'role': 'SUPPORT_STAFF',
      'permissions': <String>[
        AdminPermissions.dashboardView,
        AdminPermissions.supportView,
      ],
    });

    expect(access.has(AdminPermissions.dashboardView), isTrue);
    expect(access.has(AdminPermissions.supportView), isTrue);
    expect(access.has(AdminPermissions.kycView), isFalse);
    expect(access.has(AdminPermissions.financeView), isFalse);
  });

  test('KYC Officer is limited to KYC and dashboard', () {
    final AdminAccess access = AdminAccess.fromUser(<String, dynamic>{
      'role': 'KYC_OFFICER',
      'permissions': <String>[
        AdminPermissions.dashboardView,
        AdminPermissions.kycView,
      ],
    });

    expect(access.has(AdminPermissions.kycView), isTrue);
    expect(access.has(AdminPermissions.supportView), isFalse);
    expect(access.has(AdminPermissions.withdrawalsView), isFalse);
  });

  test('Finance Staff has finance controls but not customer support', () {
    final AdminAccess access = AdminAccess.fromUser(<String, dynamic>{
      'role': 'FINANCE_STAFF',
      'permissions': <String>[
        AdminPermissions.dashboardView,
        AdminPermissions.financeView,
        AdminPermissions.fundingView,
        AdminPermissions.withdrawalsView,
      ],
    });

    expect(access.has(AdminPermissions.financeView), isTrue);
    expect(access.has(AdminPermissions.fundingView), isTrue);
    expect(access.has(AdminPermissions.withdrawalsView), isTrue);
    expect(access.has(AdminPermissions.supportView), isFalse);
  });

  test('Operations Staff has only operational module visibility', () {
    final AdminAccess access = AdminAccess.fromUser(<String, dynamic>{
      'role': 'OPERATIONS_STAFF',
      'permissions': <String>[
        AdminPermissions.dashboardView,
        AdminPermissions.deliveryView,
        AdminPermissions.marketplaceView,
        AdminPermissions.empowermentView,
      ],
    });

    expect(access.has(AdminPermissions.deliveryView), isTrue);
    expect(access.has(AdminPermissions.marketplaceView), isTrue);
    expect(access.has(AdminPermissions.empowermentView), isTrue);
    expect(access.has(AdminPermissions.financeView), isFalse);
  });

  test('dashboard navigation permissions match protected backend modules', () {
    const AdminAccess access = AdminAccess(
      role: 'STAFF',
      permissions: <String>{
        AdminPermissions.deliveryView,
        AdminPermissions.marketplaceView,
        AdminPermissions.phoneFinancingView,
        AdminPermissions.usersView,
        AdminPermissions.transactionsView,
      },
    );

    expect(access.has(AdminPermissions.deliveryView), isTrue);
    expect(access.has(AdminPermissions.marketplaceView), isTrue);
    expect(access.has(AdminPermissions.phoneFinancingView), isTrue);
    expect(access.has(AdminPermissions.usersView), isTrue);
    expect(access.has(AdminPermissions.transactionsView), isTrue);
  });

  test('reports permission remains defined without claiming a report route',
      () {
    expect(AdminPermissions.reportsView, 'reports.view');
    expect(AdminPermissions.reportsExport, 'reports.export');
  });
}

import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';

abstract final class AdminPermissions {
  static const dashboardView = 'dashboard.view';
  static const staffCreate = 'staff.create';
  static const staffView = 'staff.view';
  static const staffUpdate = 'staff.update';
  static const staffSuspend = 'staff.suspend';
  static const staffAssignRole = 'staff.assign_role';
  static const staffResetPassword = 'staff.reset_password';
  static const rolesCreate = 'roles.create';
  static const rolesView = 'roles.view';
  static const rolesUpdate = 'roles.update';
  static const rolesDelete = 'roles.delete';
  static const rolesAssignPermissions = 'roles.assign_permissions';
  static const rolesEnable = 'roles.enable';
  static const usersView = 'users.view';
  static const transactionsView = 'transactions.view';
  static const walletsView = 'wallets.view';
  static const fundingView = 'funding.view';
  static const withdrawalsView = 'withdrawals.view';
  static const financeView = 'finance.view';
  static const deliveryView = 'delivery.view';
  static const logisticsView = 'logistics.view';
  static const logisticsManage = 'logistics.manage';
  static const marketplaceView = 'marketplace.view';
  static const solarView = 'solar.view';
  static const phoneFinancingView = 'phone_financing.view';
  static const empowermentView = 'empowerment.view';
  static const amanaView = 'amana.view';
  static const airtimeToCashView = 'airtime_to_cash.view';
  static const supportView = 'support.view';
  static const kycView = 'kyc.view';
  static const trustView = 'trust.view';
  static const notificationsView = 'notifications.view';
  static const notificationsCreate = 'notifications.create';
  static const notificationsSend = 'notifications.send';
  static const communicationsView = 'communications.view';
  static const emailCampaignCreate = 'email_campaign.create';
  static const emailCampaignSend = 'email_campaign.send';
  static const emailCampaignHistoryView = 'email_campaign.history_view';
  static const emailCampaignManage = 'email_campaign.manage';
  static const settingsView = 'settings.view';
  static const settingsUpdate = 'settings.update';
  static const auditView = 'audit.view';
  static const transactionIntelligenceView = 'transaction_intelligence.view';
  static const transactionIntelligenceRequery =
      'transaction_intelligence.requery';
  static const transactionIntelligenceExport =
      'transaction_intelligence.export';
  static const transactionIntelligenceProviderHealth =
      'transaction_intelligence.provider_health';
  static const fraudRiskView = 'fraud_risk.view';
  static const fraudRiskInvestigate = 'fraud_risk.investigate';
  static const fraudRiskAssign = 'fraud_risk.assign';
  static const fraudRiskResolve = 'fraud_risk.resolve';
  static const fraudRiskRulesManage = 'fraud_risk.rules.manage';
  static const fraudRiskExport = 'fraud_risk.export';
  static const fraudRiskRestrict = 'fraud_risk.restrict';
  static const reportsView = 'reports.view';
  static const reportsExport = 'reports.export';

  // Canonical branch-management permissions supplied by the API.
  static const branchesView = 'branches.view';
  static const branchesManage = 'branches.manage';
  static const branchesTargetsManage = 'branches.targets.manage';
  static const branchesApprovalsView = 'branches.approvals.view';
  static const branchesApprovalsManage = 'branches.approvals.manage';
  static const branchesReportsView = 'branches.reports.view';
  static const branchesStaffManage = 'branches.staff.manage';
  static const branchDashboardView = 'branch.dashboard.view';
  static const branchStaffView = 'branch.staff.view';
  static const branchStaffManage = 'branch.staff.manage';
  static const branchCustomersView = 'branch.customers.view';
  static const branchCustomersCreate = 'branch.customers.create';
  static const branchDeliveryView = 'branch.delivery.view';
  static const branchDeliveryManage = 'branch.delivery.manage';
  static const branchSolarView = 'branch.solar.view';
  static const branchSolarManage = 'branch.solar.manage';
  static const branchMarketplaceView = 'branch.marketplace.view';
  static const branchMarketplaceManage = 'branch.marketplace.manage';
  static const branchPhoneView = 'branch.phone.view';
  static const branchPhoneManage = 'branch.phone.manage';
  static const branchEmpowermentView = 'branch.empowerment.view';
  static const branchEmpowermentManage = 'branch.empowerment.manage';
  static const branchTargetsView = 'branch.targets.view';
  static const branchApprovalsView = 'branch.approvals.view';
  static const branchApprovalsSubmit = 'branch.approvals.submit';
  static const branchReportsView = 'branch.reports.view';
  static const branchFinanceView = 'branch.finance.view';
}

class AdminAccess {
  const AdminAccess({
    required this.role,
    required this.permissions,
    this.scope = const <String, dynamic>{},
  });

  final String role;
  final Set<String> permissions;
  final Map<String, dynamic> scope;

  static const Set<String> _fullAccessRoles = <String>{
    'HEAD_OFFICE',
    'ADMIN',
    'SUPER_ADMIN',
    'HEAD_OFFICE_ADMIN',
  };

  bool get isFullAccess =>
      _fullAccessRoles.contains(role.toUpperCase()) ||
      permissions.contains('*');

  bool has(String permission) {
    if (isFullAccess || permissions.contains(permission)) return true;
    const Map<String, String> legacy = <String, String>{
      AdminPermissions.communicationsView: AdminPermissions.notificationsView,
      AdminPermissions.emailCampaignCreate:
          AdminPermissions.notificationsCreate,
      AdminPermissions.emailCampaignSend: AdminPermissions.notificationsSend,
      AdminPermissions.emailCampaignHistoryView:
          AdminPermissions.notificationsView,
      AdminPermissions.emailCampaignManage: AdminPermissions.notificationsSend,
    };
    return permissions.contains(legacy[permission]);
  }

  bool hasAny(Iterable<String> required) => isFullAccess || required.any(has);

  static AdminAccess fromUser(Map<String, dynamic> user) {
    final dynamic rawPermissions =
        user['permissions'] ?? (user['staffRole'] as Map?)?['permissions'];
    final Set<String> permissions = rawPermissions is List
        ? rawPermissions
            .map((dynamic value) => value.toString().trim())
            .where((String value) => value.isNotEmpty)
            .toSet()
        : <String>{};
    final dynamic rawScope = user['accessScope'];
    final String role =
        (user['role'] ?? user['effectiveRole'] ?? '').toString().toUpperCase();
    return AdminAccess(
      role: role,
      permissions: permissions,
      scope: rawScope is Map
          ? Map<String, dynamic>.from(rawScope)
          : const <String, dynamic>{},
    );
  }
}

abstract final class AdminSessionStore {
  static const _permissionsKey = 'admin_effective_permissions';
  static const _scopeKey = 'admin_access_scope';

  static Future<void> saveAccess(AdminAccess access) async {
    final SharedPreferences prefs = await SharedPreferences.getInstance();
    await prefs.setStringList(
      _permissionsKey,
      access.permissions.toList()..sort(),
    );
    await prefs.setString(_scopeKey, jsonEncode(access.scope));
  }

  static Future<AdminAccess> loadAccess() async {
    final SharedPreferences prefs = await SharedPreferences.getInstance();
    final String role = (prefs.getString('user_role') ?? '').toUpperCase();
    final Set<String> permissions =
        (prefs.getStringList(_permissionsKey) ?? const <String>[]).toSet();
    Map<String, dynamic> scope = const <String, dynamic>{};
    final String? encodedScope = prefs.getString(_scopeKey);
    if (encodedScope != null && encodedScope.isNotEmpty) {
      try {
        final dynamic decoded = jsonDecode(encodedScope);
        if (decoded is Map) scope = Map<String, dynamic>.from(decoded);
      } catch (_) {
        scope = const <String, dynamic>{};
      }
    }
    return AdminAccess(role: role, permissions: permissions, scope: scope);
  }

  static Future<void> clearSession() async {
    final SharedPreferences prefs = await SharedPreferences.getInstance();
    const List<String> keys = <String>[
      'auth_token',
      'token',
      'access_token',
      'accessToken',
      'jwt_token',
      'jwt',
      'user_id',
      'user_name',
      'user_phone',
      'user_email',
      'user_role',
      'user_status',
      'wallet_balance',
      _permissionsKey,
      _scopeKey,
    ];
    for (final String key in keys) {
      await prefs.remove(key);
    }
  }
}

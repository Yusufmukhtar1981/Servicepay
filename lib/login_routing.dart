import 'package:flutter/material.dart';

import 'main_navigation.dart' deferred as customer;
import 'rider/rider_main_navigation.dart' deferred as rider;
import 'role_dashboard_screen.dart' deferred as role_home;
import 'solar_officer/solar_officer_dashboard_screen.dart' deferred as solar;
import 'phone_financing_officer/phone_financing_officer_dashboard_screen.dart'
    deferred as financing;
import 'business_partner/business_partner_dashboard_screen.dart'
    deferred as partner;
import 'admin/main_navigation.dart' deferred as admin;
import 'admin/admin_session_service.dart';
import 'branch_manager/branch_manager_dashboard_screen.dart' deferred as branch;
import 'branch_manager/branch_counter_screen.dart' deferred as branch_counter;
import 'forced_password_change_screen.dart';
import 'admin/svp_command_center_screen.dart' deferred as svp;
import 'widgets/deferred_screen.dart';
import 'electricity_screen.dart';

String normalizeLoginRole(dynamic value) {
  return value
          ?.toString()
          .trim()
          .toUpperCase()
          .replaceAll(RegExp(r'[\s-]+'), '_') ??
      '';
}

String loginRoleFromResponse(
  Map<String, dynamic> result,
  Map<String, dynamic> user,
) {
  final Map<String, dynamic> data = _mapFromDynamic(result['data']);
  final Map<String, dynamic> authentication =
      _mapFromDynamic(result['authentication']);
  final Map<String, dynamic> auth = _mapFromDynamic(result['auth']);

  for (final dynamic candidate in <dynamic>[
    user['role'],
    result['role'],
    data['role'],
    _mapFromDynamic(data['user'])['role'],
    authentication['role'],
    auth['role'],
  ]) {
    final String role = normalizeLoginRole(candidate);
    if (role.isNotEmpty) {
      return role;
    }
  }

  return 'CUSTOMER';
}

bool isBranchDeliveryStaffAccess(String role, Map<String, dynamic> user) {
  if (normalizeLoginRole(role) != 'STAFF') return false;
  if (isBranchScopedStaffUser(role, user)) {
    return branchPermissionsForUser(user).contains('branch.delivery.manage');
  }
  final dynamic roleReference = user['staffRoleId'] ?? user['staffRole'];
  final Map<String, dynamic> scopedRole = _mapFromDynamic(roleReference);
  final String roleId = roleReference is String
      ? roleReference.trim()
      : '${scopedRole['_id'] ?? scopedRole['id'] ?? ''}'.trim();
  if (roleId.isEmpty) return false;
  final Map<String, dynamic> roleScope = _mapFromDynamic(scopedRole['scope']);
  final Map<String, dynamic> userScope = _mapFromDynamic(user['accessScope']);
  final String scopeType = normalizeLoginRole(
    scopedRole['scopeType'] ??
        roleScope['type'] ??
        userScope['type'] ??
        user['scopeType'],
  );
  final dynamic branchAssignment =
      user['branchId'] ?? user['branch_id'] ?? user['branch'];
  final bool hasBranchAssignment = branchAssignment is Map
      ? branchAssignment.isNotEmpty
      : branchAssignment != null &&
          branchAssignment.toString().trim().isNotEmpty;
  final bool hasBranchScope =
      scopeType == 'BRANCH' || (scopeType.isEmpty && hasBranchAssignment);
  if (!hasBranchScope) return false;
  return branchPermissionsForUser(user).contains('branch.delivery.manage');
}

bool isBranchScopedStaffUser(String role, Map<String, dynamic> user) {
  if (normalizeLoginRole(role) != 'STAFF' || user['isStaff'] != true) {
    return false;
  }
  final dynamic roleReference = user['staffRoleId'] ?? user['staffRole'];
  final Map<String, dynamic> scopedRole = _mapFromDynamic(roleReference);
  final Map<String, dynamic> roleScope = _mapFromDynamic(scopedRole['scope']);
  final Map<String, dynamic> userScope = _mapFromDynamic(user['accessScope']);
  final String scopeType = normalizeLoginRole(
    scopedRole['scopeType'] ??
        roleScope['type'] ??
        userScope['type'] ??
        user['scopeType'],
  );
  if (scopeType == 'GLOBAL') return false;
  final dynamic directPermissions = user['branchStaffPermissions'];
  final bool hasBranchPermissionEvidence = directPermissions is List &&
      directPermissions.any(
        (dynamic value) => value.toString().trim().toLowerCase().startsWith(
              'branch.',
            ),
      );
  if (scopeType != 'BRANCH' && !hasBranchPermissionEvidence) return false;
  const Set<String> branchJobTitles = <String>{
    'GENERAL_STAFF',
    'KYC_OFFICER',
    'DELIVERY_OFFICER',
    'SOLAR_OFFICER',
    'PHONE_FINANCING_OFFICER',
    'MARKETPLACE_OFFICER',
    'SUPPORT_OFFICER',
  };
  final String jobTitle = normalizeLoginRole(user['jobTitle']);
  if (!branchJobTitles.contains(jobTitle)) return false;
  final dynamic assignment =
      user['branchId'] ?? user['branch_id'] ?? user['branch'];
  if (assignment is Map) {
    return '${assignment['_id'] ?? assignment['id'] ?? ''}'.trim().isNotEmpty;
  }
  return assignment != null && assignment.toString().trim().isNotEmpty;
}

List<String> branchPermissionsForUser(Map<String, dynamic> user) {
  final dynamic roleReference = user['staffRoleId'] ?? user['staffRole'];
  final Map<String, dynamic> scopedRole = _mapFromDynamic(roleReference);
  final dynamic directBranchPermissions = user['branchStaffPermissions'];
  final dynamic userPermissions = user['permissions'];
  final dynamic rawPermissions =
      directBranchPermissions is List && directBranchPermissions.isNotEmpty
          ? directBranchPermissions
          : userPermissions is List && userPermissions.isNotEmpty
              ? userPermissions
              : scopedRole['permissions'] ??
                  _mapFromDynamic(user['staffRole'])['permissions'];
  if (rawPermissions is! List) return <String>[];
  return rawPermissions
      .map((dynamic permission) => permission.toString().trim().toLowerCase())
      .where((String permission) => permission.isNotEmpty)
      .toList();
}

String branchAssignmentId(Map<String, dynamic> user) {
  final dynamic assignment =
      user['branchId'] ?? user['branch_id'] ?? user['branch'];
  if (assignment is Map) {
    return '${assignment['_id'] ?? assignment['id'] ?? ''}'.trim();
  }
  return assignment?.toString().trim() ?? '';
}

String verifiedSessionActorId(Map<String, dynamic> user) =>
    '${user['_id'] ?? user['id'] ?? ''}'.trim();

String? globalStaffWorkspaceForRole(
  String role,
  Map<String, dynamic> user,
) {
  if (normalizeLoginRole(role) != 'STAFF' || user['isStaff'] != true) {
    return null;
  }
  final String jobTitle = normalizeLoginRole(user['jobTitle']);
  if (jobTitle != 'OPERATIONS_MANAGER' && jobTitle != 'CUSTOMER_SUPPORT') {
    return null;
  }

  final dynamic roleReference = user['staffRoleId'] ?? user['staffRole'];
  final Map<String, dynamic> staffRole = _mapFromDynamic(roleReference);
  final Map<String, dynamic> nestedRoleScope =
      _mapFromDynamic(staffRole['scope']);
  final Map<String, dynamic> accessScope =
      _mapFromDynamic(user['accessScope']);
  final List<dynamic> declaredScopeValues = <dynamic>[
    staffRole['scopeType'],
    nestedRoleScope['type'],
    accessScope['type'],
    user['scopeType'],
  ];
  final List<String> declaredScopes = declaredScopeValues
      .whereType<String>()
      .map(normalizeLoginRole)
      .where((String value) => value.isNotEmpty)
      .toList();
  if (!declaredScopes.contains('GLOBAL') ||
      declaredScopes.contains('BRANCH')) {
    return null;
  }

  final List<dynamic> permissionSources = <dynamic>[
    user['permissions'],
    staffRole['permissions'],
    _mapFromDynamic(user['staffRole'])['permissions'],
  ];
  final Set<String> permissions = permissionSources
      .whereType<List>()
      .expand((List<dynamic> values) => values)
      .map((dynamic value) => value.toString().trim().toLowerCase())
      .where((String value) => value.isNotEmpty)
      .toSet();
  if (jobTitle == 'OPERATIONS_MANAGER' &&
      permissions.contains('operations.workspace.view')) {
    return 'OPERATIONS';
  }
  if (jobTitle == 'CUSTOMER_SUPPORT' &&
      permissions.contains('support.workspace.view')) {
    return 'SUPPORT';
  }
  return null;
}

Widget authenticatedHomeForRole(
  String role, {
  Map<String, dynamic> user = const <String, dynamic>{},
  AdminSessionService? adminSessionService,
}) {
  switch (normalizeLoginRole(role)) {
    case 'DELIVERY_RIDER':
      return DeferredScreen(
          load: rider.loadLibrary, builder: () => rider.RiderMainNavigation());
    case 'CUSTOMER':
      return DeferredScreen(
          load: customer.loadLibrary,
          builder: () => customer.MainNavigation(
              electricityScreenBuilder: () => const ElectricityScreen()));
    case 'SOLAR_OFFICER':
      return DeferredScreen(
          load: solar.loadLibrary,
          builder: () => solar.SolarOfficerDashboardScreen());
    case 'PHONE_FINANCING_OFFICER':
      return DeferredScreen(
          load: financing.loadLibrary,
          builder: () => financing.PhoneFinancingOfficerDashboardScreen());
    case 'BUSINESS_PARTNER':
      return DeferredScreen(
          load: partner.loadLibrary,
          builder: () => partner.BusinessPartnerDashboardScreen());
    case 'HEAD_OFFICE':
    case 'HEAD_OFFICE_ADMIN':
    case 'SUPER_ADMIN':
    case 'ADMIN':
      return DeferredScreen(
          load: admin.loadLibrary,
          builder: () =>
              admin.AdminMainNavigation(sessionService: adminSessionService));
    case 'STAFF':
      if (isBranchDeliveryStaffAccess(role, user)) {
        final List<String> permissions = branchPermissionsForUser(user);
        return DeferredScreen(
          load: branch_counter.loadLibrary,
          builder: () => branch_counter.BranchCounterScreen(
            staffMode: true,
            canViewOperationalRequests:
                permissions.contains('branch.dashboard.view') ||
                    permissions.contains('branch.approvals.view') ||
                    permissions.contains('branch.staff.manage'),
            canSubmitOperationalRequests:
                permissions.contains('branch.approvals.submit'),
            canManageOperationalRequests:
                permissions.contains('branch.staff.manage'),
            branchId: branchAssignmentId(user),
            actorId: verifiedSessionActorId(user),
          ),
        );
      }
      if (isBranchScopedStaffUser(role, user)) {
        return DeferredScreen(
          load: branch.loadLibrary,
          builder: () => branch.BranchManagerDashboardScreen(
            actorId: verifiedSessionActorId(user),
          ),
        );
      }
      final String? workspace = globalStaffWorkspaceForRole(role, user);
      final String? initialDestination = switch (workspace) {
        'OPERATIONS' => 'Operations overview',
        'SUPPORT' => 'Customer support desk',
        _ => null,
      };
      return DeferredScreen(
        load: admin.loadLibrary,
        builder: () => admin.AdminMainNavigation(
          sessionService: adminSessionService,
          initialDestinationLabel: initialDestination,
        ),
      );
    case 'SVP':
      return DeferredScreen(
          load: svp.loadLibrary, builder: () => svp.SvpCommandCenterScreen());
    case 'BRANCH_MANAGER':
      return DeferredScreen(
          load: branch.loadLibrary,
          builder: () => branch.BranchManagerDashboardScreen());
    default:
      return DeferredScreen(
          load: role_home.loadLibrary,
          builder: () =>
              role_home.RoleDashboardScreen(role: normalizeLoginRole(role)));
  }
}

Widget authenticatedHomeForLogin(String role,
        {required bool mustChangePassword,
        Map<String, dynamic> user = const <String, dynamic>{},
        AdminSessionService? adminSessionService,
        VoidCallback? onRelogin}) =>
    mustChangePassword
        ? ForcedPasswordChangeScreen(
            role: normalizeLoginRole(role),
            staffUser: user,
            onRelogin: onRelogin,
          )
        : authenticatedHomeForRole(
            role,
            user: user,
            adminSessionService: adminSessionService,
          );

Map<String, dynamic> _mapFromDynamic(dynamic value) {
  return value is Map ? Map<String, dynamic>.from(value) : <String, dynamic>{};
}

import 'package:flutter/material.dart';

import 'main_navigation.dart' deferred as customer;
import 'rider/rider_main_navigation.dart' deferred as rider;
import 'role_dashboard_screen.dart' deferred as roleHome;
import 'solar_officer/solar_officer_dashboard_screen.dart' deferred as solar;
import 'phone_financing_officer/phone_financing_officer_dashboard_screen.dart'
    deferred as financing;
import 'business_partner/business_partner_dashboard_screen.dart'
    deferred as partner;
import 'admin/main_navigation.dart' deferred as admin;
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
  final dynamic roleReference = user['staffRoleId'] ?? user['staffRole'];
  final Map<String, dynamic> scopedRole = _mapFromDynamic(roleReference);
  final String roleId = roleReference is String
      ? roleReference.trim()
      : '${scopedRole['_id'] ?? scopedRole['id'] ?? ''}'.trim();
  if (roleId.isEmpty) return false;
  final Map<String, dynamic> roleScope = _mapFromDynamic(scopedRole['scope']);
  final Map<String, dynamic> userScope =
      _mapFromDynamic(user['accessScope']);
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
  final dynamic userPermissions = user['permissions'];
  final dynamic rawPermissions = userPermissions is List &&
          userPermissions.isNotEmpty
      ? userPermissions
      : scopedRole['permissions'] ??
          _mapFromDynamic(user['staffRole'])['permissions'];
  if (rawPermissions is! List) return false;
  return rawPermissions
      .map((dynamic permission) => permission.toString().trim().toLowerCase())
      .contains('branch.delivery.manage');
}

Widget authenticatedHomeForRole(
  String role, {
  Map<String, dynamic> user = const <String, dynamic>{},
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
          load: admin.loadLibrary, builder: () => admin.AdminMainNavigation());
    case 'STAFF':
      if (isBranchDeliveryStaffAccess(role, user)) {
        return DeferredScreen(
          load: branch_counter.loadLibrary,
          builder: () => branch_counter.BranchCounterScreen(staffMode: true),
        );
      }
      return DeferredScreen(
          load: admin.loadLibrary, builder: () => admin.AdminMainNavigation());
    case 'SVP':
      return DeferredScreen(
          load: svp.loadLibrary, builder: () => svp.SvpCommandCenterScreen());
    case 'BRANCH_MANAGER':
      return DeferredScreen(
          load: branch.loadLibrary,
          builder: () => branch.BranchManagerDashboardScreen());
    default:
      return DeferredScreen(
          load: roleHome.loadLibrary,
          builder: () =>
              roleHome.RoleDashboardScreen(role: normalizeLoginRole(role)));
  }
}

Widget authenticatedHomeForLogin(String role,
        {required bool mustChangePassword,
        Map<String, dynamic> user = const <String, dynamic>{}}) =>
    mustChangePassword
        ? ForcedPasswordChangeScreen(
            role: normalizeLoginRole(role),
            staffUser: user,
          )
        : authenticatedHomeForRole(role, user: user);

Map<String, dynamic> _mapFromDynamic(dynamic value) {
  return value is Map ? Map<String, dynamic>.from(value) : <String, dynamic>{};
}

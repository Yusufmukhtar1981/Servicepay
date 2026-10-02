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
import 'forced_password_change_screen.dart';
import 'admin/svp_command_center_screen.dart' deferred as svp;
import 'widgets/deferred_screen.dart';

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

Widget authenticatedHomeForRole(String role) {
  switch (normalizeLoginRole(role)) {
    case 'DELIVERY_RIDER':
      return DeferredScreen(
          load: rider.loadLibrary, builder: () => rider.RiderMainNavigation());
    case 'CUSTOMER':
      return DeferredScreen(
          load: customer.loadLibrary, builder: () => customer.MainNavigation());
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
    case 'STAFF':
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
        {required bool mustChangePassword}) =>
    mustChangePassword
        ? ForcedPasswordChangeScreen(role: normalizeLoginRole(role))
        : authenticatedHomeForRole(role);

Map<String, dynamic> _mapFromDynamic(dynamic value) {
  return value is Map ? Map<String, dynamic>.from(value) : <String, dynamic>{};
}

import 'package:flutter/material.dart';

import 'main_navigation.dart';
import 'rider/rider_main_navigation.dart';
import 'role_dashboard_screen.dart';
import 'solar_officer/solar_officer_dashboard_screen.dart';
import 'phone_financing_officer/phone_financing_officer_dashboard_screen.dart';
import 'business_partner/business_partner_dashboard_screen.dart';
import 'admin/main_navigation.dart';
import 'branch_manager/branch_manager_dashboard_screen.dart';
import 'forced_password_change_screen.dart';

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
      return const RiderMainNavigation();
    case 'CUSTOMER':
      return const MainNavigation();
    case 'SOLAR_OFFICER':
      return const SolarOfficerDashboardScreen();
    case 'PHONE_FINANCING_OFFICER':
      return const PhoneFinancingOfficerDashboardScreen();
    case 'BUSINESS_PARTNER':
      return const BusinessPartnerDashboardScreen();
    case 'STAFF':
      return const AdminMainNavigation();
    case 'BRANCH_MANAGER':
      return const BranchManagerDashboardScreen();
    default:
      return RoleDashboardScreen(
        role: normalizeLoginRole(role),
      );
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

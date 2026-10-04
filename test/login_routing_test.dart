import 'package:flutter_test/flutter_test.dart';
import 'package:flutter/material.dart';
import 'package:servicepay_app/widgets/deferred_screen.dart';

import 'package:servicepay_app/login_routing.dart';
import 'package:servicepay_app/main_navigation.dart';
import 'package:servicepay_app/rider/rider_main_navigation.dart';
import 'package:servicepay_app/role_dashboard_screen.dart';
import 'package:servicepay_app/solar_officer/solar_officer_dashboard_screen.dart';
import 'package:servicepay_app/phone_financing_officer/phone_financing_officer_dashboard_screen.dart';
import 'package:servicepay_app/business_partner/business_partner_dashboard_screen.dart';
import 'package:servicepay_app/admin/main_navigation.dart';
import 'package:servicepay_app/branch_manager/branch_counter_screen.dart';
import 'package:servicepay_app/branch_manager/branch_manager_dashboard_screen.dart';
import 'package:servicepay_app/forced_password_change_screen.dart';

void main() {
  Future<Widget> loadedHome(
    String role, {
    Map<String, dynamic> user = const <String, dynamic>{},
  }) async {
    final home = authenticatedHomeForRole(role, user: user) as DeferredScreen;
    await home.load();
    return home.builder();
  }

  test('reads and normalizes the authenticated role', () {
    expect(
      loginRoleFromResponse(
        <String, dynamic>{
          'data': <String, dynamic>{
            'role': 'solar officer',
          },
        },
        <String, dynamic>{},
      ),
      'SOLAR_OFFICER',
    );

    expect(
      loginRoleFromResponse(
        <String, dynamic>{
          'role': 'DELIVERY-RIDER',
        },
        <String, dynamic>{},
      ),
      'DELIVERY_RIDER',
    );
  });

  test('keeps unknown or missing roles on the existing role dashboard',
      () async {
    expect(normalizeLoginRole(' state manager '), 'STATE_MANAGER');
    expect(
      loginRoleFromResponse(
        <String, dynamic>{},
        <String, dynamic>{},
      ),
      'CUSTOMER',
    );
    expect(
      await loadedHome('STATE_MANAGER'),
      isA<RoleDashboardScreen>(),
    );
  });

  test('routes Solar Officers directly to the dedicated dashboard', () async {
    expect(
      await loadedHome(' solar-officer '),
      isA<SolarOfficerDashboardScreen>(),
    );
    expect(
      await loadedHome('CUSTOMER'),
      isA<MainNavigation>(),
    );
    expect(
      await loadedHome('DELIVERY_RIDER'),
      isA<RiderMainNavigation>(),
    );
  });

  test('routes Phone Financing Officers to their scoped dashboard', () async {
    expect(
      await loadedHome('phone financing officer'),
      isA<PhoneFinancingOfficerDashboardScreen>(),
    );
  });

  test('routes Business Partners to their dedicated dashboard', () async {
    expect(
      await loadedHome('business partner'),
      isA<BusinessPartnerDashboardScreen>(),
    );
  });

  test('routes Staff to the permission-aware Admin dashboard', () async {
    expect(
      await loadedHome('STAFF'),
      isA<AdminMainNavigation>(),
    );
    expect(
      await loadedHome('STAFF'),
      isNot(isA<RoleDashboardScreen>()),
    );
  });

  test('routes only scoped delivery STAFF to the branch counter', () async {
    final Map<String, dynamic> user = <String, dynamic>{
      'role': 'STAFF',
      'staffRoleId': <String, dynamic>{
        '_id': 'staff-role-branch-7',
        'scopeType': 'BRANCH',
      },
      'permissions': <String>['branch.delivery.manage'],
    };
    expect(isBranchDeliveryStaffAccess('STAFF', user), isTrue);
    expect(
      await loadedHome('STAFF', user: user),
      isA<BranchCounterScreen>(),
    );
    expect(
      await loadedHome('STAFF', user: <String, dynamic>{
        'staffRoleId': <String, dynamic>{
          '_id': 'staff-role-branch-7',
          'scopeType': 'BRANCH',
        },
        'permissions': <String>['branch.delivery.view'],
      }),
      isA<AdminMainNavigation>(),
    );
    expect(
      await loadedHome('STAFF', user: <String, dynamic>{
        'permissions': <String>['branch.delivery.manage'],
      }),
      isA<AdminMainNavigation>(),
    );
    expect(
      await loadedHome('STAFF', user: <String, dynamic>{
        'staffRoleId': <String, dynamic>{
          '_id': 'staff-role-global',
          'scopeType': 'GLOBAL',
        },
        'branchId': 'branch-17',
        'permissions': <String>['branch.delivery.manage'],
      }),
      isA<AdminMainNavigation>(),
    );
    expect(
      await loadedHome('STAFF', user: <String, dynamic>{
        'staffRoleId': <String, dynamic>{
          '_id': 'staff-role-global',
          'scopeType': 'GLOBAL',
        },
        'permissions': <String>['branch.delivery.manage'],
      }),
      isA<AdminMainNavigation>(),
    );
  });

  test('routes Branch Managers to their dedicated dashboard', () async {
    expect(
      await loadedHome(' branch-manager '),
      isA<BranchManagerDashboardScreen>(),
    );
  });

  test('requires a temporary-password account to change password first',
      () async {
    expect(
      authenticatedHomeForLogin('BRANCH_MANAGER', mustChangePassword: true),
      isA<ForcedPasswordChangeScreen>(),
    );
    expect(
      await loadedHome('BRANCH_MANAGER'),
      isA<BranchManagerDashboardScreen>(),
    );
  });
}

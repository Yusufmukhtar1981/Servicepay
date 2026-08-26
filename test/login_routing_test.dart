import 'package:flutter_test/flutter_test.dart';

import 'package:servicepay_app/login_routing.dart';
import 'package:servicepay_app/main_navigation.dart';
import 'package:servicepay_app/rider/rider_main_navigation.dart';
import 'package:servicepay_app/role_dashboard_screen.dart';
import 'package:servicepay_app/solar_officer/solar_officer_dashboard_screen.dart';

void main() {
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

  test('keeps unknown or missing roles on the existing role dashboard', () {
    expect(normalizeLoginRole(' state manager '), 'STATE_MANAGER');
    expect(
      loginRoleFromResponse(
        <String, dynamic>{},
        <String, dynamic>{},
      ),
      'CUSTOMER',
    );
    expect(
      authenticatedHomeForRole('STATE_MANAGER'),
      isA<RoleDashboardScreen>(),
    );
  });

  test('routes Solar Officers directly to the dedicated dashboard', () {
    expect(
      authenticatedHomeForRole(' solar-officer '),
      isA<SolarOfficerDashboardScreen>(),
    );
    expect(
      authenticatedHomeForRole('CUSTOMER'),
      isA<MainNavigation>(),
    );
    expect(
      authenticatedHomeForRole('DELIVERY_RIDER'),
      isA<RiderMainNavigation>(),
    );
  });
}

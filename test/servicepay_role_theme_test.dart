import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:servicepay_app/login_routing.dart';
import 'package:servicepay_app/servicepay_theme.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  tearDown(() {
    ServicePayThemeSelection.audience.value = ServicePayThemeAudience.customer;
  });

  test('staff keep the original light theme; customers get premium green', () {
    final ThemeData staff = ServicePayTheme.light();
    expect(staff.colorScheme.brightness, Brightness.light);
    expect(staff.colorScheme.primary, const Color(0xFF087A45));
    expect(staff.scaffoldBackgroundColor, const Color(0xFFF5F9F6));
    expect(staff.cardTheme.color, Colors.white);

    final ThemeData customer = ServicePayTheme.customer();
    expect(customer.colorScheme.brightness, Brightness.dark);
    expect(customer.scaffoldBackgroundColor, const Color(0xFF062A22));
    expect(customer.colorScheme.primary, const Color(0xFF20D69A));
    expect(customer.cardTheme.color, const Color(0xFF104638));
  });

  test('audience is derived only from the already-resolved role', () {
    expect(ServicePayThemeSelection.audienceForRole('customer'),
        ServicePayThemeAudience.customer);
    for (final String role in <String>[
      'STAFF',
      'ADMIN',
      'HEAD_OFFICE',
      'BRANCH_MANAGER',
      'DELIVERY_RIDER',
      'SOLAR_OFFICER',
      'PHONE_FINANCING_OFFICER',
      'BUSINESS_PARTNER',
      'SVP',
      'AGENT',
    ]) {
      expect(ServicePayThemeSelection.audienceForRole(role),
          ServicePayThemeAudience.staff,
          reason: role);
    }
  });

  testWidgets('routing selects the theme after the frame without changing routes',
      (WidgetTester tester) async {
    await tester.pumpWidget(ValueListenableBuilder<ServicePayThemeAudience>(
      valueListenable: ServicePayThemeSelection.audience,
      builder: (context, audience, _) => MaterialApp(
        theme: ServicePayThemeSelection.themeFor(audience),
        home: const Scaffold(body: Text('shell')),
      ),
    ));
    Color background() => Theme.of(tester.element(find.text('shell')))
        .scaffoldBackgroundColor;
    expect(background(), const Color(0xFF062A22));

    final Widget staffHome = authenticatedHomeForRole('BRANCH_MANAGER');
    expect(staffHome, isNotNull);
    await tester.pump();
    expect(ServicePayThemeSelection.audience.value,
        ServicePayThemeAudience.staff);
    await tester.pumpAndSettle();
    expect(background(), const Color(0xFFF5F9F6));

    authenticatedHomeForRole('CUSTOMER');
    await tester.pump();
    await tester.pumpAndSettle();
    expect(background(), const Color(0xFF062A22));
  });

  testWidgets('the latest audience request cancels stale queued theme changes',
      (WidgetTester tester) async {
    ServicePayThemeSelection.select(ServicePayThemeAudience.staff);
    ServicePayThemeSelection.select(ServicePayThemeAudience.customer);
    await tester.pump();
    expect(ServicePayThemeSelection.audience.value,
        ServicePayThemeAudience.customer);

    ServicePayThemeSelection.select(ServicePayThemeAudience.staff);
    await tester.pump();
    expect(ServicePayThemeSelection.audience.value, ServicePayThemeAudience.staff);
    ServicePayThemeSelection.select(ServicePayThemeAudience.customer);
    ServicePayThemeSelection.select(ServicePayThemeAudience.staff);
    await tester.pump();
    expect(ServicePayThemeSelection.audience.value, ServicePayThemeAudience.staff);
  });
}

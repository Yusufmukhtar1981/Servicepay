import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:servicepay_app/admin/admin_dashboard_screen.dart';
import 'package:servicepay_app/dashboard_screen.dart';

class _RouteObserver extends NavigatorObserver {
  final List<String?> pushedRoutes = <String?>[];

  @override
  void didPush(Route<dynamic> route, Route<dynamic>? previousRoute) {
    pushedRoutes.add(route.settings.name);
    super.didPush(route, previousRoute);
  }
}

void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues(<String, Object>{
      'auth_token': 'solar-test-token',
      'user_name': 'Solar Test User',
      'user_role': 'HEAD_OFFICE',
    });
  });

  testWidgets(
    'active customer dashboard shows Solar and opens the customer screen',
    (WidgetTester tester) async {
      final _RouteObserver observer = _RouteObserver();
      tester.view.physicalSize = const Size(800, 1200);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      SharedPreferences.setMockInitialValues(<String, Object>{
        'auth_token': 'solar-test-token',
        'user_name': 'Solar Test User',
        'user_role': 'CUSTOMER',
      });
      await tester.pumpWidget(
        MaterialApp(
          home: const DashboardScreen(),
          navigatorObservers: <NavigatorObserver>[observer],
        ),
      );
      await tester.pump();

      final allServices = find.byKey(const Key('customer-all-services'));
      await tester.ensureVisible(allServices);
      await tester.tap(allServices);
      await tester.pumpAndSettle();
      await tester.enterText(find.byType(TextField), 'Solar');
      await tester.pumpAndSettle();
      final Finder solarEntry = find.text('ServicePay Solar');
      expect(solarEntry, findsOneWidget);
      await tester.ensureVisible(solarEntry);

      await tester.tap(solarEntry);
      expect(observer.pushedRoutes, contains('/solar'));
      // This is a navigation test; catalogue reads are covered by Solar's
      // injected-client tests, not the widget binding's rejected HTTP client.
      await tester.pumpWidget(const SizedBox.shrink());
    },
  );

  testWidgets(
    'active admin dashboard shows Solar and opens the control centre',
    (WidgetTester tester) async {
      final _RouteObserver observer = _RouteObserver();
      tester.view.physicalSize = const Size(800, 1200);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      await tester.pumpWidget(
        MaterialApp(
          home: const AdminDashboardScreen(),
          navigatorObservers: <NavigatorObserver>[observer],
        ),
      );
      await tester.pump(const Duration(milliseconds: 100));

      final Finder solarEntry = find.text('ServicePay Solar');
      await tester.scrollUntilVisible(
        solarEntry,
        300,
        scrollable: find.byType(Scrollable).first,
      );
      expect(solarEntry, findsOneWidget);

      await tester.tap(solarEntry);
      expect(observer.pushedRoutes, contains('/admin/solar'));
    },
  );
}

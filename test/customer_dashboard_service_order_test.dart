import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:servicepay_app/dashboard_screen.dart';

class _DashboardRouteObserver extends NavigatorObserver {
  final List<Route<dynamic>> pushedRoutes = <Route<dynamic>>[];

  @override
  void didPush(Route<dynamic> route, Route<dynamic>? previousRoute) {
    pushedRoutes.add(route);
    super.didPush(route, previousRoute);
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() {
    SharedPreferences.setMockInitialValues(<String, Object>{
      'auth_token': 'dashboard-service-order-test-token',
      'user_name': 'Dashboard Test User',
      'user_role': 'CUSTOMER',
    });
  });

  testWidgets('shows the seven priority services in order and opens each tile',
      (WidgetTester tester) async {
    final _DashboardRouteObserver observer = _DashboardRouteObserver();

    await tester.binding.setSurfaceSize(const Size(800, 1200));
    addTearDown(() => tester.binding.setSurfaceSize(null));

    await tester.pumpWidget(
      MaterialApp(
        home: const DashboardScreen(),
        navigatorObservers: <NavigatorObserver>[observer],
      ),
    );
    await tester.pump(const Duration(milliseconds: 100));
    final NavigatorState navigator =
        tester.state<NavigatorState>(find.byType(Navigator).first);

    const List<String> priorityServices = <String>[
      'Delivery',
      'ServicePay Solar',
      'Empowerment',
      'Marketplace',
      'ServicePay Amana',
      'Data',
      'NIN Verification',
    ];

    for (final String service in priorityServices) {
      expect(find.text(service), findsOneWidget);
    }
    expect(find.text('Airtime'), findsNothing);
    expect(find.text('Electricity'), findsNothing);
    expect(find.text('All Services'), findsOneWidget);

    final List<Offset> positions = <Offset>[
      for (final String service in priorityServices)
        tester.getCenter(find.text(service)),
    ];
    for (int index = 1; index < positions.length; index++) {
      final bool sameRow =
          (positions[index].dy - positions[index - 1].dy).abs() < 20;
      expect(
        sameRow
            ? positions[index].dx > positions[index - 1].dx
            : positions[index].dy > positions[index - 1].dy,
        isTrue,
        reason: 'Priority service order changed at index $index',
      );
    }

    for (final String service in priorityServices) {
      final int routesBeforeTap = observer.pushedRoutes.length;
      await tester.tap(find.text(service));
      expect(observer.pushedRoutes.length, routesBeforeTap + 1);
      navigator.pop();
      await tester.pump();
    }
  });

  testWidgets('keeps the All Services route for non-priority services',
      (WidgetTester tester) async {
    final _DashboardRouteObserver observer = _DashboardRouteObserver();

    await tester.binding.setSurfaceSize(const Size(800, 1200));
    addTearDown(() => tester.binding.setSurfaceSize(null));

    await tester.pumpWidget(
      MaterialApp(
        home: const DashboardScreen(),
        navigatorObservers: <NavigatorObserver>[observer],
      ),
    );
    await tester.pump(const Duration(milliseconds: 100));

    final int routesBeforeTap = observer.pushedRoutes.length;
    await tester.tap(find.text('All Services'));
    expect(observer.pushedRoutes.length, routesBeforeTap + 1);
  });
}

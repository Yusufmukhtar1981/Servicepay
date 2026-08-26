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

Finder _serviceLabel(String value) => find.byWidgetPredicate(
      (Widget widget) => widget is Text && widget.data == value,
    );

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() {
    SharedPreferences.setMockInitialValues(<String, Object>{
      'auth_token': 'dashboard-service-order-test-token',
      'user_name': 'Dashboard Test User',
      'user_role': 'CUSTOMER',
    });
  });

  testWidgets('shows the nine main services in order and opens each tile',
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

    const List<String> mainServices = <String>[
      'Delivery',
      'ServicePay Solar',
      'Empowerment',
      'Marketplace',
      'ServicePay Amana',
      'NIN Verification',
      'Data',
      'Airtime',
      'Electricity',
    ];

    for (final String service in mainServices) {
      expect(find.text(service), findsOneWidget);
    }
    expect(find.text('Keke Napep'), findsNothing);
    expect(find.text('Cable TV'), findsNothing);
    expect(find.text('Exam PIN'), findsNothing);
    expect(find.text('AI Support'), findsNothing);
    expect(find.text('All Services'), findsOneWidget);

    final List<Offset> positions = <Offset>[
      for (final String service in mainServices)
        tester.getCenter(find.text(service)),
    ];
    for (int row = 0; row < 3; row++) {
      final List<Offset> rowPositions = positions.sublist(row * 3, row * 3 + 3);
      expect(
        rowPositions.every(
          (Offset position) => (position.dy - rowPositions.first.dy).abs() < 20,
        ),
        isTrue,
        reason: 'Main service row ${row + 1} is not horizontal',
      );
      expect(
        rowPositions[0].dx < rowPositions[1].dx &&
            rowPositions[1].dx < rowPositions[2].dx,
        isTrue,
        reason: 'Main service order changed in row ${row + 1}',
      );
      if (row < 2) {
        expect(
          rowPositions[0].dy < positions[(row + 1) * 3].dy,
          isTrue,
          reason: 'Main service row order changed after row ${row + 1}',
        );
      }
    }

    for (final String service in mainServices) {
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
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 400));
    final Finder search = find.byType(TextField);
    expect(search, findsOneWidget);
    for (final String service in <String>[
      'Cable TV',
      'AI Support',
      'Flight Booking',
    ]) {
      await tester.enterText(search, service);
      await tester.pump();
      expect(_serviceLabel(service), findsOneWidget);
    }
  });
}

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

  testWidgets('shows the six essential services in order and opens each tile',
      (WidgetTester tester) async {
    final _DashboardRouteObserver observer = _DashboardRouteObserver();
    int electricityBuilderCalls = 0;

    tester.view.physicalSize = const Size(800, 1200);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await tester.pumpWidget(
      MaterialApp(
        home: DashboardScreen(
          electricityScreenBuilder: () {
            electricityBuilderCalls++;
            return const Scaffold(
              body: Center(
                child: Text(
                  'Existing electricity screen builder',
                  key: Key('existing-electricity-screen-builder'),
                ),
              ),
            );
          },
        ),
        navigatorObservers: <NavigatorObserver>[observer],
      ),
    );
    await tester.pump(const Duration(milliseconds: 100));
    final NavigatorState navigator =
        tester.state<NavigatorState>(find.byType(Navigator).first);

    const List<String> mainServices = <String>[
      'Data',
      'Airtime',
      'Delivery',
      'EduPay',
      'Marketplace',
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
    expect(
      find.byKey(const Key('customer-quick-service-servicepay solar')),
      findsNothing,
    );

    final List<Offset> positions = <Offset>[
      for (final String service in mainServices)
        tester.getCenter(find.text(service)),
    ];
    for (int row = 0; row < 2; row++) {
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
      if (row < 1) {
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
      if (service == 'Electricity') {
        await tester.pumpAndSettle();
        expect(electricityBuilderCalls, 1);
        expect(
          find.byKey(const Key('existing-electricity-screen-builder')),
          findsOneWidget,
        );
      }
      navigator.pop();
      await tester.pump();
    }
  });

  testWidgets('keeps the All Services route for non-priority services',
      (WidgetTester tester) async {
    final _DashboardRouteObserver observer = _DashboardRouteObserver();

    tester.view.physicalSize = const Size(800, 1200);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

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

    await tester.enterText(search, 'Solar');
    await tester.pump();
    final Finder solar = _serviceLabel('ServicePay Solar');
    expect(solar, findsOneWidget);
    await tester.ensureVisible(solar);
    expect(find.text('Temporarily unavailable'), findsNothing);
  });

  testWidgets('quick service grid stays readable at narrow widths and scaling',
      (WidgetTester tester) async {
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    for (final Size size in <Size>[
      const Size(320, 760),
      const Size(360, 800),
      const Size(390, 844),
    ]) {
      tester.view.physicalSize = size;
      tester.view.devicePixelRatio = 1;
      await tester.pumpWidget(
        MaterialApp(
          home: MediaQuery(
            data: MediaQueryData(
              size: size,
              textScaler: const TextScaler.linear(1.45),
            ),
            child: const DashboardScreen(),
          ),
        ),
      );
      await tester.pump(const Duration(milliseconds: 100));

      const List<String> services = <String>[
        'Data',
        'Airtime',
        'Delivery',
        'EduPay',
        'Marketplace',
        'Electricity',
      ];
      final List<Offset> positions = <Offset>[
        for (final String service in services)
          tester.getCenter(find.text(service)),
      ];
      for (int row = 0; row < 2; row++) {
        final List<Offset> rowPositions =
            positions.sublist(row * 3, row * 3 + 3);
        expect(
          rowPositions.every(
            (Offset position) =>
                (position.dy - rowPositions.first.dy).abs() < 20,
          ),
          isTrue,
        );
        expect(rowPositions[0].dx, lessThan(rowPositions[1].dx));
        expect(rowPositions[1].dx, lessThan(rowPositions[2].dx));
      }
      expect(positions[0].dy, lessThan(positions[3].dy));
      final Object? exception = tester.takeException();
      expect(exception, isNull);
    }
  });
}

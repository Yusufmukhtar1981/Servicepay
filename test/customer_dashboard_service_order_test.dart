import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:servicepay_app/dashboard_screen.dart';
import 'package:servicepay_app/id_verification_screen.dart';
import 'package:servicepay_app/keke_order_screen.dart';
import 'package:servicepay_app/widgets/flight_booking_unavailable_screen.dart';

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

  testWidgets('shows nine services in three rows and opens the existing routes',
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
      'NIN Verification',
      'Keke Napep',
      'Flight Booking',
    ];

    for (final String service in mainServices) {
      expect(find.text(service), findsOneWidget);
    }
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
    expect(
      tester.widget<GridView>(find.byKey(const Key('customer-services-grid')))
          .semanticChildCount,
      9,
    );
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
      await tester.ensureVisible(find.text(service));
      await tester.tap(find.text(service));
      expect(observer.pushedRoutes.length, routesBeforeTap + 1);
      final Route<dynamic> route = observer.pushedRoutes.last;
      if (<String>['NIN Verification', 'Keke Napep', 'Flight Booking']
          .contains(service)) {
        final Widget destination = (route as MaterialPageRoute<dynamic>)
            .builder(tester.element(find.byType(DashboardScreen)));
        switch (service) {
          case 'NIN Verification':
            expect(destination, isA<IdVerificationScreen>());
          case 'Keke Napep':
            expect(destination, isA<KekeOrderScreen>());
            expect(route.settings.name, '/transport');
          case 'Flight Booking':
            expect(destination, isA<FlightBookingUnavailableScreen>());
            expect(route.settings.name, '/flight-booking');
        }
      }
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

  for (final double width in <double>[320, 360, 412, 600]) {
    for (final double textScale in <double>[1, 2]) {
      testWidgets('nine labels fit at width $width and scale $textScale',
          (WidgetTester tester) async {
        tester.view.physicalSize = Size(width, 1500);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);
        await tester.pumpWidget(MaterialApp(
          builder: (BuildContext context, Widget? child) => MediaQuery(
            data: MediaQuery.of(context).copyWith(
              textScaler: TextScaler.linear(textScale),
            ),
            child: child!,
          ),
          home: const DashboardScreen(),
        ));
        await tester.pump(const Duration(milliseconds: 100));
        final Finder grid = find.byKey(const Key('customer-services-grid'));
        expect(grid, findsOneWidget);
        final GridView widget = tester.widget<GridView>(grid);
        final SliverGridDelegateWithFixedCrossAxisCount delegate =
            widget.gridDelegate as SliverGridDelegateWithFixedCrossAxisCount;
        expect(delegate.crossAxisCount, 3);
        expect(widget.semanticChildCount, 9);
        for (final String title in <String>[
          'Data', 'Airtime', 'Delivery', 'EduPay', 'Marketplace', 'Electricity',
          'NIN Verification', 'Keke Napep', 'Flight Booking',
        ]) {
          final Finder label = find.descendant(of: grid, matching: find.text(title));
          expect(label, findsOneWidget);
          final Text text = tester.widget<Text>(label);
          expect(text.overflow, isNot(TextOverflow.ellipsis));
          expect(text.maxLines, isNull);
          final Rect labelRect = tester.getRect(label);
          final Rect tile = tester.getRect(find.byKey(
            Key('customer-quick-service-${title.toLowerCase()}'),
          ));
          expect(tile.inflate(0.1).contains(labelRect.topLeft), isTrue);
          expect(tile.inflate(0.1).contains(labelRect.bottomRight), isTrue);
        }
        expect(tester.takeException(), isNull);
      });
    }
  }

  testWidgets('flight entry is honest, read-only and can return to services',
      (WidgetTester tester) async {
    await tester.pumpWidget(const MaterialApp(home: DashboardScreen()));
    await tester.pump(const Duration(milliseconds: 100));
    final Finder flight = find.byKey(const Key('customer-quick-service-flight booking'));
    await tester.ensureVisible(flight);
    await tester.pump();
    await tester.tap(flight);
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 400));
    expect(find.byType(FlightBookingUnavailableScreen), findsOneWidget);
    expect(find.text('Coming soon'), findsOneWidget);
    expect(find.text('This page cannot create a booking or take payment.'), findsOneWidget);
    expect(find.text('Search Flights'), findsNothing);
    expect(find.byType(TextField), findsNothing);
    await tester.tap(find.text('Back to services'));
    // Dashboard decorative animations intentionally continue after returning.
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 400));
    expect(find.byKey(const Key('customer-services-grid')), findsOneWidget);
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
    // Cable TV was intentionally hidden by the approved Customer cleanup.
    // Preserve that policy rather than restoring it to satisfy an old fixture.
    await tester.enterText(search, 'Cable TV');
    await tester.pump();
    expect(_serviceLabel('Cable TV'), findsNothing);
    for (final String service in <String>[
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
        'NIN Verification',
        'Keke Napep',
        'Flight Booking',
      ];
      final List<Offset> positions = <Offset>[
        for (final String service in services)
          tester.getCenter(find.text(service)),
      ];
      for (int row = 0; row < 3; row++) {
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

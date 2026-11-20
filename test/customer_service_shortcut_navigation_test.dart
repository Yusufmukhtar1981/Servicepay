import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:servicepay_app/dashboard_screen.dart';
import 'package:servicepay_app/widgets/customer_dashboard_visuals.dart';

class _ShortcutObserver extends NavigatorObserver {
  Route<dynamic>? opened;

  @override
  void didPush(Route<dynamic> route, Route<dynamic>? previousRoute) {
    opened = route;
  }
}

void main() {
  const homeTitles = [
    'Data',
    'Airtime',
    'Delivery',
    'NIN Verification',
    'Marketplace',
    'Electricity',
    'EduPay',
    'Keke Napep',
    'Flight Booking',
  ];
  const destinations = <String, String>{
    'Data': 'DataScreen',
    'Airtime': 'AirtimeScreen',
    'Delivery': 'LogisticsScreen',
    'EduPay': 'EduPayScreen',
    'Marketplace': 'MarketplaceScreen',
    'Electricity': 'ElectricityScreen',
    'NIN Verification': 'IdVerificationScreen',
    'Keke Napep': 'KekeOrderScreen',
    'Flight Booking': 'FlightBookingUnavailableScreen',
    'ServicePay Amana': 'AmanaScreen',
    'ServicePay Solar': 'SolarScreen',
    'Phone Financing': 'PhoneFinancingScreen',
    'AI Support': 'AiSupportScreen',
    'Cards': 'CardsScreen',
    'Mini Apps': 'MiniAppsScreen',
    'Empowerment': 'EmpowermentScreen',
    'Program Sponsor': 'ProgramSponsorScreen',
    'Partner API': 'PartnerApplicationScreen',
    'Agent Locator': 'CommunityAgentLocatorScreen',
    'Organizations': 'OrganizationsScreen',
    'Transport': 'KekeOrderScreen',
    'Cashback': 'CashbackScreen',
    'Referral': 'ReferralScreen',
    'KYC': 'KycScreen',
    'Biometrics': 'ProfileScreen',
    'Transaction PIN': 'ProfileScreen',
  };

  for (final onHome in [true, false]) {
    for (final entry in destinations.entries
        .where((entry) => !onHome || homeTitles.contains(entry.key))) {
      testWidgets(
          '${entry.key} ${onHome ? 'Home' : 'All Services'} icon invokes its existing destination',
          (tester) async {
        SharedPreferences.setMockInitialValues({
          'user_name': 'Test Customer',
          'user_role': 'CUSTOMER',
          'wallet_balance': 24500.0,
        });
        await tester.binding.setSurfaceSize(const Size(390, 844));
        addTearDown(() => tester.binding.setSurfaceSize(null));
        final requests = <http.Request>[];
        final client = MockClient((request) async {
          requests.add(request);
          return http.Response('{}', 404);
        });
        final observer = _ShortcutObserver();
        await tester.pumpWidget(MaterialApp(
          navigatorObservers: [observer],
          home: DashboardScreen(client: client),
        ));
        await tester.pump(const Duration(milliseconds: 100));
        if (!onHome) {
          final allServices = find.byKey(const Key('customer-all-services'));
          await tester.ensureVisible(allServices);
          await tester.tap(allServices);
          await tester.pump();
          await tester.pump(const Duration(milliseconds: 350));
          expect(find.text('All Services'), findsOneWidget);
          // Categories below the viewport are lazy-built; use the existing
          // search to bring each original service into view before tapping it.
          await tester.enterText(find.byType(TextField), entry.key);
          await tester.pump();
        }
        final shortcut = onHome
            ? find
                .byKey(Key('customer-quick-service-${entry.key.toLowerCase()}'))
            : find
                .ancestor(
                    of: find.text(entry.key).last,
                    matching: find.byType(InkWell))
                .first;
        expect(shortcut, findsOneWidget);
        if (onHome)
          expect(
              find.descendant(
                  of: shortcut, matching: find.byType(CustomerServiceGlyph)),
              findsOneWidget);
        await tester.ensureVisible(shortcut);
        observer.opened = null;
        await tester.tap(shortcut);
        final route = observer.opened;
        expect(route, isA<MaterialPageRoute<dynamic>>());
        // Inspect the real navigation callback without mounting a payment screen
        // or initiating any screen-specific network/provider operation.
        final destination = (route! as MaterialPageRoute<dynamic>)
            .builder(tester.element(shortcut));
        expect(destination.runtimeType.toString(), entry.value);
        expect(requests.every((request) => request.method == 'GET'), isTrue);
        await tester.pumpWidget(const SizedBox.shrink());
        expect(tester.takeException(), isNull);
      });
    }
  }

  testWidgets(
      'all Home shortcuts are unique and the grid scrolls to the bottom',
      (tester) async {
    SharedPreferences.setMockInitialValues({'user_role': 'CUSTOMER'});
    for (final (width, scale) in [
      (320.0, 1.0),
      (390.0, 2.0),
      (768.0, 1.0),
    ]) {
      await tester.binding.setSurfaceSize(Size(width, 844));
      await tester.pumpWidget(MaterialApp(
        home: Builder(
          builder: (context) => MediaQuery(
            data: MediaQuery.of(context)
                .copyWith(textScaler: TextScaler.linear(scale)),
            child: DashboardScreen(
              client: MockClient((_) async => http.Response('{}', 404)),
            ),
          ),
        ),
      ));
      await tester.pump(const Duration(milliseconds: 100));
      final grid = find.byKey(const Key('customer-services-grid'));
      final shortcuts = find.descendant(
          of: grid,
          matching: find.byWidgetPredicate((widget) =>
              widget is InkWell &&
              widget.key.toString().contains('customer-quick-service-')));
      expect(shortcuts, findsNWidgets(9));
      final labels = shortcuts
          .evaluate()
          .map((element) => (element.widget.key as ValueKey<String>)
              .value
              .replaceFirst('customer-quick-service-', ''))
          .toList();
      expect(labels, homeTitles.map((title) => title.toLowerCase()).toList());
      final delegate = tester.widget<GridView>(grid).gridDelegate
          as SliverGridDelegateWithFixedCrossAxisCount;
      expect(delegate.crossAxisCount, 3);
      for (final title in destinations.keys) {
        expect(find.byKey(Key('customer-quick-service-${title.toLowerCase()}')),
            homeTitles.contains(title) ? findsOneWidget : findsNothing);
      }
      await tester.ensureVisible(
          find.byKey(const Key('customer-transaction-insights')));
      expect(tester.takeException(), isNull);
      expect(find.byKey(const Key('customer-all-services')), findsOneWidget);
      await tester.pumpWidget(const SizedBox.shrink());
    }
    await tester.binding.setSurfaceSize(null);
  });
}

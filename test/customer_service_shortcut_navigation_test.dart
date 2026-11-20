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

  for (final entry in destinations.entries) {
    testWidgets('${entry.key} Home icon invokes its existing destination',
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
      final shortcut =
          find.byKey(Key('customer-quick-service-${entry.key.toLowerCase()}'));
      expect(shortcut, findsOneWidget);
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
      expect(shortcuts, findsNWidgets(destinations.length));
      for (final title in destinations.keys) {
        expect(find.byKey(Key('customer-quick-service-${title.toLowerCase()}')),
            findsOneWidget);
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

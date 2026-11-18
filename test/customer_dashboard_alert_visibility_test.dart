import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:servicepay_app/dashboard_screen.dart';
import 'package:servicepay_app/main_navigation.dart';
import 'package:servicepay_app/widgets/customer_dashboard_visibility.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('real navigation marks Dashboard hidden on every other tab',
      (tester) async {
    SharedPreferences.setMockInitialValues({'user_role': 'CUSTOMER'});
    await tester.pumpWidget(const MaterialApp(home: MainNavigation()));
    await tester.pump(const Duration(milliseconds: 100));
    for (final tab in ['Transactions', 'Wallet', 'Profile', 'Home']) {
      await tester.tap(find.text(tab).last);
      await tester.pump(const Duration(milliseconds: 100));
      final dashboard =
          find.byType(DashboardScreen, skipOffstage: false).evaluate().single;
      expect(CustomerDashboardVisibility.of(dashboard), tab == 'Home');
    }
    await tester.pumpWidget(const SizedBox());
  });

  for (final tab in [1, 2, 3]) {
    testWidgets('credit is not claimed while tab $tab hides the real Dashboard',
        (tester) async {
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
      SharedPreferences.setMockInitialValues({
        'user_role': 'CUSTOMER',
        'auth_token': 'isolated-customer',
        'wallet_balance': 42.0,
      });
      var claims = 0;
      final client = MockClient((request) async {
        if (request.url.path.endsWith('/wallet-credit-alerts/next')) claims++;
        return http.Response(
            jsonEncode({
              'success': true,
              'settings': {
                'dashboardBackground': 'green',
                'soundNotifications': false,
                'voiceAnnouncements': false,
              },
              'alert': null,
              'balance': 42,
              'transactions': [],
              'notifications': [],
            }),
            200);
      });
      final selected = ValueNotifier<int>(tab);
      await tester.pumpWidget(MaterialApp(
        home: ValueListenableBuilder<int>(
          valueListenable: selected,
          builder: (_, index, __) => IndexedStack(
            index: index,
            children: [
              CustomerDashboardVisibility(
                visible: index == 0,
                child: DashboardScreen(client: client),
              ),
              const Text('Transactions'),
              const Text('Wallet'),
              const Text('Profile'),
            ],
          ),
        ),
      ));
      for (var i = 0; i < 12; i++) {
        await tester.pump(const Duration(milliseconds: 20));
      }
      await tester.pump(const Duration(seconds: 21));
      expect(claims, 0);
      selected.value = 0;
      await tester.pump();
      await tester.pump(const Duration(seconds: 21));
      for (var i = 0; i < 5; i++) {
        await tester.pump(const Duration(milliseconds: 20));
      }
      expect(claims, greaterThan(0));
      selected.value = tab;
      await tester.pump();
      final before = claims;
      await tester.pump(const Duration(seconds: 41));
      expect(claims, before);
      await tester.pumpWidget(const SizedBox());
      await tester.pump();
      selected.dispose();
      client.close();
    });
  }
}

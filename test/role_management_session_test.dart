import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:servicepay_app/create_agent_screen.dart';
import 'package:servicepay_app/create_customer_screen.dart';
import 'package:servicepay_app/create_state_manager_screen.dart';
import 'package:servicepay_app/my_customers_screen.dart';
import 'package:servicepay_app/role_dashboard_screen.dart';
import 'package:servicepay_app/services/session_store.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  void useTallTestViewport(WidgetTester tester) {
    tester.view.physicalSize = const Size(800, 1600);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
  }

  setUp(() async {
    SharedPreferences.setMockInitialValues(<String, Object>{});
    await SessionStore.clear();
  });

  test('SessionStore reads old login tokens and supports fresh sessions',
      () async {
    SharedPreferences.setMockInitialValues(<String, Object>{
      'auth_token': ' legacy-manager-token ',
    });
    expect(await SessionStore.readToken(), 'legacy-manager-token');

    await SessionStore.clear();
    await SessionStore.writeToken('new-manager-token');
    expect(await SessionStore.readToken(), 'new-manager-token');

    await SessionStore.clear();
    expect(await SessionStore.readToken(), isNull);
  });

  test('all hierarchy create, list, and role-summary requests use SessionStore',
      () {
    const files = <String>[
      'create_state_manager_screen.dart',
      'create_agent_screen.dart',
      'create_customer_screen.dart',
      'management_users_screen.dart',
      'my_customers_screen.dart',
      'role_dashboard_screen.dart',
    ];

    for (final String fileName in files) {
      final String source = File('lib/$fileName').readAsStringSync();
      expect(source, contains('SessionStore.readToken()'), reason: fileName);
      expect(source, contains("'Authorization': 'Bearer \$token'"),
          reason: fileName);
      for (final String legacyKey in const [
        'auth_token',
        'access_token',
        'accessToken',
        'admin_token',
      ]) {
        expect(source, isNot(contains("'$legacyKey'")), reason: fileName);
      }
    }

  });

  testWidgets('Zonal Manager navigation opens the State Manager form',
      (tester) async {
    useTallTestViewport(tester);
    await tester.pumpWidget(const MaterialApp(
      home: RoleDashboardScreen(role: 'ZONAL_MANAGER'),
    ));
    await tester.pump();

    final Finder createAction = find.text('Create State Manager');
    expect(createAction, findsOneWidget);
    expect(find.text('State Managers'), findsOneWidget);
    await tester.tap(createAction);
    await tester.pumpAndSettle();
    expect(find.byType(CreateStateManagerScreen), findsOneWidget);
  });

  testWidgets('State Manager navigation opens the Aggregator form',
      (tester) async {
    useTallTestViewport(tester);
    await tester.pumpWidget(const MaterialApp(
      home: RoleDashboardScreen(role: 'STATE_MANAGER'),
    ));
    await tester.pump();

    final Finder createAction = find.text('Create Aggregator');
    expect(createAction, findsOneWidget);
    expect(find.text('Aggregators'), findsOneWidget);
    await tester.tap(createAction);
    await tester.pumpAndSettle();
    expect(find.byType(CreateAgentScreen), findsOneWidget);
  });

  testWidgets('Agent navigation opens its customer list and create form',
      (tester) async {
    useTallTestViewport(tester);
    await tester.pumpWidget(const MaterialApp(
      home: RoleDashboardScreen(role: 'AGENT'),
    ));
    await tester.pump();

    final Finder customersAction = find.text('My Customers');
    expect(customersAction, findsOneWidget);
    await tester.tap(customersAction);
    await tester.pumpAndSettle();
    expect(find.byType(MyCustomersScreen), findsOneWidget);

    await tester.tap(find.text('Create Customer'));
    await tester.pumpAndSettle();
    expect(find.byType(CreateCustomerScreen), findsOneWidget);
  });
}
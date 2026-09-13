import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:servicepay_app/business_partner/business_partner_dashboard_screen.dart';
import 'package:servicepay_app/login_screen.dart';
import 'package:servicepay_app/services/business_partner_api_service.dart';

class _DashboardApi extends BusinessPartnerApiService {
  _DashboardApi({this.includeSensitivePermissions = true});

  final bool includeSensitivePermissions;

  @override
  Future<Map<String, dynamic>> dashboard(
          {Map<String, String>? filters}) async =>
      <String, dynamic>{
        'dashboard': <String, dynamic>{
          'totalOfficers': 18,
          'activeCustomers': 264,
          'salesValue': 8750000,
          'pendingApplications': 12,
          'transactionChart': <Map<String, dynamic>>[
            <String, dynamic>{'label': 'W1', 'value': 4},
            <String, dynamic>{'label': 'W2', 'value': 9},
          ],
          'commissionChart': <Map<String, dynamic>>[
            <String, dynamic>{'label': 'W1', 'value': 1200},
            <String, dynamic>{'label': 'W2', 'value': 2400},
          ],
          'topPerformingOfficers': <Map<String, dynamic>>[
            <String, dynamic>{
              'fullName': 'Amina Bello',
              'transactions': 8,
              'commission': 15000,
            },
          ],
        },
      };

  @override
  Future<Map<String, dynamic>> officers({Map<String, String>? filters}) async =>
      <String, dynamic>{
        'officers': <String, dynamic>{
          'solar': <Map<String, dynamic>>[
            <String, dynamic>{
              '_id': 'solar-officer-1',
              'fullName': 'Amina Bello',
            },
          ],
          'phone': <Map<String, dynamic>>[
            <String, dynamic>{
              '_id': 'phone-officer-1',
              'fullName': 'Ibrahim Musa',
            },
          ],
        },
      };

  @override
  Future<Map<String, dynamic>> customers(
          {Map<String, String>? filters}) async =>
      <String, dynamic>{'customers': <Map<String, dynamic>>[]};

  @override
  Future<Map<String, dynamic>> createCustomer({
    required String fullName,
    required String phone,
    required String email,
    String? officerId,
  }) async =>
      <String, dynamic>{
        'success': true,
        'customer': <String, dynamic>{'id': 'customer-1', 'fullName': fullName},
      };

  @override
  Future<Map<String, dynamic>> applications(
          {Map<String, String>? filters}) async =>
      <String, dynamic>{
        'applications': <String, dynamic>{
          'solar': <Map<String, dynamic>>[
            <String, dynamic>{
              '_id': 'solar-application-1',
              'customerName': 'Fatima Garba',
              'status': 'PENDING',
              'amount': 780000,
            },
          ],
          'phone': <Map<String, dynamic>>[
            <String, dynamic>{
              '_id': 'phone-application-1',
              'customerName': 'David Okoro',
              'status': 'ACTIVE',
              'amount': 320000,
            },
          ],
        },
      };

  @override
  Future<Map<String, dynamic>> repayments(
          {Map<String, String>? filters}) async =>
      <String, dynamic>{'repayments': <String, dynamic>{}};

  @override
  Future<Map<String, dynamic>> commission(
          {Map<String, String>? filters}) async =>
      <String, dynamic>{'commissions': <Map<String, dynamic>>[]};

  @override
  Future<Map<String, dynamic>> commissionWallet(
          {Map<String, String>? filters}) async =>
      <String, dynamic>{
        'wallet': <String, dynamic>{
          'available': 12500,
          'pending': 3000,
          'paid': 9000,
          'lifetime': 24500,
        },
        'ledger': <Map<String, dynamic>>[
          <String, dynamic>{
            'commissionType': 'PERFORMANCE_BONUS',
            'amount': 1200,
            'status': 'PAID',
            'createdAt': '2026-01-01T00:00:00Z',
          },
          <String, dynamic>{
            'commissionType': 'CAMPAIGN_BONUS',
            'amount': 800,
            'status': 'PENDING',
            'createdAt': '2026-01-02T00:00:00Z',
          },
        ],
        'pagination': <String, dynamic>{
          'page': 1,
          'limit': 25,
          'total': 2,
          'pages': 1
        },
      };

  @override
  Future<Map<String, dynamic>> performance(
          {Map<String, String>? filters}) async =>
      <String, dynamic>{
        'performance': <String, dynamic>{
          'weekOne': 34,
          'weekTwo': 52,
          'weekThree': 71,
          'weekFour': 64,
        },
      };

  @override
  Future<Map<String, dynamic>> reports({Map<String, String>? filters}) async =>
      <String, dynamic>{'reports': <Map<String, dynamic>>[]};

  @override
  Future<Map<String, dynamic>> notifications(
          {Map<String, String>? filters}) async =>
      <String, dynamic>{'notifications': <Map<String, dynamic>>[]};

  @override
  Future<Map<String, dynamic>> activity({Map<String, String>? filters}) async =>
      <String, dynamic>{
        'items': <Map<String, dynamic>>[
          <String, dynamic>{'title': 'A new solar application was assigned'},
          <String, dynamic>{'title': 'Monthly commission report is ready'},
        ],
      };

  @override
  Future<Map<String, dynamic>> profile() async => <String, dynamic>{
        'partner': <String, dynamic>{
          'businessName': 'Northstar Distribution',
          'permissions': includeSensitivePermissions
              ? <String>[
                  'SOLAR_ASSIGNMENT',
                  'PHONE_ASSIGNMENT',
                  'VERIFICATION_REVIEW',
                ]
              : <String>[],
        },
      };
}

Widget _screen({bool includeSensitivePermissions = true}) => MaterialApp(
      debugShowCheckedModeBanner: false,
      home: BusinessPartnerDashboardScreen(
          api: _DashboardApi(
              includeSensitivePermissions: includeSensitivePermissions)),
    );

void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues(<String, Object>{
      'auth_token': 'business-partner-token',
      'user_role': 'BUSINESS_PARTNER',
      'business_partner_id': 'partner-1',
    });
  });

  testWidgets('renders premium desktop workspace without layout errors',
      (WidgetTester tester) async {
    tester.view.physicalSize = const Size(1440, 1000);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await tester.pumpWidget(_screen());
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('business-partner-dashboard')), findsOneWidget);
    expect(find.text('ServicePay'), findsWidgets);
    expect(find.text('Business Partner'), findsWidgets);
    expect(find.text('Welcome back, Northstar Distribution'), findsOneWidget);
    expect(find.text('Portfolio snapshot'), findsOneWidget);
    expect(find.text('Recent activity'), findsOneWidget);
    for (final String technicalField in <String>[
      'permissions',
      'availableModules',
      'totalOfficers',
      'activeCustomers',
      '_id',
    ]) {
      expect(find.textContaining(technicalField), findsNothing);
    }

    await tester.tap(find.text('Assigned Solar').first);
    await tester.pumpAndSettle();
    expect(find.text('Fatima Garba'), findsWidgets);
    expect(find.byTooltip('Assign officer'), findsOneWidget);
    expect(find.byTooltip('Review verification'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('keeps every module reachable from the mobile drawer',
      (WidgetTester tester) async {
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await tester.pumpWidget(_screen());
    await tester.pumpAndSettle();

    expect(find.text('Welcome back, Northstar Distribution'), findsOneWidget);
    expect(tester.takeException(), isNull, reason: 'initial mobile dashboard');
    await tester.tap(find.byTooltip('Open menu'));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull, reason: 'opened mobile drawer');

    for (final String module in <String>[
      'Dashboard',
      'Officer Management',
      'Customers',
      'Assigned Solar',
      'Assigned Phones',
      'Sales & Applications',
      'Repayments',
    ]) {
      expect(find.text(module), findsWidgets);
    }

    await tester.drag(
      find.text('Sales & Applications').last,
      const Offset(0, -350),
    );
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull, reason: 'scrolled mobile drawer');

    for (final String module in <String>[
      'Commission',
      'Performance',
      'Reports',
      'Notifications',
    ]) {
      expect(find.text(module), findsWidgets);
    }
  });

  testWidgets('hides sensitive actions when profile permission is absent',
      (WidgetTester tester) async {
    tester.view.physicalSize = const Size(1200, 900);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await tester.pumpWidget(_screen(includeSensitivePermissions: false));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Assigned Solar').first);
    await tester.pumpAndSettle();

    expect(find.byTooltip('Assign officer'), findsNothing);
    expect(find.byTooltip('Review verification'), findsNothing);
    expect(find.textContaining('permissions'), findsNothing);
    expect(find.textContaining('availableModules'), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('profile logout supports cancel and clears the protected session',
      (WidgetTester tester) async {
    tester.view.physicalSize = const Size(1440, 1000);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await tester.pumpWidget(_screen());
    await tester.pumpAndSettle();
    await tester.tap(find.text('Profile').first);
    await tester.pumpAndSettle();

    final Finder logout =
        find.byKey(const Key('business-partner-profile-logout'));
    expect(logout, findsOneWidget);

    await tester.tap(logout);
    await tester.pumpAndSettle();
    expect(find.text('Are you sure you want to log out?'), findsOneWidget);

    await tester.tap(find.text('Cancel'));
    await tester.pumpAndSettle();
    expect(find.byType(BusinessPartnerDashboardScreen), findsOneWidget);
    expect(
      (await SharedPreferences.getInstance()).getString('auth_token'),
      'business-partner-token',
    );

    await tester.tap(logout);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Logout').last);
    await tester.pumpAndSettle();

    expect(find.byType(LoginScreen), findsOneWidget);
    final SharedPreferences preferences = await SharedPreferences.getInstance();
    expect(preferences.getString('auth_token'), isNull);
    expect(preferences.getString('user_role'), isNull);
    expect(preferences.getString('business_partner_id'), isNull);
    expect(
        tester.state<NavigatorState>(find.byType(Navigator)).canPop(), isFalse);
  });

  testWidgets('keeps create-customer quick action usable at 360 and 390 pixels',
      (WidgetTester tester) async {
    for (final Size size in <Size>[
      const Size(360, 800),
      const Size(390, 844),
    ]) {
      tester.view.physicalSize = size;
      tester.view.devicePixelRatio = 1;
      await tester.pumpWidget(_screen());
      await tester.pumpAndSettle();

      expect(tester.takeException(), isNull);
      await tester.scrollUntilVisible(find.text('Create Customer'), 400,
          scrollable: find.byType(Scrollable).first);
      await tester.pumpAndSettle();
      final Finder action = find.text('Create Customer');
      expect(action, findsOneWidget);
      await tester.tap(action);
      await tester.pumpAndSettle();
      expect(find.text('Create ServicePay customer'), findsOneWidget);
      expect(find.textContaining('OTP or password recovery'), findsOneWidget);
      expect(find.text('Temporary password'), findsNothing);
      expect(find.text('Confirm password'), findsNothing);
      expect(find.textContaining('must change'), findsNothing);
      await tester.tap(find.text('Cancel'));
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
    }
    tester.view.resetPhysicalSize();
    tester.view.resetDevicePixelRatio();
  });

  testWidgets('onboarding confirms customer-owned activation after creation',
      (WidgetTester tester) async {
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await tester.pumpWidget(_screen());
    await tester.pumpAndSettle();
    await tester.scrollUntilVisible(find.text('Create Customer'), 400,
        scrollable: find.byType(Scrollable).first);
    await tester.tap(find.text('Create Customer'));
    await tester.pumpAndSettle();

    expect(find.text('Temporary password'), findsNothing);
    expect(find.text('Confirm password'), findsNothing);
    final Finder fields = find.byType(TextFormField);
    await tester.enterText(fields.at(0), 'Ada Lovelace');
    await tester.enterText(fields.at(1), '08012345678');
    await tester.enterText(fields.at(2), 'ada@example.com');
    await tester.tap(find.byKey(const Key('business-partner-save-customer')));
    await tester.pumpAndSettle();

    expect(
        find.textContaining(
            'must activate via OTP or password recovery sent to their own verified contact'),
        findsOneWidget);
    expect(find.textContaining('password:'), findsNothing);
    await tester.tap(find.text('Done'));
    await tester.pumpAndSettle();
  });

  testWidgets('wallet labels and filters earned bonus ledger types',
      (WidgetTester tester) async {
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await tester.pumpWidget(_screen());
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('Open menu'));
    await tester.pumpAndSettle();
    final Finder walletAction = find.text('Commission Wallet').last;
    await tester.ensureVisible(walletAction);
    await tester.tap(walletAction);
    await tester.pumpAndSettle();

    expect(find.text('PERFORMANCE_BONUS'), findsWidgets);
    expect(find.text('CAMPAIGN_BONUS'), findsWidgets);
    await tester.tap(find.text('Bonus type: ALL'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Bonus type: PERFORMANCE_BONUS'));
    await tester.pumpAndSettle();

    expect(find.text('PERFORMANCE_BONUS'), findsWidgets);
    expect(find.text('CAMPAIGN_BONUS'), findsNothing);
  });
}

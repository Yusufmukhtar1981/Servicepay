import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:servicepay_app/business_partner/business_partner_dashboard_screen.dart';
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
}

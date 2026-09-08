import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:servicepay_app/login_screen.dart';
import 'package:servicepay_app/services/solar_officer_api_service.dart';
import 'package:servicepay_app/solar_officer/solar_officer_dashboard_screen.dart';

class _FakeSolarOfficerApi extends SolarOfficerApiService {
  final Map<String, dynamic> application = <String, dynamic>{
    '_id': 'application-1',
    'status': 'UNDER_REVIEW',
    'customer': <String, dynamic>{
      'fullName': 'Assigned Customer',
      'phone': '08000000000',
    },
    'packageSnapshot': <String, dynamic>{
      'name': 'Home Solar',
    },
    'verification': null,
  };

  @override
  Future<Map<String, dynamic>> get(String path) async {
    switch (path) {
      case '/dashboard':
        return <String, dynamic>{
          'dashboard': <String, dynamic>{
            'assignedCustomers': 1,
            'pendingVerification': 1,
            'availableCommission': 1500,
          },
        };
      case '/applications':
        return <String, dynamic>{
          'applications': <Map<String, dynamic>>[application],
        };
      case '/repayments':
        return <String, dynamic>{
          'repayments': <Map<String, dynamic>>[],
        };
      case '/overdue':
        return <String, dynamic>{
          'overdue': <Map<String, dynamic>>[],
        };
      case '/commissions':
        return <String, dynamic>{
          'wallet': <String, dynamic>{
            'pendingBalance': 0,
            'availableBalance': 1500,
            'totalEarned': 1500,
            'totalWithdrawn': 0,
          },
          'commissions': <Map<String, dynamic>>[],
        };
      case '/withdrawals':
        return <String, dynamic>{
          'withdrawals': <Map<String, dynamic>>[],
        };
      case '/performance':
        return <String, dynamic>{
          'performance': <String, dynamic>{
            'customersAssigned': 1,
            'customersVerified': 0,
          },
        };
      case '/me':
        return <String, dynamic>{
          'officer': <String, dynamic>{
            'officerId': 'SSO-000001',
            'status': 'ACTIVE',
            'state': 'Lagos',
            'lga': 'Ikeja',
            'address': '1 Solar Street',
            'user': <String, dynamic>{
              'fullName': 'Field Officer',
              'phone': '08001112222',
              'email': 'officer@example.test',
            },
          },
        };
      default:
        throw StateError('Unexpected path: $path');
    }
  }

  @override
  Future<Map<String, dynamic>> post(
    String path, {
    Map<String, dynamic> body = const <String, dynamic>{},
  }) async {
    return <String, dynamic>{'success': true};
  }
}

void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues(<String, Object>{
      'auth_token': 'solar-officer-token',
      'user_role': 'SOLAR_OFFICER',
      'solar_officer_id': 'SSO-000001',
    });
  });

  testWidgets(
    'Solar Officer gets a dedicated dashboard without Admin approval controls',
    (WidgetTester tester) async {
      await tester.binding.setSurfaceSize(const Size(480, 900));
      addTearDown(() => tester.binding.setSurfaceSize(null));

      await tester.pumpWidget(
        MaterialApp(
          home: SolarOfficerDashboardScreen(
            api: _FakeSolarOfficerApi(),
          ),
        ),
      );
      await tester.pumpAndSettle();

      expect(
        find.byKey(const Key('solar-officer-dashboard')),
        findsOneWidget,
      );
      expect(find.text('Welcome back, Field Officer'), findsOneWidget);
      expect(find.text('Approve'), findsNothing);

      await tester.tap(find.byTooltip('Open navigation menu'));
      await tester.pumpAndSettle();
      for (final String section in <String>[
        'Dashboard',
        'My Assignments',
        'Verification',
        'Installations',
        'Repayments',
        'Customers',
        'Solar Packages',
        'Notifications',
        'Reports',
        'My Profile',
        'Settings',
        'Logout',
      ]) {
        expect(find.text(section), findsWidgets);
      }

      await tester.tap(find.text('Verification').last);
      await tester.pumpAndSettle();
      expect(find.text('Assigned Customer'), findsOneWidget);
      expect(find.text('Verify'), findsOneWidget);
      expect(find.text('Approve'), findsNothing);

      await tester.tap(find.byTooltip('Open navigation menu'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('My Profile').last);
      await tester.pumpAndSettle();
      expect(find.text('Field Officer'), findsOneWidget);
      expect(find.text('SSO-000001 • ACTIVE'), findsOneWidget);
      expect(
        find.byKey(const Key('solar-officer-profile-logout')),
        findsOneWidget,
      );

      await tester.tap(
        find.byKey(const Key('solar-officer-profile-logout')),
      );
      await tester.pumpAndSettle();
      expect(find.text('Are you sure you want to log out?'), findsOneWidget);

      await tester.tap(find.text('Cancel'));
      await tester.pumpAndSettle();
      expect(find.byType(SolarOfficerDashboardScreen), findsOneWidget);
      expect(
        (await SharedPreferences.getInstance()).getString('auth_token'),
        'solar-officer-token',
      );

      await tester.tap(
        find.byKey(const Key('solar-officer-profile-logout')),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.text('Logout').last);
      await tester.pumpAndSettle();

      expect(find.byType(LoginScreen), findsOneWidget);
      final SharedPreferences preferences =
          await SharedPreferences.getInstance();
      expect(preferences.getString('auth_token'), isNull);
      expect(preferences.getString('user_role'), isNull);
      expect(preferences.getString('solar_officer_id'), isNull);
      expect(tester.state<NavigatorState>(find.byType(Navigator)).canPop(),
          isFalse);
    },
  );
}

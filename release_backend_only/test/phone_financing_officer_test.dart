import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:servicepay_app/phone_financing_officer/phone_financing_officer_dashboard_screen.dart';
import 'package:servicepay_app/services/phone_financing_officer_api_service.dart';

class _OfficerApi extends PhoneFinancingOfficerApiService {
  @override
  Future<Map<String, dynamic>> applications() async => <String, dynamic>{
        'applications': <Map<String, dynamic>>[
          <String, dynamic>{
            '_id': 'application-1',
            'reference': 'SPF-0001',
            'status': 'UNDER_REVIEW',
            'customer': <String, dynamic>{
              'fullName': 'Assigned Customer',
              'phone': '08010000000',
              'state': 'Lagos',
            },
          },
        ],
      };

  @override
  Future<Map<String, dynamic>> application(String id) => applications();
}

void main() {
  testWidgets('officer dashboard only exposes scoped field workflow',
      (WidgetTester tester) async {
    await tester.pumpWidget(MaterialApp(
      home: PhoneFinancingOfficerDashboardScreen(api: _OfficerApi()),
    ));
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('phone-financing-officer-dashboard')),
        findsOneWidget);
    expect(find.text('Assigned Customer'), findsOneWidget);
    expect(find.text('Pending verification'), findsOneWidget);
    expect(find.text('Approve'), findsNothing);
    expect(find.text('Assign device'), findsNothing);
  });

  testWidgets('officer dashboard renders scoped navigation and status filters',
      (WidgetTester tester) async {
    await tester.pumpWidget(MaterialApp(
      home: PhoneFinancingOfficerDashboardScreen(api: _OfficerApi()),
    ));
    await tester.pumpAndSettle();

    expect(find.text('Total Assignments'), findsOneWidget);
    expect(find.text('Pending verification'), findsOneWidget);
    expect(find.text('Active Financed'), findsOneWidget);
    expect(find.text('Completed'), findsWidgets);
    expect(find.text('All'), findsOneWidget);
    expect(find.text('Pending'), findsWidgets);
    expect(find.text('In Progress'), findsOneWidget);
    expect(find.text('View Details'), findsOneWidget);
    expect(find.text('Approve'), findsNothing);
    expect(find.text('Assign device'), findsNothing);

    final Finder completedFilter =
        find.byKey(const Key('officer-filter-COMPLETED'));
    await tester.ensureVisible(completedFilter);
    await tester.tap(completedFilter);
    await tester.pump();
    expect(find.text('No assignments found'), findsOneWidget);
  });
}

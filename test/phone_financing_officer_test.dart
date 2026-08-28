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
}
import 'package:flutter_test/flutter_test.dart';
import 'package:servicepay_app/organizations/organization_models.dart';
import 'package:servicepay_app/organizations/organizations_screen.dart';
import 'package:flutter/material.dart';

void main() {
  test('organization maps verified status, fees and membership details', () {
    final organization = Organization.fromJson({
      'id': 'org-1',
      'name': 'Community',
      'status': 'VERIFIED',
      'annualFee': 1200,
      'registrationFee': 500,
      'customFields': [
        {
          'key': 'level',
          'label': 'Level',
          'type': 'SELECT',
          'options': ['Gold']
        },
      ],
      'membership': {
        'status': 'ACTIVE',
        'membershipNumber': 'SP-001',
        'expiryDate': '2030-01-01',
      },
    });
    expect(organization.verified, isTrue);
    expect(organization.annualFee, 1200);
    expect(organization.registrationFee, 500);
    expect(organization.joinStatus, 'ACTIVE');
    expect(organization.membershipNumber, 'SP-001');
    expect(organization.fields.single.options, ['Gold']);
  });

  testWidgets('organizations screen has discover affordance', (tester) async {
    await tester.pumpWidget(const MaterialApp(home: OrganizationsScreen()));
    await tester.pump();
    expect(find.text('Organizations'), findsOneWidget);
  });
}

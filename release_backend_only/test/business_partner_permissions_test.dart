import 'package:flutter_test/flutter_test.dart';
import 'package:servicepay_app/business_partner/business_partner_permissions.dart';

void main() {
  test('permits only explicitly granted business partner actions', () {
    final Map<String, dynamic> profile = <String, dynamic>{
      'permissions': <String>['SOLAR_ASSIGNMENT', 'VERIFICATION_REVIEW'],
    };

    expect(businessPartnerHasPermission(profile, 'SOLAR_ASSIGNMENT'), isTrue);
    expect(businessPartnerHasPermission(profile, 'PHONE_ASSIGNMENT'), isFalse);
    expect(
        businessPartnerHasPermission(profile, 'VERIFICATION_REVIEW'), isTrue);
  });

  test('denies controls when permissions are missing or malformed', () {
    expect(
        businessPartnerHasPermission(<String, dynamic>{}, 'SOLAR_ASSIGNMENT'),
        isFalse);
    expect(
        businessPartnerHasPermission(
            <String, dynamic>{'permissions': 'SOLAR_ASSIGNMENT'},
            'SOLAR_ASSIGNMENT'),
        isFalse);
  });
}

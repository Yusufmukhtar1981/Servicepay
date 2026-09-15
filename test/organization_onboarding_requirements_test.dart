import 'package:flutter_test/flutter_test.dart';
import 'package:servicepay_app/organizations/organization_onboarding_screen.dart';

void main() {
  test('sector remediation uses the single editable control exactly', () {
    expect(industrySectorPayload('Education', ['sector'], true),
        {'sector': 'Education'});
    expect(industrySectorPayload('Fintech', ['industry'], true),
        {'industry': 'Fintech'});
    expect(industrySectorPayload('Both', ['sector', 'industry'], true), {
      'sector': 'Both',
      'industry': 'Both',
    });
  });

  test('KYB document taxonomy matches the submission requirements', () {
    expect(
      requiredOrganizationDocuments('COMPANY', 'REGISTERED'),
      ['CERTIFICATE_OF_INCORPORATION'],
    );
    expect(
      requiredOrganizationDocuments('COMPANY', 'UNREGISTERED'),
      isEmpty,
    );
    for (final type in [
      'NGO',
      'COOPERATIVE',
      'ASSOCIATION',
      'FOUNDATION',
      'SCHOOL',
      'RELIGIOUS',
      'GOVERNMENT',
      'COMMUNITY',
    ]) {
      expect(
        requiredOrganizationDocuments(type, 'REGISTERED'),
        ['REGISTRATION_CERTIFICATE'],
      );
      expect(
        requiredOrganizationDocuments(type, 'UNREGISTERED'),
        ['GOVERNING_DOCUMENT'],
      );
    }
    expect(
      requiredOrganizationDocuments('CLUB', 'REGISTERED'),
      isEmpty,
    );
    expect(
      requiredOrganizationDocuments('OTHER', 'UNREGISTERED'),
      isEmpty,
    );
  });
}

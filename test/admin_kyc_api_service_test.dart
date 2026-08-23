import 'package:flutter_test/flutter_test.dart';
import 'package:servicepay_app/admin/admin_kyc_api_service.dart';

void main() {
  test('parses KYC application fields and populated user contact details', () {
    final AdminKycApplication application = AdminKycApplication.fromJson(
      <String, dynamic>{
        '_id': 'kyc-1',
        'status': 'PENDING',
        'requestedLevel': 'TIER_2',
        'firstName': 'Ada',
        'lastName': 'Okafor',
        'documents': <String, dynamic>{
          'selfieUploaded': true,
          'idDocumentUploaded': true,
          'proofOfAddressUploaded': true,
          'idDocumentNeedsSecureReupload': true,
        },
        'user': <String, dynamic>{
          'email': 'ada@example.com',
          'phone': '08000000000',
        },
      },
    );

    expect(application.id, 'kyc-1');
    expect(application.displayName, 'Ada Okafor');
    expect(application.email, 'ada@example.com');
    expect(application.selfieUploaded, isTrue);
    expect(application.idDocumentUploaded, isTrue);
    expect(application.proofOfAddressUploaded, isTrue);
    expect(application.idDocumentNeedsSecureReupload, isTrue);
    expect(application.selfieNeedsSecureReupload, isFalse);
  });

  test('reduces legacy document URLs to availability flags', () {
    final AdminKycApplication application = AdminKycApplication.fromJson(
      <String, dynamic>{
        'idDocumentUrl': 'https://documents.example/id',
      },
    );

    expect(application.idDocumentUploaded, isTrue);
    expect(application.selfieUploaded, isFalse);
  });
}

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
          'idDocumentBackUploaded': true,
          'proofOfAddressUploaded': true,
          'idDocumentNeedsSecureReupload': true,
          'documentType': 'DRIVERS_LICENSE',
        },
        'identity': <String, dynamic>{
          'ninVerified': true,
          'ninLast4': '1234',
          'bvnVerified': true,
          'bvnLast4': '5678',
          'matchStatus': 'MATCHED',
        },
        'reviewHistory': <Map<String, dynamic>>[
          <String, dynamic>{
            'action': 'SUBMITTED',
            'occurredAt': '2026-08-23T12:00:00.000Z',
          },
        ],
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
    expect(application.idDocumentBackUploaded, isTrue);
    expect(application.proofOfAddressUploaded, isTrue);
    expect(application.idDocumentNeedsSecureReupload, isTrue);
    expect(application.selfieNeedsSecureReupload, isFalse);
    expect(application.ninVerified, isTrue);
    expect(application.ninLast4, '1234');
    expect(application.bvnVerified, isTrue);
    expect(application.identityMatchStatus, 'MATCHED');
    expect(application.documentType, 'DRIVERS_LICENSE');
    expect(application.reviewHistory, hasLength(1));
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

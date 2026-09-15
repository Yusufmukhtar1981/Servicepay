import 'package:flutter_test/flutter_test.dart';
import 'package:servicepay_app/secure_registration_screen.dart';

void main() {
  test('registration payload includes the transaction PIN confirmation', () {
    final payload = buildRegistrationPayload(
      fullName: 'Ada Okafor',
      phone: '08012345678',
      email: 'ada@example.com',
      password: 'StrongPass1!',
      transactionPin: '2580',
      confirmTransactionPin: '2580',
      dateOfBirth: '1990-01-01',
      gender: 'FEMALE',
      residentialAddress: '1 Test Street',
      state: 'Lagos',
      lga: 'Ikeja',
      nin: '12345678901',
    );

    expect(payload['transactionPin'], '2580');
    expect(payload['confirmTransactionPin'], '2580');
  });

  test('registration payload includes only a non-empty validated code', () {
    Map<String, dynamic> payloadFor(String code) {
      return buildRegistrationPayload(
        fullName: 'Ada Okafor',
        phone: '08012345678',
        email: 'ada@example.com',
        password: 'StrongPass1!',
        transactionPin: '2580',
        confirmTransactionPin: '2580',
        dateOfBirth: '1990-01-01',
        gender: 'FEMALE',
        residentialAddress: '1 Test Street',
        state: 'Lagos',
        lga: 'Ikeja',
        nin: '12345678901',
        referralCode: code,
      );
    }

    final applied = payloadFor('SP-AB12');
    final omitted = payloadFor('');

    expect(applied['referralCode'], 'SP-AB12');
    expect(omitted.containsKey('referralCode'), isFalse);
  });
}

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:servicepay_app/feature_transaction_pin_dialog.dart';
import 'package:servicepay_app/services/biometric_auth_service.dart';
import 'package:servicepay_app/services/transaction_authorization_service.dart';

class _NullAuthorization extends TransactionAuthorizationService {
  @override
  Future<String?> authorizeTransaction({
    required String token,
    required String operation,
    required Map<String, dynamic> requestBody,
    required String idempotencyKey,
  }) async => null;
}

class _EnrolledDevice extends BiometricAuthService {
  @override
  Future<bool> isEnrolled() async => true;

  @override
  Future<String?> deviceId() async => 'device';
}

void main() {
  testWidgets('null biometric grant falls back to the transaction PIN dialog',
      (tester) async {
    await tester.pumpWidget(const MaterialApp(home: SizedBox()));
    final result = authorizeFeatureTransaction(
      tester.element(find.byType(SizedBox)),
      token: 'token',
      operation: 'REQUEST_MONEY_PAYMENT',
      requestBody: const <String, dynamic>{'amount': 10},
      idempotencyKey: 'key',
      transactionBiometricsEnabled: true,
      authorizationService: _NullAuthorization(),
      biometricService: _EnrolledDevice(),
    );
    await tester.pump();
    await tester.tap(find.text('Confirm with Fingerprint'));
    await tester.pumpAndSettle();
    expect(find.text('Transaction PIN'), findsOneWidget);
    await tester.enterText(find.byType(TextField), '1234');
    await tester.tap(find.text('Continue'));
    await tester.pumpAndSettle();
    expect(await result, {'transactionPin': '1234'});
  });
}
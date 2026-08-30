import 'package:flutter_test/flutter_test.dart';
import 'package:servicepay_app/transfer_screen.dart';

void main() {
  test('retains the transfer key for every ambiguous retry outcome', () {
    expect(
      retainServicePayTransferRequestKey(
        statusCode: 429,
        responseCode: 'TRANSACTION_PIN_RETRY_REQUIRED',
      ),
      isTrue,
    );
    expect(
      retainServicePayTransferRequestKey(
        statusCode: 503,
        responseCode: 'TRANSFER_TEMPORARILY_UNAVAILABLE',
      ),
      isTrue,
    );
    expect(
      retainServicePayTransferRequestKey(
        statusCode: 503,
        responseCode: 'TRANSFER_RESULT_UNCONFIRMED',
      ),
      isTrue,
    );
    expect(
      retainServicePayTransferRequestKey(
        statusCode: 400,
        responseCode: 'INVALID_TRANSACTION_PIN',
      ),
      isFalse,
    );
  });
}

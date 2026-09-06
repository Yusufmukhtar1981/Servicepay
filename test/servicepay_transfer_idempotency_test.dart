import 'package:flutter_test/flutter_test.dart';
import 'package:servicepay_app/transfer_screen.dart';
import 'package:servicepay_app/servicepay_transfer_helper.dart';

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

  test('recognizes 202 and uncertain backend codes before success false', () {
    for (final response in <({int status, Map<String, dynamic> body})>[
      (status: 202, body: {'success': false, 'data': {'status': 'FAILED'}}),
      (status: 503, body: {'success': false, 'code': 'TRANSFER_RESULT_UNCONFIRMED'}),
      (status: 503, body: {'success': false, 'code': 'TRANSFER_TEMPORARILY_UNAVAILABLE'}),
      (status: 200, body: {'success': false, 'code': 'TRANSFER_PENDING'}),
      (status: 404, body: {'success': false, 'message': 'Reference not found'}),
    ]) {
      expect(
        parseServicePayTransferResponse(
          statusCode: response.status,
          root: response.body,
        ).state,
        ServicePayTransferState.pending,
      );
    }
  });
}

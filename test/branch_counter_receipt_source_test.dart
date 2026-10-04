import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  test('branch web receipt uses an isolated Blob popup lifecycle', () {
    final String web = File(
            'lib/branch_manager/counter_receipt_web.dart')
        .readAsStringSync();
    final String detail = File(
            'lib/branch_manager/branch_counter_detail.dart')
        .readAsStringSync();
    expect(web, contains("window.open('about:blank', '_blank')"));
    expect(web, contains('popup.opener = null'));
    expect(web, contains('createObjectUrlFromBlob'));
    expect(web, contains('revokeObjectUrl(url)'));
    expect(web, isNot(contains('Uri.dataFromString')));
    expect(detail.indexOf('reserveCounterReceiptPopup()'),
        lessThan(detail.indexOf('_printReceipt(')));
  });
}
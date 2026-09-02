import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:servicepay_app/admin/admin_control_center_download_common.dart';

void main() {
  test('encodes CSV customer names as UTF-8 without corruption', () {
    const String csv = 'customer\nChinwụkwọ Ọlúfẹ́mi\n';

    final bytes = controlCenterCsvUtf8Bytes(csv);

    expect(bytes, utf8.encode(csv));
    expect(utf8.decode(bytes), csv);
  });

  test('uses a portable download filename without changing CSV content', () {
    expect(controlCenterSafeDownloadFilename('customers / march?.csv'),
        'customers___march_.csv');
    expect(controlCenterSafeDownloadFilename('   '), 'export.csv');
    expect(controlCenterDownloadRevokeDelay, greaterThan(Duration.zero));
  });
}

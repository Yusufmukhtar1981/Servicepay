// This test deliberately executes the browser-only Blob URL API.
// ignore_for_file: avoid_web_libraries_in_flutter, deprecated_member_use

@TestOn('browser')
library;

import 'dart:html' as html;

import 'package:flutter_test/flutter_test.dart';
import 'package:servicepay_app/branch_manager/counter_receipt_web.dart';

void main() {
  test('receipt renderer creates a readable HTML Blob URL for printing',
      () async {
    final String url = createCounterReceiptBlobUrl(
        '<!doctype html><html><body><main>Receipt #204</main></body></html>');
    expect(url, startsWith('blob:'));
    addTearDown(() => html.Url.revokeObjectUrl(url));

    final String fetched = await html.HttpRequest.getString(url);
    expect(fetched, contains('<main>Receipt #204</main>'));
    expect(fetched, contains('window.print()'));
  });
}
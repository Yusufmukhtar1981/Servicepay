// ignore_for_file: deprecated_member_use, avoid_web_libraries_in_flutter

import 'dart:html' as html;

import 'admin_control_center_download_common.dart';

bool get controlCenterDownloadSupported => true;

Future<void> downloadControlCenterCsv(String csv, String filename) async {
  final html.Blob blob = html.Blob(
      <dynamic>[controlCenterCsvUtf8Bytes(csv)], 'text/csv;charset=utf-8');
  final String url = html.Url.createObjectUrlFromBlob(blob);
  html.AnchorElement(href: url)
    ..download = controlCenterSafeDownloadFilename(filename)
    ..click();
  // Revoking in the same event turn can cancel downloads in some browsers.
  await Future<void>.delayed(controlCenterDownloadRevokeDelay);
  html.Url.revokeObjectUrl(url);
}

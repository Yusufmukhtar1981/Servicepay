// ignore_for_file: avoid_web_libraries_in_flutter, deprecated_member_use

import 'dart:html' as html;

void download(String csv, String filename) {
  final html.Blob blob = html.Blob(<String>[csv], 'text/csv;charset=utf-8');
  final String url = html.Url.createObjectUrlFromBlob(blob);
  final html.AnchorElement anchor = html.AnchorElement(href: url);
  anchor.download = filename;
  anchor.click();
  html.Url.revokeObjectUrl(url);
}

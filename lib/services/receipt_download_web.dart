// ignore_for_file: avoid_web_libraries_in_flutter

import 'dart:html' as html;
import 'dart:typed_data';

Future<String> downloadReceiptBytes(
  Uint8List bytes,
  String fileName,
) {
  final blob = html.Blob(
    <dynamic>[bytes],
    'image/png',
  );

  final url = html.Url.createObjectUrlFromBlob(blob);

  final anchor = html.AnchorElement(
    href: url,
  )
    ..setAttribute(
      'download',
      fileName,
    )
    ..style.display = 'none';

  html.document.body?.children.add(anchor);

  anchor.click();
  anchor.remove();

  html.Url.revokeObjectUrl(url);
  return Future<String>.value('Receipt downloaded successfully.');
}
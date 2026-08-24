import 'dart:typed_data';

Future<String> downloadReceiptBytes(
  Uint8List bytes,
  String fileName,
) {
  throw UnsupportedError(
    'Receipt downloads are not supported on this platform.',
  );
}
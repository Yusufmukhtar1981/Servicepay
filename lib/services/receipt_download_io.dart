import 'dart:io';
import 'dart:typed_data';

import 'package:path_provider/path_provider.dart';

Future<String> downloadReceiptBytes(Uint8List bytes, String fileName,
    {String mimeType = 'image/png'}) async {
  final directory = await getApplicationDocumentsDirectory();
  final safeName = fileName.replaceAll(RegExp(r'[^A-Za-z0-9._-]'), '_');
  final file = File('${directory.path}/$safeName');
  await file.writeAsBytes(bytes, flush: true);
  return mimeType == 'application/pdf'
      ? 'PDF saved to ServicePay documents.'
      : 'Receipt saved successfully.';
}

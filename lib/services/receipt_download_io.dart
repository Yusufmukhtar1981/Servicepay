import 'dart:typed_data';

import 'package:gal/gal.dart';

Future<String> downloadReceiptBytes(
  Uint8List bytes,
  String fileName,
) async {
  await Gal.putImageBytes(
    bytes,
    album: 'ServicePay',
  );
  return 'Receipt saved successfully.';
}
import 'dart:convert';
import 'dart:typed_data';

/// Browser-independent CSV download preparation.
///
/// CSV content is encoded as UTF-8 so names and other customer data are kept
/// exactly as the export service returned them.
Uint8List controlCenterCsvUtf8Bytes(String csv) =>
    Uint8List.fromList(utf8.encode(csv));

/// Keeps a browser download name portable without changing CSV contents.
String controlCenterSafeDownloadFilename(String filename) {
  final String safe =
      filename.trim().replaceAll(RegExp(r'[^A-Za-z0-9._-]'), '_');
  return safe.isEmpty ? 'export.csv' : safe;
}

const Duration controlCenterDownloadRevokeDelay = Duration(seconds: 1);

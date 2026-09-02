bool get controlCenterDownloadSupported => false;

Future<void> downloadControlCenterCsv(String csv, String filename) async {
  throw UnsupportedError('CSV download is supported in a web browser only.');
}

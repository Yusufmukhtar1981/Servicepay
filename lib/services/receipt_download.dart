export 'receipt_download_stub.dart'
    if (dart.library.html) 'receipt_download_web.dart'
    if (dart.library.io) 'receipt_download_io.dart';

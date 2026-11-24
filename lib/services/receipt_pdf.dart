import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;

/// Embed the already-redacted, branded receipt card directly in the document.
/// This preserves the exact text/glyphs shown in-app without fetching fonts,
/// transaction details, or an image URL while exporting.
Future<Uint8List> buildReceiptPdf(Uint8List png) async {
  final codec = await ui.instantiateImageCodec(png);
  try {
    final frame = await codec.getNextFrame();
    final image = frame.image;
    final aspect = image.height / image.width;
    image.dispose();

    const margin = 18.0;
    const contentWidth = 360.0;
    final contentHeight = contentWidth * aspect;
    final document = pw.Document(
      title: 'ServicePay Transaction Receipt',
      author: 'ServicePay',
    );
    final embeddedReceipt = pw.MemoryImage(png);
    document.addPage(
      pw.Page(
        pageFormat: PdfPageFormat(
          contentWidth + margin * 2,
          contentHeight + margin * 2,
          marginAll: margin,
        ),
        build: (_) => pw.Image(
          embeddedReceipt,
          width: contentWidth,
          height: contentHeight,
          fit: pw.BoxFit.contain,
        ),
      ),
    );
    return document.save();
  } finally {
    codec.dispose();
  }
}

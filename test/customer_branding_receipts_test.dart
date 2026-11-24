import 'dart:convert';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:servicepay_app/receipt_screen.dart';
import 'package:servicepay_app/services/receipt_pdf.dart';
import 'package:servicepay_app/widgets/receipt_pdf_actions.dart';
import 'package:servicepay_app/widgets/servicepay_brand_logo.dart';
import 'package:share_plus/share_plus.dart';

void _expectEmbeddedImage(Uint8List bytes) {
  final pdf = latin1.decode(bytes);
  expect(pdf, startsWith('%PDF-'));
  expect(pdf, matches(RegExp(r'/Subtype\s*/Image')));
  expect(pdf, contains('%%EOF'));
}

void main() {
  testWidgets('history receipts retain the official logo at phone widths',
      (tester) async {
    addTearDown(() => tester.binding.setSurfaceSize(null));
    final services = [
      ('Data Purchase', 'SUCCESSFUL', 320.0),
      ('Electricity', 'SUCCESSFUL', 360.0),
      ('Cable TV', 'FAILED', 390.0),
      ('Exam PIN', 'SUCCESSFUL', 412.0),
      ('Wallet funding', 'PENDING', 430.0),
    ];
    for (final (service, status, width) in services) {
      await tester.binding.setSurfaceSize(Size(width, 720));
      await tester.pumpWidget(MaterialApp(
        theme: ThemeData.dark(),
        home: ReceiptScreen(
          serviceName: service,
          amount: '500.00',
          status: status,
          reference: 'SP-RECEIPT-TEST',
          date: '24 November 2026',
          details: const {'Description': 'Test purchase'},
        ),
      ));
      final mark = find.byType(ServicePayBrandLogo);
      await tester.runAsync(
          () => precacheImage(ServicePayBrandLogo.image, tester.element(mark)));
      await tester.pumpAndSettle();
      final logo = find.descendant(of: mark, matching: find.byType(Image));
      expect(tester.widget<Image>(logo).image, ServicePayBrandLogo.image);
      expect(
          tester
              .widget<RawImage>(find.descendant(
                of: logo,
                matching: find.byType(RawImage),
              ))
              .image,
          isNotNull);
      expect(tester.getSize(logo), const Size.square(44));
      expect(find.text('ServicePay'), findsOneWidget);
      expect(find.text(service), findsOneWidget);
      expect(find.text(status), findsWidgets);
      expect(find.byType(ReceiptPdfActions), findsOneWidget);
      expect(tester.takeException(), isNull);
    }

    // Exercise the actual branded receipt card, not a hand-built PDF fixture.
    final mark = find.byType(ServicePayBrandLogo);
    final boundary = tester
        .element(mark)
        .findAncestorRenderObjectOfType<RenderRepaintBoundary>()!;
    await tester.runAsync(() async {
      final image = await boundary.toImage(pixelRatio: 2);
      try {
        final encoded =
            (await image.toByteData(format: ui.ImageByteFormat.png))!;
        _expectEmbeddedImage(
            await buildReceiptPdf(encoded.buffer.asUint8List()));
      } finally {
        image.dispose();
      }
    });
  });

  testWidgets('download and share receive the original PDF bytes',
      (tester) async {
    late ByteData png;
    await tester.runAsync(() async {
      png = await rootBundle.load(ServicePayBrandLogo.asset);
    });
    Uint8List? downloaded;
    ShareParams? shared;
    await tester.pumpWidget(MaterialApp(
      home: Scaffold(
        body: ReceiptPdfActions(
          reference: 'SP/ref',
          capture: () async => png.buffer.asUint8List(),
          downloadBytes: (bytes, name, {mimeType = 'image/png'}) async {
            expect(name, 'servicepay-receipt-SP_ref.pdf');
            expect(mimeType, 'application/pdf');
            downloaded = bytes;
            return 'Saved PDF';
          },
          shareFile: (params) async {
            shared = params;
            return const ShareResult('shared', ShareResultStatus.success);
          },
        ),
      ),
    ));

    Future<void> tapExport(String label) async {
      // Run the export under a real event loop for image encoding/deferred load.
      final button = tester.widget<OutlinedButton>(find.ancestor(
          of: find.text(label), matching: find.bySubtype<OutlinedButton>()));
      await tester.runAsync(() async {
        button.onPressed!();
        for (var attempt = 0; attempt < 80; attempt++) {
          if (label == 'Share PDF' ? shared != null : downloaded != null) {
            return;
          }
          await Future<void>.delayed(const Duration(milliseconds: 10));
        }
      });
      await tester.pump();
    }

    await tapExport('Download PDF');
    _expectEmbeddedImage(downloaded!);
    await tapExport('Share PDF');
    expect(shared!.fileNameOverrides, ['servicepay-receipt-SP_ref.pdf']);
    final file = shared!.files!.single;
    expect(file.mimeType, 'application/pdf');
    _expectEmbeddedImage(await file.readAsBytes());
  });
}

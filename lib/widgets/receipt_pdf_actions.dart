import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:share_plus/share_plus.dart';

import '../services/receipt_download.dart';
import '../services/receipt_pdf.dart' deferred as receipt_pdf;

/// PDF is an additional format; existing PNG and copy actions are unchanged.
class ReceiptPdfActions extends StatefulWidget {
  const ReceiptPdfActions({
    super.key,
    required this.reference,
    required this.capture,
    this.disabled = false,
    this.downloadBytes = downloadReceiptBytes,
    this.shareFile,
  });

  final String reference;
  final Future<Uint8List?> Function() capture;
  final bool disabled;
  final Future<String> Function(Uint8List, String, {String mimeType})
      downloadBytes;
  final Future<ShareResult> Function(ShareParams)? shareFile;

  @override
  State<ReceiptPdfActions> createState() => _ReceiptPdfActionsState();
}

class _ReceiptPdfActionsState extends State<ReceiptPdfActions> {
  bool _working = false;

  Future<void> _export({required bool share}) async {
    if (_working || widget.disabled) return;
    setState(() => _working = true);
    try {
      final box = context.findRenderObject() as RenderBox?;
      final origin =
          box == null ? null : box.localToGlobal(Offset.zero) & box.size;
      final image = await widget.capture();
      if (image == null || image.isEmpty) {
        throw StateError('Receipt image is not ready.');
      }
      await receipt_pdf.loadLibrary();
      final bytes = await receipt_pdf.buildReceiptPdf(image);
      if (!mounted) return;
      final safeReference =
          widget.reference.replaceAll(RegExp(r'[^A-Za-z0-9_-]'), '_');
      final fileName =
          'servicepay-receipt-${safeReference.isEmpty ? 'transaction' : safeReference}.pdf';
      const mime = 'application/pdf';
      if (share) {
        final params = ShareParams(
          text: 'ServicePay Transaction Receipt',
          files: [XFile.fromData(bytes, mimeType: mime, name: fileName)],
          fileNameOverrides: [fileName],
          sharePositionOrigin: origin,
        );
        await (widget.shareFile ?? SharePlus.instance.share)(params);
      } else {
        final message =
            await widget.downloadBytes(bytes, fileName, mimeType: mime);
        if (mounted) _notice(message);
      }
    } catch (_) {
      if (mounted) {
        _notice('Unable to export this PDF receipt. Please try again.');
      }
    } finally {
      if (mounted) setState(() => _working = false);
    }
  }

  void _notice(String text) {
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(text)));
  }

  @override
  Widget build(BuildContext context) {
    final disabled = widget.disabled || _working;
    return Wrap(
      alignment: WrapAlignment.center,
      spacing: 8,
      runSpacing: 4,
      children: [
        OutlinedButton.icon(
          onPressed: disabled ? null : () => _export(share: false),
          icon: const Icon(Icons.picture_as_pdf_outlined),
          label: Text(_working ? 'Preparing PDF…' : 'Download PDF'),
        ),
        OutlinedButton.icon(
          onPressed: disabled ? null : () => _export(share: true),
          icon: const Icon(Icons.share_rounded),
          label: const Text('Share PDF'),
        ),
      ],
    );
  }
}

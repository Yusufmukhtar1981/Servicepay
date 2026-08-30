import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:share_plus/share_plus.dart';

import 'services/receipt_download.dart';

/// A receipt is rendered only from the values supplied by the completed
/// transaction flow. Do not add account credentials or authentication values
/// to [details].
class ReceiptScreen extends StatefulWidget {
  const ReceiptScreen({
    super.key,
    required this.serviceName,
    required this.amount,
    required this.status,
    required this.reference,
    required this.date,
    required this.details,
  });

  final String serviceName;
  final String amount;
  final String status;
  final String reference;
  final String date;
  final Map<String, String> details;

  @override
  State<ReceiptScreen> createState() => _ReceiptScreenState();
}

class _ReceiptScreenState extends State<ReceiptScreen> {
  static const Color primaryGreen = Color(0xFF08783E);
  static const Color softGreen = Color(0xFFEAF7F0);
  final GlobalKey _receiptKey = GlobalKey();
  bool _isDownloading = false;

  Future<Uint8List> _receiptPng() async {
    await WidgetsBinding.instance.endOfFrame;
    final RenderObject? renderObject =
        _receiptKey.currentContext?.findRenderObject();
    if (renderObject is! RenderRepaintBoundary) {
      throw StateError(
          'The receipt is not ready to download. Please try again.');
    }
    final ui.Image image = await renderObject.toImage(pixelRatio: 3);
    final ByteData? data =
        await image.toByteData(format: ui.ImageByteFormat.png);
    image.dispose();
    if (data == null) {
      throw StateError('Could not create the receipt image.');
    }
    return data.buffer.asUint8List();
  }

  Future<void> _download() async {
    if (_isDownloading) return;
    setState(() => _isDownloading = true);
    try {
      final String fileName =
          'servicepay-receipt-${_safeFilePart(widget.reference)}.png';
      final String message =
          await downloadReceiptBytes(await _receiptPng(), fileName);
      if (mounted) {
        _notice(message);
      }
    } catch (_) {
      if (mounted) {
        _notice(
            'Unable to download this receipt. Please check storage permission and try again.');
      }
    } finally {
      if (mounted) setState(() => _isDownloading = false);
    }
  }

  String _safeFilePart(String value) {
    final String sanitized = value.replaceAll(RegExp(r'[^A-Za-z0-9_-]'), '_');
    return sanitized.isEmpty ? 'transaction' : sanitized;
  }

  Future<void> _share() async {
    if (_isDownloading) return;
    setState(() => _isDownloading = true);
    try {
      final Uint8List bytes = await _receiptPng();
      await SharePlus.instance.share(
        ShareParams(
          text: _shareText,
          files: <XFile>[
            XFile.fromData(
              bytes,
              mimeType: 'image/png',
              name: 'servicepay-receipt-${_safeFilePart(widget.reference)}.png',
            ),
          ],
        ),
      );
    } catch (_) {
      if (mounted) {
        _notice('Unable to open sharing. Please try again.');
      }
    } finally {
      if (mounted) {
        setState(() => _isDownloading = false);
      }
    }
  }

  String get _shareText {
    final List<String> lines = <String>[
      'ServicePay Transaction Receipt',
      'Service: ${widget.serviceName}',
      'Amount: ₦${widget.amount}',
      'Reference: ${widget.reference}',
      'Date & Time: ${widget.date}',
      'Status: ${widget.status}',
    ];
    for (final MapEntry<String, String> entry in _safeDetails.entries) {
      lines.add('${entry.key}: ${entry.value}');
    }
    return lines.join('\n');
  }

  Map<String, String> get _safeDetails => Map<String, String>.fromEntries(
        widget.details.entries.where(
          (MapEntry<String, String> entry) => !RegExp(
                  r'(pin|token|password|secret|authorization)',
                  caseSensitive: false)
              .hasMatch(entry.key),
        ),
      );

  void _notice(String text) {
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(text)));
  }

  ReceiptStatus get _status => ReceiptStatusParser.parse(widget.status);

  @override
  Widget build(BuildContext context) {
    final ReceiptStatus status = _status;
    return Scaffold(
      backgroundColor: const Color(0xFFF5F7F6),
      appBar: AppBar(
        backgroundColor: Colors.white,
        elevation: 0,
        centerTitle: true,
        title: const Text('Transaction Receipt',
            style:
                TextStyle(color: Colors.black87, fontWeight: FontWeight.w700)),
        iconTheme: const IconThemeData(color: Colors.black87),
      ),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(16),
          child: Column(children: <Widget>[
            RepaintBoundary(key: _receiptKey, child: _receiptCard(status)),
            const SizedBox(height: 18),
            SizedBox(
              width: double.infinity,
              height: 54,
              child: ElevatedButton.icon(
                onPressed: _isDownloading ? null : _download,
                icon: _isDownloading
                    ? const SizedBox(
                        width: 18,
                        height: 18,
                        child: CircularProgressIndicator(
                            strokeWidth: 2, color: Colors.white))
                    : const Icon(Icons.download_rounded),
                label: Text(
                    _isDownloading ? 'Preparing Receipt' : 'Download Receipt',
                    style: const TextStyle(fontWeight: FontWeight.w700)),
                style: ElevatedButton.styleFrom(
                    backgroundColor: primaryGreen,
                    foregroundColor: Colors.white,
                    elevation: 0),
              ),
            ),
            const SizedBox(height: 10),
            SizedBox(
              width: double.infinity,
              height: 54,
              child: OutlinedButton.icon(
                onPressed: _share,
                icon: const Icon(Icons.share_rounded),
                label: const Text('Share Receipt',
                    style: TextStyle(fontWeight: FontWeight.w700)),
                style: OutlinedButton.styleFrom(
                    foregroundColor: primaryGreen,
                    side: const BorderSide(color: primaryGreen)),
              ),
            ),
          ]),
        ),
      ),
    );
  }

  Widget _receiptCard(ReceiptStatus status) => Container(
        width: double.infinity,
        padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 24),
        decoration: BoxDecoration(
            color: Colors.white, borderRadius: BorderRadius.circular(24)),
        child: Column(children: <Widget>[
          _logo(),
          const SizedBox(height: 22),
          CircleAvatar(
              radius: 32,
              backgroundColor: status.backgroundColor,
              child: Icon(status.icon, color: status.color, size: 42)),
          const SizedBox(height: 12),
          Text(status.label,
              textAlign: TextAlign.center,
              style: TextStyle(
                  fontSize: 18,
                  fontWeight: FontWeight.w800,
                  color: status.color)),
          const SizedBox(height: 10),
          Text(widget.serviceName,
              textAlign: TextAlign.center,
              style: const TextStyle(
                  fontSize: 15,
                  color: Colors.black54,
                  fontWeight: FontWeight.w600)),
          const SizedBox(height: 18),
          Text('₦${widget.amount}',
              style:
                  const TextStyle(fontSize: 32, fontWeight: FontWeight.w900)),
          const SizedBox(height: 24),
          const Divider(),
          ..._safeDetails.entries.map(
              (MapEntry<String, String> entry) => _row(entry.key, entry.value)),
          _row('Reference', widget.reference, copyable: true),
          _row('Date & Time', widget.date),
          _row('Status', widget.status, color: status.color),
          const Divider(height: 34),
          const Text('Thank you for using ServicePay',
              style: TextStyle(fontWeight: FontWeight.w700)),
          const SizedBox(height: 6),
          const Text('One Platform, Many Solutions.',
              style: TextStyle(color: Colors.black54, fontSize: 12)),
        ]),
      );

  Widget _logo() =>
      const Row(mainAxisAlignment: MainAxisAlignment.center, children: <Widget>[
        DecoratedBox(
            decoration: BoxDecoration(
                color: primaryGreen,
                borderRadius: BorderRadius.all(Radius.circular(14))),
            child: SizedBox(
                width: 44,
                height: 44,
                child: Center(
                    child: Text('S',
                        style: TextStyle(
                            color: Colors.white,
                            fontSize: 26,
                            fontWeight: FontWeight.w900))))),
        SizedBox(width: 10),
        Text('ServicePay',
            style: TextStyle(
                fontSize: 23,
                fontWeight: FontWeight.w900,
                color: primaryGreen)),
      ]);

  Widget _row(String title, String value,
          {bool copyable = false, Color? color}) =>
      Padding(
        padding: const EdgeInsets.symmetric(vertical: 9),
        child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Expanded(
                  flex: 4,
                  child: Text(title,
                      style: const TextStyle(
                          color: Colors.black54, fontSize: 13))),
              const SizedBox(width: 10),
              Expanded(
                  flex: 6,
                  child: Row(
                      mainAxisAlignment: MainAxisAlignment.end,
                      children: <Widget>[
                        Flexible(
                            child: Text(value,
                                textAlign: TextAlign.right,
                                style: TextStyle(
                                    color: color ?? Colors.black87,
                                    fontSize: 13,
                                    fontWeight: FontWeight.w700))),
                        if (copyable)
                          IconButton(
                              tooltip: 'Copy reference',
                              padding: const EdgeInsets.only(left: 6),
                              constraints: const BoxConstraints(),
                              icon: const Icon(Icons.copy_rounded,
                                  size: 17, color: primaryGreen),
                              onPressed: () async {
                                await Clipboard.setData(
                                    ClipboardData(text: value));
                                if (mounted) _notice('Reference copied.');
                              }),
                      ])),
            ]),
      );
}

enum ReceiptStatus {
  successful,
  pending,
  processing,
  failed,
  reversed,
  unknown
}

extension ReceiptStatusParser on ReceiptStatus {
  static ReceiptStatus parse(String value) {
    switch (value.trim().toUpperCase()) {
      case 'SUCCESS':
      case 'SUCCESSFUL':
      case 'COMPLETED':
        return ReceiptStatus.successful;
      case 'PENDING':
        return ReceiptStatus.pending;
      case 'PROCESSING':
      case 'IN_PROGRESS':
        return ReceiptStatus.processing;
      case 'FAILED':
      case 'DECLINED':
        return ReceiptStatus.failed;
      case 'REVERSED':
        return ReceiptStatus.reversed;
      default:
        return ReceiptStatus.unknown;
    }
  }

  String get label => switch (this) {
        ReceiptStatus.successful => 'Transaction Successful',
        ReceiptStatus.pending => 'Transaction Pending',
        ReceiptStatus.processing => 'Transaction Processing',
        ReceiptStatus.failed => 'Transaction Failed',
        ReceiptStatus.reversed => 'Transaction Reversed',
        ReceiptStatus.unknown => 'Transaction Status: Unavailable',
      };
  IconData get icon => switch (this) {
        ReceiptStatus.successful => Icons.check_circle_rounded,
        ReceiptStatus.pending => Icons.schedule_rounded,
        ReceiptStatus.processing => Icons.sync_rounded,
        ReceiptStatus.failed => Icons.cancel_rounded,
        ReceiptStatus.reversed => Icons.undo_rounded,
        ReceiptStatus.unknown => Icons.info_outline_rounded,
      };
  Color get color => switch (this) {
        ReceiptStatus.successful => _ReceiptScreenState.primaryGreen,
        ReceiptStatus.pending => const Color(0xFF9A6700),
        ReceiptStatus.processing => const Color(0xFF1769AA),
        ReceiptStatus.failed => const Color(0xFFBA1A1A),
        ReceiptStatus.reversed => const Color(0xFF6A4E00),
        ReceiptStatus.unknown => Colors.black54,
      };
  Color get backgroundColor => switch (this) {
        ReceiptStatus.successful => _ReceiptScreenState.softGreen,
        ReceiptStatus.pending => const Color(0xFFFFF4D6),
        ReceiptStatus.processing => const Color(0xFFE4F1FF),
        ReceiptStatus.failed => const Color(0xFFFFE9E7),
        ReceiptStatus.reversed => const Color(0xFFFFF4D6),
        ReceiptStatus.unknown => const Color(0xFFF0F0F0),
      };
}

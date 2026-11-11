import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:share_plus/share_plus.dart';

import 'services/api_service.dart';
import 'services/receipt_download.dart';

typedef AirtimeReceiptDownloader = Future<String> Function(
  Uint8List,
  String, {
  String mimeType,
});

class AirtimeReceiptScreen extends StatefulWidget {
  const AirtimeReceiptScreen({
    super.key,
    required this.identity,
    required this.transaction,
    this.loadDetails = ApiService.airtimeDetails,
    this.loadPdf = ApiService.airtimeReceiptPdf,
    this.downloadBytes,
    this.sharePdf,
  });

  final String identity;
  final Map<String, dynamic> transaction;
  final Future<Map<String, dynamic>> Function(String) loadDetails;
  final Future<Uint8List> Function(String) loadPdf;
  final AirtimeReceiptDownloader? downloadBytes;
  final Future<ShareResult> Function(ShareParams)? sharePdf;

  @override
  State<AirtimeReceiptScreen> createState() => _AirtimeReceiptScreenState();
}

class _AirtimeReceiptScreenState extends State<AirtimeReceiptScreen> {
  Map<String, dynamic>? _transaction;
  bool _loading = true;
  bool _working = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<Map<String, dynamic>> _revalidate() async {
    final response = await widget.loadDetails(widget.identity);
    final dynamic data = response['data'];
    final dynamic raw = data is Map ? data['transaction'] : null;
    if (response['success'] != true || raw is! Map) {
      throw Exception('The Airtime receipt could not be verified.');
    }
    final tx = Map<String, dynamic>.from(raw);
    final status = (tx['status'] ?? '').toString().toUpperCase();
    final refundStatus = (tx['refundStatus'] ?? '').toString().toUpperCase();
    if (!const {'SUCCESS', 'SUCCESSFUL', 'COMPLETED'}.contains(status) ||
        tx['refundRecorded'] == true ||
        const {'REFUNDED', 'REVERSED'}.contains(refundStatus)) {
      throw Exception(
          'This transaction is no longer eligible for a successful receipt.');
    }
    return tx;
  }

  Future<void> _download() async {
    if (_working) return;
    setState(() {
      _working = true;
      _error = null;
    });
    try {
      await _revalidate();
      final bytes = await widget.loadPdf(widget.identity);
      final message = await (widget.downloadBytes ?? downloadReceiptBytes)(
        bytes,
        'servicepay-airtime-$_safeReference.pdf',
        mimeType: 'application/pdf',
      );
      if (mounted) _notice(message);
    } catch (error) {
      if (mounted) _notice(_friendly(error));
    } finally {
      if (mounted) setState(() => _working = false);
    }
  }

  Future<void> _share() async {
    if (_working) return;
    setState(() {
      _working = true;
      _error = null;
    });
    try {
      await _revalidate();
      final bytes = await widget.loadPdf(widget.identity);
      final fileName = 'servicepay-airtime-$_safeReference.pdf';
      final params = ShareParams(
        text: 'ServicePay Airtime Purchase Receipt',
        fileNameOverrides: [fileName],
        files: [
          XFile.fromData(
            bytes,
            mimeType: 'application/pdf',
            name: fileName,
          ),
        ],
        // On web, share_plus checks Navigator.canShare and downloads the
        // actual PDF if file sharing is unsupported. AbortError is returned as
        // dismissed and does not trigger this fallback.
        downloadFallbackEnabled: true,
        mailToFallbackEnabled: false,
      );
      final share = widget.sharePdf;
      final result = share != null
          ? await share(params)
          : await SharePlus.instance.share(params);
      if (result.status == ShareResultStatus.dismissed) return;
    } catch (error) {
      if (mounted) _notice(_friendly(error));
    } finally {
      if (mounted) setState(() => _working = false);
    }
  }

  String get _safeReference => _text('reference', fallback: 'transaction')
      .replaceAll(RegExp(r'[^A-Za-z0-9_-]'), '_');

  String _text(String key, {String fallback = '—'}) {
    final value = _transaction?[key] ?? widget.transaction[key];
    if (value == null || value.toString().trim().isEmpty) return fallback;
    return value.toString();
  }

  String _formattedDate() {
    final parsed = DateTime.tryParse(_text('createdAt', fallback: ''));
    if (parsed == null) return '—';
    final value = parsed.toLocal();
    return '${value.day.toString().padLeft(2, '0')}/'
        '${value.month.toString().padLeft(2, '0')}/${value.year}';
  }

  String _formattedTime() {
    final parsed = DateTime.tryParse(_text('createdAt', fallback: ''));
    if (parsed == null) return '—';
    final value = parsed.toLocal();
    return '${value.hour.toString().padLeft(2, '0')}:'
        '${value.minute.toString().padLeft(2, '0')}';
  }

  String _friendly(Object error) =>
      error.toString().replaceFirst('Exception: ', '');

  void _notice(String text) {
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(text)));
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF2F7F4),
      appBar: AppBar(
        title: const Text('Airtime receipt'),
        backgroundColor: const Color(0xFF08783E),
        foregroundColor: Colors.white,
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
              ? _failureState()
              : SafeArea(
                  child: SingleChildScrollView(
                    padding: const EdgeInsets.all(16),
                    child: Center(
                      child: ConstrainedBox(
                        constraints: const BoxConstraints(maxWidth: 560),
                        child: Column(
                          children: [
                            _receipt(),
                            const SizedBox(height: 18),
                            SizedBox(
                              width: double.infinity,
                              height: 52,
                              child: FilledButton.icon(
                                onPressed: _working ? null : _download,
                                icon: const Icon(Icons.download_rounded),
                                label: Text(_working
                                    ? 'Preparing PDF…'
                                    : 'Download PDF'),
                                style: FilledButton.styleFrom(
                                    backgroundColor: const Color(0xFF08783E)),
                              ),
                            ),
                            const SizedBox(height: 10),
                            SizedBox(
                              width: double.infinity,
                              height: 52,
                              child: OutlinedButton.icon(
                                onPressed: _working ? null : _share,
                                icon: const Icon(Icons.share_rounded),
                                label: const Text('Share PDF'),
                                style: OutlinedButton.styleFrom(
                                  foregroundColor: const Color(0xFF08783E),
                                  side: const BorderSide(
                                      color: Color(0xFF08783E)),
                                ),
                              ),
                            ),
                            const SizedBox(height: 6),
                            TextButton(
                              onPressed: () => Navigator.of(context)
                                ..popUntil((route) => route.isFirst),
                              child: const Text('Done'),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ),
                ),
    );
  }

  Widget _failureState() => Center(
        child: Padding(
          padding: const EdgeInsets.all(28),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.info_outline_rounded,
                  size: 44, color: Color(0xFF9A6700)),
              const SizedBox(height: 14),
              const Text('Receipt unavailable',
                  style: TextStyle(fontSize: 20, fontWeight: FontWeight.w800)),
              const SizedBox(height: 8),
              Text(_error!, textAlign: TextAlign.center),
              const SizedBox(height: 16),
              OutlinedButton(
                  onPressed: _load, child: const Text('Check again')),
            ],
          ),
        ),
      );

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final tx = await _revalidate();
      if (mounted) setState(() => _transaction = tx);
    } catch (error) {
      if (mounted) setState(() => _error = _friendly(error));
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Widget _receipt() => Container(
        width: double.infinity,
        padding: const EdgeInsets.all(22),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(22),
          border: Border.all(color: const Color(0xFFDCEAE1)),
        ),
        child: Column(
          children: [
            Image.asset('assets/image/servicepay_logo.png',
                width: 54, height: 54, semanticLabel: 'ServicePay logo'),
            const SizedBox(height: 10),
            const Text('SERVICEPAY',
                style: TextStyle(
                    color: Color(0xFF08783E),
                    fontSize: 19,
                    fontWeight: FontWeight.w900,
                    letterSpacing: 1.2)),
            const SizedBox(height: 18),
            const Text('AIRTIME PURCHASE RECEIPT',
                textAlign: TextAlign.center,
                style: TextStyle(
                    color: Color(0xFF173B2B),
                    fontSize: 16,
                    fontWeight: FontWeight.w800)),
            const SizedBox(height: 14),
            const Row(mainAxisAlignment: MainAxisAlignment.center, children: [
              Icon(Icons.check_circle_rounded,
                  color: Color(0xFF137A50), size: 19),
              SizedBox(width: 7),
              Text('SUCCESSFUL',
                  style: TextStyle(
                      color: Color(0xFF137A50),
                      fontWeight: FontWeight.w800,
                      letterSpacing: 1)),
            ]),
            const SizedBox(height: 12),
            Text('₦${_text('amount')}',
                style:
                    const TextStyle(fontSize: 30, fontWeight: FontWeight.w900)),
            const Divider(height: 30),
            _row('Customer name', _text('customerName')),
            _row('Customer ID', _text('customerId')),
            _row('Network provider', _text('network')),
            _row('Recipient', _text('phone')),
            _row('Date', _formattedDate()),
            _row('Time', _formattedTime()),
            _row('Payment method', _text('paymentMethod', fallback: 'Wallet')),
            _row('Description',
                _text('description', fallback: 'Airtime purchase')),
            _row('Reference', _text('reference')),
            const Divider(height: 30),
            const Text('ServicePay — One Platform, Many Solutions.',
                textAlign: TextAlign.center,
                style: TextStyle(
                    color: Color(0xFF66766D),
                    fontSize: 12,
                    fontWeight: FontWeight.w600)),
          ],
        ),
      );

  Widget _row(String label, String value) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 9),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
                flex: 4,
                child: Text(label,
                    style: const TextStyle(color: Color(0xFF687970)))),
            const SizedBox(width: 12),
            Expanded(
                flex: 6,
                child: Text(value,
                    textAlign: TextAlign.right,
                    style: const TextStyle(
                        color: Color(0xFF203B2D),
                        fontWeight: FontWeight.w700))),
          ],
        ),
      );
}

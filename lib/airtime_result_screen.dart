import 'dart:async';

import 'package:flutter/material.dart';

import 'airtime_receipt_screen.dart';
import 'services/api_service.dart';
import 'widgets/purchase_processing.dart' show PurchasePhase, purchaseOutcome;

typedef AirtimeDetailsLoader = Future<Map<String, dynamic>> Function(String);
typedef AirtimeRequery = Future<Map<String, dynamic>> Function(String);

/// Customer-facing, read-only status for one already-dispatched Airtime request.
/// This screen never calls the purchase endpoint.
class AirtimeResultScreen extends StatefulWidget {
  const AirtimeResultScreen({
    super.key,
    required this.identity,
    required this.initialResult,
    required this.phone,
    required this.network,
    required this.amount,
    this.idempotencyKey,
    this.loadDetails = ApiService.airtimeDetails,
    this.requery,
    this.onTerminal,
  });

  final String identity;
  final Map<String, dynamic> initialResult;
  final String phone;
  final String network;
  final String amount;
  final String? idempotencyKey;
  final AirtimeDetailsLoader loadDetails;
  final AirtimeRequery? requery;
  final Future<void> Function()? onTerminal;

  @override
  State<AirtimeResultScreen> createState() => _AirtimeResultScreenState();
}

class _AirtimeResultScreenState extends State<AirtimeResultScreen>
    with WidgetsBindingObserver {
  static const Duration _pollInterval = Duration(seconds: 12);
  static const Duration _pollWindow = Duration(minutes: 2);
  Timer? _pollTimer;
  final Stopwatch _pollClock = Stopwatch();
  Map<String, dynamic>? _transaction;
  String _status = 'PENDING';
  String? _readError;
  bool _checking = false;
  bool _manualChecking = false;
  bool _terminalCallbackSent = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _status = _safeInitialStatus(widget.initialResult);
    _transaction = _purchaseDetails(widget.initialResult);
    _beginPolling();
    unawaited(_refreshDetails());
  }

  static String _safeInitialStatus(Map<String, dynamic> result) {
    final status = (result['status'] ?? '').toString().toUpperCase();
    final purchasePhase = purchaseOutcome(result);
    if (purchasePhase == PurchasePhase.success) return 'SUCCESSFUL';
    if (purchasePhase == PurchasePhase.failed) return 'FAILED';
    if (result['pending'] == true ||
        const {'UNKNOWN', 'TIMEOUT', 'PROCESSING', 'PENDING'}
            .contains(status)) {
      return 'PENDING';
    }
    // Never infer a failure from an ambiguous/transport response.
    return 'PENDING';
  }

  static Map<String, dynamic>? _purchaseDetails(Map<String, dynamic> result) {
    final dynamic purchase = result['purchase'];
    if (purchase is Map) {
      return Map<String, dynamic>.from(purchase);
    }
    return null;
  }

  static Map<String, dynamic>? _transactionFrom(Map<String, dynamic> response) {
    final dynamic data = response['data'];
    final dynamic raw = data is Map ? data['transaction'] : null;
    if (raw is Map) return Map<String, dynamic>.from(raw);
    final dynamic rawTransaction = response['transaction'];
    return rawTransaction is Map
        ? Map<String, dynamic>.from(rawTransaction)
        : null;
  }

  static String _knownStatus(Map<String, dynamic> transaction) {
    final status = (transaction['status'] ?? '').toString().toUpperCase();
    if (const {'SUCCESS', 'SUCCESSFUL', 'COMPLETED'}.contains(status)) {
      if (transaction['refundRecorded'] == true ||
          const {'REFUNDED', 'REVERSED'}.contains(
              (transaction['refundStatus'] ?? '').toString().toUpperCase())) {
        return 'REVERSED';
      }
      return 'SUCCESSFUL';
    }
    if (const {'FAILED', 'REFUNDED', 'REVERSED'}.contains(status)) {
      return status;
    }
    return 'PENDING';
  }

  bool get _isTerminal => const {
        'SUCCESSFUL',
        'FAILED',
        'REFUNDED',
        'REVERSED',
      }.contains(_status);

  bool get _canPoll =>
      mounted &&
      !_isTerminal &&
      _pollClock.elapsed < _pollWindow &&
      WidgetsBinding.instance.lifecycleState == AppLifecycleState.resumed &&
      (ModalRoute.of(context)?.isCurrent ?? true);

  void _beginPolling() {
    _pollClock
      ..reset()
      ..start();
    _pollTimer?.cancel();
    _pollTimer = Timer.periodic(_pollInterval, (_) {
      if (_canPoll && !_checking) unawaited(_refreshDetails());
      if (_pollClock.elapsed >= _pollWindow || _isTerminal) {
        _pollTimer?.cancel();
      }
    });
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      if (_canPoll && !_checking) unawaited(_refreshDetails());
    }
  }

  Future<void> _refreshDetails({bool manual = false}) async {
    if (_checking || widget.identity.trim().isEmpty) return;
    setState(() {
      _checking = true;
      _manualChecking = manual;
      _readError = null;
    });
    try {
      final response = await widget.loadDetails(widget.identity);
      if (!mounted) return;
      final transaction = _transactionFrom(response);
      if (response['success'] != true || transaction == null) {
        throw Exception('Transaction details are not available yet.');
      }
      final status = _knownStatus(transaction);
      setState(() {
        _transaction = transaction;
        _status = status;
      });
      if (_isTerminal) {
        _pollTimer?.cancel();
        if (!_terminalCallbackSent) {
          _terminalCallbackSent = true;
          await widget.onTerminal?.call();
        }
      }
    } catch (_) {
      if (mounted) {
        // A 404 or network error is deliberately still an unknown/pending
        // outcome: it cannot prove that the purchase was not accepted.
        setState(() => _readError =
            'We could not confirm the result yet. Your request remains saved.');
      }
    } finally {
      if (mounted) {
        setState(() {
          _checking = false;
          _manualChecking = false;
        });
      }
    }
  }

  Future<void> _checkStatus() async {
    if (_checking) return;
    setState(() {
      _checking = true;
      _manualChecking = true;
      _readError = null;
    });
    try {
      // Requery is an explicit user action and the existing backend endpoint
      // applies its own safety rules. It is never used for automatic polling.
      final requery = widget.requery;
      final checkIdentity = widget.idempotencyKey?.isNotEmpty == true
          ? widget.idempotencyKey!
          : widget.identity;
      if (requery != null && checkIdentity.isNotEmpty) {
        await requery(checkIdentity);
      }
      if (mounted) setState(() => _checking = false);
      await _refreshDetails();
    } catch (_) {
      if (mounted) {
        setState(() => _readError =
            'Status could not be confirmed. Your request key is retained.');
      }
    } finally {
      if (mounted) {
        setState(() {
          _checking = false;
          _manualChecking = false;
        });
      }
    }
  }

  Future<void> _openReceipt() async {
    final transaction = _transaction;
    if (_status != 'SUCCESSFUL' || transaction == null) return;
    await Navigator.of(context).push<void>(
      MaterialPageRoute<void>(
        builder: (_) => AirtimeReceiptScreen(
          identity: widget.identity,
          transaction: transaction,
        ),
      ),
    );
  }

  @override
  void dispose() {
    _pollTimer?.cancel();
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  Color get _statusColor => switch (_status) {
        'SUCCESSFUL' => const Color(0xFF137A50),
        'FAILED' || 'REFUNDED' || 'REVERSED' => const Color(0xFFB42318),
        _ => const Color(0xFF9A6700),
      };

  IconData get _statusIcon => switch (_status) {
        'SUCCESSFUL' => Icons.check_circle_rounded,
        'FAILED' || 'REFUNDED' || 'REVERSED' => Icons.cancel_rounded,
        _ => Icons.schedule_rounded,
      };

  String get _title => switch (_status) {
        'SUCCESSFUL' => 'Airtime Purchase Successful',
        'FAILED' || 'REFUNDED' || 'REVERSED' => 'Airtime Purchase Failed',
        _ => 'Transaction Pending',
      };

  String get _message => switch (_status) {
        'SUCCESSFUL' => 'Airtime delivery was confirmed by ServicePay.',
        'FAILED' =>
          _transaction?['failureReason']?.toString().trim().isNotEmpty == true
              ? _transaction!['failureReason'].toString()
              : _transaction?['message']?.toString().trim().isNotEmpty == true
                  ? _transaction!['message'].toString()
                  : 'The transaction was confirmed as unsuccessful.',
        'REFUNDED' || 'REVERSED' => _transaction?['message']
                    ?.toString()
                    .trim()
                    .isNotEmpty ==
                true
            ? _transaction!['message'].toString()
            : 'This transaction was reversed. It is not eligible for a receipt.',
        _ =>
          'We are still verifying this request. Do not buy again while its status is unknown.',
      };

  String _value(String key, {String fallback = '—'}) {
    final dynamic value = _transaction?[key];
    if (value == null || value.toString().trim().isEmpty) return fallback;
    return value.toString();
  }

  String get _dateText {
    final parsed = DateTime.tryParse(_value('createdAt', fallback: ''));
    if (parsed == null) return 'Awaiting confirmation';
    final local = parsed.toLocal();
    return '${local.day.toString().padLeft(2, '0')}/'
        '${local.month.toString().padLeft(2, '0')}/${local.year}  '
        '${local.hour.toString().padLeft(2, '0')}:'
        '${local.minute.toString().padLeft(2, '0')}';
  }

  @override
  Widget build(BuildContext context) {
    final transaction = _transaction ?? const <String, dynamic>{};
    final network = (transaction['network'] ?? widget.network).toString();
    final phone = (transaction['phone'] ?? widget.phone).toString();
    final amount = (transaction['amount'] ?? widget.amount).toString();
    final reference =
        (transaction['reference'] ?? widget.initialResult['reference'] ?? '')
            .toString();
    return Scaffold(
      backgroundColor: const Color(0xFFF2F7F4),
      appBar: AppBar(
        title: const Text('Airtime status'),
        backgroundColor: const Color(0xFF08783E),
        foregroundColor: Colors.white,
        elevation: 0,
      ),
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(20),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 520),
              child: Column(
                children: [
                  Container(
                    width: double.infinity,
                    padding: const EdgeInsets.fromLTRB(24, 30, 24, 24),
                    decoration: BoxDecoration(
                      color: Colors.white,
                      borderRadius: BorderRadius.circular(24),
                      border: Border.all(color: const Color(0xFFDCEAE1)),
                    ),
                    child: Column(
                      children: [
                        CircleAvatar(
                          radius: 34,
                          backgroundColor: _statusColor.withValues(alpha: .12),
                          child:
                              Icon(_statusIcon, color: _statusColor, size: 42),
                        ),
                        const SizedBox(height: 16),
                        Text(
                          _status,
                          textAlign: TextAlign.center,
                          style: TextStyle(
                            color: _statusColor,
                            fontSize: 13,
                            letterSpacing: 1.1,
                            fontWeight: FontWeight.w800,
                          ),
                        ),
                        const SizedBox(height: 8),
                        Text(
                          _title,
                          textAlign: TextAlign.center,
                          style: const TextStyle(
                            color: Color(0xFF173B2B),
                            fontSize: 22,
                            fontWeight: FontWeight.w800,
                          ),
                        ),
                        const SizedBox(height: 10),
                        Text(_message,
                            textAlign: TextAlign.center,
                            style: const TextStyle(
                                color: Color(0xFF566A5F), height: 1.45)),
                        const SizedBox(height: 22),
                        Text('₦$amount',
                            style: const TextStyle(
                                fontSize: 30, fontWeight: FontWeight.w800)),
                        const SizedBox(height: 20),
                        const Divider(height: 1),
                        _row('Network', network),
                        _row('Recipient', phone),
                        _row(
                            'Reference',
                            reference.isEmpty
                                ? 'Checking original request'
                                : reference),
                        _row('Date & time', _dateText),
                        if (const {'FAILED', 'REFUNDED', 'REVERSED'}
                            .contains(_status)) ...[
                          _row('Charge status', _chargeStatus),
                          _row(
                              'Refund status',
                              _value('refundStatus',
                                  fallback: 'Not confirmed')),
                        ],
                      ],
                    ),
                  ),
                  if (_readError != null) ...[
                    const SizedBox(height: 14),
                    Text(_readError!,
                        textAlign: TextAlign.center,
                        style: const TextStyle(color: Color(0xFF765500))),
                  ],
                  const SizedBox(height: 18),
                  if (_status == 'SUCCESSFUL')
                    SizedBox(
                      width: double.infinity,
                      height: 52,
                      child: FilledButton.icon(
                        onPressed: _openReceipt,
                        icon: const Icon(Icons.receipt_long_rounded),
                        label: const Text('View receipt'),
                        style: FilledButton.styleFrom(
                            backgroundColor: const Color(0xFF08783E)),
                      ),
                    )
                  else if (!_isTerminal)
                    SizedBox(
                      width: double.infinity,
                      height: 52,
                      child: OutlinedButton.icon(
                        onPressed: _checking ? null : _checkStatus,
                        icon: _checking
                            ? const SizedBox(
                                width: 18,
                                height: 18,
                                child:
                                    CircularProgressIndicator(strokeWidth: 2))
                            : const Icon(Icons.refresh_rounded),
                        label: Text(_manualChecking
                            ? 'Checking status…'
                            : 'Check status'),
                        style: OutlinedButton.styleFrom(
                          foregroundColor: const Color(0xFF08783E),
                          side: const BorderSide(color: Color(0xFF08783E)),
                        ),
                      ),
                    ),
                  const SizedBox(height: 10),
                  TextButton(
                    onPressed: () => Navigator.of(context).maybePop(),
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

  String get _chargeStatus {
    final charged = _transaction?['charged'];
    if (charged == true) return 'Charged';
    if (charged == false) return 'Not charged';
    return 'Not confirmed';
  }

  Widget _row(String label, String value) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 11),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
                child: Text(label,
                    style: const TextStyle(color: Color(0xFF66766D)))),
            const SizedBox(width: 14),
            Flexible(
              child: Text(value,
                  textAlign: TextAlign.right,
                  style: const TextStyle(
                      color: Color(0xFF203B2D), fontWeight: FontWeight.w700)),
            ),
          ],
        ),
      );
}

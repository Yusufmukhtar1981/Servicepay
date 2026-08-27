import 'dart:async';
import 'dart:convert';
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:mobile_scanner/mobile_scanner.dart';
import 'package:qr_flutter/qr_flutter.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:http/http.dart' as http;

import 'services/transaction_authorization_service.dart';
import 'transaction_pin_dialog.dart';
import 'transactions_screen.dart';

class QrPayScreen extends StatefulWidget {
  const QrPayScreen({super.key});

  @override
  State<QrPayScreen> createState() => _QrPayScreenState();
}

class _QrPayScreenState extends State<QrPayScreen> {
  String userId = '';
  String userName = '';
  String userPhone = '';

  @override
  void initState() {
    super.initState();
    _loadUser();
  }

  Future<void> _loadUser() async {
    final prefs = await SharedPreferences.getInstance();

    if (!mounted) return;

    setState(() {
      userId = prefs.getString('user_id') ?? '';
      userName = prefs.getString('user_name') ?? 'ServicePay Customer';
      userPhone = prefs.getString('user_phone') ?? '';
    });
  }

  String get qrPayload {
    return jsonEncode({
      'type': 'SERVICEPAY_QR_PAY',
      'userId': userId,
      'name': userName,
      'phone': userPhone,
    });
  }

  Future<void> _openScanner() async {
    final result = await Navigator.of(context).push<Map<String, dynamic>>(
      MaterialPageRoute(
        builder: (_) => const _ServicePayQrScannerScreen(),
      ),
    );

    if (!mounted || result == null) return;

    final receiverId = (result['userId'] ?? '').toString();
    final receiverName = (result['name'] ?? '').toString();
    final receiverPhone = (result['phone'] ?? '').toString();

    if (receiverId.isNotEmpty && receiverId == userId) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('You cannot pay your own ServicePay QR.'),
        ),
      );
      return;
    }

    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => QrPaymentSheet(
        receiverId: receiverId,
        receiverName: receiverName,
        receiverPhone: receiverPhone,
        onViewTransaction: () {
          Navigator.of(context).push(
            MaterialPageRoute<void>(
              builder: (_) => const TransactionsScreen(),
            ),
          );
        },
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    const green = Color(0xFF08783E);
    const softGreen = Color(0xFFEAF7F0);

    return Scaffold(
      backgroundColor: const Color(0xFFF7F9F8),
      appBar: AppBar(
        title: const Text(
          'ServicePay QR Pay',
          style: TextStyle(
            fontWeight: FontWeight.w800,
          ),
        ),
        centerTitle: true,
        backgroundColor: Colors.white,
        foregroundColor: const Color(0xFF18211C),
        elevation: 0,
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.only(bottom: 28),
        child: Column(
          children: [
            Container(
              width: double.infinity,
              padding: const EdgeInsets.fromLTRB(22, 26, 22, 28),
              decoration: const BoxDecoration(
                gradient: LinearGradient(
                  colors: [
                    Color(0xFF08783E),
                    Color(0xFF3DA968),
                  ],
                ),
              ),
              child: const Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Icon(
                    Icons.qr_code_2_rounded,
                    color: Colors.white,
                    size: 32,
                  ),
                  SizedBox(height: 12),
                  Text(
                    'Scan. Pay. Done.',
                    style: TextStyle(
                      color: Colors.white,
                      fontSize: 22,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                  SizedBox(height: 5),
                  Text(
                    'Send and receive money instantly between ServicePay accounts.',
                    style: TextStyle(
                      color: Colors.white70,
                      fontSize: 13,
                    ),
                  ),
                ],
              ),
            ),
            Padding(
              padding: const EdgeInsets.all(18),
              child: Column(
                children: [
                  Container(
                    width: double.infinity,
                    padding: const EdgeInsets.all(22),
                    decoration: BoxDecoration(
                      color: Colors.white,
                      borderRadius: BorderRadius.circular(22),
                      border: Border.all(
                        color: const Color(0xFFE7ECE9),
                      ),
                    ),
                    child: Column(
                      children: [
                        const Text(
                          'My ServicePay QR',
                          style: TextStyle(
                            fontSize: 16,
                            fontWeight: FontWeight.w800,
                          ),
                        ),
                        const SizedBox(height: 4),
                        Text(
                          userName,
                          style: const TextStyle(
                            color: Color(0xFF66746D),
                          ),
                        ),
                        const SizedBox(height: 18),
                        Container(
                          padding: const EdgeInsets.all(14),
                          decoration: BoxDecoration(
                            color: Colors.white,
                            borderRadius: BorderRadius.circular(18),
                            border: Border.all(
                              color: const Color(0xFFE8EEE9),
                            ),
                          ),
                          child: userId.isEmpty
                              ? const SizedBox(
                                  width: 180,
                                  height: 180,
                                  child: Center(
                                    child: CircularProgressIndicator(),
                                  ),
                                )
                              : QrImageView(
                                  data: qrPayload,
                                  version: QrVersions.auto,
                                  size: 190,
                                ),
                        ),
                        const SizedBox(height: 14),
                        const Text(
                          'Let another ServicePay customer scan this QR to pay you.',
                          textAlign: TextAlign.center,
                          style: TextStyle(
                            color: Color(0xFF7A8680),
                            fontSize: 12,
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 16),
                  Material(
                    color: Colors.white,
                    borderRadius: BorderRadius.circular(20),
                    child: InkWell(
                      borderRadius: BorderRadius.circular(20),
                      onTap: _openScanner,
                      child: Container(
                        width: double.infinity,
                        padding: const EdgeInsets.all(18),
                        decoration: BoxDecoration(
                          borderRadius: BorderRadius.circular(20),
                          border: Border.all(
                            color: const Color(0xFFE7ECE9),
                          ),
                        ),
                        child: const Row(
                          children: [
                            CircleAvatar(
                              radius: 25,
                              backgroundColor: softGreen,
                              child: Icon(
                                Icons.qr_code_scanner_rounded,
                                color: green,
                                size: 27,
                              ),
                            ),
                            SizedBox(width: 14),
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(
                                    'Scan & Pay',
                                    style: TextStyle(
                                      fontSize: 17,
                                      fontWeight: FontWeight.w800,
                                    ),
                                  ),
                                  SizedBox(height: 4),
                                  Text(
                                    'Scan another ServicePay QR to send money.',
                                    style: TextStyle(
                                      color: Color(0xFF738078),
                                      fontSize: 12,
                                    ),
                                  ),
                                ],
                              ),
                            ),
                            Icon(
                              Icons.chevron_right_rounded,
                              color: Color(0xFF87928C),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(height: 14),
                  Container(
                    padding: const EdgeInsets.all(15),
                    decoration: BoxDecoration(
                      color: softGreen,
                      borderRadius: BorderRadius.circular(16),
                    ),
                    child: const Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Icon(
                          Icons.shield_outlined,
                          color: green,
                        ),
                        SizedBox(width: 10),
                        Expanded(
                          child: Text(
                            'QR Pay is for ServicePay-to-ServicePay payments only. Transaction PIN is required before money is sent.',
                            style: TextStyle(
                              color: Color(0xFF496258),
                              fontSize: 12,
                              height: 1.4,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _ServicePayQrScannerScreen extends StatefulWidget {
  const _ServicePayQrScannerScreen();

  @override
  State<_ServicePayQrScannerScreen> createState() =>
      _ServicePayQrScannerScreenState();
}

class _ServicePayQrScannerScreenState
    extends State<_ServicePayQrScannerScreen> {
  bool handled = false;

  void _handleBarcode(BarcodeCapture capture) {
    if (handled) return;

    final code = capture.barcodes.firstOrNull?.rawValue;

    if (code == null || code.trim().isEmpty) return;

    try {
      final decoded = jsonDecode(code);

      if (decoded is! Map) {
        throw Exception();
      }

      final data = Map<String, dynamic>.from(decoded);

      if (data['type'] != 'SERVICEPAY_QR_PAY') {
        throw Exception();
      }

      handled = true;

      Navigator.of(context).pop(data);
    } catch (_) {
      handled = true;

      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('This is not a valid ServicePay QR code.'),
        ),
      );

      Future<void>.delayed(
        const Duration(seconds: 2),
        () {
          if (mounted) {
            handled = false;
          }
        },
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(
        title: const Text('Scan ServicePay QR'),
        backgroundColor: Colors.black,
        foregroundColor: Colors.white,
      ),
      body: Stack(
        fit: StackFit.expand,
        children: [
          MobileScanner(
            onDetect: _handleBarcode,
          ),
          Center(
            child: Container(
              width: 260,
              height: 260,
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(24),
                border: Border.all(
                  color: Colors.white,
                  width: 3,
                ),
              ),
            ),
          ),
          const Positioned(
            left: 20,
            right: 20,
            bottom: 55,
            child: Text(
              'Point the camera at another ServicePay customer QR code.',
              textAlign: TextAlign.center,
              style: TextStyle(
                color: Colors.white,
                fontSize: 14,
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

enum QrPaymentStatus {
  idle,
  submitting,
  success,
  pending,
  failure,
  timeout,
}

class QrPaymentSheet extends StatefulWidget {
  final String receiverId;
  final String receiverName;
  final String receiverPhone;
  final http.Client? client;
  final Duration requestTimeout;
  final VoidCallback? onViewTransaction;

  const QrPaymentSheet({
    super.key,
    required this.receiverId,
    required this.receiverName,
    required this.receiverPhone,
    this.client,
    this.requestTimeout = const Duration(seconds: 30),
    this.onViewTransaction,
  });

  @override
  State<QrPaymentSheet> createState() => _QrPaymentSheetState();
}

class _QrPaymentSheetState extends State<QrPaymentSheet> {
  final TextEditingController amountController = TextEditingController();
  final TextEditingController pinController = TextEditingController();

  QrPaymentStatus status = QrPaymentStatus.idle;
  QrPaymentReceipt? receipt;
  String outcomeMessage = '';
  String? idempotencyKey;

  @override
  void dispose() {
    amountController.dispose();
    pinController.dispose();
    super.dispose();
  }

  String _newIdempotencyKey() {
    final int randomPart = math.Random.secure().nextInt(1 << 32);
    return 'QR-${DateTime.now().microsecondsSinceEpoch}-$randomPart';
  }

  Map<String, dynamic> _responseData(dynamic decoded) {
    if (decoded is! Map) {
      return <String, dynamic>{};
    }

    final Map<String, dynamic> root = Map<String, dynamic>.from(decoded);
    final dynamic nested = root['data'];

    if (nested is Map) {
      return Map<String, dynamic>.from(nested);
    }

    return root;
  }

  String _responseMessage(
    Map<String, dynamic> root,
    Map<String, dynamic> data, {
    required String fallback,
  }) {
    final dynamic value =
        root['message'] ?? root['error'] ?? data['message'] ?? data['error'];
    final String message = value?.toString().trim() ?? '';
    return message.isEmpty ? fallback : message;
  }

  String _normalizedStatus(Map<String, dynamic> data) {
    final dynamic receipt = data['receipt'];
    final dynamic receiptStatus = receipt is Map ? receipt['status'] : null;

    return (data['status'] ?? data['paymentStatus'] ?? receiptStatus ?? '')
        .toString()
        .trim()
        .toUpperCase();
  }

  Future<void> _saveReturnedBalance(
    SharedPreferences preferences,
    Map<String, dynamic> data,
  ) async {
    dynamic rawBalance = data['walletBalance'] ?? data['balance'];
    final dynamic sender = data['sender'];

    if (sender is Map) {
      rawBalance ??= sender['walletBalance'] ?? sender['balance'];
    }

    final double? balance = rawBalance is num
        ? rawBalance.toDouble()
        : double.tryParse(rawBalance?.toString() ?? '');

    if (balance != null && balance >= 0) {
      await preferences.setDouble('wallet_balance', balance);
    }
  }

  void _resetForRetry({
    required bool preserveIdempotencyKey,
  }) {
    if (!mounted) return;

    setState(() {
      status = QrPaymentStatus.idle;
      receipt = null;
      outcomeMessage = '';

      if (!preserveIdempotencyKey) {
        idempotencyKey = null;
      }
    });
  }

  Future<void> _continuePayment() async {
    if (status == QrPaymentStatus.submitting) {
      return;
    }

    final amountText = amountController.text.trim().replaceAll(',', '');

    final amount = double.tryParse(amountText);

    if (amount == null || amount <= 0) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Enter a valid amount.'),
        ),
      );
      return;
    }

    if (widget.receiverPhone.trim().isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Receiver phone number is missing.'),
        ),
      );
      return;
    }

    setState(() {
      status = QrPaymentStatus.submitting;
      receipt = null;
      outcomeMessage = '';
    });

    try {
      final String? pin = await TransactionAuthorizationService.request(
        context: context,
        pinFallback: () {
          final String typedPin = pinController.text.trim();

          if (RegExp(r'^\d{4}$').hasMatch(typedPin)) {
            return Future<String?>.value(typedPin);
          }

          return showTransactionPinDialog(context);
        },
        biometricReason: 'Confirm this QR payment',
      );

      if (pin == null) {
        if (mounted) {
          setState(() {
            status = QrPaymentStatus.idle;
          });
        }
        return;
      }

      final String requestKey = idempotencyKey ??= _newIdempotencyKey();
      final prefs = await SharedPreferences.getInstance();

      final token =
          prefs.getString('auth_token') ?? prefs.getString('token') ?? '';

      if (token.isEmpty) {
        if (!mounted) return;

        setState(() {
          status = QrPaymentStatus.failure;
          outcomeMessage = 'Your session has expired. Please login again.';
        });
        return;
      }

      final http.Client requestClient = widget.client ?? http.Client();
      late final http.Response response;

      try {
        response = await requestClient
            .post(
              Uri.parse(
                'https://api.servicepay.ng/api/transfer/servicepay',
              ),
              headers: <String, String>{
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'Authorization': 'Bearer $token',
                'Idempotency-Key': requestKey,
              },
              body: jsonEncode(
                <String, dynamic>{
                  'receiverPhone': widget.receiverPhone.trim(),
                  'amount': amount,
                  'pin': pin,
                },
              ),
            )
            .timeout(widget.requestTimeout);
      } finally {
        if (widget.client == null) {
          requestClient.close();
        }
      }

      Map<String, dynamic> root = <String, dynamic>{};

      try {
        final decoded = jsonDecode(response.body);
        if (decoded is Map<String, dynamic>) {
          root = decoded;
        } else if (decoded is Map) {
          root = Map<String, dynamic>.from(decoded);
        }
      } catch (_) {}

      final Map<String, dynamic> data = _responseData(root);
      final String normalizedStatus = _normalizedStatus(data);
      final bool isPending = response.statusCode == 202 ||
          const <String>{
            'PENDING',
            'PROCESSING',
            'IN_PROGRESS',
          }.contains(normalizedStatus);
      final bool isFailedStatus = const <String>{
        'FAILED',
        'FAIL',
        'DECLINED',
        'CANCELLED',
      }.contains(normalizedStatus);
      final bool isSuccessfulStatus = const <String>{
        'SUCCESSFUL',
        'SUCCESS',
        'COMPLETED',
        'PAID',
      }.contains(normalizedStatus);
      final bool explicitlySuccessful =
          root['success'] == true || data['success'] == true;
      final bool explicitlyFailed =
          root['success'] == false || data['success'] == false;
      final bool success = response.statusCode >= 200 &&
          response.statusCode < 300 &&
          explicitlySuccessful &&
          isSuccessfulStatus &&
          !isFailedStatus;

      if (!mounted) return;

      if (isPending) {
        setState(() {
          status = QrPaymentStatus.pending;
          outcomeMessage =
              'Your payment is still being processed. Check Transactions for the final status.';
        });
        return;
      }

      if (response.statusCode >= 200 &&
          response.statusCode < 300 &&
          !explicitlyFailed &&
          !success) {
        setState(() {
          status = QrPaymentStatus.pending;
          outcomeMessage =
              'ServicePay received the request, but the final payment status could not be confirmed. Try again safely or check Transactions.';
        });
        return;
      }

      if (!success) {
        setState(() {
          status = QrPaymentStatus.failure;
          outcomeMessage = _responseMessage(
            root,
            data,
            fallback: 'Payment failed. Please check the details and try again.',
          );
        });
        return;
      }

      final QrPaymentReceipt receiptData = QrPaymentReceipt.fromResponse(
        data,
        fallbackAmount: amount,
        fallbackRecipient: widget.receiverName,
        fallbackRecipientPhone: widget.receiverPhone,
      );

      await _saveReturnedBalance(prefs, data);

      if (!mounted) return;

      pinController.clear();

      setState(() {
        status = QrPaymentStatus.success;
        receipt = receiptData;
        outcomeMessage = '';
      });
    } on TimeoutException {
      if (!mounted) return;

      setState(() {
        status = QrPaymentStatus.timeout;
        outcomeMessage =
            'The request timed out. Your payment may still have been received. Try again safely or check Transactions before submitting a new payment.';
      });
    } catch (_) {
      if (!mounted) return;

      setState(() {
        status = QrPaymentStatus.failure;
        outcomeMessage =
            'Unable to reach ServicePay. Check your connection and try again.';
      });
    }
  }

  String _formatMoney(double amount) {
    return '₦${amount.toStringAsFixed(2)}';
  }

  String _formatDate(DateTime? date) {
    if (date == null) return 'Time unavailable';

    final DateTime local = date.toLocal();
    final String day = local.day.toString().padLeft(2, '0');
    final String month = local.month.toString().padLeft(2, '0');
    final String hour = local.hour.toString().padLeft(2, '0');
    final String minute = local.minute.toString().padLeft(2, '0');
    return '$day/$month/${local.year} • $hour:$minute';
  }

  void _closeAndViewTransaction() {
    final VoidCallback? onViewTransaction = widget.onViewTransaction;
    Navigator.of(context).pop();
    onViewTransaction?.call();
  }

  Widget _buildOutcome(BuildContext context) {
    final bool isSuccess = status == QrPaymentStatus.success;
    final bool isPending = status == QrPaymentStatus.pending;
    final bool isTimeout = status == QrPaymentStatus.timeout;
    final Color color = isSuccess
        ? const Color(0xFF08783E)
        : isPending || isTimeout
            ? const Color(0xFFB7791F)
            : const Color(0xFFB42318);
    final IconData icon = isSuccess
        ? Icons.check_circle_rounded
        : isPending || isTimeout
            ? Icons.schedule_rounded
            : Icons.error_rounded;

    if (!isSuccess) {
      return Column(
        key: const Key('qr-payment-outcome'),
        children: [
          CircleAvatar(
            radius: 30,
            backgroundColor: color.withValues(alpha: 0.12),
            child: Icon(icon, color: color, size: 34),
          ),
          const SizedBox(height: 14),
          Text(
            isPending
                ? 'PAYMENT PROCESSING'
                : isTimeout
                    ? 'PAYMENT STATUS UNKNOWN'
                    : 'PAYMENT NOT COMPLETED',
            textAlign: TextAlign.center,
            style: TextStyle(
              color: color,
              fontSize: 20,
              fontWeight: FontWeight.w900,
            ),
          ),
          const SizedBox(height: 10),
          Text(
            outcomeMessage,
            textAlign: TextAlign.center,
            style: const TextStyle(
              color: Color(0xFF5D6862),
              height: 1.45,
            ),
          ),
          const SizedBox(height: 22),
          Row(
            children: [
              Expanded(
                child: OutlinedButton(
                  key: const Key('qr-payment-done'),
                  onPressed: () => Navigator.of(context).pop(),
                  child: const Text('DONE'),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: ElevatedButton(
                  key: const Key('qr-payment-retry'),
                  onPressed: () {
                    _resetForRetry(
                      preserveIdempotencyKey: true,
                    );
                  },
                  child: const Text('TRY AGAIN'),
                ),
              ),
            ],
          ),
        ],
      );
    }

    final QrPaymentReceipt successReceipt = receipt!;

    return Column(
      key: const Key('qr-payment-success'),
      children: [
        const CircleAvatar(
          radius: 30,
          backgroundColor: Color(0xFFEAF7F0),
          child: Icon(
            Icons.check_circle_rounded,
            color: Color(0xFF08783E),
            size: 36,
          ),
        ),
        const SizedBox(height: 14),
        const Text(
          'PAYMENT SUCCESSFUL',
          textAlign: TextAlign.center,
          style: TextStyle(
            color: Color(0xFF08783E),
            fontSize: 20,
            fontWeight: FontWeight.w900,
          ),
        ),
        const SizedBox(height: 18),
        Container(
          width: double.infinity,
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: const Color(0xFFF7FBF8),
            borderRadius: BorderRadius.circular(18),
            border: Border.all(color: const Color(0xFFDCEDE2)),
          ),
          child: Column(
            children: [
              Text(
                _formatMoney(successReceipt.amount),
                style: const TextStyle(
                  color: Color(0xFF18211C),
                  fontSize: 28,
                  fontWeight: FontWeight.w900,
                ),
              ),
              const SizedBox(height: 16),
              _ReceiptDetail(
                label: 'Recipient',
                value: successReceipt.recipient,
              ),
              if (successReceipt.recipientPhone.isNotEmpty)
                _ReceiptDetail(
                  label: 'Phone',
                  value: successReceipt.recipientPhone,
                ),
              _ReceiptDetail(
                label: 'Reference',
                value: successReceipt.reference,
              ),
              _ReceiptDetail(
                label: 'Date & time',
                value: _formatDate(successReceipt.createdAt),
              ),
              if (successReceipt.balanceAfter != null)
                _ReceiptDetail(
                  label: 'New balance',
                  value: _formatMoney(successReceipt.balanceAfter!),
                ),
            ],
          ),
        ),
        const SizedBox(height: 20),
        Row(
          children: [
            Expanded(
              child: OutlinedButton(
                key: const Key('qr-payment-done'),
                onPressed: () => Navigator.of(context).pop(),
                child: const Text('DONE'),
              ),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: ElevatedButton(
                key: const Key('qr-payment-view-transaction'),
                onPressed: _closeAndViewTransaction,
                child: const Text('VIEW TRANSACTION'),
              ),
            ),
          ],
        ),
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    const Color green = Color(0xFF08783E);
    final bool isFormVisible =
        status == QrPaymentStatus.idle || status == QrPaymentStatus.submitting;

    return SafeArea(
      top: false,
      child: Padding(
        padding: EdgeInsets.only(
          bottom: MediaQuery.of(context).viewInsets.bottom,
        ),
        child: Align(
          alignment: Alignment.bottomCenter,
          child: Container(
            width: double.infinity,
            constraints: const BoxConstraints(maxWidth: 560),
            padding: const EdgeInsets.fromLTRB(20, 14, 20, 28),
            decoration: const BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.vertical(
                top: Radius.circular(28),
              ),
            ),
            child: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Container(
                    width: 44,
                    height: 5,
                    decoration: BoxDecoration(
                      color: const Color(0xFFD9DFDC),
                      borderRadius: BorderRadius.circular(20),
                    ),
                  ),
                  const SizedBox(height: 20),
                  if (isFormVisible) ...[
                    const CircleAvatar(
                      radius: 27,
                      backgroundColor: Color(0xFFEAF7F0),
                      child: Icon(
                        Icons.person_rounded,
                        color: green,
                      ),
                    ),
                    const SizedBox(height: 10),
                    Text(
                      widget.receiverName.isEmpty
                          ? 'ServicePay Customer'
                          : widget.receiverName,
                      style: const TextStyle(
                        fontSize: 18,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                    if (widget.receiverPhone.isNotEmpty) ...[
                      const SizedBox(height: 3),
                      Text(
                        widget.receiverPhone,
                        style: const TextStyle(
                          color: Color(0xFF758179),
                        ),
                      ),
                    ],
                    const SizedBox(height: 20),
                    TextField(
                      controller: amountController,
                      enabled: status != QrPaymentStatus.submitting,
                      keyboardType: const TextInputType.numberWithOptions(
                        decimal: true,
                      ),
                      decoration: InputDecoration(
                        labelText: 'Amount',
                        prefixText: '₦ ',
                        border: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(16),
                        ),
                      ),
                    ),
                    const SizedBox(height: 14),
                    TextField(
                      controller: pinController,
                      enabled: status != QrPaymentStatus.submitting,
                      keyboardType: TextInputType.number,
                      obscureText: true,
                      maxLength: 4,
                      decoration: InputDecoration(
                        labelText: 'Transaction PIN',
                        counterText: '',
                        border: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(16),
                        ),
                      ),
                    ),
                    const SizedBox(height: 18),
                    SizedBox(
                      width: double.infinity,
                      height: 54,
                      child: ElevatedButton.icon(
                        key: const Key('qr-payment-submit'),
                        onPressed: status == QrPaymentStatus.submitting
                            ? null
                            : _continuePayment,
                        icon: status == QrPaymentStatus.submitting
                            ? const SizedBox(
                                key: Key('qr-payment-processing'),
                                width: 19,
                                height: 19,
                                child: CircularProgressIndicator(
                                  color: Colors.white,
                                  strokeWidth: 2.4,
                                ),
                              )
                            : const Icon(Icons.lock_outline_rounded),
                        label: Text(
                          status == QrPaymentStatus.submitting
                              ? 'Processing Payment...'
                              : 'Continue Payment',
                          style: const TextStyle(
                            fontWeight: FontWeight.w800,
                          ),
                        ),
                        style: ElevatedButton.styleFrom(
                          disabledBackgroundColor: const Color(0xFF7AAE91),
                          disabledForegroundColor: Colors.white,
                          backgroundColor: green,
                          foregroundColor: Colors.white,
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(16),
                          ),
                        ),
                      ),
                    ),
                  ] else
                    _buildOutcome(context),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class QrPaymentReceipt {
  final double amount;
  final String recipient;
  final String recipientPhone;
  final String reference;
  final DateTime? createdAt;
  final double? balanceAfter;

  const QrPaymentReceipt({
    required this.amount,
    required this.recipient,
    required this.recipientPhone,
    required this.reference,
    required this.createdAt,
    required this.balanceAfter,
  });

  factory QrPaymentReceipt.fromResponse(
    Map<String, dynamic> data, {
    required double fallbackAmount,
    required String fallbackRecipient,
    required String fallbackRecipientPhone,
  }) {
    final dynamic rawReceipt = data['receipt'];
    final Map<String, dynamic> receipt = rawReceipt is Map
        ? Map<String, dynamic>.from(rawReceipt)
        : <String, dynamic>{};
    final dynamic rawSender = data['sender'];
    final Map<String, dynamic> sender = rawSender is Map
        ? Map<String, dynamic>.from(rawSender)
        : <String, dynamic>{};
    final dynamic rawReceiver = data['receiver'];
    final Map<String, dynamic> receiver = rawReceiver is Map
        ? Map<String, dynamic>.from(rawReceiver)
        : <String, dynamic>{};
    final dynamic rawAmount =
        receipt['amount'] ?? data['amount'] ?? fallbackAmount;
    final double amount = rawAmount is num
        ? rawAmount.toDouble()
        : double.tryParse(rawAmount.toString()) ?? fallbackAmount;
    final String recipient = (receipt['beneficiaryName'] ??
            receiver['fullName'] ??
            fallbackRecipient)
        .toString()
        .trim();
    final String recipientPhone = (receipt['beneficiaryPhone'] ??
            receiver['phone'] ??
            fallbackRecipientPhone)
        .toString()
        .trim();
    final String reference =
        (receipt['reference'] ?? data['reference'] ?? 'Unavailable').toString();
    final dynamic rawDate =
        receipt['createdAt'] ?? data['createdAt'] ?? data['updatedAt'];
    final DateTime? createdAt =
        rawDate == null ? null : DateTime.tryParse(rawDate.toString());
    final dynamic rawBalance = sender['walletBalance'] ??
        sender['balance'] ??
        data['walletBalance'] ??
        data['balance'];
    final double? balanceAfter = rawBalance is num
        ? rawBalance.toDouble()
        : double.tryParse(rawBalance?.toString() ?? '');

    return QrPaymentReceipt(
      amount: amount,
      recipient: recipient.isEmpty ? 'ServicePay customer' : recipient,
      recipientPhone: recipientPhone,
      reference: reference,
      createdAt: createdAt,
      balanceAfter: balanceAfter,
    );
  }
}

class _ReceiptDetail extends StatelessWidget {
  final String label;
  final String value;

  const _ReceiptDetail({
    required this.label,
    required this.value,
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(top: 10),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 94,
            child: Text(
              label,
              style: const TextStyle(
                color: Color(0xFF718078),
                fontSize: 12,
              ),
            ),
          ),
          Expanded(
            child: Text(
              value,
              textAlign: TextAlign.end,
              style: const TextStyle(
                color: Color(0xFF18211C),
                fontSize: 12,
                fontWeight: FontWeight.w800,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

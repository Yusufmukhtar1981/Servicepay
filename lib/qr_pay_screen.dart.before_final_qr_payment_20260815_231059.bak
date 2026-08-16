import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:mobile_scanner/mobile_scanner.dart';
import 'package:qr_flutter/qr_flutter.dart';
import 'package:shared_preferences/shared_preferences.dart';

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
      builder: (_) => _QrPaymentSheet(
        receiverId: receiverId,
        receiverName: receiverName,
        receiverPhone: receiverPhone,
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

class _QrPaymentSheet extends StatefulWidget {
  final String receiverId;
  final String receiverName;
  final String receiverPhone;

  const _QrPaymentSheet({
    required this.receiverId,
    required this.receiverName,
    required this.receiverPhone,
  });

  @override
  State<_QrPaymentSheet> createState() => _QrPaymentSheetState();
}

class _QrPaymentSheetState extends State<_QrPaymentSheet> {
  final amountController = TextEditingController();
  final pinController = TextEditingController();

  @override
  void dispose() {
    amountController.dispose();
    pinController.dispose();
    super.dispose();
  }

  void _continuePayment() {
    final amount = double.tryParse(
      amountController.text.replaceAll(',', '').trim(),
    );

    if (amount == null || amount <= 0) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Enter a valid amount.'),
        ),
      );
      return;
    }

    if (pinController.text.trim().length != 4) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Enter your 4-digit transaction PIN.'),
        ),
      );
      return;
    }

    /*
     * IMPORTANT:
     * The QR scanner and payment confirmation UI are now active.
     *
     * Connect this point to the existing ServicePay-to-ServicePay
     * transfer method/API already used by TransferScreen.
     *
     * Receiver information:
     * widget.receiverId
     * widget.receiverPhone
     *
     * Payment:
     * amount
     * pinController.text.trim()
     *
     * We deliberately do not create a second wallet-transfer API here,
     * so QR Pay uses the same secure ledger/transfer flow as the existing
     * ServicePay-to-ServicePay transfer.
     */

    Navigator.pop(context);

    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(
          'QR verified for ${widget.receiverName}. Transfer connection is ready for the existing ServicePay transfer API.',
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    const green = Color(0xFF08783E);

    return Padding(
      padding: EdgeInsets.only(
        bottom: MediaQuery.of(context).viewInsets.bottom,
      ),
      child: Container(
        padding: const EdgeInsets.fromLTRB(20, 14, 20, 28),
        decoration: const BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.vertical(
            top: Radius.circular(28),
          ),
        ),
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
                onPressed: _continuePayment,
                icon: const Icon(Icons.lock_outline_rounded),
                label: const Text(
                  'Continue Payment',
                  style: TextStyle(
                    fontWeight: FontWeight.w800,
                  ),
                ),
                style: ElevatedButton.styleFrom(
                  backgroundColor: green,
                  foregroundColor: Colors.white,
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(16),
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

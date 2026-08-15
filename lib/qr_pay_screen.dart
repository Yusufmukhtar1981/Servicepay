import 'package:flutter/material.dart';
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
  bool loading = true;

  static const Color primaryGreen = Color(0xFF08783E);
  static const Color softGreen = Color(0xFFEAF7F0);

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
      userName = prefs.getString('user_name') ?? 'ServicePay User';
      loading = false;
    });
  }

  String get qrValue => 'servicepay://pay?userId=$userId';

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF7F9FB),
      appBar: AppBar(
        title: const Text(
          'ServicePay QR Pay',
          style: TextStyle(
            fontWeight: FontWeight.w700,
          ),
        ),
        backgroundColor: Colors.white,
        foregroundColor: const Color(0xFF101828),
        elevation: 0,
      ),
      body: loading
          ? const Center(
              child: CircularProgressIndicator(
                color: primaryGreen,
              ),
            )
          : ListView(
              padding: const EdgeInsets.all(18),
              children: [
                Container(
                  padding: const EdgeInsets.all(20),
                  decoration: BoxDecoration(
                    gradient: const LinearGradient(
                      colors: [
                        Color(0xFF08783E),
                        Color(0xFF0A9A54),
                      ],
                    ),
                    borderRadius: BorderRadius.circular(24),
                  ),
                  child: const Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Icon(
                        Icons.qr_code_2_rounded,
                        size: 42,
                        color: Colors.white,
                      ),
                      SizedBox(height: 12),
                      Text(
                        'Scan. Pay. Done.',
                        style: TextStyle(
                          color: Colors.white,
                          fontWeight: FontWeight.w800,
                          fontSize: 22,
                        ),
                      ),
                      SizedBox(height: 5),
                      Text(
                        'Send and receive money instantly between ServicePay accounts.',
                        style: TextStyle(
                          color: Color(0xFFE8FFF1),
                          height: 1.4,
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 22),
                Container(
                  padding: const EdgeInsets.all(22),
                  decoration: BoxDecoration(
                    color: Colors.white,
                    borderRadius: BorderRadius.circular(24),
                    border: Border.all(
                      color: const Color(0xFFE7EAEF),
                    ),
                  ),
                  child: Column(
                    children: [
                      const Text(
                        'My ServicePay QR',
                        style: TextStyle(
                          fontWeight: FontWeight.w800,
                          fontSize: 19,
                          color: Color(0xFF101828),
                        ),
                      ),
                      const SizedBox(height: 6),
                      Text(
                        userName,
                        style: const TextStyle(
                          color: Color(0xFF667085),
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                      const SizedBox(height: 20),
                      if (userId.isNotEmpty)
                        Container(
                          padding: const EdgeInsets.all(16),
                          decoration: BoxDecoration(
                            color: Colors.white,
                            borderRadius: BorderRadius.circular(18),
                            border: Border.all(
                              color: const Color(0xFFE4E7EC),
                            ),
                          ),
                          child: QrImageView(
                            data: qrValue,
                            version: QrVersions.auto,
                            size: 220,
                          ),
                        )
                      else
                        const Padding(
                          padding: EdgeInsets.all(24),
                          child: Text(
                            'Unable to generate QR. Please log in again.',
                            textAlign: TextAlign.center,
                          ),
                        ),
                      const SizedBox(height: 15),
                      const Text(
                        'Let another ServicePay customer scan this QR to pay you.',
                        textAlign: TextAlign.center,
                        style: TextStyle(
                          color: Color(0xFF667085),
                          height: 1.4,
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 18),
                Material(
                  color: Colors.white,
                  borderRadius: BorderRadius.circular(20),
                  child: InkWell(
                    borderRadius: BorderRadius.circular(20),
                    onTap: () {
                      ScaffoldMessenger.of(context).showSnackBar(
                        const SnackBar(
                          content: Text(
                            'Scan & Pay activation is the next QR Pay step.',
                          ),
                        ),
                      );
                    },
                    child: Container(
                      padding: const EdgeInsets.all(18),
                      decoration: BoxDecoration(
                        borderRadius: BorderRadius.circular(20),
                        border: Border.all(
                          color: const Color(0xFFE7EAEF),
                        ),
                      ),
                      child: const Row(
                        children: [
                          CircleAvatar(
                            radius: 25,
                            backgroundColor: softGreen,
                            child: Icon(
                              Icons.qr_code_scanner_rounded,
                              color: primaryGreen,
                              size: 29,
                            ),
                          ),
                          SizedBox(width: 15),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  'Scan & Pay',
                                  style: TextStyle(
                                    fontWeight: FontWeight.w800,
                                    fontSize: 16,
                                  ),
                                ),
                                SizedBox(height: 3),
                                Text(
                                  'Scan another ServicePay QR to send money.',
                                  style: TextStyle(
                                    color: Color(0xFF667085),
                                  ),
                                ),
                              ],
                            ),
                          ),
                          Icon(
                            Icons.chevron_right_rounded,
                            color: Color(0xFF98A2B3),
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
                const SizedBox(height: 18),
                Container(
                  padding: const EdgeInsets.all(16),
                  decoration: BoxDecoration(
                    color: softGreen,
                    borderRadius: BorderRadius.circular(18),
                  ),
                  child: const Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Icon(
                        Icons.security_rounded,
                        color: primaryGreen,
                      ),
                      SizedBox(width: 12),
                      Expanded(
                        child: Text(
                          'QR Pay is for ServicePay-to-ServicePay payments only. '
                          'Transaction PIN will be required before money is sent.',
                          style: TextStyle(
                            color: Color(0xFF344054),
                            height: 1.45,
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
    );
  }
}

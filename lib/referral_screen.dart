import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';
import 'package:share_plus/share_plus.dart';

class ReferralScreen extends StatefulWidget {
  const ReferralScreen({super.key});

  @override
  State<ReferralScreen> createState() => _ReferralScreenState();
}

class _ReferralScreenState extends State<ReferralScreen> {
  static const String baseUrl = 'https://api.servicepay.ng/api';

  static const Color primaryGreen = Color(0xFF08783E);

  bool isLoading = true;

  String referralCode = '';
  int referredCount = 0;

  @override
  void initState() {
    super.initState();
    loadReferral();
  }

  Future<String?> getToken() async {
    final prefs = await SharedPreferences.getInstance();

    for (final key in [
      'auth_token',
      'token',
      'access_token',
      'accessToken',
      'jwt_token',
      'jwt',
    ]) {
      final value = prefs.getString(key)?.trim();

      if (value != null && value.isNotEmpty) {
        return value.replaceFirst(
          'Bearer ',
          '',
        );
      }
    }

    return null;
  }

  Future<void> loadReferral() async {
    try {
      final token = await getToken();

      final response = await http.get(
        Uri.parse(
          '$baseUrl/auth/referral',
        ),
        headers: {
          'Authorization': 'Bearer $token',
          'Accept': 'application/json',
        },
      );

      final dynamic decoded = jsonDecode(response.body);

      final data = decoded is Map
          ? Map<String, dynamic>.from(
              decoded,
            )
          : <String, dynamic>{};

      if (response.statusCode >= 200 &&
          response.statusCode < 300 &&
          data['success'] == true) {
        referralCode = data['referralCode']?.toString() ?? '';

        referredCount = int.tryParse(
              data['referredCount']?.toString() ?? '0',
            ) ??
            0;
      }
    } catch (_) {
      // UI will show retry state.
    }

    if (!mounted) return;

    setState(() {
      isLoading = false;
    });
  }

  Future<void> copyCode() async {
    if (referralCode.isEmpty) return;

    await Clipboard.setData(
      ClipboardData(
        text: referralCode,
      ),
    );

    if (!mounted) return;

    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(
        content: Text(
          'Referral code copied.',
        ),
      ),
    );
  }

  Future<void> shareCode() async {
    if (referralCode.isEmpty) return;

    await SharePlus.instance.share(
      ShareParams(
        text: 'Join me on ServicePay — One Platform, Many Solutions.\n\n'
            'Register at https://servicepay.ng and use my referral code:\n'
            '$referralCode',
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('My Referral'),
      ),
      body: isLoading
          ? const Center(
              child: CircularProgressIndicator(),
            )
          : RefreshIndicator(
              onRefresh: loadReferral,
              child: ListView(
                padding: const EdgeInsets.all(
                  20,
                ),
                children: [
                  Container(
                    padding: const EdgeInsets.all(
                      22,
                    ),
                    decoration: BoxDecoration(
                      gradient: const LinearGradient(
                        begin: Alignment.topLeft,
                        end: Alignment.bottomRight,
                        colors: [
                          Color(
                            0xFF08783E,
                          ),
                          Color(
                            0xFF16A34A,
                          ),
                        ],
                      ),
                      borderRadius: BorderRadius.circular(
                        24,
                      ),
                    ),
                    child: Column(
                      children: [
                        const Icon(
                          Icons.card_giftcard_rounded,
                          color: Colors.white,
                          size: 46,
                        ),
                        const SizedBox(
                          height: 12,
                        ),
                        const Text(
                          'Your ServicePay Referral Code',
                          textAlign: TextAlign.center,
                          style: TextStyle(
                            color: Colors.white,
                            fontSize: 16,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                        const SizedBox(
                          height: 12,
                        ),
                        SelectableText(
                          referralCode.isEmpty ? 'Unavailable' : referralCode,
                          style: const TextStyle(
                            color: Colors.white,
                            fontSize: 28,
                            letterSpacing: 1.3,
                            fontWeight: FontWeight.w900,
                          ),
                        ),
                        const SizedBox(
                          height: 8,
                        ),
                        Text(
                          '$referredCount successful referral${referredCount == 1 ? '' : 's'}',
                          style: const TextStyle(
                            color: Colors.white70,
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(
                    height: 18,
                  ),
                  Row(
                    children: [
                      Expanded(
                        child: OutlinedButton.icon(
                          onPressed: referralCode.isEmpty ? null : copyCode,
                          icon: const Icon(
                            Icons.content_copy_rounded,
                          ),
                          label: const Text(
                            'Copy Code',
                          ),
                        ),
                      ),
                      const SizedBox(
                        width: 12,
                      ),
                      Expanded(
                        child: FilledButton.icon(
                          onPressed: referralCode.isEmpty ? null : shareCode,
                          style: FilledButton.styleFrom(
                            backgroundColor: primaryGreen,
                          ),
                          icon: const Icon(
                            Icons.share_rounded,
                          ),
                          label: const Text(
                            'Share Invite',
                          ),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(
                    height: 22,
                  ),
                  const Card(
                    child: Padding(
                      padding: EdgeInsets.all(
                        18,
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'How it works',
                            style: TextStyle(
                              fontSize: 18,
                              fontWeight: FontWeight.w800,
                            ),
                          ),
                          SizedBox(
                            height: 10,
                          ),
                          Text(
                            '1. Share your unique ServicePay referral code.\n'
                            '2. Your friend enters the code while registering.\n'
                            '3. ServicePay records the referral automatically.\n'
                            '4. Referral rewards can be added when the reward programme becomes active.',
                            style: TextStyle(
                              height: 1.6,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                ],
              ),
            ),
    );
  }
}

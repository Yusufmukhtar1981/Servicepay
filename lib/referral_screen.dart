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

  List<Map<String, dynamic>> referrals = <Map<String, dynamic>>[];

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
    if (mounted) {
      setState(() {
        isLoading = true;
      });
    }

    try {
      final token = await getToken();

      if (token == null || token.isEmpty) {
        throw Exception(
          'Authentication token not found.',
        );
      }

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
        final code = data['referralCode']?.toString().trim() ?? '';

        final count = int.tryParse(
              data['referredCount']?.toString() ?? '0',
            ) ??
            0;

        final rawReferrals = data['referrals'];

        final parsedReferrals = rawReferrals is List
            ? rawReferrals
                .whereType<Map>()
                .map(
                  (item) => Map<String, dynamic>.from(
                    item,
                  ),
                )
                .toList()
            : <Map<String, dynamic>>[];

        if (!mounted) return;

        setState(() {
          referralCode = code;
          referredCount = count;
          referrals = parsedReferrals;
          isLoading = false;
        });

        return;
      }

      if (!mounted) return;

      setState(() {
        isLoading = false;
      });

      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            data['message']?.toString() ??
                'Unable to load referral information.',
          ),
        ),
      );
    } catch (error) {
      if (!mounted) return;

      setState(() {
        isLoading = false;
      });

      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text(
            'Unable to load referral information. Pull down to retry.',
          ),
        ),
      );
    }
  }

  Future<void> copyCode() async {
    if (referralCode.isEmpty) {
      return;
    }

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
    if (referralCode.isEmpty) {
      return;
    }

    await SharePlus.instance.share(
      ShareParams(
        text: 'Join me on ServicePay — One Platform, Many Solutions.\n\n'
            'Register at https://servicepay.ng and use my referral code:\n'
            '$referralCode',
      ),
    );
  }

  String joinedDate(
    dynamic rawDate,
  ) {
    final value = rawDate?.toString().trim() ?? '';

    if (value.isEmpty) {
      return 'Joined ServicePay';
    }

    try {
      final date = DateTime.parse(value).toLocal();

      final day = date.day.toString().padLeft(
            2,
            '0',
          );

      final month = date.month.toString().padLeft(
            2,
            '0',
          );

      return 'Joined $day/$month/${date.year}';
    } catch (_) {
      return 'Joined ServicePay';
    }
  }

  Widget buildReferralCard(
    Map<String, dynamic> item,
  ) {
    final name = item['fullName']?.toString().trim() ?? '';

    final displayName = name.isEmpty ? 'ServicePay User' : name;

    final initial = displayName.isNotEmpty ? displayName[0].toUpperCase() : 'S';

    final status = item['status']?.toString().trim().toUpperCase() ?? 'ACTIVE';

    return Container(
      margin: const EdgeInsets.only(
        bottom: 10,
      ),
      padding: const EdgeInsets.symmetric(
        horizontal: 14,
        vertical: 12,
      ),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(
          18,
        ),
        border: Border.all(
          color: const Color(
            0xFFF0F2F1,
          ),
        ),
      ),
      child: Row(
        children: [
          CircleAvatar(
            radius: 23,
            backgroundColor: const Color(
              0xFFEAF7F0,
            ),
            child: Text(
              initial,
              style: const TextStyle(
                color: primaryGreen,
                fontWeight: FontWeight.w900,
                fontSize: 18,
              ),
            ),
          ),
          const SizedBox(
            width: 12,
          ),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  displayName,
                  style: const TextStyle(
                    fontSize: 15,
                    fontWeight: FontWeight.w800,
                  ),
                ),
                const SizedBox(
                  height: 4,
                ),
                Text(
                  joinedDate(
                    item['joinedAt'],
                  ),
                  style: const TextStyle(
                    color: Colors.black54,
                    fontSize: 12,
                  ),
                ),
              ],
            ),
          ),
          Container(
            padding: const EdgeInsets.symmetric(
              horizontal: 9,
              vertical: 5,
            ),
            decoration: BoxDecoration(
              color: const Color(
                0xFFEAF7F0,
              ),
              borderRadius: BorderRadius.circular(
                20,
              ),
            ),
            child: Text(
              status,
              style: const TextStyle(
                color: primaryGreen,
                fontSize: 10,
                fontWeight: FontWeight.w800,
              ),
            ),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(
    BuildContext context,
  ) {
    return Scaffold(
      backgroundColor: const Color(
        0xFFF8FAF9,
      ),
      appBar: AppBar(
        backgroundColor: const Color(
          0xFFF8FAF9,
        ),
        elevation: 0,
        title: const Text(
          'My Referral',
        ),
      ),
      body: isLoading
          ? const Center(
              child: CircularProgressIndicator(),
            )
          : RefreshIndicator(
              onRefresh: loadReferral,
              child: ListView(
                physics: const AlwaysScrollableScrollPhysics(),
                padding: const EdgeInsets.fromLTRB(
                  18,
                  12,
                  18,
                  30,
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
                          size: 44,
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
                          textAlign: TextAlign.center,
                          style: const TextStyle(
                            color: Colors.white,
                            fontSize: 27,
                            letterSpacing: 1.2,
                            fontWeight: FontWeight.w900,
                          ),
                        ),
                        const SizedBox(
                          height: 9,
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
                    height: 16,
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
                        width: 10,
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
                    height: 26,
                  ),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      const Text(
                        'Your Referrals',
                        style: TextStyle(
                          fontSize: 20,
                          fontWeight: FontWeight.w900,
                        ),
                      ),
                      Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 11,
                          vertical: 5,
                        ),
                        decoration: BoxDecoration(
                          color: const Color(
                            0xFFEAF7F0,
                          ),
                          borderRadius: BorderRadius.circular(
                            20,
                          ),
                        ),
                        child: Text(
                          '$referredCount',
                          style: const TextStyle(
                            color: primaryGreen,
                            fontWeight: FontWeight.w900,
                          ),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(
                    height: 12,
                  ),
                  if (referrals.isEmpty)
                    Container(
                      padding: const EdgeInsets.all(
                        18,
                      ),
                      decoration: BoxDecoration(
                        color: Colors.white,
                        borderRadius: BorderRadius.circular(
                          18,
                        ),
                        border: Border.all(
                          color: const Color(
                            0xFFF0F2F1,
                          ),
                        ),
                      ),
                      child: const Row(
                        children: [
                          Icon(
                            Icons.group_add_outlined,
                            color: primaryGreen,
                          ),
                          SizedBox(
                            width: 12,
                          ),
                          Expanded(
                            child: Text(
                              'No referrals yet. Share your code to invite people to ServicePay.',
                            ),
                          ),
                        ],
                      ),
                    )
                  else
                    ...referrals.map(
                      buildReferralCard,
                    ),
                  const SizedBox(
                    height: 24,
                  ),
                  Container(
                    padding: const EdgeInsets.all(
                      18,
                    ),
                    decoration: BoxDecoration(
                      color: Colors.white,
                      borderRadius: BorderRadius.circular(
                        18,
                      ),
                      border: Border.all(
                        color: const Color(
                          0xFFF0F2F1,
                        ),
                      ),
                    ),
                    child: const Column(
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
                ],
              ),
            ),
    );
  }
}

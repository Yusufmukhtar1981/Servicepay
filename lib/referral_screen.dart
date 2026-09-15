import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:http/http.dart' as http;
import 'package:share_plus/share_plus.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'referral_service.dart';

class ReferralScreen extends StatefulWidget {
  const ReferralScreen({
    super.key,
    this.client,
  });

  final http.Client? client;

  @override
  State<ReferralScreen> createState() => _ReferralScreenState();
}

class _ReferralScreenState extends State<ReferralScreen> {
  static const String baseUrl = 'https://api.servicepay.ng/api';
  static const Color primaryGreen = Color(0xFF08783E);

  late final http.Client _client;
  late final bool _ownsClient;

  bool isLoading = true;
  ReferralSummary summary = const ReferralSummary(
    code: '',
    total: 0,
    qualified: 0,
    pending: 0,
    totalRewards: 0,
    rewardProgramStatus: 'NOT_CONFIGURED',
    referrals: <ReferralEntry>[],
  );

  @override
  void initState() {
    super.initState();
    _ownsClient = widget.client == null;
    _client = widget.client ?? http.Client();
    loadReferral();
  }

  @override
  void dispose() {
    if (_ownsClient) _client.close();
    super.dispose();
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
        return value.replaceFirst('Bearer ', '');
      }
    }
    return null;
  }

  Future<void> loadReferral() async {
    if (mounted) setState(() => isLoading = true);

    try {
      final token = await getToken();
      if (token == null || token.isEmpty) {
        throw Exception('Authentication token not found.');
      }

      final response = await _client.get(
        Uri.parse('$baseUrl/auth/referral'),
        headers: {
          'Authorization': 'Bearer $token',
          'Accept': 'application/json',
        },
      );
      final data = decodeReferralJson(response.body);
      final accepted = response.statusCode >= 200 &&
          response.statusCode < 300 &&
          (data['success'] == true ||
              data.containsKey('referralCode') ||
              data['data'] is Map);

      if (accepted) {
        if (!mounted) return;
        setState(() {
          summary = parseReferralResponse(data);
          isLoading = false;
        });
        return;
      }

      throw Exception(
        data['message']?.toString() ?? 'Unable to load referral information.',
      );
    } catch (_) {
      if (!mounted) return;
      setState(() => isLoading = false);
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text(
            'Unable to load referral information. Pull down to retry.',
          ),
        ),
      );
    }
  }

  String get referralLink => ReferralLinkBuilder.build(summary.code);

  Future<void> _copy(String value, String message) async {
    if (value.isEmpty) return;
    await Clipboard.setData(ClipboardData(text: value));
    if (!mounted) return;
    ScaffoldMessenger.of(context)
        .showSnackBar(SnackBar(content: Text(message)));
  }

  Future<void> copyCode() => _copy(summary.code, 'Referral code copied.');

  Future<void> copyReferralLink() =>
      _copy(referralLink, 'Referral link copied.');

  Future<void> shareReferralLink() async {
    if (summary.code.isEmpty) return;
    await SharePlus.instance.share(
      ShareParams(
        text: 'Join me on ServicePay — One Platform, Many Solutions.\n\n'
            'Register with my referral link:\n$referralLink',
      ),
    );
  }

  Widget _metric(String label, String value) {
    return Expanded(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            value,
            style: const TextStyle(
              color: primaryGreen,
              fontSize: 19,
              fontWeight: FontWeight.w900,
            ),
          ),
          const SizedBox(height: 3),
          Text(label, style: const TextStyle(fontSize: 11)),
        ],
      ),
    );
  }

  Widget _referralCard(ReferralEntry item) {
    final initial =
        item.firstName.isEmpty ? 'S' : item.firstName[0].toUpperCase();
    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: const Color(0xFFF0F2F1)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          CircleAvatar(
            radius: 22,
            backgroundColor: const Color(0xFFEAF7F0),
            child: Text(
              initial,
              style: const TextStyle(
                color: primaryGreen,
                fontWeight: FontWeight.w900,
                fontSize: 18,
              ),
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  item.firstName,
                  style: const TextStyle(fontWeight: FontWeight.w800),
                ),
                const SizedBox(height: 4),
                Text(
                  item.registrationDate,
                  style: const TextStyle(color: Colors.black54, fontSize: 12),
                ),
                const SizedBox(height: 6),
                Text(
                  'Qualification: ${item.qualificationProgress}',
                  style: const TextStyle(fontSize: 12),
                ),
                Text(
                  'Reward: ${item.rewardStatus}',
                  style: const TextStyle(fontSize: 12),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF8FAF9),
      appBar: AppBar(
        backgroundColor: const Color(0xFFF8FAF9),
        elevation: 0,
        title: const Text('My Referral'),
      ),
      body: isLoading
          ? const Center(child: CircularProgressIndicator())
          : RefreshIndicator(
              onRefresh: loadReferral,
              child: ListView(
                physics: const AlwaysScrollableScrollPhysics(),
                padding: const EdgeInsets.fromLTRB(18, 12, 18, 30),
                children: [
                  Container(
                    padding: const EdgeInsets.all(22),
                    decoration: BoxDecoration(
                      gradient: const LinearGradient(
                        begin: Alignment.topLeft,
                        end: Alignment.bottomRight,
                        colors: [Color(0xFF08783E), Color(0xFF16A34A)],
                      ),
                      borderRadius: BorderRadius.circular(24),
                    ),
                    child: Column(
                      children: [
                        const Icon(
                          Icons.card_giftcard_rounded,
                          color: Colors.white,
                          size: 44,
                        ),
                        const SizedBox(height: 12),
                        const Text(
                          'Your ServicePay Referral Code',
                          textAlign: TextAlign.center,
                          style: TextStyle(
                            color: Colors.white,
                            fontSize: 16,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                        const SizedBox(height: 12),
                        SelectableText(
                          summary.code.isEmpty ? 'Unavailable' : summary.code,
                          textAlign: TextAlign.center,
                          style: const TextStyle(
                            color: Colors.white,
                            fontSize: 27,
                            letterSpacing: 1.2,
                            fontWeight: FontWeight.w900,
                          ),
                        ),
                        const SizedBox(height: 9),
                        Text(
                          '${summary.total} referral${summary.total == 1 ? '' : 's'}',
                          style: const TextStyle(color: Colors.white70),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 14),
                  Container(
                    padding: const EdgeInsets.all(16),
                    decoration: BoxDecoration(
                      color: Colors.white,
                      borderRadius: BorderRadius.circular(18),
                    ),
                    child: Row(
                      children: [
                        _metric('Total', '${summary.total}'),
                        _metric('Qualified', '${summary.qualified}'),
                        _metric('Pending', '${summary.pending}'),
                        _metric('Rewards', '₦${summary.totalRewards}'),
                      ],
                    ),
                  ),
                  const SizedBox(height: 16),
                  OutlinedButton.icon(
                    onPressed: summary.code.isEmpty ? null : copyCode,
                    icon: const Icon(Icons.content_copy_rounded),
                    label: const Text('Copy Code'),
                  ),
                  const SizedBox(height: 8),
                  OutlinedButton.icon(
                    onPressed: summary.code.isEmpty ? null : copyReferralLink,
                    icon: const Icon(Icons.link_rounded),
                    label: const Text('Copy Referral Link'),
                  ),
                  const SizedBox(height: 8),
                  FilledButton.icon(
                    onPressed: summary.code.isEmpty ? null : shareReferralLink,
                    style:
                        FilledButton.styleFrom(backgroundColor: primaryGreen),
                    icon: const Icon(Icons.share_rounded),
                    label: const Text('Share Referral Link'),
                  ),
                  const SizedBox(height: 26),
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
                      Text(
                        '${summary.total}',
                        style: const TextStyle(
                          color: primaryGreen,
                          fontWeight: FontWeight.w900,
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 12),
                  if (summary.referrals.isEmpty)
                    Container(
                      padding: const EdgeInsets.all(18),
                      decoration: BoxDecoration(
                        color: Colors.white,
                        borderRadius: BorderRadius.circular(18),
                      ),
                      child: const Text(
                        'No referrals yet. Share your link to invite people to ServicePay.',
                      ),
                    )
                  else
                    ...summary.referrals.map(_referralCard),
                  const SizedBox(height: 24),
                  Container(
                    padding: const EdgeInsets.all(18),
                    decoration: BoxDecoration(
                      color: Colors.white,
                      borderRadius: BorderRadius.circular(18),
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
                        SizedBox(height: 10),
                        Text(
                          '1. Share your unique ServicePay referral link.\n'
                          '2. Your friend registers with the link.\n'
                          '3. ServicePay records the referral automatically.\n'
                          '4. Referrals remain pending until ServicePay activates '
                          'a configured reward programme.',
                          style: TextStyle(height: 1.6),
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

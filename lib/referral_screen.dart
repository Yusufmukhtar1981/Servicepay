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
    paid: 0,
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

  String _money(num value) {
    if (value % 1 != 0) return value.toString();
    final digits = value.toInt().abs().toString();
    final groups = <String>[];
    for (var end = digits.length; end > 0; end -= 3) {
      final start = end - 3 < 0 ? 0 : end - 3;
      groups.insert(0, digits.substring(start, end));
    }
    final formatted = groups.join(',');
    return value < 0 ? '-$formatted' : formatted;
  }

  String _statusLabel(String status) {
    switch (status.trim().toUpperCase()) {
      case 'PENDING':
        return 'Pending';
      case 'QUALIFIED':
        return 'Qualified';
      case 'PAID':
        return 'Paid';
      default:
        return status;
    }
  }

  Widget _rewardPolicy() {
    final configured = summary.rewardProgramStatus == 'CONFIGURED';
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(
          color: configured
              ? const Color(0xFFBFE8D0)
              : const Color(0xFFF0F2F1),
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(Icons.card_giftcard_rounded, color: primaryGreen),
              const SizedBox(width: 8),
              const Expanded(
                child: Text(
                  'Reward policy',
                  style: TextStyle(fontSize: 17, fontWeight: FontWeight.w800),
                ),
              ),
              Container(
                padding:
                    const EdgeInsets.symmetric(horizontal: 9, vertical: 5),
                decoration: BoxDecoration(
                  color: configured
                      ? const Color(0xFFEAF7F0)
                      : const Color(0xFFF1F3F2),
                  borderRadius: BorderRadius.circular(20),
                ),
                child: Text(
                  summary.rewardProgramStatus,
                  style: TextStyle(
                    color: configured ? primaryGreen : Colors.black54,
                    fontSize: 10,
                    fontWeight: FontWeight.w900,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          if (!configured)
            const Text(
              'Rewards remain pending until ServicePay activates a reward '
              'programme.',
              style: TextStyle(color: Colors.black54, height: 1.4),
            )
          else if (summary.rewardPolicy.categories.isEmpty)
            const Text(
              'Your referral rewards are being tracked under the active policy.',
              style: TextStyle(color: Colors.black54, height: 1.4),
            )
          else
            ...summary.rewardPolicy.categories.map(
              (rule) => Padding(
                padding: const EdgeInsets.only(top: 5),
                child: Row(
                  children: [
                    Expanded(
                      child: Text(
                        rule.category,
                        style: const TextStyle(fontWeight: FontWeight.w700),
                      ),
                    ),
                    Text(
                      '${rule.target} referrals · ₦${_money(rule.reward)}'
                      '${rule.minimumTransaction > 0 ? ' · min ₦${_money(rule.minimumTransaction)}' : ''}',
                      style: const TextStyle(color: Colors.black54),
                    ),
                  ],
                ),
              ),
            ),
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
                if (item.category.isNotEmpty) ...[
                  const SizedBox(height: 6),
                  Text(
                    'Category: ${item.category}',
                    style: const TextStyle(fontSize: 12),
                  ),
                ],
                if (item.bestProgress.isNotEmpty) ...[
                  const SizedBox(height: 2),
                  Text(
                    'Best progress: ${item.bestProgress}',
                    style: const TextStyle(fontSize: 12),
                  ),
                ],
                const SizedBox(height: 2),
                Text(
                  'Reward status: ${_statusLabel(item.rewardStatus)}',
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
                  _rewardPolicy(),
                  const SizedBox(height: 14),
                  Container(
                    padding: const EdgeInsets.all(16),
                    decoration: BoxDecoration(
                      color: Colors.white,
                      borderRadius: BorderRadius.circular(18),
                    ),
                    child: Row(
                      children: [
                        _metric('Total Referrals', '${summary.total}'),
                        _metric('Pending', '${summary.pending}'),
                        _metric('Qualified', '${summary.qualified}'),
                        _metric('Paid', '${summary.paid}'),
                      ],
                    ),
                  ),
                  const SizedBox(height: 10),
                  Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 16,
                      vertical: 13,
                    ),
                    decoration: BoxDecoration(
                      color: Colors.white,
                      borderRadius: BorderRadius.circular(18),
                    ),
                    child: Row(
                      children: [
                        const Icon(
                          Icons.payments_outlined,
                          color: primaryGreen,
                        ),
                        const SizedBox(width: 10),
                        const Expanded(
                          child: Text(
                            'Rewards Earned',
                            style: TextStyle(fontWeight: FontWeight.w700),
                          ),
                        ),
                        Text(
                          '₦${_money(summary.totalRewards)}',
                          style: const TextStyle(
                            color: primaryGreen,
                            fontSize: 18,
                            fontWeight: FontWeight.w900,
                          ),
                        ),
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

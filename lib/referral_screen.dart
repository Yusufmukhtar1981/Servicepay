import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:http/http.dart' as http;
import 'package:share_plus/share_plus.dart';
import 'services/session_store.dart';

import 'referral_service.dart';

class ReferralScreen extends StatefulWidget {
  const ReferralScreen({
    super.key,
    this.client,
    this.shareReferral,
  });

  final http.Client? client;
  final Future<void> Function(ShareParams params)? shareReferral;

  @override
  State<ReferralScreen> createState() => _ReferralScreenState();
}

class _ReferralScreenState extends State<ReferralScreen> {
  static const String baseUrl = 'https://api.servicepay.ng/api';
  static const Color primaryGreen = Color(0xFF08783E);

  late final http.Client _client;
  late final bool _ownsClient;

  bool isLoading = true;
  bool _historyLoading = false;
  String? _loadError;
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
    final saved = await SessionStore.readToken();
    final token = saved
        ?.replaceFirst(
          RegExp(r'^Bearer\s+', caseSensitive: false),
          '',
        )
        .trim();
    return token == null || token.isEmpty ? null : token;
  }

  Future<void> loadReferral({int? historyPage}) async {
    final firstLoad = summary.code.isEmpty;
    if (mounted) {
      setState(() {
        if (firstLoad) isLoading = true;
        if (!firstLoad && historyPage != null) _historyLoading = true;
      });
    }

    try {
      final token = await getToken();
      if (token == null || token.isEmpty) {
        throw Exception('Authentication token not found.');
      }

      final uri = Uri.parse('$baseUrl/auth/referral').replace(
        queryParameters: <String, String>{
          'historyPage': '${historyPage ?? summary.historyPage}',
          'historyLimit': '50',
        },
      );
      final response = await _client.get(
        uri,
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
          _historyLoading = false;
          _loadError = null;
        });
        return;
      }

      throw Exception(
        data['message']?.toString() ?? 'Unable to load referral information.',
      );
    } catch (_) {
      if (!mounted) return;
      setState(() {
        if (firstLoad) {
          isLoading = false;
          _loadError = 'Unable to load referral information.';
        }
        _historyLoading = false;
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
    final params = ShareParams(
      text: 'Join me on ServicePay — One Platform, Many Solutions.\n\n'
          'Register with my referral link:\n$referralLink',
    );
    if (widget.shareReferral != null) {
      await widget.shareReferral!(params);
    } else {
      await SharePlus.instance.share(params);
    }
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
    final programme = summary.programme;
    final configured = programme.isVersionTwo
        ? programme.enabled
        : summary.rewardProgramStatus == 'CONFIGURED';
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(
          color: configured ? const Color(0xFFBFE8D0) : const Color(0xFFF0F2F1),
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
                  'Referral rewards',
                  style: TextStyle(fontSize: 17, fontWeight: FontWeight.w800),
                ),
              ),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 5),
                decoration: BoxDecoration(
                  color: configured
                      ? const Color(0xFFEAF7F0)
                      : const Color(0xFFF1F3F2),
                  borderRadius: BorderRadius.circular(20),
                ),
                child: Text(
                  programme.isVersionTwo
                      ? (programme.enabled ? 'ACTIVE' : 'NOT ACTIVE')
                      : summary.rewardProgramStatus,
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
          if (programme.isVersionTwo && configured) ...[
            const Text(
              'After activation, earn ₦100 once when a new referral registers '
              'after verifying a phone number or email, plus ₦1 for each '
              'eligible successful paid service transaction.',
              style: TextStyle(color: Colors.black87, height: 1.45),
            ),
            const SizedBox(height: 8),
            Text(
              'Funding, transfers, rewards and refunds do not qualify. '
              'Only activity from activation onward is included.',
              style: TextStyle(color: Colors.black54, height: 1.4),
            ),
            if (programme.eligibleServices.isNotEmpty) ...[
              const SizedBox(height: 8),
              Text(
                'Eligible services: ${programme.eligibleServices.map((e) => e.replaceAll('_', ' ')).join(', ')}.',
                style: const TextStyle(color: Colors.black54, height: 1.4),
              ),
            ],
          ] else if (programme.isVersionTwo && !configured)
            const Text(
              'The referral programme is not active yet. New-policy rewards '
              'start only after activation; no earlier activity is backfilled.',
              style: TextStyle(color: Colors.black54, height: 1.4),
            )
          else if (!configured)
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
                if (summary.programme.isVersionTwo) ...[
                  const SizedBox(height: 5),
                  Text(
                    '${item.verified ? 'Verified contact' : 'Contact not verified'}'
                    ' · ${item.successfulTransactions} eligible transactions',
                    style: const TextStyle(fontSize: 12, color: Colors.black54),
                  ),
                  Text(
                    'Earned: ₦${_money(item.registrationBonusEarned + item.transactionCommissionsEarned)}',
                    style: const TextStyle(
                        fontSize: 12, fontWeight: FontWeight.w700),
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
          ? ListView(
              padding: const EdgeInsets.all(20),
              children: List<Widget>.generate(
                5,
                (index) => Container(
                  height: index == 0 ? 150 : 74,
                  margin: const EdgeInsets.only(bottom: 12),
                  decoration: BoxDecoration(
                    color: const Color(0xFFE9F0EC),
                    borderRadius: BorderRadius.circular(20),
                  ),
                ),
              ),
            )
          : _loadError != null
              ? Center(
                  child: Padding(
                    padding: const EdgeInsets.all(28),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        const Icon(Icons.cloud_off_outlined, size: 36),
                        const SizedBox(height: 12),
                        Text(_loadError!, textAlign: TextAlign.center),
                        const SizedBox(height: 12),
                        FilledButton.icon(
                          onPressed: loadReferral,
                          icon: const Icon(Icons.refresh_rounded),
                          label: const Text('Try again'),
                        ),
                      ],
                    ),
                  ),
                )
              : RefreshIndicator(
                  onRefresh: () =>
                      loadReferral(historyPage: summary.historyPage),
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
                              summary.code.isEmpty
                                  ? 'Unavailable'
                                  : summary.code,
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
                      LayoutBuilder(
                        builder: (context, constraints) => Wrap(
                          spacing: 10,
                          runSpacing: 10,
                          children: [
                            _metricCard('Total referrals', '${summary.total}',
                                constraints.maxWidth),
                            _metricCard('Pending', '${summary.pending}',
                                constraints.maxWidth),
                            _metricCard('Qualified', '${summary.qualified}',
                                constraints.maxWidth),
                            _metricCard('Paid', '${summary.paid}',
                                constraints.maxWidth),
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
                            Expanded(
                              child: Text(
                                summary.programme.isVersionTwo
                                    ? 'New-policy earnings'
                                    : 'Rewards earned',
                                style: TextStyle(fontWeight: FontWeight.w700),
                              ),
                            ),
                            Text(
                              '₦${_money(summary.programme.isVersionTwo ? summary.totalRewards : summary.totalRewards)}',
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
                        onPressed:
                            summary.code.isEmpty ? null : copyReferralLink,
                        icon: const Icon(Icons.link_rounded),
                        label: const Text('Copy Referral Link'),
                      ),
                      const SizedBox(height: 8),
                      FilledButton.icon(
                        onPressed:
                            summary.code.isEmpty ? null : shareReferralLink,
                        style: FilledButton.styleFrom(
                            backgroundColor: primaryGreen),
                        icon: const Icon(Icons.share_rounded),
                        label: const Text('Share Referral Link'),
                      ),
                      const SizedBox(height: 26),
                      if (summary.programme.isVersionTwo) ...[
                        _earningsBreakdown(),
                        const SizedBox(height: 20),
                        _activityHistory(),
                      ],
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
                              '4. After activation, verified new registrations earn '
                              '₦100 once; each eligible paid service earns ₦1.\n'
                              '5. Funding, transfers, rewards and refunds are excluded. '
                              'Historical legacy claims remain separate.',
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

  Widget _metricCard(String label, String value, double width) => SizedBox(
        width: width < 430 ? (width - 10) / 2 : 150,
        child: Container(
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(17),
            border: Border.all(color: const Color(0xFFE7ECE8)),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(value,
                  style: const TextStyle(
                      color: primaryGreen,
                      fontSize: 19,
                      fontWeight: FontWeight.w900)),
              const SizedBox(height: 3),
              Text(label, style: const TextStyle(fontSize: 11)),
            ],
          ),
        ),
      );

  Widget _earningsBreakdown() => Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
            color: Colors.white, borderRadius: BorderRadius.circular(18)),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('Earnings breakdown',
                style: TextStyle(fontWeight: FontWeight.w800, fontSize: 16)),
            const SizedBox(height: 10),
            _breakdownRow(
                'Registration bonuses', summary.registrationBonusesEarned),
            _breakdownRow('Transaction commissions',
                summary.transactionCommissionsEarned),
            _breakdownRow('Historical legacy rewards', summary.legacyRewards),
            const SizedBox(height: 6),
            const Text(
                'Legacy rewards are shown for history and are not part of new-policy earnings.',
                style: TextStyle(
                    color: Colors.black54, fontSize: 12, height: 1.4)),
          ],
        ),
      );

  Widget _breakdownRow(String label, num amount) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 4),
        child: Row(
          children: [
            Expanded(child: Text(label)),
            Text('₦${_money(amount)}',
                style: const TextStyle(fontWeight: FontWeight.w700)),
          ],
        ),
      );

  Widget _activityHistory() => Padding(
        padding: const EdgeInsets.only(bottom: 16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('Reward activity',
                style: TextStyle(fontSize: 19, fontWeight: FontWeight.w900)),
            const SizedBox(height: 10),
            if (summary.history.isEmpty)
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                    color: Colors.white,
                    borderRadius: BorderRadius.circular(16)),
                child: const Text('No referral reward activity yet.'),
              )
            else
              ...summary.history.map((event) {
                final credit = event.direction == 'CREDIT';
                final label = event.rewardType == 'REGISTRATION'
                    ? 'Verified registration'
                    : 'Eligible service transaction';
                return Container(
                  margin: const EdgeInsets.only(bottom: 8),
                  padding: const EdgeInsets.all(14),
                  decoration: BoxDecoration(
                      color: Colors.white,
                      borderRadius: BorderRadius.circular(16)),
                  child: Row(
                    children: [
                      Icon(
                          credit
                              ? Icons.call_received_rounded
                              : Icons.call_made_rounded,
                          color:
                              credit ? primaryGreen : const Color(0xFF9B4D3A),
                          semanticLabel: credit ? 'Credit' : 'Debit'),
                      const SizedBox(width: 10),
                      Expanded(
                        child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(label,
                                  style: const TextStyle(
                                      fontWeight: FontWeight.w700)),
                              Text(
                                  '${event.firstName.isEmpty ? 'Referral' : event.firstName} · ${event.date}',
                                  style: const TextStyle(
                                      color: Colors.black54, fontSize: 12)),
                            ]),
                      ),
                      Text('${credit ? '+' : '−'}₦${_money(event.amount)}',
                          style: TextStyle(
                              fontWeight: FontWeight.w800,
                              color: credit
                                  ? primaryGreen
                                  : const Color(0xFF9B4D3A))),
                    ],
                  ),
                );
              }),
            if (summary.historyPages > 1) ...[
              const SizedBox(height: 8),
              Wrap(
                alignment: WrapAlignment.spaceBetween,
                crossAxisAlignment: WrapCrossAlignment.center,
                children: [
                  Text(
                    'Page ${summary.historyPage} of ${summary.historyPages}'
                    '${summary.historyTotal > 0 ? ' · ${summary.historyTotal} entries' : ''}',
                    style: const TextStyle(color: Colors.black54, fontSize: 12),
                  ),
                  Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      TextButton.icon(
                        onPressed: _historyLoading || summary.historyPage <= 1
                            ? null
                            : () => loadReferral(
                                  historyPage: summary.historyPage - 1,
                                ),
                        icon: const Icon(Icons.chevron_left_rounded),
                        label: const Text('Previous'),
                      ),
                      TextButton.icon(
                        onPressed: _historyLoading ||
                                summary.historyPage >= summary.historyPages
                            ? null
                            : () => loadReferral(
                                  historyPage: summary.historyPage + 1,
                                ),
                        icon: const Icon(Icons.chevron_right_rounded),
                        label: const Text('Next'),
                      ),
                    ],
                  ),
                ],
              ),
              if (_historyLoading) const LinearProgressIndicator(minHeight: 2),
            ],
            const Text(
                'Activity shows first names only. Contact details are private.',
                style: TextStyle(color: Colors.black54, fontSize: 12)),
          ],
        ),
      );
}

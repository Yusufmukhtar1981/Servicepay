import 'package:flutter/material.dart';

import 'services/customer_leaderboard_api.dart';

String formatLeaderboardNaira(num amount) {
  final parts = amount.toStringAsFixed(2).split('.');
  final whole = parts[0].replaceAllMapped(
      RegExp(r'(\d)(?=(\d{3})+(?!\d))'), (match) => '${match[1]},');
  return '₦$whole${amount == amount.truncate() ? '' : '.${parts[1]}'}';
}

/// The same report surface is used in the dashboard and on the full report page.
/// Dashboard mode bounds the ranking viewport so the surrounding dashboard
/// remains a single, predictable scroll surface while all ten rows stay reachable.
class CustomerLeaderboardReportPanel extends StatefulWidget {
  const CustomerLeaderboardReportPanel({
    super.key,
    required this.report,
    this.compact = false,
    this.showPersonal = true,
    this.showRules = true,
    this.showFreshness = true,
  });

  final CustomerLeaderboardReport report;
  final bool compact;
  final bool showPersonal;
  final bool showRules;
  final bool showFreshness;

  @override
  State<CustomerLeaderboardReportPanel> createState() =>
      _CustomerLeaderboardReportPanelState();
}

class _CustomerLeaderboardReportPanelState
    extends State<CustomerLeaderboardReportPanel>
    with SingleTickerProviderStateMixin {
  late final TabController _tabs;
  static const _ink = Color(0xFF18382F);
  static const _green = Color(0xFF08783E);

  @override
  void initState() {
    super.initState();
    _tabs = TabController(length: 2, vsync: this);
  }

  @override
  void dispose() {
    _tabs.dispose();
    super.dispose();
  }

  String _money(num amount) {
    return formatLeaderboardNaira(amount);
  }

  @override
  Widget build(BuildContext context) {
    final report = widget.report;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            const Icon(Icons.emoji_events_rounded,
                color: Color(0xFFC38B2B), size: 20),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                'TOP 10 · ${report.month}',
                style: const TextStyle(
                    color: _ink, fontSize: 12, fontWeight: FontWeight.w900),
              ),
            ),
            Text(report.timeZone,
                style: const TextStyle(
                    color: Color(0xFF718178),
                    fontSize: 10,
                    fontWeight: FontWeight.w700)),
          ],
        ),
        if (widget.showPersonal) ...[
          const SizedBox(height: 10),
          _personal(report),
        ],
        if (widget.showRules && report.rules.isNotEmpty) ...[
          const SizedBox(height: 9),
          _rulesNote(report.rules),
        ],
        const SizedBox(height: 12),
        Container(
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(14),
            border: Border.all(color: const Color(0xFFE2EAE3)),
          ),
          child: TabBar(
            controller: _tabs,
            labelColor: _green,
            unselectedLabelColor: const Color(0xFF718178),
            indicatorColor: _green,
            tabs: const [
              Tab(text: 'Most Transactions'),
              Tab(text: 'Highest Transaction Value'),
            ],
          ),
        ),
        const SizedBox(height: 8),
        SizedBox(
          height: widget.compact ? 370 : 500,
          child: TabBarView(
            controller: _tabs,
            children: [
              _rankings(report.countTop, byCount: true),
              _rankings(report.valueTop, byCount: false),
            ],
          ),
        ),
        if (widget.showFreshness &&
            (report.calculatedAt != null || report.cachedUntil != null))
          Padding(
            padding: const EdgeInsets.only(top: 7, bottom: 2),
            child: Text(
              'Updated ${_time(report.calculatedAt)} · cached until ${_time(report.cachedUntil)}',
              textAlign: TextAlign.center,
              style: const TextStyle(color: Color(0xFF718178), fontSize: 10),
            ),
          ),
      ],
    );
  }

  Widget _personal(CustomerLeaderboardReport report) {
    final me = report.me;
    final needed = (me['transactionsNeededToTop10'] as num?)?.toInt() ?? 0;
    return Container(
      padding: EdgeInsets.all(widget.compact ? 14 : 18),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(17),
        border: Border.all(color: const Color(0xFFE2EAE3)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('YOUR MONTH',
              style: TextStyle(
                  color: _green,
                  fontSize: 11,
                  fontWeight: FontWeight.w900,
                  letterSpacing: 1)),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                child:
                    _metric('Successful Transactions', '${me['count'] ?? 0}'),
              ),
              Expanded(
                child:
                    _metric('Total value', _money((me['value'] as num?) ?? 0)),
              ),
            ],
          ),
          const Divider(height: 22),
          Wrap(
            spacing: 18,
            runSpacing: 6,
            children: [
              _rank('Transaction rank', me['countRank']),
              _rank('Value rank', me['valueRank']),
            ],
          ),
          if (needed > 0) ...[
            const SizedBox(height: 8),
            Text(
              '$needed extra qualifying ${needed == 1 ? 'purchase' : 'purchases'} to exceed the current 10th-place transaction count',
              style: const TextStyle(color: Color(0xFF60736A), fontSize: 12),
            ),
          ],
          const SizedBox(height: 7),
          const Text(
            'This count target is not a prediction of future rank. Ties use transaction value, then earliest eligible activity, then customer ID; rankings can change.',
            style:
                TextStyle(color: Color(0xFF718178), fontSize: 10, height: 1.4),
          ),
        ],
      ),
    );
  }

  Widget _metric(String title, String value) => Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(title,
              style: const TextStyle(color: Color(0xFF718178), fontSize: 11)),
          const SizedBox(height: 4),
          Text(value,
              style: const TextStyle(
                  color: _ink, fontSize: 17, fontWeight: FontWeight.w800)),
        ],
      );

  Widget _rank(String title, dynamic rank) => Text(
        '$title  ${rank == null ? '—' : '#$rank'}',
        style: const TextStyle(
            color: _ink, fontSize: 12, fontWeight: FontWeight.w700),
      );

  Widget _rulesNote(Map<String, dynamic> rules) {
    final basis = rules['periodBasis']?.toString();
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
          color: const Color(0xFFEAF4EC),
          borderRadius: BorderRadius.circular(13)),
      child: Text(
        'Period: ${reportTimeZoneLabel(widget.report)}${basis == 'createdAt' ? ' · transaction creation date' : ''}. ${rules['historyUsesCurrentRules'] == true ? 'Historical months use the rules currently selected.' : ''}',
        style: const TextStyle(
            color: Color(0xFF526A5D), fontSize: 10, height: 1.4),
      ),
    );
  }

  String reportTimeZoneLabel(CustomerLeaderboardReport report) =>
      report.timeZone == 'Africa/Lagos' ? 'Africa/Lagos' : report.timeZone;

  Widget _rankings(List<CustomerLeaderboardRow> rows, {required bool byCount}) {
    if (rows.isEmpty) {
      return const Center(
        child: Padding(
          padding: EdgeInsets.all(20),
          child: Text(
            'No qualifying activity to show for this ranking yet.',
            textAlign: TextAlign.center,
            style: TextStyle(color: Color(0xFF718178)),
          ),
        ),
      );
    }
    final medals = <IconData>[
      Icons.workspace_premium_rounded,
      Icons.military_tech_rounded,
      Icons.workspace_premium_outlined,
    ];
    const medalColors = [
      Color(0xFFC38B2B),
      Color(0xFF86989B),
      Color(0xFFB67955),
    ];
    return ListView.separated(
      key: ValueKey(byCount ? 'champions-count-list' : 'champions-value-list'),
      padding: EdgeInsets.zero,
      physics: const ClampingScrollPhysics(),
      itemCount: rows.take(10).length,
      separatorBuilder: (_, __) => const SizedBox(height: 7),
      itemBuilder: (context, index) {
        final row = rows[index];
        final metric =
            byCount ? '${row.count} Transactions' : _money(row.value);
        return Semantics(
          label: 'Rank ${row.rank}, ${row.displayName}, $metric',
          child: Container(
            constraints: const BoxConstraints(minHeight: 50),
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(13),
              border: Border.all(
                color: row.isMe
                    ? const Color(0xFF9CC8AA)
                    : const Color(0xFFE6ECE7),
              ),
            ),
            child: Row(
              children: [
                SizedBox(
                  width: 34,
                  child: row.rank >= 1 && row.rank <= 3
                      ? Icon(medals[row.rank - 1],
                          color: medalColors[row.rank - 1], size: 22)
                      : Text('#${row.rank}',
                          style: const TextStyle(
                              color: Color(0xFF75847B),
                              fontWeight: FontWeight.w800)),
                ),
                Expanded(
                  child: Text(row.displayName,
                      softWrap: true,
                      style: const TextStyle(
                          color: _ink, fontWeight: FontWeight.w700)),
                ),
                const SizedBox(width: 8),
                Text(metric,
                    style: const TextStyle(
                        color: _green,
                        fontSize: 11,
                        fontWeight: FontWeight.w800)),
              ],
            ),
          ),
        );
      },
    );
  }

  String _time(String? value) {
    if (value == null) return 'unknown';
    final date = DateTime.tryParse(value)?.toLocal();
    if (date == null) return 'recently';
    final hour = date.hour % 12 == 0 ? 12 : date.hour % 12;
    return '$hour:${date.minute.toString().padLeft(2, '0')} ${date.hour < 12 ? 'AM' : 'PM'}';
  }
}

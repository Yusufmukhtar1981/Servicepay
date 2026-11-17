part of 'management_dashboard_screen.dart';

extension _ManagementPerformance on _ManagementDashboardScreenState {
  Widget _performance() {
    final items = _rows(_leaderboard['items']);
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Wrap(spacing: 8, children: [
        _filter<String>(
          'Group',
          _dimension,
          const ['agents', 'states', 'zones'],
          (v) {
            _dimension = v;
            _load();
          },
        ),
        _filter<String>(
          'Rank by',
          _sort,
          const ['transactions', 'successfulValue', 'newCustomers'],
          (v) {
            _sort = v;
            _load();
          },
        ),
      ]),
      const SizedBox(height: 13),
      _panelCard(
        title: 'Scoped performance',
        subtitle: _text(
          _leaderboard['methodology'],
          'Rankings reflect activity in the selected period and scope.',
        ),
        child: items.isEmpty
            ? _empty('No performance data recorded for this period.')
            : Column(children: [
                for (final r in items) _rankingRow(r),
              ]),
      ),
    ]);
  }

  Widget _rankingRow(Map<String, dynamic> r) {
    final achievement = r['achievementPercent'];
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 13, horizontal: 4),
      decoration: const BoxDecoration(
        border: Border(bottom: BorderSide(color: Colors.white10)),
      ),
      child: Row(children: [
        SizedBox(
          width: 32,
          child: Text('#${r['rank'] ?? '—'}',
              style: const TextStyle(
                  color: _ManagementDashboardScreenState._green,
                  fontWeight: FontWeight.w800)),
        ),
        Expanded(
          flex: 2,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(_text(r['name']),
                  style: const TextStyle(
                      color: Colors.white,
                      fontSize: 12,
                      fontWeight: FontWeight.w700)),
              Text(
                [_roleLabel(_text(r['role'], '')), r['state'], r['zone']]
                    .where((e) => e != null && '$e'.isNotEmpty)
                    .join(' · '),
                style: const TextStyle(
                    color: _ManagementDashboardScreenState._muted,
                    fontSize: 10),
              ),
            ],
          ),
        ),
        Expanded(
          child: Text('${r['transactions'] ?? 0} txns',
              style: const TextStyle(
                  color: _ManagementDashboardScreenState._muted,
                  fontSize: 11)),
        ),
        Expanded(
          child: Text(_money(r['successfulValue']),
              style: const TextStyle(color: Colors.white, fontSize: 11)),
        ),
        Expanded(
          child: Text('${r['newCustomers'] ?? 0} new',
              style: const TextStyle(
                  color: _ManagementDashboardScreenState._muted,
                  fontSize: 11)),
        ),
        SizedBox(
          width: 100,
          child: Text(
            achievement == null ? 'No matching target' : '${_number(achievement).toStringAsFixed(1)}% target',
            textAlign: TextAlign.right,
            style: TextStyle(
              color: achievement == null
                  ? _ManagementDashboardScreenState._muted
                  : _ManagementDashboardScreenState._green,
              fontSize: 10,
            ),
          ),
        ),
      ]),
    );
  }
}

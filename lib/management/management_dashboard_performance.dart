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
      const SizedBox(height: 13),
      _panelCard(
        title: 'Customer activity',
        subtitle:
            'Customer rankings and customers with stopped activity, using the server activity definitions.',
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          LayoutBuilder(
            builder: (context, constraints) => SizedBox(
              width: constraints.maxWidth < 360 ? constraints.maxWidth : 320,
              child: _filter<String>(
                'Customer rank',
                _customerSort,
                const [
                  'transactions',
                  'transactionVolume',
                  'lastTransactionAt'
                ],
                (value) {
                  _customerSort = value;
                  _load();
                },
                isExpanded: true,
              ),
            ),
          ),
          const SizedBox(height: 10),
          const Text('Top customers',
              style: TextStyle(
                  color: Colors.white,
                  fontWeight: FontWeight.w800,
                  fontSize: 12)),
          const SizedBox(height: 6),
          ..._customerRows(_customerPerformance['items']),
          if (_customerRows(_customerPerformance['items']).isEmpty)
            const Text('No customer ranking data for this period.',
                style: TextStyle(
                    color: _ManagementDashboardScreenState._muted,
                    fontSize: 11)),
          const Divider(color: Colors.white12, height: 22),
          const Text('Stopped activity',
              style: TextStyle(
                  color: Colors.white,
                  fontWeight: FontWeight.w800,
                  fontSize: 12)),
          const SizedBox(height: 6),
          ..._customerRows(_customerPerformance['stopped']),
          if (_customerRows(_customerPerformance['stopped']).isEmpty)
            const Text('No stopped-activity records were returned.',
                style: TextStyle(
                    color: _ManagementDashboardScreenState._muted,
                    fontSize: 11)),
        ]),
      ),
    ]);
  }

  List<Widget> _customerRows(dynamic value) {
    final rows = _rows(value);
    return rows
        .map((customer) => LayoutBuilder(builder: (context, constraints) {
              final name = Text(
                _text(customer['fullName']),
                maxLines: constraints.maxWidth < 520 ? 2 : 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  color: Colors.white,
                  fontSize: 12,
                  fontWeight: FontWeight.w700,
                ),
              );
              final transactions = Text(
                '${customer['transactions'] ?? '—'} txns',
                style: const TextStyle(
                  color: _ManagementDashboardScreenState._muted,
                  fontSize: 11,
                ),
              );
              final volume = Text(
                customer['transactionVolume'] == null
                    ? '—'
                    : _money(customer['transactionVolume']),
                style: const TextStyle(color: Colors.white, fontSize: 11),
              );
              final activity = Text(
                _text(customer['activityStatus']),
                style: const TextStyle(
                  color: _ManagementDashboardScreenState._green,
                  fontSize: 10,
                ),
              );
              return Padding(
                padding: const EdgeInsets.symmetric(vertical: 8),
                child: constraints.maxWidth < 520
                    ? Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          name,
                          const SizedBox(height: 5),
                          Wrap(
                            spacing: 12,
                            runSpacing: 5,
                            children: [transactions, volume, activity],
                          ),
                        ],
                      )
                    : Row(
                        children: [
                          Expanded(child: name),
                          transactions,
                          const SizedBox(width: 12),
                          volume,
                          const SizedBox(width: 12),
                          activity,
                        ],
                      ),
              );
            }))
        .toList();
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
                  color: _ManagementDashboardScreenState._muted, fontSize: 11)),
        ),
        Expanded(
          child: Text(_money(r['successfulValue']),
              style: const TextStyle(color: Colors.white, fontSize: 11)),
        ),
        Expanded(
          child: Text('${r['newCustomers'] ?? 0} new',
              style: const TextStyle(
                  color: _ManagementDashboardScreenState._muted, fontSize: 11)),
        ),
        SizedBox(
          width: 100,
          child: Text(
            achievement == null
                ? 'No matching target'
                : '${_number(achievement).toStringAsFixed(1)}% target',
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

part of 'management_dashboard_screen.dart';

extension _ManagementTransactions on _ManagementDashboardScreenState {
  Future<void> _openTransaction(Map<String, dynamic> row) async {
    final id = _text(row['_id'], '');
    if (id.isEmpty) return;
    try {
      final data = await _api.get('analytics/transactions/$id', _scopeQuery());
      if (!mounted) return;
      final transaction = _map(data['transaction']);
      showDialog<void>(
        context: context,
        builder: (context) => ManagementDetailDialog(
          title: 'Transaction details',
          values: {
            'Reference': _text(transaction['reference']),
            'Customer': _text(_map(transaction['customerId'])['fullName']),
            'Phone': _text(_map(transaction['customerId'])['phone']),
            'Aggregator': _text(transaction['agentId']),
            'State manager': _text(transaction['stateManagerId']),
            'Zonal manager': _text(transaction['zonalManagerId']),
            'Service': _text(transaction['serviceType']),
            'Amount': _money(transaction['amount']),
            'Status': _text(transaction['status']),
            'Provider': _text(transaction['provider']),
            'Description': _text(transaction['description']),
            'Created': _dateTime(transaction['createdAt']),
            'Updated': _dateTime(transaction['updatedAt']),
          },
        ),
      );
    } catch (e) {
      if (mounted) {
        _snack(e is ManagementApiException
            ? e.message
            : 'Could not load transaction.');
      }
    }
  }

  Widget _transactionsView() {
    final items = _rows(_transactions['items']);
    return Column(children: [
      Wrap(spacing: 9, runSpacing: 9, children: [
        _filter<String>(
          'Status',
          _status,
          const ['ALL', 'SUCCESSFUL', 'FAILED', 'PENDING', 'REFUNDED'],
          (v) {
            _status = v;
            _page = 1;
            _load();
          },
        ),
        SizedBox(
          width: 165,
          height: 43,
          child: TextField(
            controller: _serviceSearch,
            onSubmitted: (value) {
              _serviceType = value.trim().isEmpty ? 'ALL' : value.trim();
              _page = 1;
              _load();
            },
            style: const TextStyle(color: Colors.white, fontSize: 12),
            decoration: InputDecoration(
              hintText: 'Exact service type',
              prefixIcon: const Icon(Icons.tune_rounded,
                  color: _ManagementDashboardScreenState._muted, size: 17),
              filled: true,
              fillColor: _ManagementDashboardScreenState._panel,
              contentPadding: EdgeInsets.zero,
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(10),
                borderSide: BorderSide.none,
              ),
            ),
          ),
        ),
        SizedBox(
          width: 245,
          height: 43,
          child: TextField(
            controller: _search,
            style: const TextStyle(color: Colors.white, fontSize: 12),
            decoration: InputDecoration(
              hintText: 'Search reference or customer',
              prefixIcon: const Icon(Icons.search,
                  color: _ManagementDashboardScreenState._muted, size: 19),
              filled: true,
              fillColor: _ManagementDashboardScreenState._panel,
              contentPadding: EdgeInsets.zero,
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(10),
                borderSide: BorderSide.none,
              ),
            ),
          ),
        ),
        OutlinedButton.icon(
          onPressed: _exporting ? null : () => _export('csv'),
          icon: const Icon(Icons.download_outlined, size: 17),
          label: Text(_exporting ? 'Preparing…' : 'Export CSV'),
        ),
      ]),
      const SizedBox(height: 15),
      if (_loading && items.isEmpty)
        _tableSkeleton()
      else if (items.isEmpty)
        _empty('No transactions match this date and filter.')
      else
        _panelCard(
          title: 'Transactions',
          subtitle:
              '${_transactions['total'] ?? items.length} records · select a row for full details',
          child: Column(children: [
            for (final row in items) _transactionRow(row),
            _pagination(_transactions),
          ]),
        ),
    ]);
  }

  Widget _transactionRow(Map<String, dynamic> row) {
    final customer = _map(row['customerId']);
    return InkWell(
      onTap: () => _openTransaction(row),
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 13, horizontal: 5),
        decoration: const BoxDecoration(
          border: Border(bottom: BorderSide(color: Colors.white10)),
        ),
        child: LayoutBuilder(builder: (context, c) {
          if (c.maxWidth < 650) {
            return Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(children: [
                  Expanded(
                    child: Text(
                      _text(row['reference']),
                      style: const TextStyle(
                        color: Colors.white,
                        fontWeight: FontWeight.w700,
                        fontSize: 12,
                      ),
                    ),
                  ),
                  _statusChip(_text(row['status'])),
                ]),
                const SizedBox(height: 6),
                Text(
                  '${_text(customer['fullName'])} · ${_text(row['serviceType'])}',
                  style: const TextStyle(
                      color: _ManagementDashboardScreenState._muted,
                      fontSize: 11),
                ),
                const SizedBox(height: 4),
                Row(children: [
                  Expanded(
                    child: Text(
                      _dateTime(row['createdAt']),
                      style: const TextStyle(
                          color: _ManagementDashboardScreenState._muted,
                          fontSize: 10),
                    ),
                  ),
                  Text(
                    _money(row['amount']),
                    style: const TextStyle(
                      color: Colors.white,
                      fontWeight: FontWeight.w700,
                      fontSize: 12,
                    ),
                  ),
                ]),
              ],
            );
          }
          return Row(children: [
            Expanded(
              flex: 2,
              child: Text(_text(row['reference']),
                  style: const TextStyle(
                      color: Colors.white,
                      fontWeight: FontWeight.w600,
                      fontSize: 12)),
            ),
            Expanded(
              flex: 2,
              child: Text(_text(customer['fullName']),
                  style: const TextStyle(
                      color: _ManagementDashboardScreenState._muted,
                      fontSize: 12)),
            ),
            Expanded(
              child: Text(_text(row['serviceType']),
                  style: const TextStyle(
                      color: _ManagementDashboardScreenState._muted,
                      fontSize: 11)),
            ),
            Expanded(
              child: Text(_money(row['amount']),
                  style: const TextStyle(color: Colors.white, fontSize: 12)),
            ),
            _statusChip(_text(row['status'])),
            const SizedBox(width: 16),
            Text(_dateTime(row['createdAt']),
                style: const TextStyle(
                    color: _ManagementDashboardScreenState._muted,
                    fontSize: 10)),
          ]);
        }),
      ),
    );
  }
}

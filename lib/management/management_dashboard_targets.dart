part of 'management_dashboard_screen.dart';

extension _ManagementTargets on _ManagementDashboardScreenState {
  Future<void> _showTargetForm([Map<String, dynamic>? existing]) async {
    final canManage = _targets['canManage'] == true &&
        (widget.role == 'STATE_MANAGER' || widget.role == 'ZONAL_MANAGER') &&
        !_readOnlyScope;
    if (!canManage) return;
    List<Map<String, dynamic>> authorizedMembers;
    try {
      final teamData = await _api.get('analytics/teams', {
        ..._dateQuery(),
        if (_teamId != null && _teamId!.isNotEmpty) 'teamId': _teamId!,
        'page': '1',
        'limit': '100',
      });
      authorizedMembers = _rows(teamData['items']);
    } catch (e) {
      if (mounted) {
        _snack(e is ManagementApiException
            ? e.message
            : 'Could not load authorized team members.');
      }
      return;
    }
    if (!mounted) return;

    final values = _map(existing?['values']);
    final scope = _map(_overview['scope']);
    final selfId = _text(scope['id'], '');
    final subjects = <String, String>{
      if (selfId.isNotEmpty) selfId: _text(scope['name'], 'My scope'),
      for (final member in authorizedMembers)
        if (_text(member['_id'], '').isNotEmpty)
          _text(member['_id']): _text(member['fullName'], 'Team member'),
    };
    final existingId = _text(existing?['management']?['subjectId'], '');
    if (existingId.isNotEmpty) {
      subjects.putIfAbsent(
        existingId,
        () => _text(existing?['subjectName'], 'Assigned team member'),
      );
    }
    String selectedSubject = existingId.isNotEmpty
        ? existingId
        : (selfId.isNotEmpty
            ? selfId
            : subjects.keys.isNotEmpty
                ? subjects.keys.first
                : '');
    final existingStart = ManagementPeriod.lagosCalendarDate(
      DateTime.tryParse(
        '${_map(existing?['management'])['startsAt'] ?? ''}',
      ),
    );
    if (existing != null && existingStart == null) {
      _snack('This target has no valid start date; it cannot be safely revised.');
      return;
    }
    DateTime selectedStartDate =
        existingStart ?? ManagementPeriod.lagosCalendarDate(DateTime.now())!;
    final customer =
        TextEditingController(text: '${values['newCustomers'] ?? ''}');
    final transactions =
        TextEditingController(text: '${values['transactions'] ?? ''}');
    final agents =
        TextEditingController(text: '${values['activeAgents'] ?? ''}');
    final reason = TextEditingController();
    String period = _text(existing?['management']?['period'], 'MONTHLY');

    final saved = await showDialog<bool>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setDialog) => AlertDialog(
          backgroundColor: _ManagementDashboardScreenState._panel,
          title: Text(existing == null ? 'Set a team target' : 'Update target',
              style: const TextStyle(color: Colors.white)),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                DropdownButtonFormField<String>(
                  isExpanded: true,
                  value: subjects.containsKey(selectedSubject)
                      ? selectedSubject
                      : null,
                  items: subjects.entries
                      .map((e) => DropdownMenuItem(
                            value: e.key,
                            child: Text(e.value,
                                overflow: TextOverflow.ellipsis),
                          ))
                      .toList(),
                  onChanged: existing == null
                      ? (v) => setDialog(
                          () => selectedSubject = v ?? selectedSubject)
                      : null,
                  decoration: const InputDecoration(
                      labelText: 'Authorized team member'),
                ),
                DropdownButtonFormField<String>(
                  isExpanded: true,
                  value: period,
                  items: const ['DAILY', 'WEEKLY', 'MONTHLY']
                      .map((e) => DropdownMenuItem(value: e, child: Text(e)))
                      .toList(),
                  onChanged: existing == null
                      ? (v) => setDialog(() => period = v ?? period)
                      : null,
                  decoration:
                      const InputDecoration(labelText: 'Target period'),
                ),
                InkWell(
                  onTap: existing != null
                      ? null
                      : () async {
                          final today =
                              ManagementPeriod.lagosCalendarDate(
                                  DateTime.now())!;
                          final picked = await showDatePicker(
                            context: ctx,
                            initialDate: selectedStartDate,
                            firstDate: DateTime(today.year - 5),
                            lastDate: DateTime(today.year + 5),
                          );
                          if (picked != null) {
                            setDialog(() => selectedStartDate = picked);
                          }
                        },
                  child: InputDecorator(
                    decoration: InputDecoration(
                      labelText: 'Target start date · Africa/Lagos',
                      enabled: existing == null,
                      suffixIcon:
                          const Icon(Icons.calendar_today_outlined, size: 17),
                    ),
                    child: Text(ManagementPeriod.dateString(selectedStartDate)),
                  ),
                ),
                TextField(
                  controller: customer,
                  keyboardType: TextInputType.number,
                  decoration:
                      const InputDecoration(labelText: 'New customers target'),
                ),
                TextField(
                  controller: transactions,
                  keyboardType: TextInputType.number,
                  decoration:
                      const InputDecoration(labelText: 'Transactions target'),
                ),
                TextField(
                  controller: agents,
                  keyboardType: TextInputType.number,
                  decoration: const InputDecoration(
                      labelText: 'Active aggregators target'),
                ),
                TextField(
                  controller: reason,
                  decoration:
                      const InputDecoration(labelText: 'Reason for this target'),
                ),
              ],
            ),
          ),
          actions: [
            TextButton(
                onPressed: () => Navigator.pop(ctx, false),
                child: const Text('Cancel')),
            FilledButton(
                onPressed: () => Navigator.pop(ctx, true),
                child: const Text('Save target')),
          ],
        ),
      ),
    );
    if (saved != true) {
      customer.dispose();
      transactions.dispose();
      agents.dispose();
      reason.dispose();
      return;
    }
    if (selectedSubject.isEmpty) {
      customer.dispose();
      transactions.dispose();
      agents.dispose();
      reason.dispose();
      if (mounted) {
        _snack('No authorized team member is available for a target.');
      }
      return;
    }
    final date = ManagementPeriod.dateString(selectedStartDate);
    final targetValues = <String, dynamic>{
      if (customer.text.trim().isNotEmpty)
        'newCustomers': int.tryParse(customer.text),
      if (transactions.text.trim().isNotEmpty)
        'transactions': int.tryParse(transactions.text),
      if (agents.text.trim().isNotEmpty)
        'activeAgents': int.tryParse(agents.text),
    }..removeWhere((key, value) => value == null);
    final reasonText = reason.text.trim();
    customer.dispose();
    transactions.dispose();
    agents.dispose();
    reason.dispose();
    if (!mounted) return;
    try {
      await _api.post('analytics/targets', {
        'subjectId': selectedSubject,
        'period': period,
        'startDate': date,
        'revision': existing?['management']?['revision'] ?? 0,
        'reason': reasonText,
        'values': targetValues,
      });
      if (mounted) {
        _snack('Target saved.');
        _load();
      }
    } catch (e) {
      if (mounted) {
        _snack(e is ManagementApiException ? e.message : 'Unable to save target.');
      }
    }
  }

  Widget _marketing() {
    final items = _rows(_targets['items']);
    final canManage = _targets['canManage'] == true &&
        (widget.role == 'STATE_MANAGER' || widget.role == 'ZONAL_MANAGER') &&
        !_readOnlyScope;
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Row(children: [
        const Expanded(
            child: Text('Targets & acquisition',
                style: TextStyle(
                    color: _ManagementDashboardScreenState._muted,
                    fontSize: 13))),
        if (canManage)
          FilledButton.icon(
            onPressed: () => _showTargetForm(),
            icon: const Icon(Icons.add, size: 17),
            label: const Text('Set target'),
          ),
      ]),
      const SizedBox(height: 12),
      _panelCard(
        title: 'Management targets',
        subtitle: '${canManage ? 'Set targets for yourself or authorized downline members.' : 'Targets are read-only for your role or this suspended scope.'} Actuals use the selected overlapping dates; each target remains for its assigned full period.',
        child: items.isEmpty
            ? _empty('No targets assigned in this period.')
            : Column(children: [
                for (final item in items) _targetRow(item, canManage),
              ]),
      ),
      const SizedBox(height: 12),
      _panelCard(
        title: 'Customer acquisition',
        subtitle: 'Measured customer counts from the selected period.',
        child: Wrap(spacing: 26, runSpacing: 16, children: [
          _smallMetric(
              'New customers', '${_map(_overview['kpis'])['newCustomers'] ?? '—'}'),
          _smallMetric('Active customers',
              '${_map(_overview['kpis'])['activeCustomers'] ?? '—'}'),
          _smallMetric('Inactive customers',
              '${_map(_overview['kpis'])['inactiveCustomers'] ?? '—'}'),
        ]),
      ),
    ]);
  }

  Widget _targetRow(Map<String, dynamic> item, bool canManage) {
    final progress = _map(item['progress']);
    final mgmt = _map(item['management']);
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 12, horizontal: 4),
      decoration: const BoxDecoration(
        border: Border(bottom: BorderSide(color: Colors.white10)),
      ),
      child: Row(children: [
        Expanded(
          flex: 2,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(_text(item['subjectName'], 'Team target'),
                  style: const TextStyle(
                      color: Colors.white,
                      fontWeight: FontWeight.w700,
                      fontSize: 12)),
              Text(
                '${_text(mgmt['period'])} · ${_dateTime(mgmt['startsAt']).split(' ').first}–${_dateTime(mgmt['endsAt']).split(' ').first}',
                style: const TextStyle(
                    color: _ManagementDashboardScreenState._muted,
                    fontSize: 10),
              ),
            ],
          ),
        ),
        ...progress.entries.map((e) {
          final metric = _map(e.value);
          return Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(e.key,
                    style: const TextStyle(
                        color: _ManagementDashboardScreenState._muted,
                        fontSize: 10)),
                Text('${metric['actual'] ?? 0} / ${metric['target'] ?? 0}',
                    style: const TextStyle(
                        color: Colors.white,
                        fontWeight: FontWeight.w700,
                        fontSize: 12)),
                Text(
                    metric['percent'] == null
                        ? 'No target'
                        : '${_number(metric['percent']).toStringAsFixed(1)}% complete',
                    style: const TextStyle(
                        color: _ManagementDashboardScreenState._green,
                        fontSize: 9)),
                const SizedBox(height: 5),
                LinearProgressIndicator(
                  value: (_number(metric['percent']) / 100).clamp(0.0, 1.0).toDouble(),
                  color: _ManagementDashboardScreenState._green,
                  backgroundColor: Colors.white10,
                  semanticsLabel: '${e.key} target progress',
                  semanticsValue: '${metric['actual'] ?? 0} of ${metric['target'] ?? 0}',
                ),
              ],
            ),
          );
        }),
        if (canManage)
          IconButton(
            tooltip: 'Edit target',
            onPressed: () => _showTargetForm(item),
            icon: const Icon(Icons.edit_outlined,
                color: _ManagementDashboardScreenState._green, size: 18),
          ),
      ]),
    );
  }
}

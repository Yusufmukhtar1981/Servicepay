import 'package:flutter/material.dart';

import 'admin_calls_api.dart';

class AdminCallsScreen extends StatefulWidget {
  const AdminCallsScreen({super.key, this.api});

  final AdminCallsApi? api;

  @override
  State<AdminCallsScreen> createState() => _AdminCallsScreenState();
}

class _AdminCallsScreenState extends State<AdminCallsScreen> {
  static const int _pageSize = 20;
  static const List<String> _statuses = <String>[
    'ALL',
    'RINGING',
    'CONNECTED',
    'ENDED',
    'MISSED',
    'DECLINED',
    'FAILED',
  ];

  late final AdminCallsApi _api;
  late final bool _ownsApi;
  List<Map<String, dynamic>> _calls = <Map<String, dynamic>>[];
  String _status = 'ALL';
  DateTime? _startDate;
  DateTime? _endDate;
  String? _error;
  bool _loading = true;
  int _page = 1;
  int _totalPages = 1;
  int _total = 0;

  @override
  void initState() {
    super.initState();
    _ownsApi = widget.api == null;
    _api = widget.api ?? AdminCallsApi();
    _load();
  }

  @override
  void dispose() {
    if (_ownsApi) _api.close();
    super.dispose();
  }

  Future<void> _load({int? page}) async {
    final int requestedPage = page ?? _page;
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final Map<String, dynamic> response = await _api.list(
        page: requestedPage,
        limit: _pageSize,
        status: _status == 'ALL' ? null : _status,
        startDate: _startDate,
        endDate: _endDate,
      );
      final Map<String, dynamic> data = _map(response['data']).isNotEmpty
          ? _map(response['data'])
          : response;
      final dynamic rawCalls =
          data['calls'] ?? data['items'] ?? data['docs'] ?? response['calls'];
      final Map<String, dynamic> pagination =
          _map(data['pagination']).isNotEmpty
              ? _map(data['pagination'])
              : _map(response['pagination']);
      if (!mounted) return;
      setState(() {
        _calls = rawCalls is List
            ? rawCalls.whereType<Map>().map(_map).toList()
            : <Map<String, dynamic>>[];
        _page = _positive(
          pagination['currentPage'] ?? pagination['page'] ?? data['page'],
          requestedPage,
        );
        _totalPages = _positive(
          pagination['totalPages'] ?? pagination['pages'] ?? data['totalPages'],
          1,
        );
        _total = _integer(
          pagination['total'] ?? pagination['totalItems'] ?? data['total'],
          _calls.length,
        );
      });
    } catch (error) {
      if (mounted) {
        setState(() => _error = error.toString().replaceFirst('Exception: ', ''));
      }
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Map<String, dynamic> _map(dynamic value) =>
      value is Map ? Map<String, dynamic>.from(value) : <String, dynamic>{};

  int _integer(dynamic value, int fallback) =>
      value is num ? value.toInt() : int.tryParse('$value') ?? fallback;

  int _positive(dynamic value, int fallback) {
    final int result = _integer(value, fallback);
    return result > 0 ? result : fallback;
  }

  Future<void> _pickDate({required bool start}) async {
    final DateTime now = DateTime.now();
    final DateTime initial = start
        ? (_startDate ?? now.subtract(const Duration(days: 7)))
        : (_endDate ?? now);
    final DateTime? selected = await showDatePicker(
      context: context,
      initialDate: initial.isAfter(now) ? now : initial,
      firstDate: now.subtract(const Duration(days: 90)),
      lastDate: now,
      helpText: start ? 'Select start date' : 'Select end date',
    );
    if (selected == null || !mounted) return;
    final DateTime normalized = DateTime(selected.year, selected.month, selected.day);
    setState(() {
      if (start) {
        _startDate = normalized;
        if (_endDate != null && _endDate!.isBefore(normalized)) {
          _endDate = normalized;
        }
      } else {
        _endDate = normalized;
        if (_startDate != null && normalized.isBefore(_startDate!)) {
          _startDate = normalized;
        }
      }
      _page = 1;
    });
    _load(page: 1);
  }

  void _clearDates() {
    setState(() {
      _startDate = null;
      _endDate = null;
      _page = 1;
    });
    _load(page: 1);
  }

  String _dateLabel(DateTime? value, String fallback) {
    if (value == null) return fallback;
    return '${value.year.toString().padLeft(4, '0')}-'
        '${value.month.toString().padLeft(2, '0')}-'
        '${value.day.toString().padLeft(2, '0')}';
  }

  String _text(dynamic value, [String fallback = 'Unavailable']) {
    final String text = value?.toString().trim() ?? '';
    return text.isEmpty ? fallback : text;
  }

  String _person(Map<String, dynamic> call, String key) {
    final Map<String, dynamic> person = _map(call[key]);
    return _text(
      person['displayName'] ??
          person['fullName'] ??
          person['name'] ??
          person['phone'] ??
          call['${key}Name'] ??
          call['${key}Phone'],
    );
  }

  String _timestamp(Map<String, dynamic> call) {
    final dynamic raw = call['startedAt'] ?? call['startTime'] ?? call['createdAt'];
    return _formatTimestamp(raw);
  }

  String _endTimestamp(Map<String, dynamic> call) {
    return _formatTimestamp(call['endedAt'] ?? call['endTime']);
  }

  String _formatTimestamp(dynamic raw) {
    final DateTime? value = raw is DateTime ? raw : DateTime.tryParse('$raw');
    if (value == null) return _text(raw);
    final DateTime local = value.toLocal();
    return '${_dateLabel(local, '')} '
        '${local.hour.toString().padLeft(2, '0')}:'
        '${local.minute.toString().padLeft(2, '0')}';
  }

  String _duration(Map<String, dynamic> call) {
    final int seconds = _integer(
      call['durationSeconds'] ?? call['duration'] ?? call['durationInSeconds'],
      0,
    );
    final Duration value = Duration(seconds: seconds < 0 ? 0 : seconds);
    final String hours = value.inHours.toString().padLeft(2, '0');
    final String minutes = value.inMinutes.remainder(60).toString().padLeft(2, '0');
    final String secs = value.inSeconds.remainder(60).toString().padLeft(2, '0');
    return '$hours:$minutes:$secs';
  }

  Color _statusColor(String value) {
    final String status = value.toUpperCase();
    if (status.contains('FAILED') || status.contains('MISSED') || status.contains('DECLINED')) return Colors.red.shade700;
    if (status.contains('RING')) return Colors.orange.shade800;
    if (status.contains('CONNECT') || status.contains('END')) return const Color(0xFF08783E);
    return Colors.blueGrey;
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF4F7F5),
      body: SafeArea(
        child: LayoutBuilder(
          builder: (BuildContext context, BoxConstraints constraints) {
            return RefreshIndicator(
              onRefresh: _load,
              child: ListView(
                padding: EdgeInsets.all(constraints.maxWidth < 600 ? 16 : 24),
                children: <Widget>[
                  const Text('ServicePay Calls', style: TextStyle(fontSize: 24, fontWeight: FontWeight.w800)),
                  const SizedBox(height: 4),
                  const Text('Read-only call metadata.'),
                  const SizedBox(height: 16),
                  _filters(constraints.maxWidth),
                  const SizedBox(height: 16),
                  if (_loading) const Padding(padding: EdgeInsets.all(48), child: Center(child: CircularProgressIndicator()))
                  else if (_error != null) _message(icon: Icons.error_outline, text: _error!, retry: _load)
                  else if (_calls.isEmpty) _message(icon: Icons.call_outlined, text: 'No calls match the selected filters.', retry: _load)
                  else ...<Widget>[
                    Text('$_total call${_total == 1 ? '' : 's'}', style: const TextStyle(fontWeight: FontWeight.w700)),
                    const SizedBox(height: 8),
                    _callList(constraints.maxWidth),
                    const SizedBox(height: 12),
                    _pagination(),
                  ],
                ],
              ),
            );
          },
        ),
      ),
    );
  }

  Widget _filters(double width) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Wrap(
          spacing: 12,
          runSpacing: 10,
          crossAxisAlignment: WrapCrossAlignment.center,
          children: <Widget>[
            SizedBox(
              width: width < 500 ? double.infinity : 180,
              child: DropdownButtonFormField<String>(
                value: _status,
                decoration: const InputDecoration(labelText: 'Status', border: OutlineInputBorder()),
                items: _statuses.map((String item) => DropdownMenuItem(value: item, child: Text(item == 'ALL' ? 'All statuses' : item))).toList(),
                onChanged: (String? value) {
                  if (value == null) return;
                  setState(() {
                    _status = value;
                    _page = 1;
                  });
                  _load(page: 1);
                },
              ),
            ),
            OutlinedButton.icon(onPressed: () => _pickDate(start: true), icon: const Icon(Icons.calendar_today_outlined), label: Text(_dateLabel(_startDate, 'Start date'))),
            OutlinedButton.icon(onPressed: () => _pickDate(start: false), icon: const Icon(Icons.calendar_today_outlined), label: Text(_dateLabel(_endDate, 'End date'))),
            if (_startDate != null || _endDate != null) TextButton(onPressed: _clearDates, child: const Text('Clear dates')),
          ],
        ),
      ),
    );
  }

  Widget _callList(double width) {
    if (width >= 760) {
      return Card(
        child: DataTable(
          columns: const <DataColumn>[
            DataColumn(label: Text('Caller')),
            DataColumn(label: Text('Receiver')),
            DataColumn(label: Text('Start')),
            DataColumn(label: Text('End')),
            DataColumn(label: Text('Duration')),
            DataColumn(label: Text('Status')),
          ],
          rows: _calls.map((Map<String, dynamic> call) => DataRow(cells: <DataCell>[
            DataCell(SizedBox(width: 110, child: Text(_person(call, 'caller'), overflow: TextOverflow.ellipsis))),
            DataCell(SizedBox(width: 110, child: Text(_person(call, 'receiver'), overflow: TextOverflow.ellipsis))),
            DataCell(Text(_timestamp(call))),
            DataCell(Text(_endTimestamp(call))),
            DataCell(Text(_duration(call))),
            DataCell(_statusChip(_text(call['status']))),
          ])).toList(),
        ),
      );
    }
    return Column(children: _calls.map(_callCard).toList());
  }

  Widget _callCard(Map<String, dynamic> call) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: <Widget>[
          Row(children: <Widget>[Expanded(child: Text('${_person(call, 'caller')} to ${_person(call, 'receiver')}', style: const TextStyle(fontWeight: FontWeight.w700))), _statusChip(_text(call['status']))]),
          const SizedBox(height: 10),
          Text('Start: ${_timestamp(call)}'),
          Text('End: ${_endTimestamp(call)}'),
          Text('Duration: ${_duration(call)}'),
        ]),
      ),
    );
  }

  Widget _statusChip(String status) => Chip(
        label: Text(status),
        labelStyle: TextStyle(color: _statusColor(status), fontWeight: FontWeight.w700),
        backgroundColor: _statusColor(status).withValues(alpha: 0.10),
        side: BorderSide.none,
      );

  Widget _message({required IconData icon, required String text, required Future<void> Function() retry}) {
    return Padding(
      padding: const EdgeInsets.all(32),
      child: Center(child: Column(children: <Widget>[Icon(icon, size: 40), const SizedBox(height: 12), Text(text, textAlign: TextAlign.center), const SizedBox(height: 12), OutlinedButton(onPressed: retry, child: const Text('Retry'))])),
    );
  }

  Widget _pagination() {
    return Row(
      mainAxisAlignment: MainAxisAlignment.end,
      children: <Widget>[
        Text('Page $_page of $_totalPages'),
        const SizedBox(width: 8),
        IconButton(tooltip: 'Previous page', onPressed: _page > 1 ? () => _load(page: _page - 1) : null, icon: const Icon(Icons.chevron_left)),
        IconButton(tooltip: 'Next page', onPressed: _page < _totalPages ? () => _load(page: _page + 1) : null, icon: const Icon(Icons.chevron_right)),
      ],
    );
  }
}
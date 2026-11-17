import 'dart:async';
import 'dart:typed_data';

import 'package:flutter/material.dart';

import '../services/receipt_download.dart';
import 'management_api.dart';
import 'management_widgets.dart';

part 'management_dashboard_transactions.dart';
part 'management_dashboard_performance.dart';
part 'management_dashboard_targets.dart';

class ManagementDashboardScreen extends StatefulWidget {
  const ManagementDashboardScreen({
    super.key,
    required this.role,
    this.initialSection = 'Dashboard',
    this.teamId,
    this.api,
  });

  final String role;
  final String initialSection;
  final String? teamId;
  final ManagementApi? api;

  @override
  State<ManagementDashboardScreen> createState() =>
      _ManagementDashboardScreenState();
}

class _ManagementDashboardScreenState extends State<ManagementDashboardScreen> {
  static const _bg = Color(0xFF092B20);
  static const _panel = Color(0xFF123B2D);
  static const _panel2 = Color(0xFF194735);
  static const _green = Color(0xFF54E38A);
  static const _muted = Color(0xFFAAC2B5);
  late final ManagementApi _api = widget.api ?? ManagementApi();
  late String _section;
  ManagementPeriod _period = const ManagementPeriod('THIS_MONTH');
  String? _teamId;
  String _teamName = '';
  bool _readOnlyScope = false;
  String _status = 'ALL';
  String _serviceType = 'ALL';
  String _dimension = 'agents';
  String _sort = 'transactions';
  int _page = 1;
  final int _limit = 25;
  final _search = TextEditingController();
  final _teamSearch = TextEditingController();
  final _serviceSearch = TextEditingController();
  Map<String, dynamic> _overview = {};
  Map<String, dynamic> _transactions = {};
  Map<String, dynamic> _leaderboard = {};
  Map<String, dynamic> _teams = {};
  Map<String, dynamic> _targets = {};
  List<Map<String, dynamic>> _weekly = [];
  List<Map<String, dynamic>> _monthly = [];
  bool _loading = true;
  bool _exporting = false;
  String? _error;
  int _requestVersion = 0;
  Timer? _searchDebounce;

  final List<String> _sections = const [
    'Dashboard', 'Transactions', 'Performance', 'Marketing',
    'Team Management', 'Reports',
  ];

  @override
  void initState() {
    super.initState();
    _section = _sections.contains(widget.initialSection)
        ? widget.initialSection
        : 'Dashboard';
    _teamId = widget.teamId;
    _search.addListener(_searchChanged);
    _teamSearch.addListener(_searchChanged);
    _load();
  }

  @override
  void dispose() {
    _search.dispose();
    _teamSearch.dispose();
    _serviceSearch.dispose();
    _searchDebounce?.cancel();
    super.dispose();
  }

  void _searchChanged() {
    if (_section == 'Transactions' || _section == 'Team Management') {
      _page = 1;
      _searchDebounce?.cancel();
      _searchDebounce = Timer(const Duration(milliseconds: 320), _load);
    }
  }

  Map<String, String> _dateQuery() => _period.query();
  Map<String, String> _scopeQuery() => {
        ..._dateQuery(),
        if (_teamId != null && _teamId!.isNotEmpty) 'teamId': _teamId!,
      };

  Future<void> _load() async {
    final int version = ++_requestVersion;
    setState(() {
      _loading = true;
      _error = null;
      _overview = {};
      _transactions = {};
      _leaderboard = {};
      _teams = {};
      _targets = {};
      _weekly = [];
      _monthly = [];
    });
    try {
      final overviewFuture = _api.get('analytics/overview', _scopeQuery());
      Future<Map<String, dynamic>>? sectionFuture;
      switch (_section) {
        case 'Transactions':
          sectionFuture = _api.get('analytics/transactions', {
            ..._scopeQuery(),
            'status': _status,
            'serviceType': _serviceType,
            'search': _search.text.trim(),
            'page': '$_page',
            'limit': '$_limit',
          });
          break;
        case 'Performance':
          sectionFuture = _api.get('analytics/leaderboard', {
            ..._scopeQuery(), 'dimension': _dimension, 'sort': _sort,
          });
          break;
        case 'Marketing':
          sectionFuture = _api.get('analytics/targets', _scopeQuery());
          break;
        case 'Team Management':
          sectionFuture = _api.get('analytics/teams', {
            ..._dateQuery(),
            if (_teamId != null && _teamId!.isNotEmpty) 'teamId': _teamId!,
            'page': '$_page', 'limit': '$_limit',
            'search': _teamSearch.text.trim(),
          });
          break;
        case 'Reports':
          sectionFuture = Future<Map<String, dynamic>>.value({});
          break;
      }
      final results = await Future.wait([
        overviewFuture,
        if (sectionFuture != null) sectionFuture,
      ]);
      if (!mounted || version != _requestVersion) return;
      _overview = results.first;
      _weekly = _rows(_overview['weekly'])
          .where((row) => row['transactions'] is num)
          .toList();
      _monthly = _rows(_overview['monthly'])
          .where((row) => row['transactions'] is num)
          .toList();
      if (sectionFuture != null && results.length > 1) {
        switch (_section) {
          case 'Transactions': _transactions = results[1]; break;
          case 'Performance': _leaderboard = results[1]; break;
          case 'Marketing': _targets = results[1]; break;
          case 'Team Management': _teams = results[1]; break;
        }
      }
      setState(() { _loading = false; });
    } catch (e) {
      if (!mounted || version != _requestVersion) return;
      setState(() {
        _loading = false;
        _error = e is ManagementApiException ? e.message : 'Request timed out. Please try again.';
      });
    }
  }

  List<Map<String, dynamic>> _rows(dynamic value) => value is List
      ? value.whereType<Map>().map((r) => Map<String, dynamic>.from(r)).toList()
      : <Map<String, dynamic>>[];
  Map<String, dynamic> _map(dynamic value) =>
      value is Map ? Map<String, dynamic>.from(value) : <String, dynamic>{};
  String _text(dynamic v, [String fallback = '—']) =>
      v == null || v.toString().isEmpty ? fallback : v.toString();
  num _number(dynamic value) => value is num ? value : num.tryParse('$value') ?? 0;
  String _money(dynamic value) {
    final n = _number(value);
    final raw = n.toStringAsFixed(2).split('.');
    final whole = raw.first.replaceAllMapped(
      RegExp(r'(\d)(?=(\d{3})+(?!\d))'), (m) => '${m[1]},');
    return '₦$whole.${raw.last}';
  }

  void _selectSection(String section) {
    if (section == _section) return;
    setState(() {
      _section = section;
      _page = 1;
    });
    _load();
  }

  Future<void> _pickCustomPeriod() async {
    final now = DateTime.now();
    final picked = await showDateRangePicker(
      context: context,
      firstDate: DateTime(now.year - 5),
      lastDate: DateTime(now.year + 1),
      initialDateRange: DateTimeRange(
        start: _period.from ?? DateTime(now.year, now.month, 1),
        end: _period.to ?? now,
      ),
      builder: (context, child) => Theme(
        data: Theme.of(context).copyWith(
          colorScheme: const ColorScheme.dark(
            primary: _green, surface: _panel, onSurface: Colors.white,
          ),
        ),
        child: child!,
      ),
    );
    if (!mounted || picked == null) return;
    setState(() {
      _period = ManagementPeriod('CUSTOM', from: picked.start, to: picked.end);
      _page = 1;
    });
    _load();
  }

  String _dateTime(dynamic value) {
    final parsed = DateTime.tryParse('$value');
    if (parsed == null) return '—';
    final lagos = parsed.toUtc().add(const Duration(hours: 1));
    return '${lagos.toString().substring(0, 16)} WAT';
  }

  void _snack(String message) =>
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message)));

  Future<void> _export(String format) async {
    setState(() => _exporting = true);
    try {
      final bytes = await _api.export({
        ..._scopeQuery(),
        'status': _status,
        'serviceType': _serviceType,
        'search': _search.text.trim(),
        'format': format,
      });
      final name = 'servicepay-management-${DateTime.now().millisecondsSinceEpoch}.$format';
      final mime = format == 'csv'
          ? 'text/csv'
          : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      final String result = await downloadReceiptBytes(
        Uint8List.fromList(bytes), name, mimeType: mime,
      );
      if (mounted) _snack(result);
    } catch (e) {
      if (mounted) _snack(e is ManagementApiException ? e.message : 'Download failed. Please retry.');
    } finally {
      if (mounted) setState(() => _exporting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final wide = MediaQuery.sizeOf(context).width >= 900;
    final inherited = Theme.of(context);
    return Theme(
      data: inherited.copyWith(
        brightness: Brightness.dark,
        scaffoldBackgroundColor: _bg,
        colorScheme: inherited.colorScheme.copyWith(
          brightness: Brightness.dark,
          primary: _green,
          secondary: _green,
          surface: _panel,
          onSurface: Colors.white,
        ),
      ),
      child: Scaffold(
      backgroundColor: _bg,
      appBar: wide ? null : AppBar(
        backgroundColor: _bg,
        foregroundColor: Colors.white,
        title: const Text('ServicePay management'),
      ),
      drawer: wide ? null : Drawer(
        backgroundColor: _bg,
        child: SafeArea(child: _navigation(drawer: true)),
      ),
      body: SafeArea(
        child: Row(children: [
          if (wide) SizedBox(width: 246, child: _navigation(drawer: false)),
          Expanded(child: Column(children: [
            _header(wide),
            Expanded(child: _loading && _overview.isEmpty
                ? _skeleton()
                : _error != null && _overview.isEmpty
                    ? _errorView()
                    : _content()),
          ])),
        ]),
      ),
      ),
    );
  }

  Widget _navigation({required bool drawer}) => SingleChildScrollView(child: Padding(
    padding: const EdgeInsets.fromLTRB(18, 22, 14, 16),
    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      const Row(children: [
        ManagementBrandMark(), SizedBox(width: 11),
        Expanded(child: Text('ServicePay', maxLines: 1, overflow: TextOverflow.ellipsis,
          style: TextStyle(color: Colors.white, fontSize: 19, fontWeight: FontWeight.w800))),
      ]),
      const SizedBox(height: 31),
      const Text('WORKSPACE', style: TextStyle(color: _muted, letterSpacing: 1.5, fontSize: 10, fontWeight: FontWeight.w700)),
      const SizedBox(height: 12),
      ..._sections.map((section) {
        final selected = section == _section;
        final icon = switch (section) {
          'Dashboard' => Icons.grid_view_rounded,
          'Transactions' => Icons.receipt_long_rounded,
          'Performance' => Icons.query_stats_rounded,
          'Marketing' => Icons.campaign_outlined,
          'Team Management' => Icons.groups_2_outlined,
          _ => Icons.file_download_outlined,
        };
        return Padding(
          padding: const EdgeInsets.only(bottom: 5),
          child: ListTile(
            dense: true,
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
            selected: selected,
            selectedTileColor: _panel2,
            leading: Icon(icon, color: selected ? _green : _muted, size: 20),
            title: Text(section, style: TextStyle(
              color: selected ? Colors.white : _muted,
              fontSize: 13,
              fontWeight: selected ? FontWeight.w700 : FontWeight.w500,
            )),
            onTap: () {
              _selectSection(section);
              if (drawer) Navigator.of(context).maybePop();
            },
          ),
        );
      }),
      const SizedBox(height: 24),
      Container(
        padding: const EdgeInsets.all(13),
        decoration: BoxDecoration(color: _panel, borderRadius: BorderRadius.circular(14)),
        child: Row(children: [
          const Icon(Icons.shield_outlined, color: _green, size: 19),
          const SizedBox(width: 9),
          Expanded(child: Text('Scoped access · ${widget.role == 'AGENT' ? 'Aggregator' : widget.role.replaceAll('_', ' ')}',
              style: const TextStyle(color: _muted, fontSize: 11))),
        ]),
      ),
    ]),
  ));

  Widget _header(bool wide) => Padding(
    padding: EdgeInsets.fromLTRB(wide ? 30 : 18, wide ? 26 : 9, 22, 17),
    child: Row(children: [
      Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(_teamName.isEmpty ? 'Management workspace' : 'Team · $_teamName',
            style: const TextStyle(color: Colors.white, fontSize: 22, fontWeight: FontWeight.w800)),
        const SizedBox(height: 4),
        Text('Operational reporting · Africa/Lagos', style: TextStyle(color: _muted.withValues(alpha: .85), fontSize: 12)),
      ])),
      if (wide) const SizedBox(width: 20),
      Container(
        padding: const EdgeInsets.symmetric(horizontal: 12),
        decoration: BoxDecoration(color: _panel, borderRadius: BorderRadius.circular(11), border: Border.all(color: Colors.white12)),
        child: DropdownButtonHideUnderline(child: DropdownButton<String>(
          value: _period.preset,
          dropdownColor: _panel2,
          style: const TextStyle(color: Colors.white, fontSize: 12),
          items: ManagementPeriod.presets.map((p) => DropdownMenuItem(value: p, child: Text(p.replaceAll('_', ' ')))).toList(),
          onChanged: (value) {
            if (value == null) return;
            if (value == 'CUSTOM') { _pickCustomPeriod(); return; }
            setState(() {
              _period = ManagementPeriod(value);
              _page = 1;
            });
            _load();
          },
        )),
      ),
      const SizedBox(width: 8),
      IconButton(
        tooltip: 'Refresh data',
        onPressed: _loading ? null : _load,
        icon: Icon(Icons.refresh_rounded, color: _loading ? _muted : _green),
      ),
    ]),
  );

  Widget _content() => RefreshIndicator(
    onRefresh: _load,
    color: _green,
    backgroundColor: _panel,
    child: ListView(
      padding: const EdgeInsets.fromLTRB(22, 6, 22, 30),
      children: [
        if (_error != null) _inlineError(),
        if (_teamId != null) _scopeBanner(),
        Row(children: [
          Expanded(child: Text(_section, style: const TextStyle(color: Colors.white, fontSize: 19, fontWeight: FontWeight.w800))),
          if (_loading) const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2, color: _green)),
        ]),
        const SizedBox(height: 17),
        switch (_section) {
          'Dashboard' => _dashboard(),
          'Transactions' => _transactionsView(),
          'Performance' => _performance(),
          'Marketing' => _marketing(),
          'Team Management' => _teamManagement(),
          _ => _reports(),
        },
      ],
    ),
  );

  Widget _scopeBanner() => Container(
    margin: const EdgeInsets.only(bottom: 16),
    padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 11),
    decoration: BoxDecoration(color: _panel2, borderRadius: BorderRadius.circular(12)),
    child: Row(children: [
      const Icon(Icons.filter_alt_outlined, color: _green, size: 18),
      const SizedBox(width: 8),
      Expanded(child: Text(
        'Scoped to ${_teamName.isEmpty ? 'selected team member' : _teamName}${_readOnlyScope ? ' · suspended account, reporting only' : ''}',
        style: const TextStyle(color: Colors.white, fontSize: 12))),
      TextButton(onPressed: () {
        setState(() { _teamId = null; _teamName = ''; _readOnlyScope = false; });
        _load();
      }, child: const Text('Reset scope')),
    ]),
  );

  Widget _dashboard() {
    final kpis = _map(_overview['kpis']);
    final definitions = _map(_overview['definitions']);
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      if (_overview.isEmpty && !_loading) _empty('No measured data for this period.'),
      LayoutBuilder(builder: (context, constraints) {
        final columns = constraints.maxWidth > 1050 ? 4 : constraints.maxWidth > 650 ? 2 : 1;
        final items = <(String, String, IconData, String)>[
          ('Customers', '${kpis['totalCustomers'] ?? '—'}', Icons.people_alt_outlined, 'totalCustomers'),
          ('New customers', '${kpis['newCustomers'] ?? '—'}', Icons.person_add_alt_outlined, 'newCustomers'),
          ('Active customers', '${kpis['activeCustomers'] ?? '—'}', Icons.check_circle_outline, 'activeCustomers'),
          ('Inactive customers', '${kpis['inactiveCustomers'] ?? '—'}', Icons.person_off_outlined, 'inactiveCustomers'),
          ('Transactions', '${kpis['totalTransactions'] ?? '—'}', Icons.receipt_long_outlined, 'totalTransactions'),
          ('Transaction value', kpis['totalValue'] == null ? '—' : _money(kpis['totalValue']), Icons.payments_outlined, 'totalValue'),
          ('Successful', '${kpis['successfulTransactions'] ?? '—'}', Icons.task_alt, 'successfulTransactions'),
          ('Failed', '${kpis['failedTransactions'] ?? '—'}', Icons.error_outline, 'failedTransactions'),
          ('Pending', '${kpis['pendingTransactions'] ?? '—'}', Icons.hourglass_bottom, 'pendingTransactions'),
          ('Refunded', '${kpis['refundedTransactions'] ?? '—'}', Icons.undo_rounded, 'refundedTransactions'),
          ('Aggregators', '${kpis['totalAgents'] ?? '—'}', Icons.groups_outlined, 'totalAgents'),
          ('Active aggregators', '${kpis['activeAgents'] ?? '—'}', Icons.group_outlined, 'activeAgents'),
          ('Inactive aggregators', '${kpis['inactiveAgents'] ?? '—'}', Icons.group_off_outlined, 'inactiveAgents'),
          ('Own recorded commission', kpis['ownRecordedCommission'] == null ? '—' : _money(kpis['ownRecordedCommission']), Icons.account_balance_wallet_outlined, 'ownRecordedCommission'),
        ];
        return GridView.builder(
          itemCount: items.length,
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
            crossAxisCount: columns, crossAxisSpacing: 11, mainAxisSpacing: 11,
            mainAxisExtent: 105,
          ),
          itemBuilder: (context, index) {
            final item = items[index];
            final current = _number(kpis[item.$4]);
            final previousMap = _map(_overview['previous']);
            final hasPrevious = previousMap.containsKey(item.$4);
            final previous = _number(previousMap[item.$4]);
            final measured = hasPrevious && kpis.containsKey(item.$4);
            return ManagementKpiCard(
              label: item.$1, value: item.$2, icon: item.$3,
              comparison: measured ? '${current - previous >= 0 ? '+' : ''}${current - previous} vs previous' : 'Comparison unavailable',
            );
          },
        );
      }),
      const SizedBox(height: 20),
      _panelCard(
        title: 'Transaction activity',
        subtitle: 'Transactions recorded each period; zero baseline.',
        trailing: TextButton(onPressed: () => _selectSection('Transactions'), child: const Text('View transactions')),
        child: ManagementActivityChart(points: _weekly, label: 'Weekly transactions'),
      ),
      const SizedBox(height: 14),
      _panelCard(
        title: 'Monthly activity',
        subtitle: 'Monthly transaction counts for the selected reporting range.',
        child: ManagementActivityChart(points: _monthly, label: 'Monthly transactions'),
      ),
      const SizedBox(height: 13),
      Text('Definitions: active means successful transaction during selected period. ${_text(definitions['active'], '')}',
          style: const TextStyle(color: _muted, fontSize: 11, height: 1.45)),
      if (definitions['legacy'] != null)
        Text('Legacy data: ${definitions['legacy']}', style: const TextStyle(color: _muted, fontSize: 11)),
      if (_overview['legacyTransactions'] is num) ...[
        const SizedBox(height: 12),
        _panelCard(
          title: 'Legacy transactions',
          subtitle: _text(definitions['legacy'], 'Historical records reported separately from current activity.'),
          child: Text('${_overview['legacyTransactions']} records',
              style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w800, fontSize: 17)),
        ),
      ],
    ]);
  }

  Widget _teamManagement() {
    final items = _rows(_teams['items']);
    return Column(children: [
      Row(children: [
        Expanded(child: TextField(
          controller: _teamSearch,
          style: const TextStyle(color: Colors.white, fontSize: 12),
          decoration: InputDecoration(
            hintText: 'Search team members',
            prefixIcon: const Icon(Icons.search, color: _muted, size: 18),
            filled: true, fillColor: _panel, contentPadding: EdgeInsets.zero,
            border: OutlineInputBorder(borderRadius: BorderRadius.circular(10), borderSide: BorderSide.none),
          ),
        )),
        if (_teamId != null) TextButton(onPressed: () {
          setState(() { _teamId = null; _teamName = ''; _readOnlyScope = false; }); _load();
        }, child: const Text('Reset scope')),
      ]),
      const SizedBox(height: 13),
      _panelCard(
        title: 'Authorized team',
        subtitle: 'Choose a member to view reporting within their authorized scope.',
        child: items.isEmpty ? _empty('No team members found for this search.') : Column(children: [
          for (final member in items) InkWell(
            onTap: () {
              setState(() {
                _teamId = _text(member['_id'], '');
                _teamName = _text(member['fullName'], '');
                _readOnlyScope = _text(member['status']).toUpperCase() == 'SUSPENDED';
                _section = 'Dashboard';
              });
              _load();
            },
            child: Container(
              padding: const EdgeInsets.symmetric(vertical: 13, horizontal: 4),
              decoration: const BoxDecoration(border: Border(bottom: BorderSide(color: Colors.white10))),
              child: Row(children: [
                CircleAvatar(radius: 17, backgroundColor: _panel2,
                  child: Text(_initials(_text(member['fullName'])), style: const TextStyle(color: _green, fontSize: 10))),
                const SizedBox(width: 10),
                Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text(_text(member['fullName']), style: const TextStyle(color: Colors.white, fontSize: 12, fontWeight: FontWeight.w700)),
                  Text('${_roleLabel(_text(member['role']))} · ${_text(member['state'])} · ${_text(member['zone'])}',
                      style: const TextStyle(color: _muted, fontSize: 10)),
                ])),
                Expanded(child: _teamActivity(member)),
                const SizedBox(width: 8),
                const Icon(Icons.chevron_right, color: _green, size: 19),
              ]),
            ),
          ),
          _pagination(_teams),
        ]),
      ),
    ]);
  }

  String _roleLabel(String role) {
    if (role.trim().toUpperCase() == 'AGENT') return 'Aggregator';
    return role.replaceAll('_', ' ');
  }

  Widget _teamActivity(Map<String, dynamic> member) {
    final performance = _map(member['performance']);
    final inPeriod = performance['activeInPeriod'];
    final accountStatus = _text(member['status'], 'Unknown');
    final activeLabel = inPeriod == true
        ? 'Active in period'
        : inPeriod == false
            ? 'Inactive in period'
            : 'Activity unavailable';
    final counts = performance.containsKey('transactions') ||
            performance.containsKey('successful')
        ? '${performance['successful'] ?? '—'} successful / ${performance['transactions'] ?? '—'} transactions'
        : 'No measured transactions';
    return Column(
      crossAxisAlignment: CrossAxisAlignment.end,
      children: [
        Text('Account: $accountStatus',
            style: TextStyle(
              color: accountStatus.toUpperCase() == 'SUSPENDED'
                  ? const Color(0xFFE6C875)
                  : _muted,
              fontSize: 9,
              fontWeight: FontWeight.w700,
            )),
        Text(activeLabel,
            style: TextStyle(
              color: inPeriod == true ? _green : _muted,
              fontSize: 9,
            )),
        Text(counts, style: const TextStyle(color: _muted, fontSize: 8)),
        if (performance['lastTransactionAt'] != null)
          Text('Last activity ${_dateTime(performance['lastTransactionAt'])}',
              style: const TextStyle(color: _muted, fontSize: 8)),
      ],
    );
  }

  String _initials(String value) {
    final parts = value.trim().split(RegExp(r'\s+'));
    if (value.isEmpty) return '?';
    return parts.take(2).map((e) => e.isEmpty ? '' : e[0].toUpperCase()).join();
  }

  Widget _reports() => Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
    _panelCard(
      title: 'Export scoped report',
      subtitle: 'Downloads include the selected date range, current team scope and transaction filters. Exports are limited by the server to 5,000 rows.',
      child: Wrap(spacing: 12, runSpacing: 10, children: [
        FilledButton.icon(
          onPressed: _exporting ? null : () => _export('csv'),
          icon: const Icon(Icons.table_view_outlined), label: Text(_exporting ? 'Preparing…' : 'Download CSV'),
        ),
        OutlinedButton.icon(
          onPressed: _exporting ? null : () => _export('xlsx'),
          icon: const Icon(Icons.grid_on_outlined), label: const Text('Download Excel'),
        ),
      ]),
    ),
    const SizedBox(height: 14),
    _panelCard(
      title: 'Reporting notes',
      subtitle: 'Clear scope, measured activity and accountable definitions.',
      child: const Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        ManagementNoteLine('Timezone', 'Africa/Lagos calendar dates are inclusive.'),
        ManagementNoteLine('Active customer', 'At least one successful transaction within the selected period.'),
        ManagementNoteLine('Commission', 'Only your own recorded commission is displayed; this workspace does not expose company revenue.'),
        ManagementNoteLine('Target achievement', 'A missing achievement means no target is assigned, not zero performance.'),
      ]),
    ),
  ]);

  Widget _filter<T extends String>(String label, T value, List<T> options, ValueChanged<T> changed) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 10),
    decoration: BoxDecoration(color: _panel, borderRadius: BorderRadius.circular(10)),
    child: DropdownButtonHideUnderline(child: DropdownButton<T>(
      value: options.contains(value) ? value : options.first,
      dropdownColor: _panel2,
      style: const TextStyle(color: Colors.white, fontSize: 11),
      items: options.map((v) => DropdownMenuItem(value: v, child: Text('$label: ${v.replaceAll('_', ' ')}'))).toList(),
      onChanged: (v) { if (v != null) changed(v); },
    )),
  );

  Widget _pagination(Map<String, dynamic> data) {
    final totalPages = _number(data['totalPages']).toInt();
    if (totalPages <= 1) return const SizedBox.shrink();
    return Row(mainAxisAlignment: MainAxisAlignment.end, children: [
      Text('Page ${data['page'] ?? _page} of $totalPages', style: const TextStyle(color: _muted, fontSize: 11)),
      IconButton(
        tooltip: 'Previous page',
        onPressed: _page <= 1 ? null : () { setState(() => _page--); _load(); },
        icon: const Icon(Icons.chevron_left, color: _green),
      ),
      IconButton(
        tooltip: 'Next page',
        onPressed: _page >= totalPages ? null : () { setState(() => _page++); _load(); },
        icon: const Icon(Icons.chevron_right, color: _green),
      ),
    ]);
  }

  Widget _statusChip(String status) {
    final success = status.toUpperCase() == 'SUCCESSFUL';
    final color = success ? _green : status.toUpperCase() == 'FAILED' ? const Color(0xFFEAA38D) : const Color(0xFFE6C875);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 5),
      decoration: BoxDecoration(color: color.withValues(alpha: .12), borderRadius: BorderRadius.circular(20)),
      child: Text(status.toUpperCase(), style: TextStyle(color: color, fontSize: 9, fontWeight: FontWeight.w700)),
    );
  }

  Widget _smallMetric(String label, String value) => SizedBox(
    width: 170, child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Text(value, style: const TextStyle(color: Colors.white, fontSize: 21, fontWeight: FontWeight.w800)),
      Text(label, style: const TextStyle(color: _muted, fontSize: 11)),
    ]),
  );

  Widget _panelCard({required String title, required String subtitle, required Widget child, Widget? trailing}) => Container(
    padding: const EdgeInsets.all(17),
    decoration: BoxDecoration(color: _panel, borderRadius: BorderRadius.circular(16), border: Border.all(color: Colors.white10)),
    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Row(children: [
        Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(title, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w800, fontSize: 14)),
          const SizedBox(height: 4),
          Text(subtitle, style: const TextStyle(color: _muted, fontSize: 10, height: 1.4)),
        ])),
        if (trailing != null) trailing,
      ]),
      const SizedBox(height: 15),
      child,
    ]),
  );

  Widget _empty(String message) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 30, horizontal: 8),
    child: Center(child: Column(children: [
      const Icon(Icons.inbox_outlined, color: _muted, size: 30),
      const SizedBox(height: 9),
      Text(message, textAlign: TextAlign.center, style: const TextStyle(color: _muted, fontSize: 12)),
    ])),
  );

  Widget _inlineError() => Container(
    margin: const EdgeInsets.only(bottom: 14),
    padding: const EdgeInsets.all(12),
    decoration: BoxDecoration(color: const Color(0xFF5B332C), borderRadius: BorderRadius.circular(10)),
    child: Row(children: [
      const Icon(Icons.warning_amber_rounded, color: Color(0xFFFFC5A9), size: 19),
      const SizedBox(width: 8),
      Expanded(child: Text(_error!, style: const TextStyle(color: Colors.white, fontSize: 12))),
      TextButton(onPressed: _load, child: const Text('Retry')),
    ]),
  );

  Widget _errorView() => Center(child: Padding(
    padding: const EdgeInsets.all(28),
    child: Column(mainAxisSize: MainAxisSize.min, children: [
      const Icon(Icons.cloud_off_outlined, color: _muted, size: 40),
      const SizedBox(height: 12),
      Text(_error ?? 'Unable to load data', textAlign: TextAlign.center, style: const TextStyle(color: Colors.white)),
      const SizedBox(height: 12),
      FilledButton.icon(onPressed: _load, icon: const Icon(Icons.refresh), label: const Text('Retry')),
    ]),
  ));

  Widget _skeleton() => ListView(padding: const EdgeInsets.all(22), children: [
    for (int i = 0; i < 5; i++) Container(
      height: i == 0 ? 104 : 155,
      margin: const EdgeInsets.only(bottom: 12),
      decoration: BoxDecoration(color: _panel, borderRadius: BorderRadius.circular(15)),
    ),
  ]);

  Widget _tableSkeleton() => Column(children: [
    for (int i = 0; i < 5; i++) Container(
      height: 53, margin: const EdgeInsets.only(bottom: 7),
      decoration: BoxDecoration(color: _panel, borderRadius: BorderRadius.circular(9)),
    ),
  ]);
}

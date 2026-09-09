import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';
import 'package:url_launcher/url_launcher.dart';

import 'admin_permissions.dart';

class AdminExecutiveDashboardScreen extends StatefulWidget {
  const AdminExecutiveDashboardScreen({
    super.key,
    this.onOpenModule,
    this.dashboardLoader,
    this.initialAccess,
  });

  final ValueChanged<String>? onOpenModule;
  final Future<Map<String, dynamic>> Function(String range)? dashboardLoader;
  final AdminAccess? initialAccess;

  @override
  State<AdminExecutiveDashboardScreen> createState() =>
      _AdminExecutiveDashboardScreenState();
}

class _AdminExecutiveDashboardScreenState
    extends State<AdminExecutiveDashboardScreen> {
  static const _baseUrl = 'https://api.servicepay.ng/api';
  static const _ink = Color(0xFF12362A);
  static const _green = Color(0xFF08783E);
  static const _surface = Color(0xFFF4F7F5);

  Map<String, dynamic> _data = <String, dynamic>{};
  AdminAccess _access = const AdminAccess(role: '', permissions: <String>{});
  String _range = 'today';
  DateTimeRange? _customRange;
  String _chartMeasure = 'count';
  Map<String, dynamic>? _selectedChartPoint;
  String? _error;
  DateTime? _lastUpdated;
  Future<void>? _activeLoad;
  bool _isLoading = true;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _refresh(showErrorState: true);
    });
  }

  Map<String, dynamic> _map(dynamic value) {
    if (value is Map<String, dynamic>) return value;
    if (value is Map) return Map<String, dynamic>.from(value);
    return <String, dynamic>{};
  }

  List<dynamic> _list(dynamic value) => value is List ? value : <dynamic>[];

  int? _int(dynamic value) {
    if (value is num) return value.toInt();
    return int.tryParse(value?.toString() ?? '');
  }

  double? _double(dynamic value) {
    if (value is num) return value.toDouble();
    return double.tryParse(value?.toString() ?? '');
  }

  dynamic _metricValue(String key, {String group = 'kpis'}) {
    final metric = _map(_map(_data[group])[key]);
    return metric['available'] == true ? metric['value'] : null;
  }

  bool _can(String permission) => _access.has(permission);

  Future<void> _loadDashboard(String requestedRange) async {
    if (widget.dashboardLoader != null) {
      final data = await widget.dashboardLoader!(requestedRange);
      if (data.isEmpty) {
        throw Exception('The executive dashboard returned no data.');
      }
      if (!mounted || requestedRange != _range) return;
      setState(() {
        _access = widget.initialAccess ??
            const AdminAccess(role: '', permissions: <String>{});
        _data = data;
        _error = null;
        _isLoading = false;
        _lastUpdated = DateTime.tryParse(data['generatedAt']?.toString() ?? '');
      });
      return;
    }

    final prefs = await SharedPreferences.getInstance();
    final access = await AdminSessionStore.loadAccess();
    final token = (prefs.getString('auth_token') ??
            prefs.getString('token') ??
            prefs.getString('admin_token') ??
            '')
        .replaceFirst(RegExp(r'^Bearer\s+', caseSensitive: false), '')
        .trim();

    if (token.isEmpty) {
      throw Exception(
          'Your login session was not found. Please sign in again.');
    }

    final customParts = requestedRange.startsWith('custom:')
        ? requestedRange.split(':')
        : const <String>[];
    final query = customParts.length == 3
        ? <String, String>{
            'startDate': '${customParts[1]}T00:00:00+01:00',
            'endDate': '${customParts[2]}T23:59:59.999+01:00',
          }
        : <String, String>{'range': requestedRange};
    final response = await http.get(
      Uri.parse('$_baseUrl/admin/dashboard/executive').replace(
        queryParameters: query,
      ),
      headers: <String, String>{
        'Accept': 'application/json',
        'Authorization': 'Bearer $token',
      },
    ).timeout(const Duration(seconds: 12));

    dynamic decoded;
    try {
      decoded = jsonDecode(response.body);
    } catch (_) {}
    final body = _map(decoded);
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw Exception('Unable to load the executive dashboard right now.');
    }

    final data = _map(body['data']);
    if (body['success'] != true || data.isEmpty) {
      throw Exception('The executive dashboard returned no data.');
    }

    if (!mounted || requestedRange != _range) return;
    setState(() {
      _access = access;
      _data = data;
      _error = null;
      _isLoading = false;
      _lastUpdated = DateTime.tryParse(data['generatedAt']?.toString() ?? '');
    });
  }

  Future<void> _refresh({bool showErrorState = false}) async {
    if (_activeLoad != null) return _activeLoad!;
    if (mounted) {
      setState(() {
        if (showErrorState) _error = null;
      });
    }

    final load = _loadDashboard(_range);
    _activeLoad = load;
    try {
      await load;
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _error = error.toString().replaceFirst('Exception: ', '').trim();
        _isLoading = false;
      });
    } finally {
      if (identical(_activeLoad, load)) _activeLoad = null;
    }
  }

  Future<void> _changeRange(String range) async {
    if (_range == range) return;
    setState(() => _range = range);
    final previous = _activeLoad;
    if (previous != null) {
      try {
        await previous;
      } catch (_) {}
    }
    await _refresh(showErrorState: true);
  }

  Future<void> _selectCustomRange() async {
    final now = DateTime.now();
    final selected = await showDateRangePicker(
      context: context,
      firstDate: DateTime(now.year - 3),
      lastDate: now,
      initialDateRange: _customRange ??
          DateTimeRange(start: now.subtract(const Duration(days: 6)), end: now),
      helpText: 'Select executive reporting period',
    );
    if (selected == null || !mounted) return;
    final start = _dateKey(selected.start);
    final end = _dateKey(selected.end);
    setState(() => _customRange = selected);
    await _changeRange('custom:$start:$end');
  }

  String _dateKey(DateTime value) =>
      '${value.year.toString().padLeft(4, '0')}-${value.month.toString().padLeft(2, '0')}-${value.day.toString().padLeft(2, '0')}';

  String _money(dynamic value) {
    final amount = _double(value);
    if (amount == null) return 'Not available';
    final fixed = amount.toStringAsFixed(2);
    final pieces = fixed.split('.');
    final whole = pieces.first.replaceAllMapped(
      RegExp(r'\B(?=(\d{3})+(?!\d))'),
      (_) => ',',
    );
    return '₦$whole.${pieces.last}';
  }

  String _count(String key) {
    final value = _int(_metricValue(key));
    return value?.toString() ?? 'Not available';
  }

  String _comparison(String key) {
    final value = _double(_map(_data['comparisons'])[key]);
    if (value == null) return '';
    final direction = value >= 0 ? '↑' : '↓';
    return '$direction ${value.abs().toStringAsFixed(1)}% vs previous period';
  }

  String get _periodLabel {
    if (_range == 'today') return 'Today’s';
    if (_range == '7d') return '7-day';
    if (_range == '30d') return '30-day';
    return 'Selected period';
  }

  Future<void> _downloadCsv() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final token = (prefs.getString('auth_token') ??
              prefs.getString('token') ??
              prefs.getString('admin_token') ??
              '')
          .replaceFirst(RegExp(r'^Bearer\s+', caseSensitive: false), '')
          .trim();
      if (token.isEmpty) throw Exception('Your login session was not found.');
      final customParts =
          _range.startsWith('custom:') ? _range.split(':') : const <String>[];
      final query = customParts.length == 3
          ? <String, String>{
              'format': 'csv',
              'startDate': '${customParts[1]}T00:00:00+01:00',
              'endDate': '${customParts[2]}T23:59:59.999+01:00',
            }
          : <String, String>{'format': 'csv', 'range': _range};
      final response = await http.get(
        Uri.parse('$_baseUrl/admin/dashboard/executive/export')
            .replace(queryParameters: query),
        headers: <String, String>{
          'Accept': 'text/csv',
          'Authorization': 'Bearer $token',
        },
      ).timeout(const Duration(seconds: 30));
      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw Exception('The CSV report could not be downloaded.');
      }
      final report = Uri.dataFromBytes(
        response.bodyBytes,
        mimeType: 'text/csv',
      );
      if (!await launchUrl(report, webOnlyWindowName: '_blank')) {
        throw Exception('The browser could not open the CSV report.');
      }
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('CSV report downloaded.')),
        );
      }
    } catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(error.toString().replaceFirst('Exception: ', '')),
        ),
      );
    }
  }

  String _time(dynamic value) {
    final date = DateTime.tryParse(value?.toString() ?? '')?.toLocal();
    if (date == null) return 'Unknown time';
    final hour = date.hour.toString().padLeft(2, '0');
    final minute = date.minute.toString().padLeft(2, '0');
    return '${date.day}/${date.month}/${date.year} $hour:$minute';
  }

  void _open(String module) {
    widget.onOpenModule?.call(module);
  }

  @override
  Widget build(BuildContext context) {
    final hasData = _data.isNotEmpty;
    return Scaffold(
      backgroundColor: _surface,
      body: RefreshIndicator(
        color: _green,
        onRefresh: () => _refresh(showErrorState: true),
        child: !hasData && _isLoading
            ? _loadingView()
            : !hasData && _error != null
                ? _errorView()
                : _dashboardView(),
      ),
    );
  }

  Widget _loadingView() {
    return ListView(
      physics: const AlwaysScrollableScrollPhysics(),
      padding: const EdgeInsets.all(20),
      children: [
        _header(skeleton: true),
        const SizedBox(height: 20),
        Wrap(
          spacing: 14,
          runSpacing: 14,
          children: List<Widget>.generate(
            8,
            (_) => Container(
              width: 220,
              height: 106,
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(18),
              ),
            ),
          ),
        ),
        const SizedBox(height: 18),
        const LinearProgressIndicator(color: _green),
      ],
    );
  }

  Widget _errorView() {
    return ListView(
      physics: const AlwaysScrollableScrollPhysics(),
      padding: const EdgeInsets.all(20),
      children: [
        _header(),
        const SizedBox(height: 40),
        _panel(
          child: Column(
            children: [
              const Icon(Icons.cloud_off_rounded, size: 52, color: Colors.red),
              const SizedBox(height: 14),
              const Text(
                'Executive dashboard unavailable',
                style: TextStyle(fontSize: 20, fontWeight: FontWeight.w800),
              ),
              const SizedBox(height: 8),
              Text(
                _error ?? 'The dashboard could not be loaded.',
                textAlign: TextAlign.center,
                style: TextStyle(color: Colors.grey.shade700),
              ),
              const SizedBox(height: 18),
              FilledButton.icon(
                onPressed: () => _refresh(showErrorState: true),
                icon: const Icon(Icons.refresh),
                label: const Text('Try again'),
                style: FilledButton.styleFrom(backgroundColor: _green),
              ),
            ],
          ),
        ),
      ],
    );
  }

  Widget _dashboardView() {
    return LayoutBuilder(
      builder: (context, constraints) => ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(20, 18, 20, 36),
        children: [
          _header(),
          if (_error != null) ...[
            const SizedBox(height: 12),
            _notice(_error!, Icons.warning_amber_rounded, Colors.orange),
          ],
          const SizedBox(height: 18),
          _sectionTitle('Executive overview', 'Real-time server aggregates'),
          const SizedBox(height: 10),
          _kpiGrid(constraints.maxWidth),
          const SizedBox(height: 22),
          _twoColumn(
            constraints.maxWidth,
            _operationsPanel(),
            _attentionPanel(),
          ),
          const SizedBox(height: 18),
          _twoColumn(
            constraints.maxWidth,
            _performancePanel(),
            _productPerformancePanel(),
          ),
          const SizedBox(height: 18),
          _twoColumn(
            constraints.maxWidth,
            _branchPerformancePanel(),
            _targetsPanel(),
          ),
          const SizedBox(height: 18),
          _twoColumn(
            constraints.maxWidth,
            _healthPanel(),
            _activityPanel(),
          ),
          const SizedBox(height: 18),
          _twoColumn(
            constraints.maxWidth,
            _quickActionsPanel(),
            _configurationAndExportsPanel(),
          ),
        ],
      ),
    );
  }

  Widget _header({bool skeleton = false}) {
    return Container(
      padding: const EdgeInsets.all(22),
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          colors: [Color(0xFF0B6B3A), Color(0xFF12362A)],
        ),
        borderRadius: BorderRadius.circular(22),
        boxShadow: const [
          BoxShadow(
            color: Color(0x220B6B3A),
            blurRadius: 20,
            offset: Offset(0, 8),
          ),
        ],
      ),
      child: LayoutBuilder(
        builder: (context, constraints) {
          final intro = ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 560),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'Executive Command Center',
                  style: TextStyle(
                    color: Colors.white,
                    fontSize: 26,
                    fontWeight: FontWeight.w900,
                  ),
                ),
                const SizedBox(height: 7),
                Text(
                  skeleton
                      ? 'Loading real operational and financial health…'
                      : 'A safe, permission-aware view of ServicePay operations.',
                  style: const TextStyle(
                    color: Color(0xFFD5F0DE),
                    height: 1.4,
                  ),
                ),
                if (!skeleton && _lastUpdated != null) ...[
                  const SizedBox(height: 10),
                  Text(
                    'Last updated: ${_time(_lastUpdated)}',
                    style: const TextStyle(
                      color: Color(0xFFB7D9C2),
                      fontSize: 12,
                    ),
                  ),
                ],
              ],
            ),
          );
          final controls = skeleton
              ? const SizedBox.shrink()
              : Wrap(
                  spacing: 10,
                  runSpacing: 10,
                  crossAxisAlignment: WrapCrossAlignment.center,
                  children: [
                    _rangeSelector(),
                    OutlinedButton.icon(
                      key: const Key('admin-executive-custom-range'),
                      onPressed:
                          _activeLoad == null ? _selectCustomRange : null,
                      icon: const Icon(Icons.date_range_outlined, size: 17),
                      label: Text(
                          _customRange == null ? 'Custom' : 'Custom range'),
                      style: OutlinedButton.styleFrom(
                        foregroundColor: Colors.white,
                        side: const BorderSide(color: Color(0xFFB7D9C2)),
                      ),
                    ),
                    IconButton.filled(
                      key: const Key('admin-executive-refresh'),
                      tooltip: 'Refresh dashboard',
                      onPressed: _activeLoad != null
                          ? null
                          : () => _refresh(showErrorState: true),
                      style: IconButton.styleFrom(
                        backgroundColor: Colors.white,
                        foregroundColor: _green,
                      ),
                      icon: const Icon(Icons.refresh_rounded),
                    ),
                  ],
                );
          if (constraints.maxWidth < 720) {
            return Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                intro,
                if (!skeleton) ...[
                  const SizedBox(height: 18),
                  controls,
                ],
              ],
            );
          }
          return Row(
            crossAxisAlignment: CrossAxisAlignment.center,
            children: [
              Expanded(child: intro),
              if (!skeleton) ...[
                const SizedBox(width: 18),
                controls,
              ],
            ],
          );
        },
      ),
    );
  }

  Widget _rangeSelector() {
    return Container(
      padding: const EdgeInsets.all(4),
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: .12),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          for (final option in const [
            ('today', 'Today'),
            ('7d', '7 Days'),
            ('30d', '30 Days'),
          ])
            InkWell(
              onTap: () => _changeRange(option.$1),
              borderRadius: BorderRadius.circular(9),
              child: AnimatedContainer(
                duration: const Duration(milliseconds: 160),
                padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 8),
                decoration: BoxDecoration(
                  color:
                      _range == option.$1 ? Colors.white : Colors.transparent,
                  borderRadius: BorderRadius.circular(9),
                ),
                child: Text(
                  option.$2,
                  style: TextStyle(
                    color:
                        _range == option.$1 ? _green : const Color(0xFFE0F4E5),
                    fontSize: 12,
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }

  Widget _kpiGrid(double width) {
    final columns = width >= 1200
        ? 4
        : width >= 760
            ? 3
            : width >= 500
                ? 2
                : 1;
    final cards = <Widget>[
      _kpiCard('Total Customers', _count('totalCustomers'),
          Icons.people_alt_outlined, const Color(0xFF2563EB)),
      _kpiCard('Active Customers', _count('activeCustomers'),
          Icons.verified_user_outlined, const Color(0xFF0F9D67)),
      _kpiCard(
          'Total Customer Wallet Balance',
          _money(_metricValue('totalWalletBalance')),
          Icons.account_balance_wallet_outlined,
          const Color(0xFFB56B00)),
      _kpiCard(
          '$_periodLabel Transaction Volume',
          _count('todayTransactionVolume'),
          Icons.receipt_long_outlined,
          const Color(0xFF7C3AED),
          comparison: _comparison('transactionVolume')),
      _kpiCard(
          '$_periodLabel Transaction Value',
          _money(_metricValue('todayTransactionValue')),
          Icons.payments_outlined,
          const Color(0xFF8B5CF6),
          comparison: _comparison('transactionValue')),
      _kpiCard('Successful Transactions', _count('successfulTransactions'),
          Icons.check_circle_outline, const Color(0xFF16803C),
          comparison: _comparison('successfulTransactions')),
      _kpiCard('Pending Transactions', _count('pendingTransactions'),
          Icons.schedule_outlined, const Color(0xFFD97706)),
      _kpiCard('Failed Transactions', _count('failedTransactions'),
          Icons.error_outline, const Color(0xFFB42318)),
      _kpiCard('Pending Withdrawals', _displayMetric('pendingWithdrawals'),
          Icons.outbox_outlined, const Color(0xFFB45309)),
      _kpiCard('Pending KYC Reviews', _count('pendingKycReviews'),
          Icons.badge_outlined, const Color(0xFFBE185D)),
      _kpiCard('Active Riders', _count('activeRiders'),
          Icons.delivery_dining_outlined, const Color(0xFF0E7490)),
      _kpiCard(
          'Pending Solar Applications',
          _displayMetric('pendingSolarApplications'),
          Icons.solar_power_outlined,
          const Color(0xFF4D7C0F)),
      _kpiCard('Total Agents / Aggregators', _count('totalAgentsAggregators'),
          Icons.groups_2_outlined, const Color(0xFF0F766E)),
      _kpiCard('Total Managers', _count('totalManagers'),
          Icons.supervisor_account_outlined, const Color(0xFF0369A1)),
      _kpiCard('Total Branch Managers', _count('totalBranchManagers'),
          Icons.manage_accounts_outlined, const Color(0xFF6D28D9)),
      _kpiCard('Total Branches', _count('totalBranches'),
          Icons.account_tree_outlined, const Color(0xFFC2410C)),
    ];
    return GridView.count(
      crossAxisCount: columns,
      crossAxisSpacing: 12,
      mainAxisSpacing: 12,
      childAspectRatio: width < 500 ? 2.3 : 2,
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      children: cards,
    );
  }

  String _displayMetric(String key) {
    return _metricValue(key) == null
        ? 'Not available'
        : _metricValue(key).toString();
  }

  Widget _kpiCard(
    String title,
    String value,
    IconData icon,
    Color color, {
    String comparison = '',
  }) {
    final unavailable = value == 'Not available';
    return Container(
      padding: const EdgeInsets.all(15),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: const Color(0xFFE1EAE5)),
        boxShadow: const [
          BoxShadow(
            color: Color(0x0D12362A),
            blurRadius: 12,
            offset: Offset(0, 5),
          ),
        ],
      ),
      child: Row(
        children: [
          Container(
            width: 43,
            height: 43,
            decoration: BoxDecoration(
              color: color.withValues(alpha: .12),
              borderRadius: BorderRadius.circular(13),
            ),
            child: Icon(icon, color: color, size: 22),
          ),
          const SizedBox(width: 11),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Text(
                  value,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    color: unavailable ? Colors.grey.shade500 : _ink,
                    fontSize: unavailable ? 13 : 19,
                    fontWeight: FontWeight.w900,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  title,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(color: Colors.grey.shade600, fontSize: 11),
                ),
                if (comparison.isNotEmpty) ...[
                  const SizedBox(height: 3),
                  Text(
                    comparison,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      color: comparison.startsWith('↓')
                          ? Colors.red.shade700
                          : _green,
                      fontSize: 10,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _twoColumn(double width, Widget first, Widget second) {
    if (width < 850) {
      return Column(
        children: [first, const SizedBox(height: 18), second],
      );
    }
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Expanded(child: first),
        const SizedBox(width: 18),
        Expanded(child: second),
      ],
    );
  }

  Widget _operationsPanel() {
    final operations = <Map<String, dynamic>>[
      {
        'key': 'transactionsToday',
        'title': '$_periodLabel Transactions',
        'icon': Icons.receipt_long_outlined
      },
      {
        'key': 'transfers',
        'title': 'Transfers',
        'icon': Icons.swap_horiz_rounded
      },
      {
        'key': 'withdrawals',
        'title': 'Withdrawals',
        'icon': Icons.outbox_outlined
      },
      {
        'key': 'airtime',
        'title': 'Airtime',
        'icon': Icons.phone_android_outlined
      },
      {'key': 'data', 'title': 'Data', 'icon': Icons.wifi_outlined},
      {
        'key': 'electricity',
        'title': 'Electricity',
        'icon': Icons.electric_bolt_outlined
      },
      {
        'key': 'delivery',
        'title': 'Delivery',
        'icon': Icons.local_shipping_outlined
      },
      {
        'key': 'marketplace',
        'title': 'Marketplace',
        'icon': Icons.storefront_outlined
      },
      {'key': 'solar', 'title': 'Solar', 'icon': Icons.solar_power_outlined},
    ];
    return _panel(
      title: 'Live Operations Overview',
      subtitle: 'Open an existing module for the underlying records.',
      child: Wrap(
        spacing: 8,
        runSpacing: 8,
        children: operations.map((item) {
          final metric = _map(_map(_data['operations'])[item['key']]);
          final available = metric['available'] == true;
          final value = available
              ? _int(metric['value'])?.toString() ?? _money(metric['value'])
              : 'Unavailable';
          final module = _operationModule(item['key']?.toString() ?? '');
          return InkWell(
            onTap: available && module != null ? () => _open(module) : null,
            borderRadius: BorderRadius.circular(13),
            child: Container(
              width: 145,
              padding: const EdgeInsets.all(11),
              decoration: BoxDecoration(
                color:
                    available ? const Color(0xFFF2F8F4) : Colors.grey.shade100,
                borderRadius: BorderRadius.circular(13),
                border: Border.all(
                  color: available
                      ? const Color(0xFFD6EBDD)
                      : Colors.grey.shade200,
                ),
              ),
              child: Row(
                children: [
                  Icon(
                    item['icon'] as IconData,
                    size: 19,
                    color: available ? _green : Colors.grey.shade500,
                  ),
                  const SizedBox(width: 7),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          item['title']?.toString() ?? '',
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            fontSize: 11,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                        const SizedBox(height: 3),
                        Text(
                          value,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(
                            color: available ? _ink : Colors.grey.shade500,
                            fontWeight: FontWeight.w900,
                            fontSize: 12,
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          );
        }).toList(),
      ),
    );
  }

  String? _operationModule(String key) {
    switch (key) {
      case 'transactionsToday':
      case 'transfers':
      case 'airtime':
      case 'data':
      case 'electricity':
        return 'transactions';
      case 'delivery':
        return 'delivery';
      case 'withdrawals':
        return _can(AdminPermissions.withdrawalsView) ? 'withdrawals' : null;
      case 'solar':
        return _can(AdminPermissions.solarView) ? 'solar' : null;
      default:
        return null;
    }
  }

  Widget _performancePanel() {
    final series =
        _list(_map(_data['performance'])['series']).map(_map).toList();
    final selected = _selectedChartPoint;
    return _panel(
      title: 'Transaction Performance',
      subtitle:
          'Counts, values, and statuses from the selected reporting period.',
      child: series.isEmpty
          ? _empty('No transaction activity in this period.')
          : Column(children: [
              Wrap(
                spacing: 6,
                runSpacing: 6,
                children: [
                  for (final option in const [
                    ('count', 'Count'),
                    ('value', 'Value'),
                    ('status', 'Status')
                  ])
                    ChoiceChip(
                      label: Text(option.$2),
                      selected: _chartMeasure == option.$1,
                      onSelected: (_) => setState(() {
                        _chartMeasure = option.$1;
                        _selectedChartPoint = null;
                      }),
                    ),
                ],
              ),
              if (selected != null) ...[
                const SizedBox(height: 8),
                _chartTooltip(selected),
              ],
              const SizedBox(height: 8),
              SizedBox(
                height: 190,
                child: LayoutBuilder(builder: (context, constraints) {
                  return GestureDetector(
                    behavior: HitTestBehavior.opaque,
                    onTapUp: (details) {
                      if (constraints.maxWidth <= 0) return;
                      final index = (details.localPosition.dx /
                              constraints.maxWidth *
                              series.length)
                          .floor()
                          .clamp(0, series.length - 1);
                      setState(() => _selectedChartPoint = series[index]);
                    },
                    child: CustomPaint(
                      painter: _PerformancePainter(series, _chartMeasure),
                      child: const SizedBox.expand(),
                    ),
                  );
                }),
              ),
              const SizedBox(height: 8),
              const Wrap(spacing: 14, children: [
                _LegendDot(color: _green, label: 'Successful'),
                _LegendDot(color: Color(0xFFD97706), label: 'Pending'),
                _LegendDot(color: Color(0xFFB42318), label: 'Failed'),
              ]),
            ]),
    );
  }

  Widget _chartTooltip(Map<String, dynamic> item) {
    final value = _chartMeasure == 'value' ? _money(item['value']) : null;
    return Semantics(
      label: 'Chart details',
      child: Container(
        width: double.infinity,
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 7),
        decoration: BoxDecoration(
          color: const Color(0xFFF2F8F4),
          borderRadius: BorderRadius.circular(9),
        ),
        child: Text(
          '${item['date'] ?? 'Selected period'} • Successful ${_int(item['successful']) ?? 0}, '
          'Pending ${_int(item['pending']) ?? 0}, Failed ${_int(item['failed']) ?? 0}'
          '${value == null ? '' : ' • $value'}',
          style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w700),
        ),
      ),
    );
  }

  Widget _productPerformancePanel() {
    final products = _list(_data['products']).map(_map).toList();
    return _rankingPanel(
      title: 'Product Performance',
      subtitle: 'Products included by the server for your access scope.',
      entries: products,
      emptyText: 'No product performance is available for this role.',
      nameKeys: const ['name', 'product', 'label'],
    );
  }

  Widget _branchPerformancePanel() {
    final branches = _list(_data['branches']).map(_map).toList();
    return _rankingPanel(
      title: 'Branch Performance',
      subtitle: 'Branch results included by the server for your access scope.',
      entries: branches,
      emptyText: 'No branch performance is available for this role.',
      nameKeys: const ['name', 'branch', 'label'],
    );
  }

  Widget _rankingPanel({
    required String title,
    required String subtitle,
    required List<Map<String, dynamic>> entries,
    required String emptyText,
    required List<String> nameKeys,
  }) {
    return _panel(
      title: title,
      subtitle: subtitle,
      child: entries.isEmpty
          ? _empty(emptyText)
          : Column(
              children: entries.take(6).map((item) {
              final name = nameKeys
                  .map((key) => item[key]?.toString())
                  .firstWhere((value) => value != null && value.isNotEmpty,
                      orElse: () => 'Unnamed');
              final count = _int(item['count'] ?? item['transactions']);
              final amount = _double(item['value'] ?? item['amount']);
              final successful = _int(item['successful']);
              final pending = _int(item['pending']);
              final failed = _int(item['failed']);
              final status = successful == null &&
                      pending == null &&
                      failed == null
                  ? null
                  : 'Successful ${successful ?? 0} • Pending ${pending ?? 0} • Failed ${failed ?? 0}';
              return ListTile(
                dense: true,
                contentPadding: EdgeInsets.zero,
                title: Text(name ?? 'Unnamed',
                    style: const TextStyle(fontWeight: FontWeight.w700)),
                subtitle: status == null ? null : Text(status),
                trailing: Text(
                  amount != null
                      ? _money(amount)
                      : count?.toString() ?? 'Not available',
                  style: const TextStyle(
                      fontWeight: FontWeight.w800, fontSize: 12),
                ),
              );
            }).toList()),
    );
  }

  Widget _targetsPanel() {
    final targets = _list(_data['targets']).map(_map).toList();
    return _panel(
      title: 'Targets & Progress',
      subtitle: 'Progress against targets supplied for this reporting period.',
      child: targets.isEmpty
          ? _empty('No targets are available for this role.')
          : Column(
              children: targets.take(6).map((item) {
              final actual = _double(item['actual'] ?? item['value']);
              final target = _double(item['target']);
              final progress = _double(item['progress']) ??
                  (actual != null && target != null && target > 0
                      ? actual / target
                      : null);
              final label = item['name'] ?? item['label'] ?? 'Target';
              return Padding(
                padding: const EdgeInsets.only(bottom: 12),
                child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(children: [
                        Expanded(
                            child: Text('$label',
                                style: const TextStyle(
                                    fontWeight: FontWeight.w700))),
                        Text(
                            progress == null
                                ? 'Not available'
                                : '${(progress * 100).clamp(0, 999).toStringAsFixed(0)}%',
                            style:
                                const TextStyle(fontWeight: FontWeight.w800)),
                      ]),
                      const SizedBox(height: 5),
                      LinearProgressIndicator(
                        value: progress?.clamp(0, 1).toDouble(),
                        color: _green,
                      ),
                    ]),
              );
            }).toList()),
    );
  }

  Widget _attentionPanel() {
    final attention = _map(_data['attention']);
    final items = <Map<String, dynamic>>[
      {
        'key': 'pendingKyc',
        'label': 'Pending KYC reviews',
        'module': 'kyc',
        'permission': AdminPermissions.kycView
      },
      {
        'key': 'pendingWithdrawals',
        'label': 'Pending withdrawals',
        'module': 'withdrawals',
        'permission': AdminPermissions.withdrawalsView
      },
      {
        'key': 'failedTransactions',
        'label': 'Failed transactions',
        'module': 'transactions',
        'permission': AdminPermissions.transactionsView
      },
      {
        'key': 'pendingDeliveries',
        'label': 'Pending delivery assignments',
        'module': 'delivery',
        'permission': AdminPermissions.deliveryView
      },
      {
        'key': 'unresolvedSupport',
        'label': 'Unresolved support tickets',
        'module': 'support',
        'permission': AdminPermissions.supportView
      },
      {
        'key': 'pendingSolar',
        'label': 'Pending Solar applications',
        'module': 'solar',
        'permission': AdminPermissions.solarView
      },
    ];
    final visible = items.where((item) {
      final value = _int(attention[item['key']]);
      return value != null && value > 0 && _can(item['permission'] as String);
    }).toList();
    return _panel(
      title: 'Attention Required',
      subtitle: 'Unresolved items available to your role.',
      child: visible.isEmpty
          ? _empty('No actionable attention items are currently available.')
          : Column(
              children: visible.map((item) {
                final value = _int(attention[item['key']]) ?? 0;
                return ListTile(
                  contentPadding: EdgeInsets.zero,
                  leading: const CircleAvatar(
                    backgroundColor: Color(0xFFFFF3E0),
                    child: Icon(Icons.priority_high_rounded,
                        color: Color(0xFFD97706)),
                  ),
                  title: Text(
                    item['label'] as String,
                    style: const TextStyle(fontWeight: FontWeight.w700),
                  ),
                  trailing: FilledButton.tonal(
                    onPressed: () => _open(item['module'] as String),
                    child: Text('Review $value'),
                  ),
                );
              }).toList(),
            ),
    );
  }

  Widget _healthPanel() {
    final health = _map(_data['health']);
    final items = <Map<String, dynamic>>[
      {'key': 'backend', 'label': 'Backend / API'},
      {'key': 'database', 'label': 'Database'},
      {'key': 'authentication', 'label': 'Authentication'},
      {'key': 'email', 'label': 'Email Service'},
      {'key': 'providers', 'label': 'Payment / Service Providers'},
    ];
    return _panel(
      title: 'System Health',
      subtitle: 'Only services checked by this request are marked operational.',
      child: Column(
        children: items.map((item) {
          final metric = _map(health[item['key']]);
          final available = metric['available'] == true;
          final status = available
              ? metric['value']?.toString() ?? 'Operational'
              : 'Not checked';
          final color = available ? _green : Colors.grey.shade600;
          return ListTile(
            dense: true,
            contentPadding: EdgeInsets.zero,
            leading: Icon(
              available ? Icons.check_circle_outline : Icons.help_outline,
              color: color,
            ),
            title: Text(
              item['label'] as String,
              style: const TextStyle(fontWeight: FontWeight.w700),
            ),
            subtitle: !available
                ? Text(metric['reason']?.toString() ??
                    'No health check available.')
                : null,
            trailing: Text(
              status,
              style: TextStyle(color: color, fontWeight: FontWeight.w800),
            ),
          );
        }).toList(),
      ),
    );
  }

  Widget _activityPanel() {
    final activity = _list(_data['activity']).map(_map).toList();
    return _panel(
      title: 'Recent Critical Activity',
      subtitle:
          'Safe operational activity; sensitive credentials and identity data are excluded.',
      child: activity.isEmpty
          ? _empty('No recent activity is available for this role.')
          : Column(
              children: activity.map((item) {
                final status = item['status']?.toString() ?? '';
                return ListTile(
                  contentPadding: EdgeInsets.zero,
                  leading: CircleAvatar(
                    backgroundColor: const Color(0xFFE8F5F1),
                    child: Icon(
                      status == 'FAILED'
                          ? Icons.error_outline
                          : Icons.receipt_long_outlined,
                      color: status == 'FAILED' ? Colors.red : _green,
                      size: 19,
                    ),
                  ),
                  title: Text(
                    '${item['action'] ?? 'Activity'} • ${item['service'] ?? 'Service'}',
                    style: const TextStyle(
                        fontWeight: FontWeight.w700, fontSize: 13),
                  ),
                  subtitle: Text(
                    '${item['target'] ?? 'Reference unavailable'} • ${_time(item['time'])}',
                  ),
                  trailing: Text(
                    _money(item['amount']),
                    style: const TextStyle(
                        fontWeight: FontWeight.w800, fontSize: 12),
                  ),
                );
              }).toList(),
            ),
    );
  }

  Widget _quickActionsPanel() {
    final actions = <Map<String, String>>[
      {
        'label': 'Review KYC',
        'permission': AdminPermissions.kycView,
        'module': 'kyc'
      },
      {
        'label': 'Review Withdrawals',
        'permission': AdminPermissions.withdrawalsView,
        'module': 'withdrawals'
      },
      {
        'label': 'Find Customer',
        'permission': AdminPermissions.customer360View,
        'module': 'customer360'
      },
      {
        'label': 'View Transactions',
        'permission': AdminPermissions.transactionsView,
        'module': 'transactions'
      },
      {
        'label': 'Support Tickets',
        'permission': AdminPermissions.supportView,
        'module': 'support'
      },
      {
        'label': 'Send Customer Email',
        'permission': AdminPermissions.emailCampaignCreate,
        'module': 'email'
      },
      {
        'label': 'Fintech Control Center',
        'permission': AdminPermissions.dashboardView,
        'module': 'control'
      },
    ];
    final visible =
        actions.where((action) => _can(action['permission']!)).toList();
    return _panel(
      title: 'Quick Admin Actions',
      subtitle: 'Actions are shown only for authorized capabilities.',
      child: visible.isEmpty
          ? _empty('No quick actions are authorized for this role.')
          : Wrap(
              spacing: 9,
              runSpacing: 9,
              children: visible
                  .map(
                    (action) => FilledButton.tonalIcon(
                      onPressed: () => _open(action['module']!),
                      icon: const Icon(Icons.arrow_forward_rounded, size: 16),
                      label: Text(action['label']!),
                    ),
                  )
                  .toList(),
            ),
    );
  }

  Widget _configurationAndExportsPanel() {
    final configuration = _map(_data['configuration']);
    final exports = _list(_data['exports']).map(_map).toList();
    final canConfigure = _access.isFullAccess ||
        _can(AdminPermissions.settingsView) ||
        _can(AdminPermissions.settingsUpdate);
    final canExport =
        _access.isFullAccess || _can(AdminPermissions.reportsExport);
    return _panel(
      title: 'Configuration & Exports',
      subtitle: 'Head Office controls and server-prepared reporting outputs.',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (canConfigure) ...[
            Text(
              configuration.isEmpty
                  ? 'Configuration status is not available.'
                  : configuration['summary']?.toString() ??
                      configuration['status']?.toString() ??
                      'Configuration supplied by the server.',
              style: TextStyle(color: Colors.grey.shade700),
            ),
            const SizedBox(height: 9),
            FilledButton.tonalIcon(
              onPressed: () => _open('control'),
              icon: const Icon(Icons.settings_outlined, size: 17),
              label: const Text('Open configuration'),
            ),
          ] else
            _empty(
                'Configuration is available to authorized Head Office staff only.'),
          if (canExport) ...[
            const SizedBox(height: 14),
            const Text('Exports',
                style: TextStyle(fontWeight: FontWeight.w900)),
            const SizedBox(height: 5),
            if (exports.isEmpty)
              Text('No export is currently available for this period.',
                  style: TextStyle(color: Colors.grey.shade600))
            else
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: exports.take(6).map((export) {
                  final label = export['label'] ?? export['name'] ?? 'Export';
                  final available = export['available'] != false;
                  return OutlinedButton.icon(
                    onPressed: available && export['format'] == 'csv'
                        ? _downloadCsv
                        : null,
                    icon: const Icon(Icons.file_download_outlined, size: 17),
                    label: Text('$label'),
                  );
                }).toList(),
              ),
          ],
        ],
      ),
    );
  }

  Widget _sectionTitle(String title, String subtitle) {
    return Row(
      children: [
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(title,
                  style: const TextStyle(
                      fontSize: 20, fontWeight: FontWeight.w900, color: _ink)),
              const SizedBox(height: 3),
              Text(subtitle,
                  style: TextStyle(color: Colors.grey.shade600, fontSize: 12)),
            ],
          ),
        ),
      ],
    );
  }

  Widget _panel({
    String? title,
    String? subtitle,
    required Widget child,
  }) {
    return Container(
      padding: const EdgeInsets.all(17),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: const Color(0xFFE1EAE5)),
        boxShadow: const [
          BoxShadow(
            color: Color(0x0D12362A),
            blurRadius: 12,
            offset: Offset(0, 5),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (title != null) ...[
            Text(title,
                style: const TextStyle(
                    fontSize: 17, fontWeight: FontWeight.w900, color: _ink)),
            if (subtitle != null) ...[
              const SizedBox(height: 4),
              Text(subtitle,
                  style: TextStyle(color: Colors.grey.shade600, fontSize: 12)),
            ],
            const SizedBox(height: 13),
          ],
          child,
        ],
      ),
    );
  }

  Widget _notice(String text, IconData icon, Color color) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: color.withValues(alpha: .10),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: color.withValues(alpha: .25)),
      ),
      child: Row(
        children: [
          Icon(icon, color: color),
          const SizedBox(width: 9),
          Expanded(child: Text(text, style: TextStyle(color: color))),
        ],
      ),
    );
  }

  Widget _empty(String text) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 22),
      child: Center(
        child: Text(
          text,
          textAlign: TextAlign.center,
          style: TextStyle(color: Colors.grey.shade600),
        ),
      ),
    );
  }
}

class _LegendDot extends StatelessWidget {
  const _LegendDot({required this.color, required this.label});

  final Color color;
  final String label;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(
          width: 8,
          height: 8,
          decoration: BoxDecoration(color: color, shape: BoxShape.circle),
        ),
        const SizedBox(width: 5),
        Text(label, style: const TextStyle(fontSize: 11)),
      ],
    );
  }
}

class _PerformancePainter extends CustomPainter {
  const _PerformancePainter(this.series, this.measure);

  final List<Map<String, dynamic>> series;
  final String measure;

  @override
  void paint(Canvas canvas, Size size) {
    final chart = Rect.fromLTWH(8, 8, size.width - 16, size.height - 22);
    final gridPaint = Paint()
      ..color = const Color(0xFFE4ECE7)
      ..strokeWidth = 1;
    final colors = <String, Color>{
      'successful': const Color(0xFF08783E),
      'pending': const Color(0xFFD97706),
      'failed': const Color(0xFFB42318),
    };
    for (var line = 0; line <= 3; line++) {
      final y = chart.top + chart.height * line / 3;
      canvas.drawLine(Offset(chart.left, y), Offset(chart.right, y), gridPaint);
    }
    final maxValue = series
        .expand((item) => [
              _value(item, 'successful'),
              _value(item, 'pending'),
              _value(item, 'failed'),
            ])
        .fold<double>(1, (max, value) => value > max ? value : max);
    final groupWidth = chart.width / series.length;
    final barWidth = (groupWidth / 5).clamp(4.0, 14.0);
    for (var index = 0; index < series.length; index++) {
      final item = series[index];
      final center = chart.left + groupWidth * index + groupWidth / 2;
      var offset = -barWidth * 1.5;
      for (final key in ['successful', 'pending', 'failed']) {
        final value = _value(item, key);
        final height = chart.height * value / maxValue;
        final rect = Rect.fromLTWH(
          center + offset,
          chart.bottom - height,
          barWidth,
          height,
        );
        canvas.drawRRect(
          RRect.fromRectAndRadius(rect, const Radius.circular(3)),
          Paint()..color = colors[key]!,
        );
        offset += barWidth + 3;
      }
    }
  }

  double _number(dynamic value) => value is num ? value.toDouble() : 0;

  double _value(Map<String, dynamic> item, String status) {
    // Value mode accepts per-status values when the API provides them. A
    // period total remains useful rather than inventing a financial split.
    if (measure == 'value') {
      final perStatus = _number(item['${status}Value']);
      if (perStatus > 0) return perStatus;
      if (status == 'successful') return _number(item['value']);
    }
    return _number(item[status]);
  }

  @override
  bool shouldRepaint(covariant _PerformancePainter oldDelegate) =>
      oldDelegate.series != series || oldDelegate.measure != measure;
}

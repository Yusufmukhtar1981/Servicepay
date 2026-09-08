import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../admin/admin_delivery_management_screen.dart';
import '../admin/admin_delivery_api.dart';
import '../notifications_screen.dart';
import 'branch_manager_operations_screen.dart';
import 'branch_manager_dashboard_api.dart';
import 'branch_manager_staff_screen.dart';
import '../logistics/logistics_operations_screens.dart';
import '../login_screen.dart';

class BranchManagerDashboardScreen extends StatefulWidget {
  const BranchManagerDashboardScreen({
    super.key,
    this.api,
    this.onAction,
  });

  final BranchManagerDashboardApi? api;
  final ValueChanged<String>? onAction;

  @override
  State<BranchManagerDashboardScreen> createState() =>
      _BranchManagerDashboardScreenState();
}

enum _PeriodOption { today, sevenDays, thirtyDays, thisMonth, custom }

class _BranchManagerDashboardScreenState
    extends State<BranchManagerDashboardScreen> {
  static const Color _ink = Color(0xff102a2a);
  static const Color _green = Color(0xff087f5b);
  static const Color _mint = Color(0xffe8f5f0);
  static const Color _line = Color(0xffe4e9e7);

  late final BranchManagerDashboardApi _api;
  BranchManagerDashboard? _dashboard;
  String? _error;
  bool _loading = true;
  _PeriodOption _period = _PeriodOption.today;
  DateTimeRange? _customRange;
  DateTime? _lastUpdated;

  @override
  void initState() {
    super.initState();
    _api = widget.api ?? BranchManagerDashboardHttpApi();
    _load();
  }

  DateTimeRange get _activeRange {
    final DateTime now = DateTime.now();
    final DateTime today = DateTime(now.year, now.month, now.day);
    switch (_period) {
      case _PeriodOption.today:
        return DateTimeRange(start: today, end: today);
      case _PeriodOption.sevenDays:
        return DateTimeRange(
          start: today.subtract(const Duration(days: 6)),
          end: today,
        );
      case _PeriodOption.thirtyDays:
        return DateTimeRange(
          start: today.subtract(const Duration(days: 29)),
          end: today,
        );
      case _PeriodOption.thisMonth:
        return DateTimeRange(
          start: DateTime(now.year, now.month),
          end: today,
        );
      case _PeriodOption.custom:
        return _customRange ?? DateTimeRange(start: today, end: today);
    }
  }

  String _date(DateTime value) => '${value.year.toString().padLeft(4, '0')}-'
      '${value.month.toString().padLeft(2, '0')}-'
      '${value.day.toString().padLeft(2, '0')}';

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final DateTimeRange range = _activeRange;
      final BranchManagerDashboard value = await _api.loadDashboard(
        startDate: _date(range.start),
        endDate: _date(range.end),
      );
      if (mounted) {
        setState(() {
          _dashboard = value;
          _lastUpdated = DateTime.now();
        });
      }
    } catch (error) {
      if (mounted) {
        setState(
          () => _error = error.toString().replaceFirst('Exception: ', ''),
        );
      }
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _selectPeriod(_PeriodOption value) async {
    if (value == _PeriodOption.custom) {
      final DateTime now = DateTime.now();
      final DateTimeRange? selected = await showDateRangePicker(
        context: context,
        firstDate: DateTime(now.year - 2),
        lastDate: now,
        initialDateRange: _customRange,
      );
      if (selected == null) return;
      _customRange = selected;
    }
    setState(() => _period = value);
    await _load();
  }

  Map<String, dynamic> _map(dynamic value) =>
      value is Map ? Map<String, dynamic>.from(value) : <String, dynamic>{};

  num? _number(dynamic value) {
    if (value is num) return value;
    return num.tryParse('$value');
  }

  int _integer(dynamic value) => _number(value)?.round() ?? 0;

  String _text(
    Map<String, dynamic> row,
    List<String> keys, [
    String fallback = '—',
  ]) {
    for (final String key in keys) {
      final dynamic value = row[key];
      if (value != null && value.toString().trim().isNotEmpty) {
        return value.toString();
      }
    }
    return fallback;
  }

  String _groupDigits(num value, {int decimals = 0}) {
    final String raw = value.toStringAsFixed(decimals);
    final List<String> parts = raw.split('.');
    final String digits = parts.first;
    final String sign = digits.startsWith('-') ? '-' : '';
    final String unsigned = digits.replaceFirst('-', '');
    final String grouped = unsigned.replaceAllMapped(
      RegExp(r'\B(?=(\d{3})+(?!\d))'),
      (Match match) => ',',
    );
    return '$sign$grouped${parts.length > 1 ? '.${parts.last}' : ''}';
  }

  String _money(dynamic value, {String unavailable = 'No data'}) {
    final num? amount = _number(value);
    if (amount == null) return unavailable;
    if (amount.abs() >= 1000000000) {
      return '₦${_groupDigits(amount / 1000000000, decimals: 1)}B';
    }
    if (amount.abs() >= 1000000) {
      return '₦${_groupDigits(amount / 1000000, decimals: 1)}M';
    }
    return '₦${_groupDigits(amount)}';
  }

  bool _has(String permission) {
    final List<String> permissions =
        _dashboard?.permissions ?? const <String>[];
    return permissions.contains('*') || permissions.contains(permission);
  }

  bool _moduleAssigned(String module) =>
      _dashboard?.modules.any((Map<String, dynamic> item) =>
          _text(item, <String>['name']).toUpperCase() == module) ??
      false;

  String get _lastUpdatedLabel {
    final DateTime? updated = _lastUpdated;
    if (updated == null) return 'Updating live data';
    final Duration age = DateTime.now().difference(updated);
    if (age.inSeconds < 60) return 'Updated just now';
    if (age.inMinutes < 60) return 'Updated ${age.inMinutes}m ago';
    return 'Updated ${age.inHours}h ago';
  }

  Future<void> _logout() async {
    final bool? confirmed = await showDialog<bool>(
      context: context,
      builder: (BuildContext dialogContext) => AlertDialog(
        title: const Text('Logout'),
        content: const Text('Are you sure you want to log out?'),
        actions: <Widget>[
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            key: const Key('branch-manager-confirm-logout'),
            onPressed: () => Navigator.pop(dialogContext, true),
            child: const Text('Logout'),
          ),
        ],
      ),
    );
    if (confirmed != true) return;

    final SharedPreferences preferences = await SharedPreferences.getInstance();
    for (final String key in <String>[
      'auth_token',
      'token',
      'access_token',
      'accessToken',
      'refresh_token',
      'refreshToken',
      'jwt_token',
      'jwt',
      'user_id',
      'user_name',
      'user_phone',
      'user_email',
      'user_role',
      'user_status',
      'wallet_balance',
      'branch_id',
      'branch_code',
      'branch_name',
      'branch_profile',
      'branch_manager_profile',
      'branch_dashboard_cache',
      'branch_dashboard_data',
    ]) {
      await preferences.remove(key);
    }
    if (!mounted) return;
    Navigator.pushAndRemoveUntil(
      context,
      MaterialPageRoute<void>(builder: (_) => const LoginScreen()),
      (Route<dynamic> route) => false,
    );
  }

  void _openNavigation() {
    showModalBottomSheet<void>(
      context: context,
      showDragHandle: true,
      backgroundColor: Colors.white,
      builder: (BuildContext sheetContext) => SafeArea(
        child: ListView(
          shrinkWrap: true,
          padding: const EdgeInsets.fromLTRB(12, 4, 12, 18),
          children: <Widget>[
            const Padding(
              padding: EdgeInsets.fromLTRB(12, 8, 12, 14),
              child: Text(
                'Branch workspace',
                style: TextStyle(
                  color: _ink,
                  fontSize: 18,
                  fontWeight: FontWeight.w900,
                ),
              ),
            ),
            _navTile(
              sheetContext,
              'Dashboard',
              'Branch performance overview',
              Icons.dashboard_outlined,
              null,
            ),
            ..._navigationActions(sheetContext),
            const Divider(height: 24),
            ListTile(
              key: const Key('branch-manager-nav-logout'),
              leading:
                  const Icon(Icons.logout_rounded, color: Color(0xffb42318)),
              title: const Text(
                'Logout',
                style: TextStyle(
                  color: Color(0xffb42318),
                  fontWeight: FontWeight.w800,
                ),
              ),
              onTap: () {
                Navigator.pop(sheetContext);
                _logout();
              },
            ),
          ],
        ),
      ),
    );
  }

  List<Widget> _navigationActions(BuildContext sheetContext) {
    final List<_ActionData> actions = <_ActionData>[
      if (_has('branch.customers.view') || _has('branch.customers.create'))
        const _ActionData(
          'Customers',
          'customer',
          Icons.people_alt_outlined,
        ),
      if (_has('branch.finance.view'))
        const _ActionData(
          'Transactions',
          'transactions',
          Icons.receipt_long_outlined,
        ),
      if (_has('branch.targets.view'))
        const _ActionData(
          'Targets',
          'targets',
          Icons.track_changes_outlined,
        ),
      if (_has('branch.staff.view'))
        const _ActionData(
          'Branch staff',
          'staff',
          Icons.groups_2_outlined,
        ),
      if (_has('branch.staff.view'))
        const _ActionData(
          'Officers',
          'officers',
          Icons.badge_outlined,
        ),
      if (_has('branch.delivery.view') && _moduleAssigned('DELIVERY'))
        const _ActionData(
          'Deliveries & riders',
          'delivery',
          Icons.local_shipping_outlined,
        ),
      if (_has('branch.delivery.view') && _moduleAssigned('DELIVERY'))
        const _ActionData(
          'Rider directory',
          'riders',
          Icons.two_wheeler_outlined,
        ),
      if (_has('branch.logistics.view') ||
          _has('branch.logistics.manage') ||
          _moduleAssigned('LOGISTICS'))
        const _ActionData(
          'Interstate logistics',
          'logistics',
          Icons.local_shipping_outlined,
        ),
      if (_has('branch.reports.view'))
        const _ActionData(
          'Reports',
          'reports',
          Icons.assessment_outlined,
        ),
      if (_has('branch.customers.view'))
        const _ActionData(
          'KYC',
          'kyc',
          Icons.verified_user_outlined,
        ),
      if (_has('branch.solar.view') && _moduleAssigned('SOLAR'))
        const _ActionData(
          'Solar',
          'solar',
          Icons.solar_power_outlined,
        ),
      if (_has('branch.phone.view') && _moduleAssigned('PHONE_FINANCING'))
        const _ActionData(
          'Phone Financing',
          'phone',
          Icons.phone_android_outlined,
        ),
      if (_has('branch.marketplace.view') && _moduleAssigned('MARKETPLACE'))
        const _ActionData(
          'Marketplace',
          'marketplace',
          Icons.storefront_outlined,
        ),
    ];
    return actions
        .map(
          (_ActionData action) => _navTile(
            sheetContext,
            action.label,
            'Open permitted workspace',
            action.icon,
            action.key,
          ),
        )
        .toList();
  }

  Widget _navTile(
    BuildContext sheetContext,
    String title,
    String subtitle,
    IconData icon,
    String? action,
  ) =>
      ListTile(
        leading: Container(
          width: 38,
          height: 38,
          decoration: BoxDecoration(
            color: _mint,
            borderRadius: BorderRadius.circular(11),
          ),
          child: Icon(icon, color: _green, size: 20),
        ),
        title: Text(title, style: const TextStyle(fontWeight: FontWeight.w800)),
        subtitle: Text(subtitle),
        trailing: action == null
            ? const Icon(Icons.check_circle_rounded, color: _green, size: 18)
            : const Icon(Icons.chevron_right_rounded),
        onTap: action == null
            ? () => Navigator.pop(sheetContext)
            : () {
                Navigator.pop(sheetContext);
                _openAction(action);
              },
      );

  @override
  Widget build(BuildContext context) => Scaffold(
        backgroundColor: const Color(0xfff5f7f6),
        appBar: AppBar(
          backgroundColor: Colors.white,
          foregroundColor: _ink,
          elevation: 0,
          scrolledUnderElevation: 1,
          leading: IconButton(
            key: const Key('branch-manager-navigation'),
            tooltip: 'Branch navigation',
            onPressed: _openNavigation,
            icon: const Icon(Icons.menu_rounded),
          ),
          title: Row(
            children: <Widget>[
              Container(
                width: 32,
                height: 32,
                decoration: BoxDecoration(
                  gradient: const LinearGradient(
                    colors: <Color>[Color(0xff0b3b36), Color(0xff10a37f)],
                  ),
                  borderRadius: BorderRadius.circular(10),
                ),
                child: const Center(
                  child: Text(
                    'S',
                    style: TextStyle(
                      color: Colors.white,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                ),
              ),
              const SizedBox(width: 10),
              const Flexible(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    Text(
                      'ServicePay',
                      overflow: TextOverflow.ellipsis,
                      style:
                          TextStyle(fontSize: 17, fontWeight: FontWeight.w900),
                    ),
                    Text(
                      'Branch operations',
                      overflow: TextOverflow.ellipsis,
                      style:
                          TextStyle(fontSize: 10, fontWeight: FontWeight.w600),
                    ),
                  ],
                ),
              ),
            ],
          ),
          actions: <Widget>[
            _notificationButton(),
            IconButton(
              tooltip: 'Refresh',
              onPressed: _loading ? null : _load,
              icon: const Icon(Icons.refresh_rounded),
            ),
            PopupMenuButton<String>(
              key: const Key('branch-manager-profile-menu'),
              tooltip: 'Profile and account',
              icon: const CircleAvatar(
                radius: 16,
                backgroundColor: _mint,
                child: Icon(Icons.person_outline_rounded, color: _green),
              ),
              onSelected: (String value) {
                if (value == 'logout') _logout();
              },
              itemBuilder: (BuildContext context) => <PopupMenuEntry<String>>[
                PopupMenuItem<String>(
                  enabled: false,
                  child: Text(
                    _text(
                      _dashboard?.manager ?? const <String, dynamic>{},
                      <String>['name', 'fullName'],
                      'Branch Manager',
                    ),
                    style: const TextStyle(fontWeight: FontWeight.w800),
                  ),
                ),
                const PopupMenuDivider(),
                const PopupMenuItem<String>(
                  value: 'logout',
                  child: ListTile(
                    contentPadding: EdgeInsets.zero,
                    leading: Icon(Icons.logout_rounded),
                    title: Text('Logout'),
                  ),
                ),
              ],
            ),
            const SizedBox(width: 4),
          ],
        ),
        body: _loading && _dashboard == null
            ? const _DashboardSkeleton()
            : _error != null && _dashboard == null
                ? _ErrorState(message: _error!, onRetry: _load)
                : RefreshIndicator(
                    color: _green,
                    onRefresh: _load,
                    child: _content(),
                  ),
      );

  Widget _notificationButton() {
    final int count = _dashboard?.openRequests ?? 0;
    return IconButton(
      key: const Key('branch-manager-notifications'),
      tooltip: 'Notifications',
      onPressed: () => Navigator.of(context).push(
        MaterialPageRoute<void>(
          builder: (_) => const NotificationsScreen(),
        ),
      ),
      icon: Badge(
        isLabelVisible: count > 0,
        label: Text(count > 99 ? '99+' : '$count'),
        child: const Icon(Icons.notifications_none_rounded),
      ),
    );
  }

  Widget _content() {
    final BranchManagerDashboard data = _dashboard!;
    return LayoutBuilder(
      builder: (BuildContext context, BoxConstraints box) {
        final bool desktop = box.maxWidth >= 1040;
        final bool tablet = box.maxWidth >= 680;
        return ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: EdgeInsets.fromLTRB(
            tablet ? 24 : 14,
            16,
            tablet ? 24 : 14,
            40,
          ),
          children: <Widget>[
            if (_error != null) _RefreshWarning(message: _error!),
            _branchHeader(data, desktop),
            const SizedBox(height: 8),
            Align(
              alignment: Alignment.centerLeft,
              child: Text(
                _lastUpdatedLabel,
                style: const TextStyle(
                  color: Colors.black54,
                  fontSize: 11,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),
            const SizedBox(height: 12),
            _periodSelector(),
            const SizedBox(height: 16),
            _kpiGrid(data, box.maxWidth),
            const SizedBox(height: 16),
            if (desktop)
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Expanded(flex: 5, child: _transactionPerformance(data)),
                  const SizedBox(width: 14),
                  Expanded(flex: 4, child: _targetPerformance(data)),
                ],
              )
            else ...<Widget>[
              _transactionPerformance(data),
              const SizedBox(height: 14),
              _targetPerformance(data),
            ],
            const SizedBox(height: 14),
            if (tablet)
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Expanded(child: _staffPanel(data)),
                  const SizedBox(width: 14),
                  Expanded(child: _approvalsPanel(data)),
                ],
              )
            else ...<Widget>[
              _staffPanel(data),
              const SizedBox(height: 14),
              _approvalsPanel(data),
            ],
            const SizedBox(height: 14),
            _quickActions(data),
            const SizedBox(height: 14),
            if (desktop)
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Expanded(child: _liveOperations(data)),
                  const SizedBox(width: 14),
                  Expanded(child: _recentActivity(data)),
                  const SizedBox(width: 14),
                  Expanded(child: _branchHealth(data)),
                ],
              )
            else ...<Widget>[
              _liveOperations(data),
              const SizedBox(height: 14),
              _recentActivity(data),
              const SizedBox(height: 14),
              _branchHealth(data),
            ],
            const SizedBox(height: 14),
            _reports(data),
          ],
        );
      },
    );
  }

  Widget _branchHeader(BranchManagerDashboard data, bool desktop) {
    final Map<String, dynamic> branch = data.branch;
    final Map<String, dynamic> manager = data.manager;
    final String location = <String>[
      _text(branch, <String>['lga'], ''),
      _text(branch, <String>['state'], ''),
    ].where((String value) => value.isNotEmpty).join(', ');
    final Widget status = Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
      decoration: BoxDecoration(
        color: _mint,
        borderRadius: BorderRadius.circular(20),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          const Icon(Icons.circle, size: 8, color: _green),
          const SizedBox(width: 6),
          Text(
            _text(branch, <String>['status'], 'UNKNOWN'),
            style: const TextStyle(
              color: _green,
              fontSize: 11,
              fontWeight: FontWeight.w800,
            ),
          ),
        ],
      ),
    );
    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          colors: <Color>[Color(0xff0b3b36), Color(0xff0b6b57)],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        borderRadius: BorderRadius.circular(20),
        boxShadow: const <BoxShadow>[
          BoxShadow(
            color: Color(0x2405362f),
            blurRadius: 24,
            offset: Offset(0, 10),
          ),
        ],
      ),
      child: desktop
          ? Row(
              children: <Widget>[
                Expanded(child: _branchIdentity(branch, location, status)),
                Container(width: 1, height: 76, color: Colors.white24),
                const SizedBox(width: 24),
                _managerIdentity(manager, desktop: true),
              ],
            )
          : Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                _branchIdentity(branch, location, status),
                const Padding(
                  padding: EdgeInsets.symmetric(vertical: 16),
                  child: Divider(color: Colors.white24, height: 1),
                ),
                _managerIdentity(manager),
              ],
            ),
    );
  }

  Widget _branchIdentity(
    Map<String, dynamic> branch,
    String location,
    Widget status,
  ) =>
      Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Row(
            children: <Widget>[
              Flexible(
                child: Text(
                  _text(branch, <String>['name', 'branchName'], 'Your branch'),
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 24,
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ),
              const SizedBox(width: 10),
              status,
            ],
          ),
          const SizedBox(height: 8),
          Wrap(
            spacing: 14,
            runSpacing: 6,
            children: <Widget>[
              _headerMeta(
                Icons.tag_rounded,
                _text(branch, <String>['code', 'branchCode']),
              ),
              _headerMeta(
                Icons.location_on_outlined,
                location.isEmpty ? 'Location not set' : location,
              ),
            ],
          ),
        ],
      );

  Widget _managerIdentity(
    Map<String, dynamic> manager, {
    bool desktop = false,
  }) =>
      SizedBox(
        width: desktop ? 260 : double.infinity,
        child: Row(
          children: <Widget>[
            CircleAvatar(
              radius: 22,
              backgroundColor: Colors.white.withValues(alpha: .15),
              child: const Icon(Icons.person_outline, color: Colors.white),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  const Text(
                    'BRANCH MANAGER',
                    style: TextStyle(
                      color: Colors.white60,
                      fontSize: 10,
                      fontWeight: FontWeight.w700,
                      letterSpacing: 1,
                    ),
                  ),
                  Text(
                    _text(
                      manager,
                      <String>['name', 'fullName'],
                      'Assigned manager',
                    ),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      color: Colors.white,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  if (_text(manager, <String>['staffId'], '').isNotEmpty)
                    Text(
                      _text(manager, <String>['staffId']),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style:
                          const TextStyle(color: Colors.white70, fontSize: 11),
                    ),
                ],
              ),
            ),
          ],
        ),
      );

  Widget _headerMeta(IconData icon, String text) => Row(
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          Icon(icon, color: Colors.white60, size: 16),
          const SizedBox(width: 5),
          Text(text,
              style: const TextStyle(color: Colors.white70, fontSize: 12)),
        ],
      );

  Widget _periodSelector() {
    final DateTimeRange range = _activeRange;
    return _Panel(
      padding: const EdgeInsets.all(12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Row(
            children: <Widget>[
              const Icon(Icons.calendar_today_outlined,
                  size: 17, color: _green),
              const SizedBox(width: 8),
              const Expanded(
                child: Text(
                  'Reporting period',
                  style: TextStyle(fontWeight: FontWeight.w800, color: _ink),
                ),
              ),
              const SizedBox(width: 8),
              Flexible(
                child: FittedBox(
                  fit: BoxFit.scaleDown,
                  alignment: Alignment.centerRight,
                  child: Text(
                    '${_date(range.start)} to ${_date(range.end)}',
                    style: const TextStyle(fontSize: 10, color: Colors.black54),
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          Wrap(
            spacing: 7,
            runSpacing: 7,
            children: _PeriodOption.values
                .map(
                  (_PeriodOption option) => ChoiceChip(
                    label: Text(_periodLabel(option)),
                    selected: _period == option,
                    selectedColor: _mint,
                    side: BorderSide(
                      color: _period == option ? _green : _line,
                    ),
                    labelStyle: TextStyle(
                      color: _period == option ? _green : Colors.black54,
                      fontWeight: FontWeight.w700,
                      fontSize: 12,
                    ),
                    onSelected: (_) => _selectPeriod(option),
                  ),
                )
                .toList(),
          ),
        ],
      ),
    );
  }

  String _periodLabel(_PeriodOption option) => switch (option) {
        _PeriodOption.today => 'Today',
        _PeriodOption.sevenDays => '7 Days',
        _PeriodOption.thirtyDays => '30 Days',
        _PeriodOption.thisMonth => 'This Month',
        _PeriodOption.custom => 'Custom',
      };

  Widget _kpiGrid(BranchManagerDashboard data, double width) {
    final Map<String, dynamic> metrics = data.metrics;
    final Map<String, dynamic> transactions = _map(metrics['transactions']);
    final Map<String, dynamic> statuses = _map(metrics['transactionStatuses']);
    final Map<String, dynamic> customers = _map(metrics['customerSummary']);
    final Map<String, dynamic> staff = _map(metrics['staffSummary']);
    final int columns = width >= 1040 ? 4 : 2;
    final List<_KpiData> rows = <_KpiData>[
      _KpiData(
        'Transactions',
        transactions.containsKey('count')
            ? _groupDigits(_integer(transactions['count']))
            : 'No data',
        'in selected period',
        Icons.swap_horiz_rounded,
        const Color(0xffe8f1ff),
        const Color(0xff2864dc),
      ),
      _KpiData(
        'Transaction value',
        _money(transactions['value']),
        'processed volume',
        Icons.account_balance_wallet_outlined,
        _mint,
        _green,
      ),
      _KpiData(
        'Successful',
        statuses.isEmpty
            ? 'No data'
            : _groupDigits(_integer(statuses['SUCCESSFUL'])),
        'completed transactions',
        Icons.check_circle_outline_rounded,
        const Color(0xffecf8e9),
        const Color(0xff368a2e),
      ),
      _KpiData(
        'Needs attention',
        statuses.isEmpty
            ? 'No data'
            : _groupDigits(
                _integer(statuses['PENDING']) + _integer(statuses['FAILED']),
              ),
        'pending or failed',
        Icons.error_outline_rounded,
        const Color(0xfffff3df),
        const Color(0xffb86a00),
      ),
      _KpiData(
        'Active customers',
        customers.isEmpty
            ? 'No data'
            : _groupDigits(_integer(customers['active'])),
        customers.isEmpty
            ? 'not available'
            : '${_integer(customers['total'])} total',
        Icons.people_alt_outlined,
        const Color(0xfff1edff),
        const Color(0xff6b50c9),
      ),
      _KpiData(
        'Active staff',
        staff.isEmpty ? 'No data' : _groupDigits(_integer(staff['active'])),
        staff.isEmpty ? 'not available' : '${_integer(staff['total'])} total',
        Icons.badge_outlined,
        const Color(0xffffedf3),
        const Color(0xffba416a),
      ),
      _KpiData(
        'Open operations',
        _groupDigits(data.openRequests),
        'requests in progress',
        Icons.pending_actions_outlined,
        const Color(0xffeaf7f8),
        const Color(0xff247982),
      ),
      _KpiData(
        'Branch revenue',
        _money(metrics['revenue']),
        'across permitted modules',
        Icons.trending_up_rounded,
        const Color(0xfffff5e6),
        const Color(0xff9d650e),
      ),
    ];
    return GridView.builder(
      physics: const NeverScrollableScrollPhysics(),
      shrinkWrap: true,
      itemCount: rows.length,
      gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
        crossAxisCount: columns,
        crossAxisSpacing: 10,
        mainAxisSpacing: 10,
        childAspectRatio: width < 390 ? 1.27 : (columns == 4 ? 1.75 : 1.5),
      ),
      itemBuilder: (BuildContext context, int index) =>
          _KpiCard(data: rows[index]),
    );
  }

  Widget _transactionPerformance(BranchManagerDashboard data) {
    final List<Map<String, dynamic>> trend =
        (data.metrics['transactionTrend'] is List)
            ? (data.metrics['transactionTrend'] as List)
                .whereType<Map>()
                .map((Map row) => Map<String, dynamic>.from(row))
                .toList()
            : <Map<String, dynamic>>[];
    return _Panel(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          _sectionTitle(
            'Transaction performance',
            'Daily count, processed value and status mix',
            Icons.query_stats_rounded,
          ),
          const SizedBox(height: 18),
          if (trend.isEmpty)
            const _EmptyState(
              icon: Icons.bar_chart_rounded,
              message: 'No transaction activity in this period.',
            )
          else ...<Widget>[
            SizedBox(height: 170, child: _TrendBars(rows: trend)),
            const SizedBox(height: 12),
            Wrap(
              spacing: 14,
              runSpacing: 6,
              children: const <Widget>[
                _Legend(color: _green, label: 'Successful'),
                _Legend(color: Color(0xffffc46b), label: 'Pending'),
                _Legend(color: Color(0xffef6f6c), label: 'Failed'),
              ],
            ),
          ],
        ],
      ),
    );
  }

  Widget _targetPerformance(BranchManagerDashboard data) {
    if (data.targets.isEmpty) {
      return const _Panel(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            _StaticSectionTitle(
              title: 'Branch performance',
              subtitle: 'Targets and achievement',
              icon: Icons.track_changes_outlined,
            ),
            SizedBox(height: 18),
            _EmptyState(
              icon: Icons.flag_outlined,
              message: 'No targets have been assigned for this period.',
            ),
          ],
        ),
      );
    }
    final Map<String, dynamic> target = data.targets.first;
    final num goal = _number(target['target']) ?? 0;
    final num actual = _number(target['actual']) ?? 0;
    final double ratio = goal > 0 ? (actual / goal).clamp(0, 1).toDouble() : 0;
    return _Panel(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          _sectionTitle(
            'Branch performance',
            _text(target, <String>['period'], 'Current target'),
            Icons.track_changes_outlined,
          ),
          const SizedBox(height: 18),
          Row(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: <Widget>[
              Expanded(
                child: _metricPair(
                  'ACHIEVED',
                  _money(actual, unavailable: '₦0'),
                ),
              ),
              Expanded(
                child: _metricPair(
                  'TARGET',
                  _money(goal, unavailable: '₦0'),
                  alignEnd: true,
                ),
              ),
            ],
          ),
          const SizedBox(height: 14),
          ClipRRect(
            borderRadius: BorderRadius.circular(8),
            child: LinearProgressIndicator(
              minHeight: 11,
              value: ratio,
              backgroundColor: _line,
              valueColor: const AlwaysStoppedAnimation<Color>(_green),
            ),
          ),
          const SizedBox(height: 9),
          Row(
            children: <Widget>[
              Expanded(
                child: Text(
                  '${(ratio * 100).toStringAsFixed(0)}% complete',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: _green,
                    fontSize: 12,
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ),
              const SizedBox(width: 8),
              Flexible(
                child: FittedBox(
                  fit: BoxFit.scaleDown,
                  alignment: Alignment.centerRight,
                  child: Text(
                    '${_money(math.max(0, goal - actual), unavailable: '₦0')} remaining',
                    style: const TextStyle(fontSize: 11, color: Colors.black54),
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 14),
          _statusPill(_text(target, <String>['status'], 'NOT STARTED')),
        ],
      ),
    );
  }

  Widget _staffPanel(BranchManagerDashboard data) => _Panel(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            _sectionTitle(
              'Branch staff',
              '${data.staff.length} visible team members',
              Icons.groups_2_outlined,
            ),
            const SizedBox(height: 10),
            if (data.staff.isEmpty)
              const _EmptyState(
                icon: Icons.group_off_outlined,
                message: 'No staff records are available.',
              )
            else
              ...data.staff.take(4).map(
                    (Map<String, dynamic> member) => _compactRow(
                      icon: Icons.person_outline,
                      title: _text(
                        member,
                        <String>['fullName', 'name'],
                        'Team member',
                      ),
                      subtitle: _text(
                        member,
                        <String>['jobTitle', 'role', 'department'],
                        'Branch staff',
                      ),
                      trailing: _text(member, <String>['status'], 'UNKNOWN'),
                    ),
                  ),
          ],
        ),
      );

  Widget _approvalsPanel(BranchManagerDashboard data) => _Panel(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            _sectionTitle(
              'Approvals',
              'Head Office decision queue',
              Icons.fact_check_outlined,
            ),
            const SizedBox(height: 10),
            if (data.approvals.isEmpty)
              const _EmptyState(
                icon: Icons.task_alt_rounded,
                message: 'No approval activity in this period.',
              )
            else
              ...data.approvals.take(5).map(
                    (Map<String, dynamic> row) => _compactRow(
                      icon: Icons.description_outlined,
                      title: _text(row, <String>['name'], 'Approval'),
                      subtitle: 'Branch approval requests',
                      trailing: _groupDigits(_integer(row['value'])),
                    ),
                  ),
          ],
        ),
      );

  Widget _quickActions(BranchManagerDashboard data) {
    final List<_ActionData> actions = <_ActionData>[
      if (_has('branch.customers.create'))
        const _ActionData(
          'Register customer',
          'customer',
          Icons.person_add_alt_1_outlined,
        ),
      if (_has('branch.staff.manage'))
        const _ActionData(
            'Manage staff', 'staff', Icons.manage_accounts_outlined),
      if (_has('branch.approvals.submit'))
        const _ActionData(
          'Submit approval',
          'approval',
          Icons.approval_outlined,
        ),
      if (_has('branch.reports.view'))
        const _ActionData('View reports', 'reports', Icons.assessment_outlined),
      if (_has('branch.delivery.manage') && _moduleAssigned('DELIVERY'))
        const _ActionData(
          'Delivery operations',
          'delivery',
          Icons.local_shipping_outlined,
        ),
      if (_has('branch.delivery.manage') && _moduleAssigned('DELIVERY'))
        const _ActionData(
          'Assign rider',
          'delivery',
          Icons.person_pin_circle_outlined,
        ),
    ];
    if (actions.isEmpty) return const SizedBox.shrink();
    return _Panel(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          _sectionTitle(
            'Quick actions',
            'Only actions allowed by your role',
            Icons.bolt_outlined,
          ),
          const SizedBox(height: 12),
          Wrap(
            spacing: 9,
            runSpacing: 9,
            children: actions
                .map(
                  (_ActionData action) => OutlinedButton.icon(
                    onPressed: () => _openAction(action.key),
                    icon: Icon(action.icon, size: 18),
                    label: Text(action.label),
                    style: OutlinedButton.styleFrom(
                      foregroundColor: _ink,
                      side: const BorderSide(color: _line),
                      padding: const EdgeInsets.symmetric(
                        horizontal: 13,
                        vertical: 12,
                      ),
                    ),
                  ),
                )
                .toList(),
          ),
        ],
      ),
    );
  }

  Widget _liveOperations(BranchManagerDashboard data) {
    final Map<String, dynamic> metrics = data.metrics;
    final List<_OperationData> operations = <_OperationData>[
      if (metrics['deliveries'] is Map)
        _OperationData(
          'Deliveries',
          _integer(_map(metrics['deliveries'])['count']),
          Icons.local_shipping_outlined,
        ),
      if (metrics['marketplace'] is Map)
        _OperationData(
          'Marketplace orders',
          _integer(_map(metrics['marketplace'])['count']),
          Icons.storefront_outlined,
        ),
      if (metrics['solar'] is Map)
        _OperationData(
          'Solar applications',
          _integer(_map(metrics['solar'])['applications']),
          Icons.solar_power_outlined,
        ),
      if (metrics['phoneFinancing'] is Map)
        _OperationData(
          'Phone applications',
          _integer(_map(metrics['phoneFinancing'])['applications']),
          Icons.phone_android_outlined,
        ),
    ];
    return _Panel(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          _sectionTitle(
            'Live operations',
            'Assigned service modules',
            Icons.hub_outlined,
          ),
          const SizedBox(height: 12),
          if (operations.isEmpty)
            const _EmptyState(
              icon: Icons.widgets_outlined,
              message: 'No operational modules are available.',
            )
          else
            ...operations.map(
              (_OperationData row) => _compactRow(
                icon: row.icon,
                title: row.label,
                subtitle: 'Selected reporting period',
                trailing: _groupDigits(row.value),
              ),
            ),
        ],
      ),
    );
  }

  Widget _recentActivity(BranchManagerDashboard data) {
    final List<Map<String, dynamic>> activity =
        data.metrics['recentTransactions'] is List
            ? (data.metrics['recentTransactions'] as List)
                .whereType<Map>()
                .map((Map row) => Map<String, dynamic>.from(row))
                .toList()
            : <Map<String, dynamic>>[];
    return _Panel(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          _sectionTitle(
            'Recent activity',
            'Latest permitted transactions',
            Icons.history_rounded,
          ),
          const SizedBox(height: 12),
          if (activity.isEmpty)
            const _EmptyState(
              icon: Icons.receipt_long_outlined,
              message: 'No recent activity for this period.',
            )
          else
            ...activity.take(5).map(
                  (Map<String, dynamic> row) => _compactRow(
                    icon: Icons.receipt_outlined,
                    title: _text(
                      row,
                      <String>['serviceType'],
                      'Transaction',
                    ).replaceAll('_', ' '),
                    subtitle: _maskedReference(
                      _text(row, <String>['reference'], ''),
                    ),
                    trailing: _money(row['amount'], unavailable: '—'),
                  ),
                ),
        ],
      ),
    );
  }

  Widget _branchHealth(BranchManagerDashboard data) {
    final Map<String, dynamic> metrics = data.metrics;
    final Map<String, dynamic> statuses = _map(metrics['transactionStatuses']);
    final int total = statuses.values.fold<int>(
      0,
      (int sum, dynamic value) => sum + _integer(value),
    );
    final int success = _integer(statuses['SUCCESSFUL']);
    final double rate = total == 0 ? 0 : success / total;
    final int activeStaff = _integer(_map(metrics['staffSummary'])['active']);
    final int totalStaff = _integer(_map(metrics['staffSummary'])['total']);
    return _Panel(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          _sectionTitle(
            'Branch health',
            'Operational readiness',
            Icons.health_and_safety_outlined,
          ),
          const SizedBox(height: 16),
          _healthRow('Transaction success', rate, total == 0),
          const SizedBox(height: 14),
          _healthRow(
            'Staff availability',
            totalStaff == 0 ? 0 : activeStaff / totalStaff,
            totalStaff == 0,
          ),
          const SizedBox(height: 14),
          _healthRow(
            'Target completion',
            _targetRatio(data.targets),
            data.targets.isEmpty,
          ),
        ],
      ),
    );
  }

  Widget _reports(BranchManagerDashboard data) => _Panel(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            _sectionTitle(
              'Reports & modules',
              'Branch-scoped data available to your role',
              Icons.analytics_outlined,
            ),
            const SizedBox(height: 12),
            if (data.reports.isEmpty && data.modules.isEmpty)
              const _EmptyState(
                icon: Icons.insert_chart_outlined,
                message: 'No report summaries are available.',
              )
            else
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: <Widget>[
                  ...data.modules.map(
                    (Map<String, dynamic> row) => Chip(
                      avatar: const Icon(Icons.widgets_outlined, size: 16),
                      label: Text(_text(row, <String>['name'])),
                      side: const BorderSide(color: _line),
                      backgroundColor: Colors.white,
                    ),
                  ),
                  ...data.reports.take(5).map(
                        (Map<String, dynamic> row) => Chip(
                          label: Text(
                            '${_text(row, <String>[
                                  'name'
                                ]).replaceAll(RegExp(r'(?=[A-Z])'), ' ').trim()}: '
                            '${_money(row['value'], unavailable: _groupDigits(_integer(row['value'])))}',
                          ),
                          side: const BorderSide(color: _line),
                          backgroundColor: const Color(0xfffafcfb),
                        ),
                      ),
                ],
              ),
          ],
        ),
      );

  Widget _sectionTitle(
    String title,
    String subtitle,
    IconData icon,
  ) =>
      _StaticSectionTitle(title: title, subtitle: subtitle, icon: icon);

  Widget _compactRow({
    required IconData icon,
    required String title,
    required String subtitle,
    required String trailing,
  }) =>
      Padding(
        padding: const EdgeInsets.symmetric(vertical: 8),
        child: Row(
          children: <Widget>[
            Container(
              width: 36,
              height: 36,
              decoration: BoxDecoration(
                color: _mint,
                borderRadius: BorderRadius.circular(10),
              ),
              child: Icon(icon, size: 18, color: _green),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Text(
                    title,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      color: _ink,
                      fontWeight: FontWeight.w700,
                      fontSize: 13,
                    ),
                  ),
                  Text(
                    subtitle,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(fontSize: 11, color: Colors.black54),
                  ),
                ],
              ),
            ),
            const SizedBox(width: 8),
            Text(
              trailing,
              style: const TextStyle(
                color: _ink,
                fontWeight: FontWeight.w800,
                fontSize: 12,
              ),
            ),
          ],
        ),
      );

  Widget _metricPair(String label, String value, {bool alignEnd = false}) =>
      Column(
        crossAxisAlignment:
            alignEnd ? CrossAxisAlignment.end : CrossAxisAlignment.start,
        children: <Widget>[
          Text(
            label,
            style: const TextStyle(
              color: Colors.black45,
              fontSize: 10,
              fontWeight: FontWeight.w700,
              letterSpacing: .8,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            value,
            style: const TextStyle(
              color: _ink,
              fontSize: 20,
              fontWeight: FontWeight.w800,
            ),
          ),
        ],
      );

  Widget _statusPill(String value) => Align(
        alignment: Alignment.centerLeft,
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
          decoration: BoxDecoration(
            color: _mint,
            borderRadius: BorderRadius.circular(20),
          ),
          child: Text(
            value.replaceAll('_', ' '),
            style: const TextStyle(
              color: _green,
              fontWeight: FontWeight.w800,
              fontSize: 10,
            ),
          ),
        ),
      );

  Widget _healthRow(String label, double value, bool unavailable) => Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Row(
            children: <Widget>[
              Expanded(
                child: Text(
                  label,
                  style: const TextStyle(
                      fontSize: 12, fontWeight: FontWeight.w700),
                ),
              ),
              Text(
                unavailable ? 'No data' : '${(value * 100).round()}%',
                style: TextStyle(
                  color: unavailable ? Colors.black45 : _green,
                  fontSize: 11,
                  fontWeight: FontWeight.w800,
                ),
              ),
            ],
          ),
          const SizedBox(height: 6),
          ClipRRect(
            borderRadius: BorderRadius.circular(5),
            child: LinearProgressIndicator(
              value: unavailable ? 0 : value.clamp(0, 1),
              minHeight: 7,
              color: unavailable ? Colors.black26 : _green,
              backgroundColor: _line,
            ),
          ),
        ],
      );

  double _targetRatio(List<Map<String, dynamic>> targets) {
    if (targets.isEmpty) return 0;
    final num goal = _number(targets.first['target']) ?? 0;
    final num actual = _number(targets.first['actual']) ?? 0;
    return goal > 0 ? (actual / goal).clamp(0, 1).toDouble() : 0;
  }

  String _maskedReference(String value) {
    if (value.isEmpty) return 'Reference unavailable';
    return value.length <= 4 ? '$value***' : '${value.substring(0, 4)}***';
  }

  void _openAction(String action) {
    if (widget.onAction != null) {
      widget.onAction!(action);
      return;
    }
    if (action == 'staff') {
      final String branchId =
          '${_dashboard?.branch['_id'] ?? _dashboard?.branch['id'] ?? ''}';
      if (branchId.isEmpty) {
        _showMessage(
            'Your branch identity is unavailable. Refresh and try again.');
        return;
      }
      Navigator.of(context).push(MaterialPageRoute<void>(
        builder: (_) => BranchManagerStaffScreen(branchId: branchId),
      ));
      return;
    }
    if (action == 'officers') {
      final String branchId =
          '${_dashboard?.branch['_id'] ?? _dashboard?.branch['id'] ?? ''}';
      if (branchId.isEmpty) {
        Navigator.of(context).push(MaterialPageRoute<void>(
          builder: (_) => const _UnavailableBranchWorkspace(),
        ));
        return;
      }
      Navigator.of(context).push(MaterialPageRoute<void>(
        builder: (_) =>
            BranchManagerStaffScreen(branchId: branchId, officerOnly: true),
      ));
      return;
    }
    if (action == 'delivery') {
      Navigator.of(context).push(
        MaterialPageRoute<void>(
          builder: (_) => AdminDeliveryManagementScreen(
            api: AdminDeliveryApi(
              baseUrl: 'https://api.servicepay.ng/api/branches',
            ),
          ),
        ),
      );
      return;
    }
    if (action == 'logistics') {
      Navigator.of(context).push(
        MaterialPageRoute<void>(builder: (_) => const BranchLogisticsScreen()),
      );
      return;
    }
    if (action == 'notifications') {
      Navigator.of(context).push(
        MaterialPageRoute<void>(
          builder: (_) => const NotificationsScreen(),
        ),
      );
      return;
    }
    final BranchOperationsView? view = switch (action) {
      'customer' => BranchOperationsView.customers,
      'transactions' => BranchOperationsView.transactions,
      'riders' => BranchOperationsView.riders,
      'officers' => BranchOperationsView.officers,
      'kyc' => BranchOperationsView.kyc,
      'solar' => BranchOperationsView.solar,
      'phone' => BranchOperationsView.phone,
      'marketplace' => BranchOperationsView.marketplace,
      'approval' => BranchOperationsView.approvals,
      'reports' => BranchOperationsView.reports,
      'targets' => BranchOperationsView.targets,
      _ => null,
    };
    if (view != null) {
      Navigator.of(context).push(MaterialPageRoute<void>(
        builder: (_) => BranchManagerOperationsScreen(
          view: view,
          permissions: _dashboard?.permissions ?? const <String>[],
        ),
      ));
      return;
    }
    Navigator.of(context).push(MaterialPageRoute<void>(
      builder: (_) => const _UnavailableBranchWorkspace(),
    ));
  }

  void _showMessage(String message) {
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(content: Text(message)));
  }
}

class _UnavailableBranchWorkspace extends StatelessWidget {
  const _UnavailableBranchWorkspace();

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: const Text('Branch workspace')),
        body: const Center(
          child: Padding(
            padding: EdgeInsets.all(24),
            child: Text(
              'This operation is not assigned to your branch role.',
              textAlign: TextAlign.center,
            ),
          ),
        ),
      );
}

class _Panel extends StatelessWidget {
  const _Panel({required this.child, this.padding = const EdgeInsets.all(16)});
  final Widget child;
  final EdgeInsets padding;

  @override
  Widget build(BuildContext context) => Container(
        padding: padding,
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: const Color(0xffe4e9e7)),
          boxShadow: const <BoxShadow>[
            BoxShadow(
              color: Color(0x08000000),
              blurRadius: 12,
              offset: Offset(0, 4),
            ),
          ],
        ),
        child: child,
      );
}

class _StaticSectionTitle extends StatelessWidget {
  const _StaticSectionTitle({
    required this.title,
    required this.subtitle,
    required this.icon,
  });
  final String title;
  final String subtitle;
  final IconData icon;

  @override
  Widget build(BuildContext context) => Row(
        children: <Widget>[
          Container(
            width: 34,
            height: 34,
            decoration: BoxDecoration(
              color: const Color(0xffe8f5f0),
              borderRadius: BorderRadius.circular(10),
            ),
            child: Icon(icon, color: const Color(0xff087f5b), size: 18),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Text(
                  title,
                  style: const TextStyle(
                    color: Color(0xff102a2a),
                    fontSize: 15,
                    fontWeight: FontWeight.w800,
                  ),
                ),
                Text(
                  subtitle,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(fontSize: 10, color: Colors.black45),
                ),
              ],
            ),
          ),
        ],
      );
}

class _KpiData {
  const _KpiData(
    this.label,
    this.value,
    this.caption,
    this.icon,
    this.background,
    this.foreground,
  );
  final String label;
  final String value;
  final String caption;
  final IconData icon;
  final Color background;
  final Color foreground;
}

class _KpiCard extends StatelessWidget {
  const _KpiCard({required this.data});
  final _KpiData data;

  @override
  Widget build(BuildContext context) => _Panel(
        padding: const EdgeInsets.all(13),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: <Widget>[
            Row(
              children: <Widget>[
                Expanded(
                  child: Text(
                    data.label,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      color: Colors.black54,
                      fontSize: 11,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
                Container(
                  width: 30,
                  height: 30,
                  decoration: BoxDecoration(
                    color: data.background,
                    borderRadius: BorderRadius.circular(9),
                  ),
                  child: Icon(data.icon, color: data.foreground, size: 17),
                ),
              ],
            ),
            FittedBox(
              fit: BoxFit.scaleDown,
              alignment: Alignment.centerLeft,
              child: Text(
                data.value,
                style: const TextStyle(
                  color: Color(0xff102a2a),
                  fontSize: 22,
                  fontWeight: FontWeight.w900,
                ),
              ),
            ),
            Text(
              data.caption,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(fontSize: 9, color: Colors.black45),
            ),
          ],
        ),
      );
}

class _TrendBars extends StatelessWidget {
  const _TrendBars({required this.rows});
  final List<Map<String, dynamic>> rows;

  int _integer(dynamic value) =>
      value is num ? value.round() : int.tryParse('$value') ?? 0;

  @override
  Widget build(BuildContext context) {
    final List<Map<String, dynamic>> visible =
        rows.length > 14 ? rows.sublist(rows.length - 14) : rows;
    final int maximum = visible.fold<int>(
      1,
      (int current, Map<String, dynamic> row) =>
          math.max(current, _integer(row['count'])),
    );
    return Row(
      crossAxisAlignment: CrossAxisAlignment.end,
      children: visible.map((Map<String, dynamic> row) {
        final int count = _integer(row['count']);
        final double height = 18 + (118 * count / maximum);
        final String date = '${row['_id'] ?? ''}';
        final int successful = _integer(row['successful']);
        final int pending = _integer(row['pending']);
        final int failed = _integer(row['failed']);
        final int other = math.max(0, count - successful - pending - failed);
        final List<Widget> statusParts = <Widget>[
          if (successful > 0)
            Expanded(
              flex: successful,
              child: Container(color: const Color(0xff087f5b)),
            ),
          if (pending > 0)
            Expanded(
              flex: pending,
              child: Container(color: const Color(0xffffc46b)),
            ),
          if (failed > 0)
            Expanded(
              flex: failed,
              child: Container(color: const Color(0xffef6f6c)),
            ),
          if (other > 0 || count == 0)
            Expanded(
              flex: math.max(1, other),
              child: Container(color: const Color(0xffc9d2cf)),
            ),
        ];
        return Expanded(
          child: Tooltip(
            message:
                '$date • $count transactions • ₦${row['value'] ?? 0} processed',
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 2),
              child: Column(
                mainAxisAlignment: MainAxisAlignment.end,
                children: <Widget>[
                  Text(
                    '$count',
                    style: const TextStyle(fontSize: 8, color: Colors.black45),
                  ),
                  const SizedBox(height: 4),
                  SizedBox(
                    height: height,
                    child: ClipRRect(
                      borderRadius: BorderRadius.circular(5),
                      child: Column(children: statusParts),
                    ),
                  ),
                  const SizedBox(height: 5),
                  Text(
                    date.length >= 10 ? date.substring(8) : date,
                    style: const TextStyle(fontSize: 8, color: Colors.black45),
                  ),
                ],
              ),
            ),
          ),
        );
      }).toList(),
    );
  }
}

class _Legend extends StatelessWidget {
  const _Legend({required this.color, required this.label});
  final Color color;
  final String label;

  @override
  Widget build(BuildContext context) => Row(
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          Container(
            width: 8,
            height: 8,
            decoration: BoxDecoration(color: color, shape: BoxShape.circle),
          ),
          const SizedBox(width: 5),
          Text(label, style: const TextStyle(fontSize: 10)),
        ],
      );
}

class _EmptyState extends StatelessWidget {
  const _EmptyState({required this.icon, required this.message});
  final IconData icon;
  final String message;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 20),
        child: Center(
          child: Column(
            children: <Widget>[
              Icon(icon, color: Colors.black26, size: 31),
              const SizedBox(height: 8),
              Text(
                message,
                textAlign: TextAlign.center,
                style: const TextStyle(color: Colors.black45, fontSize: 12),
              ),
            ],
          ),
        ),
      );
}

class _ActionData {
  const _ActionData(this.label, this.key, this.icon);
  final String label;
  final String key;
  final IconData icon;
}

class _OperationData {
  const _OperationData(this.label, this.value, this.icon);
  final String label;
  final int value;
  final IconData icon;
}

class _RefreshWarning extends StatelessWidget {
  const _RefreshWarning({required this.message});
  final String message;

  @override
  Widget build(BuildContext context) => Container(
        margin: const EdgeInsets.only(bottom: 12),
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: const Color(0xfffff4e0),
          borderRadius: BorderRadius.circular(12),
        ),
        child: Row(
          children: <Widget>[
            const Icon(Icons.info_outline, color: Color(0xff9d650e), size: 18),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                'Showing the last update. $message',
                style: const TextStyle(fontSize: 11),
              ),
            ),
          ],
        ),
      );
}

class _ErrorState extends StatelessWidget {
  const _ErrorState({required this.message, required this.onRetry});
  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) => Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              const Icon(Icons.cloud_off_outlined,
                  size: 48, color: Colors.black38),
              const SizedBox(height: 10),
              const Text(
                'Unable to load your branch dashboard',
                textAlign: TextAlign.center,
                style: TextStyle(fontSize: 16, fontWeight: FontWeight.w800),
              ),
              const SizedBox(height: 6),
              Text(
                message,
                textAlign: TextAlign.center,
                style: const TextStyle(color: Colors.black54),
              ),
              const SizedBox(height: 12),
              FilledButton.icon(
                onPressed: onRetry,
                icon: const Icon(Icons.refresh_rounded),
                label: const Text('Try again'),
              ),
            ],
          ),
        ),
      );
}

class _DashboardSkeleton extends StatelessWidget {
  const _DashboardSkeleton();

  @override
  Widget build(BuildContext context) => ListView(
        padding: const EdgeInsets.all(16),
        children: <Widget>[
          _box(150),
          const SizedBox(height: 12),
          _box(92),
          const SizedBox(height: 12),
          GridView.count(
            physics: const NeverScrollableScrollPhysics(),
            shrinkWrap: true,
            crossAxisCount: 2,
            crossAxisSpacing: 10,
            mainAxisSpacing: 10,
            childAspectRatio: 1.55,
            children: List<Widget>.generate(8, (_) => _box(90)),
          ),
          const SizedBox(height: 12),
          _box(230),
        ],
      );

  static Widget _box(double height) => Container(
        height: height,
        decoration: BoxDecoration(
          color: const Color(0xffe8ecea),
          borderRadius: BorderRadius.circular(16),
        ),
      );
}

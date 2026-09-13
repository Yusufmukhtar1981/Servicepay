import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'business_partner_permissions.dart';
import 'business_partner_officers_screen.dart';
import '../services/business_partner_api_service.dart';
import '../login_screen.dart';

const Color _green = Color(0xFF078B52);
const Color _greenDark = Color(0xFF05633D);
const Color _ink = Color(0xFF18332B);
const Color _muted = Color(0xFF70807A);
const Color _surface = Color(0xFFF3F7F5);
const Color _line = Color(0xFFE1EAE5);
const Color _navy = Color(0xFF12342E);

class BusinessPartnerDashboardScreen extends StatefulWidget {
  const BusinessPartnerDashboardScreen({super.key, this.api});

  final BusinessPartnerApiService? api;

  @override
  State<BusinessPartnerDashboardScreen> createState() =>
      _BusinessPartnerDashboardScreenState();
}

class _BusinessPartnerDashboardScreenState
    extends State<BusinessPartnerDashboardScreen> {
  late final BusinessPartnerApiService _api;
  bool _loading = true;
  String _error = '';
  int _section = 0;
  String _filter = 'ALL';
  String _serviceFilter = 'ALL';
  String _officerFilter = '';
  String _dateFrom = '';
  String _dateTo = '';
  String _customerSearch = '';
  String _customerStatus = 'ALL';
  String _customerKyc = 'ALL';
  int _customerPage = 0;
  int _customerPages = 1;
  int _transactionPage = 0;
  int _transactionPages = 1;
  String _transactionSearch = '';
  String _transactionStatus = 'ALL';
  int _commissionPage = 0;
  int _commissionPages = 1;
  String _commissionTypeFilter = 'ALL';
  final Set<String> _extraLoading = <String>{};
  final Set<String> _unavailable = <String>{};
  final Map<String, Map<String, dynamic>> _responses =
      <String, Map<String, dynamic>>{};

  static const List<_Section> _sections = <_Section>[
    _Section('Dashboard', Icons.grid_view_rounded),
    _Section('Officer Management', Icons.badge_outlined),
    _Section('Customers', Icons.people_alt_outlined),
    _Section('Assigned Solar', Icons.wb_sunny_outlined),
    _Section('Assigned Phones', Icons.smartphone_outlined),
    _Section('Sales & Applications', Icons.description_outlined),
    _Section('Repayments', Icons.payments_outlined),
    _Section('Commission', Icons.account_balance_wallet_outlined),
    _Section('Performance', Icons.insights_outlined),
    _Section('Reports', Icons.bar_chart_rounded),
    _Section('Notifications', Icons.notifications_none_rounded),
    _Section('Profile', Icons.person_outline_rounded),
    _Section('Customer Transactions', Icons.receipt_long_outlined),
    _Section('Commission Wallet', Icons.account_balance_wallet_outlined),
    _Section('Targets & Bonuses', Icons.flag_outlined),
  ];

  static const List<int> _navigationOrder = <int>[
    -1,
    0,
    2,
    12,
    1,
    13,
    14,
    9,
    3,
    4,
    5,
    6,
    8,
    7,
    10,
    11
  ];

  @override
  void initState() {
    super.initState();
    _api = widget.api ?? BusinessPartnerApiService();
    _load();
  }

  Future<void> _load() async {
    if (mounted) {
      setState(() {
        _loading = true;
        _error = '';
      });
    }
    final Map<String, String> filters = _filters;
    final Map<String, Future<Map<String, dynamic>>> calls =
        <String, Future<Map<String, dynamic>>>{
      'Dashboard': _api.dashboard(filters: filters),
      'Officer Management': _api.officers(filters: filters),
      'Customers': _api.customers(filters: _customerFilters),
      'Applications': _api.applications(filters: filters),
      'Repayments': _api.repayments(filters: filters),
      'Commission': _api.commission(filters: filters),
      'Performance': _api.performance(filters: filters),
      'Reports': _api.reports(filters: filters),
      'Notifications': _api.notifications(filters: filters),
      'Activity': _api.activity(filters: filters),
      'Profile': _api.profile(),
      'Targets': _api.targets(filters: filters),
    };
    final Map<String, Map<String, dynamic>> received =
        <String, Map<String, dynamic>>{};
    final Set<String> denied = <String>{};
    await Future.wait(calls.entries
        .map((MapEntry<String, Future<Map<String, dynamic>>> entry) async {
      try {
        received[entry.key] = await entry.value;
      } on BusinessPartnerApiException catch (error) {
        if (error.statusCode == 403) denied.add(entry.key);
        received[entry.key] = <String, dynamic>{'_unavailable': error.message};
      } catch (_) {
        received[entry.key] = <String, dynamic>{
          '_unavailable': 'This service is currently unavailable.'
        };
      }
    }));
    if (!mounted) return;
    setState(() {
      _responses
        ..clear()
        ..addAll(received);
      final Map<String, dynamic> applications =
          received['Applications'] ?? <String, dynamic>{};
      _responses['Assigned Solar'] = applications;
      _responses['Assigned Phones'] = applications;
      _responses['Sales & Applications'] = applications;
      _unavailable
        ..clear()
        ..addAll(denied);
      final Map<String, dynamic> customerPagination =
          _map(received['Customers']?['pagination']);
      _customerPages =
          (_number(customerPagination['pages']).toInt()).clamp(1, 1000000);
      _loading = false;
    });
  }

  Future<void> _loadExtra(String title) async {
    if (_extraLoading.contains(title)) return;
    setState(() => _extraLoading.add(title));
    try {
      final Map<String, dynamic> response = title == 'Customer Transactions'
          ? await _api.transactions(filters: _transactionFilters)
          : await _api.commissionWallet(filters: _commissionFilters());
      if (!mounted) return;
      setState(() {
        _responses[title] = response;
        final Map<String, dynamic> pagination = _map(response['pagination']);
        final int pages =
            (_number(pagination['pages']).toInt()).clamp(1, 1000000);
        if (title == 'Customer Transactions') {
          _transactionPages = pages;
        } else {
          _commissionPages = pages;
        }
      });
    } on BusinessPartnerApiException catch (error) {
      if (!mounted) return;
      setState(() => _responses[title] = <String, dynamic>{
            '_unavailable': error.message,
          });
    } catch (_) {
      if (!mounted) return;
      setState(() => _responses[title] = <String, dynamic>{
            '_unavailable': 'This service is currently unavailable.',
          });
    } finally {
      if (mounted) setState(() => _extraLoading.remove(title));
    }
  }

  Future<void> _reloadCustomers({bool resetPage = false}) async {
    if (resetPage) _customerPage = 0;
    try {
      final Map<String, dynamic> response =
          await _api.customers(filters: _customerFilters);
      if (!mounted) return;
      setState(() {
        _responses['Customers'] = response;
        final Map<String, dynamic> pagination = _map(response['pagination']);
        _customerPages =
            (_number(pagination['pages']).toInt()).clamp(1, 1000000);
      });
    } on BusinessPartnerApiException catch (error) {
      if (mounted) _notice(error.message, error: true);
    } catch (_) {
      if (mounted) _notice('Unable to load customers right now.', error: true);
    }
  }

  Map<String, String> get _filters => <String, String>{
        if (_filter != 'ALL') 'status': _filter,
        if (_serviceFilter != 'ALL') 'serviceType': _serviceFilter,
        if (_officerFilter.isNotEmpty) 'officerId': _officerFilter,
        if (_dateFrom.isNotEmpty) 'dateFrom': _dateFrom,
        if (_dateTo.isNotEmpty) 'dateTo': _dateTo,
      };

  Map<String, String> get _customerFilters => <String, String>{
        if (_customerSearch.trim().isNotEmpty) 'q': _customerSearch.trim(),
        if (_customerStatus != 'ALL') 'status': _customerStatus,
        if (_customerKyc != 'ALL')
          'kyc': _customerKyc == 'VERIFIED' ? 'true' : 'false',
        if (_officerFilter.isNotEmpty) 'officerId': _officerFilter,
        if (_dateFrom.isNotEmpty) 'dateFrom': _dateFrom,
        if (_dateTo.isNotEmpty) 'dateTo': _dateTo,
        'page': '${_customerPage + 1}',
        'limit': '8',
      };

  Map<String, String> get _transactionFilters => <String, String>{
        if (_transactionSearch.trim().isNotEmpty)
          'q': _transactionSearch.trim(),
        if (_transactionStatus != 'ALL') 'status': _transactionStatus,
        if (_serviceFilter != 'ALL') 'serviceType': _serviceFilter,
        if (_officerFilter.isNotEmpty) 'officerId': _officerFilter,
        if (_dateFrom.isNotEmpty) 'dateFrom': _dateFrom,
        if (_dateTo.isNotEmpty) 'dateTo': _dateTo,
        'page': '${_transactionPage + 1}',
        'limit': '10',
      };

  Map<String, String> _commissionFilters() => <String, String>{
        if (_dateFrom.isNotEmpty) 'dateFrom': _dateFrom,
        if (_dateTo.isNotEmpty) 'dateTo': _dateTo,
        'page': '${_commissionPage + 1}',
        'limit': '25',
      };

  Map<String, dynamic> _map(dynamic value) {
    final Map<String, dynamic> result = <String, dynamic>{};
    if (value is Map) {
      value.forEach((dynamic key, dynamic item) {
        result[key.toString()] = item;
      });
    }
    return result;
  }

  List<Map<String, dynamic>> _list(dynamic value) => value is List
      ? value.whereType<Map>().map(_map).toList()
      : <Map<String, dynamic>>[];

  String _text(dynamic value, [String fallback = '—']) {
    final String text = value?.toString().trim() ?? '';
    return text.isEmpty || text == 'null' ? fallback : text;
  }

  num _number(dynamic value) =>
      value is num ? value : num.tryParse(_text(value, '0')) ?? 0;

  String _money(dynamic value) {
    final num amount = _number(value);
    return '₦${amount.toStringAsFixed(2)}';
  }

  String _status(dynamic value) {
    final String valueText = _text(value, 'Pending').replaceAll('_', ' ');
    return valueText
        .split(' ')
        .where((String word) => word.isNotEmpty)
        .map((String word) =>
            '${word[0].toUpperCase()}${word.substring(1).toLowerCase()}')
        .join(' ');
  }

  String _date(dynamic value) {
    final DateTime? parsed = DateTime.tryParse(_text(value, ''));
    if (parsed == null) return 'Recent update';
    const List<String> months = <String>[
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec'
    ];
    return '${months[parsed.month - 1]} ${parsed.day}, ${parsed.year}';
  }

  Map<String, dynamic> _nested(String key, String child) {
    final Map<String, dynamic> response =
        _responses[key] ?? <String, dynamic>{};
    final Map<String, dynamic> nested = _map(response[child]);
    return nested.isNotEmpty ? nested : response;
  }

  List<Map<String, dynamic>> _applications(String type) {
    final Map<String, dynamic> apps = _map(
        (_responses['Applications'] ?? <String, dynamic>{})['applications']);
    return _list(apps[type])
        .map((Map<String, dynamic> row) =>
            <String, dynamic>{...row, '_serviceKind': type})
        .toList();
  }

  List<Map<String, dynamic>> _allApplications() => <Map<String, dynamic>>[
        ..._applications('solar'),
        ..._applications('phone'),
      ];

  Map<String, dynamic> _profileData() => _nested('Profile', 'partner');

  @override
  Widget build(BuildContext context) {
    final bool wide = MediaQuery.sizeOf(context).width >= 960;
    return Theme(
      data: Theme.of(context).copyWith(
        scaffoldBackgroundColor: _surface,
        colorScheme: Theme.of(context).colorScheme.copyWith(
              primary: _green,
              onPrimary: Colors.white,
              surface: Colors.white,
            ),
        dividerColor: _line,
        inputDecorationTheme: InputDecorationTheme(
          filled: true,
          fillColor: Colors.white,
          border: OutlineInputBorder(
            borderRadius: BorderRadius.circular(14),
            borderSide: const BorderSide(color: _line),
          ),
          enabledBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(14),
            borderSide: const BorderSide(color: _line),
          ),
          focusedBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(14),
            borderSide: const BorderSide(color: _green, width: 1.5),
          ),
        ),
      ),
      child: Scaffold(
        key: const Key('business-partner-dashboard'),
        backgroundColor: _surface,
        drawer: wide ? null : _drawer(),
        appBar: PreferredSize(
          preferredSize: const Size.fromHeight(72),
          child: _topBar(wide),
        ),
        body: _loading
            ? const Center(child: CircularProgressIndicator(color: _green))
            : _error.isNotEmpty
                ? _errorView()
                : Row(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: <Widget>[
                      if (wide) _sidebar(),
                      Expanded(child: _content()),
                    ],
                  ),
      ),
    );
  }

  Widget _brand({bool compact = false}) => Row(
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          Container(
            width: compact ? 34 : 40,
            height: compact ? 34 : 40,
            decoration: BoxDecoration(
              gradient: const LinearGradient(
                colors: <Color>[_green, Color(0xFF35B875)],
              ),
              borderRadius: BorderRadius.circular(compact ? 11 : 13),
            ),
            child: Icon(Icons.handshake_rounded,
                color: Colors.white, size: compact ? 19 : 22),
          ),
          const SizedBox(width: 10),
          const Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              Text('ServicePay',
                  style: TextStyle(
                      color: _ink, fontSize: 15, fontWeight: FontWeight.w900)),
              Text('Business Partner',
                  style: TextStyle(
                      color: _muted,
                      fontSize: 10,
                      fontWeight: FontWeight.w600)),
            ],
          ),
        ],
      );

  Widget _topBar(bool wide) => Container(
        color: Colors.white,
        padding: EdgeInsets.symmetric(horizontal: wide ? 30 : 16, vertical: 12),
        child: Row(
          children: <Widget>[
            if (!wide)
              Builder(
                builder: (BuildContext context) => IconButton(
                  tooltip: 'Open menu',
                  onPressed: () => Scaffold.of(context).openDrawer(),
                  icon: const Icon(Icons.menu_rounded, color: _ink),
                ),
              ),
            if (!wide) const SizedBox(width: 4),
            if (wide) _brand(),
            if (wide) const SizedBox(width: 30),
            Expanded(
              child: Text(
                _displaySectionTitle(_section),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  color: _ink,
                  fontSize: wide ? 18 : 17,
                  fontWeight: FontWeight.w800,
                  letterSpacing: -0.2,
                ),
              ),
            ),
            if (wide)
              Container(
                padding:
                    const EdgeInsets.symmetric(horizontal: 11, vertical: 7),
                decoration: BoxDecoration(
                  color: const Color(0xFFEAF8F0),
                  borderRadius: BorderRadius.circular(20),
                ),
                child: const Row(
                  mainAxisSize: MainAxisSize.min,
                  children: <Widget>[
                    Icon(Icons.circle, color: _green, size: 7),
                    SizedBox(width: 7),
                    Text('Active workspace',
                        style: TextStyle(
                            color: _greenDark,
                            fontSize: 11,
                            fontWeight: FontWeight.w800)),
                  ],
                ),
              ),
            const SizedBox(width: 7),
            IconButton(
              tooltip: 'Refresh',
              onPressed: _loading ? null : _load,
              icon: const Icon(Icons.refresh_rounded, color: _muted),
            ),
            if (!wide) const SizedBox(width: 4),
            if (!wide) _brand(compact: true),
          ],
        ),
      );

  Widget _sidebar() => Container(
        width: 244,
        color: _navy,
        padding: const EdgeInsets.fromLTRB(15, 22, 15, 16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            _darkBrand(),
            const SizedBox(height: 28),
            const Padding(
              padding: EdgeInsets.only(left: 12, bottom: 10),
              child: Text('WORKSPACE',
                  style: TextStyle(
                      color: Color(0xFF91B2A5),
                      fontSize: 10,
                      letterSpacing: 1.4,
                      fontWeight: FontWeight.w800)),
            ),
            Expanded(
              child: ListView.builder(
                itemCount: _navigationOrder.length,
                itemBuilder: (BuildContext context, int index) {
                  final int sectionIndex = _navigationOrder[index];
                  return sectionIndex < 0
                      ? _createCustomerNavItem(dark: true)
                      : _navItem(sectionIndex, dark: true);
                },
              ),
            ),
            _securityNote(),
          ],
        ),
      );

  Widget _darkBrand() => Row(
        children: <Widget>[
          Container(
            width: 40,
            height: 40,
            decoration: BoxDecoration(
                color: _green, borderRadius: BorderRadius.circular(13)),
            child: const Icon(Icons.handshake_rounded,
                color: Colors.white, size: 21),
          ),
          const SizedBox(width: 10),
          const Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Text('ServicePay',
                  style: TextStyle(
                      color: Colors.white,
                      fontSize: 15,
                      fontWeight: FontWeight.w900)),
              Text('Business Partner',
                  style: TextStyle(
                      color: Color(0xFFB1CEC2),
                      fontSize: 10,
                      fontWeight: FontWeight.w600)),
            ],
          ),
        ],
      );

  Widget _securityNote() => Container(
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: Colors.white.withValues(alpha: 0.07),
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: Colors.white.withValues(alpha: 0.08)),
        ),
        child: const Row(
          children: <Widget>[
            Icon(Icons.verified_user_outlined,
                color: Color(0xFF9FE0BB), size: 18),
            SizedBox(width: 9),
            Expanded(
              child: Text('Your portfolio is securely managed.',
                  style: TextStyle(
                      color: Color(0xFFC9DCD4),
                      fontSize: 11,
                      height: 1.35,
                      fontWeight: FontWeight.w600)),
            ),
          ],
        ),
      );

  Widget _drawer() => Drawer(
        backgroundColor: _navy,
        child: SafeArea(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(16, 20, 16, 12),
            child: Column(
              children: <Widget>[
                Row(
                  children: <Widget>[
                    Expanded(child: _darkBrand()),
                    IconButton(
                      tooltip: 'Close menu',
                      onPressed: () => Navigator.pop(context),
                      icon: const Icon(Icons.close, color: Colors.white70),
                    ),
                  ],
                ),
                const SizedBox(height: 24),
                const Align(
                  alignment: Alignment.centerLeft,
                  child: Padding(
                    padding: EdgeInsets.only(left: 12, bottom: 10),
                    child: Text('WORKSPACE',
                        style: TextStyle(
                            color: Color(0xFF91B2A5),
                            fontSize: 10,
                            letterSpacing: 1.4,
                            fontWeight: FontWeight.w800)),
                  ),
                ),
                Expanded(
                  child: ListView.builder(
                    itemCount: _navigationOrder.length,
                    itemBuilder: (BuildContext context, int index) {
                      final int sectionIndex = _navigationOrder[index];
                      return sectionIndex < 0
                          ? _createCustomerNavItem(dark: true)
                          : _navItem(sectionIndex, dark: true);
                    },
                  ),
                ),
              ],
            ),
          ),
        ),
      );

  Widget _navItem(int index, {required bool dark}) {
    final _Section item = _sections[index];
    final bool selected = _section == index;
    return Padding(
      padding: const EdgeInsets.only(bottom: 4),
      child: Material(
        color: selected
            ? (dark
                ? Colors.white.withValues(alpha: 0.13)
                : const Color(0xFFE7F7EE))
            : Colors.transparent,
        borderRadius: BorderRadius.circular(12),
        child: InkWell(
          borderRadius: BorderRadius.circular(12),
          onTap: () {
            setState(() => _section = index);
            if (item.title == 'Customer Transactions' ||
                item.title == 'Commission Wallet') {
              _loadExtra(item.title);
            }
            if (MediaQuery.sizeOf(context).width < 960) Navigator.pop(context);
          },
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
            child: Row(
              children: <Widget>[
                Icon(item.icon,
                    size: 18,
                    color: selected
                        ? (dark ? const Color(0xFF7CE1AA) : _greenDark)
                        : (dark ? const Color(0xFFA6BEB4) : _muted)),
                const SizedBox(width: 12),
                Expanded(
                  child: Text(item.title,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                          color: selected
                              ? (dark ? Colors.white : _greenDark)
                              : (dark ? const Color(0xFFD1E0DA) : _muted),
                          fontSize: 12,
                          fontWeight:
                              selected ? FontWeight.w800 : FontWeight.w600)),
                ),
                if (selected)
                  Icon(Icons.chevron_right_rounded,
                      size: 16, color: dark ? const Color(0xFF7CE1AA) : _green),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _createCustomerNavItem({required bool dark}) => Padding(
        padding: const EdgeInsets.only(bottom: 4),
        child: Material(
          color: Colors.transparent,
          borderRadius: BorderRadius.circular(12),
          child: InkWell(
            borderRadius: BorderRadius.circular(12),
            onTap: () {
              if (MediaQuery.sizeOf(context).width < 960) {
                Navigator.pop(context);
              }
              _showCreateCustomer();
            },
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
              child: Row(
                children: <Widget>[
                  Icon(Icons.person_add_alt_1,
                      size: 18,
                      color: dark ? const Color(0xFF7CE1AA) : _greenDark),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Text('Create Customer',
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                            color: dark ? Colors.white : _greenDark,
                            fontSize: 12,
                            fontWeight: FontWeight.w800)),
                  ),
                  Icon(Icons.add_rounded,
                      size: 16, color: dark ? const Color(0xFF7CE1AA) : _green),
                ],
              ),
            ),
          ),
        ),
      );

  String _displaySectionTitle(int index) =>
      index == 2 ? 'My Customers' : _sections[index].title;

  Widget _content() {
    final String title = _sections[_section].title;
    final Map<String, dynamic> response =
        _responses[title] ?? <String, dynamic>{};
    if (title == 'Customer Transactions') return _transactionsPage();
    if (title == 'Commission Wallet') return _commissionWalletPage();
    if (title == 'Targets & Bonuses') return _targetsPage();
    if (response.containsKey('_unavailable')) {
      return _page(<Widget>[
        _pageHeading(title, 'A clear view of your partner workspace.'),
        const SizedBox(height: 18),
        _empty('This section is not available right now.')
      ]);
    }
    if (_section == 0) return _dashboard();
    if (_section == 1) {
      return BusinessPartnerOfficersScreen(
        key: const Key('business-partner-officers'),
        api: _api,
        profile: _profileData(),
      );
    }
    if (_section == 8) return _performance();
    if (_section == 11) return _profile();
    if (title == 'Customers') return _customersPage();
    return _records(title);
  }

  Widget _dashboard() {
    final Map<String, dynamic> profile = _profileData();
    final String name =
        _text(profile['businessName'] ?? profile['name'], 'Business Partner');
    return _page(<Widget>[
      _welcome(name),
      const SizedBox(height: 19),
      _sectionLabel('Portfolio snapshot'),
      const SizedBox(height: 10),
      _quickActions(),
      const SizedBox(height: 19),
      LayoutBuilder(
        builder: (BuildContext context, BoxConstraints constraints) {
          final Widget recent = _recentApplications();
          final Widget activity = _activityCard();
          if (constraints.maxWidth < 760) {
            return Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: <Widget>[
                recent,
                const SizedBox(height: 16),
                activity,
              ],
            );
          }
          return Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Expanded(flex: 6, child: recent),
              const SizedBox(width: 16),
              Expanded(flex: 5, child: activity),
            ],
          );
        },
      ),
      const SizedBox(height: 19),
      _sectionLabel('OPERATING SNAPSHOT'),
      const SizedBox(height: 10),
      _summaryGrid(),
      const SizedBox(height: 19),
      _portfolioCard(),
      const SizedBox(height: 19),
      _sectionLabel('PORTFOLIO DETAIL'),
      const SizedBox(height: 10),
      _dashboardHighlights(),
    ]);
  }

  List<Map<String, dynamic>> _dashboardRows(List<String> keys) {
    final Map<String, dynamic> dashboard = _nested('Dashboard', 'dashboard');
    for (final String key in keys) {
      final List<Map<String, dynamic>> rows = _list(dashboard[key]);
      if (rows.isNotEmpty) return rows;
    }
    return <Map<String, dynamic>>[];
  }

  Widget _dashboardHighlights() {
    final List<Map<String, dynamic>> customers =
        _dashboardRows(<String>['recentCustomers', 'customers']);
    final List<Map<String, dynamic>> transactions =
        _dashboardRows(<String>['recentTransactions', 'transactions']);
    final List<Map<String, dynamic>> officers =
        _dashboardRows(<String>['topPerformingOfficers']);
    final Map<String, dynamic> dashboard = _nested('Dashboard', 'dashboard');
    final List<Map<String, dynamic>> transactionSeries =
        _list(dashboard['transactionChart']);
    final List<Map<String, dynamic>> commissionSeries =
        _list(dashboard['commissionChart']);
    return LayoutBuilder(
      builder: (BuildContext context, BoxConstraints constraints) {
        final bool wide = constraints.maxWidth >= 760;
        final List<Widget> cards = <Widget>[
          _dashboardListCard(
            title: 'Recent customers',
            icon: Icons.people_alt_outlined,
            rows: customers,
            empty: 'Newly acquired customers will appear here.',
            builder: (Map<String, dynamic> row) => _dashboardRow(
              icon: Icons.person_outline_rounded,
              title: _text(row['fullName'] ?? row['name'], 'Customer'),
              subtitle: _date(row['joinedAt'] ?? row['createdAt']),
              trailing: _statusPill(_status(
                row['status'],
              )),
            ),
          ),
          _dashboardListCard(
            title: 'Recent transactions',
            icon: Icons.receipt_long_outlined,
            rows: transactions,
            empty: 'Eligible customer transactions will appear here.',
            builder: (Map<String, dynamic> row) => _dashboardRow(
              icon: Icons.receipt_long_outlined,
              title: _text(row['reference'] ?? row['transactionReference'],
                  'Transaction'),
              subtitle:
                  '${_text(row['service'] ?? row['serviceType'], 'Service')} · ${_money(row['amount'])}',
              trailing: _statusPill(_status(row['status'])),
            ),
          ),
          _dashboardListCard(
            title: 'Top performing officers',
            icon: Icons.stars_outlined,
            rows: officers,
            empty: 'Officer performance will appear as work is completed.',
            builder: (Map<String, dynamic> row) => _dashboardRow(
              icon: Icons.badge_outlined,
              title: _text(row['fullName'] ?? row['name'], 'Officer'),
              subtitle:
                  '${_text(row['transactions'] ?? row['transactionCount'], '0')} transactions · ${_money(row['commission'])}',
              trailing: Text(
                _text(row['performance'] ?? row['score'], '—'),
                style: const TextStyle(
                    color: _greenDark,
                    fontSize: 11,
                    fontWeight: FontWeight.w900),
              ),
            ),
          ),
          _seriesCard('Transaction performance', transactionSeries,
              Icons.trending_up_rounded),
          _seriesCard('Commission earnings', commissionSeries,
              Icons.account_balance_wallet_outlined),
          _targetProgressCard(dashboard),
        ];
        if (!wide) {
          return Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: cards
                  .map((Widget card) => Padding(
                        padding: const EdgeInsets.only(bottom: 14),
                        child: card,
                      ))
                  .toList());
        }
        return Wrap(
          spacing: 14,
          runSpacing: 14,
          children: cards
              .map((Widget card) =>
                  SizedBox(width: (constraints.maxWidth - 14) / 2, child: card))
              .toList(),
        );
      },
    );
  }

  Widget _dashboardListCard({
    required String title,
    required IconData icon,
    required List<Map<String, dynamic>> rows,
    required String empty,
    required Widget Function(Map<String, dynamic>) builder,
  }) =>
      _surfaceCard(
        title: title,
        subtitle: 'Latest updates in your network',
        icon: icon,
        child: rows.isEmpty
            ? _empty(empty)
            : Column(children: rows.take(4).map(builder).toList()),
      );

  Widget _dashboardRow({
    required IconData icon,
    required String title,
    required String subtitle,
    Widget? trailing,
  }) =>
      Padding(
        padding: const EdgeInsets.only(bottom: 10),
        child: Row(
          children: <Widget>[
            Icon(icon, color: _greenDark, size: 18),
            const SizedBox(width: 9),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Text(title,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                          color: _ink,
                          fontSize: 11,
                          fontWeight: FontWeight.w800)),
                  const SizedBox(height: 2),
                  Text(subtitle,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                          color: _muted,
                          fontSize: 10,
                          fontWeight: FontWeight.w600)),
                ],
              ),
            ),
            if (trailing != null) trailing,
          ],
        ),
      );

  Widget _seriesCard(
      String title, List<Map<String, dynamic>> rows, IconData icon) {
    final List<num> values = rows
        .map((Map<String, dynamic> row) => _number(
            row['value'] ?? row['amount'] ?? row['total'] ?? row['count']))
        .toList();
    final num max = values.fold<num>(0, (num a, num b) => a > b ? a : b);
    return _surfaceCard(
      title: title,
      subtitle: rows.isEmpty ? 'Awaiting server activity' : 'Recent period',
      icon: icon,
      child: rows.isEmpty
          ? _empty('Chart data will appear after activity is recorded.')
          : SizedBox(
              height: 116,
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: List<Widget>.generate(rows.length, (int index) {
                  final double factor = max <= 0
                      ? 0
                      : (values[index].toDouble() / max.toDouble())
                          .clamp(0.05, 1.0);
                  return Expanded(
                    child: Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 3),
                      child: Column(
                        mainAxisAlignment: MainAxisAlignment.end,
                        children: <Widget>[
                          Expanded(
                            child: Align(
                              alignment: Alignment.bottomCenter,
                              child: FractionallySizedBox(
                                heightFactor: factor,
                                child: Container(
                                  decoration: BoxDecoration(
                                    color: _green,
                                    borderRadius: BorderRadius.circular(5),
                                  ),
                                ),
                              ),
                            ),
                          ),
                          const SizedBox(height: 5),
                          Text(
                              _text(rows[index]['label'] ?? rows[index]['name'],
                                  '${index + 1}'),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(
                                  color: _muted,
                                  fontSize: 8,
                                  fontWeight: FontWeight.w700)),
                        ],
                      ),
                    ),
                  );
                }),
              ),
            ),
    );
  }

  Widget _targetProgressCard(Map<String, dynamic> dashboard) {
    final List<Map<String, dynamic>> configuredTargets =
        _list((_responses['Targets'] ?? <String, dynamic>{})['targets']);
    final Map<String, dynamic> configured = configuredTargets.isEmpty
        ? <String, dynamic>{}
        : configuredTargets.first;
    final String metric = _text(configured['metric'], '').toUpperCase();
    final dynamic configuredCurrent = metric == 'ACTIVE_CUSTOMERS'
        ? dashboard['activeCustomers']
        : metric == 'TRANSACTION_COUNT'
            ? dashboard['transactionsThisMonth']
            : metric == 'TRANSACTION_VALUE'
                ? dashboard['transactionValueThisMonth']
                : null;
    final Map<String, dynamic> target =
        _map(dashboard['target'] ?? dashboard['targetProgress']);
    final num current = _number(target['current'] ??
        configuredCurrent ??
        dashboard['targetCurrent'] ??
        0);
    final num goal = _number(target['target'] ??
        target['goal'] ??
        configured['target'] ??
        dashboard['monthlyTarget'] ??
        dashboard['target'] ??
        0);
    final double progress =
        goal <= 0 ? 0 : (current.toDouble() / goal.toDouble()).clamp(0, 1);
    return _surfaceCard(
      title: 'Monthly target progress',
      subtitle: goal <= 0 ? 'No target configured' : 'Current month',
      icon: Icons.flag_outlined,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Row(
            children: <Widget>[
              Expanded(
                child: Text(goal <= 0
                    ? 'Target details will appear here.'
                    : '${_money(current)} of ${_money(goal)}'),
              ),
              Text('${(progress * 100).round()}%',
                  style: const TextStyle(
                      color: _greenDark, fontWeight: FontWeight.w900)),
            ],
          ),
          const SizedBox(height: 10),
          ClipRRect(
            borderRadius: BorderRadius.circular(8),
            child: LinearProgressIndicator(
                value: progress,
                minHeight: 10,
                backgroundColor: const Color(0xFFEAF1ED),
                valueColor: const AlwaysStoppedAnimation<Color>(_green)),
          ),
        ],
      ),
    );
  }

  Widget _welcome(String name) => Container(
        padding: const EdgeInsets.fromLTRB(20, 19, 18, 18),
        decoration: BoxDecoration(
          gradient: const LinearGradient(
            colors: <Color>[Color(0xFF123F36), Color(0xFF08794D)],
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
          ),
          borderRadius: BorderRadius.circular(20),
          boxShadow: <BoxShadow>[
            BoxShadow(
                color: _greenDark.withValues(alpha: 0.16),
                blurRadius: 20,
                offset: const Offset(0, 9))
          ],
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  const Text('BUSINESS PARTNER PORTAL',
                      style: TextStyle(
                          color: Color(0xFFB7EBCB),
                          fontSize: 9,
                          letterSpacing: 1.2,
                          fontWeight: FontWeight.w900)),
                  const SizedBox(height: 10),
                  Text('Welcome back, $name',
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                          color: Colors.white,
                          fontSize: 22,
                          height: 1.12,
                          letterSpacing: -0.4,
                          fontWeight: FontWeight.w900)),
                  const SizedBox(height: 7),
                  const Text(
                      'Stay close to your people, applications and portfolio progress.',
                      style: TextStyle(
                          color: Color(0xFFC5E7D5),
                          fontSize: 12,
                          height: 1.4,
                          fontWeight: FontWeight.w500)),
                ],
              ),
            ),
            const SizedBox(width: 12),
            Container(
              width: 47,
              height: 47,
              decoration: BoxDecoration(
                  color: Colors.white.withValues(alpha: 0.13),
                  shape: BoxShape.circle),
              child: const Icon(Icons.insights_rounded,
                  color: Color(0xFFBEEFD1), size: 23),
            ),
          ],
        ),
      );

  List<_Metric> _metrics() {
    final Map<String, dynamic> dashboard = _nested('Dashboard', 'dashboard');
    final List<Map<String, dynamic>> solar = _applications('solar');
    final List<Map<String, dynamic>> phone = _applications('phone');
    final Map<String, dynamic> officerGroups = _map(
        (_responses['Officer Management'] ?? <String, dynamic>{})['officers']);
    final int officerCount = _list(officerGroups['solar']).length +
        _list(officerGroups['phone']).length;
    final int customerCount =
        _list((_responses['Customers'] ?? <String, dynamic>{})['customers'])
            .length;
    final num totalSales = <Map<String, dynamic>>[...solar, ...phone]
        .fold<num>(0, (num sum, Map<String, dynamic> app) {
      final Map<String, dynamic> amounts = _map(app['amounts']);
      return sum + _number(amounts['totalPayable']);
    });
    final num outstanding = <Map<String, dynamic>>[...solar, ...phone]
        .fold<num>(0, (num sum, Map<String, dynamic> app) {
      final Map<String, dynamic> amounts = _map(app['amounts']);
      return sum + _number(amounts['outstandingBalance']);
    });
    final List<Map<String, dynamic>> commissions =
        _list((_responses['Commission'] ?? <String, dynamic>{})['commissions']);
    final num commissionBalance = commissions.fold<num>(
        0, (num sum, Map<String, dynamic> row) => sum + _number(row['amount']));
    final int completed = <Map<String, dynamic>>[...solar, ...phone]
        .where((Map<String, dynamic> row) {
      final String status = _text(row['status'], '').toUpperCase();
      return <String>['COMPLETED', 'PAID', 'APPROVED', 'ACTIVE']
          .contains(status);
    }).length;
    final int total = solar.length + phone.length;
    final String performance =
        total == 0 ? '—' : '${((completed / total) * 100).round()}%';
    num dashboardNumber(List<String> keys, [num fallback = 0]) {
      for (final String key in keys) {
        if (dashboard.containsKey(key) && dashboard[key] != null) {
          return _number(dashboard[key]);
        }
      }
      return fallback;
    }

    final num customers = dashboardNumber(
        <String>['totalCustomers', 'activeCustomers', 'customers'],
        customerCount);
    final num activeCustomers = dashboardNumber(
        <String>['activeCustomers', 'totalCustomers'], customerCount);
    final num officers =
        dashboardNumber(<String>['totalOfficers', 'officers'], officerCount);
    final num activeOfficers =
        dashboardNumber(<String>['activeOfficers'], officers);
    final num transactionsToday = dashboardNumber(
        <String>['transactionsToday', 'todayTransactions'], total);
    final num transactionsMonth = dashboardNumber(
        <String>['transactionsThisMonth', 'monthlyTransactions'], total);
    final num valueToday = dashboardNumber(
        <String>['transactionValueToday', 'salesValueToday'], totalSales);
    final num valueMonth = dashboardNumber(
        <String>['transactionValueThisMonth', 'salesValueThisMonth'],
        totalSales);
    final num commissionToday =
        dashboardNumber(<String>['commissionToday'], commissionBalance);
    final num commissionMonth =
        dashboardNumber(<String>['commissionThisMonth'], commissionBalance);
    final num availableCommission = dashboardNumber(
        <String>['availableCommission', 'commissionBalance'],
        commissionBalance);
    final num pendingCommission =
        dashboardNumber(<String>['pendingCommission'], 0);
    final num lifetimeCommission =
        dashboardNumber(<String>['lifetimeCommission'], commissionBalance);
    return <_Metric>[
      _Metric('Total Customers', '${customers.toInt()}',
          Icons.people_alt_outlined, const Color(0xFFEAF4FF)),
      _Metric('Active Customers', '${activeCustomers.toInt()}',
          Icons.person_pin_circle_outlined, const Color(0xFFE8F7EF)),
      _Metric('Total Officers', '${officers.toInt()}', Icons.badge_outlined,
          const Color(0xFFE8F7EF)),
      _Metric('Active Officers', '${activeOfficers.toInt()}',
          Icons.verified_user_outlined, const Color(0xFFF1ECFF)),
      _Metric('Transactions today', '${transactionsToday.toInt()}',
          Icons.receipt_long_outlined, const Color(0xFFFFF5DE)),
      _Metric('Transactions this month', '${transactionsMonth.toInt()}',
          Icons.calendar_month_outlined, const Color(0xFFF1ECFF)),
      _Metric('Transaction value today', _money(valueToday),
          Icons.trending_up_rounded, const Color(0xFFE8F7EF)),
      _Metric('Transaction value this month', _money(valueMonth),
          Icons.assessment_outlined, const Color(0xFFEAF4FF)),
      _Metric('Commission today', _money(commissionToday),
          Icons.payments_outlined, const Color(0xFFFFF5DE)),
      _Metric('Commission this month', _money(commissionMonth),
          Icons.date_range_outlined, const Color(0xFFE8F7EF)),
      _Metric('Available commission', _money(availableCommission),
          Icons.account_balance_wallet_outlined, const Color(0xFFEAF4FF)),
      _Metric('Pending commission', _money(pendingCommission),
          Icons.hourglass_top_outlined, const Color(0xFFFFEFEB)),
      _Metric('Lifetime commission', _money(lifetimeCommission),
          Icons.stars_outlined, const Color(0xFFF1ECFF)),
      _Metric('Target progress', _targetMetricValue(dashboard),
          Icons.flag_outlined, const Color(0xFFEAF7F0)),
      _Metric('Solar Applications', '${solar.length}', Icons.wb_sunny_outlined,
          const Color(0xFFFFF5DE)),
      _Metric('Phone Applications', '${phone.length}',
          Icons.smartphone_outlined, const Color(0xFFF1ECFF)),
      _Metric('Outstanding Repayments', _money(outstanding),
          Icons.payments_outlined, const Color(0xFFFFEFEB)),
      _Metric('Performance', performance, Icons.insights_outlined,
          const Color(0xFFF1ECFF)),
    ];
  }

  Widget _summaryGrid() => LayoutBuilder(
        builder: (BuildContext context, BoxConstraints constraints) {
          final int columns = constraints.maxWidth >= 980
              ? 4
              : constraints.maxWidth >= 610
                  ? 3
                  : 2;
          const double gap = 11;
          final double width =
              (constraints.maxWidth - gap * (columns - 1)) / columns;
          return Wrap(
            spacing: gap,
            runSpacing: gap,
            children: _metrics()
                .map((metric) =>
                    SizedBox(width: width, child: _metricCard(metric)))
                .toList(),
          );
        },
      );

  Widget _metricCard(_Metric metric) => Container(
        padding: const EdgeInsets.all(13),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: _line),
          boxShadow: <BoxShadow>[
            BoxShadow(
                color: Colors.black.withValues(alpha: 0.025),
                blurRadius: 9,
                offset: const Offset(0, 3))
          ],
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Container(
              width: 34,
              height: 34,
              decoration: BoxDecoration(
                  color: metric.tint, borderRadius: BorderRadius.circular(11)),
              child: Icon(metric.icon, color: _greenDark, size: 18),
            ),
            const SizedBox(height: 12),
            Text(metric.label,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                    color: _muted,
                    fontSize: 10.5,
                    height: 1.2,
                    fontWeight: FontWeight.w700)),
            const SizedBox(height: 5),
            Text(metric.value,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                    color: _ink,
                    fontSize: 17,
                    letterSpacing: -0.3,
                    fontWeight: FontWeight.w900)),
          ],
        ),
      );

  Widget _quickActions() => _surfaceCard(
        title: 'Quick actions',
        subtitle: 'Move around your portfolio faster',
        icon: Icons.bolt_rounded,
        child: LayoutBuilder(
          builder: (BuildContext context, BoxConstraints constraints) {
            final int columns = constraints.maxWidth < 520 ? 2 : 4;
            final double gap = 9;
            final double width =
                (constraints.maxWidth - gap * (columns - 1)) / columns;
            final List<_QuickAction> actions = <_QuickAction>[
              const _QuickAction('Create Customer', Icons.person_add_alt_1, -1),
              const _QuickAction('Create Officer', Icons.badge_outlined, 1),
              const _QuickAction('My Customers', Icons.people_alt_outlined, 2),
              const _QuickAction(
                  'View Transactions', Icons.receipt_long_outlined, 12),
              const _QuickAction('Commission Wallet',
                  Icons.account_balance_wallet_outlined, 13),
              const _QuickAction('Targets & Bonuses', Icons.flag_outlined, 14),
              const _QuickAction('Reports', Icons.bar_chart_rounded, 9),
              const _QuickAction('Applications', Icons.description_outlined, 5),
              const _QuickAction('Repayments', Icons.payments_outlined, 6),
            ];
            return Wrap(
              spacing: gap,
              runSpacing: gap,
              children: actions
                  .map((action) =>
                      SizedBox(width: width, child: _quickAction(action)))
                  .toList(),
            );
          },
        ),
      );

  Widget _quickAction(_QuickAction action) => Material(
        color: const Color(0xFFF5F9F7),
        borderRadius: BorderRadius.circular(13),
        child: InkWell(
          borderRadius: BorderRadius.circular(13),
          onTap: () {
            if (action.section < 0) {
              _showCreateCustomer();
              return;
            }
            setState(() => _section = action.section);
            if (action.section == 12 || action.section == 13) {
              _loadExtra(_sections[action.section].title);
            }
          },
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 11),
            child: Row(
              children: <Widget>[
                Icon(action.icon, color: _greenDark, size: 18),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(action.label,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                          color: _ink,
                          fontSize: 11,
                          fontWeight: FontWeight.w800)),
                ),
                const Icon(Icons.arrow_outward_rounded,
                    color: _muted, size: 14),
              ],
            ),
          ),
        ),
      );

  String _targetMetricValue(Map<String, dynamic> dashboard) {
    final List<Map<String, dynamic>> configuredTargets =
        _list((_responses['Targets'] ?? <String, dynamic>{})['targets']);
    final Map<String, dynamic> configured = configuredTargets.isEmpty
        ? <String, dynamic>{}
        : configuredTargets.first;
    final Map<String, dynamic> target =
        _map(dashboard['target'] ?? dashboard['targetProgress']);
    final num current = _number(target['current'] ??
        dashboard['targetCurrent'] ??
        configured['current'] ??
        0);
    final num goal = _number(target['target'] ??
        target['goal'] ??
        configured['target'] ??
        dashboard['monthlyTarget'] ??
        0);
    if (goal <= 0) return '—';
    return '${((current.toDouble() / goal.toDouble()).clamp(0, 1) * 100).round()}%';
  }

  Widget _recentApplications() {
    final List<Map<String, dynamic>> rows = _allApplications()
      ..sort((Map<String, dynamic> a, Map<String, dynamic> b) =>
          _text(b['createdAt'], '').compareTo(_text(a['createdAt'], '')));
    return _surfaceCard(
      title: 'Recent applications',
      subtitle: 'Latest activity across your services',
      icon: Icons.description_outlined,
      trailing: TextButton(
          onPressed: () => setState(() => _section = 5),
          child: const Text('View all')),
      child: rows.isEmpty
          ? _empty('New applications will appear here.')
          : Column(
              children: rows.take(4).map(_recentApplication).toList(),
            ),
    );
  }

  Widget _recentApplication(Map<String, dynamic> row) {
    final Map<String, dynamic> customer = _map(row['customer']);
    final Map<String, dynamic> amounts = _map(row['amounts']);
    final String service =
        _text(row['service'] ?? row['_serviceKind'], 'Application')
            .replaceAll('_', ' ');
    return Padding(
      padding: const EdgeInsets.only(bottom: 11),
      child: Row(
        children: <Widget>[
          Container(
            width: 34,
            height: 34,
            decoration: BoxDecoration(
                color: service.toUpperCase().contains('SOLAR')
                    ? const Color(0xFFFFF4D9)
                    : const Color(0xFFEAF4FF),
                borderRadius: BorderRadius.circular(11)),
            child: Icon(
                service.toUpperCase().contains('SOLAR')
                    ? Icons.wb_sunny_outlined
                    : Icons.smartphone_outlined,
                color: _greenDark,
                size: 17),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Text(
                    _text(customer['fullName'] ?? row['customerName'],
                        'Customer'),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                        color: _ink,
                        fontSize: 12,
                        fontWeight: FontWeight.w800)),
                const SizedBox(height: 3),
                Text(service,
                    style: const TextStyle(
                        color: _muted,
                        fontSize: 10,
                        fontWeight: FontWeight.w600)),
              ],
            ),
          ),
          Column(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: <Widget>[
              Text(_money(amounts['totalPayable'] ?? row['amount']),
                  style: const TextStyle(
                      color: _ink, fontSize: 11, fontWeight: FontWeight.w800)),
              const SizedBox(height: 3),
              _statusPill(_status(row['status'])),
            ],
          ),
        ],
      ),
    );
  }

  Widget _activityCard() {
    final Map<String, dynamic> response =
        _responses['Activity'] ?? <String, dynamic>{};
    final List<Map<String, dynamic>> items =
        _list(response['activity'] ?? response['items'] ?? response['data']);
    return _surfaceCard(
      title: 'Recent activity',
      subtitle: 'Your latest workspace updates',
      icon: Icons.bolt_rounded,
      trailing: TextButton(
          onPressed: () => setState(() => _section = 10),
          child: const Text('View all')),
      child: items.isEmpty
          ? _empty('Your latest updates will appear here.')
          : Column(
              children: items.take(4).map((Map<String, dynamic> item) {
                final String action = _activityLabel(item);
                return Padding(
                  padding: const EdgeInsets.only(bottom: 11),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: <Widget>[
                      Container(
                        width: 29,
                        height: 29,
                        decoration: const BoxDecoration(
                            color: Color(0xFFE8F7EF), shape: BoxShape.circle),
                        child: const Icon(Icons.check_rounded,
                            color: _greenDark, size: 16),
                      ),
                      const SizedBox(width: 9),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: <Widget>[
                            Text(action,
                                maxLines: 2,
                                overflow: TextOverflow.ellipsis,
                                style: const TextStyle(
                                    color: _ink,
                                    fontSize: 11,
                                    height: 1.3,
                                    fontWeight: FontWeight.w700)),
                            const SizedBox(height: 3),
                            Text(_date(item['createdAt']),
                                style: const TextStyle(
                                    color: _muted,
                                    fontSize: 10,
                                    fontWeight: FontWeight.w600)),
                          ],
                        ),
                      ),
                    ],
                  ),
                );
              }).toList(),
            ),
    );
  }

  String _activityLabel(Map<String, dynamic> item) {
    final String title = _text(item['title'] ?? item['description'], '');
    if (title.isNotEmpty) return title;
    final String action = _text(item['action'], '').toUpperCase();
    const Map<String, String> labels = <String, String>{
      'BUSINESS_PARTNER_CREATED': 'Your partner workspace was created',
      'BUSINESS_PARTNER_STATUS_UPDATED': 'Your workspace status was updated',
      'BUSINESS_PARTNER_APPLICATION_ASSIGNED':
          'A new application was added to your portfolio',
      'BUSINESS_PARTNER_OFFICER_ASSIGNED':
          'An officer was added to your portfolio',
      'BUSINESS_PARTNER_VERIFICATION_REVIEWED':
          'A verification review was recorded',
    };
    return labels[action] ?? 'A portfolio update was recorded';
  }

  Widget _portfolioCard() {
    final List<Map<String, dynamic>> solar = _applications('solar');
    final List<Map<String, dynamic>> phone = _applications('phone');
    final num solarValue = solar.fold<num>(
        0,
        (num sum, Map<String, dynamic> row) =>
            sum + _number(_map(row['amounts'])['totalPayable']));
    final num phoneValue = phone.fold<num>(
        0,
        (num sum, Map<String, dynamic> row) =>
            sum + _number(_map(row['amounts'])['totalPayable']));
    final num maxValue = solarValue > phoneValue ? solarValue : phoneValue;
    return _surfaceCard(
      title: 'Portfolio snapshot',
      subtitle: 'A simple view of your current sales mix',
      icon: Icons.bar_chart_rounded,
      child: Column(
        children: <Widget>[
          _portfolioBar('Assigned Solar', solarValue, maxValue,
              const Color(0xFF23A768), Icons.wb_sunny_outlined),
          const SizedBox(height: 17),
          _portfolioBar('Assigned Phones', phoneValue, maxValue,
              const Color(0xFF77A9E8), Icons.smartphone_outlined),
          const SizedBox(height: 17),
          Row(
            children: <Widget>[
              Expanded(
                child: _miniStat(
                    'Applications',
                    '${solar.length + phone.length}',
                    Icons.description_outlined),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: _miniStat('Sales value', _money(solarValue + phoneValue),
                    Icons.trending_up_rounded),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _portfolioBar(
      String label, num value, num max, Color color, IconData icon) {
    final double factor =
        max <= 0 ? 0 : (value.toDouble() / max.toDouble()).clamp(0.0, 1.0);
    return Row(
      children: <Widget>[
        Container(
            width: 31,
            height: 31,
            decoration: BoxDecoration(
                color: color.withValues(alpha: 0.12),
                borderRadius: BorderRadius.circular(10)),
            child: Icon(icon, color: color, size: 16)),
        const SizedBox(width: 10),
        SizedBox(
          width: 94,
          child: Text(label,
              style: const TextStyle(
                  color: _ink, fontSize: 11, fontWeight: FontWeight.w800)),
        ),
        Expanded(
          child: ClipRRect(
            borderRadius: BorderRadius.circular(10),
            child: LinearProgressIndicator(
                value: factor,
                minHeight: 9,
                backgroundColor: const Color(0xFFEAF1ED),
                valueColor: AlwaysStoppedAnimation<Color>(color)),
          ),
        ),
        const SizedBox(width: 10),
        Text(_money(value),
            style: const TextStyle(
                color: _ink, fontSize: 10, fontWeight: FontWeight.w800)),
      ],
    );
  }

  Widget _miniStat(String label, String value, IconData icon) => Container(
        padding: const EdgeInsets.all(11),
        decoration: BoxDecoration(
            color: const Color(0xFFF5F9F7),
            borderRadius: BorderRadius.circular(12)),
        child: Row(
          children: <Widget>[
            Icon(icon, color: _greenDark, size: 17),
            const SizedBox(width: 8),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Text(label,
                      style: const TextStyle(
                          color: _muted,
                          fontSize: 9,
                          fontWeight: FontWeight.w700)),
                  const SizedBox(height: 3),
                  Text(value,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                          color: _ink,
                          fontSize: 12,
                          fontWeight: FontWeight.w900)),
                ],
              ),
            ),
          ],
        ),
      );

  Widget _surfaceCard({
    required String title,
    required String subtitle,
    required IconData icon,
    required Widget child,
    Widget? trailing,
  }) =>
      Container(
        padding: const EdgeInsets.fromLTRB(16, 15, 16, 16),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(17),
          border: Border.all(color: _line),
          boxShadow: <BoxShadow>[
            BoxShadow(
                color: Colors.black.withValues(alpha: 0.025),
                blurRadius: 12,
                offset: const Offset(0, 4))
          ],
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Row(
              children: <Widget>[
                Container(
                  width: 32,
                  height: 32,
                  decoration: BoxDecoration(
                      color: const Color(0xFFE9F7EF),
                      borderRadius: BorderRadius.circular(10)),
                  child: Icon(icon, color: _greenDark, size: 17),
                ),
                const SizedBox(width: 9),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: <Widget>[
                      Text(title,
                          style: const TextStyle(
                              color: _ink,
                              fontSize: 13,
                              fontWeight: FontWeight.w900)),
                      const SizedBox(height: 2),
                      Text(subtitle,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(color: _muted, fontSize: 10)),
                    ],
                  ),
                ),
                if (trailing != null) trailing,
              ],
            ),
            const SizedBox(height: 14),
            child,
          ],
        ),
      );

  Widget _records(String title) {
    final Map<String, dynamic> source =
        _responses[title] ?? <String, dynamic>{};
    final bool filterable = <String>[
      'Customers',
      'Assigned Solar',
      'Assigned Phones',
      'Sales & Applications',
      'Repayments'
    ].contains(title);
    final List<Widget> rows = _recordWidgets(title, source);
    return _page(<Widget>[
      _pageHeading(title, _sectionSubtitle(title),
          action: filterable
              ? Wrap(
                  spacing: 6,
                  crossAxisAlignment: WrapCrossAlignment.center,
                  children: <Widget>[
                    _filterMenu(),
                    IconButton(
                        tooltip: 'More filters',
                        onPressed: _filterDialog,
                        icon: const Icon(Icons.tune_rounded, color: _muted)),
                  ],
                )
              : null),
      const SizedBox(height: 16),
      if (rows.isEmpty)
        _empty('No ${title.toLowerCase()} records found.')
      else
        LayoutBuilder(
          builder: (BuildContext context, BoxConstraints constraints) {
            final bool twoColumns = constraints.maxWidth >= 760;
            if (!twoColumns) {
              return Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: rows);
            }
            return Wrap(
                spacing: 12,
                runSpacing: 12,
                children: rows
                    .map((Widget row) => SizedBox(
                        width: (constraints.maxWidth - 12) / 2, child: row))
                    .toList());
          },
        ),
    ]);
  }

  Widget _customersPage() {
    final List<Map<String, dynamic>> all =
        _list((_responses['Customers'] ?? <String, dynamic>{})['customers']);
    final int pages = _customerPages;
    final int page = _customerPage.clamp(0, pages - 1);
    final List<Map<String, dynamic>> rows = all;
    return _page(<Widget>[
      _pageHeading(
          'My Customers', 'Customers securely connected to your network.',
          action: FilledButton.icon(
            key: const Key('business-partner-create-customer'),
            onPressed: _showCreateCustomer,
            icon: const Icon(Icons.person_add_alt_1, size: 16),
            label: const Text('Create customer'),
          )),
      const SizedBox(height: 14),
      _surfaceCard(
        title: 'Customer directory',
        subtitle:
            '${_number((_responses['Customers'] ?? <String, dynamic>{})['pagination']?['total']).toInt()} customers in this view',
        icon: Icons.people_alt_outlined,
        child: Column(
          children: <Widget>[
            TextField(
              key: const Key('business-partner-customer-search'),
              decoration: const InputDecoration(
                prefixIcon: Icon(Icons.search_rounded),
                labelText: 'Search by name, phone or account ID',
              ),
              onChanged: (String value) {
                _customerSearch = value;
                _reloadCustomers(resetPage: true);
              },
            ),
            const SizedBox(height: 10),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: <Widget>[
                _smallFilter(
                  label: 'Status',
                  value: _customerStatus,
                  values: const <String>['ALL', 'ACTIVE', 'SUSPENDED'],
                  onChanged: (String value) {
                    _customerStatus = value;
                    _reloadCustomers(resetPage: true);
                  },
                ),
                _smallFilter(
                  label: 'KYC',
                  value: _customerKyc,
                  values: const <String>[
                    'ALL',
                    'VERIFIED',
                    'PENDING',
                    'REJECTED'
                  ],
                  onChanged: (String value) {
                    _customerKyc = value;
                    _reloadCustomers(resetPage: true);
                  },
                ),
                OutlinedButton.icon(
                  onPressed: _filterDialog,
                  icon: const Icon(Icons.tune_rounded, size: 16),
                  label: const Text('Date / officer'),
                ),
              ],
            ),
            const SizedBox(height: 14),
            if (rows.isEmpty)
              _empty('No customers match these filters.')
            else
              Column(
                children: rows.map((Map<String, dynamic> row) {
                  final Widget card = _customerCard(row);
                  return Padding(
                    padding: const EdgeInsets.only(bottom: 10),
                    child: InkWell(
                      borderRadius: BorderRadius.circular(16),
                      onTap: () => _showCustomerDetail(row),
                      child: card,
                    ),
                  );
                }).toList(),
              ),
            if (pages > 1) ...<Widget>[
              const Divider(height: 22),
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: <Widget>[
                  Text('Page ${page + 1} of $pages',
                      style: const TextStyle(
                          color: _muted,
                          fontSize: 11,
                          fontWeight: FontWeight.w700)),
                  Row(
                    children: <Widget>[
                      IconButton(
                        tooltip: 'Previous page',
                        onPressed: page == 0
                            ? null
                            : () {
                                setState(() => _customerPage--);
                                _reloadCustomers();
                              },
                        icon: const Icon(Icons.chevron_left_rounded),
                      ),
                      IconButton(
                        tooltip: 'Next page',
                        onPressed: page >= pages - 1
                            ? null
                            : () {
                                setState(() => _customerPage++);
                                _reloadCustomers();
                              },
                        icon: const Icon(Icons.chevron_right_rounded),
                      ),
                    ],
                  ),
                ],
              ),
            ],
          ],
        ),
      ),
    ]);
  }

  Widget _smallFilter({
    required String label,
    required String value,
    required List<String> values,
    required ValueChanged<String> onChanged,
  }) =>
      DropdownButtonHideUnderline(
        child: DropdownButton<String>(
          value: value,
          isDense: true,
          isExpanded: true,
          borderRadius: BorderRadius.circular(12),
          items: values
              .map((String item) => DropdownMenuItem<String>(
                  value: item,
                  child: Text('$label: $item',
                      maxLines: 1, overflow: TextOverflow.ellipsis)))
              .toList(),
          onChanged: (String? next) {
            if (next != null) onChanged(next);
          },
        ),
      );

  Widget _transactionsPage() {
    final Map<String, dynamic> source =
        _responses['Customer Transactions'] ?? <String, dynamic>{};
    if (_extraLoading.contains('Customer Transactions') && source.isEmpty) {
      return const Center(child: CircularProgressIndicator(color: _green));
    }
    if (source.containsKey('_unavailable')) {
      return _page(<Widget>[
        _pageHeading('Customer Transactions',
            'Transactions are limited to your authorized customer network.'),
        const SizedBox(height: 16),
        _empty(_text(source['_unavailable'],
            'Customer transactions are not available right now.')),
      ]);
    }
    final List<Map<String, dynamic>> all =
        _list(source['transactions'] ?? source['data'] ?? source['items']);
    final Map<String, dynamic> pagination = _map(source['pagination']);
    final int pages = _transactionPages;
    final int page = _transactionPage.clamp(0, pages - 1);
    final List<Map<String, dynamic>> rows = all;
    return _page(<Widget>[
      _pageHeading('Customer Transactions',
          'Scoped transaction activity and commission visibility.'),
      const SizedBox(height: 14),
      _surfaceCard(
        title: 'Transaction history',
        subtitle:
            '${_number(pagination['total']).toInt()} transactions in this view',
        icon: Icons.receipt_long_outlined,
        child: Column(
          children: <Widget>[
            TextField(
              key: const Key('business-partner-transaction-search'),
              decoration: const InputDecoration(
                  prefixIcon: Icon(Icons.search_rounded),
                  labelText: 'Search reference, customer or service'),
              onChanged: (String value) {
                _transactionSearch = value;
                _transactionPage = 0;
                _loadExtra('Customer Transactions');
              },
            ),
            const SizedBox(height: 10),
            Align(
              alignment: Alignment.centerLeft,
              child: _smallFilter(
                label: 'Status',
                value: _transactionStatus,
                values: const <String>[
                  'ALL',
                  'PENDING',
                  'SUCCESSFUL',
                  'FAILED'
                ],
                onChanged: (String value) {
                  _transactionStatus = value;
                  _transactionPage = 0;
                  _loadExtra('Customer Transactions');
                },
              ),
            ),
            const SizedBox(height: 12),
            if (rows.isEmpty)
              _empty('No customer transactions match these filters.')
            else
              Column(
                children: rows
                    .map((Map<String, dynamic> row) => Padding(
                          padding: const EdgeInsets.only(bottom: 10),
                          child: InkWell(
                            borderRadius: BorderRadius.circular(16),
                            onTap: () => _showTransactionDetail(row),
                            child: _transactionCard(row),
                          ),
                        ))
                    .toList(),
              ),
            if (pages > 1) ...<Widget>[
              const Divider(height: 22),
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: <Widget>[
                  Text('Page ${page + 1} of $pages',
                      style: const TextStyle(
                          color: _muted,
                          fontSize: 11,
                          fontWeight: FontWeight.w700)),
                  Row(children: <Widget>[
                    IconButton(
                        onPressed: page == 0
                            ? null
                            : () {
                                setState(() => _transactionPage--);
                                _loadExtra('Customer Transactions');
                              },
                        icon: const Icon(Icons.chevron_left_rounded)),
                    IconButton(
                        onPressed: page >= pages - 1
                            ? null
                            : () {
                                setState(() => _transactionPage++);
                                _loadExtra('Customer Transactions');
                              },
                        icon: const Icon(Icons.chevron_right_rounded)),
                  ]),
                ],
              ),
            ],
          ],
        ),
      ),
    ]);
  }

  Widget _transactionCard(Map<String, dynamic> row) => _recordCard(
        icon: Icons.receipt_long_outlined,
        title: _text(row['reference'] ?? row['transactionReference'],
            'Customer transaction'),
        subtitle: _text(row['service'] ?? row['serviceType'], 'Service'),
        details: <_Detail>[
          _Detail(
              'Customer',
              _text(row['customerName'] ?? _map(row['customer'])['fullName'],
                  'Customer')),
          _Detail('Amount', _money(row['amount'])),
          _Detail('Date', _date(row['createdAt'] ?? row['date'])),
          _Detail('Partner commission',
              _money(row['partnerCommission'] ?? row['commissionAmount'])),
        ],
        trailing: _statusPill(_status(row['status'])),
      );

  Widget _commissionWalletPage() {
    final Map<String, dynamic> source =
        _responses['Commission Wallet'] ?? <String, dynamic>{};
    if (_extraLoading.contains('Commission Wallet') && source.isEmpty) {
      return const Center(child: CircularProgressIndicator(color: _green));
    }
    if (source.containsKey('_unavailable')) {
      return _page(<Widget>[
        _pageHeading(
            'Commission Wallet', 'Read-only earnings and settlement history.'),
        const SizedBox(height: 16),
        _empty(_text(source['_unavailable'],
            'Commission wallet is not available right now.')),
      ]);
    }
    final Map<String, dynamic> wallet =
        _map(source['wallet'] ?? source['summary'] ?? source['data']);
    final List<Map<String, dynamic>> history = _list(source['ledger']);
    final List<Map<String, dynamic>> visibleHistory = history
        .where((Map<String, dynamic> row) =>
            _commissionTypeFilter == 'ALL' ||
            _commissionType(row) == _commissionTypeFilter)
        .toList();
    final Map<String, dynamic> pagination = _map(source['pagination']);
    final int pages = _commissionPages;
    final int page = _commissionPage.clamp(0, pages - 1);
    String walletValue(List<String> keys) {
      for (final String key in keys) {
        if (wallet.containsKey(key)) return _money(wallet[key]);
      }
      return _money(0);
    }

    return _page(<Widget>[
      _pageHeading(
          'Commission Wallet', 'Read-only earnings and settlement history.'),
      const SizedBox(height: 16),
      LayoutBuilder(
        builder: (BuildContext context, BoxConstraints constraints) {
          final double width =
              constraints.maxWidth < 500 ? (constraints.maxWidth - 10) / 2 : 0;
          final List<_Metric> cards = <_Metric>[
            _Metric(
                'Available commission',
                walletValue(
                    <String>['available', 'availableCommission', 'balance']),
                Icons.account_balance_wallet_outlined,
                const Color(0xFFE8F7EF)),
            _Metric(
                'Pending commission',
                walletValue(<String>['pending', 'pendingCommission']),
                Icons.hourglass_top_outlined,
                const Color(0xFFFFF5DE)),
            _Metric(
                'Paid commission',
                walletValue(<String>['paid', 'paidCommission']),
                Icons.check_circle_outline,
                const Color(0xFFEAF4FF)),
            _Metric(
                'Lifetime earnings',
                walletValue(
                    <String>['lifetime', 'lifetimeCommission', 'total']),
                Icons.stars_outlined,
                const Color(0xFFF1ECFF)),
          ];
          return Wrap(
            spacing: 10,
            runSpacing: 10,
            children: cards
                .map(((_Metric card) => SizedBox(
                    width: width == 0 ? (constraints.maxWidth - 30) / 4 : width,
                    child: _metricCard(card))))
                .toList(),
          );
        },
      ),
      const SizedBox(height: 16),
      _surfaceCard(
        title: 'Commission history',
        subtitle:
            '${_number(pagination['total']).toInt()} ledger entries supplied by ServicePay',
        icon: Icons.history_rounded,
        child: Column(
          children: <Widget>[
            Align(
              alignment: Alignment.centerLeft,
              child: _smallFilter(
                label: 'Bonus type',
                value: _commissionTypeFilter,
                values: const <String>[
                  'ALL',
                  'PERFORMANCE_BONUS',
                  'CAMPAIGN_BONUS',
                ],
                onChanged: (String value) =>
                    setState(() => _commissionTypeFilter = value),
              ),
            ),
            const SizedBox(height: 10),
            if (visibleHistory.isEmpty)
              _empty(_commissionTypeFilter == 'ALL'
                  ? 'Commission entries will appear as eligible transactions settle.'
                  : 'No $_commissionTypeFilter entries in this ledger page.')
            else
              ...visibleHistory.map(_commissionCard),
            if (pages > 1) ...<Widget>[
              const Divider(height: 22),
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: <Widget>[
                  Text('Page ${page + 1} of $pages',
                      style: const TextStyle(
                          color: _muted,
                          fontSize: 11,
                          fontWeight: FontWeight.w700)),
                  Row(children: <Widget>[
                    IconButton(
                        onPressed: page == 0
                            ? null
                            : () {
                                setState(() => _commissionPage--);
                                _loadExtra('Commission Wallet');
                              },
                        icon: const Icon(Icons.chevron_left_rounded)),
                    IconButton(
                        onPressed: page >= pages - 1
                            ? null
                            : () {
                                setState(() => _commissionPage++);
                                _loadExtra('Commission Wallet');
                              },
                        icon: const Icon(Icons.chevron_right_rounded)),
                  ]),
                ],
              ),
            ],
          ],
        ),
      ),
    ]);
  }

  String _sectionSubtitle(String title) {
    const Map<String, String> subtitles = <String, String>{
      'Officer Management': 'People supporting your partner portfolio',
      'Customers': 'Customers connected to your applications',
      'Assigned Solar': 'Solar applications assigned to your portfolio',
      'Assigned Phones':
          'Phone financing applications assigned to your portfolio',
      'Sales & Applications': 'All applications across your services',
      'Repayments': 'Payment activity from your portfolio',
      'Commission': 'Commission activity for your workspace',
      'Reports': 'A clear view of portfolio reporting',
      'Notifications': 'Updates and messages for your workspace',
    };
    return subtitles[title] ?? 'A clear view of your partner workspace.';
  }

  List<Widget> _recordWidgets(String title, Map<String, dynamic> source) {
    if (title == 'Officer Management') {
      final Map<String, dynamic> officers = _map(source['officers']);
      return <Map<String, dynamic>>[
        ..._list(officers['solar']).map((Map<String, dynamic> row) =>
            <String, dynamic>{...row, '_kind': 'Solar Officer'}),
        ..._list(officers['phone']).map((Map<String, dynamic> row) =>
            <String, dynamic>{...row, '_kind': 'Phone Officer'}),
      ].map(_officerCard).toList();
    }
    if (title == 'Customers') {
      return _list(source['customers'])
          .where(_matchesFilter)
          .map(_customerCard)
          .toList();
    }
    if (title == 'Assigned Solar' ||
        title == 'Assigned Phones' ||
        title == 'Sales & Applications') {
      final List<Map<String, dynamic>> rows = title == 'Assigned Solar'
          ? _applications('solar')
          : title == 'Assigned Phones'
              ? _applications('phone')
              : _allApplications();
      return rows.where(_matchesFilter).map(_applicationCard).toList();
    }
    if (title == 'Repayments') {
      final Map<String, dynamic> repayments = _map(source['repayments']);
      return <Map<String, dynamic>>[
        ..._list(repayments['solar']),
        ..._list(repayments['phone']),
      ].where(_matchesFilter).map(_repaymentCard).toList();
    }
    if (title == 'Commission') {
      return _list(source['commissions']).map(_commissionCard).toList();
    }
    if (title == 'Notifications') {
      return _list(source['notifications']).map(_notificationCard).toList();
    }
    if (title == 'Reports') {
      return _reportCards(_nested('Reports', 'performance'));
    }
    final List<Map<String, dynamic>> activities =
        _list(source['activity'] ?? source['items'] ?? source['data']);
    return activities.map(_activityCardRow).toList();
  }

  bool _matchesFilter(Map<String, dynamic> row) {
    if (_filter == 'ALL') return true;
    return _text(row['status'], '').toUpperCase() == _filter;
  }

  Widget _officerCard(Map<String, dynamic> row) {
    final Map<String, dynamic> user = _map(row['user']);
    final String name = _text(user['fullName'] ?? row['fullName'], 'Officer');
    return _recordCard(
      icon: Icons.badge_outlined,
      title: name,
      subtitle: _text(row['_kind'], 'Officer'),
      details: <_Detail>[
        _Detail('Phone', _text(user['phone'] ?? row['phone'])),
        _Detail('Location',
            _text(user['state'] ?? row['state'], 'Assigned territory')),
      ],
      trailing: _statusPill(_status(user['status'] ?? row['status'])),
    );
  }

  Widget _customerCard(Map<String, dynamic> row) => _recordCard(
        icon: Icons.person_outline_rounded,
        title: _text(row['fullName'], 'Customer'),
        subtitle: 'Portfolio customer',
        details: <_Detail>[
          _Detail('Phone', _text(row['phone'])),
          _Detail(
              'Location', _text(row['state'] ?? row['lga'], 'Assigned area')),
        ],
        trailing: _statusPill(_status(row['status'])),
      );

  Widget _applicationCard(Map<String, dynamic> row) {
    final Map<String, dynamic> customer = _map(row['customer']);
    final Map<String, dynamic> amounts = _map(row['amounts']);
    final Map<String, dynamic> assignedOfficer = _map(row['assignedOfficer']);
    final String type =
        _text(row['service'] ?? row['_serviceKind'], 'Application')
            .replaceAll('_', ' ');
    final String service = type.toUpperCase().contains('SOLAR')
        ? 'Solar application'
        : type.toUpperCase().contains('PHONE')
            ? 'Phone financing'
            : 'Application';
    final String applicationType =
        service.startsWith('Solar') ? 'SOLAR' : 'PHONE';
    final bool showActions =
        applicationType == 'SOLAR' || applicationType == 'PHONE';
    return _recordCard(
      icon: service.startsWith('Solar')
          ? Icons.wb_sunny_outlined
          : Icons.smartphone_outlined,
      title: _text(
          customer['fullName'] ?? row['customerName'], 'Customer application'),
      subtitle: service,
      details: <_Detail>[
        _Detail('Customer',
            _text(customer['fullName'] ?? row['customerName'], 'Customer')),
        _Detail(
            'Package / product',
            _text(row['packageName'] ??
                row['package'] ??
                row['productName'] ??
                row['product'] ??
                service)),
        _Detail(
            'Assigned officer',
            _text(assignedOfficer['fullName'] ?? row['assignedOfficerName'],
                'Not assigned')),
        _Detail(
            'Repayment',
            _money(amounts['outstandingBalance'] ??
                row['outstandingBalance'] ??
                amounts['totalPayable'] ??
                row['amount'])),
        _Detail('Value', _money(amounts['totalPayable'] ?? row['amount'])),
        _Detail('Submitted', _date(row['createdAt'])),
        if (assignedOfficer.isNotEmpty)
          _Detail('Officer',
              _text(assignedOfficer['fullName'], 'Assigned officer')),
      ],
      trailing: _statusPill(_status(row['status'])),
      actions: showActions
          ? <Widget>[
              if (_canAssign(applicationType))
                Tooltip(
                  message: 'Assign officer',
                  child: OutlinedButton.icon(
                      onPressed: () => _assign(row, applicationType),
                      icon:
                          const Icon(Icons.person_add_alt_1_outlined, size: 15),
                      label: const Text('Assign officer')),
                ),
              if (_canReview)
                Tooltip(
                  message: 'Review verification',
                  child: TextButton.icon(
                      onPressed: () => _review(row, applicationType),
                      icon: const Icon(Icons.fact_check_outlined, size: 15),
                      label: const Text('Review verification')),
                ),
            ]
          : null,
    );
  }

  Widget _repaymentCard(Map<String, dynamic> row) => _recordCard(
        icon: Icons.payments_outlined,
        title: _text(row['type'], 'Portfolio repayment'),
        subtitle: 'Repayment activity',
        details: <_Detail>[
          _Detail('Amount', _money(row['amount'])),
          _Detail('Date', _date(row['createdAt'])),
        ],
        trailing: _statusPill('Recorded'),
      );

  String _commissionType(Map<String, dynamic> row) {
    final String value = _text(
      row['commissionType'] ?? row['eventKey'] ?? row['sourceType'],
      'COMMISSION',
    ).toUpperCase();
    if (value == 'PERFORMANCE_BONUS') return 'PERFORMANCE_BONUS';
    if (value == 'CAMPAIGN_BONUS') return 'CAMPAIGN_BONUS';
    return value;
  }

  Widget _commissionCard(Map<String, dynamic> row) => _recordCard(
        icon: Icons.account_balance_wallet_outlined,
        title: _commissionType(row),
        subtitle: _status(row['status']),
        details: <_Detail>[
          _Detail('Type', _commissionType(row)),
          _Detail('Amount', _money(row['amount'])),
          _Detail('Recorded', _date(row['createdAt'])),
        ],
        trailing: _statusPill(_status(row['status'])),
      );

  Widget _notificationCard(Map<String, dynamic> row) => _recordCard(
        icon: Icons.notifications_none_rounded,
        title: _text(row['title'], 'Workspace update'),
        subtitle: _date(row['createdAt']),
        details: <_Detail>[
          _Detail('Update', _text(row['message'], 'You have a new update.')),
        ],
      );

  Widget _activityCardRow(Map<String, dynamic> row) => _recordCard(
        icon: Icons.bolt_rounded,
        title: _activityLabel(row),
        subtitle: _date(row['createdAt']),
        details: <_Detail>[
          _Detail('Update', _text(row['reason'], 'Portfolio activity')),
        ],
      );

  List<Widget> _reportCards(Map<String, dynamic> data) {
    final List<Widget> result = <Widget>[];
    for (final String service in <String>['solar', 'phone']) {
      final List<Map<String, dynamic>> groups = _list(data[service]);
      for (final Map<String, dynamic> group in groups) {
        result.add(_recordCard(
          icon: service == 'solar'
              ? Icons.wb_sunny_outlined
              : Icons.smartphone_outlined,
          title:
              '${service == 'solar' ? 'Solar' : 'Phone Financing'} portfolio',
          subtitle: _status(group['_id']),
          details: <_Detail>[
            _Detail('Applications', _text(group['count'], '0')),
            _Detail('Outstanding', _money(group['outstanding'])),
          ],
        ));
      }
    }
    return result;
  }

  Widget _recordCard({
    required IconData icon,
    required String title,
    required String subtitle,
    required List<_Detail> details,
    Widget? trailing,
    List<Widget>? actions,
  }) =>
      Container(
        margin: const EdgeInsets.only(bottom: 0),
        padding: const EdgeInsets.fromLTRB(14, 13, 14, 11),
        decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: _line)),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Container(
                  width: 35,
                  height: 35,
                  decoration: const BoxDecoration(
                      color: Color(0xFFEAF7F0), shape: BoxShape.circle),
                  child: Icon(icon, color: _greenDark, size: 18),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: <Widget>[
                      Text(title,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                              color: _ink,
                              fontSize: 12,
                              fontWeight: FontWeight.w900)),
                      const SizedBox(height: 3),
                      Text(subtitle,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                              color: _muted,
                              fontSize: 10,
                              fontWeight: FontWeight.w600)),
                    ],
                  ),
                ),
                if (trailing != null) trailing,
              ],
            ),
            if (details.isNotEmpty) ...<Widget>[
              const SizedBox(height: 12),
              Wrap(
                spacing: 18,
                runSpacing: 8,
                children: details
                    .map((detail) => _detail(detail, compact: true))
                    .toList(),
              ),
            ],
            if (actions != null && actions.isNotEmpty) ...<Widget>[
              const Padding(
                  padding: EdgeInsets.only(top: 9), child: Divider(height: 1)),
              const SizedBox(height: 3),
              Wrap(spacing: 5, runSpacing: 4, children: actions),
            ],
          ],
        ),
      );

  Widget _detail(_Detail detail, {bool compact = false}) => SizedBox(
        width: compact ? 128 : double.infinity,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Text(detail.label,
                style: const TextStyle(
                    color: _muted, fontSize: 9, fontWeight: FontWeight.w700)),
            const SizedBox(height: 3),
            Text(detail.value,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                    color: _ink, fontSize: 11, fontWeight: FontWeight.w800)),
          ],
        ),
      );

  Widget _statusPill(String label) {
    final String upper = label.toUpperCase();
    final bool positive = <String>[
      'ACTIVE',
      'COMPLETED',
      'APPROVED',
      'ACCEPTED',
      'RECORDED',
      'PAID'
    ].contains(upper);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 5),
      decoration: BoxDecoration(
          color: positive ? const Color(0xFFE8F7EF) : const Color(0xFFFFF5E6),
          borderRadius: BorderRadius.circular(20)),
      child: Text(label,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: TextStyle(
              color: positive ? _greenDark : const Color(0xFF9B6A1B),
              fontSize: 9,
              fontWeight: FontWeight.w900)),
    );
  }

  Widget _targetsPage() {
    final Map<String, dynamic> response =
        _responses['Targets'] ?? <String, dynamic>{};
    final List<Map<String, dynamic>> targets = _list(response['targets']);
    final Map<String, dynamic> dashboard = _nested('Dashboard', 'dashboard');
    return _page(<Widget>[
      _pageHeading('Targets & Bonuses',
          'Track the goals and incentives configured for your workspace.'),
      const SizedBox(height: 16),
      _targetProgressCard(dashboard),
      const SizedBox(height: 16),
      if (targets.isEmpty)
        _empty('Configured targets and bonuses will appear here.')
      else
        ...targets.map((Map<String, dynamic> target) {
          final String metric =
              _text(target['metric'] ?? target['name'], 'Target')
                  .replaceAll('_', ' ');
          final String status = _status(target['status']);
          return Padding(
            padding: const EdgeInsets.only(bottom: 12),
            child: _surfaceCard(
              title: metric,
              subtitle: _text(target['period'] ?? target['description'],
                  'Configured incentive'),
              icon: Icons.flag_outlined,
              trailing: _statusPill(status),
              child: Wrap(
                spacing: 28,
                runSpacing: 12,
                children: <Widget>[
                  _detail(_Detail(
                      'Target', _text(target['target'] ?? target['goal']))),
                  _detail(_Detail('Current',
                      _text(target['current'] ?? target['progress']))),
                  _detail(_Detail(
                      'Bonus', _money(target['bonus'] ?? target['reward']))),
                ],
              ),
            ),
          );
        }),
    ]);
  }

  Widget _performance() {
    final Map<String, dynamic> data = _nested('Performance', 'performance');
    final List<Widget> cards = _reportCards(data);
    return _page(<Widget>[
      _pageHeading(
          'Performance', 'Track the strength and progress of your portfolio.'),
      const SizedBox(height: 16),
      _surfaceCard(
          title: 'Performance overview',
          subtitle: 'Applications and outstanding balances',
          icon: Icons.insights_outlined,
          child: _performanceBars(data)),
      const SizedBox(height: 16),
      _targetProgressCard(_nested('Dashboard', 'dashboard')),
      const SizedBox(height: 16),
      _officerPerformanceCard(),
      const SizedBox(height: 16),
      if (cards.isEmpty)
        _empty('Performance insights will appear as activity is recorded.')
      else
        LayoutBuilder(
          builder: (BuildContext context, BoxConstraints constraints) => Wrap(
            spacing: 12,
            runSpacing: 12,
            children: cards
                .map((Widget card) => SizedBox(
                    width: constraints.maxWidth >= 760
                        ? (constraints.maxWidth - 12) / 2
                        : constraints.maxWidth,
                    child: card))
                .toList(),
          ),
        ),
    ]);
  }

  Widget _officerPerformanceCard() {
    final Map<String, dynamic> officerResponse =
        _responses['Officer Management'] ?? <String, dynamic>{};
    final Map<String, dynamic> groups = _map(officerResponse['officers']);
    final List<Map<String, dynamic>> officers = <Map<String, dynamic>>[
      ..._list(groups['solar']),
      ..._list(groups['phone']),
    ];
    if (officers.isEmpty) {
      return _surfaceCard(
        title: 'Officer performance',
        subtitle: 'Compare activity across your officers',
        icon: Icons.badge_outlined,
        child: _empty('Officer performance will appear here.'),
      );
    }
    officers.sort((Map<String, dynamic> a, Map<String, dynamic> b) =>
        _number(_map(b['metrics'])['completedWork'])
            .compareTo(_number(_map(a['metrics'])['completedWork'])));
    return _surfaceCard(
      title: 'Officer performance',
      subtitle: 'Compare activity across your officers',
      icon: Icons.badge_outlined,
      child: Column(
        children: officers.take(6).map((Map<String, dynamic> row) {
          final Map<String, dynamic> metrics = _map(row['metrics']);
          return _dashboardRow(
            icon: Icons.badge_outlined,
            title: _text(row['fullName'], 'Officer'),
            subtitle:
                '${_text(metrics['assignedCustomers'], '0')} customers · ${_text(metrics['completedWork'], '0')} completed',
            trailing: Text(_money(metrics['commissionTotal']),
                style: const TextStyle(
                    color: _greenDark,
                    fontSize: 10,
                    fontWeight: FontWeight.w900)),
          );
        }).toList(),
      ),
    );
  }

  Widget _performanceBars(Map<String, dynamic> data) {
    final List<Map<String, dynamic>> solar = _list(data['solar']);
    final List<Map<String, dynamic>> phone = _list(data['phone']);
    final num solarCount = solar.fold<num>(
        0, (num sum, Map<String, dynamic> row) => sum + _number(row['count']));
    final num phoneCount = phone.fold<num>(
        0, (num sum, Map<String, dynamic> row) => sum + _number(row['count']));
    final num max = solarCount > phoneCount ? solarCount : phoneCount;
    return Column(
      children: <Widget>[
        _portfolioBar('Assigned Solar', solarCount, max,
            const Color(0xFF23A768), Icons.wb_sunny_outlined),
        const SizedBox(height: 17),
        _portfolioBar('Assigned Phones', phoneCount, max,
            const Color(0xFF77A9E8), Icons.smartphone_outlined),
      ],
    );
  }

  Widget _profile() {
    final Map<String, dynamic> profile = _profileData();
    final Map<String, dynamic> territory = _map(profile['territory']);
    final List<String> states = territory['states'] is List
        ? (territory['states'] as List)
            .map((dynamic value) => _text(value, ''))
            .where((String value) => value.isNotEmpty)
            .toList()
        : <String>[];
    return _page(<Widget>[
      _pageHeading('Business Partner profile',
          'Your organisation details and partner workspace.'),
      const SizedBox(height: 16),
      if (profile.isEmpty)
        _empty('No profile details are available.')
      else
        _surfaceCard(
          title: _text(profile['businessName'], 'Business Partner'),
          subtitle: 'Organisation profile',
          icon: Icons.business_outlined,
          child: Column(
            children: <Widget>[
              _profileLine('Contact person',
                  _text(profile['contactName'], 'Not provided')),
              _profileLine('Territory',
                  states.isEmpty ? 'Assigned territory' : states.join(', ')),
              _profileLine('Status', _status(profile['status'])),
            ],
          ),
        ),
      const SizedBox(height: 20),
      _surfaceCard(
        title: 'Account & Security',
        subtitle: 'Manage your signed-in Business Partner session.',
        icon: Icons.security_outlined,
        child: SizedBox(
          width: double.infinity,
          child: OutlinedButton.icon(
            key: const Key('business-partner-profile-logout'),
            onPressed: _logout,
            icon: const Icon(Icons.logout_rounded),
            label: const Text('Logout'),
            style: OutlinedButton.styleFrom(
              foregroundColor: const Color(0xFFB42318),
              padding: const EdgeInsets.symmetric(vertical: 14),
            ),
          ),
        ),
      ),
    ]);
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
      'jwt_token',
      'jwt',
      'user_id',
      'user_name',
      'user_phone',
      'user_email',
      'user_role',
      'user_status',
      'wallet_balance',
      'business_partner_id',
      'business_partner_profile',
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

  Widget _profileLine(String label, String value) => Padding(
        padding: const EdgeInsets.only(bottom: 13),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Expanded(
                child: Text(label,
                    style: const TextStyle(
                        color: _muted,
                        fontSize: 11,
                        fontWeight: FontWeight.w700))),
            const SizedBox(width: 18),
            Expanded(
                child: Text(value,
                    textAlign: TextAlign.right,
                    style: const TextStyle(
                        color: _ink,
                        fontSize: 11,
                        fontWeight: FontWeight.w800))),
          ],
        ),
      );

  Widget _pageHeading(String title, String subtitle, {Widget? action}) =>
      LayoutBuilder(
        builder: (BuildContext context, BoxConstraints constraints) {
          final Widget copy = Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              _sectionLabel('BUSINESS PARTNER'),
              const SizedBox(height: 6),
              Text(title,
                  style: const TextStyle(
                      color: _ink,
                      fontSize: 22,
                      letterSpacing: -0.4,
                      fontWeight: FontWeight.w900)),
              const SizedBox(height: 4),
              Text(subtitle,
                  style: const TextStyle(
                      color: _muted, fontSize: 11, height: 1.35)),
            ],
          );
          if (action == null) return copy;
          if (constraints.maxWidth < 550) {
            return Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[copy, const SizedBox(height: 10), action]);
          }
          return Row(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: <Widget>[
                Expanded(child: copy),
                const SizedBox(width: 16),
                action
              ]);
        },
      );

  Widget _sectionLabel(String text) => Text(text,
      style: const TextStyle(
          color: _greenDark,
          fontSize: 9,
          letterSpacing: 1.35,
          fontWeight: FontWeight.w900));

  Widget _page(List<Widget> children) => RefreshIndicator(
        color: _green,
        onRefresh: _load,
        child: LayoutBuilder(
          builder: (BuildContext context, BoxConstraints constraints) => Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 1220),
              child: ListView(
                physics: const AlwaysScrollableScrollPhysics(),
                // Keep the compact dashboard cards discoverable to semantics
                // and widget tests even when the first viewport is short.
                cacheExtent: 6000,
                padding: EdgeInsets.fromLTRB(
                    constraints.maxWidth < 600 ? 14 : 27,
                    constraints.maxWidth < 600 ? 16 : 25,
                    constraints.maxWidth < 600 ? 14 : 27,
                    34),
                children: children,
              ),
            ),
          ),
        ),
      );

  Widget _filterMenu() => Container(
        height: 36,
        padding: const EdgeInsets.symmetric(horizontal: 10),
        decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: _line)),
        child: DropdownButton<String>(
          value: _filter,
          underline: const SizedBox.shrink(),
          icon: const Icon(Icons.keyboard_arrow_down_rounded, size: 16),
          style: const TextStyle(
              color: _ink, fontSize: 11, fontWeight: FontWeight.w800),
          borderRadius: BorderRadius.circular(12),
          dropdownColor: Colors.white,
          items: const <String>[
            'ALL',
            'PENDING',
            'ACTIVE',
            'COMPLETED',
            'OVERDUE'
          ]
              .map((String value) =>
                  DropdownMenuItem(value: value, child: Text(value)))
              .toList(),
          onChanged: (String? value) {
            if (value != null && value != _filter) {
              setState(() => _filter = value);
              _load();
            }
          },
        ),
      );

  Future<void> _filterDialog() async {
    final TextEditingController officer =
        TextEditingController(text: _officerFilter);
    final TextEditingController from = TextEditingController(text: _dateFrom);
    final TextEditingController to = TextEditingController(text: _dateTo);
    String service = _serviceFilter;
    final bool? apply = await showDialog<bool>(
        context: context,
        builder: (BuildContext context) => StatefulBuilder(
            builder: (BuildContext context, StateSetter setDialog) =>
                AlertDialog(
                  title: const Text('Filter records'),
                  content:
                      Column(mainAxisSize: MainAxisSize.min, children: <Widget>[
                    DropdownButtonFormField<String>(
                        value: service,
                        decoration: const InputDecoration(labelText: 'Service'),
                        items: const <String>['ALL', 'SOLAR', 'PHONE']
                            .map((String value) => DropdownMenuItem(
                                value: value, child: Text(value)))
                            .toList(),
                        onChanged: (String? value) =>
                            setDialog(() => service = value ?? service)),
                    TextField(
                        controller: officer,
                        decoration:
                            const InputDecoration(labelText: 'Officer filter')),
                    TextField(
                        controller: from,
                        decoration: const InputDecoration(
                            labelText: 'From date (YYYY-MM-DD)')),
                    TextField(
                        controller: to,
                        decoration: const InputDecoration(
                            labelText: 'To date (YYYY-MM-DD)')),
                  ]),
                  actions: <Widget>[
                    TextButton(
                        onPressed: () => Navigator.pop(context, false),
                        child: const Text('Cancel')),
                    FilledButton(
                        onPressed: () => Navigator.pop(context, true),
                        child: const Text('Apply'))
                  ],
                )));
    if (apply == true) {
      setState(() {
        _serviceFilter = service;
        _officerFilter = officer.text.trim();
        _dateFrom = from.text.trim();
        _dateTo = to.text.trim();
      });
      await _load();
    }
    officer.dispose();
    from.dispose();
    to.dispose();
  }

  bool _canAssign(String type) => businessPartnerHasPermission(_profileData(),
      type == 'SOLAR' ? 'SOLAR_ASSIGNMENT' : 'PHONE_ASSIGNMENT');

  bool get _canReview =>
      businessPartnerHasPermission(_profileData(), 'VERIFICATION_REVIEW');

  String _id(Map<String, dynamic> value) =>
      _text(value['_id'] ?? value['id'], '');

  Future<void> _assign(Map<String, dynamic> application, String type) async {
    if (!_canAssign(type)) {
      _notice('You do not have permission to assign this application.',
          error: true);
      return;
    }
    final Map<String, dynamic> officers = _map(
        (_responses['Officer Management'] ?? <String, dynamic>{})['officers']);
    final List<Map<String, dynamic>> available =
        _list(officers[type == 'SOLAR' ? 'solar' : 'phone']);
    if (available.isEmpty) {
      _notice('No owned officers are available for assignment.', error: true);
      return;
    }
    String officerId = _id(available.first);
    final bool? save = await showDialog<bool>(
        context: context,
        builder: (BuildContext context) => AlertDialog(
              title: const Text('Assign owned officer'),
              content: DropdownButtonFormField<String>(
                  value: officerId,
                  items: available
                      .map((Map<String, dynamic> officer) => DropdownMenuItem(
                          value: _id(officer),
                          child: Text(_text(
                              _map(officer['user'])['fullName'] ??
                                  officer['fullName'],
                              'Officer'))))
                      .toList(),
                  onChanged: (String? value) => officerId = value ?? officerId),
              actions: <Widget>[
                TextButton(
                    onPressed: () => Navigator.pop(context, false),
                    child: const Text('Cancel')),
                FilledButton(
                    onPressed: () => Navigator.pop(context, true),
                    child: const Text('Assign'))
              ],
            ));
    if (save != true || _id(application).isEmpty) return;
    try {
      await _api.assignApplication(
          applicationId: _id(application), type: type, officerId: officerId);
      _notice('Officer assigned within your portfolio.');
      await _load();
    } on BusinessPartnerApiException catch (error) {
      _notice(error.message, error: true);
    }
  }

  Future<void> _review(Map<String, dynamic> application, String type) async {
    if (!_canReview) {
      _notice('You do not have permission to review verification reports.',
          error: true);
      return;
    }
    String decision = 'ACCEPTED';
    final TextEditingController note = TextEditingController();
    final bool? save = await showDialog<bool>(
        context: context,
        builder: (BuildContext context) => AlertDialog(
              title: const Text('Review verification'),
              content:
                  Column(mainAxisSize: MainAxisSize.min, children: <Widget>[
                const Text(
                    'This records a field-verification review only. It does not approve an application.'),
                DropdownButtonFormField<String>(
                    value: decision,
                    items: const <String>['ACCEPTED', 'RETURNED']
                        .map((String value) =>
                            DropdownMenuItem(value: value, child: Text(value)))
                        .toList(),
                    onChanged: (String? value) => decision = value ?? decision),
                TextField(
                    controller: note,
                    maxLines: 3,
                    decoration:
                        const InputDecoration(labelText: 'Review note')),
              ]),
              actions: <Widget>[
                TextButton(
                    onPressed: () => Navigator.pop(context, false),
                    child: const Text('Cancel')),
                FilledButton(
                    onPressed: () => Navigator.pop(context, true),
                    child: const Text('Save review'))
              ],
            ));
    if (save == true && _id(application).isNotEmpty) {
      try {
        await _api.reviewVerification(
            applicationId: _id(application),
            type: type,
            decision: decision,
            note: note.text);
        _notice('Verification review saved.');
        await _load();
      } on BusinessPartnerApiException catch (error) {
        _notice(error.message, error: true);
      }
    }
    note.dispose();
  }

  Future<void> _showCreateCustomer() async {
    final GlobalKey<FormState> formKey = GlobalKey<FormState>();
    final TextEditingController name = TextEditingController();
    final TextEditingController phone = TextEditingController();
    final TextEditingController email = TextEditingController();
    final List<Map<String, dynamic>> officers = <Map<String, dynamic>>[
      ..._list(_map((_responses['Officer Management'] ??
              <String, dynamic>{})['officers'])['solar'])
          .map((Map<String, dynamic> row) =>
              <String, dynamic>{...row, '_type': 'SOLAR'}),
      ..._list(_map((_responses['Officer Management'] ??
              <String, dynamic>{})['officers'])['phone'])
          .map((Map<String, dynamic> row) =>
              <String, dynamic>{...row, '_type': 'PHONE'}),
    ];
    String? officerId;
    bool saving = false;
    final bool? created = await showDialog<bool>(
      context: context,
      barrierDismissible: false,
      builder: (BuildContext dialogContext) => StatefulBuilder(
        builder: (BuildContext context, StateSetter setDialog) => AlertDialog(
          title: const Text('Create ServicePay customer'),
          content: SizedBox(
            width: 430,
            child: Form(
              key: formKey,
              child: SingleChildScrollView(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: <Widget>[
                    const Align(
                      alignment: Alignment.centerLeft,
                      child: Text(
                          'The customer activates with an OTP or password recovery sent to their own verified contact. No credential is created or shown here.',
                          style: TextStyle(color: _muted, fontSize: 11)),
                    ),
                    const SizedBox(height: 12),
                    _dialogField(name, 'Full name'),
                    _dialogField(phone, 'Phone number',
                        keyboard: TextInputType.phone),
                    _dialogField(email, 'Email',
                        keyboard: TextInputType.emailAddress),
                    if (officers.isNotEmpty) ...<Widget>[
                      const SizedBox(height: 8),
                      DropdownButtonFormField<String>(
                        value: officerId,
                        isExpanded: true,
                        decoration: const InputDecoration(
                            labelText: 'Acquisition officer (optional)'),
                        items: officers
                            .map((Map<String, dynamic> row) =>
                                DropdownMenuItem<String>(
                                  value: _id(row),
                                  child: Text(
                                    '${_text(row['fullName'], 'Officer')} · ${_text(row['_type'], '')}',
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                  ),
                                ))
                            .where((DropdownMenuItem<String> item) =>
                                item.value?.isNotEmpty ?? false)
                            .toList(),
                        onChanged: (String? value) =>
                            setDialog(() => officerId = value),
                      ),
                    ],
                  ],
                ),
              ),
            ),
          ),
          actions: <Widget>[
            TextButton(
                onPressed:
                    saving ? null : () => Navigator.pop(dialogContext, false),
                child: const Text('Cancel')),
            FilledButton(
              key: const Key('business-partner-save-customer'),
              onPressed: saving
                  ? null
                  : () async {
                      if (!(formKey.currentState?.validate() ?? false)) return;
                      setDialog(() => saving = true);
                      try {
                        await _api.createCustomer(
                          fullName: name.text,
                          phone: phone.text,
                          email: email.text,
                          officerId: officerId,
                        );
                        if (dialogContext.mounted) {
                          Navigator.pop(dialogContext, true);
                        }
                      } on BusinessPartnerApiException catch (error) {
                        setDialog(() => saving = false);
                        if (dialogContext.mounted) {
                          ScaffoldMessenger.of(dialogContext).showSnackBar(
                              SnackBar(
                                  content: Text(error.message),
                                  backgroundColor: Colors.red.shade700));
                        }
                      } catch (_) {
                        setDialog(() => saving = false);
                        if (dialogContext.mounted) {
                          ScaffoldMessenger.of(dialogContext).showSnackBar(
                              const SnackBar(
                                  content: Text(
                                      'Unable to create this customer right now.'),
                                  backgroundColor: Colors.red));
                        }
                      }
                    },
              child: saving
                  ? const SizedBox(
                      height: 16,
                      width: 16,
                      child: CircularProgressIndicator(strokeWidth: 2))
                  : const Text('Create customer'),
            ),
          ],
        ),
      ),
    );
    if (created == true && mounted) {
      await showDialog<void>(
        context: context,
        builder: (BuildContext context) => AlertDialog(
          title: const Text('Customer created'),
          content: const Text(
              'The customer must activate via OTP or password recovery sent to their own verified contact. No credential was created or shown in this workspace.'),
          actions: <Widget>[
            TextButton(
                onPressed: () => Navigator.pop(context),
                child: const Text('Done')),
          ],
        ),
      );
      await _load();
    }
    // showDialog resolves when Navigator.pop is called, before the route's
    // closing transition has finished. Keep the form controllers alive until
    // that transition is complete.
    await Future<void>.delayed(const Duration(milliseconds: 300));
    name.dispose();
    phone.dispose();
    email.dispose();
  }

  Widget _dialogField(
    TextEditingController controller,
    String label, {
    TextInputType? keyboard,
  }) =>
      Padding(
        padding: const EdgeInsets.only(bottom: 10),
        child: TextFormField(
          controller: controller,
          keyboardType: keyboard,
          validator: (String? value) {
            if (value == null || value.trim().isEmpty) return 'Required';
            return null;
          },
          decoration: InputDecoration(labelText: label),
        ),
      );

  Future<void> _showCustomerDetail(Map<String, dynamic> customer) async {
    final String id = _id(customer);
    Map<String, dynamic> detail = customer;
    if (id.isNotEmpty) {
      try {
        final Map<String, dynamic> response = await _api.getCustomer(id: id);
        detail = _map(response['customer'] ?? response['data'])
          ..addAll(<String, dynamic>{
            if (_map(response['customer'] ?? response['data']).isEmpty)
              ...customer
          });
      } on BusinessPartnerApiException catch (error) {
        _notice(error.message, error: true);
      } catch (_) {
        _notice('Unable to load customer details.', error: true);
      }
    }
    if (!mounted) return;
    final Map<String, dynamic> kyc = _map(detail['kyc']);
    await showDialog<void>(
      context: context,
      builder: (BuildContext context) => AlertDialog(
        title: Text(_text(detail['fullName'], 'Customer')),
        content: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              _detail(const _Detail('ServicePay account',
                  'Available in your authorized workspace')),
              _detail(_Detail('Phone', _text(detail['phone'], 'Protected'))),
              _detail(_Detail('Email', _text(detail['email'], 'Protected'))),
              _detail(_Detail('Status', _status(detail['status']))),
              _detail(_Detail(
                  'KYC',
                  _status(kyc['status'] ??
                      kyc['ninStatus'] ??
                      detail['kycStatus']))),
              _detail(_Detail('Wallet balance',
                  _money(detail['walletBalance'] ?? detail['balance']))),
              const SizedBox(height: 5),
              const Text(
                  'Wallet actions, PIN/password changes, impersonation and full KYC identifiers are not available to Business Partners.',
                  style: TextStyle(color: _muted, fontSize: 11, height: 1.35)),
            ],
          ),
        ),
        actions: <Widget>[
          TextButton(
              onPressed: () => Navigator.pop(context),
              child: const Text('Close')),
        ],
      ),
    );
  }

  Future<void> _showTransactionDetail(Map<String, dynamic> transaction) async {
    final String reference = _text(
        transaction['reference'] ?? transaction['transactionReference'], '');
    final String transactionId = _id(transaction);
    Map<String, dynamic> detail = transaction;
    if (transactionId.isNotEmpty) {
      try {
        final Map<String, dynamic> response =
            await _api.getTransaction(id: transactionId);
        final Map<String, dynamic> loaded =
            _map(response['transaction'] ?? response['data']);
        if (loaded.isNotEmpty) detail = loaded;
      } on BusinessPartnerApiException catch (error) {
        _notice(error.message, error: true);
      } catch (_) {
        _notice('Unable to load transaction details.', error: true);
      }
    }
    if (!mounted) return;
    await showDialog<void>(
      context: context,
      builder: (BuildContext context) => AlertDialog(
        title: const Text('Transaction details'),
        content: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              _detail(_Detail('Reference', reference)),
              _detail(_Detail(
                  'Customer',
                  _text(
                      detail['customerName'] ??
                          _map(detail['customer'])['fullName'],
                      'Customer'))),
              _detail(_Detail(
                  'Service',
                  _text(
                      detail['service'] ?? detail['serviceType'], 'Service'))),
              _detail(_Detail('Amount', _money(detail['amount']))),
              _detail(_Detail('Status', _status(detail['status']))),
              _detail(_Detail('Date', _date(detail['createdAt']))),
              _detail(_Detail(
                  'Partner commission',
                  _money(detail['partnerCommission'] ??
                      detail['commissionAmount']))),
              const SizedBox(height: 5),
              const Text(
                  'Provider credentials and unnecessary payment data are not displayed.',
                  style: TextStyle(color: _muted, fontSize: 11)),
            ],
          ),
        ),
        actions: <Widget>[
          TextButton(
              onPressed: () => Navigator.pop(context),
              child: const Text('Close')),
        ],
      ),
    );
  }

  void _notice(String message, {bool error = false}) {
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(
          content: Text(message),
          backgroundColor: error ? Colors.red.shade700 : _green));
  }

  Widget _empty(String message) => Container(
        width: double.infinity,
        padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 28),
        decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: _line)),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            Container(
                width: 42,
                height: 42,
                decoration: const BoxDecoration(
                    color: Color(0xFFEAF7F0), shape: BoxShape.circle),
                child: const Icon(Icons.inbox_outlined, color: _greenDark)),
            const SizedBox(height: 11),
            Text(message,
                textAlign: TextAlign.center,
                style: const TextStyle(
                    color: _muted,
                    fontSize: 11,
                    height: 1.4,
                    fontWeight: FontWeight.w600)),
          ],
        ),
      );

  Widget _errorView() => Center(
        child: Container(
          margin: const EdgeInsets.all(22),
          padding: const EdgeInsets.all(22),
          constraints: const BoxConstraints(maxWidth: 410),
          decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(18),
              border: Border.all(color: _line)),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              const Icon(Icons.cloud_off_outlined, color: _muted, size: 32),
              const SizedBox(height: 11),
              Text('We could not load your workspace right now.',
                  textAlign: TextAlign.center,
                  style: const TextStyle(color: _ink, height: 1.4)),
              const SizedBox(height: 15),
              FilledButton.icon(
                  onPressed: _load,
                  icon: const Icon(Icons.refresh_rounded, size: 17),
                  label: const Text('Try again')),
            ],
          ),
        ),
      );
}

class _Section {
  const _Section(this.title, this.icon);
  final String title;
  final IconData icon;
}

class _Metric {
  const _Metric(this.label, this.value, this.icon, this.tint);
  final String label;
  final String value;
  final IconData icon;
  final Color tint;
}

class _QuickAction {
  const _QuickAction(this.label, this.icon, this.section);
  final String label;
  final IconData icon;
  final int section;
}

class _Detail {
  const _Detail(this.label, this.value);
  final String label;
  final String value;
}

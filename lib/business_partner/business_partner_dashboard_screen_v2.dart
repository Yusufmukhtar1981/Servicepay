import 'package:flutter/material.dart';

import 'business_partner_permissions.dart';
import '../services/business_partner_api_service.dart';

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
  final Set<String> _unavailable = <String>{};
  final Map<String, Map<String, dynamic>> _responses =
      <String, Map<String, dynamic>>{};

  static const List<_Section> _sections = <_Section>[
    _Section('Dashboard', Icons.grid_view_rounded),
    _Section('My Officers', Icons.badge_outlined),
    _Section('Customers', Icons.people_alt_outlined),
    _Section('Solar', Icons.wb_sunny_outlined),
    _Section('Phone Financing', Icons.smartphone_outlined),
    _Section('Sales & Applications', Icons.description_outlined),
    _Section('Repayments', Icons.payments_outlined),
    _Section('Commission', Icons.account_balance_wallet_outlined),
    _Section('Performance', Icons.insights_outlined),
    _Section('Reports', Icons.bar_chart_rounded),
    _Section('Notifications', Icons.notifications_none_rounded),
    _Section('Profile', Icons.person_outline_rounded),
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
      'My Officers': _api.officers(filters: filters),
      'Customers': _api.customers(filters: filters),
      'Applications': _api.applications(filters: filters),
      'Repayments': _api.repayments(filters: filters),
      'Commission': _api.commission(filters: filters),
      'Performance': _api.performance(filters: filters),
      'Reports': _api.reports(filters: filters),
      'Notifications': _api.notifications(filters: filters),
      'Activity': _api.activity(filters: filters),
      'Profile': _api.profile(),
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
      _responses['Solar'] = applications;
      _responses['Phone Financing'] = applications;
      _responses['Sales & Applications'] = applications;
      _unavailable
        ..clear()
        ..addAll(denied);
      _loading = false;
    });
  }

  Map<String, String> get _filters => <String, String>{
        if (_filter != 'ALL') 'status': _filter,
        if (_serviceFilter != 'ALL') 'service': _serviceFilter,
        if (_officerFilter.isNotEmpty) 'officerId': _officerFilter,
        if (_dateFrom.isNotEmpty) 'dateFrom': _dateFrom,
        if (_dateTo.isNotEmpty) 'dateTo': _dateTo,
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
                _sections[_section].title,
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
                itemCount: _sections.length,
                itemBuilder: (BuildContext context, int index) =>
                    _navItem(index, dark: true),
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
                    itemCount: _sections.length,
                    itemBuilder: (BuildContext context, int index) =>
                        _navItem(index, dark: true),
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

  Widget _content() {
    final String title = _sections[_section].title;
    final Map<String, dynamic> response =
        _responses[title] ?? <String, dynamic>{};
    if (response.containsKey('_unavailable')) {
      return _page(<Widget>[
        _pageHeading(title, 'A clear view of your partner workspace.'),
        const SizedBox(height: 18),
        _empty('This section is not available right now.')
      ]);
    }
    if (_section == 0) return _dashboard();
    if (_section == 8) return _performance();
    if (_section == 11) return _profile();
    return _records(title);
  }

  Widget _dashboard() {
    final Map<String, dynamic> profile = _profileData();
    final String name =
        _text(profile['businessName'] ?? profile['name'], 'Business Partner');
    return _page(<Widget>[
      _welcome(name),
      const SizedBox(height: 19),
      _sectionLabel('YOUR PORTFOLIO'),
      const SizedBox(height: 10),
      _summaryGrid(),
      const SizedBox(height: 19),
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
      _portfolioCard(),
    ]);
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
    final List<Map<String, dynamic>> solar = _applications('solar');
    final List<Map<String, dynamic>> phone = _applications('phone');
    final Map<String, dynamic> officers =
        _map((_responses['My Officers'] ?? <String, dynamic>{})['officers']);
    final int officerCount =
        _list(officers['solar']).length + _list(officers['phone']).length;
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
    return <_Metric>[
      _Metric('Total Officers', '$officerCount', Icons.badge_outlined,
          const Color(0xFFE8F7EF)),
      _Metric('Customers', '$customerCount', Icons.people_alt_outlined,
          const Color(0xFFEAF4FF)),
      _Metric('Solar Applications', '${solar.length}', Icons.wb_sunny_outlined,
          const Color(0xFFFFF5DE)),
      _Metric('Phone Applications', '${phone.length}',
          Icons.smartphone_outlined, const Color(0xFFF1ECFF)),
      _Metric('Total Sales', _money(totalSales), Icons.trending_up_rounded,
          const Color(0xFFE8F7EF)),
      _Metric('Outstanding Repayments', _money(outstanding),
          Icons.payments_outlined, const Color(0xFFFFEFEB)),
      _Metric('Commission Balance', _money(commissionBalance),
          Icons.account_balance_wallet_outlined, const Color(0xFFEAF4FF)),
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
              _QuickAction('Applications', Icons.description_outlined, 5),
              _QuickAction('My Officers', Icons.badge_outlined, 1),
              _QuickAction('Repayments', Icons.payments_outlined, 6),
              _QuickAction('Reports', Icons.bar_chart_rounded, 9),
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
          onTap: () => setState(() => _section = action.section),
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
          _portfolioBar('Solar', solarValue, maxValue, const Color(0xFF23A768),
              Icons.wb_sunny_outlined),
          const SizedBox(height: 17),
          _portfolioBar('Phone Financing', phoneValue, maxValue,
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
      'Solar',
      'Phone Financing',
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

  String _sectionSubtitle(String title) {
    const Map<String, String> subtitles = <String, String>{
      'My Officers': 'People supporting your partner portfolio',
      'Customers': 'Customers connected to your applications',
      'Solar': 'Solar applications in your portfolio',
      'Phone Financing': 'Phone financing applications in your portfolio',
      'Sales & Applications': 'All applications across your services',
      'Repayments': 'Payment activity from your portfolio',
      'Commission': 'Commission activity for your workspace',
      'Reports': 'A clear view of portfolio reporting',
      'Notifications': 'Updates and messages for your workspace',
    };
    return subtitles[title] ?? 'A clear view of your partner workspace.';
  }

  List<Widget> _recordWidgets(String title, Map<String, dynamic> source) {
    if (title == 'My Officers') {
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
    if (title == 'Solar' ||
        title == 'Phone Financing' ||
        title == 'Sales & Applications') {
      final List<Map<String, dynamic>> rows = title == 'Solar'
          ? _applications('solar')
          : title == 'Phone Financing'
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

  Widget _commissionCard(Map<String, dynamic> row) => _recordCard(
        icon: Icons.account_balance_wallet_outlined,
        title: 'Commission entry',
        subtitle: _status(row['status']),
        details: <_Detail>[
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
        _portfolioBar('Solar', solarCount, max, const Color(0xFF23A768),
            Icons.wb_sunny_outlined),
        const SizedBox(height: 17),
        _portfolioBar('Phone Financing', phoneCount, max,
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
    ]);
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
    final Map<String, dynamic> officers =
        _map((_responses['My Officers'] ?? <String, dynamic>{})['officers']);
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

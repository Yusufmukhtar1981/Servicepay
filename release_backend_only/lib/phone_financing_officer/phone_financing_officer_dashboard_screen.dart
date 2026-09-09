import 'package:flutter/material.dart';

import '../services/phone_financing_officer_api_service.dart';

const Color _navy = Color(0xFF111A3A);
const Color _indigo = Color(0xFF3F4ED8);
const Color _violet = Color(0xFF6674F2);
const Color _surface = Color(0xFFF5F6FB);
const Color _ink = Color(0xFF18203A);
const Color _muted = Color(0xFF76809A);
const Color _line = Color(0xFFE5E8F2);

class PhoneFinancingOfficerDashboardScreen extends StatefulWidget {
  const PhoneFinancingOfficerDashboardScreen({super.key, this.api});
  final PhoneFinancingOfficerApiService? api;

  @override
  State<PhoneFinancingOfficerDashboardScreen> createState() =>
      _PhoneFinancingOfficerDashboardScreenState();
}

class _PhoneFinancingOfficerDashboardScreenState
    extends State<PhoneFinancingOfficerDashboardScreen> {
  late final PhoneFinancingOfficerApiService _api;
  bool _loading = true;
  String _error = '';
  int _section = 0;
  String _filter = 'ALL';
  Map<String, dynamic> _profile = <String, dynamic>{};
  List<Map<String, dynamic>> _applications = <Map<String, dynamic>>[];

  static const List<_NavItem> _nav = <_NavItem>[
    _NavItem('Dashboard', Icons.grid_view_rounded),
    _NavItem('My Assignments', Icons.assignment_outlined),
    _NavItem('Applications', Icons.description_outlined),
    _NavItem('Repayments', Icons.payments_outlined),
    _NavItem('Customers', Icons.people_outline_rounded),
    _NavItem('Phones & Stock', Icons.smartphone_outlined),
    _NavItem('Notifications', Icons.notifications_none_rounded),
    _NavItem('Reports', Icons.bar_chart_rounded),
    _NavItem('My Profile', Icons.person_outline_rounded),
    _NavItem('Settings', Icons.settings_outlined),
  ];
  static const List<String> _filters = <String>[
    'ALL',
    'PENDING',
    'IN_PROGRESS',
    'COMPLETED',
  ];

  @override
  void initState() {
    super.initState();
    _api = widget.api ?? PhoneFinancingOfficerApiService();
    _load();
  }

  Map<String, dynamic> _map(dynamic value) =>
      value is Map ? Map<String, dynamic>.from(value) : <String, dynamic>{};
  List<Map<String, dynamic>> _list(dynamic value) => value is List
      ? value.whereType<Map>().map(_map).toList()
      : <Map<String, dynamic>>[];
  String _text(dynamic value, [String fallback = '—']) {
    final String text = value?.toString().trim() ?? '';
    return text.isEmpty || text == 'null' ? fallback : text;
  }

  String _id(Map<String, dynamic> value) =>
      _text(value['_id'] ?? value['id'], '');
  num _number(dynamic value) =>
      value is num ? value : num.tryParse(_text(value, '0')) ?? 0;
  String _money(dynamic value) => '₦${_number(value).toStringAsFixed(2)}';

  Future<void> _load() async {
    if (mounted) {
      setState(() {
        _loading = true;
        _error = '';
      });
    }
    try {
      final Map<String, dynamic> result = await _api.applications();
      if (!mounted) return;
      setState(() {
        _applications = _list(result['applications']);
        _profile =
            _map(result['officer'] ?? result['profile'] ?? result['user']);
        _loading = false;
      });
    } on PhoneFinancingOfficerApiException catch (error) {
      if (mounted) {
        setState(() {
          _loading = false;
          _error = error.message;
        });
      }
    } catch (_) {
      if (mounted) {
        setState(() {
          _loading = false;
          _error = 'Unable to load assigned phone-financing applications.';
        });
      }
    }
  }

  bool _verified(Map<String, dynamic> item) =>
      _map(item['verification'] ?? item['verificationReport']).isNotEmpty ||
      _text(item['verificationStatus'], '').toUpperCase() == 'COMPLETED';
  bool _needsVerification(Map<String, dynamic> item) =>
      !_verified(item) &&
      !<String>['REJECTED', 'CANCELLED']
          .contains(_text(item['status'], '').toUpperCase());
  bool _completed(Map<String, dynamic> item) {
    final String status = _text(item['status'], '').toUpperCase();
    return _verified(item) ||
        <String>['COMPLETED', 'PAID', 'ACTIVE', 'APPROVED'].contains(status);
  }

  bool _inProgress(Map<String, dynamic> item) =>
      !_needsVerification(item) && !_completed(item);
  List<Map<String, dynamic>> get _visible {
    switch (_filter) {
      case 'PENDING':
        return _applications.where(_needsVerification).toList();
      case 'IN_PROGRESS':
        return _applications.where(_inProgress).toList();
      case 'COMPLETED':
        return _applications.where(_completed).toList();
      default:
        return _applications;
    }
  }

  String _status(Map<String, dynamic> item) {
    final String raw = _text(item['status'], 'PENDING').replaceAll('_', ' ');
    return raw
        .split(' ')
        .map((String word) => word.isEmpty
            ? word
            : '${word[0].toUpperCase()}${word.substring(1).toLowerCase()}')
        .join(' ');
  }

  String _customer(Map<String, dynamic> item) {
    final Map<String, dynamic> customer = _map(item['customer']);
    return _text(customer['fullName'] ?? customer['name'], 'Assigned customer');
  }

  String _phone(Map<String, dynamic> item) {
    final Map<String, dynamic> product =
        _map(item['product'] ?? item['productSnapshot']);
    return _text(product['name'] ?? item['phoneModel'] ?? item['deviceName'],
        'Phone model not provided');
  }

  String _location(Map<String, dynamic> item) {
    final Map<String, dynamic> customer = _map(item['customer']);
    return _text(customer['state'] ?? item['state'] ?? item['location']);
  }

  String _amount(Map<String, dynamic> item) {
    final Map<String, dynamic> amounts = _map(item['amounts']);
    return _money(
        amounts['totalPayable'] ?? amounts['amount'] ?? item['amount']);
  }

  String _officerName() {
    final String profileName = _text(
        _profile['fullName'] ?? _profile['name'] ?? _profile['displayName'],
        '');
    if (profileName.isNotEmpty) return profileName;
    for (final Map<String, dynamic> app in _applications) {
      final Map<String, dynamic> officer =
          _map(app['officer'] ?? app['assignedOfficer'] ?? app['user']);
      final String name = _text(
          officer['fullName'] ?? officer['name'] ?? officer['displayName'], '');
      if (name.isNotEmpty) return name;
    }
    return 'Phone Officer';
  }

  void _notice(String message, {bool error = false}) {
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(
        content: Text(message),
        behavior: SnackBarBehavior.floating,
        backgroundColor: error ? const Color(0xFFB42318) : _indigo,
      ));
  }

  @override
  Widget build(BuildContext context) {
    final bool wide = MediaQuery.sizeOf(context).width >= 980;
    return Theme(
      data: Theme.of(context).copyWith(
        scaffoldBackgroundColor: _surface,
        colorScheme: Theme.of(context).colorScheme.copyWith(
              primary: _indigo,
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
        ),
      ),
      child: Scaffold(
        key: const Key('phone-financing-officer-dashboard'),
        drawer: wide ? null : _drawer(),
        appBar: PreferredSize(
          preferredSize: const Size.fromHeight(72),
          child: _topBar(wide),
        ),
        bottomNavigationBar: wide ? null : _bottomNav(),
        body: _loading
            ? const _LoadingView()
            : _error.isNotEmpty
                ? _errorView()
                : Row(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: <Widget>[
                      if (wide) _sidebar(),
                      Expanded(
                          child: RefreshIndicator(
                        onRefresh: _load,
                        child: SingleChildScrollView(
                          physics: const AlwaysScrollableScrollPhysics(),
                          child: _content(),
                        ),
                      )),
                    ],
                  ),
      ),
    );
  }

  Widget _topBar(bool wide) => Container(
        color: Colors.white,
        padding: EdgeInsets.symmetric(horizontal: wide ? 30 : 14, vertical: 12),
        child: Row(children: <Widget>[
          if (!wide)
            Builder(
                builder: (BuildContext context) => IconButton(
                      tooltip: 'Open menu',
                      onPressed: () => Scaffold.of(context).openDrawer(),
                      icon: const Icon(Icons.menu_rounded, color: _ink),
                    )),
          if (wide) const SizedBox(width: 4),
          Expanded(
              child: Text(_nav[_section].label,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                      color: _ink, fontSize: 18, fontWeight: FontWeight.w800))),
          _onlinePill(),
          IconButton(
            tooltip: 'Notifications',
            onPressed: () => _setSection(6),
            icon: const Icon(Icons.notifications_none_rounded, color: _muted),
          ),
          IconButton(
            tooltip: 'Refresh',
            onPressed: _loading ? null : _load,
            icon: const Icon(Icons.refresh_rounded, color: _muted),
          ),
          if (wide) _profileChip(),
        ]),
      );

  Widget _onlinePill() => Container(
        padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 7),
        decoration: BoxDecoration(
            color: const Color(0xFFEAF8F1),
            borderRadius: BorderRadius.circular(20)),
        child: const Row(mainAxisSize: MainAxisSize.min, children: <Widget>[
          Icon(Icons.circle, color: Color(0xFF18A66B), size: 7),
          SizedBox(width: 6),
          Text('Online',
              style: TextStyle(
                  color: Color(0xFF147A52),
                  fontSize: 11,
                  fontWeight: FontWeight.w800)),
        ]),
      );

  Widget _profileChip() => Padding(
        padding: const EdgeInsets.only(left: 8),
        child: Row(children: <Widget>[
          CircleAvatar(
              radius: 18,
              backgroundColor: const Color(0xFFE6E9FF),
              child: Text(_initials(_officerName()),
                  style: const TextStyle(
                      color: _indigo,
                      fontSize: 12,
                      fontWeight: FontWeight.w900))),
          const SizedBox(width: 8),
          ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 130),
            child: Text(_officerName(),
                overflow: TextOverflow.ellipsis,
                style:
                    const TextStyle(color: _ink, fontWeight: FontWeight.w700)),
          ),
        ]),
      );
  String _initials(String name) {
    final List<String> words =
        name.split(' ').where((String x) => x.isNotEmpty).toList();
    return words.take(2).map((String x) => x[0].toUpperCase()).join();
  }

  Widget _sidebar() => Container(
        width: 248,
        color: _navy,
        padding: const EdgeInsets.fromLTRB(16, 22, 16, 16),
        child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: <Widget>[
              _brand(dark: true),
              const SizedBox(height: 30),
              const Padding(
                  padding: EdgeInsets.only(left: 12, bottom: 10),
                  child: Text('OFFICER WORKSPACE',
                      style: TextStyle(
                          color: Color(0xFF9BA8D4),
                          fontSize: 10,
                          letterSpacing: 1.3,
                          fontWeight: FontWeight.w800))),
              Expanded(
                  child: ListView(children: <Widget>[
                ...List<Widget>.generate(
                    _nav.length, (int index) => _navItem(index)),
                _logoutItem(),
              ])),
              Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                    color: Colors.white.withValues(alpha: .07),
                    borderRadius: BorderRadius.circular(14)),
                child: const Row(children: <Widget>[
                  Icon(Icons.shield_outlined,
                      color: Color(0xFFB6C0FF), size: 18),
                  SizedBox(width: 9),
                  Expanded(
                      child: Text('Field access is scoped to your assignments.',
                          style: TextStyle(
                              color: Color(0xFFD0D5EE),
                              fontSize: 11,
                              height: 1.35,
                              fontWeight: FontWeight.w600))),
                ]),
              ),
            ]),
      );

  Widget _brand({bool dark = false}) => Row(children: <Widget>[
        Container(
            width: 40,
            height: 40,
            decoration: BoxDecoration(
                gradient:
                    const LinearGradient(colors: <Color>[_indigo, _violet]),
                borderRadius: BorderRadius.circular(13)),
            child: const Icon(Icons.phone_android_rounded,
                color: Colors.white, size: 21)),
        const SizedBox(width: 10),
        Column(crossAxisAlignment: CrossAxisAlignment.start, children: <Widget>[
          Text('ServicePay',
              style: TextStyle(
                  color: dark ? Colors.white : _ink,
                  fontSize: 15,
                  fontWeight: FontWeight.w900)),
          Text('Phone Officer',
              style: TextStyle(
                  color: dark ? const Color(0xFFB9C2E7) : _muted,
                  fontSize: 10,
                  fontWeight: FontWeight.w600)),
        ]),
      ]);

  Widget _drawer() => Drawer(
        backgroundColor: _navy,
        child: SafeArea(
            child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 20, 16, 12),
          child: Column(children: <Widget>[
            Row(children: <Widget>[
              Expanded(child: _brand(dark: true)),
              IconButton(
                  tooltip: 'Close menu',
                  onPressed: () => Navigator.pop(context),
                  icon: const Icon(Icons.close, color: Colors.white70)),
            ]),
            const SizedBox(height: 24),
            Expanded(
                child: ListView(children: <Widget>[
              ...List<Widget>.generate(
                  _nav.length, (int index) => _navItem(index)),
              _logoutItem(),
            ])),
          ]),
        )),
      );

  Widget _navItem(int index) {
    final bool selected = _section == index;
    return Padding(
      padding: const EdgeInsets.only(bottom: 4),
      child: Material(
        color:
            selected ? Colors.white.withValues(alpha: .13) : Colors.transparent,
        borderRadius: BorderRadius.circular(12),
        child: InkWell(
          borderRadius: BorderRadius.circular(12),
          onTap: () {
            _setSection(index);
            if (MediaQuery.sizeOf(context).width < 980) Navigator.pop(context);
          },
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 11),
            child: Row(children: <Widget>[
              Icon(_nav[index].icon,
                  size: 18,
                  color: selected
                      ? const Color(0xFFB8C0FF)
                      : const Color(0xFFAAB3D5)),
              const SizedBox(width: 12),
              Expanded(
                  child: Text(_nav[index].label,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                          color:
                              selected ? Colors.white : const Color(0xFFD0D5EE),
                          fontSize: 12,
                          fontWeight:
                              selected ? FontWeight.w800 : FontWeight.w600))),
              if (selected)
                const Icon(Icons.chevron_right_rounded,
                    size: 16, color: Color(0xFFB8C0FF)),
            ]),
          ),
        ),
      ),
    );
  }

  Widget _logoutItem() => _NavAction(
        icon: Icons.logout_rounded,
        label: 'Logout',
        onTap: () => _notice('Logout is managed by the authenticated session.'),
      );

  Widget _bottomNav() => Builder(
        builder: (BuildContext bottomContext) => NavigationBar(
          selectedIndex: _section > 3 ? 0 : _section,
          onDestinationSelected: (int value) {
            if (value == 3) {
              Scaffold.of(bottomContext).openDrawer();
            } else {
              _setSection(value);
            }
          },
          backgroundColor: Colors.white,
          indicatorColor: const Color(0xFFE5E8FF),
          destinations: const <NavigationDestination>[
            NavigationDestination(
                icon: Icon(Icons.grid_view_rounded), label: 'Dashboard'),
            NavigationDestination(
                icon: Icon(Icons.assignment_outlined), label: 'Assignments'),
            NavigationDestination(
                icon: Icon(Icons.description_outlined), label: 'Applications'),
            NavigationDestination(
                icon: Icon(Icons.more_horiz_rounded), label: 'More'),
          ],
        ),
      );

  void _setSection(int section) {
    if (section == 3 ||
        section == 4 ||
        section == 5 ||
        section == 6 ||
        section == 7 ||
        section == 8 ||
        section == 9) {
      setState(() => _section = section);
    } else {
      setState(() => _section = section);
    }
  }

  Widget _content() {
    if (_section == 0) return _dashboard();
    if (_section == 1 || _section == 2) return _assignmentsPage();
    return _unavailable(_nav[_section].label);
  }

  Widget _dashboard() => _page(<Widget>[
        _welcome(),
        const SizedBox(height: 22),
        _sectionLabel('PORTFOLIO SNAPSHOT'),
        const SizedBox(height: 11),
        _metrics(),
        const SizedBox(height: 22),
        LayoutBuilder(
            builder: (BuildContext context, BoxConstraints constraints) {
          final Widget overview = _overview();
          final Widget recent = _activity();
          return constraints.maxWidth < 760
              ? Column(children: <Widget>[
                  overview,
                  const SizedBox(height: 16),
                  recent
                ])
              : Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                      Expanded(flex: 5, child: overview),
                      const SizedBox(width: 16),
                      Expanded(flex: 4, child: recent),
                    ]);
        }),
        const SizedBox(height: 22),
        _assignmentSection(),
      ]);

  Widget _page(List<Widget> children) => Padding(
        padding: EdgeInsets.fromLTRB(
            MediaQuery.sizeOf(context).width >= 980 ? 30 : 16,
            24,
            MediaQuery.sizeOf(context).width >= 980 ? 30 : 16,
            30),
        child: children.length == 1
            ? children.first
            : Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: children),
      );
  Widget _welcome() => Container(
        padding: const EdgeInsets.fromLTRB(22, 21, 18, 21),
        decoration: BoxDecoration(
            gradient: const LinearGradient(
                colors: <Color>[_navy, Color(0xFF263579)],
                begin: Alignment.topLeft,
                end: Alignment.bottomRight),
            borderRadius: BorderRadius.circular(20),
            boxShadow: <BoxShadow>[
              BoxShadow(
                  color: _navy.withValues(alpha: .14),
                  blurRadius: 20,
                  offset: const Offset(0, 9))
            ]),
        child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Expanded(
                  child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: <Widget>[
                    const Text('PHONE FINANCING OFFICER PORTAL',
                        style: TextStyle(
                            color: Color(0xFFBDC5FF),
                            fontSize: 9,
                            letterSpacing: 1.2,
                            fontWeight: FontWeight.w900)),
                    const SizedBox(height: 9),
                    Text('Welcome back, ${_officerName()}',
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                            color: Colors.white,
                            fontSize: 23,
                            height: 1.12,
                            fontWeight: FontWeight.w900)),
                    const SizedBox(height: 7),
                    const Text(
                        'Review your field assignments and keep every customer touchpoint moving.',
                        style: TextStyle(
                            color: Color(0xFFD4D9F3),
                            fontSize: 12,
                            height: 1.4)),
                  ])),
              Container(
                  width: 48,
                  height: 48,
                  decoration: BoxDecoration(
                      color: Colors.white.withValues(alpha: .12),
                      shape: BoxShape.circle),
                  child: const Icon(Icons.insights_rounded,
                      color: Color(0xFFC6CCFF), size: 23)),
            ]),
      );
  Widget _sectionLabel(String text) => Text(text,
      style: const TextStyle(
          color: _muted,
          fontSize: 10,
          letterSpacing: 1.4,
          fontWeight: FontWeight.w900));

  Widget _metrics() {
    final int active = _applications
        .where((Map<String, dynamic> row) => <String>[
              'ACTIVE',
              'APPROVED',
              'PAID'
            ].contains(_text(row['status'], '').toUpperCase()))
        .length;
    final List<_Metric> metrics = <_Metric>[
      _Metric('Total Assignments', '${_applications.length}',
          Icons.assignment_outlined, const Color(0xFFE6E9FF)),
      _Metric(
          'Pending verification',
          '${_applications.where(_needsVerification).length}',
          Icons.fact_check_outlined,
          const Color(0xFFFFF1DC)),
      _Metric('Active Financed', '$active',
          Icons.account_balance_wallet_outlined, const Color(0xFFE2F7F0)),
      _Metric('Completed', '${_applications.where(_completed).length}',
          Icons.check_circle_outline_rounded, const Color(0xFFE8EEFA)),
    ];
    return LayoutBuilder(
        builder: (BuildContext context, BoxConstraints constraints) {
      final int columns = constraints.maxWidth >= 850
          ? 4
          : constraints.maxWidth >= 520
              ? 2
              : 1;
      final double width =
          (constraints.maxWidth - (columns - 1) * 11) / columns;
      return Wrap(
          spacing: 11,
          runSpacing: 11,
          children: metrics
              .map((_Metric metric) =>
                  SizedBox(width: width, child: _metricCard(metric)))
              .toList());
    });
  }

  Widget _metricCard(_Metric metric) => Container(
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: _line)),
        child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Container(
                  width: 35,
                  height: 35,
                  decoration: BoxDecoration(
                      color: metric.tint,
                      borderRadius: BorderRadius.circular(11)),
                  child: Icon(metric.icon, color: _indigo, size: 18)),
              const SizedBox(height: 12),
              Text(metric.label,
                  style: const TextStyle(
                      color: _muted,
                      fontSize: 10.5,
                      fontWeight: FontWeight.w700)),
              const SizedBox(height: 4),
              Text(metric.value,
                  style: const TextStyle(
                      color: _ink, fontSize: 20, fontWeight: FontWeight.w900)),
            ]),
      );

  Widget _overview() {
    final int pending = _applications.where(_needsVerification).length;
    final int progress = _applications.where(_inProgress).length;
    final int complete = _applications.where(_completed).length;
    final int total = _applications.length;
    return _card(
        'Assignment overview',
        'Live distribution by application status',
        Column(children: <Widget>[
          _bar('Pending', pending, total, const Color(0xFFF1A43B)),
          _bar('In progress', progress, total, _indigo),
          _bar('Completed', complete, total, const Color(0xFF1CA875)),
        ]));
  }

  Widget _bar(String label, int value, int total, Color color) => Padding(
      padding: const EdgeInsets.only(top: 14),
      child: Row(children: <Widget>[
        SizedBox(
            width: 86,
            child: Text(label,
                style: const TextStyle(
                    color: _muted, fontSize: 11, fontWeight: FontWeight.w700))),
        Expanded(
            child: ClipRRect(
                borderRadius: BorderRadius.circular(8),
                child: LinearProgressIndicator(
                    value: total == 0 ? 0 : value / total,
                    minHeight: 8,
                    backgroundColor: const Color(0xFFEEF0F7),
                    color: color))),
        SizedBox(
            width: 35,
            child: Text('$value',
                textAlign: TextAlign.right,
                style:
                    const TextStyle(color: _ink, fontWeight: FontWeight.w800))),
      ]));
  Widget _activity() {
    final List<Map<String, dynamic>> recent = _applications.take(4).toList();
    return _card(
        'Recent activity',
        'Latest application updates',
        recent.isEmpty
            ? const _EmptyText('No recent activity from your assignments.')
            : Column(
                children: recent
                    .map((Map<String, dynamic> item) => Padding(
                          padding: const EdgeInsets.only(top: 13),
                          child: Row(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: <Widget>[
                                Container(
                                    width: 30,
                                    height: 30,
                                    decoration: BoxDecoration(
                                        color: const Color(0xFFE9EBFF),
                                        borderRadius:
                                            BorderRadius.circular(10)),
                                    child: const Icon(Icons.history_rounded,
                                        color: _indigo, size: 16)),
                                const SizedBox(width: 10),
                                Expanded(
                                    child: Text(
                                        '${_customer(item)} • ${_status(item)}',
                                        maxLines: 2,
                                        overflow: TextOverflow.ellipsis,
                                        style: const TextStyle(
                                            color: _ink,
                                            fontSize: 12,
                                            fontWeight: FontWeight.w700))),
                              ]),
                        ))
                    .toList()));
  }

  Widget _card(String title, String subtitle, Widget child) => Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(17),
            border: Border.all(color: _line)),
        child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Text(title,
                  style: const TextStyle(
                      color: _ink, fontSize: 15, fontWeight: FontWeight.w900)),
              const SizedBox(height: 4),
              Text(subtitle,
                  style: const TextStyle(color: _muted, fontSize: 11)),
              child,
            ]),
      );
  Widget _assignmentSection() =>
      Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: <Widget>[
        Row(children: <Widget>[
          const Expanded(
              child: Text('My assignments',
                  style: TextStyle(
                      color: _ink, fontSize: 17, fontWeight: FontWeight.w900))),
          Text('${_visible.length} records',
              style: const TextStyle(color: _muted, fontSize: 11)),
        ]),
        const SizedBox(height: 11),
        _filterRow(),
        const SizedBox(height: 12),
        if (_visible.isEmpty)
          _card('No assignments found', 'Try another status filter',
              const _EmptyText('There are no applications in this group.'))
        else
          ..._visible.map(_applicationCard),
      ]);
  Widget _filterRow() => SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      child: Row(
          children: _filters
              .map((String value) => Padding(
                    padding: const EdgeInsets.only(right: 8),
                    child: ChoiceChip(
                      key: Key('officer-filter-$value'),
                      label: Text(value == 'ALL'
                          ? 'All'
                          : value
                              .replaceAll('_', ' ')
                              .split(' ')
                              .map((String word) => word.isEmpty
                                  ? word
                                  : '${word[0].toUpperCase()}${word.substring(1).toLowerCase()}')
                              .join(' ')),
                      selected: _filter == value,
                      selectedColor: const Color(0xFFE4E7FF),
                      labelStyle: TextStyle(
                          color: _filter == value ? _indigo : _muted,
                          fontSize: 12,
                          fontWeight: FontWeight.w800),
                      onSelected: (_) => setState(() => _filter = value),
                    ),
                  ))
              .toList()));

  Widget _applicationCard(Map<String, dynamic> item) {
    final String status = _status(item);
    final Color color = _completed(item)
        ? const Color(0xFF16865E)
        : _needsVerification(item)
            ? const Color(0xFFB26A08)
            : _indigo;
    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.all(15),
      decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: _line)),
      child: LayoutBuilder(
          builder: (BuildContext context, BoxConstraints constraints) {
        final Widget action = OutlinedButton(
          onPressed: () => _details(item),
          style: OutlinedButton.styleFrom(
              foregroundColor: _indigo,
              side: const BorderSide(color: Color(0xFFD6DAF7)),
              shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(10))),
          child: const Text('View Details'),
        );
        return Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Container(
                  width: 40,
                  height: 40,
                  decoration: BoxDecoration(
                      color: const Color(0xFFE9EBFF),
                      borderRadius: BorderRadius.circular(12)),
                  child: const Icon(Icons.smartphone_rounded,
                      color: _indigo, size: 20)),
              const SizedBox(width: 12),
              Expanded(
                  child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: <Widget>[
                    Row(children: <Widget>[
                      Expanded(
                          child: Text(
                              _text(item['reference'] ?? _id(item),
                                  'Application'),
                              style: const TextStyle(
                                  color: _ink, fontWeight: FontWeight.w900))),
                      Container(
                          padding: const EdgeInsets.symmetric(
                              horizontal: 8, vertical: 5),
                          decoration: BoxDecoration(
                              color: color.withValues(alpha: .1),
                              borderRadius: BorderRadius.circular(20)),
                          child: Text(status,
                              style: TextStyle(
                                  color: color,
                                  fontSize: 10,
                                  fontWeight: FontWeight.w900))),
                    ]),
                    const SizedBox(height: 9),
                    Wrap(spacing: 16, runSpacing: 7, children: <Widget>[
                      _fact(Icons.person_outline, _customer(item)),
                      _fact(Icons.phone_android_outlined, _phone(item)),
                      _fact(Icons.location_on_outlined, _location(item)),
                      _fact(Icons.payments_outlined, _amount(item)),
                    ]),
                    if (constraints.maxWidth < 560)
                      Padding(
                          padding: const EdgeInsets.only(top: 12),
                          child: Align(
                              alignment: Alignment.centerLeft, child: action))
                  ])),
              if (constraints.maxWidth >= 560)
                Padding(
                    padding: const EdgeInsets.only(left: 10), child: action),
            ]);
      }),
    );
  }

  Widget _fact(IconData icon, String value) =>
      Row(mainAxisSize: MainAxisSize.min, children: <Widget>[
        Icon(icon, size: 14, color: _muted),
        const SizedBox(width: 5),
        ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 150),
            child: Text(value,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                    color: _muted, fontSize: 11, fontWeight: FontWeight.w600))),
      ]);

  Widget _assignmentsPage() => _page(<Widget>[
        Text(_nav[_section].label,
            style: const TextStyle(
                color: _ink, fontSize: 24, fontWeight: FontWeight.w900)),
        const SizedBox(height: 5),
        const Text(
            'Work only with applications assigned to your officer portfolio.',
            style: TextStyle(color: _muted)),
        const SizedBox(height: 20),
        _assignmentSection(),
      ]);
  Widget _unavailable(String label) => _page(<Widget>[
        Text(label,
            style: const TextStyle(
                color: _ink, fontSize: 24, fontWeight: FontWeight.w900)),
        const SizedBox(height: 14),
        _card(
            'Scoped view unavailable',
            'This workspace does not provide this operation',
            const _EmptyText(
                'This section is not available to Phone Financing Officers. Your assignment workflow remains available from My Assignments.')),
      ]);
  Widget _errorView() => Center(
      child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(mainAxisSize: MainAxisSize.min, children: <Widget>[
            const Icon(Icons.cloud_off_rounded, color: _indigo, size: 38),
            const SizedBox(height: 12),
            Text(_error, textAlign: TextAlign.center),
            const SizedBox(height: 14),
            FilledButton(onPressed: _load, child: const Text('Try again')),
          ])));

  Future<void> _details(Map<String, dynamic> summary) async {
    Map<String, dynamic> item = summary;
    try {
      final String id = _id(summary);
      if (id.isNotEmpty) {
        item = _map((await _api.application(id))['application'])
          ..addAll(summary);
      }
    } catch (_) {}
    if (!mounted) return;
    final Map<String, dynamic> customer = _map(item['customer']);
    final Map<String, dynamic> kyc = _map(item['kycSnapshot']);
    final Map<String, dynamic> input = _map(item['applicationInput']);
    final List<Map<String, dynamic>> followUps = _list(item['followUps']);
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      builder: (BuildContext context) => SafeArea(
          child: Padding(
        padding: const EdgeInsets.all(20),
        child: SingleChildScrollView(
            child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
              Text(_text(customer['fullName'], 'Customer'),
                  style: const TextStyle(
                      color: _ink, fontSize: 22, fontWeight: FontWeight.w900)),
              const SizedBox(height: 12),
              _detail('Reference', _text(item['reference'])),
              _detail('Phone', _text(customer['phone'])),
              _detail('Address', _text(customer['address'] ?? item['address'])),
              _detail('KYC status', _text(kyc['status'])),
              _detail('Occupation', _text(input['occupation'])),
              _detail('Monthly income', _text(input['monthlyIncome'])),
              _detail('State / LGA',
                  '${_text(input['state'])} / ${_text(input['lga'])}'),
              _detail('Requested term',
                  '${_text(input['preferredDurationWeeks'])} weeks'),
              _detail('Product', _phone(item)),
              _detail('Application status', _text(item['status'])),
              if (_map(item['verification'] ?? item['verificationReport'])
                  .isNotEmpty)
                _detail(
                    'Verification recommendation',
                    _text(_map(item['verification'] ??
                        item['verificationReport'])['recommendation'])),
              if (followUps.isNotEmpty) ...<Widget>[
                const SizedBox(height: 7),
                const Text('Follow-up history',
                    style: TextStyle(color: _ink, fontWeight: FontWeight.w800)),
                ...followUps.map((Map<String, dynamic> followUp) => _detail(
                    '${_text(followUp['outcome'], 'Contacted / visited')} • ${_text(followUp['createdAt'])}',
                    '${_text(followUp['note'] ?? followUp['notes'])} • Next: ${_text(followUp['nextFollowUpAt'])}')),
              ],
              const SizedBox(height: 14),
              if (_needsVerification(item))
                FilledButton.icon(
                    onPressed: () {
                      Navigator.pop(context);
                      _verificationForm(item);
                    },
                    icon: const Icon(Icons.fact_check_outlined),
                    label: const Text('Submit verification')),
              TextButton.icon(
                  onPressed: () {
                    Navigator.pop(context);
                    _followUpForm(item);
                  },
                  icon: const Icon(Icons.phone_in_talk_outlined),
                  label: const Text('Record follow-up')),
            ])),
      )),
    );
  }

  Widget _detail(String label, String value) => Padding(
      padding: const EdgeInsets.only(bottom: 7),
      child: Text('$label: $value', style: const TextStyle(color: _ink)));

  Future<void> _verificationForm(Map<String, dynamic> item) async {
    final TextEditingController notes = TextEditingController();
    final TextEditingController income = TextEditingController();
    final TextEditingController guarantor = TextEditingController();
    String recommendation = 'NEED_MORE_INFORMATION';
    final Map<String, bool> checklist = <String, bool>{
      'identityConfirmed': false,
      'phoneConfirmed': false,
      'addressConfirmed': false,
      'occupationConfirmed': false,
      'incomeAssessed': false,
      'customerContacted': false,
    };
    final bool? submit = await showDialog<bool>(
      context: context,
      builder: (BuildContext dialog) => StatefulBuilder(
        builder: (BuildContext context, StateSetter setDialogState) =>
            AlertDialog(
          title: const Text('Verification findings'),
          content: SizedBox(
              width: 520,
              child: SingleChildScrollView(
                  child:
                      Column(mainAxisSize: MainAxisSize.min, children: <Widget>[
                ...checklist.keys.map((String key) => CheckboxListTile(
                    contentPadding: EdgeInsets.zero,
                    value: checklist[key],
                    title: Text(key.replaceAllMapped(
                        RegExp(r'([A-Z])'), (Match m) => ' ${m.group(1)}')),
                    onChanged: (bool? value) =>
                        setDialogState(() => checklist[key] = value == true))),
                TextField(
                    controller: income,
                    decoration:
                        const InputDecoration(labelText: 'Income assessment')),
                TextField(
                    controller: guarantor,
                    decoration: const InputDecoration(
                        labelText: 'Guarantor details (optional)')),
                TextField(
                    controller: notes,
                    maxLines: 3,
                    decoration:
                        const InputDecoration(labelText: 'Field notes')),
                DropdownButtonFormField<String>(
                    value: recommendation,
                    decoration:
                        const InputDecoration(labelText: 'Recommendation'),
                    items: const <String>[
                      'APPROVE',
                      'REJECT',
                      'NEED_MORE_INFORMATION'
                    ]
                        .map((String value) => DropdownMenuItem(
                            value: value,
                            child: Text(value.replaceAll('_', ' '))))
                        .toList(),
                    onChanged: (String? value) => setDialogState(
                        () => recommendation = value ?? recommendation)),
              ]))),
          actions: <Widget>[
            TextButton(
                onPressed: () => Navigator.pop(dialog, false),
                child: const Text('Cancel')),
            FilledButton(
                onPressed: () => Navigator.pop(dialog, true),
                child: const Text('Submit report')),
          ],
        ),
      ),
    );
    if (submit == true) {
      try {
        await _api.submitVerification(_id(item), <String, dynamic>{
          'decision': recommendation,
          'recommendation': recommendation,
          'checklist': checklist,
          'findings': <String, dynamic>{
            'incomeAssessment': income.text.trim(),
            'guarantorDetails': guarantor.text.trim()
          },
          'notes': notes.text.trim(),
        });
        _notice('Verification report submitted for Head Office review.');
        await _load();
      } on PhoneFinancingOfficerApiException catch (error) {
        _notice(error.message, error: true);
      }
    }
    notes.dispose();
    income.dispose();
    guarantor.dispose();
  }

  Future<void> _followUpForm(Map<String, dynamic> item) async {
    final TextEditingController notes = TextEditingController();
    final TextEditingController nextFollowUpAt = TextEditingController();
    String outcome = 'CONTACTED';
    String method = 'PHONE';
    final bool? save = await showDialog<bool>(
        context: context,
        builder: (BuildContext dialog) => StatefulBuilder(
              builder: (BuildContext context, StateSetter setDialogState) =>
                  AlertDialog(
                title: const Text('Record follow-up'),
                content:
                    Column(mainAxisSize: MainAxisSize.min, children: <Widget>[
                  DropdownButtonFormField<String>(
                      value: method,
                      decoration:
                          const InputDecoration(labelText: 'Contact method'),
                      items: const <String>['PHONE', 'VISIT', 'SMS', 'WHATSAPP']
                          .map((String value) => DropdownMenuItem(
                              value: value, child: Text(value)))
                          .toList(),
                      onChanged: (String? value) =>
                          setDialogState(() => method = value ?? method)),
                  DropdownButtonFormField<String>(
                      value: outcome,
                      decoration: const InputDecoration(labelText: 'Outcome'),
                      items: const <String>[
                        'CONTACTED',
                        'UNABLE_TO_CONTACT',
                        'MORE_INFORMATION_REQUIRED'
                      ]
                          .map((String value) => DropdownMenuItem(
                              value: value,
                              child: Text(value.replaceAll('_', ' '))))
                          .toList(),
                      onChanged: (String? value) =>
                          setDialogState(() => outcome = value ?? outcome)),
                  TextField(
                      controller: notes,
                      maxLines: 3,
                      decoration:
                          const InputDecoration(labelText: 'Follow-up notes')),
                  TextField(
                      controller: nextFollowUpAt,
                      decoration: const InputDecoration(
                          labelText: 'Next follow-up (ISO date, optional)')),
                ]),
                actions: <Widget>[
                  TextButton(
                      onPressed: () => Navigator.pop(dialog, false),
                      child: const Text('Cancel')),
                  FilledButton(
                      onPressed: () => Navigator.pop(dialog, true),
                      child: const Text('Save follow-up')),
                ],
              ),
            ));
    if (save == true) {
      try {
        await _api.createFollowUp(_id(item), <String, dynamic>{
          'outcome': outcome,
          'notes': notes.text.trim(),
          'contactMethod': method,
          if (nextFollowUpAt.text.trim().isNotEmpty)
            'nextFollowUpAt': nextFollowUpAt.text.trim(),
        });
        _notice('Follow-up saved.');
        await _load();
      } on PhoneFinancingOfficerApiException catch (error) {
        _notice(error.message, error: true);
      }
    }
    notes.dispose();
    nextFollowUpAt.dispose();
  }
}

class _NavItem {
  const _NavItem(this.label, this.icon);
  final String label;
  final IconData icon;
}

class _Metric {
  const _Metric(this.label, this.value, this.icon, this.tint);
  final String label;
  final String value;
  final IconData icon;
  final Color tint;
}

class _NavAction extends StatelessWidget {
  const _NavAction(
      {required this.icon, required this.label, required this.onTap});
  final IconData icon;
  final String label;
  final VoidCallback onTap;
  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(bottom: 4),
        child: InkWell(
            onTap: onTap,
            borderRadius: BorderRadius.circular(12),
            child: Padding(
                padding:
                    const EdgeInsets.symmetric(horizontal: 12, vertical: 11),
                child: Row(children: <Widget>[
                  Icon(icon, size: 18, color: const Color(0xFFAAB3D5)),
                  const SizedBox(width: 12),
                  Text(label,
                      style: const TextStyle(
                          color: Color(0xFFD0D5EE),
                          fontSize: 12,
                          fontWeight: FontWeight.w600)),
                ]))),
      );
}

class _EmptyText extends StatelessWidget {
  const _EmptyText(this.text);
  final String text;
  @override
  Widget build(BuildContext context) => Padding(
      padding: const EdgeInsets.only(top: 18, bottom: 4),
      child: Text(text, style: const TextStyle(color: _muted, fontSize: 12)));
}

class _LoadingView extends StatelessWidget {
  const _LoadingView();
  @override
  Widget build(BuildContext context) => ListView(
        padding: const EdgeInsets.all(20),
        children: <Widget>[
          Container(
              height: 150,
              decoration: BoxDecoration(
                  color: Colors.white,
                  borderRadius: BorderRadius.circular(20))),
          const SizedBox(height: 18),
          Wrap(
            spacing: 12,
            runSpacing: 12,
            children: List<Widget>.generate(
                4,
                (int index) => Container(
                    width: 180,
                    height: 110,
                    decoration: BoxDecoration(
                        color: Colors.white,
                        borderRadius: BorderRadius.circular(16)))),
          ),
        ],
      );
}

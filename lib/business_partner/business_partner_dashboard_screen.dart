import 'package:flutter/material.dart';

import 'business_partner_permissions.dart';
import '../services/business_partner_api_service.dart';

const Color _green = Color(0xFF08783E);
const Color _ink = Color(0xFF17352A);

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
    _Section('Dashboard', Icons.dashboard_outlined),
    _Section('My Officers', Icons.badge_outlined),
    _Section('Customers', Icons.people_outline),
    _Section('Solar', Icons.solar_power_outlined),
    _Section('Phone Financing', Icons.phone_android_outlined),
    _Section('Sales & Applications', Icons.assignment_outlined),
    _Section('Repayments', Icons.event_repeat_outlined),
    _Section('Commission', Icons.account_balance_wallet_outlined),
    _Section('Performance', Icons.insights_outlined),
    _Section('Reports', Icons.analytics_outlined),
    _Section('Notifications', Icons.notifications_outlined),
    _Section('Profile', Icons.person_outline),
  ];

  @override
  void initState() {
    super.initState();
    _api = widget.api ?? BusinessPartnerApiService();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = '';
    });
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
    await Future.wait(calls.entries.map((entry) async {
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
      _responses['Activity'] = received['Activity'] ?? <String, dynamic>{};
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

  Map<String, dynamic> _map(dynamic value) =>
      value is Map ? Map<String, dynamic>.from(value) : <String, dynamic>{};
  List<Map<String, dynamic>> _list(dynamic value) => value is List
      ? value.whereType<Map>().map((Map item) => _map(item)).toList()
      : <Map<String, dynamic>>[];
  String _text(dynamic value, [String fallback = '—']) {
    final String text = value?.toString().trim() ?? '';
    return text.isEmpty || text == 'null' ? fallback : text;
  }

  String _label(String value) => value
      .replaceAllMapped(
          RegExp(r'([a-z])([A-Z])'), (Match m) => '${m[1]} ${m[2]}')
      .replaceAll('_', ' ');
  String _money(dynamic value) {
    final num amount = value is num ? value : num.tryParse('$value') ?? 0;
    return '₦${amount.toStringAsFixed(2)}';
  }

  @override
  Widget build(BuildContext context) {
    final bool wide = MediaQuery.sizeOf(context).width >= 900;
    return Scaffold(
      key: const Key('business-partner-dashboard'),
      backgroundColor: const Color(0xFFF4F8F5),
      appBar: AppBar(
        title: Text('Business Partner • ${_sections[_section].title}'),
        backgroundColor: _ink,
        foregroundColor: Colors.white,
        actions: <Widget>[
          IconButton(
              tooltip: 'Refresh',
              onPressed: _loading ? null : _load,
              icon: const Icon(Icons.refresh))
        ],
      ),
      drawer: wide ? null : _drawer(),
      body: _loading
          ? const Center(child: CircularProgressIndicator(color: _green))
          : _error.isNotEmpty
              ? _errorView()
              : Row(children: <Widget>[
                  if (wide) _rail(),
                  Expanded(child: _content())
                ]),
    );
  }

  Widget _rail() => NavigationRail(
        selectedIndex: _section,
        labelType: NavigationRailLabelType.all,
        onDestinationSelected: (int value) => setState(() => _section = value),
        destinations: _sections
            .map((_Section item) => NavigationRailDestination(
                  icon: Icon(item.icon),
                  selectedIcon: Icon(item.icon, color: _green),
                  label: Text(item.title),
                ))
            .toList(),
      );
  Widget _drawer() => Drawer(
          child: SafeArea(
              child: ListView(children: <Widget>[
        const ListTile(
            leading: Icon(Icons.handshake_outlined, color: _green),
            title: Text('ServicePay Business Partner',
                style: TextStyle(fontWeight: FontWeight.w900))),
        const Divider(),
        for (int i = 0; i < _sections.length; i++)
          ListTile(
            selected: _section == i,
            leading: Icon(_sections[i].icon),
            title: Text(_sections[i].title),
            onTap: () {
              setState(() => _section = i);
              Navigator.pop(context);
            },
          ),
      ])));

  Widget _content() {
    final String title = _sections[_section].title;
    final Map<String, dynamic> response =
        _responses[title] ?? <String, dynamic>{};
    if (response.containsKey('_unavailable')) {
      return _page(<Widget>[
        Text(title,
            style: const TextStyle(
                fontSize: 23, fontWeight: FontWeight.w900, color: _ink)),
        _empty('Unavailable: ${_text(response['_unavailable'])}'),
      ]);
    }
    if (_section == 0) return _dashboard();
    if (_section == 8) return _performance();
    if (_section == 11) return _profile();
    return _records(_sections[_section].title);
  }

  Widget _dashboard() {
    final Map<String, dynamic> data =
        _value('Dashboard', <String>['dashboard', 'data']);
    final Map<String, dynamic> profile =
        _value('Profile', <String>['partner', 'profile']);
    return _page(<Widget>[
      Text(
          'Welcome, ${_text(profile['businessName'] ?? profile['name'], 'Business Partner')}',
          style: const TextStyle(
              fontSize: 24, fontWeight: FontWeight.w900, color: _ink)),
      const SizedBox(height: 5),
      const Text(
          'Monitor your assigned officers, customers, sales and portfolio performance.'),
      const SizedBox(height: 18),
      if (data.isEmpty)
        _empty('No dashboard metrics are available yet.')
      else
        _metrics(data),
      const SizedBox(height: 22),
      const Text('Portfolio snapshot',
          style: TextStyle(fontSize: 19, fontWeight: FontWeight.w900)),
      const SizedBox(height: 10),
      _chart(data),
    ]);
  }

  Map<String, dynamic> _value(String key, List<String> candidates) {
    final Map<String, dynamic> response =
        _responses[key] ?? <String, dynamic>{};
    for (final String candidate in candidates) {
      final Map<String, dynamic> found = _map(response[candidate]);
      if (found.isNotEmpty) return found;
    }
    return response;
  }

  Widget _metrics(Map<String, dynamic> values) => Wrap(
        spacing: 12,
        runSpacing: 12,
        children: values.entries
            .map((MapEntry<String, dynamic> item) => SizedBox(
                width: 205,
                child: Card(
                  elevation: 0,
                  child: Padding(
                      padding: const EdgeInsets.all(16),
                      child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: <Widget>[
                            Text(_label(item.key),
                                style: const TextStyle(color: Colors.blueGrey)),
                            const SizedBox(height: 8),
                            Text(
                                _isMoney(item.key)
                                    ? _money(item.value)
                                    : _text(item.value, '0'),
                                style: const TextStyle(
                                    fontSize: 22,
                                    fontWeight: FontWeight.w900,
                                    color: _ink)),
                          ])),
                )))
            .toList(),
      );
  bool _isMoney(String key) => <String>[
        'amount',
        'value',
        'commission',
        'revenue',
        'sales',
      ].any((String term) => key.toLowerCase().contains(term));

  Widget _chart(Map<String, dynamic> values) {
    final List<num> numbers = values.values.whereType<num>().take(6).toList();
    if (numbers.isEmpty) {
      return _empty('Performance data will appear when activity is recorded.');
    }
    final num max = numbers.reduce((num a, num b) => a > b ? a : b);
    return Card(
        elevation: 0,
        child: SizedBox(
            height: 160,
            child: Padding(
                padding: const EdgeInsets.all(16),
                child: Row(
                    crossAxisAlignment: CrossAxisAlignment.end,
                    children: numbers
                        .map((num value) => Expanded(
                            child: Padding(
                                padding:
                                    const EdgeInsets.symmetric(horizontal: 5),
                                child: FractionallySizedBox(
                                    heightFactor: max == 0
                                        ? 0
                                        : value.toDouble() / max.toDouble(),
                                    alignment: Alignment.bottomCenter,
                                    child: Container(
                                        decoration: BoxDecoration(
                                            color: _green,
                                            borderRadius:
                                                BorderRadius.circular(5)))))))
                        .toList()))));
  }

  Widget _records(String title) {
    final Map<String, dynamic> source =
        _responses[title] ?? <String, dynamic>{};
    final List<Map<String, dynamic>> rows = _recordsFor(title, source);
    final bool filterable = <String>[
      'Customers',
      'Solar',
      'Phone Financing',
      'Sales & Applications',
      'Repayments'
    ].contains(title);
    return _page(<Widget>[
      Row(children: <Widget>[
        Expanded(
            child: Text(title,
                style: const TextStyle(
                    fontSize: 23, fontWeight: FontWeight.w900, color: _ink))),
        if (filterable) ...<Widget>[
          _filterMenu(),
          IconButton(
              tooltip: 'More filters',
              onPressed: _filterDialog,
              icon: const Icon(Icons.tune))
        ]
      ]),
      const SizedBox(height: 5),
      const Text(
          'Only records assigned to your Business Partner account are shown.',
          style: TextStyle(color: Colors.blueGrey)),
      const SizedBox(height: 14),
      if (source.containsKey('_unavailable'))
        _empty('Unavailable: ${_text(source['_unavailable'])}')
      else if (rows.isEmpty)
        _empty(
            'No $title records found${_filter == 'ALL' ? '.' : ' for $_filter.'}')
      else
        LayoutBuilder(
            builder: (BuildContext context, BoxConstraints constraints) =>
                constraints.maxWidth >= 700
                    ? _table(rows)
                    : Column(
                        children: rows
                            .map(
                                (Map<String, dynamic> row) => _card(row, title))
                            .toList())),
    ]);
  }

  List<Map<String, dynamic>> _recordsFor(
    String title,
    Map<String, dynamic> source,
  ) {
    if (title == 'My Officers') {
      final Map<String, dynamic> officers = _map(source['officers']);
      return <Map<String, dynamic>>[
        ..._list(officers['solar']),
        ..._list(officers['phone']),
      ];
    }
    if (<String>['Solar', 'Phone Financing', 'Sales & Applications']
        .contains(title)) {
      final Map<String, dynamic> apps = _map(source['applications']);
      final List<Map<String, dynamic>> all = title == 'Solar'
          ? _list(apps['solar'])
          : title == 'Phone Financing'
              ? _list(apps['phone'])
              : <Map<String, dynamic>>[
                  ..._list(apps['solar']),
                  ..._list(apps['phone']),
                ];
      return _filterRows(all);
    }
    if (title == 'Repayments') {
      final Map<String, dynamic> repayments = _map(source['repayments']);
      return _filterRows(<Map<String, dynamic>>[
        ..._list(repayments['solar']),
        ..._list(repayments['phone']),
      ]);
    }
    return _filterRows(_list(source['items'] ??
        source['data'] ??
        source['customers'] ??
        source['notifications'] ??
        source['reports'] ??
        source['commissions']));
  }

  List<Map<String, dynamic>> _filterRows(List<Map<String, dynamic>> rows) {
    if (_filter == 'ALL') return rows;
    return rows
        .where((Map<String, dynamic> row) =>
            _text(row['status'], '').toUpperCase() == _filter)
        .toList();
  }

  Widget _filterMenu() => DropdownButton<String>(
        value: _filter,
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
                  title: const Text('Server-side filters'),
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
                        decoration: const InputDecoration(
                            labelText: 'Officer ID (optional)')),
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

  Widget _table(List<Map<String, dynamic>> rows) {
    final List<String> columns = rows.first.keys.take(4).toList();
    return SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        child: DataTable(
          columns: columns
              .map((String key) => DataColumn(label: Text(_label(key))))
              .toList(),
          rows: rows
              .take(50)
              .map((Map<String, dynamic> row) => DataRow(
                  cells: columns
                      .map((String key) => DataCell(SizedBox(
                          width: 150,
                          child: Text(_text(_map(row[key])['name'] ?? row[key]),
                              overflow: TextOverflow.ellipsis))))
                      .toList()))
              .toList(),
        ));
  }

  Widget _card(Map<String, dynamic> row, [String? section]) => Card(
      elevation: 0,
      child: Padding(
          padding: const EdgeInsets.all(14),
          child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                ...row.entries.take(6).map((MapEntry<String, dynamic> entry) =>
                    Padding(
                        padding: const EdgeInsets.only(bottom: 5),
                        child: Text(
                            '${_label(entry.key)}: ${_text(_map(entry.value)['name'] ?? entry.value)}'))),
                if ((section == 'Solar' || section == 'Phone Financing') &&
                    (_canAssign(section == 'Solar' ? 'SOLAR' : 'PHONE') ||
                        _canReview)) ...<Widget>[
                  const SizedBox(height: 6),
                  Wrap(spacing: 8, children: <Widget>[
                    if (_canAssign(section == 'Solar' ? 'SOLAR' : 'PHONE'))
                      OutlinedButton(
                          onPressed: () => _assign(
                              row, section == 'Solar' ? 'SOLAR' : 'PHONE'),
                          child: const Text('Assign officer')),
                    if (_canReview)
                      TextButton(
                          onPressed: () => _review(
                              row, section == 'Solar' ? 'SOLAR' : 'PHONE'),
                          child: const Text('Review verification')),
                  ]),
                ],
              ])));

  String _id(Map<String, dynamic> value) =>
      _text(value['_id'] ?? value['id'], '');

  bool _canAssign(String type) => businessPartnerHasPermission(
      _value('Profile', <String>['partner', 'profile', 'data']),
      type == 'SOLAR' ? 'SOLAR_ASSIGNMENT' : 'PHONE_ASSIGNMENT');

  bool get _canReview => businessPartnerHasPermission(
      _value('Profile', <String>['partner', 'profile', 'data']),
      'VERIFICATION_REVIEW');

  Future<void> _assign(Map<String, dynamic> application, String type) async {
    if (!_canAssign(type)) {
      _notice('You do not have permission to assign $type applications.',
          error: true);
      return;
    }
    final Map<String, dynamic> officers =
        _map(_responses['My Officers']?['officers']);
    final List<Map<String, dynamic>> available =
        _list(officers[type == 'SOLAR' ? 'solar' : 'phone']);
    if (available.isEmpty) {
      _notice('No owned $type officers are available for assignment.',
          error: true);
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
      _notice('Officer assigned within your partner portfolio.');
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

  Widget _performance() {
    final Map<String, dynamic> data =
        _value('Performance', <String>['performance', 'data']);
    return _page(<Widget>[
      const Text('Performance',
          style: TextStyle(
              fontSize: 23, fontWeight: FontWeight.w900, color: _ink)),
      const SizedBox(height: 14),
      _chart(data),
      const SizedBox(height: 14),
      if (data.isEmpty)
        _empty('No performance data is available yet.')
      else
        _metrics(data)
    ]);
  }

  Widget _profile() {
    final Map<String, dynamic> profile =
        _value('Profile', <String>['partner', 'profile', 'data']);
    return _page(<Widget>[
      const Text('Business Partner profile',
          style: TextStyle(
              fontSize: 23, fontWeight: FontWeight.w900, color: _ink)),
      const SizedBox(height: 14),
      if (profile.isEmpty)
        _empty('No profile details are available.')
      else
        _card(profile)
    ]);
  }

  Widget _page(List<Widget> children) => RefreshIndicator(
      onRefresh: _load,
      child: ListView(padding: const EdgeInsets.all(20), children: children));
  Widget _empty(String message) => Padding(
      padding: const EdgeInsets.all(32),
      child: Center(
          child: Text(message,
              textAlign: TextAlign.center,
              style: const TextStyle(color: Colors.blueGrey))));
  Widget _errorView() => Center(
      child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(mainAxisSize: MainAxisSize.min, children: <Widget>[
            Text(_error, textAlign: TextAlign.center),
            const SizedBox(height: 12),
            FilledButton(onPressed: _load, child: const Text('Try again'))
          ])));
}

class _Section {
  const _Section(this.title, this.icon);
  final String title;
  final IconData icon;
}

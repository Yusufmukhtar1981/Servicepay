import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'admin_business_partners_api.dart';
import 'business_partner_access_catalog.dart';

const _bpGreen = Color(0xFF08783E);
const _bpInk = Color(0xFF17352B);
const _bpPaper = Color(0xFFF4F8F3);

/// Head Office operational management of ServicePay Business Partners.
class AdminBusinessPartnersScreen extends StatefulWidget {
  const AdminBusinessPartnersScreen({super.key, this.api});
  final AdminBusinessPartnersApi? api;

  @override
  State<AdminBusinessPartnersScreen> createState() =>
      _AdminBusinessPartnersScreenState();
}

class _AdminBusinessPartnersScreenState
    extends State<AdminBusinessPartnersScreen> {
  late final AdminBusinessPartnersApi _api;
  final _search = TextEditingController();
  bool _loading = true;
  bool _accessLoaded = false;
  bool _isHeadOffice = false;
  Set<String> _permissions = <String>{};
  String _error = '';
  String _status = '';
  Map<String, dynamic> _counts = {};
  List<Map<String, dynamic>> _partners = [];

  @override
  void initState() {
    super.initState();
    _api = widget.api ?? AdminBusinessPartnersApi();
    _loadAccess();
  }

  @override
  void dispose() {
    _search.dispose();
    _api.close();
    super.dispose();
  }

  Map<String, dynamic> _map(dynamic value) =>
      value is Map ? Map<String, dynamic>.from(value) : {};
  List<Map<String, dynamic>> _list(dynamic value) => value is List
      ? value.whereType<Map>().map((item) => _map(item)).toList()
      : [];
  List<String> _strings(dynamic value) => value is List
      ? value
          .map((item) => item.toString().trim().toUpperCase())
          .where((item) => item.isNotEmpty)
          .toList()
      : <String>[];
  String _id(Map<String, dynamic> value) =>
      '${value['_id'] ?? value['id'] ?? ''}'.trim();
  String _text(dynamic value, [String fallback = '—']) {
    final text = value?.toString().trim() ?? '';
    return text.isEmpty || text == 'null' ? fallback : text;
  }

  String _name(Map<String, dynamic> partner) => _text(
      partner['businessName'] ?? partner['name'] ?? partner['companyName'],
      'Unnamed business');
  String _partnerStatus(Map<String, dynamic> partner) =>
      _text(partner['status'], 'ACTIVE').toUpperCase();

  bool _hasPermission(String permission) =>
      _isHeadOffice || _permissions.contains(permission.toLowerCase());

  Future<void> _loadAccess() async {
    final prefs = await SharedPreferences.getInstance();
    final role = (prefs.getString('user_role') ??
            prefs.getString('admin_role') ??
            prefs.getString('role') ??
            '')
        .trim()
        .toUpperCase()
        .replaceAll(RegExp(r'[\s-]+'), '_');
    final permissions = (prefs.getStringList('staff_permissions') ?? const [])
        .map((permission) => permission.trim().toLowerCase())
        .where((permission) => permission.isNotEmpty)
        .toSet();
    if (!mounted) return;
    setState(() {
      _isHeadOffice = role == 'HEAD_OFFICE';
      _permissions = permissions;
      _accessLoaded = true;
    });
    if (!_hasPermission('business_partners.view')) {
      setState(() {
        _loading = false;
        _error =
            'You do not have permission to view ServicePay Business Partners.';
      });
      return;
    }
    await _load();
  }

  Future<void> _load() async {
    if (!_accessLoaded || !_hasPermission('business_partners.view')) return;
    if (mounted) {
      setState(() {
        _loading = true;
        _error = '';
      });
    }
    try {
      final result = await Future.wait([
        _api.list(search: _search.text, status: _status),
        _api.counts(),
      ]);
      if (!mounted) {
        return;
      }
      final listing = result[0];
      setState(() {
        _partners =
            _list(listing['partners'] ?? listing['items'] ?? listing['data']);
        _counts = _map(result[1]['counts'] ?? result[1]['data'] ?? result[1]);
        _loading = false;
      });
    } on AdminBusinessPartnersException catch (error) {
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
          _error = 'Unable to load business partners.';
        });
      }
    }
  }

  void _notice(String text, {bool error = false}) {
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(
        content: Text(text),
        behavior: SnackBarBehavior.floating,
        backgroundColor: error ? const Color(0xFFB42318) : _bpGreen,
      ));
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        backgroundColor: _bpPaper,
        appBar: AppBar(
          title: const Text('Business Partner Control Center',
              style: TextStyle(fontWeight: FontWeight.w800, color: _bpInk)),
          backgroundColor: _bpPaper,
          foregroundColor: _bpInk,
          elevation: 0,
          actions: [
            IconButton(
                onPressed: _load,
                icon: const Icon(Icons.refresh),
                tooltip: 'Refresh')
          ],
        ),
        floatingActionButton: _hasPermission('business_partners.create')
            ? FloatingActionButton.extended(
                onPressed: () => _editor(),
                backgroundColor: _bpGreen,
                icon: const Icon(Icons.add_business_outlined),
                label: const Text('New partner'),
              )
            : null,
        body: _loading
            ? const Center(child: CircularProgressIndicator())
            : _error.isNotEmpty
                ? _errorState()
                : RefreshIndicator(onRefresh: _load, child: _body()),
      );

  Widget _errorState() => Center(
          child: Padding(
        padding: const EdgeInsets.all(28),
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          const Icon(Icons.cloud_off_outlined,
              size: 44, color: Colors.blueGrey),
          const SizedBox(height: 12),
          Text(_error, textAlign: TextAlign.center),
          const SizedBox(height: 12),
          FilledButton(onPressed: _load, child: const Text('Try again')),
        ]),
      ));

  Widget _body() => ListView(padding: const EdgeInsets.all(20), children: [
        const Text('Head Office oversight',
            style: TextStyle(
                fontSize: 24, fontWeight: FontWeight.w800, color: _bpInk)),
        const SizedBox(height: 5),
        const Text(
            'Manage approved business relationships, territory coverage and operational performance.'),
        const SizedBox(height: 18),
        Wrap(spacing: 12, runSpacing: 12, children: [
          _metric('All partners', _count('total', _partners.length),
              Icons.business_outlined),
          _metric(
              'Active',
              _count('active',
                  _partners.where((x) => _partnerStatus(x) == 'ACTIVE').length),
              Icons.verified_outlined),
          _metric(
              'Suspended',
              _count(
                  'suspended',
                  _partners
                      .where((x) => _partnerStatus(x) == 'SUSPENDED')
                      .length),
              Icons.pause_circle_outline),
          _metric(
              'Disabled',
              _count(
                  'disabled',
                  _partners
                      .where((x) => _partnerStatus(x) == 'DISABLED')
                      .length),
              Icons.block_outlined),
        ]),
        const SizedBox(height: 20),
        TextField(
          controller: _search,
          onSubmitted: (_) => _load(),
          decoration: InputDecoration(
            labelText: 'Search business name, contact, phone or territory',
            prefixIcon: const Icon(Icons.search),
            suffixIcon: IconButton(
                onPressed: _load, icon: const Icon(Icons.arrow_forward)),
            filled: true,
            fillColor: Colors.white,
            border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
          ),
        ),
        const SizedBox(height: 12),
        SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: Row(children: [
              for (final value in const ['', 'ACTIVE', 'SUSPENDED', 'DISABLED'])
                Padding(
                    padding: const EdgeInsets.only(right: 8),
                    child: ChoiceChip(
                      label: Text(value.isEmpty ? 'All' : value),
                      selected: _status == value,
                      onSelected: (_) {
                        setState(() => _status = value);
                        _load();
                      },
                    )),
            ])),
        const SizedBox(height: 16),
        if (_partners.isEmpty)
          const _BpEmpty('No business partners match the current filters.')
        else
          ..._partners.map(_partnerCard),
        const SizedBox(height: 84),
      ]);

  dynamic _count(String key, int fallback) =>
      _counts[key] ?? _counts['${key}Partners'] ?? fallback;

  Widget _metric(String label, dynamic value, IconData icon) => Container(
        width: 170,
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(14),
            border: Border.all(color: const Color(0xFFDCE8DE))),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Icon(icon, color: _bpGreen),
          const SizedBox(height: 12),
          Text('$value',
              style: const TextStyle(
                  fontSize: 25, fontWeight: FontWeight.w800, color: _bpInk)),
          Text(label, style: const TextStyle(color: Colors.blueGrey)),
        ]),
      );

  Widget _partnerCard(Map<String, dynamic> partner) => Card(
        elevation: 0,
        color: Colors.white,
        margin: const EdgeInsets.only(bottom: 10),
        shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(12),
            side: const BorderSide(color: Color(0xFFDCE8DE))),
        child: ListTile(
          onTap: () => _detail(partner),
          contentPadding:
              const EdgeInsets.symmetric(horizontal: 16, vertical: 7),
          leading: CircleAvatar(
              backgroundColor: const Color(0xFFE3F3E8),
              foregroundColor: _bpGreen,
              child: const Icon(Icons.domain_outlined)),
          title: Text(_name(partner),
              style:
                  const TextStyle(fontWeight: FontWeight.w800, color: _bpInk)),
          subtitle: Padding(
              padding: const EdgeInsets.only(top: 5),
              child: Text([
                _text(
                    partner['contactName'] ??
                        _map(partner['primaryContact'])['name'],
                    'No contact'),
                _text(
                    partner['phone'] ??
                        _map(partner['primaryContact'])['phone'],
                    'No phone'),
                _text(partner['state'] ?? _map(partner['territory'])['state'],
                    'No territory'),
              ].join('  •  '))),
          trailing: _statusChip(_partnerStatus(partner)),
        ),
      );

  Widget _statusChip(String status) {
    final isAlert = status == 'SUSPENDED' || status == 'DISABLED';
    return Container(
        padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 6),
        decoration: BoxDecoration(
            color: isAlert ? const Color(0xFFFFE8E2) : const Color(0xFFE3F3E8),
            borderRadius: BorderRadius.circular(20)),
        child: Text(status,
            style: const TextStyle(fontSize: 10, fontWeight: FontWeight.w800)));
  }

  Future<void> _editor([Map<String, dynamic>? existing]) async {
    final territory = _map(existing?['territory']);
    final existingPermissions = _strings(existing?['permissions']);
    final selectedServices = <String>{
      ..._strings(existing?['services']).map(
        normalizeBusinessPartnerService,
      ),
      if (existingPermissions.contains('SOLAR_ASSIGNMENT')) 'SOLAR',
      if (existingPermissions.contains('PHONE_ASSIGNMENT')) 'PHONE',
    }..removeWhere(
        (service) => !businessPartnerServicePermissions.containsKey(service),
      );
    final fields = <String, TextEditingController>{
      'fullName': TextEditingController(
          text: _text(
              existing?['fullName'] ?? _map(existing?['user'])['fullName'],
              '')),
      if (existing == null) 'password': TextEditingController(),
      'companyName': TextEditingController(
          text: _text(
              existing?['companyName'] ??
                  existing?['businessName'] ??
                  existing?['name'],
              '')),
      'businessName': TextEditingController(
          text: _text(existing?['businessName'] ?? existing?['name'], '')),
      'contactName':
          TextEditingController(text: _text(existing?['contactName'], '')),
      'phone': TextEditingController(text: _text(existing?['phone'], '')),
      'email': TextEditingController(text: _text(existing?['email'], '')),
      'state': TextEditingController(
          text: _text(existing?['state'] ?? territory['state'], '')),
      'lga': TextEditingController(
          text: _text(existing?['lga'] ?? territory['lga'], '')),
      'address': TextEditingController(text: _text(existing?['address'], '')),
      'territory':
          TextEditingController(text: _text(territory['description'], '')),
    };
    final save = await showDialog<bool>(
        context: context,
        builder: (ctx) => StatefulBuilder(
              builder: (ctx, setDialogState) => AlertDialog(
                title: Text(existing == null
                    ? 'Create business partner'
                    : 'Edit business partner'),
                content: SizedBox(
                    width: 500,
                    child: SingleChildScrollView(
                        child: Column(
                            mainAxisSize: MainAxisSize.min,
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                          for (final entry in fields.entries)
                            Padding(
                                padding: const EdgeInsets.only(bottom: 10),
                                child: TextField(
                                  controller: entry.value,
                                  maxLines: entry.key == 'address' ? 2 : 1,
                                  keyboardType: entry.key == 'email'
                                      ? TextInputType.emailAddress
                                      : entry.key == 'phone'
                                          ? TextInputType.phone
                                          : TextInputType.text,
                                  obscureText: entry.key == 'password',
                                  decoration: InputDecoration(
                                      labelText: entry.key
                                          .replaceAllMapped(RegExp(r'([A-Z])'),
                                              (m) => ' ${m.group(1)}')
                                          .trim(),
                                      border: const OutlineInputBorder()),
                                )),
                          const Text('Services',
                              style: TextStyle(fontWeight: FontWeight.w700)),
                          const SizedBox(height: 8),
                          Wrap(spacing: 8, runSpacing: 8, children: [
                            for (final service
                                in businessPartnerServicePermissions.keys)
                              FilterChip(
                                label: Text(service == 'PHONE'
                                    ? 'Phone Financing'
                                    : 'Solar'),
                                selected: selectedServices.contains(service),
                                onSelected: (selected) => setDialogState(() {
                                  selected
                                      ? selectedServices.add(service)
                                      : selectedServices.remove(service);
                                }),
                              ),
                          ]),
                          const SizedBox(height: 6),
                          const Text(
                            'Service labels are stored separately. Access permissions are generated from the approved Business Partner permission catalog.',
                            style: TextStyle(
                                fontSize: 12, color: Color(0xFF64748B)),
                          ),
                        ]))),
                actions: [
                  TextButton(
                      onPressed: () => Navigator.pop(ctx, false),
                      child: const Text('Cancel')),
                  FilledButton(
                      onPressed: () => Navigator.pop(ctx, true),
                      child: Text(existing == null ? 'Create' : 'Save changes'))
                ],
              ),
            ));
    if (save == true) {
      final body = <String, dynamic>{
        for (final entry in fields.entries) entry.key: entry.value.text.trim()
      };
      body['businessName'] = body['businessName'].toString().isEmpty
          ? body['companyName']
          : body['businessName'];
      body['companyName'] = body['companyName'].toString().isEmpty
          ? body['businessName']
          : body['companyName'];
      final access = businessPartnerAccessForServices(selectedServices);
      body['services'] = access['services'];
      body['permissions'] = access['permissions'];
      body['territory'] = {
        'states':
            body['state'].toString().isEmpty ? <String>[] : [body['state']],
        'lgas': body['lga'].toString().isEmpty ? <String>[] : [body['lga']],
        'description': fields['territory']!.text.trim(),
      };
      if ((body['businessName'] as String).isEmpty ||
          (body['fullName'] as String).isEmpty ||
          (existing == null && (body['password'] as String).length < 6)) {
        _notice(
            'Business name, full name, and a password of at least 6 characters are required.',
            error: true);
      } else {
        try {
          existing == null
              ? await _api.create(body)
              : await _api.update(_id(existing), body);
          _notice(existing == null
              ? 'Business partner created.'
              : 'Business partner updated.');
          await _load();
        } on AdminBusinessPartnersException catch (error) {
          _notice(error.message, error: true);
        }
      }
    }
    for (final item in fields.values) {
      item.dispose();
    }
  }

  Future<void> _setStatus(Map<String, dynamic> partner, String status) async {
    final note = TextEditingController();
    final confirm = await showDialog<bool>(
        context: context,
        builder: (ctx) => AlertDialog(
              title: Text(
                  '${status[0]}${status.substring(1).toLowerCase()} partner?'),
              content: TextField(
                  controller: note,
                  maxLines: 2,
                  decoration: const InputDecoration(
                      labelText: 'Reason / operational note',
                      border: OutlineInputBorder())),
              actions: [
                TextButton(
                    onPressed: () => Navigator.pop(ctx, false),
                    child: const Text('Cancel')),
                FilledButton(
                    onPressed: () => Navigator.pop(ctx, true),
                    child: const Text('Confirm'))
              ],
            ));
    if (confirm == true) {
      try {
        await _api.setStatus(_id(partner), status, note: note.text);
        _notice('Partner status changed to $status.');
        await _load();
      } on AdminBusinessPartnersException catch (error) {
        _notice(error.message, error: true);
      }
    }
    note.dispose();
  }

  Future<void> _detail(Map<String, dynamic> summary) async {
    Map<String, dynamic> detail = summary;
    try {
      final response = await _api.detail(_id(summary));
      final data = _map(response['data']);
      final sections = _map(response['sections'] ?? data['sections']);
      detail = {
        ..._map(response['partner'] ?? data['partner'] ?? response),
        ...sections,
        for (final key in const [
          'officers',
          'customers',
          'applications',
          'solar',
          'phone',
          'repayments',
          'commissions',
          'performance',
          'audit',
          'auditTrail',
          'activity'
        ])
          if (response.containsKey(key))
            key: response[key]
          else if (data.containsKey(key))
            key: data[key],
      };
    } on AdminBusinessPartnersException catch (error) {
      if (mounted) {
        _notice(error.message, error: true);
      }
      return;
    }
    if (!mounted) {
      return;
    }
    await Navigator.of(context).push(MaterialPageRoute<void>(
      builder: (_) => _BusinessPartnerDetail(
        partner: detail,
        onEdit: () => _editor(detail),
        onStatus: (status) => _setStatus(detail, status),
      ),
    ));
    if (mounted) {
      _load();
    }
  }
}

class _BusinessPartnerDetail extends StatelessWidget {
  const _BusinessPartnerDetail(
      {required this.partner, required this.onEdit, required this.onStatus});
  final Map<String, dynamic> partner;
  final VoidCallback onEdit;
  final ValueChanged<String> onStatus;
  String text(dynamic v, [String fallback = '—']) {
    final s = '${v ?? ''}'.trim();
    return s.isEmpty || s == 'null' ? fallback : s;
  }

  Map<String, dynamic> map(dynamic v) =>
      v is Map ? Map<String, dynamic>.from(v) : {};
  List<Map<String, dynamic>> list(dynamic v) =>
      v is List ? v.whereType<Map>().map((x) => map(x)).toList() : [];

  List<Map<String, dynamic>> _sectionRows(dynamic section) {
    if (section is List) {
      return list(section);
    }
    if (section is! Map) {
      return [];
    }
    final result = <Map<String, dynamic>>[];
    section.forEach((key, value) {
      for (final row in list(value)) {
        result.add({...row, '_section': key.toString().toUpperCase()});
      }
    });
    return result;
  }

  List<Map<String, dynamic>> _channelRows(String channel, dynamic section) {
    if (section is List) {
      return list(section);
    }
    if (section is! Map) {
      return [];
    }
    final result = <Map<String, dynamic>>[];
    section.forEach((key, value) {
      if (key.toString().toLowerCase().contains(channel)) {
        for (final row in list(value)) {
          result.add({...row, '_section': key.toString().toUpperCase()});
        }
      }
    });
    return result;
  }

  @override
  Widget build(BuildContext context) {
    final status = text(partner['status'], 'ACTIVE').toUpperCase();
    return DefaultTabController(
        length: 10,
        child: Scaffold(
          backgroundColor: _bpPaper,
          appBar: AppBar(
            backgroundColor: _bpPaper,
            foregroundColor: _bpInk,
            elevation: 0,
            title: Text(text(partner['businessName'] ?? partner['name']),
                style: const TextStyle(fontWeight: FontWeight.w800)),
            actions: [
              IconButton(
                  onPressed: onEdit,
                  icon: const Icon(Icons.edit_outlined),
                  tooltip: 'Edit'),
              PopupMenuButton<String>(
                  onSelected: onStatus,
                  itemBuilder: (_) => [
                        if (status != 'ACTIVE')
                          const PopupMenuItem(
                              value: 'ACTIVE', child: Text('Activate')),
                        if (status != 'SUSPENDED')
                          const PopupMenuItem(
                              value: 'SUSPENDED', child: Text('Suspend')),
                        if (status != 'DISABLED')
                          const PopupMenuItem(
                              value: 'DISABLED', child: Text('Disable')),
                      ])
            ],
            bottom: const TabBar(
                isScrollable: true,
                labelColor: _bpGreen,
                unselectedLabelColor: Colors.blueGrey,
                tabs: [
                  Tab(text: 'Profile'),
                  Tab(text: 'Territory'),
                  Tab(text: 'Officers'),
                  Tab(text: 'Customers'),
                  Tab(text: 'Applications'),
                  Tab(text: 'Solar'),
                  Tab(text: 'Phone'),
                  Tab(text: 'Repayments'),
                  Tab(text: 'Commission'),
                  Tab(text: 'Performance & audit'),
                ]),
          ),
          body: TabBarView(children: [
            _fields({
              'Business name': partner['businessName'] ?? partner['name'],
              'Contact': partner['contactName'],
              'Phone': partner['phone'] ?? map(partner['user'])['phone'],
              'Email': partner['email'] ?? map(partner['user'])['email'],
              'Address': partner['address'],
              'Status': status
            }),
            _fields(map(partner['territory']).isEmpty
                ? {'State': partner['state'], 'LGA': partner['lga']}
                : map(partner['territory'])),
            _rows(_sectionRows(partner['officers']),
                'No officers assigned to this business partner.'),
            _rows(_sectionRows(partner['customers']), 'No linked customers.'),
            _rows(_sectionRows(partner['applications']),
                'No applications recorded.'),
            _rows(
                _channelRows(
                    'solar', partner['solar'] ?? partner['applications']),
                'No Solar activity recorded.'),
            _rows(
                _channelRows(
                    'phone', partner['phone'] ?? partner['applications']),
                'No Phone Financing activity recorded.'),
            _rows(
                _sectionRows(partner['repayments']), 'No repayments recorded.'),
            _rows(_sectionRows(partner['commissions']),
                'No commission entries recorded.'),
            _performanceAudit(),
          ]),
        ));
  }

  Widget _fields(Map<String, dynamic> values) =>
      ListView(padding: const EdgeInsets.all(20), children: [
        for (final e in values.entries)
          Card(
              child:
                  ListTile(title: Text(e.key), subtitle: Text(text(e.value)))),
      ]);
  Widget _rows(List<Map<String, dynamic>> rows, String empty) => rows.isEmpty
      ? _BpEmpty(empty)
      : ListView(padding: const EdgeInsets.all(16), children: [
          for (final row in rows)
            Card(
                child: ListTile(
                    title: Text(text(
                        row['name'] ??
                            row['reference'] ??
                            row['fullName'] ??
                            map(row['user'])['fullName'] ??
                            row['title'],
                        'Record')),
                    subtitle: Text(_safeSummary(row)))),
        ]);
  String _safeSummary(Map<String, dynamic> row) {
    const safeKeys = {
      'status',
      'state',
      'lga',
      'createdAt',
      'updatedAt',
      'date',
      'amount',
      'amountPaid',
      'outstandingBalance',
      'commission',
      'count',
      'product',
      'package',
      'assignedAt',
      'completedAt',
      'type',
      '_section'
    };
    return row.entries
        .where((entry) =>
            safeKeys.contains(entry.key) &&
            entry.value is! Map &&
            entry.value is! List)
        .take(3)
        .map((entry) => '${entry.key}: ${text(entry.value)}')
        .join(' • ');
  }

  Widget _performanceAudit() {
    final performance = map(partner['performance']);
    final audit =
        list(partner['audit'] ?? partner['auditTrail'] ?? partner['activity']);
    return ListView(padding: const EdgeInsets.all(20), children: [
      const Text('Performance',
          style: TextStyle(
              fontSize: 18, fontWeight: FontWeight.w800, color: _bpInk)),
      ...performance.entries.map((e) => Card(
          child: ListTile(title: Text(e.key), trailing: Text(text(e.value))))),
      const SizedBox(height: 16),
      const Text('Audit trail',
          style: TextStyle(
              fontSize: 18, fontWeight: FontWeight.w800, color: _bpInk)),
      if (audit.isEmpty) const _BpEmpty('No audit events available.'),
      ...audit.map((row) => Card(
          child: ListTile(
              title: Text(
                  text(row['action'] ?? row['event'], 'Operational update')),
              subtitle:
                  Text(text(row['createdAt'] ?? row['date'] ?? row['note']))))),
    ]);
  }
}

class _BpEmpty extends StatelessWidget {
  const _BpEmpty(this.message);
  final String message;
  @override
  Widget build(BuildContext context) => Center(
      child: Padding(
          padding: const EdgeInsets.all(40),
          child: Text(message,
              textAlign: TextAlign.center,
              style: const TextStyle(color: Colors.blueGrey))));
}

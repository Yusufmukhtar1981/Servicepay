import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

const Color _solarGreen = Color(0xFF08783E);
const Color _solarInk = Color(0xFF18322A);

class AdminSolarScreen extends StatefulWidget {
  const AdminSolarScreen({super.key});

  @override
  State<AdminSolarScreen> createState() => _AdminSolarScreenState();
}

class _AdminSolarScreenState extends State<AdminSolarScreen> {
  final _SolarAdminApi _api = _SolarAdminApi();
  final _SolarAdminApi _officerApi = _SolarAdminApi(
    baseUrl:
        'https://api.servicepay.ng/api/solar/officer/admin',
  );
  bool _loading = true;
  String _error = '';
  int _tab = 0;
  Map<String, dynamic> _dashboard = <String, dynamic>{};
  Map<String, dynamic> _settings = <String, dynamic>{};
  List<Map<String, dynamic>> _packages = <Map<String, dynamic>>[];
  List<Map<String, dynamic>> _applications = <Map<String, dynamic>>[];
  List<Map<String, dynamic>> _report = <Map<String, dynamic>>[];
  List<Map<String, dynamic>> _finances = <Map<String, dynamic>>[];
  List<Map<String, dynamic>> _repayments = <Map<String, dynamic>>[];
  List<Map<String, dynamic>> _overdue = <Map<String, dynamic>>[];
  Map<String, dynamic> _officerDashboard =
      <String, dynamic>{};
  List<Map<String, dynamic>> _officers =
      <Map<String, dynamic>>[];
  List<Map<String, dynamic>> _officerWithdrawals =
      <Map<String, dynamic>>[];

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = '';
    });
    try {
      final List<Map<String, dynamic>> results =
          await Future.wait(<Future<Map<String, dynamic>>>[
        _api.get('/dashboard'),
        _api.get('/packages', query: const <String, String>{
          'includeInactive': 'true',
        }),
        _api.get('/applications',
            query: const <String, String>{'limit': '100'}),
        _api.get('/reports'),
        _api.get('/settings'),
        _api.get('/finance'),
        _api.get('/repayments'),
        _api.get('/overdue'),
        _officerApi.get('/dashboard'),
        _officerApi.get('/officers'),
        _officerApi.get('/withdrawals'),
      ]);
      if (!mounted) return;
      setState(() {
        _dashboard = _map(results[0]['dashboard']);
        _packages = _list(results[1]['packages']);
        _applications = _list(results[2]['applications']);
        _report = _list(results[3]['report']);
        _settings = _map(results[4]['settings']);
        _finances = _list(results[5]['finance']);
        _repayments = _list(results[6]['payments']);
        _overdue = _list(results[7]['finance']);
        _officerDashboard =
            _map(results[8]['dashboard']);
        _officers = _list(results[9]['officers']);
        _officerWithdrawals =
            _list(results[10]['withdrawals']);
        _loading = false;
      });
    } on _SolarAdminException catch (error) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = error.message;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = 'Unable to load ServicePay Solar administration.';
      });
    }
  }

  Map<String, dynamic> _map(dynamic value) =>
      value is Map ? Map<String, dynamic>.from(value) : <String, dynamic>{};

  List<Map<String, dynamic>> _list(dynamic value) => value is List
      ? value.whereType<Map>().map((Map item) => _map(item)).toList()
      : <Map<String, dynamic>>[];

  String _id(Map<String, dynamic> item) =>
      '${item['_id'] ?? item['id'] ?? ''}'.trim();

  String _text(dynamic value, [String fallback = '—']) {
    final String text = value?.toString().trim() ?? '';
    return text.isEmpty ? fallback : text;
  }

  String _money(dynamic value) {
    final num amount = value is num ? value : num.tryParse('$value') ?? 0;
    return '₦${amount.toStringAsFixed(2)}';
  }

  num? _numberValue(String value, {bool integer = false}) {
    final String normalized = value.trim().replaceAll(',', '');
    if (normalized.isEmpty) return null;
    final num? parsed = num.tryParse(normalized);
    if (parsed == null || (integer && parsed % 1 != 0)) return null;
    return integer ? parsed.toInt() : parsed;
  }

  void _notice(String message, {bool error = false}) {
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(
        SnackBar(
          content: Text(message),
          behavior: SnackBarBehavior.floating,
          backgroundColor: error ? const Color(0xFFB42318) : _solarGreen,
        ),
      );
  }

  Future<void> _createOrEditPackage([Map<String, dynamic>? existing]) async {
    final Map<String, dynamic> specifications =
        _map(existing?['specifications']);
    final Map<String, dynamic> terms = _map(existing?['terms']);
    final Map<String, TextEditingController> fields =
        <String, TextEditingController>{
      'name': TextEditingController(text: _text(existing?['name'], '')),
      'description':
          TextEditingController(text: _text(existing?['description'], '')),
      'capacityKw':
          TextEditingController(text: _text(existing?['capacityKw'], '1')),
      'cashPrice':
          TextEditingController(text: _text(existing?['cashPrice'], '')),
      'financedPrice':
          TextEditingController(text: _text(existing?['financedPrice'], '')),
      'depositPercent':
          TextEditingController(text: _text(existing?['depositPercent'], '20')),
      'installmentMonths': TextEditingController(
          text: _text(existing?['installmentMonths'], '6')),
      'stockQuantity':
          TextEditingController(text: _text(existing?['stockQuantity'], '0')),
      'batteryCapacity': TextEditingController(
          text: _text(specifications['batteryCapacity'], '')),
      'inverterCapacity': TextEditingController(
          text: _text(specifications['inverterCapacity'], '')),
      'includedItems':
          TextEditingController(text: _text(terms['includedItems'], '')),
      'gracePeriod':
          TextEditingController(text: _text(terms['gracePeriodDays'], '0')),
    };
    String frequency =
        _text(existing?['repaymentFrequency'], 'MONTHLY').toUpperCase();
    bool active = existing?['active'] != false;
    final bool? save = await showDialog<bool>(
      context: context,
      builder: (BuildContext dialogContext) => StatefulBuilder(
        builder: (BuildContext context, StateSetter setDialogState) =>
            AlertDialog(
          title: Text(existing == null ? 'New Solar package' : 'Edit package'),
          content: SizedBox(
            width: 520,
            child: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: <Widget>[
                  _input(fields['name']!, 'Package name'),
                  _input(fields['description']!, 'Description', lines: 3),
                  _input(fields['capacityKw']!, 'System capacity (kW)',
                      numeric: true),
                  _input(fields['cashPrice']!, 'Cash price (₦)', numeric: true),
                  _input(fields['financedPrice']!, 'Financed price (₦)',
                      numeric: true),
                  _input(fields['depositPercent']!, 'Deposit percentage',
                      numeric: true),
                  _input(fields['installmentMonths']!,
                      'Repayment duration (months)',
                      numeric: true),
                  _input(fields['stockQuantity']!, 'Stock quantity',
                      numeric: true),
                  _input(fields['batteryCapacity']!, 'Battery capacity',
                      numeric: false),
                  _input(fields['inverterCapacity']!, 'Inverter capacity',
                      numeric: false),
                  _input(fields['includedItems']!, 'Included items', lines: 2),
                  _input(fields['gracePeriod']!, 'Package grace period (days)',
                      numeric: true),
                  DropdownButtonFormField<String>(
                    value: <String>['WEEKLY', 'BIWEEKLY', 'MONTHLY']
                            .contains(frequency)
                        ? frequency
                        : 'MONTHLY',
                    decoration: const InputDecoration(
                      labelText: 'Repayment frequency',
                    ),
                    items: const <String>['WEEKLY', 'BIWEEKLY', 'MONTHLY']
                        .map((String item) => DropdownMenuItem<String>(
                              value: item,
                              child: Text(item),
                            ))
                        .toList(),
                    onChanged: (String? value) =>
                        setDialogState(() => frequency = value ?? 'MONTHLY'),
                  ),
                  SwitchListTile.adaptive(
                    contentPadding: EdgeInsets.zero,
                    title: const Text('Package is active'),
                    value: active,
                    onChanged: (bool value) =>
                        setDialogState(() => active = value),
                  ),
                ],
              ),
            ),
          ),
          actions: <Widget>[
            TextButton(
              onPressed: () => Navigator.pop(dialogContext, false),
              child: const Text('Cancel'),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(dialogContext, true),
              child: Text(existing == null ? 'Create package' : 'Save changes'),
            ),
          ],
        ),
      ),
    );
    if (save != true) {
      return;
    }
    try {
      final Map<String, dynamic> body = <String, dynamic>{
        'name': fields['name']!.text.trim(),
        'description': fields['description']!.text.trim(),
        'capacityKw': _numberValue(fields['capacityKw']!.text),
        'cashPrice': _numberValue(fields['cashPrice']!.text),
        'financedPrice': _numberValue(fields['financedPrice']!.text),
        'depositPercent': _numberValue(fields['depositPercent']!.text),
        'installmentMonths':
            _numberValue(fields['installmentMonths']!.text, integer: true),
        'stockQuantity':
            _numberValue(fields['stockQuantity']!.text, integer: true),
        'stock': _numberValue(fields['stockQuantity']!.text, integer: true),
        'repaymentFrequency': frequency,
        'specifications': <String, dynamic>{
          'batteryCapacity': fields['batteryCapacity']!.text.trim(),
          'inverterCapacity': fields['inverterCapacity']!.text.trim(),
        },
        'terms': <String, dynamic>{
          'includedItems': fields['includedItems']!.text.trim(),
          'gracePeriodDays':
              _numberValue(fields['gracePeriod']!.text, integer: true),
        },
        'active': active,
      };
      if (existing == null) {
        await _api.post('/packages', body: body);
      } else {
        await _api.patch('/packages/${_id(existing)}', body: body);
      }
      _notice(existing == null
          ? 'Solar package created.'
          : 'Solar package updated.');
      await _load();
    } on _SolarAdminException catch (error) {
      _notice(error.message, error: true);
    }
  }

  Widget _input(
    TextEditingController controller,
    String label, {
    bool numeric = false,
    int lines = 1,
  }) =>
      Padding(
        padding: const EdgeInsets.only(bottom: 12),
        child: TextField(
          controller: controller,
          maxLines: lines,
          keyboardType: numeric
              ? const TextInputType.numberWithOptions(decimal: true)
              : TextInputType.text,
          decoration: InputDecoration(
            labelText: label,
            border: const OutlineInputBorder(),
          ),
        ),
      );

  Future<void> _transition(
    Map<String, dynamic> application,
    String status,
  ) async {
    final TextEditingController note = TextEditingController();
    final bool? confirmed = await showDialog<bool>(
      context: context,
      builder: (BuildContext context) => AlertDialog(
        title: Text('Move to ${status.replaceAll('_', ' ')}?'),
        content: TextField(
          controller: note,
          maxLines: 3,
          decoration: const InputDecoration(
            labelText: 'Admin note',
            border: OutlineInputBorder(),
          ),
        ),
        actions: <Widget>[
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Confirm'),
          ),
        ],
      ),
    );
    if (confirmed != true) {
      note.dispose();
      return;
    }
    try {
      await _api.patch('/applications/${_id(application)}/status', body: {
        'status': status,
        'note': note.text.trim(),
      });
      _notice('Application status updated.');
      await _load();
    } on _SolarAdminException catch (error) {
      _notice(error.message, error: true);
    } finally {
      note.dispose();
    }
  }

  Future<void> _approve(Map<String, dynamic> application) async {
    final TextEditingController price = TextEditingController(
      text: _text(application['financedPrice'] ?? application['cashPrice'], ''),
    );
    final TextEditingController note = TextEditingController();
    final bool? confirmed = await showDialog<bool>(
      context: context,
      builder: (BuildContext context) => AlertDialog(
        title: const Text('Approve Solar application'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            _input(price, 'Approved financed price (₦)', numeric: true),
            _input(note, 'Approval note', lines: 2),
          ],
        ),
        actions: <Widget>[
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Approve'),
          ),
        ],
      ),
    );
    if (confirmed != true) {
      return;
    }
    try {
      await _api.patch('/applications/${_id(application)}/approve', body: {
        'approvedPrice': price.text.trim(),
        'note': note.text.trim(),
      });
      _notice('Application approved. It now awaits the customer deposit.');
      await _load();
    } on _SolarAdminException catch (error) {
      _notice(error.message, error: true);
    }
  }

  Future<void> _recordInstallation(Map<String, dynamic> application) async {
    final TextEditingController date = TextEditingController(
      text: DateTime.now().toIso8601String().substring(0, 10),
    );
    final TextEditingController installer = TextEditingController();
    final TextEditingController address = TextEditingController();
    final TextEditingController notes = TextEditingController();
    final bool? confirmed = await showDialog<bool>(
      context: context,
      builder: (BuildContext context) => AlertDialog(
        title: const Text('Confirm installation & activate finance'),
        content: SizedBox(
          width: 460,
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                _input(date, 'Installation date (YYYY-MM-DD)'),
                _input(installer, 'Installer / staff member'),
                _input(address, 'Installation address', lines: 2),
                _input(notes, 'Handover notes', lines: 3),
              ],
            ),
          ),
        ),
        actions: <Widget>[
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Confirm installation'),
          ),
        ],
      ),
    );
    if (confirmed != true) {
      for (final TextEditingController item in <TextEditingController>[
        date,
        installer,
        address,
        notes,
      ]) {
        item.dispose();
      }
      return;
    }
    try {
      await _api.post('/applications/${_id(application)}/install', body: {
        'installedAt': date.text.trim(),
        'installerName': installer.text.trim(),
        'installationAddress': address.text.trim(),
        'installationNotes': notes.text.trim(),
        'customerConfirmed': true,
        'handover': <String, dynamic>{
          'recipientName': 'Customer',
          'acceptedAt': date.text.trim(),
          'notes': notes.text.trim(),
        },
      });
      _notice('Installation recorded and Solar finance activated.');
      await _load();
    } on _SolarAdminException catch (error) {
      _notice(error.message, error: true);
    } finally {
      for (final TextEditingController item in <TextEditingController>[
        date,
        installer,
        address,
        notes,
      ]) {
        item.dispose();
      }
    }
  }

  Future<void> _recovery(String financeId) async {
    final TextEditingController reason = TextEditingController();
    final TextEditingController notes = TextEditingController();
    final bool? confirmed = await showDialog<bool>(
      context: context,
      builder: (BuildContext context) => AlertDialog(
        title: const Text('Record manual recovery case'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            _input(reason, 'Recovery reason'),
            _input(notes, 'Operational notes and contact attempts', lines: 3),
          ],
        ),
        actions: <Widget>[
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            style: FilledButton.styleFrom(
                backgroundColor: const Color(0xFFB42318)),
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Create case'),
          ),
        ],
      ),
    );
    if (confirmed != true) {
      reason.dispose();
      notes.dispose();
      return;
    }
    try {
      await _api.post('/finance/$financeId/recovery', body: {
        'reason': reason.text.trim(),
        'notes': notes.text.trim(),
      });
      _notice('Manual recovery case recorded.');
      await _load();
    } on _SolarAdminException catch (error) {
      _notice(error.message, error: true);
    } finally {
      reason.dispose();
      notes.dispose();
    }
  }

  Future<void> _saveSettings() async {
    final TextEditingController grace = TextEditingController(
      text: _text(_settings['overdueGraceDays'], '0'),
    );
    bool applications = _settings['applicationEnabled'] != false;
    final bool? save = await showDialog<bool>(
      context: context,
      builder: (BuildContext context) => StatefulBuilder(
        builder: (BuildContext context, StateSetter setDialogState) =>
            AlertDialog(
          title: const Text('Solar settings'),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              _input(grace, 'Overdue grace period (days)', numeric: true),
              SwitchListTile.adaptive(
                title: const Text('Allow new applications'),
                value: applications,
                onChanged: (bool value) =>
                    setDialogState(() => applications = value),
              ),
            ],
          ),
          actions: <Widget>[
            TextButton(
              onPressed: () => Navigator.pop(context, false),
              child: const Text('Cancel'),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(context, true),
              child: const Text('Save settings'),
            ),
          ],
        ),
      ),
    );
    if (save != true) {
      grace.dispose();
      return;
    }
    try {
      await _api.put('/settings', body: {
        'overdueGraceDays': grace.text.trim(),
        'applicationEnabled': applications,
      });
      _notice('Solar settings saved.');
      await _load();
    } on _SolarAdminException catch (error) {
      _notice(error.message, error: true);
    } finally {
      grace.dispose();
    }
  }

  Future<void> _createOfficer() async {
    final Map<String, TextEditingController> fields =
        <String, TextEditingController>{
      'fullName': TextEditingController(),
      'phone': TextEditingController(),
      'email': TextEditingController(),
      'password': TextEditingController(),
      'state': TextEditingController(),
      'lga': TextEditingController(),
      'address': TextEditingController(),
    };
    final bool? save = await showDialog<bool>(
      context: context,
      builder: (BuildContext dialogContext) => AlertDialog(
        title: const Text('Create Solar Officer'),
        content: SizedBox(
          width: 480,
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                for (final MapEntry<String,
                        TextEditingController> entry
                    in fields.entries)
                  _input(
                    entry.value,
                    entry.key
                        .replaceAllMapped(
                          RegExp(r'([A-Z])'),
                          (Match match) =>
                              ' ${match.group(1)}',
                        )
                        .toUpperCase(),
                    lines: entry.key == 'address' ? 2 : 1,
                  ),
              ],
            ),
          ),
        ),
        actions: <Widget>[
          TextButton(
            onPressed: () =>
                Navigator.pop(dialogContext, false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () =>
                Navigator.pop(dialogContext, true),
            child: const Text('Create officer'),
          ),
        ],
      ),
    );
    if (save != true) {
      for (final TextEditingController item in fields.values) {
        item.dispose();
      }
      return;
    }
    try {
      await _officerApi.post('/officers',
          body: <String, dynamic>{
            for (final MapEntry<String,
                    TextEditingController> entry
                in fields.entries)
              entry.key: entry.value.text.trim(),
          });
      _notice('Solar Officer created.');
      await _load();
    } on _SolarAdminException catch (error) {
      _notice(error.message, error: true);
    } finally {
      for (final TextEditingController item in fields.values) {
        item.dispose();
      }
    }
  }

  Future<void> _setOfficerStatus(
    Map<String, dynamic> officer,
    String status,
  ) async {
    try {
      await _officerApi.patch(
        '/officers/${_id(officer)}/status',
        body: <String, dynamic>{'status': status},
      );
      _notice('Solar Officer status changed to $status.');
      await _load();
    } on _SolarAdminException catch (error) {
      _notice(error.message, error: true);
    }
  }

  Future<void> _viewOfficerPerformance(
      Map<String, dynamic> officer) async {
    try {
      final Map<String, dynamic> response =
          await _officerApi.get(
              '/officers/${_id(officer)}/performance');
      if (!mounted) return;
      final Map<String, dynamic> performance =
          _map(response['performance']);
      await showDialog<void>(
        context: context,
        builder: (BuildContext dialogContext) =>
            AlertDialog(
          title: Text(
            '${_text(_map(officer['user'])['fullName'], 'Solar Officer')} performance',
          ),
          content: SizedBox(
            width: 560,
            child: SingleChildScrollView(
              child: Wrap(
                spacing: 10,
                runSpacing: 10,
                children: performance.entries
                    .map(
                      (MapEntry<String, dynamic> entry) =>
                          _metricCard(
                        _Metric(
                          entry.key
                              .replaceAllMapped(
                                RegExp(r'([A-Z])'),
                                (Match match) =>
                                    ' ${match.group(1)}',
                              )
                              .trim(),
                          entry.key
                                  .toLowerCase()
                                  .contains('salesvalue')
                              ? _money(entry.value)
                              : _text(entry.value, '0'),
                          Icons.analytics_outlined,
                        ),
                      ),
                    )
                    .toList(),
              ),
            ),
          ),
          actions: <Widget>[
            TextButton(
              onPressed: () =>
                  Navigator.pop(dialogContext),
              child: const Text('Close'),
            ),
          ],
        ),
      );
    } on _SolarAdminException catch (error) {
      _notice(error.message, error: true);
    }
  }

  Future<void> _assignOfficer(
      Map<String, dynamic> application) async {
    final List<Map<String, dynamic>> active = _officers
        .where((Map<String, dynamic> officer) =>
            _text(officer['status']).toUpperCase() ==
            'ACTIVE')
        .toList();
    if (active.isEmpty) {
      _notice('Create or activate a Solar Officer first.',
          error: true);
      return;
    }
    String selected = _id(active.first);
    final bool? save = await showDialog<bool>(
      context: context,
      builder: (BuildContext dialogContext) =>
          StatefulBuilder(
        builder: (BuildContext context,
                StateSetter setDialogState) =>
            AlertDialog(
          title: const Text('Assign Solar Officer'),
          content: DropdownButtonFormField<String>(
            value: selected,
            decoration: const InputDecoration(
              labelText: 'Solar Officer',
              border: OutlineInputBorder(),
            ),
            items: active
                .map((Map<String, dynamic> officer) {
              final Map<String, dynamic> user =
                  _map(officer['user']);
              return DropdownMenuItem<String>(
                value: _id(officer),
                child: Text(
                    '${_text(user['fullName'])} • ${_text(officer['officerId'])}'),
              );
            }).toList(),
            onChanged: (String? value) =>
                setDialogState(
                    () => selected = value ?? selected),
          ),
          actions: <Widget>[
            TextButton(
              onPressed: () =>
                  Navigator.pop(dialogContext, false),
              child: const Text('Cancel'),
            ),
            FilledButton(
              onPressed: () =>
                  Navigator.pop(dialogContext, true),
              child: const Text('Assign'),
            ),
          ],
        ),
      ),
    );
    if (save != true) return;
    try {
      await _officerApi.post(
        '/applications/${_id(application)}/assign',
        body: <String, dynamic>{'officerId': selected},
      );
      _notice('Solar application assigned.');
      await _load();
    } on _SolarAdminException catch (error) {
      _notice(error.message, error: true);
    }
  }

  Future<void> _reviewOfficerWithdrawal(
    Map<String, dynamic> withdrawal,
    String action,
  ) async {
    final TextEditingController note =
        TextEditingController();
    final bool? confirmed = await showDialog<bool>(
      context: context,
      builder: (BuildContext dialogContext) => AlertDialog(
        title: Text(
            '${action.toUpperCase()} commission withdrawal?'),
        content: TextField(
          controller: note,
          maxLines: 3,
          decoration: InputDecoration(
            labelText: action == 'reject'
                ? 'Rejection reason'
                : 'Admin note',
            border: const OutlineInputBorder(),
          ),
        ),
        actions: <Widget>[
          TextButton(
            onPressed: () =>
                Navigator.pop(dialogContext, false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () =>
                Navigator.pop(dialogContext, true),
            child: const Text('Confirm'),
          ),
        ],
      ),
    );
    if (confirmed != true) {
      note.dispose();
      return;
    }
    try {
      await _officerApi.patch(
        '/withdrawals/${_id(withdrawal)}/$action',
        body: <String, dynamic>{
          if (action == 'reject')
            'reason': note.text.trim()
          else
            'note': note.text.trim(),
        },
      );
      _notice('Withdrawal updated.');
      await _load();
    } on _SolarAdminException catch (error) {
      _notice(error.message, error: true);
    } finally {
      note.dispose();
    }
  }

  @override
  Widget build(BuildContext context) {
    final List<Widget> views = <Widget>[
      _dashboardView(),
      _packagesView(),
      _applicationsView(),
      _portfolioView(),
      _officersView(),
      _settingsView(),
    ];
    return Scaffold(
      backgroundColor: const Color(0xFFF5F8F6),
      appBar: AppBar(
        title: const Text('ServicePay Solar'),
        backgroundColor: _solarInk,
        foregroundColor: Colors.white,
        actions: <Widget>[
          IconButton(
            onPressed: _loading ? null : _load,
            icon: const Icon(Icons.refresh),
            tooltip: 'Refresh',
          ),
        ],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator(color: _solarGreen))
          : _error.isNotEmpty
              ? _errorView()
              : views[_tab],
      bottomNavigationBar: NavigationBar(
        selectedIndex: _tab,
        indicatorColor: const Color(0xFFDDF4E6),
        onDestinationSelected: (int value) => setState(() => _tab = value),
        destinations: const <NavigationDestination>[
          NavigationDestination(
              icon: Icon(Icons.dashboard_outlined),
              selectedIcon: Icon(Icons.dashboard),
              label: 'Overview'),
          NavigationDestination(
              icon: Icon(Icons.solar_power_outlined),
              selectedIcon: Icon(Icons.solar_power),
              label: 'Packages'),
          NavigationDestination(
              icon: Icon(Icons.assignment_outlined),
              selectedIcon: Icon(Icons.assignment),
              label: 'Applications'),
          NavigationDestination(
              icon: Icon(Icons.account_balance_outlined),
              selectedIcon: Icon(Icons.account_balance),
              label: 'Portfolio'),
          NavigationDestination(
              icon: Icon(Icons.badge_outlined),
              selectedIcon: Icon(Icons.badge),
              label: 'Officers'),
          NavigationDestination(
              icon: Icon(Icons.tune_outlined),
              selectedIcon: Icon(Icons.tune),
              label: 'Settings'),
        ],
      ),
    );
  }

  Widget _errorView() => Center(
        child: Padding(
          padding: const EdgeInsets.all(28),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              const Icon(Icons.error_outline,
                  color: Color(0xFFB42318), size: 42),
              const SizedBox(height: 12),
              Text(_error, textAlign: TextAlign.center),
              const SizedBox(height: 12),
              FilledButton(onPressed: _load, child: const Text('Try again')),
            ],
          ),
        ),
      );

  Widget _dashboardView() => RefreshIndicator(
        color: _solarGreen,
        onRefresh: _load,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: <Widget>[
            const Text('Solar control centre',
                style: TextStyle(
                    fontSize: 26,
                    fontWeight: FontWeight.w900,
                    color: _solarInk)),
            const SizedBox(height: 5),
            const Text(
              'Manage customer financing, inventory and recovery operations.',
              style: TextStyle(color: Color(0xFF597066)),
            ),
            const SizedBox(height: 18),
            LayoutBuilder(
              builder: (BuildContext context, BoxConstraints constraints) {
                final int columns = constraints.maxWidth > 850
                    ? 4
                    : constraints.maxWidth > 520
                        ? 2
                        : 1;
                final List<_Metric> metrics = <_Metric>[
                  _Metric(
                      'Applications', _dashboard['total'], Icons.assignment),
                  _Metric('Pending review', _dashboard['submitted'],
                      Icons.pending_actions),
                  _Metric('Active finance', _dashboard['active'],
                      Icons.account_balance),
                  _Metric('Overdue accounts', _dashboard['overdue'],
                      Icons.warning_amber),
                  _Metric('Completed', _dashboard['completed'], Icons.verified),
                  _Metric('Available stock', _dashboard['availableStock'],
                      Icons.inventory_2),
                  _Metric('Deposits collected',
                      _money(_dashboard['depositsCollected']), Icons.payments),
                  _Metric('Outstanding', _money(_dashboard['outstanding']),
                      Icons.receipt_long),
                ];
                final double width =
                    (constraints.maxWidth - (columns - 1) * 12) / columns;
                return Wrap(
                  spacing: 12,
                  runSpacing: 12,
                  children: metrics
                      .map((_Metric metric) => SizedBox(
                            width: width,
                            child: _metricCard(metric),
                          ))
                      .toList(),
                );
              },
            ),
            const SizedBox(height: 24),
            _sectionTitle('Operational queues'),
            const SizedBox(height: 10),
            _queueCard(
              Icons.assignment_late_outlined,
              '${_dashboard['submitted'] ?? 0} applications await review',
              'Open Applications to review, request information, approve or reject.',
              () => setState(() => _tab = 2),
            ),
            _queueCard(
              Icons.warning_amber_rounded,
              '${_dashboard['overdue'] ?? 0} finance accounts are overdue',
              'Recovery remains a manual, documented operational decision.',
              () => setState(() => _tab = 3),
            ),
          ],
        ),
      );

  Widget _metricCard(_Metric metric) => Container(
        padding: const EdgeInsets.all(15),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(18),
          border: Border.all(color: const Color(0xFFDDEAE1)),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Icon(metric.icon, color: _solarGreen),
            const SizedBox(height: 12),
            Text('${metric.value ?? 0}',
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style:
                    const TextStyle(fontSize: 20, fontWeight: FontWeight.w900)),
            const SizedBox(height: 3),
            Text(metric.label,
                style: const TextStyle(color: Color(0xFF597066), fontSize: 12)),
          ],
        ),
      );

  Widget _queueCard(
    IconData icon,
    String title,
    String description,
    VoidCallback onTap,
  ) =>
      Card(
        elevation: 0,
        color: Colors.white,
        child: ListTile(
          onTap: onTap,
          leading: CircleAvatar(
            backgroundColor: const Color(0xFFEAF7F0),
            child: Icon(icon, color: _solarGreen),
          ),
          title:
              Text(title, style: const TextStyle(fontWeight: FontWeight.w800)),
          subtitle: Text(description),
          trailing: const Icon(Icons.chevron_right),
        ),
      );

  Widget _packagesView() => RefreshIndicator(
        color: _solarGreen,
        onRefresh: _load,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: <Widget>[
            Row(
              children: <Widget>[
                Expanded(child: _sectionTitle('Solar packages')),
                FilledButton.icon(
                  onPressed: () => _createOrEditPackage(),
                  icon: const Icon(Icons.add),
                  label: const Text('New package'),
                ),
              ],
            ),
            const SizedBox(height: 6),
            const Text(
                'Package edits never rewrite approved customer contracts.',
                style: TextStyle(color: Color(0xFF597066))),
            const SizedBox(height: 14),
            if (_packages.isEmpty)
              const _EmptyPanel(
                  icon: Icons.inventory_2_outlined,
                  text:
                      'Create the first Solar package to begin accepting applications.')
            else
              ..._packages.map(
                (Map<String, dynamic> item) => Card(
                  elevation: 0,
                  child: ListTile(
                    onTap: () => _createOrEditPackage(item),
                    leading: CircleAvatar(
                      backgroundColor: const Color(0xFFEAF7F0),
                      child: Icon(
                        item['active'] == false
                            ? Icons.solar_power_outlined
                            : Icons.solar_power,
                        color: _solarGreen,
                      ),
                    ),
                    title: Text(_text(item['name']),
                        style: const TextStyle(fontWeight: FontWeight.w800)),
                    subtitle: Text(
                      '${_text(item['capacityKw'], '—')} kW • ${_money(item['financedPrice'] ?? item['cashPrice'])} • '
                      '${_text(item['stockQuantity'], '0')} in stock',
                    ),
                    trailing: Chip(
                      label:
                          Text(item['active'] == false ? 'Inactive' : 'Active'),
                      backgroundColor: item['active'] == false
                          ? const Color(0xFFF2F4F7)
                          : const Color(0xFFDDF4E6),
                    ),
                  ),
                ),
              ),
          ],
        ),
      );

  Widget _applicationsView() => RefreshIndicator(
        color: _solarGreen,
        onRefresh: _load,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: <Widget>[
            _sectionTitle('Solar applications'),
            const SizedBox(height: 5),
            const Text(
                'Review applications before approving any customer finance.',
                style: TextStyle(color: Color(0xFF597066))),
            const SizedBox(height: 14),
            if (_applications.isEmpty)
              const _EmptyPanel(
                  icon: Icons.assignment_outlined,
                  text: 'No Solar applications match this queue.')
            else
              ..._applications.map(_applicationCard),
          ],
        ),
      );

  Widget _applicationCard(Map<String, dynamic> application) {
    final Map<String, dynamic> profile = _map(application['profileSnapshot']);
    final Map<String, dynamic> package = _map(application['packageSnapshot']);
    final Map<String, dynamic> kyc = _map(application['kycSnapshot']);
    final List<Map<String, dynamic>> schedule =
        _list(application['paymentSchedule']);
    final List<Map<String, dynamic>> timeline =
        _list(application['statusHistory']);
    final String status =
        _text(application['status'], 'SUBMITTED').toUpperCase();
    final String financeId = _text(application['financeId'], '');
    final Map<String, dynamic> assignment =
        _map(application['solarOfficerAssignment']);
    final Map<String, dynamic> officer =
        _map(assignment['officer']);
    final Map<String, dynamic> officerUser =
        _map(officer['user']);
    final Map<String, dynamic> verification =
        _map(application['solarOfficerVerification']);
    final int paidInstallments = schedule
        .where((Map<String, dynamic> item) =>
            _text(item['status']).toUpperCase() == 'PAID')
        .length;
    final int overdueInstallments = schedule
        .where((Map<String, dynamic> item) =>
            _text(item['status']).toUpperCase() == 'OVERDUE')
        .length;
    return Card(
      elevation: 0,
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Row(
              children: <Widget>[
                Expanded(
                  child: Text(
                      _text(profile['fullName'], 'Customer application'),
                      style: const TextStyle(
                          fontWeight: FontWeight.w900, fontSize: 16)),
                ),
                _StatusBadge(status: status),
              ],
            ),
            const SizedBox(height: 5),
            Text(
              '${_text(package['name'], 'Solar package')} • ${_text(profile['phone'], 'No phone')}',
              style: const TextStyle(color: Color(0xFF597066)),
            ),
            Text('Address: ${_text(profile['address'], 'Not provided')}'),
            Text(
                'KYC: ${_text(kyc['status'] ?? kyc['verificationStatus'], 'Not recorded')}'),
            Text(
              'Solar Officer: ${_text(officerUser['fullName'], 'UNASSIGNED')}'
              '${officer.isEmpty ? '' : ' • ${_text(officer['officerId'])}'}',
              style: const TextStyle(fontWeight: FontWeight.w700),
            ),
            if (verification.isNotEmpty)
              Container(
                margin: const EdgeInsets.only(top: 8),
                padding: const EdgeInsets.all(10),
                decoration: BoxDecoration(
                  color: const Color(0xFFF0F8F3),
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Text(
                  'Officer recommendation: ${_text(verification['recommendation']).replaceAll('_', ' ')}\n'
                  'Verified: ${_text(verification['verifiedAt'])}\n'
                  'Notes: ${_text(verification['notes'], 'No notes')}',
                ),
              ),
            const SizedBox(height: 8),
            Text(
              'Deposit paid: ${_money(application['depositPaid'])} / ${_money(application['depositRequired'])} • '
              'Outstanding: ${_money(application['outstandingBalance'])}',
              style: const TextStyle(fontWeight: FontWeight.w700),
            ),
            Text(
              'Installments paid: $paidInstallments/${schedule.length} • '
              'Overdue: $overdueInstallments • '
              'Total paid: ${_money(application['amountPaid'])}',
            ),
            if (timeline.isNotEmpty)
              ExpansionTile(
                tilePadding: EdgeInsets.zero,
                title: const Text('Application timeline',
                    style:
                        TextStyle(fontSize: 13, fontWeight: FontWeight.w800)),
                children: timeline
                    .map((Map<String, dynamic> event) => ListTile(
                          dense: true,
                          contentPadding: EdgeInsets.zero,
                          title:
                              Text(_text(event['status']).replaceAll('_', ' ')),
                          subtitle: Text(
                              '${_text(event['changedAt'])} • ${_text(event['note'], 'No note')}'),
                        ))
                    .toList(),
              ),
            const SizedBox(height: 10),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: <Widget>[
                OutlinedButton.icon(
                  onPressed: () => _assignOfficer(application),
                  icon: const Icon(Icons.person_add_alt_1),
                  label: Text(assignment.isEmpty
                      ? 'Assign officer'
                      : 'Reassign officer'),
                ),
                if (status == 'SUBMITTED')
                  OutlinedButton(
                    onPressed: () => _transition(application, 'UNDER_REVIEW'),
                    child: const Text('Review'),
                  ),
                if (<String>['SUBMITTED', 'UNDER_REVIEW'].contains(status))
                  OutlinedButton(
                    onPressed: () =>
                        _transition(application, 'MORE_INFORMATION_REQUIRED'),
                    child: const Text('Request info'),
                  ),
                if (status == 'UNDER_REVIEW')
                  FilledButton(
                    onPressed: () => _approve(application),
                    child: const Text('Approve'),
                  ),
                if (<String>[
                  'SUBMITTED',
                  'UNDER_REVIEW',
                  'MORE_INFORMATION_REQUIRED'
                ].contains(status))
                  OutlinedButton(
                    onPressed: () => _transition(application, 'REJECTED'),
                    child: const Text('Reject'),
                  ),
                if (status == 'DEPOSIT_PAID')
                  FilledButton(
                    onPressed: () => _recordInstallation(application),
                    child: const Text('Record installation'),
                  ),
                if (<String>['FINANCE_ACTIVE', 'OVERDUE', 'DEFAULT_REVIEW']
                        .contains(status) &&
                    financeId.isNotEmpty)
                  OutlinedButton(
                    onPressed: () => _recovery(financeId),
                    child: const Text('Recovery'),
                  ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _portfolioView() => RefreshIndicator(
        color: _solarGreen,
        onRefresh: _load,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: <Widget>[
            _sectionTitle('Portfolio & reports'),
            const SizedBox(height: 5),
            const Text('Finance collection and outstanding balance by status.',
                style: TextStyle(color: Color(0xFF597066))),
            const SizedBox(height: 14),
            if (_report.isEmpty)
              const _EmptyPanel(
                  icon: Icons.analytics_outlined,
                  text:
                      'Solar portfolio data will appear after applications are created.')
            else
              ..._report.map(
                (Map<String, dynamic> item) => Card(
                  elevation: 0,
                  child: ListTile(
                    leading: const CircleAvatar(
                      backgroundColor: Color(0xFFEAF7F0),
                      child: Icon(Icons.account_balance_outlined,
                          color: _solarGreen),
                    ),
                    title: Text(_text(item['_id'], 'Unclassified')),
                    subtitle: Text(
                      '${_text(item['count'], '0')} accounts • '
                      'Outstanding ${_money(item['outstandingBalance'])}',
                    ),
                    trailing: Text(_money(item['totalPayable']),
                        style: const TextStyle(fontWeight: FontWeight.w800)),
                  ),
                ),
              ),
            const SizedBox(height: 22),
            _sectionTitle('Active financing'),
            const SizedBox(height: 8),
            if (_finances
                .where((Map<String, dynamic> item) =>
                    _text(item['status']).toUpperCase() != 'COMPLETED')
                .isEmpty)
              const Text('No active Solar finance accounts.')
            else
              ..._finances
                  .where((Map<String, dynamic> item) =>
                      _text(item['status']).toUpperCase() != 'COMPLETED')
                  .map(_financeTile),
            const SizedBox(height: 22),
            _sectionTitle('Overdue & recovery accounts'),
            const SizedBox(height: 8),
            if (_overdue.isEmpty)
              const Text('No overdue Solar accounts.')
            else
              ..._overdue.map(_financeTile),
            const SizedBox(height: 22),
            _sectionTitle('Recent installment payments'),
            const SizedBox(height: 8),
            if (_repayments.isEmpty)
              const Text('No installment payments have been recorded.')
            else
              ..._repayments.take(12).map(_repaymentTile),
            const SizedBox(height: 22),
            _sectionTitle('Completed accounts'),
            const SizedBox(height: 8),
            if (_finances
                .where((Map<String, dynamic> item) =>
                    _text(item['status']).toUpperCase() == 'COMPLETED')
                .isEmpty)
              const Text('No completed Solar finance accounts.')
            else
              ..._finances
                  .where((Map<String, dynamic> item) =>
                      _text(item['status']).toUpperCase() == 'COMPLETED')
                  .map(_financeTile),
          ],
        ),
      );

  Widget _officersView() => RefreshIndicator(
        color: _solarGreen,
        onRefresh: _load,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: <Widget>[
            Row(
              children: <Widget>[
                const Expanded(
                  child: Text(
                    'Solar Officer control centre',
                    style: TextStyle(
                        fontSize: 21,
                        fontWeight: FontWeight.w900),
                  ),
                ),
                FilledButton.icon(
                  onPressed: _createOfficer,
                  icon: const Icon(Icons.person_add),
                  label: const Text('Create officer'),
                ),
              ],
            ),
            const SizedBox(height: 5),
            const Text(
              'Manage field staff, assignments, commissions and withdrawals.',
              style: TextStyle(color: Color(0xFF597066)),
            ),
            const SizedBox(height: 14),
            Wrap(
              spacing: 10,
              runSpacing: 10,
              children: _officerDashboard.entries
                  .where((MapEntry<String, dynamic> entry) =>
                      entry.value is num)
                  .map((MapEntry<String, dynamic> entry) =>
                      _metricCard(
                        _Metric(
                          entry.key
                              .replaceAllMapped(
                                RegExp(r'([A-Z])'),
                                (Match match) =>
                                    ' ${match.group(1)}',
                              )
                              .trim(),
                          _text(entry.value, '0'),
                          Icons.analytics_outlined,
                        ),
                      ))
                  .toList(),
            ),
            const SizedBox(height: 20),
            _sectionTitle('Solar Officers'),
            const SizedBox(height: 10),
            if (_officers.isEmpty)
              const _EmptyPanel(
                icon: Icons.badge_outlined,
                text: 'No Solar Officers have been created.',
              )
            else
              ..._officers.map(
                (Map<String, dynamic> officer) {
                  final Map<String, dynamic> user =
                      _map(officer['user']);
                  final String status =
                      _text(officer['status'], 'INACTIVE')
                          .toUpperCase();
                  return Card(
                    elevation: 0,
                    child: Padding(
                      padding: const EdgeInsets.all(14),
                      child: Column(
                        crossAxisAlignment:
                            CrossAxisAlignment.start,
                        children: <Widget>[
                          Row(
                            children: <Widget>[
                              const CircleAvatar(
                                backgroundColor:
                                    Color(0xFFDDF4E6),
                                child: Icon(Icons.badge,
                                    color: _solarGreen),
                              ),
                              const SizedBox(width: 10),
                              Expanded(
                                child: Column(
                                  crossAxisAlignment:
                                      CrossAxisAlignment.start,
                                  children: <Widget>[
                                    Text(
                                      _text(user['fullName'],
                                          'Solar Officer'),
                                      style: const TextStyle(
                                          fontWeight:
                                              FontWeight.w900),
                                    ),
                                    Text(
                                      '${_text(officer['officerId'])} • ${_text(user['phone'])}',
                                      style: const TextStyle(
                                          color:
                                              Color(0xFF597066)),
                                    ),
                                  ],
                                ),
                              ),
                              _StatusBadge(status: status),
                            ],
                          ),
                          const SizedBox(height: 10),
                          Text(
                            '${_text(officer['lga'])}, ${_text(officer['state'])} • '
                            '${officer['assignedCustomers'] ?? 0} assigned customers',
                          ),
                          const SizedBox(height: 8),
                          Wrap(
                            spacing: 8,
                            runSpacing: 8,
                            children: <Widget>[
                              OutlinedButton.icon(
                                onPressed: () =>
                                    _viewOfficerPerformance(
                                        officer),
                                icon: const Icon(
                                    Icons.analytics_outlined),
                                label: const Text(
                                    'View performance'),
                              ),
                              if (status != 'ACTIVE')
                                OutlinedButton(
                                  onPressed: () =>
                                      _setOfficerStatus(
                                          officer, 'ACTIVE'),
                                  child: const Text('Activate'),
                                ),
                              if (status == 'ACTIVE')
                                OutlinedButton(
                                  onPressed: () =>
                                      _setOfficerStatus(
                                          officer, 'SUSPENDED'),
                                  child: const Text('Suspend'),
                                ),
                              if (status != 'INACTIVE')
                                OutlinedButton(
                                  onPressed: () =>
                                      _setOfficerStatus(
                                          officer, 'INACTIVE'),
                                  child:
                                      const Text('Deactivate'),
                                ),
                            ],
                          ),
                        ],
                      ),
                    ),
                  );
                },
              ),
            const SizedBox(height: 20),
            _sectionTitle('Commission withdrawals'),
            const SizedBox(height: 10),
            if (_officerWithdrawals.isEmpty)
              const _EmptyPanel(
                icon: Icons.account_balance_wallet_outlined,
                text: 'No Solar Officer withdrawal requests.',
              )
            else
              ..._officerWithdrawals.map(
                (Map<String, dynamic> withdrawal) {
                  final Map<String, dynamic> officer =
                      _map(withdrawal['officer']);
                  final Map<String, dynamic> user =
                      _map(officer['user']);
                  final String status =
                      _text(withdrawal['status']).toUpperCase();
                  return Card(
                    elevation: 0,
                    child: ListTile(
                      title: Text(
                        '${_text(user['fullName'], 'Solar Officer')} • ${_money(withdrawal['amount'])}',
                      ),
                      subtitle: Text(
                        '${_text(withdrawal['reference'])}\n'
                        '${_text(withdrawal['bankName'])} • ${_text(withdrawal['accountNumber'])}',
                      ),
                      isThreeLine: true,
                      trailing: Wrap(
                        spacing: 6,
                        children: <Widget>[
                          if (status == 'PENDING')
                            IconButton(
                              tooltip: 'Approve',
                              onPressed: () =>
                                  _reviewOfficerWithdrawal(
                                      withdrawal, 'approve'),
                              icon: const Icon(
                                  Icons.check_circle,
                                  color: _solarGreen),
                            ),
                          if (<String>[
                            'PENDING',
                            'APPROVED'
                          ].contains(status))
                            IconButton(
                              tooltip: 'Reject',
                              onPressed: () =>
                                  _reviewOfficerWithdrawal(
                                      withdrawal, 'reject'),
                              icon: const Icon(Icons.cancel,
                                  color: Color(0xFFB42318)),
                            ),
                          if (status == 'APPROVED')
                            IconButton(
                              tooltip: 'Mark paid',
                              onPressed: () =>
                                  _reviewOfficerWithdrawal(
                                      withdrawal, 'paid'),
                              icon: const Icon(Icons.paid,
                                  color: _solarGreen),
                            ),
                        ],
                      ),
                    ),
                  );
                },
              ),
          ],
        ),
      );

  Widget _financeTile(Map<String, dynamic> finance) {
    final Map<String, dynamic> customer = _map(finance['customer']);
    return Card(
      elevation: 0,
      child: ListTile(
        leading: const CircleAvatar(
          backgroundColor: Color(0xFFEAF7F0),
          child: Icon(Icons.account_balance_outlined, color: _solarGreen),
        ),
        title: Text(_text(customer['fullName'], 'Solar customer')),
        subtitle: Text(
            '${_text(finance['reference'], 'Finance contract')} • ${_text(finance['status'], '—').replaceAll('_', ' ')}\n'
            'Outstanding ${_money(finance['outstandingBalance'])}'),
        isThreeLine: true,
        trailing: Text(_money(finance['amountPaid']),
            style: const TextStyle(fontWeight: FontWeight.w800)),
      ),
    );
  }

  Widget _repaymentTile(Map<String, dynamic> payment) {
    final Map<String, dynamic> customer = _map(payment['customer']);
    return Card(
      elevation: 0,
      child: ListTile(
        leading: const Icon(Icons.payments_outlined, color: _solarGreen),
        title: Text(_text(customer['fullName'], 'Solar payment')),
        subtitle: Text(
            '${_text(payment['reference'], 'Installment payment')} • ${_text(payment['createdAt'])}'),
        trailing: Text(_money(payment['amount']),
            style: const TextStyle(fontWeight: FontWeight.w800)),
      ),
    );
  }

  Widget _settingsView() => ListView(
        padding: const EdgeInsets.all(16),
        children: <Widget>[
          _sectionTitle('Solar settings'),
          const SizedBox(height: 5),
          const Text(
            'These controls apply to new applications and never amend active contracts.',
            style: TextStyle(color: Color(0xFF597066)),
          ),
          const SizedBox(height: 14),
          Card(
            elevation: 0,
            child: ListTile(
              leading: const Icon(Icons.event_available_outlined,
                  color: _solarGreen),
              title: const Text('Overdue grace period'),
              subtitle: Text('${_settings['overdueGraceDays'] ?? 0} days'),
              trailing: const Icon(Icons.chevron_right),
              onTap: _saveSettings,
            ),
          ),
          Card(
            elevation: 0,
            child: ListTile(
              leading: const Icon(Icons.app_registration_outlined,
                  color: _solarGreen),
              title: const Text('New applications'),
              subtitle: Text(_settings['applicationEnabled'] == false
                  ? 'Currently paused'
                  : 'Currently accepting applications'),
              trailing: const Icon(Icons.chevron_right),
              onTap: _saveSettings,
            ),
          ),
          const SizedBox(height: 16),
          const Card(
            elevation: 0,
            color: Color(0xFFFFF8E8),
            child: Padding(
              padding: EdgeInsets.all(16),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Icon(Icons.gavel_outlined, color: Color(0xFF8A5A00)),
                  SizedBox(width: 12),
                  Expanded(
                    child: Text(
                      'ServicePay Solar does not use device locking. Equipment recovery is a manual, auditable operational decision.',
                      style: TextStyle(height: 1.4),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
      );

  Widget _sectionTitle(String value) => Text(value,
      style: const TextStyle(fontSize: 21, fontWeight: FontWeight.w900));
}

class _Metric {
  const _Metric(this.label, this.value, this.icon);
  final String label;
  final dynamic value;
  final IconData icon;
}

class _StatusBadge extends StatelessWidget {
  const _StatusBadge({required this.status});
  final String status;

  @override
  Widget build(BuildContext context) {
    final bool concerning = <String>[
      'OVERDUE',
      'DEFAULT_REVIEW',
      'RECOVERY_REQUIRED',
      'REJECTED',
    ].contains(status);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 5),
      decoration: BoxDecoration(
        color: concerning ? const Color(0xFFFFE9E7) : const Color(0xFFDDF4E6),
        borderRadius: BorderRadius.circular(20),
      ),
      child: Text(
        status.replaceAll('_', ' '),
        style: TextStyle(
          color: concerning ? const Color(0xFFB42318) : _solarGreen,
          fontWeight: FontWeight.w800,
          fontSize: 10,
        ),
      ),
    );
  }
}

class _EmptyPanel extends StatelessWidget {
  const _EmptyPanel({required this.icon, required this.text});
  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.all(28),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(18),
          border: Border.all(color: const Color(0xFFDDEAE1)),
        ),
        child: Column(
          children: <Widget>[
            Icon(icon, color: _solarGreen, size: 34),
            const SizedBox(height: 10),
            Text(text, textAlign: TextAlign.center),
          ],
        ),
      );
}

class _SolarAdminException implements Exception {
  const _SolarAdminException(this.message);
  final String message;
}

class _SolarAdminApi {
  _SolarAdminApi({
    this.baseUrl = 'https://api.servicepay.ng/api/solar/admin',
  });

  final String baseUrl;

  Future<Map<String, dynamic>> get(
    String path, {
    Map<String, String>? query,
  }) =>
      _request('GET', path, query: query);

  Future<Map<String, dynamic>> post(
    String path, {
    Map<String, dynamic> body = const <String, dynamic>{},
  }) =>
      _request('POST', path, body: body);

  Future<Map<String, dynamic>> put(
    String path, {
    Map<String, dynamic> body = const <String, dynamic>{},
  }) =>
      _request('PUT', path, body: body);

  Future<Map<String, dynamic>> patch(
    String path, {
    Map<String, dynamic> body = const <String, dynamic>{},
  }) =>
      _request('PATCH', path, body: body);

  Future<Map<String, String>> _headers() async {
    final SharedPreferences preferences = await SharedPreferences.getInstance();
    String token = '';
    for (final String key in <String>[
      'auth_token',
      'token',
      'access_token',
      'accessToken',
      'jwt_token',
      'jwt',
    ]) {
      final String candidate = preferences.getString(key)?.trim() ?? '';
      if (candidate.isNotEmpty) {
        token = candidate;
        break;
      }
    }
    if (token.isEmpty) {
      throw const _SolarAdminException(
        'Your admin login session was not found. Please sign in again.',
      );
    }
    return <String, String>{
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'Authorization':
          token.toLowerCase().startsWith('bearer ') ? token : 'Bearer $token',
    };
  }

  Future<Map<String, dynamic>> _request(
    String method,
    String path, {
    Map<String, String>? query,
    Map<String, dynamic>? body,
  }) async {
    final Uri url = Uri.parse('$baseUrl$path').replace(
      queryParameters: query?.isEmpty ?? true ? null : query,
    );
    final Map<String, String> headers = await _headers();
    final String? encoded = body == null ? null : jsonEncode(body);
    final http.Response response;
    switch (method) {
      case 'POST':
        response = await http.post(url, headers: headers, body: encoded);
      case 'PUT':
        response = await http.put(url, headers: headers, body: encoded);
      case 'PATCH':
        response = await http.patch(url, headers: headers, body: encoded);
      default:
        response = await http.get(url, headers: headers);
    }
    dynamic decoded;
    try {
      decoded = jsonDecode(response.body);
    } catch (_) {
      decoded = <String, dynamic>{};
    }
    final Map<String, dynamic> data = decoded is Map
        ? Map<String, dynamic>.from(decoded)
        : <String, dynamic>{};
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw _SolarAdminException(
        data['message']?.toString() ?? 'Solar administrative request failed.',
      );
    }
    return data;
  }
}

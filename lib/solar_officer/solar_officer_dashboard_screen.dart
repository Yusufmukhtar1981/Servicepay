import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../login_screen.dart';
import '../services/solar_officer_api_service.dart';

const Color _green = Color(0xFF08783E);
const Color _ink = Color(0xFF17352A);

class SolarOfficerDashboardScreen extends StatefulWidget {
  const SolarOfficerDashboardScreen({
    super.key,
    this.api,
  });

  final SolarOfficerApiService? api;

  @override
  State<SolarOfficerDashboardScreen> createState() =>
      _SolarOfficerDashboardScreenState();
}

class _SolarOfficerDashboardScreenState
    extends State<SolarOfficerDashboardScreen> {
  late final SolarOfficerApiService _api;
  bool _loading = true;
  String _error = '';
  int _section = 0;
  Map<String, dynamic> _dashboard = <String, dynamic>{};
  Map<String, dynamic> _profile = <String, dynamic>{};
  Map<String, dynamic> _wallet = <String, dynamic>{};
  Map<String, dynamic> _performance = <String, dynamic>{};
  List<Map<String, dynamic>> _applications = <Map<String, dynamic>>[];
  List<Map<String, dynamic>> _repayments = <Map<String, dynamic>>[];
  List<Map<String, dynamic>> _overdue = <Map<String, dynamic>>[];
  List<Map<String, dynamic>> _commissions = <Map<String, dynamic>>[];
  List<Map<String, dynamic>> _withdrawals = <Map<String, dynamic>>[];

  static const List<_OfficerSection> _sections = <_OfficerSection>[
    _OfficerSection('Dashboard', Icons.dashboard_outlined),
    _OfficerSection('Customers', Icons.people_outline),
    _OfficerSection('Applications', Icons.assignment_outlined),
    _OfficerSection('Verification', Icons.fact_check_outlined),
    _OfficerSection('Solar Deliveries', Icons.solar_power_outlined),
    _OfficerSection('Repayments', Icons.event_repeat_outlined),
    _OfficerSection('Overdue', Icons.warning_amber_outlined),
    _OfficerSection('Commissions', Icons.account_balance_wallet_outlined),
    _OfficerSection('Reports', Icons.analytics_outlined),
    _OfficerSection('Profile', Icons.badge_outlined),
  ];

  @override
  void initState() {
    super.initState();
    _api = widget.api ?? SolarOfficerApiService();
    _load();
  }

  Map<String, dynamic> _map(dynamic value) =>
      value is Map ? Map<String, dynamic>.from(value) : <String, dynamic>{};

  List<Map<String, dynamic>> _list(dynamic value) => value is List
      ? value.whereType<Map>().map((Map item) => _map(item)).toList()
      : <Map<String, dynamic>>[];

  String _text(dynamic value, [String fallback = '—']) {
    final String result = value?.toString().trim() ?? '';
    return result.isEmpty ? fallback : result;
  }

  String _money(dynamic value) {
    final num amount = value is num ? value : num.tryParse('$value') ?? 0;
    return '₦${amount.toStringAsFixed(2)}';
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = '';
    });
    try {
      final List<Map<String, dynamic>> responses =
          await Future.wait(<Future<Map<String, dynamic>>>[
        _api.get('/dashboard'),
        _api.get('/applications'),
        _api.get('/repayments'),
        _api.get('/overdue'),
        _api.get('/commissions'),
        _api.get('/withdrawals'),
        _api.get('/performance'),
        _api.get('/me'),
      ]);
      if (!mounted) return;
      setState(() {
        _dashboard = _map(responses[0]['dashboard']);
        _applications = _list(responses[1]['applications']);
        _repayments = _list(responses[2]['repayments']);
        _overdue = _list(responses[3]['overdue']);
        _wallet = _map(responses[4]['wallet']);
        _commissions = _list(responses[4]['commissions']);
        _withdrawals = _list(responses[5]['withdrawals']);
        _performance = _map(responses[6]['performance']);
        _profile = _map(responses[7]['officer']);
        _loading = false;
      });
    } on SolarOfficerApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = error.message;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = 'Unable to load the Solar Officer dashboard.';
      });
    }
  }

  void _notice(String message, {bool error = false}) {
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(
        SnackBar(
          content: Text(message),
          behavior: SnackBarBehavior.floating,
          backgroundColor: error ? const Color(0xFFB42318) : _green,
        ),
      );
  }

  String _id(Map<String, dynamic> application) =>
      _text(application['_id'] ?? application['id'], '');

  Future<void> _verify(Map<String, dynamic> application) async {
    final List<String> fields = <String>[
      'identityConfirmed',
      'phoneConfirmed',
      'addressConfirmed',
      'locationConfirmed',
      'customerContacted',
      'requirementConfirmed',
      'repaymentAssessed',
      'kycReviewed',
    ];
    final Map<String, bool> checklist = <String, bool>{
      for (final String field in fields) field: false,
    };
    final TextEditingController notes = TextEditingController();
    final TextEditingController visit = TextEditingController();
    String recommendation = 'NEEDS_REVIEW';
    final bool? save = await showDialog<bool>(
      context: context,
      builder: (BuildContext dialogContext) => StatefulBuilder(
        builder: (BuildContext context, StateSetter setDialogState) =>
            AlertDialog(
          title: const Text('Field verification'),
          content: SizedBox(
            width: 520,
            child: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: <Widget>[
                  for (final String field in fields)
                    CheckboxListTile(
                      dense: true,
                      contentPadding: EdgeInsets.zero,
                      value: checklist[field],
                      title: Text(
                        field
                            .replaceAllMapped(
                              RegExp(r'([A-Z])'),
                              (Match match) => ' ${match.group(1)}',
                            )
                            .toLowerCase(),
                      ),
                      onChanged: (bool? value) => setDialogState(
                          () => checklist[field] = value == true),
                    ),
                  TextField(
                    controller: notes,
                    maxLines: 3,
                    decoration: const InputDecoration(
                      labelText: 'Verification notes',
                      border: OutlineInputBorder(),
                    ),
                  ),
                  const SizedBox(height: 12),
                  TextField(
                    controller: visit,
                    maxLines: 3,
                    decoration: const InputDecoration(
                      labelText: 'Field visit notes',
                      border: OutlineInputBorder(),
                    ),
                  ),
                  const SizedBox(height: 12),
                  DropdownButtonFormField<String>(
                    value: recommendation,
                    decoration: const InputDecoration(
                      labelText: 'Recommendation',
                      border: OutlineInputBorder(),
                    ),
                    items: const <String>[
                      'VERIFIED_RECOMMENDED',
                      'NOT_RECOMMENDED',
                      'NEEDS_REVIEW',
                    ]
                        .map((String value) => DropdownMenuItem<String>(
                              value: value,
                              child: Text(value.replaceAll('_', ' ')),
                            ))
                        .toList(),
                    onChanged: (String? value) => setDialogState(
                        () => recommendation = value ?? 'NEEDS_REVIEW'),
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
              child: const Text('Submit verification'),
            ),
          ],
        ),
      ),
    );
    if (save != true) {
      notes.dispose();
      visit.dispose();
      return;
    }
    try {
      await _api.post(
        '/applications/${_id(application)}/verification',
        body: <String, dynamic>{
          'checklist': checklist,
          'notes': notes.text.trim(),
          'fieldVisitNotes': visit.text.trim(),
          'recommendation': recommendation,
        },
      );
      _notice('Verification report submitted to Admin.');
      await _load();
    } on SolarOfficerApiException catch (error) {
      _notice(error.message, error: true);
    } finally {
      notes.dispose();
      visit.dispose();
    }
  }

  Future<void> _handover(Map<String, dynamic> application) async {
    final TextEditingController notes = TextEditingController();
    final bool? save = await showDialog<bool>(
      context: context,
      builder: (BuildContext dialogContext) => AlertDialog(
        title: const Text('Record field handover'),
        content: TextField(
          controller: notes,
          maxLines: 4,
          decoration: const InputDecoration(
            labelText: 'Installation / handover notes',
            border: OutlineInputBorder(),
          ),
        ),
        actions: <Widget>[
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(dialogContext, true),
            child: const Text('Send to Admin'),
          ),
        ],
      ),
    );
    if (save != true) {
      notes.dispose();
      return;
    }
    try {
      await _api.post(
        '/applications/${_id(application)}/handover',
        body: <String, dynamic>{
          'installationDate': DateTime.now().toIso8601String(),
          'handoverNotes': notes.text.trim(),
        },
      );
      _notice(
          'Field handover recorded. Admin authorization is still required.');
      await _load();
    } on SolarOfficerApiException catch (error) {
      _notice(error.message, error: true);
    } finally {
      notes.dispose();
    }
  }

  Future<void> _followUp(Map<String, dynamic> record) async {
    final TextEditingController notes = TextEditingController();
    final TextEditingController response = TextEditingController();
    String method = 'PHONE';
    String outcome = 'CONTACTED';
    final bool? save = await showDialog<bool>(
      context: context,
      builder: (BuildContext dialogContext) => StatefulBuilder(
        builder: (BuildContext context, StateSetter setDialogState) =>
            AlertDialog(
          title: const Text('Record customer follow-up'),
          content: SizedBox(
            width: 480,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                DropdownButtonFormField<String>(
                  value: method,
                  decoration:
                      const InputDecoration(labelText: 'Contact method'),
                  items: const <String>[
                    'PHONE',
                    'SMS',
                    'WHATSAPP',
                    'VISIT',
                    'OTHER'
                  ]
                      .map((String value) => DropdownMenuItem<String>(
                          value: value, child: Text(value)))
                      .toList(),
                  onChanged: (String? value) =>
                      setDialogState(() => method = value ?? 'PHONE'),
                ),
                DropdownButtonFormField<String>(
                  value: outcome,
                  decoration: const InputDecoration(labelText: 'Outcome'),
                  items: const <String>[
                    'CONTACTED',
                    'PROMISE_TO_PAY',
                    'UNABLE_TO_CONTACT',
                    'ADDRESS_VISIT',
                    'RECOVERY_RECOMMENDED',
                    'REPOSSESSION_RECOMMENDED',
                  ]
                      .map((String value) => DropdownMenuItem<String>(
                          value: value,
                          child: Text(value.replaceAll('_', ' '))))
                      .toList(),
                  onChanged: (String? value) =>
                      setDialogState(() => outcome = value ?? 'CONTACTED'),
                ),
                TextField(
                  controller: notes,
                  maxLines: 3,
                  decoration:
                      const InputDecoration(labelText: 'Follow-up notes'),
                ),
                TextField(
                  controller: response,
                  maxLines: 2,
                  decoration:
                      const InputDecoration(labelText: 'Customer response'),
                ),
              ],
            ),
          ),
          actions: <Widget>[
            TextButton(
              onPressed: () => Navigator.pop(dialogContext, false),
              child: const Text('Cancel'),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(dialogContext, true),
              child: const Text('Save follow-up'),
            ),
          ],
        ),
      ),
    );
    if (save != true) {
      notes.dispose();
      response.dispose();
      return;
    }
    try {
      await _api.post(
        '/applications/${_text(record['applicationId'] ?? record['_id'], '')}/follow-ups',
        body: <String, dynamic>{
          'contactMethod': method,
          'notes': notes.text.trim(),
          'customerResponse': response.text.trim(),
          'outcome': outcome,
        },
      );
      _notice('Follow-up saved.');
      await _load();
    } on SolarOfficerApiException catch (error) {
      _notice(error.message, error: true);
    } finally {
      notes.dispose();
      response.dispose();
    }
  }

  Future<void> _requestWithdrawal() async {
    final Map<String, TextEditingController> fields =
        <String, TextEditingController>{
      'amount': TextEditingController(),
      'bankCode': TextEditingController(),
      'bankName': TextEditingController(),
      'accountNumber': TextEditingController(),
      'accountName': TextEditingController(),
    };
    final bool? save = await showDialog<bool>(
      context: context,
      builder: (BuildContext dialogContext) => AlertDialog(
        title: const Text('Withdraw available commission'),
        content: SizedBox(
          width: 440,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: fields.entries
                .map((MapEntry<String, TextEditingController> entry) => Padding(
                      padding: const EdgeInsets.only(bottom: 10),
                      child: TextField(
                        controller: entry.value,
                        keyboardType: <String>['amount', 'accountNumber']
                                .contains(entry.key)
                            ? TextInputType.number
                            : TextInputType.text,
                        decoration: InputDecoration(
                          labelText: entry.key
                              .replaceAllMapped(
                                RegExp(r'([A-Z])'),
                                (Match match) => ' ${match.group(1)}',
                              )
                              .toUpperCase(),
                          border: const OutlineInputBorder(),
                        ),
                      ),
                    ))
                .toList(),
          ),
        ),
        actions: <Widget>[
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(dialogContext, true),
            child: const Text('Request withdrawal'),
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
      await _api.post('/withdrawals', body: <String, dynamic>{
        for (final MapEntry<String, TextEditingController> entry
            in fields.entries)
          entry.key: entry.value.text.trim(),
      });
      _notice('Withdrawal request submitted for Admin review.');
      await _load();
    } on SolarOfficerApiException catch (error) {
      _notice(error.message, error: true);
    } finally {
      for (final TextEditingController item in fields.values) {
        item.dispose();
      }
    }
  }

  Future<void> _logout() async {
    final bool? confirmed = await showDialog<bool>(
      context: context,
      builder: (BuildContext dialogContext) => AlertDialog(
        title: const Text('Log out?'),
        content: const Text(
          'Are you sure you want to log out of your Solar Officer account?',
        ),
        actions: <Widget>[
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(dialogContext, true),
            child: const Text('Log out'),
          ),
        ],
      ),
    );
    if (confirmed != true) {
      return;
    }

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
      'rider_id',
      'rider_verification_status',
      'rider_availability_status',
      'rider_vehicle_type',
      'rider_plate_number',
      'rider_state',
      'rider_lga',
      'rider_is_online',
    ]) {
      await preferences.remove(key);
    }

    if (!mounted) {
      return;
    }
    Navigator.pushAndRemoveUntil(
      context,
      MaterialPageRoute<void>(
        builder: (_) => const LoginScreen(),
      ),
      (Route<dynamic> route) => false,
    );
  }

  @override
  Widget build(BuildContext context) {
    final bool wide = MediaQuery.sizeOf(context).width >= 900;
    return Scaffold(
      key: const Key('solar-officer-dashboard'),
      backgroundColor: const Color(0xFFF4F8F5),
      appBar: AppBar(
        title: Text('Solar Officer • ${_sections[_section].label}'),
        backgroundColor: _ink,
        foregroundColor: Colors.white,
        actions: <Widget>[
          IconButton(
            onPressed: _loading ? null : _load,
            icon: const Icon(Icons.refresh),
          ),
        ],
      ),
      drawer: wide ? null : _drawer(),
      body: _loading
          ? const Center(child: CircularProgressIndicator(color: _green))
          : _error.isNotEmpty
              ? _errorView()
              : Row(
                  children: <Widget>[
                    if (wide)
                      NavigationRail(
                        selectedIndex: _section,
                        onDestinationSelected: (int value) =>
                            setState(() => _section = value),
                        labelType: NavigationRailLabelType.all,
                        selectedIconTheme: const IconThemeData(color: _green),
                        destinations: _sections
                            .map((_OfficerSection section) =>
                                NavigationRailDestination(
                                  icon: Icon(section.icon),
                                  selectedIcon:
                                      Icon(section.icon, color: _green),
                                  label: Text(section.label),
                                ))
                            .toList(),
                      ),
                    Expanded(child: _sectionView()),
                  ],
                ),
    );
  }

  Widget _drawer() => Drawer(
        child: SafeArea(
          child: ListView(
            children: <Widget>[
              const ListTile(
                leading: Icon(Icons.solar_power, color: _green),
                title: Text('ServicePay Solar Officer',
                    style: TextStyle(fontWeight: FontWeight.w900)),
              ),
              const Divider(),
              for (int index = 0; index < _sections.length; index++)
                ListTile(
                  selected: _section == index,
                  leading: Icon(_sections[index].icon),
                  title: Text(_sections[index].label),
                  onTap: () {
                    setState(() => _section = index);
                    Navigator.pop(context);
                  },
                ),
            ],
          ),
        ),
      );

  Widget _sectionView() {
    switch (_section) {
      case 1:
        return _applicationList(
            title: 'Assigned customers',
            subtitle:
                'Only customers assigned to your officer account are visible.');
      case 2:
        return _applicationList(
            title: 'Solar applications',
            subtitle:
                'Review assigned applications and their Admin-controlled status.');
      case 3:
        return _verificationView();
      case 4:
        return _deliveriesView();
      case 5:
        return _repaymentsView();
      case 6:
        return _overdueView();
      case 7:
        return _commissionsView();
      case 8:
        return _reportsView();
      case 9:
        return _profileView();
      default:
        return _dashboardView();
    }
  }

  Widget _dashboardView() {
    final List<MapEntry<String, dynamic>> metrics = _dashboard.entries.toList();
    return RefreshIndicator(
      onRefresh: _load,
      color: _green,
      child: ListView(
        padding: const EdgeInsets.all(18),
        children: <Widget>[
          Text(
            'Welcome, ${_text(_map(_profile['user'])['fullName'], 'Solar Officer')}',
            style: const TextStyle(fontSize: 24, fontWeight: FontWeight.w900),
          ),
          const SizedBox(height: 4),
          const Text(
            'Field verification, handover, repayment and recovery operations.',
            style: TextStyle(color: Color(0xFF587064)),
          ),
          const SizedBox(height: 18),
          Wrap(
            spacing: 12,
            runSpacing: 12,
            children: metrics
                .map((MapEntry<String, dynamic> entry) => _metricCard(
                      entry.key,
                      entry.key.toLowerCase().contains('commission') ||
                              entry.key.toLowerCase().contains('sales')
                          ? _money(entry.value)
                          : _text(entry.value, '0'),
                    ))
                .toList(),
          ),
        ],
      ),
    );
  }

  Widget _metricCard(String label, String value) => SizedBox(
        width: 190,
        child: Card(
          elevation: 0,
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Text(
                  label
                      .replaceAllMapped(
                        RegExp(r'([A-Z])'),
                        (Match match) => ' ${match.group(1)}',
                      )
                      .trim(),
                  style: const TextStyle(color: Color(0xFF587064)),
                ),
                const SizedBox(height: 8),
                Text(value,
                    style: const TextStyle(
                        fontSize: 22,
                        fontWeight: FontWeight.w900,
                        color: _ink)),
              ],
            ),
          ),
        ),
      );

  Widget _applicationList({
    required String title,
    required String subtitle,
  }) =>
      RefreshIndicator(
        onRefresh: _load,
        child: ListView(
          padding: const EdgeInsets.all(18),
          children: <Widget>[
            Text(title,
                style:
                    const TextStyle(fontSize: 22, fontWeight: FontWeight.w900)),
            Text(subtitle, style: const TextStyle(color: Color(0xFF587064))),
            const SizedBox(height: 14),
            if (_applications.isEmpty)
              _empty('No assigned applications.')
            else
              ..._applications.map(_applicationCard),
          ],
        ),
      );

  Widget _applicationCard(Map<String, dynamic> application) {
    final Map<String, dynamic> customer = _map(application['customer']);
    final Map<String, dynamic> package = _map(application['packageSnapshot']);
    final Map<String, dynamic> verification = _map(application['verification']);
    final Map<String, dynamic> business = _map(application['business']);
    final Map<String, dynamic> preferences =
        _map(application['applicationPreferences']);
    return Card(
      elevation: 0,
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            const CircleAvatar(
              backgroundColor: Color(0xFFDDF4E6),
              child: Icon(Icons.person, color: _green),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Text(
                    _text(customer['fullName'], 'Assigned customer'),
                    style: const TextStyle(fontWeight: FontWeight.w800),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    '${_text(package['name'], 'Solar package')} • ${_text(application['status'])}',
                  ),
                  Text(
                      '${_text(customer['phone'])} • ${_text(customer['address'])}'),
                  Text(
                    'Occupation: ${_text(preferences['occupationBusiness'] ?? business['occupationBusiness'], 'Not provided')}',
                  ),
                  Text(
                    'Income: ${_text(preferences['monthlyIncomeRange'], 'Not provided')} • '
                    'Preferred term: ${_text(preferences['preferredRepaymentPeriod'], 'Not provided')} months',
                  ),
                  Text(
                    'Upfront: ${_text(preferences['upfrontPaymentOption'], 'Not provided')}',
                  ),
                  Text(
                    'Recommendation: ${_text(verification['recommendation'], 'PENDING')}',
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _verificationView() => ListView(
        padding: const EdgeInsets.all(18),
        children: <Widget>[
          const Text('Customer verification',
              style: TextStyle(fontSize: 22, fontWeight: FontWeight.w900)),
          const SizedBox(height: 12),
          if (_applications.isEmpty)
            _empty('No applications require verification.')
          else
            ..._applications.map(
              (Map<String, dynamic> application) => Card(
                elevation: 0,
                child: ListTile(
                  title: Text(_text(
                      _map(application['customer'])['fullName'], 'Customer')),
                  subtitle: Text(
                      'Current recommendation: ${_text(_map(application['verification'])['recommendation'], 'PENDING')}'),
                  trailing: FilledButton(
                    onPressed: () => _verify(application),
                    child: const Text('Verify'),
                  ),
                ),
              ),
            ),
        ],
      );

  Widget _deliveriesView() {
    final List<Map<String, dynamic>> ready =
        _applications.where((Map<String, dynamic> item) {
      return <String>[
        'DEPOSIT_PAID',
        'READY_FOR_INSTALLATION',
        'INSTALLED',
        'FINANCE_ACTIVE',
        'COMPLETED'
      ].contains(_text(item['status']).toUpperCase());
    }).toList();
    return ListView(
      padding: const EdgeInsets.all(18),
      children: <Widget>[
        const Text('Solar deliveries & handover',
            style: TextStyle(fontSize: 22, fontWeight: FontWeight.w900)),
        const Text(
            'Field handover reports do not release stock or activate finance; Admin retains final control.'),
        const SizedBox(height: 12),
        if (ready.isEmpty)
          _empty('No delivery-ready Solar applications.')
        else
          ...ready.map(
            (Map<String, dynamic> item) => Card(
              elevation: 0,
              child: ListTile(
                title:
                    Text(_text(_map(item['customer'])['fullName'], 'Customer')),
                subtitle: Text(
                    '${_text(_map(item['packageSnapshot'])['name'])} • ${_text(item['status'])}'),
                trailing: <String>['DEPOSIT_PAID', 'READY_FOR_INSTALLATION']
                        .contains(_text(item['status']).toUpperCase())
                    ? FilledButton(
                        onPressed: () => _handover(item),
                        child: const Text('Handover'),
                      )
                    : const Icon(Icons.check_circle, color: _green),
              ),
            ),
          ),
      ],
    );
  }

  Widget _repaymentsView() => ListView(
        padding: const EdgeInsets.all(18),
        children: <Widget>[
          const Text('Repayment monitoring',
              style: TextStyle(fontSize: 22, fontWeight: FontWeight.w900)),
          const SizedBox(height: 12),
          if (_repayments.isEmpty)
            _empty('No active repayment accounts.')
          else
            ..._repayments.map(
              (Map<String, dynamic> item) => Card(
                elevation: 0,
                child: ListTile(
                  title: Text(
                      _text(_map(item['customer'])['fullName'], 'Customer')),
                  subtitle: Text(
                    '${_text(_map(item['package'])['name'])} • ${_text(item['paymentStatus'])}\n'
                    'Paid: ${_money(item['amountPaidSoFar'])} • Remaining: ${_money(item['remainingBalance'])}',
                  ),
                  isThreeLine: true,
                  trailing: OutlinedButton(
                    onPressed: () => _followUp(item),
                    child: const Text('Follow up'),
                  ),
                ),
              ),
            ),
        ],
      );

  Widget _overdueView() => ListView(
        padding: const EdgeInsets.all(18),
        children: <Widget>[
          const Text('Overdue & recovery follow-up',
              style: TextStyle(fontSize: 22, fontWeight: FontWeight.w900)),
          const SizedBox(height: 12),
          if (_overdue.isEmpty)
            _empty('No assigned overdue accounts.')
          else
            ..._overdue.map(
              (Map<String, dynamic> item) => Card(
                elevation: 0,
                child: ListTile(
                  title: Text(
                      _text(_map(item['customer'])['fullName'], 'Customer')),
                  subtitle: Text(
                      '${item['daysOverdue'] ?? 0} days overdue • Due ${_money(item['amountDue'])}\n'
                      'Outstanding ${_money(item['totalOutstanding'])}'),
                  isThreeLine: true,
                  trailing: FilledButton(
                    onPressed: () => _followUp(item),
                    child: const Text('Report'),
                  ),
                ),
              ),
            ),
        ],
      );

  Widget _commissionsView() => ListView(
        padding: const EdgeInsets.all(18),
        children: <Widget>[
          Row(
            children: <Widget>[
              const Expanded(
                child: Text('Commission wallet',
                    style:
                        TextStyle(fontSize: 22, fontWeight: FontWeight.w900)),
              ),
              FilledButton.icon(
                onPressed: _requestWithdrawal,
                icon: const Icon(Icons.account_balance),
                label: const Text('Withdraw'),
              ),
            ],
          ),
          const SizedBox(height: 12),
          Wrap(
            spacing: 12,
            runSpacing: 12,
            children: <Widget>[
              _metricCard(
                  'Pending Commission', _money(_wallet['pendingBalance'])),
              _metricCard(
                  'Available Commission', _money(_wallet['availableBalance'])),
              _metricCard('Total Earned', _money(_wallet['totalEarned'])),
              _metricCard('Total Withdrawn', _money(_wallet['totalWithdrawn'])),
            ],
          ),
          const SizedBox(height: 18),
          const Text('Commission history',
              style: TextStyle(fontWeight: FontWeight.w900, fontSize: 17)),
          if (_commissions.isEmpty)
            _empty('No Solar commission entries yet.')
          else
            ..._commissions.map(
              (Map<String, dynamic> item) => ListTile(
                title: Text(_text(item['commissionType']).replaceAll('_', ' ')),
                subtitle: Text(
                    'Base ${_money(item['baseAmount'])} at ${item['percentage'] ?? 0}% • ${_text(item['status'])}'),
                trailing: Text(
                  _money(item['commissionAmount']),
                  style: const TextStyle(
                      fontWeight: FontWeight.w900, color: _green),
                ),
              ),
            ),
          const Divider(),
          const Text('Withdrawal requests',
              style: TextStyle(fontWeight: FontWeight.w900, fontSize: 17)),
          ..._withdrawals.map(
            (Map<String, dynamic> item) => ListTile(
              title: Text(_money(item['amount'])),
              subtitle: Text(_text(item['reference'])),
              trailing: Text(_text(item['status'])),
            ),
          ),
        ],
      );

  Widget _reportsView() => ListView(
        padding: const EdgeInsets.all(18),
        children: <Widget>[
          const Text('Performance report',
              style: TextStyle(fontSize: 22, fontWeight: FontWeight.w900)),
          const Text(
              'These figures are calculated by ServicePay and cannot be edited.'),
          const SizedBox(height: 14),
          Wrap(
            spacing: 12,
            runSpacing: 12,
            children: _performance.entries
                .map((MapEntry<String, dynamic> entry) =>
                    _metricCard(entry.key, _text(entry.value, '0')))
                .toList(),
          ),
        ],
      );

  Widget _profileView() {
    final Map<String, dynamic> user = _map(_profile['user']);
    return ListView(
      padding: const EdgeInsets.all(18),
      children: <Widget>[
        const Icon(Icons.badge, size: 72, color: _green),
        const SizedBox(height: 12),
        Center(
          child: Text(
            _text(user['fullName'], 'Solar Officer'),
            style: const TextStyle(fontSize: 24, fontWeight: FontWeight.w900),
          ),
        ),
        Center(
          child: Text(
              '${_text(_profile['officerId'])} • ${_text(_profile['status'])}'),
        ),
        const SizedBox(height: 20),
        Card(
          elevation: 0,
          child: Column(
            children: <Widget>[
              ListTile(
                  leading: const Icon(Icons.phone),
                  title: Text(_text(user['phone']))),
              ListTile(
                  leading: const Icon(Icons.email),
                  title: Text(_text(user['email']))),
              ListTile(
                  leading: const Icon(Icons.location_on),
                  title: Text(
                      '${_text(_profile['lga'])}, ${_text(_profile['state'])}')),
              ListTile(
                  leading: const Icon(Icons.home),
                  title: Text(_text(_profile['address']))),
            ],
          ),
        ),
        const SizedBox(height: 20),
        OutlinedButton.icon(
          onPressed: _logout,
          icon: const Icon(Icons.logout),
          label: const Text('Log out'),
          style: OutlinedButton.styleFrom(
            foregroundColor: const Color(0xFFB42318),
          ),
        ),
      ],
    );
  }

  Widget _errorView() => Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              const Icon(Icons.error_outline,
                  color: Color(0xFFB42318), size: 42),
              const SizedBox(height: 10),
              Text(_error, textAlign: TextAlign.center),
              const SizedBox(height: 12),
              FilledButton(
                onPressed: _load,
                child: const Text('Try again'),
              ),
            ],
          ),
        ),
      );

  Widget _empty(String message) => Container(
        margin: const EdgeInsets.symmetric(vertical: 12),
        padding: const EdgeInsets.all(28),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(18),
          border: Border.all(color: const Color(0xFFDCE8E0)),
        ),
        child: Center(child: Text(message)),
      );
}

class _OfficerSection {
  const _OfficerSection(this.label, this.icon);

  final String label;
  final IconData icon;
}

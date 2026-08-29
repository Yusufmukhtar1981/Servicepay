import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../login_screen.dart';
import '../services/solar_officer_api_service.dart';

const Color _green = Color(0xFF08783E);
const Color _ink = Color(0xFF17352A);
const Color _greenDark = Color(0xFF123F36);
const Color _surface = Color(0xFFF3F7F5);
const Color _line = Color(0xFFE1EAE5);
const Color _muted = Color(0xFF70807A);

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
  String _filter = 'ALL';
  int _repaymentTab = 0;
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
    _OfficerSection('Dashboard', Icons.grid_view_rounded),
    _OfficerSection('My Assignments', Icons.assignment_outlined),
    _OfficerSection('Verification', Icons.fact_check_outlined),
    _OfficerSection('Installations', Icons.solar_power_outlined),
    _OfficerSection('Repayments', Icons.payments_outlined),
    _OfficerSection('Customers', Icons.people_outline),
    _OfficerSection('Solar Packages', Icons.wb_sunny_outlined),
    _OfficerSection('Notifications', Icons.notifications_none_rounded),
    _OfficerSection('Reports', Icons.analytics_outlined),
    _OfficerSection('My Profile', Icons.badge_outlined),
    _OfficerSection('Settings', Icons.settings_outlined),
    _OfficerSection('Logout', Icons.logout_rounded),
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
        cardTheme: CardThemeData(
          color: Colors.white,
          elevation: 0,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(18),
            side: const BorderSide(color: _line),
          ),
        ),
      ),
      child: Scaffold(
        key: const Key('solar-officer-dashboard'),
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
                      Expanded(child: _sectionView()),
                    ],
                  ),
        bottomNavigationBar: wide
            ? null
            : NavigationBar(
                selectedIndex: <int>[0, 1, 3, 4].indexOf(_section).clamp(0, 3),
                onDestinationSelected: (int index) =>
                    setState(() => _section = <int>[0, 1, 3, 4][index]),
                destinations: const <NavigationDestination>[
                  NavigationDestination(
                      icon: Icon(Icons.grid_view_rounded), label: 'Dashboard'),
                  NavigationDestination(
                      icon: Icon(Icons.assignment_outlined),
                      label: 'Assignments'),
                  NavigationDestination(
                      icon: Icon(Icons.solar_power_outlined),
                      label: 'Installations'),
                  NavigationDestination(
                      icon: Icon(Icons.payments_outlined), label: 'Repayments'),
                ],
              ),
      ),
    );
  }

  Widget _topBar(bool wide) => Container(
        color: Colors.white,
        padding: EdgeInsets.symmetric(horizontal: wide ? 30 : 12, vertical: 12),
        child: Row(
          children: <Widget>[
            if (!wide)
              Builder(
                builder: (BuildContext context) => IconButton(
                  tooltip: 'Open navigation menu',
                  onPressed: () => Scaffold.of(context).openDrawer(),
                  icon: const Icon(Icons.menu_rounded, color: _ink),
                ),
              ),
            if (wide) _brand(),
            if (wide) const SizedBox(width: 30),
            Expanded(
              child: Text(_sections[_section].label,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                      color: _ink, fontSize: 18, fontWeight: FontWeight.w800)),
            ),
            _onlinePill(),
            IconButton(
              tooltip: 'Notifications',
              onPressed: () => setState(() => _section = 7),
              icon: const Icon(Icons.notifications_none_rounded, color: _muted),
            ),
            IconButton(
              tooltip: 'Refresh',
              onPressed: _loading ? null : _load,
              icon: const Icon(Icons.refresh_rounded, color: _muted),
            ),
            if (!wide) _brand(compact: true),
          ],
        ),
      );

  Widget _brand({bool compact = false}) => Row(
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          Container(
            width: compact ? 34 : 40,
            height: compact ? 34 : 40,
            decoration: BoxDecoration(
              gradient: const LinearGradient(
                  colors: <Color>[_green, Color(0xFF35B875)]),
              borderRadius: BorderRadius.circular(12),
            ),
            child: Icon(Icons.wb_sunny_rounded,
                color: Colors.white, size: compact ? 19 : 22),
          ),
          if (!compact) ...<Widget>[
            const SizedBox(width: 10),
            const Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Text('ServicePay',
                      style: TextStyle(
                          color: _ink,
                          fontSize: 15,
                          fontWeight: FontWeight.w900)),
                  Text('Solar Officer',
                      style: TextStyle(
                          color: _muted,
                          fontSize: 10,
                          fontWeight: FontWeight.w600)),
                ]),
          ],
        ],
      );

  Widget _onlinePill() {
    final String state = _text(_profile['status'], 'ACTIVE').toUpperCase();
    final bool online = state == 'ACTIVE' || state == 'ONLINE';
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 7),
      decoration: BoxDecoration(
        color: online ? const Color(0xFFE7F7EE) : const Color(0xFFF1F3F2),
        borderRadius: BorderRadius.circular(18),
      ),
      child: Row(mainAxisSize: MainAxisSize.min, children: <Widget>[
        Icon(Icons.circle, size: 7, color: online ? _green : _muted),
        const SizedBox(width: 6),
        Text(online ? 'Online' : 'Offline',
            style: TextStyle(
                color: online ? _greenDark : _muted,
                fontSize: 11,
                fontWeight: FontWeight.w800)),
      ]),
    );
  }

  Widget _sidebar() => Container(
        width: 244,
        color: _greenDark,
        padding: const EdgeInsets.fromLTRB(15, 22, 15, 16),
        child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: <Widget>[
              _darkBrand(),
              const SizedBox(height: 28),
              const Padding(
                  padding: EdgeInsets.only(left: 12, bottom: 10),
                  child: Text('OFFICER WORKSPACE',
                      style: TextStyle(
                          color: Color(0xFF91B2A5),
                          fontSize: 10,
                          letterSpacing: 1.2,
                          fontWeight: FontWeight.w800))),
              Expanded(
                  child: ListView.builder(
                      itemCount: _sections.length,
                      itemBuilder: (_, int index) => _navItem(index))),
              const Text('Field access is scoped to assigned customers.',
                  style: TextStyle(color: Color(0xFFB9D1C5), fontSize: 11)),
            ]),
      );

  Widget _darkBrand() => Row(children: <Widget>[
        Container(
            width: 40,
            height: 40,
            decoration: BoxDecoration(
                color: _green, borderRadius: BorderRadius.circular(13)),
            child: const Icon(Icons.wb_sunny_rounded, color: Colors.white)),
        const SizedBox(width: 10),
        const Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Text('ServicePay',
                  style: TextStyle(
                      color: Colors.white,
                      fontSize: 15,
                      fontWeight: FontWeight.w900)),
              Text('Solar Officer',
                  style: TextStyle(
                      color: Color(0xFFB1CEC2),
                      fontSize: 10,
                      fontWeight: FontWeight.w600)),
            ]),
      ]);

  Widget _navItem(int index) {
    final _OfficerSection item = _sections[index];
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
            if (index == _sections.length - 1) {
              _logout();
              return;
            }
            setState(() => _section = index);
            if (MediaQuery.sizeOf(context).width < 960) Navigator.pop(context);
          },
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
            child: Row(children: <Widget>[
              Icon(item.icon,
                  size: 18,
                  color: selected
                      ? const Color(0xFF7CE1AA)
                      : const Color(0xFFA6BEB4)),
              const SizedBox(width: 12),
              Expanded(
                  child: Text(item.label,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                          color:
                              selected ? Colors.white : const Color(0xFFD1E0DA),
                          fontSize: 12,
                          fontWeight:
                              selected ? FontWeight.w800 : FontWeight.w600))),
              if (selected)
                const Icon(Icons.chevron_right_rounded,
                    size: 16, color: Color(0xFF7CE1AA)),
            ]),
          ),
        ),
      ),
    );
  }

  Widget _drawer() => Drawer(
        backgroundColor: _greenDark,
        child: SafeArea(
            child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 20, 16, 12),
          child: Column(children: <Widget>[
            Row(children: <Widget>[
              Expanded(child: _darkBrand()),
              IconButton(
                  tooltip: 'Close menu',
                  onPressed: () => Navigator.pop(context),
                  icon: const Icon(Icons.close, color: Colors.white70)),
            ]),
            const SizedBox(height: 24),
            Expanded(
                child: ListView.builder(
              itemCount: _sections.length,
              itemBuilder: (_, int index) => _navItem(index),
            )),
          ]),
        )),
      );

  Widget _sectionView() {
    switch (_section) {
      case 1:
        return _applicationList(
            title: 'My assignments',
            subtitle:
                'Only applications assigned to your officer account are visible.');
      case 2:
        return _verificationView();
      case 3:
        return _deliveriesView();
      case 4:
        return _repaymentsHub();
      case 5:
        return _applicationList(
            title: 'Customers',
            subtitle:
                'Customers attached to your assigned solar applications.');
      case 6:
        return _applicationList(
            title: 'Solar packages',
            subtitle: 'Packages currently present in assigned applications.');
      case 7:
        return _emptyPage('Notifications',
            'No notification feed is available for this officer account.');
      case 8:
        return _reportsView();
      case 9:
        return _profileView();
      case 10:
        return _emptyPage('Settings',
            'Settings are managed by your organisation administrator.');
      case 11:
        return _emptyPage(
            'Logout', 'Use the logout action in your profile or navigation.');
      default:
        return _dashboardView();
    }
  }

  Widget _emptyPage(String title, String message) => ListView(
        padding: const EdgeInsets.all(24),
        children: <Widget>[
          Text(title,
              style: const TextStyle(
                  fontSize: 24, fontWeight: FontWeight.w900, color: _ink)),
          const SizedBox(height: 16),
          _empty(message),
        ],
      );

  Widget _dashboardView() {
    final int total = _countMetric('assignedCustomers', _applications.length);
    final int pending = _countMetric(
        'pendingVerification',
        _applications
            .where((Map<String, dynamic> item) => <String>[
                  'PENDING',
                  'UNDER_REVIEW',
                  'SUBMITTED'
                ].contains(_text(item['status'], '').toUpperCase()))
            .length);
    final int active = _countMetric(
        'activeInstallations',
        _applications
            .where((Map<String, dynamic> item) => <String>[
                  'INSTALLED',
                  'FINANCE_ACTIVE',
                  'ACTIVE'
                ].contains(_text(item['status'], '').toUpperCase()))
            .length);
    final int completed = _countMetric(
        'completed',
        _applications
            .where((Map<String, dynamic> item) =>
                _text(item['status'], '').toUpperCase() == 'COMPLETED')
            .length);
    final String name =
        _text(_map(_profile['user'])['fullName'], 'Solar Officer');
    return RefreshIndicator(
      onRefresh: _load,
      color: _green,
      child: ListView(
        padding: const EdgeInsets.all(18),
        children: <Widget>[
          _welcomeHeader(name),
          const SizedBox(height: 20),
          LayoutBuilder(builder: (_, BoxConstraints constraints) {
            final double width = (constraints.maxWidth - 36) /
                (constraints.maxWidth > 700 ? 4 : 2);
            return Wrap(spacing: 12, runSpacing: 12, children: <Widget>[
              _metricCard('Total Assignments', '$total', width),
              _metricCard('Pending Verification', '$pending', width),
              _metricCard('Active Installations', '$active', width),
              _metricCard('Completed', '$completed', width),
            ]);
          }),
          const SizedBox(height: 20),
          _overviewCard(pending, active, completed),
          const SizedBox(height: 20),
          _recentActivityCard(),
        ],
      ),
    );
  }

  int _countMetric(String key, int fallback) {
    final dynamic value = _dashboard[key];
    if (value is num) return value.toInt();
    final int? parsed = int.tryParse(_text(value, ''));
    return parsed ?? fallback;
  }

  Widget _welcomeHeader(String name) => Container(
        padding: const EdgeInsets.fromLTRB(20, 19, 18, 18),
        decoration: BoxDecoration(
          gradient: const LinearGradient(colors: <Color>[_greenDark, _green]),
          borderRadius: BorderRadius.circular(20),
        ),
        child: Row(children: <Widget>[
          Expanded(
              child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                const Text('SOLAR OFFICER PORTAL',
                    style: TextStyle(
                        color: Color(0xFFB7EBCB),
                        fontSize: 9,
                        letterSpacing: 1.2,
                        fontWeight: FontWeight.w900)),
                const SizedBox(height: 9),
                Text('Welcome back, $name',
                    style: const TextStyle(
                        color: Colors.white,
                        fontSize: 23,
                        fontWeight: FontWeight.w900)),
                const SizedBox(height: 6),
                const Text(
                    'Keep every field visit and installation moving forward.',
                    style: TextStyle(color: Color(0xFFC5E7D5), fontSize: 12)),
              ])),
          const Icon(Icons.wb_sunny_rounded,
              color: Color(0xFFBEEFD1), size: 38),
        ]),
      );

  Widget _overviewCard(int pending, int active, int completed) => Card(
      child: Padding(
          padding: const EdgeInsets.all(18),
          child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                const Text('Assignment overview',
                    style: TextStyle(
                        fontSize: 16,
                        fontWeight: FontWeight.w900,
                        color: _ink)),
                const SizedBox(height: 15),
                _bar('Pending verification', pending, const Color(0xFFE7A83B)),
                _bar('Active installations', active, _green),
                _bar('Completed', completed, const Color(0xFF5B8DEF)),
              ])));

  Widget _bar(String label, int count, Color color) {
    final int total = _applications.isEmpty ? 1 : _applications.length;
    return Padding(
        padding: const EdgeInsets.only(bottom: 11),
        child: Row(children: <Widget>[
          SizedBox(
              width: 145,
              child: Text(label,
                  style: const TextStyle(color: _muted, fontSize: 12))),
          Expanded(
              child: ClipRRect(
                  borderRadius: BorderRadius.circular(5),
                  child: LinearProgressIndicator(
                      value: count / total,
                      minHeight: 8,
                      backgroundColor: const Color(0xFFEAF0EC),
                      color: color))),
          const SizedBox(width: 10),
          Text('$count', style: const TextStyle(fontWeight: FontWeight.w900)),
        ]));
  }

  Widget _recentActivityCard() {
    final List<Map<String, dynamic>> rows = _applications.take(3).toList();
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(18),
        child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              const Text('Recent activity',
                  style: TextStyle(
                      fontSize: 16, fontWeight: FontWeight.w900, color: _ink)),
              const SizedBox(height: 4),
              const Text('Latest assignment activity from your live portfolio.',
                  style: TextStyle(color: _muted, fontSize: 12)),
              const SizedBox(height: 12),
              if (rows.isEmpty)
                const Text('No recent activity.',
                    style: TextStyle(color: _muted))
              else
                ...rows.map((Map<String, dynamic> row) {
                  final Map<String, dynamic> customer = _map(row['customer']);
                  return ListTile(
                    contentPadding: EdgeInsets.zero,
                    leading: const Icon(Icons.bolt_outlined, color: _green),
                    title:
                        Text(_text(customer['fullName'], 'Assigned customer')),
                    subtitle: Text('Assignment ${_text(_id(row))}'),
                    trailing: _statusPill(
                        _text(row['status'], 'PENDING').replaceAll('_', ' ')),
                  );
                }),
            ]),
      ),
    );
  }

  Widget _metricCard(String label, String value, [double width = 190]) =>
      SizedBox(
        width: width,
        child: Card(
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
                  style: const TextStyle(color: _muted, fontSize: 11),
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
            Wrap(
              spacing: 8,
              children: <String>['ALL', 'PENDING', 'IN_PROGRESS', 'COMPLETED']
                  .map((String value) => ChoiceChip(
                      label: Text(
                          value == 'ALL' ? 'All' : value.replaceAll('_', ' ')),
                      selected: _filter == value,
                      onSelected: (_) => setState(() => _filter = value)))
                  .toList(),
            ),
            const SizedBox(height: 14),
            if (_filteredApplications.isEmpty)
              _empty('No assigned applications.')
            else
              ..._filteredApplications.map(_applicationCard),
          ],
        ),
      );

  List<Map<String, dynamic>> get _filteredApplications =>
      _applications.where((Map<String, dynamic> item) {
        if (_filter == 'ALL') {
          return true;
        }
        final String status = _text(item['status'], '').toUpperCase();
        if (_filter == 'PENDING') {
          return <String>['PENDING', 'UNDER_REVIEW', 'SUBMITTED']
              .contains(status);
        }
        if (_filter == 'IN_PROGRESS') {
          return <String>[
            'IN_PROGRESS',
            'PROCESSING',
            'INSTALLED',
            'FINANCE_ACTIVE'
          ].contains(status);
        }
        return status == 'COMPLETED';
      }).toList();

  Widget _applicationCard(Map<String, dynamic> application) {
    final Map<String, dynamic> customer = _map(application['customer']);
    final Map<String, dynamic> package = _map(application['packageSnapshot']);
    final Map<String, dynamic> verification = _map(application['verification']);
    final String status =
        _text(application['status'], 'PENDING').replaceAll('_', ' ');
    final String assignedDate = _text(
        application['assignedAt'] ?? application['createdAt'],
        'Date not provided');
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            Row(children: <Widget>[
              Container(
                  width: 40,
                  height: 40,
                  decoration: BoxDecoration(
                      color: const Color(0xFFE7F7EE),
                      borderRadius: BorderRadius.circular(12)),
                  child: const Icon(Icons.assignment_outlined, color: _green)),
              const SizedBox(width: 12),
              Expanded(
                  child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: <Widget>[
                    Text(_text(customer['fullName'], 'Assigned customer'),
                        style: const TextStyle(fontWeight: FontWeight.w800)),
                    Text('ID ${_text(_id(application))}',
                        style: const TextStyle(color: _muted, fontSize: 11)),
                  ])),
              _statusPill(status),
            ]),
            const SizedBox(height: 14),
            Wrap(spacing: 16, runSpacing: 8, children: <Widget>[
              _detail(Icons.wb_sunny_outlined,
                  _text(package['name'], 'Solar package')),
              _detail(
                  Icons.location_on_outlined,
                  _text(customer['address'] ?? application['location'],
                      'Location not provided')),
              _detail(Icons.calendar_today_outlined, assignedDate),
            ]),
            const SizedBox(height: 10),
            Text(
                'Recommendation: ${_text(verification['recommendation'], 'PENDING')}',
                style: const TextStyle(color: _muted, fontSize: 12)),
            Align(
                alignment: Alignment.centerRight,
                child: OutlinedButton(
                  onPressed: () => _showDetails(application),
                  child: const Text('View Details'),
                )),
          ],
        ),
      ),
    );
  }

  Widget _detail(IconData icon, String text) =>
      Row(mainAxisSize: MainAxisSize.min, children: <Widget>[
        Icon(icon, size: 15, color: _green),
        const SizedBox(width: 5),
        ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 220),
            child: Text(text,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(color: _muted, fontSize: 12))),
      ]);

  Widget _statusPill(String status) {
    final String normalized = status.toUpperCase();
    final Color color = normalized == 'COMPLETED'
        ? const Color(0xFF247A4D)
        : normalized.contains('PENDING') || normalized.contains('REVIEW')
            ? const Color(0xFF9A6718)
            : _green;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 6),
      decoration: BoxDecoration(
          color: color.withValues(alpha: .11),
          borderRadius: BorderRadius.circular(20)),
      child: Text(status,
          style: TextStyle(
              color: color, fontSize: 10, fontWeight: FontWeight.w900)),
    );
  }

  Future<void> _showDetails(Map<String, dynamic> application) async {
    final Map<String, dynamic> customer = _map(application['customer']);
    await showDialog<void>(
      context: context,
      builder: (BuildContext dialogContext) => AlertDialog(
        title: Text(_text(customer['fullName'], 'Assignment details')),
        content: Text('Assignment ${_text(_id(application))}\n'
            'Package: ${_text(_map(application['packageSnapshot'])['name'])}\n'
            'Status: ${_text(application['status'])}\n'
            'Phone: ${_text(customer['phone'])}\n'
            'Address: ${_text(customer['address'])}'),
        actions: <Widget>[
          if (<String>['PENDING', 'UNDER_REVIEW', 'SUBMITTED']
              .contains(_text(application['status'], '').toUpperCase()))
            TextButton(
              onPressed: () {
                Navigator.pop(dialogContext);
                _verify(application);
              },
              child: const Text('Verify'),
            ),
          TextButton(
              onPressed: () => Navigator.pop(dialogContext),
              child: const Text('Close')),
        ],
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

  Widget _repaymentsHub() => Column(
        children: <Widget>[
          Padding(
            padding: const EdgeInsets.fromLTRB(18, 16, 18, 0),
            child: SegmentedButton<int>(
              segments: const <ButtonSegment<int>>[
                ButtonSegment<int>(value: 0, label: Text('Current')),
                ButtonSegment<int>(value: 1, label: Text('Overdue')),
                ButtonSegment<int>(value: 2, label: Text('Earnings')),
              ],
              selected: <int>{_repaymentTab},
              onSelectionChanged: (Set<int> values) =>
                  setState(() => _repaymentTab = values.first),
            ),
          ),
          Expanded(
            child: _repaymentTab == 0
                ? _repaymentsView()
                : _repaymentTab == 1
                    ? _overdueView()
                    : _commissionsView(),
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

import 'package:flutter/material.dart';

import '../services/empowerment_api_service.dart';

class AdminEmpowermentScreen extends StatefulWidget {
  const AdminEmpowermentScreen({super.key});

  @override
  State<AdminEmpowermentScreen> createState() =>
      _AdminEmpowermentScreenState();
}

class _AdminEmpowermentScreenState extends State<AdminEmpowermentScreen>
    with SingleTickerProviderStateMixin {
  final EmpowermentApiService _api = EmpowermentApiService();
  late final TabController _tabs;

  bool _loading = true;
  String _error = '';
  Map<String, dynamic> _summary = <String, dynamic>{};
  List<Map<String, dynamic>> _organizations = <Map<String, dynamic>>[];
  List<Map<String, dynamic>> _eligibleOrganizations =
      <Map<String, dynamic>>[];
  List<Map<String, dynamic>> _programs = <Map<String, dynamic>>[];
  List<Map<String, dynamic>> _audit = <Map<String, dynamic>>[];

  @override
  void initState() {
    super.initState();
    _tabs = TabController(length: 4, vsync: this);
    _load();
  }

  @override
  void dispose() {
    _tabs.dispose();
    super.dispose();
  }

  List<Map<String, dynamic>> _list(Map<String, dynamic> body, String key) {
    final dynamic value = body[key];
    if (value is! List) return <Map<String, dynamic>>[];
    return value
        .whereType<Map>()
        .map((Map item) => Map<String, dynamic>.from(item))
        .toList();
  }

  String _id(Map<String, dynamic> item) =>
      (item['_id'] ?? item['id'] ?? '').toString();

  String _text(dynamic value, [String fallback = '']) =>
      value?.toString().trim().isNotEmpty == true
          ? value.toString().trim()
          : fallback;

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = '';
    });
    try {
      final List<Map<String, dynamic>> values =
          await Future.wait(<Future<Map<String, dynamic>>>[
        _api.get('/dashboard-summary'),
        _api.get('/organizations', query: <String, String>{'limit': '100'}),
        _api.get('/programs', query: <String, String>{'limit': '100'}),
        _api.get('/audit-trail', query: <String, String>{'limit': '50'}),
        _api.get('/organizations', query: <String, String>{
          'eligible': 'true',
          'limit': '100',
        }),
      ]);
      if (!mounted) return;
      setState(() {
        _summary = values[0]['summary'] is Map
            ? Map<String, dynamic>.from(values[0]['summary'] as Map)
            : <String, dynamic>{};
        _organizations = _list(values[1], 'organizations');
        _programs = _list(values[2], 'programs');
        _audit = _list(values[3], 'activity');
        _eligibleOrganizations = _list(values[4], 'organizations');
        _loading = false;
      });
    } on EmpowermentApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = error.message;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = 'Unable to load Empowerment administration.';
      });
    }
  }

  void _notice(String message, {bool error = false}) {
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(
        SnackBar(
          content: Text(message),
          backgroundColor: error ? const Color(0xFFB42318) : const Color(0xFF08783E),
        ),
      );
  }

  Future<void> _organizationStatus(
    Map<String, dynamic> organization,
    String status,
  ) async {
    try {
      await _api.patch(
        '/organizations/${_id(organization)}/status',
        body: <String, dynamic>{'status': status},
      );
      _notice('Organization marked ${status.toLowerCase()}.');
      await _load();
    } on EmpowermentApiException catch (error) {
      _notice(error.message, error: true);
    }
  }

  Future<void> _showOrganization(Map<String, dynamic> organization) async {
    try {
      final Map<String, dynamic> response =
          await _api.get('/organizations/${_id(organization)}');
      final Map<String, dynamic> details = response['organization'] is Map
          ? Map<String, dynamic>.from(response['organization'] as Map)
          : organization;
      if (!mounted) return;

      await showModalBottomSheet<void>(
        context: context,
        isScrollControlled: true,
        builder: (BuildContext sheetContext) {
          final String status = _text(details['status'], 'PENDING');
          final Map<String, dynamic> owner = details['createdBy'] is Map
              ? Map<String, dynamic>.from(details['createdBy'] as Map)
              : <String, dynamic>{};
          final Map<String, dynamic> verification =
              details['verification'] is Map
                  ? Map<String, dynamic>.from(details['verification'] as Map)
                  : <String, dynamic>{};
          final Map<String, dynamic> verifier =
              verification['verifiedBy'] is Map
                  ? Map<String, dynamic>.from(
                      verification['verifiedBy'] as Map)
                  : <String, dynamic>{};

          return SafeArea(
            child: Padding(
              padding: const EdgeInsets.fromLTRB(20, 20, 20, 28),
              child: SingleChildScrollView(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: <Widget>[
                    Row(
                      children: <Widget>[
                        const CircleAvatar(
                          radius: 24,
                          backgroundColor: Color(0xFFEAF7F0),
                          child: Icon(Icons.account_balance_outlined,
                              color: Color(0xFF08783E)),
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: Text(
                            _text(details['name'], 'Organization details'),
                            style: const TextStyle(
                              fontSize: 21,
                              fontWeight: FontWeight.w900,
                            ),
                          ),
                        ),
                        _status(status),
                      ],
                    ),
                    const SizedBox(height: 18),
                    _detailRow('Type', _text(details['organizationType'])
                        .replaceAll('_', ' ')),
                    _detailRow('Registration number',
                        _text(details['registrationNumber'], 'Not supplied')),
                    _detailRow('Contact person', _text(details['contactName'])),
                    _detailRow('Phone', _text(details['phone'])),
                    _detailRow('Email', _text(details['email'])),
                    _detailRow('Address', _text(details['address'])),
                    _detailRow('State / LGA',
                        '${_text(details['state'])} / ${_text(details['lga'], '—')}'),
                    _detailRow('Description',
                        _text(details['description'], 'No description supplied.')),
                    _detailRow(
                      'Owner',
                      _text(owner['fullName'], 'Unknown owner'),
                    ),
                    _detailRow(
                      'Owner contact',
                      '${_text(owner['phone'])} • ${_text(owner['email'])}',
                    ),
                    _detailRow('Created', _formatDate(details['createdAt'])),
                    _detailRow(
                      'Verified by',
                      _text(verifier['fullName'], 'Not verified'),
                    ),
                    if (_text(verification['rejectionReason']).isNotEmpty)
                      _detailRow(
                        'Rejection reason',
                        _text(verification['rejectionReason']),
                      ),
                    const SizedBox(height: 16),
                    Wrap(
                      spacing: 8,
                      runSpacing: 8,
                      children: <Widget>[
                        if (status == 'PENDING')
                          FilledButton.icon(
                            onPressed: () {
                              Navigator.of(sheetContext).pop();
                              _organizationStatus(details, 'ACTIVE');
                            },
                            icon: const Icon(Icons.verified_outlined),
                            label: const Text('Approve / verify'),
                          ),
                        if (status == 'PENDING')
                          OutlinedButton.icon(
                            onPressed: () {
                              Navigator.of(sheetContext).pop();
                              _organizationStatus(details, 'REJECTED');
                            },
                            icon: const Icon(Icons.close_rounded),
                            label: const Text('Reject'),
                          ),
                        if (status == 'ACTIVE')
                          OutlinedButton.icon(
                            onPressed: () {
                              Navigator.of(sheetContext).pop();
                              _organizationStatus(details, 'SUSPENDED');
                            },
                            icon: const Icon(Icons.pause_circle_outline),
                            label: const Text('Suspend'),
                          ),
                        if (status == 'SUSPENDED')
                          FilledButton.icon(
                            onPressed: () {
                              Navigator.of(sheetContext).pop();
                              _organizationStatus(details, 'ACTIVE');
                            },
                            icon: const Icon(Icons.play_circle_outline),
                            label: const Text('Reactivate'),
                          ),
                      ],
                    ),
                  ],
                ),
              ),
            ),
          );
        },
      );
    } on EmpowermentApiException catch (error) {
      _notice(error.message, error: true);
    }
  }

  Widget _detailRow(String label, String value) => Padding(
        padding: const EdgeInsets.only(bottom: 10),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            SizedBox(
              width: 132,
              child: Text(
                label,
                style: const TextStyle(
                  color: Color(0xFF667085),
                  fontSize: 12,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
            Expanded(
              child: Text(
                value,
                style: const TextStyle(fontWeight: FontWeight.w600),
              ),
            ),
          ],
        ),
      );

  String _formatDate(dynamic value) {
    final String raw = _text(value);
    if (raw.isEmpty) return 'Unknown';
    return raw.replaceFirst('T', ' ').split('.').first;
  }

  Future<void> _programStatus(
    Map<String, dynamic> program,
    String status,
  ) async {
    try {
      await _api.patch(
        '/programs/${_id(program)}/status',
        body: <String, dynamic>{'status': status},
      );
      _notice('Program marked ${status.toLowerCase()}.');
      await _load();
    } on EmpowermentApiException catch (error) {
      _notice(error.message, error: true);
    }
  }

  Future<void> _createProgram() async {
    if (_eligibleOrganizations.isEmpty) {
      _notice(
        'No active verified organizations are available for a program.',
        error: true,
      );
      return;
    }

    final TextEditingController name = TextEditingController();
    final TextEditingController description = TextEditingController();
    final TextEditingController amount = TextEditingController();
    final TextEditingController beneficiaries = TextEditingController();
    final TextEditingController state = TextEditingController();
    final GlobalKey<FormState> formKey = GlobalKey<FormState>();
    String organizationId = _id(_eligibleOrganizations.first);
    final bool? submitted = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      builder: (BuildContext sheetContext) => StatefulBuilder(
        builder: (BuildContext context, StateSetter setSheetState) => Padding(
          padding: EdgeInsets.only(
            left: 20,
            right: 20,
            top: 20,
            bottom: MediaQuery.viewInsetsOf(sheetContext).bottom + 24,
          ),
          child: Form(
            key: formKey,
            child: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  const Text(
                    'Create program',
                    style: TextStyle(fontSize: 21, fontWeight: FontWeight.w900),
                  ),
                  const SizedBox(height: 6),
                  const Text(
                    'Only active, verified organizations are available here.',
                    style: TextStyle(color: Color(0xFF667085)),
                  ),
                  const SizedBox(height: 16),
                  DropdownButtonFormField<String>(
                    value: organizationId,
                    decoration:
                        const InputDecoration(labelText: 'Organization'),
                    items: _eligibleOrganizations
                        .map(
                          (Map<String, dynamic> item) =>
                              DropdownMenuItem<String>(
                            value: _id(item),
                            child: Text(_text(item['name'])),
                          ),
                        )
                        .toList(),
                    onChanged: (String? value) => setSheetState(
                      () => organizationId = value ?? organizationId,
                    ),
                  ),
                  _formField(name, 'Program name'),
                  _formField(description, 'Description', required: false, lines: 3),
                  _formField(amount, 'Amount per beneficiary',
                      keyboard: TextInputType.number),
                  _formField(beneficiaries, 'Number of beneficiaries',
                      keyboard: TextInputType.number),
                  _formField(state, 'State'),
                  const SizedBox(height: 8),
                  SizedBox(
                    width: double.infinity,
                    child: FilledButton(
                      onPressed: () {
                        if (formKey.currentState?.validate() == true) {
                          Navigator.of(sheetContext).pop(true);
                        }
                      },
                      child: const Text('Create draft program'),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );

    if (submitted == true) {
      try {
        await _api.post(
          '/programs',
          body: <String, dynamic>{
            'organizationId': organizationId,
            'name': name.text.trim(),
            'description': description.text.trim(),
            'amountPerBeneficiary': amount.text.trim(),
            'targetBeneficiaries': beneficiaries.text.trim(),
            'state': state.text.trim(),
          },
        );
        _notice('Draft program created.');
        await _load();
      } on EmpowermentApiException catch (error) {
        _notice(error.message, error: true);
      }
    }
    name.dispose();
    description.dispose();
    amount.dispose();
    beneficiaries.dispose();
    state.dispose();
  }

  Widget _formField(
    TextEditingController controller,
    String label, {
    bool required = true,
    int lines = 1,
    TextInputType? keyboard,
  }) =>
      Padding(
        padding: const EdgeInsets.only(bottom: 12),
        child: TextFormField(
          controller: controller,
          maxLines: lines,
          keyboardType: keyboard,
          decoration: InputDecoration(
            labelText: label,
            border: const OutlineInputBorder(),
          ),
          validator: required
              ? (String? value) => value == null || value.trim().isEmpty
                  ? '$label is required.'
                  : null
              : null,
        ),
      );

  Future<void> _showProgram(Map<String, dynamic> program) async {
    final String programId = _id(program);
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      builder: (BuildContext sheetContext) {
        return FutureBuilder<List<Map<String, dynamic>>>(
          future: Future.wait(<Future<Map<String, dynamic>>>[
            _api.get('/programs/$programId/statistics'),
            _api.get('/programs/$programId/beneficiaries',
                query: <String, String>{'limit': '100'}),
            _api.get('/programs/$programId/report'),
          ]),
          builder: (BuildContext context,
              AsyncSnapshot<List<Map<String, dynamic>>> snapshot) {
            if (snapshot.connectionState != ConnectionState.done) {
              return const SizedBox(
                height: 280,
                child: Center(child: CircularProgressIndicator()),
              );
            }
            if (snapshot.hasError || snapshot.data == null) {
              return const SizedBox(
                height: 220,
                child: Center(child: Text('Unable to load program details.')),
              );
            }
            final Map<String, dynamic> statistics =
                snapshot.data![0]['statistics'] is Map
                    ? Map<String, dynamic>.from(
                        snapshot.data![0]['statistics'] as Map)
                    : <String, dynamic>{};
            final List<Map<String, dynamic>> beneficiaries =
                _list(snapshot.data![1], 'beneficiaries');
            final Map<String, dynamic> report =
                snapshot.data![2]['report'] is Map
                    ? Map<String, dynamic>.from(
                        snapshot.data![2]['report'] as Map)
                    : <String, dynamic>{};
            final Map<String, dynamic> financials =
                report['financials'] is Map
                    ? Map<String, dynamic>.from(report['financials'] as Map)
                    : <String, dynamic>{};

            return SafeArea(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(20, 20, 20, 28),
                child: SingleChildScrollView(
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: <Widget>[
                      Text(
                        _text(program['name']),
                        style: const TextStyle(
                          fontSize: 21,
                          fontWeight: FontWeight.w900,
                        ),
                      ),
                      const SizedBox(height: 12),
                      Wrap(
                        spacing: 8,
                        runSpacing: 8,
                        children: <Widget>[
                          _metric('Approved', statistics['approved']),
                          _metric('Paid', statistics['paid']),
                          _metric('Funded', financials['totalFunded']),
                          _metric('Disbursed', financials['totalDisbursed']),
                        ],
                      ),
                      const SizedBox(height: 18),
                      const Text(
                        'Beneficiaries',
                        style: TextStyle(fontWeight: FontWeight.w900),
                      ),
                      const SizedBox(height: 8),
                      if (beneficiaries.isEmpty)
                        const Text('No beneficiaries found.')
                      else
                        ...beneficiaries.map(
                          (Map<String, dynamic> beneficiary) => Card(
                            child: ListTile(
                              title: Text(_text(beneficiary['fullName'])),
                              subtitle: Text(
                                '${_text(beneficiary['phone'])} • '
                                '${_text(beneficiary['verificationStatus'], 'PENDING')}',
                              ),
                              trailing: PopupMenuButton<String>(
                                onSelected: (String value) =>
                                    _beneficiaryStatus(beneficiary, value),
                                itemBuilder: (_) => const <PopupMenuEntry<String>>[
                                  PopupMenuItem(
                                      value: 'VERIFIED',
                                      child: Text('Verify')),
                                  PopupMenuItem(
                                      value: 'APPROVED',
                                      child: Text('Approve')),
                                  PopupMenuItem(
                                      value: 'REJECTED',
                                      child: Text('Reject')),
                                ],
                              ),
                            ),
                          ),
                        ),
                    ],
                  ),
                ),
              ),
            );
          },
        );
      },
    );
  }

  Future<void> _beneficiaryStatus(
    Map<String, dynamic> beneficiary,
    String status,
  ) async {
    try {
      final Map<String, dynamic> body = <String, dynamic>{
        if (status == 'VERIFIED') 'status': 'UNDER_REVIEW',
        if (status == 'VERIFIED') 'verificationStatus': 'VERIFIED',
        if (status != 'VERIFIED') 'status': status,
        if (status == 'REJECTED') 'rejectionReason': 'Not eligible after review.',
      };
      await _api.patch('/beneficiaries/${_id(beneficiary)}/status', body: body);
      _notice('Beneficiary updated.');
      await _load();
    } on EmpowermentApiException catch (error) {
      _notice(error.message, error: true);
    }
  }

  Widget _metric(String label, dynamic value) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 9),
        decoration: BoxDecoration(
          color: const Color(0xFFEAF7F0),
          borderRadius: BorderRadius.circular(12),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Text(label,
                style: const TextStyle(fontSize: 10, color: Color(0xFF557064))),
            Text(_text(value, '0'),
                style: const TextStyle(fontWeight: FontWeight.w900)),
          ],
        ),
      );

  Widget _status(String value) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 5),
        decoration: BoxDecoration(
          color: const Color(0xFFEAF7F0),
          borderRadius: BorderRadius.circular(18),
        ),
        child: Text(
          value.replaceAll('_', ' '),
          style: const TextStyle(
            color: Color(0xFF08783E),
            fontSize: 10,
            fontWeight: FontWeight.w800,
          ),
        ),
      );

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF7F9F8),
      appBar: AppBar(
        title: const Text('Empowerment Admin'),
        backgroundColor: const Color(0xFF08783E),
        foregroundColor: Colors.white,
        actions: <Widget>[
          IconButton(
            tooltip: 'Create program',
            onPressed: _loading ? null : _createProgram,
            icon: const Icon(Icons.add_circle_outline),
          ),
          IconButton(
            tooltip: 'Refresh',
            onPressed: _loading ? null : _load,
            icon: const Icon(Icons.refresh_rounded),
          ),
        ],
        bottom: TabBar(
          controller: _tabs,
          isScrollable: true,
          tabs: const <Tab>[
            Tab(text: 'Overview'),
            Tab(text: 'Organizations'),
            Tab(text: 'Programs'),
            Tab(text: 'Audit'),
          ],
        ),
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error.isNotEmpty
              ? Center(
                  child: Padding(
                    padding: const EdgeInsets.all(28),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: <Widget>[
                        const Icon(Icons.admin_panel_settings_outlined, size: 50),
                        const SizedBox(height: 12),
                        Text(_error, textAlign: TextAlign.center),
                        const SizedBox(height: 12),
                        OutlinedButton(onPressed: _load, child: const Text('Retry')),
                      ],
                    ),
                  ),
                )
              : TabBarView(
                  controller: _tabs,
                  children: <Widget>[
                    _overview(),
                    _organizationsView(),
                    _programsView(),
                    _auditView(),
                  ],
                ),
    );
  }

  Widget _overview() {
    final dynamic beneficiaries = _summary['beneficiaries'];
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.all(18),
        children: <Widget>[
          const Text(
            'Empowerment control centre',
            style: TextStyle(fontSize: 22, fontWeight: FontWeight.w900),
          ),
          const SizedBox(height: 6),
          const Text(
            'Review organizations, programs, beneficiary verification and audited payouts.',
            style: TextStyle(color: Color(0xFF667085)),
          ),
          const SizedBox(height: 18),
          Wrap(
            spacing: 10,
            runSpacing: 10,
            children: <Widget>[
              _metric('Organizations', _summary['organizations']),
              _metric('Programs', _summary['programs']),
              _metric('Total funded', _summary['totalFunded']),
              _metric('Total disbursed', _summary['totalDisbursed']),
              _metric('Paid recipients', _summary['paidBeneficiaries']),
              _metric('Beneficiary states',
                  beneficiaries is List ? beneficiaries.length : 0),
            ],
          ),
          const SizedBox(height: 24),
          const Text(
            'Operational safeguards',
            style: TextStyle(fontWeight: FontWeight.w900, fontSize: 16),
          ),
          const SizedBox(height: 10),
          const Card(
            child: Padding(
              padding: EdgeInsets.all(16),
              child: Text(
                'Funding requires the funder’s transaction PIN and an idempotency key. '
                'Payouts only include approved, verified, active ServicePay wallets and '
                'are recorded with immutable ledger entries and unique transaction references.',
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _organizationsView() => ListView(
        padding: const EdgeInsets.all(16),
        children: _organizations
            .map(
              (Map<String, dynamic> organization) => Card(
                child: ListTile(
                  leading: const Icon(Icons.account_balance_outlined,
                      color: Color(0xFF08783E)),
                  title: Text(_text(organization['name'])),
                  subtitle: Text(
                    '${_text(organization['organizationType']).replaceAll('_', ' ')}\n'
                    '${_text(organization['contactName'])} • ${_text(organization['state'])}',
                  ),
                  isThreeLine: true,
                  onTap: () => _showOrganization(organization),
                  trailing: PopupMenuButton<String>(
                    child: _status(_text(organization['status'], 'PENDING')),
                    onSelected: (String status) =>
                        _organizationStatus(organization, status),
                    itemBuilder: (_) => const <PopupMenuEntry<String>>[
                      PopupMenuItem(value: 'ACTIVE', child: Text('Verify / activate')),
                      PopupMenuItem(value: 'REJECTED', child: Text('Reject')),
                      PopupMenuItem(value: 'SUSPENDED', child: Text('Suspend')),
                    ],
                  ),
                ),
              ),
            )
            .toList(),
      );

  Widget _programsView() => ListView(
        padding: const EdgeInsets.all(16),
        children: _programs
            .map(
              (Map<String, dynamic> program) => Card(
                child: ListTile(
                  leading: const Icon(Icons.volunteer_activism_outlined,
                      color: Color(0xFF08783E)),
                  title: Text(_text(program['name'])),
                  subtitle: Text(
                    'Budget: ₦${_text(program['totalBudget'], '0')} • '
                    '${_text(program['state'])}',
                  ),
                  onTap: () => _showProgram(program),
                  trailing: PopupMenuButton<String>(
                    child: _status(_text(program['status'], 'DRAFT')),
                    onSelected: (String status) => _programStatus(program, status),
                    itemBuilder: (_) => const <PopupMenuEntry<String>>[
                      PopupMenuItem(value: 'APPROVED', child: Text('Approve')),
                      PopupMenuItem(value: 'OPEN', child: Text('Open')),
                      PopupMenuItem(value: 'SUSPENDED', child: Text('Suspend')),
                      PopupMenuItem(value: 'CANCELLED', child: Text('Close / cancel')),
                    ],
                  ),
                ),
              ),
            )
            .toList(),
      );

  Widget _auditView() => ListView(
        padding: const EdgeInsets.all(16),
        children: _audit.isEmpty
            ? const <Widget>[
                Center(child: Padding(
                  padding: EdgeInsets.all(28),
                  child: Text('No Empowerment audit events recorded yet.'),
                )),
              ]
            : _audit
                .map(
                  (Map<String, dynamic> item) => Card(
                    child: ListTile(
                      leading: const Icon(Icons.history_rounded,
                          color: Color(0xFF08783E)),
                      title: Text(_text(item['action']).replaceAll('_', ' ')),
                      subtitle: Text(
                        '${_text(item['entityType'])} • ${_text(item['reference'])}',
                      ),
                      trailing: Text(
                        _text(item['createdAt']).replaceFirst('T', '\n').split('.').first,
                        textAlign: TextAlign.end,
                        style: const TextStyle(fontSize: 10),
                      ),
                    ),
                  ),
                )
                .toList(),
      );
}
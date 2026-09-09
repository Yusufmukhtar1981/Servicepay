import 'package:flutter/material.dart';

import 'services/empowerment_api_service.dart';

class ProgramSponsorScreen extends StatefulWidget {
  const ProgramSponsorScreen({super.key});

  @override
  State<ProgramSponsorScreen> createState() => _ProgramSponsorScreenState();
}

class _ProgramSponsorScreenState extends State<ProgramSponsorScreen> {
  final EmpowermentApiService _api = EmpowermentApiService();

  bool _loading = true;
  String _error = '';
  List<Map<String, dynamic>> _organizations = <Map<String, dynamic>>[];
  List<Map<String, dynamic>> _programs = <Map<String, dynamic>>[];
  Map<String, dynamic> _summary = <String, dynamic>{};

  @override
  void initState() {
    super.initState();
    _load();
  }

  List<Map<String, dynamic>> _items(dynamic value) => value is List
      ? value
          .whereType<Map>()
          .map((Map item) => Map<String, dynamic>.from(item))
          .toList()
      : <Map<String, dynamic>>[];

  String _text(dynamic value, [String fallback = '']) =>
      value?.toString().trim().isNotEmpty == true
          ? value.toString().trim()
          : fallback;

  String _id(Map<String, dynamic> item) =>
      _text(item['_id'] ?? item['id']);

  double _number(dynamic value) => double.tryParse('$value') ?? 0;

  String _money(dynamic value) => '₦${_number(value).toStringAsFixed(2)}';

  Future<void> _load() async {
    if (mounted) {
      setState(() {
        _loading = true;
        _error = '';
      });
    }
    try {
      final Map<String, dynamic> response =
          await _api.get('/sponsor/dashboard');
      if (!mounted) return;
      setState(() {
        _organizations = _items(response['organizations']);
        _programs = _items(response['programs']);
        _summary = response['summary'] is Map
            ? Map<String, dynamic>.from(response['summary'] as Map)
            : <String, dynamic>{};
        _loading = false;
      });
    } on EmpowermentApiException catch (error) {
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
          _error = 'Unable to load Program Sponsor right now.';
        });
      }
    }
  }

  void _notice(String message, {bool error = false}) {
    if (!mounted) return;
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(
        SnackBar(
          content: Text(message),
          backgroundColor:
              error ? const Color(0xFFB42318) : const Color(0xFF08783E),
        ),
      );
  }

  String _verificationStatus(Map<String, dynamic> organization) {
    final String explicit = _text(
      organization['sponsorVerificationStatus'] ??
          organization['verificationStatus'],
    ).toUpperCase();
    if (explicit.isNotEmpty) return explicit;
    switch (_text(organization['status']).toUpperCase()) {
      case 'ACTIVE':
        return 'VERIFIED';
      case 'PENDING':
        return 'PENDING_VERIFICATION';
      default:
        return _text(organization['status'], 'DRAFT').toUpperCase();
    }
  }

  bool _isVerified(Map<String, dynamic> organization) =>
      _verificationStatus(organization) == 'VERIFIED';

  Future<void> _createOrganization() async {
    final GlobalKey<FormState> formKey = GlobalKey<FormState>();
    final Map<String, TextEditingController> fields =
        <String, TextEditingController>{
      for (final String key in <String>[
        'name',
        'registrationNumber',
        'contactName',
        'phone',
        'email',
        'address',
        'state',
        'description',
      ])
        key: TextEditingController(),
    };
    String organizationType = 'NGO';

    final bool? submit = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      builder: (BuildContext sheetContext) => StatefulBuilder(
        builder: (BuildContext context, StateSetter setSheetState) => Padding(
          padding: EdgeInsets.fromLTRB(
            20,
            20,
            20,
            MediaQuery.viewInsetsOf(sheetContext).bottom + 24,
          ),
          child: Form(
            key: formKey,
            child: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  const Text('Register organization',
                      style: TextStyle(
                          fontSize: 22, fontWeight: FontWeight.w900)),
                  const SizedBox(height: 6),
                  const Text(
                    'ServicePay administration will verify the sponsor before program creation is unlocked.',
                    style: TextStyle(color: Color(0xFF667085)),
                  ),
                  const SizedBox(height: 18),
                  _field(fields['name']!, 'Organization name'),
                  DropdownButtonFormField<String>(
                    value: organizationType,
                    decoration:
                        const InputDecoration(labelText: 'Organization type'),
                    items: const <String>[
                      'GOVERNMENT',
                      'NGO',
                      'COMPANY',
                      'COOPERATIVE',
                      'FOUNDATION',
                      'ASSOCIATION',
                      'INDIVIDUAL',
                      'POLITICIAN',
                      'OTHER',
                    ]
                        .map((String value) => DropdownMenuItem<String>(
                            value: value,
                            child: Text(value.replaceAll('_', ' '))))
                        .toList(),
                    onChanged: (String? value) => setSheetState(
                        () => organizationType = value ?? organizationType),
                  ),
                  _field(fields['registrationNumber']!, 'Registration number',
                      required: false),
                  _field(fields['contactName']!, 'Contact person'),
                  _field(fields['phone']!, 'Phone',
                      keyboard: TextInputType.phone),
                  _field(fields['email']!, 'Email',
                      keyboard: TextInputType.emailAddress),
                  _field(fields['address']!, 'Address', lines: 2),
                  _field(fields['state']!, 'State'),
                  _field(fields['description']!, 'Description',
                      lines: 3, required: false),
                  const SizedBox(height: 8),
                  SizedBox(
                    width: double.infinity,
                    child: FilledButton(
                      onPressed: () {
                        if (formKey.currentState?.validate() == true) {
                          Navigator.of(sheetContext).pop(true);
                        }
                      },
                      child: const Text('Submit for verification'),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
    if (submit == true) {
      try {
        await _api.post('/organizations', body: <String, dynamic>{
          for (final MapEntry<String, TextEditingController> field
              in fields.entries)
            field.key: field.value.text.trim(),
          'organizationType': organizationType,
        });
        _notice('Organization submitted for verification.');
        await _load();
      } on EmpowermentApiException catch (error) {
        _notice(error.message, error: true);
      }
    }
    for (final TextEditingController controller in fields.values) {
      controller.dispose();
    }
  }

  Future<void> _createProgram() async {
    final List<Map<String, dynamic>> eligible =
        _organizations.where(_isVerified).toList();
    if (eligible.isEmpty) {
      _notice(
        'Your organization must be VERIFIED before you can create a program.',
        error: true,
      );
      return;
    }
    final GlobalKey<FormState> formKey = GlobalKey<FormState>();
    final Map<String, TextEditingController> fields =
        <String, TextEditingController>{
      for (final String key in <String>[
        'name',
        'description',
        'amountPerBeneficiary',
        'targetBeneficiaries',
        'state',
        'eligibilityRequirements',
        'applicationDeadline',
      ])
        key: TextEditingController(),
    };
    String organizationId = _id(eligible.first);
    String targetGroup = 'GENERAL';
    bool acceptsPublicApplications = true;

    final bool? submit = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      builder: (BuildContext sheetContext) => StatefulBuilder(
        builder: (BuildContext context, StateSetter setSheetState) => Padding(
          padding: EdgeInsets.fromLTRB(
            20,
            20,
            20,
            MediaQuery.viewInsetsOf(sheetContext).bottom + 24,
          ),
          child: Form(
            key: formKey,
            child: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: <Widget>[
                  const Text('Create program',
                      style: TextStyle(
                          fontSize: 22, fontWeight: FontWeight.w900)),
                  const SizedBox(height: 16),
                  DropdownButtonFormField<String>(
                    value: organizationId,
                    decoration:
                        const InputDecoration(labelText: 'Verified organization'),
                    items: eligible
                        .map((Map<String, dynamic> organization) =>
                            DropdownMenuItem<String>(
                              value: _id(organization),
                              child: Text(_text(organization['name'])),
                            ))
                        .toList(),
                    onChanged: (String? value) => setSheetState(
                        () => organizationId = value ?? organizationId),
                  ),
                  _field(fields['name']!, 'Program name'),
                  _field(fields['description']!, 'Program description', lines: 3),
                  DropdownButtonFormField<String>(
                    value: targetGroup,
                    decoration: const InputDecoration(labelText: 'Program category'),
                    items: const <String>[
                      'GENERAL',
                      'YOUTH',
                      'WOMEN',
                      'FARMERS',
                      'STUDENTS',
                      'TRADERS',
                      'ARTISANS',
                      'OTHER',
                    ]
                        .map((String value) => DropdownMenuItem<String>(
                            value: value,
                            child: Text(value.replaceAll('_', ' '))))
                        .toList(),
                    onChanged: (String? value) =>
                        setSheetState(() => targetGroup = value ?? targetGroup),
                  ),
                  _field(fields['amountPerBeneficiary']!, 'Benefit amount',
                      keyboard: TextInputType.number),
                  _field(fields['targetBeneficiaries']!, 'Target beneficiaries',
                      keyboard: TextInputType.number),
                  _field(fields['state']!, 'State (use Nationwide for all states)'),
                  _field(fields['eligibilityRequirements']!,
                      'Eligibility requirements',
                      lines: 3, required: false),
                  _field(fields['applicationDeadline']!,
                      'Application deadline (YYYY-MM-DD)',
                      required: false),
                  SwitchListTile.adaptive(
                    contentPadding: EdgeInsets.zero,
                    value: acceptsPublicApplications,
                    title: const Text('Accept customer applications'),
                    onChanged: (bool value) =>
                        setSheetState(() => acceptsPublicApplications = value),
                  ),
                  SizedBox(
                    width: double.infinity,
                    child: FilledButton(
                      onPressed: () {
                        if (formKey.currentState?.validate() == true) {
                          Navigator.of(sheetContext).pop(true);
                        }
                      },
                      child: const Text('Save draft'),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
    if (submit == true) {
      try {
        await _api.post('/programs', body: <String, dynamic>{
          'organizationId': organizationId,
          'name': fields['name']!.text.trim(),
          'description': fields['description']!.text.trim(),
          'targetGroup': targetGroup,
          'amountPerBeneficiary': fields['amountPerBeneficiary']!.text.trim(),
          'targetBeneficiaries': fields['targetBeneficiaries']!.text.trim(),
          'state': fields['state']!.text.trim(),
          'eligibilityRequirements': fields['eligibilityRequirements']!.text.trim(),
          'applicationDeadline': fields['applicationDeadline']!.text.trim(),
          'publicApplicationEnabled': acceptsPublicApplications,
        });
        _notice('Draft saved. Submit it for Head Office approval when ready.');
        await _load();
      } on EmpowermentApiException catch (error) {
        _notice(error.message, error: true);
      }
    }
    for (final TextEditingController controller in fields.values) {
      controller.dispose();
    }
  }

  Future<void> _submitForReview(Map<String, dynamic> program) async {
    try {
      await _api.patch('/programs/${_id(program)}/status',
          body: const <String, dynamic>{'status': 'UNDER_REVIEW'});
        _notice('Program submitted to ServicePay administration for approval.');
      await _load();
    } on EmpowermentApiException catch (error) {
      _notice(error.message, error: true);
    }
  }

  Widget _field(
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

  Widget _statusChip(String value) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 5),
        decoration: BoxDecoration(
          color: const Color(0xFFEAF7F0),
          borderRadius: BorderRadius.circular(20),
        ),
        child: Text(value.replaceAll('_', ' '),
            style: const TextStyle(
              color: Color(0xFF08783E),
              fontSize: 10,
              fontWeight: FontWeight.w800,
            )),
      );

  Widget _metric(String label, dynamic value) => Expanded(
        child: Container(
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(14),
            border: Border.all(color: const Color(0xFFE4ECE6)),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Text(label,
                  style: const TextStyle(
                      color: Color(0xFF667085), fontSize: 11)),
              const SizedBox(height: 4),
              Text(_text(value, '0'),
                  style: const TextStyle(fontWeight: FontWeight.w900)),
            ],
          ),
        ),
      );

  Widget _organizationCard(Map<String, dynamic> organization) {
    final String status = _verificationStatus(organization);
    return Card(
      margin: const EdgeInsets.only(bottom: 10),
      elevation: 0,
      child: ListTile(
        leading: const CircleAvatar(
          backgroundColor: Color(0xFFEAF7F0),
          child: Icon(Icons.account_balance_outlined, color: Color(0xFF08783E)),
        ),
        title: Text(_text(organization['name'])),
        subtitle: Text(
          '${_text(organization['organizationType']).replaceAll('_', ' ')} · ${_text(organization['state'], 'Nigeria')}',
        ),
        trailing: _statusChip(status),
      ),
    );
  }

  Widget _programCard(Map<String, dynamic> program) {
    final Map<String, dynamic> financials = program['financials'] is Map
        ? Map<String, dynamic>.from(program['financials'] as Map)
        : <String, dynamic>{};
    final Map<String, dynamic> activity = program['activity'] is Map
        ? Map<String, dynamic>.from(program['activity'] as Map)
        : <String, dynamic>{};
    final bool draft = _text(program['status']).toUpperCase() == 'DRAFT';
    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      elevation: 0,
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Row(
              children: <Widget>[
                const CircleAvatar(
                  backgroundColor: Color(0xFFEAF7F0),
                  child: Icon(Icons.workspace_premium_outlined,
                      color: Color(0xFF08783E)),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Text(_text(program['name']),
                      style: const TextStyle(
                          fontSize: 16, fontWeight: FontWeight.w900)),
                ),
                _statusChip(_text(program['status'], 'DRAFT')),
              ],
            ),
            const SizedBox(height: 12),
            Text(
              '${_money(program['amountPerBeneficiary'])} benefit · ${_text(program['state'], 'Nationwide')}',
              style: const TextStyle(
                  color: Color(0xFF08783E), fontWeight: FontWeight.w800),
            ),
            const SizedBox(height: 12),
            Row(
              children: <Widget>[
                _metric('Funded', _money(financials['totalFunded'])),
                const SizedBox(width: 8),
                _metric('Disbursed', _money(financials['totalDisbursed'])),
                const SizedBox(width: 8),
                _metric('Remaining', _money(financials['remainingBalance'])),
              ],
            ),
            const SizedBox(height: 10),
            Text(
              '${_text(activity['applications'], '0')} applications · ${_text(activity['beneficiaries'], '0')} beneficiaries · ${_text(activity['paid'], '0')} paid',
              style: const TextStyle(color: Color(0xFF667085)),
            ),
            if (draft) ...<Widget>[
              const SizedBox(height: 10),
              Align(
                alignment: Alignment.centerRight,
                child: FilledButton.tonal(
                  onPressed: () => _submitForReview(program),
                  child: const Text('Submit for approval'),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF7F9F8),
      appBar: AppBar(
        title: const Text('Program Sponsor'),
        backgroundColor: const Color(0xFF003F26),
        foregroundColor: Colors.white,
        actions: <Widget>[
          IconButton(
            tooltip: 'Refresh',
            onPressed: _loading ? null : _load,
            icon: const Icon(Icons.refresh_rounded),
          ),
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: _loading
            ? null
            : _organizations.isEmpty
                ? _createOrganization
                : _createProgram,
        icon: Icon(_organizations.isEmpty
            ? Icons.add_business_rounded
            : Icons.add_circle_outline_rounded),
        label: Text(
            _organizations.isEmpty ? 'Register organization' : 'Create program'),
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
                        const Icon(Icons.error_outline,
                            size: 48, color: Color(0xFFB42318)),
                        const SizedBox(height: 12),
                        Text(_error, textAlign: TextAlign.center),
                        const SizedBox(height: 14),
                        OutlinedButton(
                            onPressed: _load, child: const Text('Try again')),
                      ],
                    ),
                  ),
                )
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView(
                    padding: const EdgeInsets.all(16),
                    children: <Widget>[
                      Container(
                        padding: const EdgeInsets.all(20),
                        decoration: BoxDecoration(
                          borderRadius: BorderRadius.circular(24),
                          gradient: const LinearGradient(
                            colors: <Color>[
                              Color(0xFF003F26),
                              Color(0xFF08783E),
                            ],
                          ),
                        ),
                        child: const Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: <Widget>[
                            Icon(Icons.corporate_fare_rounded,
                                color: Colors.white, size: 34),
                            SizedBox(height: 12),
                            Text('Build verified initiatives',
                                style: TextStyle(
                                    color: Colors.white,
                                    fontSize: 22,
                                    fontWeight: FontWeight.w900)),
                            SizedBox(height: 6),
                            Text(
                              'Register your organization, receive verification, then submit programs for ServicePay administration approval.',
                              style: TextStyle(
                                  color: Color(0xFFD4F5DD), height: 1.4),
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(height: 18),
                      Row(
                        children: <Widget>[
                          _metric('Total funded', _money(_summary['totalFunded'])),
                          const SizedBox(width: 8),
                          _metric('Disbursed', _money(_summary['totalDisbursed'])),
                          const SizedBox(width: 8),
                          _metric('Remaining', _money(_summary['remainingFunds'])),
                        ],
                      ),
                      const SizedBox(height: 22),
                      Row(
                        children: <Widget>[
                          const Text('Your organization',
                              style: TextStyle(
                                  fontSize: 18, fontWeight: FontWeight.w900)),
                          const Spacer(),
                          TextButton(
                              onPressed: _createOrganization,
                              child: const Text('Add organization')),
                        ],
                      ),
                      if (_organizations.isEmpty)
                        _empty(
                          'No organization registered',
                          'Register an organization to begin the sponsor verification process.',
                          _createOrganization,
                          'Register organization',
                        )
                      else
                        ..._organizations.map(_organizationCard),
                      const SizedBox(height: 16),
                      Row(
                        children: <Widget>[
                          const Text('Programs',
                              style: TextStyle(
                                  fontSize: 18, fontWeight: FontWeight.w900)),
                          const Spacer(),
                          TextButton(
                              onPressed: _createProgram,
                              child: const Text('Create program')),
                        ],
                      ),
                      if (_programs.isEmpty)
                        _empty(
                          'No programs yet',
                          'Verified organizations can create a draft and submit it for ServicePay administration approval.',
                          _createProgram,
                          'Create program',
                        )
                      else
                        ..._programs.map(_programCard),
                    ],
                  ),
                ),
    );
  }

  Widget _empty(
    String title,
    String description,
    VoidCallback action,
    String actionLabel,
  ) =>
      Container(
        padding: const EdgeInsets.all(24),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(18),
          border: Border.all(color: const Color(0xFFE4ECE6)),
        ),
        child: Column(
          children: <Widget>[
            const Icon(Icons.corporate_fare_outlined,
                size: 44, color: Color(0xFF8AA99A)),
            const SizedBox(height: 10),
            Text(title,
                style: const TextStyle(
                    fontSize: 16, fontWeight: FontWeight.w900)),
            const SizedBox(height: 6),
            Text(description,
                textAlign: TextAlign.center,
                style: const TextStyle(color: Color(0xFF667085))),
            const SizedBox(height: 14),
            OutlinedButton(onPressed: action, child: Text(actionLabel)),
          ],
        ),
      );
}
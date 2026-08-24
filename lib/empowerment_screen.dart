import 'dart:math';

import 'package:flutter/material.dart';

import 'services/empowerment_api_service.dart';

class EmpowermentScreen extends StatefulWidget {
  const EmpowermentScreen({super.key});

  @override
  State<EmpowermentScreen> createState() => _EmpowermentScreenState();
}

class _EmpowermentScreenState extends State<EmpowermentScreen>
    with SingleTickerProviderStateMixin {
  final EmpowermentApiService _api = EmpowermentApiService();
  late final TabController _tabs;

  bool _loading = true;
  String _error = '';
  List<Map<String, dynamic>> _available = <Map<String, dynamic>>[];
  List<Map<String, dynamic>> _organizations = <Map<String, dynamic>>[];
  List<Map<String, dynamic>> _eligibleOrganizations =
      <Map<String, dynamic>>[];
  List<Map<String, dynamic>> _programs = <Map<String, dynamic>>[];
  List<Map<String, dynamic>> _applications = <Map<String, dynamic>>[];

  @override
  void initState() {
    super.initState();
    _tabs = TabController(length: 3, vsync: this);
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

  double _money(dynamic value) => double.tryParse('$value') ?? 0;

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = '';
    });

    try {
      final List<Map<String, dynamic>> results =
          await Future.wait(<Future<Map<String, dynamic>>>[
        _api.get('/available-programs'),
        _api.get('/my-applications'),
      ]);
      if (!mounted) return;
      setState(() {
        _available = _list(results[0], 'programs');
        _applications = _list(results[1], 'applications');
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
        _error = 'Unable to load Empowerment right now.';
      });
    }
  }

  void _notice(String message, {bool error = false}) {
    if (!mounted) return;
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(
        SnackBar(
          content: Text(message),
          backgroundColor: error ? const Color(0xFFB42318) : const Color(0xFF08783E),
        ),
      );
  }

  Future<void> _withLoading(
    Future<void> Function() action,
  ) async {
    try {
      await action();
    } on EmpowermentApiException catch (error) {
      _notice(error.message, error: true);
    } catch (_) {
      _notice('Unable to complete this action. Please try again.', error: true);
    }
  }

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

    final bool? created = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      builder: (BuildContext sheetContext) {
        return Padding(
          padding: EdgeInsets.only(
            left: 20,
            right: 20,
            top: 18,
            bottom: MediaQuery.viewInsetsOf(sheetContext).bottom + 20,
          ),
          child: Form(
            key: formKey,
            child: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  const Text(
                    'Create organization',
                    style: TextStyle(fontSize: 21, fontWeight: FontWeight.w900),
                  ),
                  const SizedBox(height: 6),
                  const Text(
                    'Organizations are verified by ServicePay before programs can be created.',
                    style: TextStyle(color: Color(0xFF667085)),
                  ),
                  const SizedBox(height: 16),
                  _formField(fields['name']!, 'Organization name'),
                  DropdownButtonFormField<String>(
                    value: organizationType,
                    decoration: const InputDecoration(labelText: 'Organization type'),
                    items: const <String>[
                      'GOVERNMENT',
                      'NGO',
                      'COMPANY',
                      'COOPERATIVE',
                      'FOUNDATION',
                      'INDIVIDUAL',
                      'OTHER',
                    ]
                        .map(
                          (String value) => DropdownMenuItem<String>(
                            value: value,
                            child: Text(value.replaceAll('_', ' ')),
                          ),
                        )
                        .toList(),
                    onChanged: (String? value) =>
                        organizationType = value ?? organizationType,
                  ),
                  _formField(fields['registrationNumber']!, 'Registration number'),
                  _formField(fields['contactName']!, 'Contact person'),
                  _formField(fields['phone']!, 'Phone', keyboard: TextInputType.phone),
                  _formField(fields['email']!, 'Email', keyboard: TextInputType.emailAddress),
                  _formField(fields['address']!, 'Address', lines: 2),
                  _formField(fields['state']!, 'State'),
                  _formField(fields['description']!, 'Description', lines: 3, required: false),
                  const SizedBox(height: 12),
                  SizedBox(
                    width: double.infinity,
                    child: FilledButton(
                      onPressed: () {
                        if (formKey.currentState?.validate() != true) return;
                        Navigator.of(sheetContext).pop(true);
                      },
                      child: const Text('Submit for verification'),
                    ),
                  ),
                ],
              ),
            ),
          ),
        );
      },
    );

    if (created != true) {
      for (final TextEditingController controller in fields.values) {
        controller.dispose();
      }
      return;
    }

    await _withLoading(() async {
      await _api.post(
        '/organizations',
        body: <String, dynamic>{
          for (final MapEntry<String, TextEditingController> entry
              in fields.entries)
            entry.key: entry.value.text.trim(),
          'organizationType': organizationType,
        },
      );
      _notice('Organization submitted for verification.');
      await _load();
    });
    for (final TextEditingController controller in fields.values) {
      controller.dispose();
    }
  }

  Future<void> _createProgram() async {
    if (_eligibleOrganizations.isEmpty) {
      _notice('Create and verify an organization before creating a program.',
          error: true);
      return;
    }
    final GlobalKey<FormState> formKey = GlobalKey<FormState>();
    final Map<String, TextEditingController> fields =
        <String, TextEditingController>{
      for (final String key in <String>[
        'name',
        'description',
        'amount',
        'beneficiaries',
        'state',
        'requirements',
        'startDate',
        'deadline',
        'disbursementDate',
      ])
        key: TextEditingController(),
    };
    String organizationId = _id(_eligibleOrganizations.first);
    bool publicApplication = false;

    final bool? created = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      builder: (BuildContext sheetContext) {
        return StatefulBuilder(
          builder: (BuildContext context, StateSetter setSheetState) {
            return Padding(
              padding: EdgeInsets.only(
                left: 20,
                right: 20,
                top: 18,
                bottom: MediaQuery.viewInsetsOf(sheetContext).bottom + 20,
              ),
              child: Form(
                key: formKey,
                child: SingleChildScrollView(
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: <Widget>[
                      const Text(
                        'Create empowerment program',
                        style: TextStyle(fontSize: 21, fontWeight: FontWeight.w900),
                      ),
                      const SizedBox(height: 16),
                      DropdownButtonFormField<String>(
                        value: organizationId,
                        decoration: const InputDecoration(labelText: 'Organization'),
                        items: _eligibleOrganizations
                            .map(
                              (Map<String, dynamic> item) =>
                                  DropdownMenuItem<String>(
                                value: _id(item),
                                child: Text(_text(item['name'])),
                              ),
                            )
                            .toList(),
                        onChanged: (String? value) =>
                            setSheetState(() => organizationId = value ?? organizationId),
                      ),
                      _formField(fields['name']!, 'Program name'),
                      _formField(fields['description']!, 'Description', lines: 3),
                      _formField(fields['amount']!, 'Amount per beneficiary',
                          keyboard: TextInputType.number),
                      _formField(fields['beneficiaries']!, 'Number of beneficiaries',
                          keyboard: TextInputType.number),
                      _formField(fields['state']!, 'State'),
                      _formField(fields['requirements']!, 'Eligibility requirements',
                          lines: 3, required: false),
                      _formField(fields['startDate']!, 'Application start date (YYYY-MM-DD)',
                          required: false),
                      _formField(fields['deadline']!, 'Application deadline (YYYY-MM-DD)',
                          required: false),
                      _formField(fields['disbursementDate']!, 'Disbursement date (YYYY-MM-DD)',
                          required: false),
                      SwitchListTile.adaptive(
                        contentPadding: EdgeInsets.zero,
                        value: publicApplication,
                        title: const Text('Accept public applications'),
                        onChanged: (bool value) =>
                            setSheetState(() => publicApplication = value),
                      ),
                      SizedBox(
                        width: double.infinity,
                        child: FilledButton(
                          onPressed: () {
                            if (formKey.currentState?.validate() != true) return;
                            Navigator.of(sheetContext).pop(true);
                          },
                          child: const Text('Create draft program'),
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

    if (created == true) {
      await _withLoading(() async {
        await _api.post(
          '/programs',
          body: <String, dynamic>{
            'organizationId': organizationId,
            'name': fields['name']!.text.trim(),
            'description': fields['description']!.text.trim(),
            'amountPerBeneficiary': fields['amount']!.text.trim(),
            'targetBeneficiaries': fields['beneficiaries']!.text.trim(),
            'state': fields['state']!.text.trim(),
            'eligibilityRequirements': fields['requirements']!.text.trim(),
            'applicationStartDate': fields['startDate']!.text.trim(),
            'applicationDeadline': fields['deadline']!.text.trim(),
            'disbursementDate': fields['disbursementDate']!.text.trim(),
            'publicApplicationEnabled': publicApplication,
          },
        );
        _notice('Program created as a draft.');
        await _load();
      });
    }
    for (final TextEditingController controller in fields.values) {
      controller.dispose();
    }
  }

  Future<void> _apply(Map<String, dynamic> program) async {
    final TextEditingController state = TextEditingController();
    final TextEditingController lga = TextEditingController();
    final TextEditingController address = TextEditingController();
    String gender = 'PREFER_NOT_TO_SAY';
    final GlobalKey<FormState> formKey = GlobalKey<FormState>();
    final bool? confirmed = await showDialog<bool>(
      context: context,
      builder: (BuildContext dialogContext) => StatefulBuilder(
        builder: (BuildContext context, StateSetter setDialogState) =>
            AlertDialog(
          title: Text('Apply: ${_text(program['name'])}'),
          content: Form(
            key: formKey,
            child: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: <Widget>[
                  _formField(state, 'State'),
                  _formField(lga, 'LGA', required: false),
                  _formField(address, 'Address', required: false, lines: 2),
                  DropdownButtonFormField<String>(
                    value: gender,
                    decoration: const InputDecoration(labelText: 'Gender'),
                    items: const <String>[
                      'FEMALE',
                      'MALE',
                      'OTHER',
                      'PREFER_NOT_TO_SAY',
                    ]
                        .map((String item) => DropdownMenuItem<String>(
                              value: item,
                              child: Text(item.replaceAll('_', ' ')),
                            ))
                        .toList(),
                    onChanged: (String? value) =>
                        setDialogState(() => gender = value ?? gender),
                  ),
                ],
              ),
            ),
          ),
          actions: <Widget>[
            TextButton(
              onPressed: () => Navigator.of(dialogContext).pop(false),
              child: const Text('Cancel'),
            ),
            FilledButton(
              onPressed: () {
                if (formKey.currentState?.validate() == true) {
                  Navigator.of(dialogContext).pop(true);
                }
              },
              child: const Text('Submit application'),
            ),
          ],
        ),
      ),
    );

    if (confirmed == true) {
      await _withLoading(() async {
        await _api.post(
          '/programs/${_id(program)}/apply',
          body: <String, dynamic>{
            'state': state.text.trim(),
            'lga': lga.text.trim(),
            'address': address.text.trim(),
            'gender': gender,
          },
        );
        _notice('Your application was submitted for review.');
        await _load();
      });
    }
    state.dispose();
    lga.dispose();
    address.dispose();
  }

  Future<void> _addBeneficiary(Map<String, dynamic> program) async {
    final GlobalKey<FormState> formKey = GlobalKey<FormState>();
    final TextEditingController name = TextEditingController();
    final TextEditingController phone = TextEditingController();
    final TextEditingController state = TextEditingController();
    final bool? confirmed = await showDialog<bool>(
      context: context,
      builder: (BuildContext dialogContext) => AlertDialog(
        title: const Text('Add beneficiary'),
        content: Form(
          key: formKey,
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                _formField(name, 'Full name'),
                _formField(phone, 'ServicePay phone', keyboard: TextInputType.phone),
                _formField(state, 'State'),
              ],
            ),
          ),
        ),
        actions: <Widget>[
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () {
              if (formKey.currentState?.validate() == true) {
                Navigator.of(dialogContext).pop(true);
              }
            },
            child: const Text('Add'),
          ),
        ],
      ),
    );
    if (confirmed == true) {
      await _withLoading(() async {
        await _api.post(
          '/beneficiaries',
          body: <String, dynamic>{
            'programId': _id(program),
            'fullName': name.text.trim(),
            'phone': phone.text.trim(),
            'state': state.text.trim(),
          },
        );
        _notice('Beneficiary added for verification.');
      });
    }
    name.dispose();
    phone.dispose();
    state.dispose();
  }

  Future<void> _fundProgram(Map<String, dynamic> program) async {
    final TextEditingController amount = TextEditingController();
    final TextEditingController pin = TextEditingController();
    final GlobalKey<FormState> formKey = GlobalKey<FormState>();
    final bool? confirmed = await showDialog<bool>(
      context: context,
      builder: (BuildContext dialogContext) => AlertDialog(
        title: const Text('Fund program'),
        content: Form(
          key: formKey,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              _formField(amount, 'Amount', keyboard: TextInputType.number),
              _formField(pin, '4-digit transaction PIN',
                  keyboard: TextInputType.number, obscure: true),
            ],
          ),
        ),
        actions: <Widget>[
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () {
              if (formKey.currentState?.validate() == true) {
                Navigator.of(dialogContext).pop(true);
              }
            },
            child: const Text('Fund securely'),
          ),
        ],
      ),
    );
    if (confirmed == true) {
      await _withLoading(() async {
        final String key = _idempotencyKey('fund');
        final Map<String, dynamic> response = await _api.post(
          '/programs/${_id(program)}/funding',
          idempotencyKey: key,
          body: <String, dynamic>{
            'amount': amount.text.trim(),
            'transactionPin': pin.text.trim(),
            'idempotencyKey': key,
          },
        );
        final Map<String, dynamic>? funding = response['funding'] is Map
            ? Map<String, dynamic>.from(response['funding'] as Map)
            : null;
        _notice(
          funding == null
              ? 'Program funding completed.'
              : 'Funding completed. Ref: ${_text(funding['reference'])}',
        );
        await _load();
      });
    }
    amount.dispose();
    pin.dispose();
  }

  Future<void> _disburse(Map<String, dynamic> program) async {
    final bool? confirmed = await showDialog<bool>(
      context: context,
      builder: (BuildContext dialogContext) => AlertDialog(
        title: const Text('Confirm bulk disbursement'),
        content: const Text(
          'This will credit every approved and verified ServicePay beneficiary '
          'as one protected transaction. It cannot be undone from this screen.',
        ),
        actions: <Widget>[
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(dialogContext).pop(true),
            child: const Text('Disburse'),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    await _withLoading(() async {
      final String key = _idempotencyKey('payout');
      final Map<String, dynamic> response = await _api.post(
        '/programs/${_id(program)}/disbursements',
        idempotencyKey: key,
        body: <String, dynamic>{'idempotencyKey': key},
      );
      final Map<String, dynamic>? batch = response['batch'] is Map
          ? Map<String, dynamic>.from(response['batch'] as Map)
          : null;
      _notice(
        batch == null
            ? 'Disbursement completed.'
            : 'Disbursement completed. Ref: ${_text(batch['batchReference'])}',
      );
      await _load();
    });
  }

  String _idempotencyKey(String action) =>
      'emp-$action-${DateTime.now().microsecondsSinceEpoch}-${Random().nextInt(1 << 32)}';

  Future<void> _showProgram(Map<String, dynamic> program) async {
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      builder: (BuildContext sheetContext) => FutureBuilder<Map<String, dynamic>>(
        future: _api.get('/programs/${_id(program)}/statistics'),
        builder: (BuildContext context, AsyncSnapshot<Map<String, dynamic>> snapshot) {
          final Map<String, dynamic> statistics =
              snapshot.data?['statistics'] is Map
                  ? Map<String, dynamic>.from(snapshot.data!['statistics'] as Map)
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
                      _text(program['name'], 'Empowerment program'),
                      style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w900),
                    ),
                    const SizedBox(height: 6),
                    Text(_text(program['description'], 'No description supplied.')),
                    const SizedBox(height: 18),
                    if (snapshot.connectionState == ConnectionState.waiting)
                      const Center(child: CircularProgressIndicator())
                    else
                      Wrap(
                        spacing: 8,
                        runSpacing: 8,
                        children: <Widget>[
                          _metric('Approved', statistics['approved']),
                          _metric('Paid', statistics['paid']),
                          _metric('Funded', _currency(statistics['totalFunded'])),
                          _metric('Available', _currency(statistics['remainingProgramFunding'])),
                        ],
                      ),
                    const SizedBox(height: 20),
                    Wrap(
                      spacing: 8,
                      runSpacing: 8,
                      children: <Widget>[
                        OutlinedButton.icon(
                          onPressed: () {
                            Navigator.of(sheetContext).pop();
                            _addBeneficiary(program);
                          },
                          icon: const Icon(Icons.person_add_alt_1_outlined),
                          label: const Text('Beneficiary'),
                        ),
                        FilledButton.icon(
                          onPressed: () {
                            Navigator.of(sheetContext).pop();
                            _fundProgram(program);
                          },
                          icon: const Icon(Icons.account_balance_wallet_outlined),
                          label: const Text('Fund'),
                        ),
                        FilledButton.icon(
                          style: FilledButton.styleFrom(
                            backgroundColor: const Color(0xFF003F26),
                          ),
                          onPressed: () {
                            Navigator.of(sheetContext).pop();
                            _disburse(program);
                          },
                          icon: const Icon(Icons.send_rounded),
                          label: const Text('Disburse'),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ),
          );
        },
      ),
    );
  }

  Future<void> _showApplicantProgram(Map<String, dynamic> program) {
    final Map<String, dynamic> organization = program['organization'] is Map
        ? Map<String, dynamic>.from(program['organization'] as Map)
        : <String, dynamic>{};
    final String location = _text(program['state']).isEmpty
        ? 'Nationwide'
        : _text(program['state']);
    final String deadline = _text(
      program['endDate'] ?? program['applicationDeadline'],
      'No deadline published',
    );
    return showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      builder: (BuildContext sheetContext) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(20, 20, 20, 28),
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Text(
                  _text(program['name'], 'Empowerment program'),
                  style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w900),
                ),
                const SizedBox(height: 8),
                _chip(_text(program['status'], 'OPEN')),
                const SizedBox(height: 18),
                _detailRow('Sponsor', _text(organization['name'], 'Verified sponsor')),
                _detailRow('Category', _text(program['targetGroup'], 'GENERAL').replaceAll('_', ' ')),
                _detailRow('Location', location),
                _detailRow('Benefit', _currency(program['amountPerBeneficiary'])),
                _detailRow('Application deadline', deadline),
                if (_text(program['eligibilityRequirements']).isNotEmpty) ...<Widget>[
                  const SizedBox(height: 16),
                  const Text('Eligibility requirements',
                      style: TextStyle(fontWeight: FontWeight.w800)),
                  const SizedBox(height: 6),
                  Text(_text(program['eligibilityRequirements'])),
                ],
                if (_text(program['description']).isNotEmpty) ...<Widget>[
                  const SizedBox(height: 16),
                  const Text('About this program',
                      style: TextStyle(fontWeight: FontWeight.w800)),
                  const SizedBox(height: 6),
                  Text(_text(program['description'])),
                ],
                const SizedBox(height: 22),
                SizedBox(
                  width: double.infinity,
                  child: FilledButton(
                    onPressed: () {
                      Navigator.of(sheetContext).pop();
                      _apply(program);
                    },
                    child: const Text('Apply now'),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _detailRow(String label, String value) => Padding(
        padding: const EdgeInsets.only(bottom: 10),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            SizedBox(
              width: 138,
              child: Text(label, style: const TextStyle(color: Color(0xFF667085))),
            ),
            Expanded(
              child: Text(value, style: const TextStyle(fontWeight: FontWeight.w700)),
            ),
          ],
        ),
      );

  Widget _formField(
    TextEditingController controller,
    String label, {
    bool required = true,
    int lines = 1,
    bool obscure = false,
    TextInputType? keyboard,
  }) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: TextFormField(
        controller: controller,
        maxLines: obscure ? 1 : lines,
        obscureText: obscure,
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
  }

  Widget _metric(String label, dynamic value) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
        decoration: BoxDecoration(
          color: const Color(0xFFEAF7F0),
          borderRadius: BorderRadius.circular(14),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Text(label, style: const TextStyle(fontSize: 11, color: Color(0xFF557064))),
            Text(_text(value, '0'),
                style: const TextStyle(fontWeight: FontWeight.w900)),
          ],
        ),
      );

  String _currency(dynamic value) => '₦${_money(value).toStringAsFixed(2)}';

  Widget _chip(String value) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 5),
        decoration: BoxDecoration(
          color: const Color(0xFFEAF7F0),
          borderRadius: BorderRadius.circular(20),
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

  Widget _programCard(
    Map<String, dynamic> program, {
    bool canApply = false,
  }) {
    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      elevation: 0,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(18),
        side: const BorderSide(color: Color(0xFFE4ECE6)),
      ),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Row(
              children: <Widget>[
                const CircleAvatar(
                  backgroundColor: Color(0xFFEAF7F0),
                  child: Icon(Icons.volunteer_activism_outlined,
                      color: Color(0xFF08783E)),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Text(
                    _text(program['name'], 'Empowerment program'),
                    style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 16),
                  ),
                ),
                _chip(_text(program['status'], 'OPEN')),
              ],
            ),
            if (_text(program['description']).isNotEmpty) ...<Widget>[
              const SizedBox(height: 10),
              Text(_text(program['description']),
                  style: const TextStyle(color: Color(0xFF667085))),
            ],
            const SizedBox(height: 12),
            Text(
              '${_currency(program['amountPerBeneficiary'])} per beneficiary',
              style: const TextStyle(color: Color(0xFF08783E), fontWeight: FontWeight.w800),
            ),
            const SizedBox(height: 10),
            Row(
              children: <Widget>[
                TextButton(
                  onPressed: () => _showApplicantProgram(program),
                  child: const Text('View details'),
                ),
                const Spacer(),
                if (canApply)
                  FilledButton(
                    onPressed: () => _apply(program),
                    child: const Text('Apply'),
                  ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _organizationCard(Map<String, dynamic> organization) {
    return Card(
      margin: const EdgeInsets.only(bottom: 10),
      elevation: 0,
      child: ListTile(
        leading: const CircleAvatar(
          backgroundColor: Color(0xFFEAF7F0),
          child: Icon(Icons.account_balance_outlined, color: Color(0xFF08783E)),
        ),
        title: Text(_text(organization['name'])),
        subtitle: Text(_text(organization['organizationType']).replaceAll('_', ' ')),
        trailing: _chip(_text(organization['status'], 'PENDING')),
      ),
    );
  }

  Widget _applicationCard(Map<String, dynamic> application) {
    final Map<String, dynamic> program = application['program'] is Map
        ? Map<String, dynamic>.from(application['program'] as Map)
        : <String, dynamic>{};
    return Card(
      margin: const EdgeInsets.only(bottom: 10),
      elevation: 0,
      child: ListTile(
        leading: const CircleAvatar(
          backgroundColor: Color(0xFFEAF7F0),
          child: Icon(Icons.assignment_turned_in_outlined,
              color: Color(0xFF08783E)),
        ),
        title: Text(_text(program['name'], 'Empowerment application')),
        subtitle: Text(
          'Verification: ${_text(application['verificationStatus'], 'PENDING').replaceAll('_', ' ')}',
        ),
        trailing: _chip(_text(application['applicationStatus'], 'SUBMITTED')),
      ),
    );
  }

  Widget _benefitCard(Map<String, dynamic> application) {
    final Map<String, dynamic> program = application['program'] is Map
        ? Map<String, dynamic>.from(application['program'] as Map)
        : <String, dynamic>{};
    final bool paid =
        _text(application['applicationStatus']).toUpperCase() == 'PAID';
    return Card(
      margin: const EdgeInsets.only(bottom: 10),
      elevation: 0,
      child: ListTile(
        leading: CircleAvatar(
          backgroundColor:
              paid ? const Color(0xFFEAF7F0) : const Color(0xFFFFF7DF),
          child: Icon(
            paid ? Icons.account_balance_wallet_rounded : Icons.schedule_rounded,
            color: paid ? const Color(0xFF08783E) : const Color(0xFFB54708),
          ),
        ),
        title: Text(_text(program['name'], 'Empowerment benefit')),
        subtitle: Text(
          paid
              ? 'Payment ref: ${_text(application['paymentReference'], 'Pending reference')}'
              : 'Approved benefit: ${_currency(application['amount'] ?? program['amountPerBeneficiary'])}',
        ),
        trailing: _chip(paid ? 'PAID' : 'APPROVED'),
      ),
    );
  }

  Widget _empty(String title, String description, VoidCallback action, String label) =>
      Center(
        child: Padding(
          padding: const EdgeInsets.all(32),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              const Icon(Icons.volunteer_activism_outlined,
                  size: 48, color: Color(0xFF8AA99A)),
              const SizedBox(height: 12),
              Text(title, style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 17)),
              const SizedBox(height: 6),
              Text(description, textAlign: TextAlign.center),
              const SizedBox(height: 14),
              OutlinedButton(onPressed: action, child: Text(label)),
            ],
          ),
        ),
      );

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF7F9F8),
      appBar: AppBar(
        backgroundColor: const Color(0xFF08783E),
        foregroundColor: Colors.white,
        title: const Text('ServicePay Empowerment'),
        actions: <Widget>[
          IconButton(
            tooltip: 'Refresh',
            onPressed: _loading ? null : _load,
            icon: const Icon(Icons.refresh_rounded),
          ),
        ],
        bottom: TabBar(
          controller: _tabs,
          isScrollable: true,
          tabAlignment: TabAlignment.start,
          tabs: const <Tab>[
            Tab(text: 'Available Programs'),
            Tab(text: 'My Applications'),
            Tab(text: 'My Benefits'),
          ],
        ),
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error.isNotEmpty
              ? _empty('Unable to load Empowerment', _error, _load, 'Try again')
              : TabBarView(
                  controller: _tabs,
                  children: <Widget>[
                    RefreshIndicator(
                      onRefresh: _load,
                      child: ListView(
                        padding: const EdgeInsets.all(16),
                        children: <Widget>[
                          _hero(),
                          const SizedBox(height: 20),
                          if (_available.isEmpty)
                            _empty(
                              'No empowerment programs available yet',
                              'When a verified empowerment program opens, it will appear here.',
                              _load,
                              'Refresh',
                            )
                          else
                            ..._available.map(
                              (Map<String, dynamic> program) =>
                                  _programCard(program, canApply: true),
                            ),
                        ],
                      ),
                    ),
                    _applications.isEmpty
                        ? _empty(
                            'No applications yet',
                            'Apply to a verified opportunity to track it here.',
                            () => _tabs.animateTo(0),
                            'Browse programs',
                          )
                        : ListView(
                            padding: const EdgeInsets.all(16),
                            children: _applications
                                .map(
                                  (Map<String, dynamic> application) => _applicationCard(application),
                                )
                                .toList(),
                          ),
                    _applications
                            .where((Map<String, dynamic> item) =>
                                <String>['APPROVED', 'PAID'].contains(
                                  _text(item['applicationStatus']).toUpperCase(),
                                ))
                            .isEmpty
                        ? _empty(
                            'No benefits yet',
                            'Approved and paid empowerment benefits will appear here.',
                            _load,
                            'Refresh',
                          )
                        : ListView(
                            padding: const EdgeInsets.all(16),
                            children: _applications
                                .where((Map<String, dynamic> item) =>
                                    <String>['APPROVED', 'PAID'].contains(
                                      _text(item['applicationStatus']).toUpperCase(),
                                    ))
                                .map(_benefitCard)
                                .toList(),
                          ),
                  ],
                ),
    );
  }

  Widget _hero() => Container(
        padding: const EdgeInsets.all(20),
        decoration: BoxDecoration(
          gradient: const LinearGradient(
            colors: <Color>[Color(0xFF003F26), Color(0xFF08783E)],
          ),
          borderRadius: BorderRadius.circular(24),
        ),
        child: const Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Icon(Icons.volunteer_activism_rounded, color: Colors.white, size: 34),
            SizedBox(height: 12),
            Text(
              'Opportunities for you',
              style: TextStyle(color: Colors.white, fontSize: 23, fontWeight: FontWeight.w900),
            ),
            SizedBox(height: 6),
            Text(
              'Discover verified programs, apply securely, and follow every step of your benefit.',
              style: TextStyle(color: Color(0xFFD4F5DD), height: 1.4),
            ),
          ],
        ),
      );
}
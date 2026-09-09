import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'admin_branch_management_api.dart';

const _branchGreen = Color(0xFF08783E);
const _branchInk = Color(0xFF17352B);
const _branchPaper = Color(0xFFF4F8F3);

class AdminBranchManagementScreen extends StatefulWidget {
  const AdminBranchManagementScreen({
    super.key,
    required this.canManage,
    required this.canViewReports,
    required this.canViewApprovals,
  });

  final bool canManage;
  final bool canViewReports;
  final bool canViewApprovals;

  @override
  State<AdminBranchManagementScreen> createState() =>
      _AdminBranchManagementScreenState();
}

class _AdminBranchManagementScreenState
    extends State<AdminBranchManagementScreen> {
  final AdminBranchManagementApi _api = AdminBranchManagementApi();
  final TextEditingController _searchController = TextEditingController();
  List<Map<String, dynamic>> _branches = <Map<String, dynamic>>[];
  List<Map<String, dynamic>> _managers = <Map<String, dynamic>>[];
  String _status = 'ALL';
  String _state = 'ALL';
  String _error = '';
  bool _loading = true;
  bool _saving = false;

  static const List<String> _modules = <String>[
    'WALLET',
    'AIRTIME',
    'DATA',
    'DELIVERY',
    'SOLAR',
    'MARKETPLACE',
    'PHONE',
    'EMPOWERMENT',
  ];

  @override
  void initState() {
    super.initState();
    _searchController.addListener(_refreshFilters);
    _load();
  }

  @override
  void dispose() {
    _searchController
      ..removeListener(_refreshFilters)
      ..dispose();
    _api.close();
    super.dispose();
  }

  void _refreshFilters() => setState(() {});

  String _id(Map<String, dynamic> value) =>
      '${value['_id'] ?? value['id'] ?? ''}';

  String _text(dynamic value, [String fallback = 'Not recorded']) {
    final text = '$value'.trim();
    return text.isEmpty || text == 'null' ? fallback : text;
  }

  String _statusOf(Map<String, dynamic> branch) =>
      _text(branch['status'], 'DRAFT').toUpperCase();

  int _number(dynamic value) =>
      value is num ? value.toInt() : int.tryParse('$value') ?? 0;

  List<Map<String, dynamic>> get _filteredBranches {
    final query = _searchController.text.trim().toLowerCase();
    return _branches.where((branch) {
      final statusMatch = _status == 'ALL' || _statusOf(branch) == _status;
      final stateMatch =
          _state == 'ALL' || _text(branch['state'], '') == _state;
      final searchMatch = query.isEmpty ||
          <dynamic>[
            branch['name'],
            branch['code'],
            branch['state'],
            branch['lga'],
            branch['email'],
            branch['phone'],
          ].any((value) => '$value'.toLowerCase().contains(query));
      return statusMatch && stateMatch && searchMatch;
    }).toList();
  }

  List<String> get _states => <String>{
        'ALL',
        ..._branches
            .map((branch) => _text(branch['state'], ''))
            .where((state) => state.isNotEmpty),
      }.toList()
        ..sort();

  int get _activeCount =>
      _branches.where((branch) => _statusOf(branch) == 'ACTIVE').length;

  int get _attentionCount => _branches
      .where((branch) =>
          <String>['DRAFT', 'SUSPENDED'].contains(_statusOf(branch)))
      .length;

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = '';
    });
    try {
      final branches = await _api.list();
      var managers = <Map<String, dynamic>>[];
      if (widget.canManage) {
        try {
          managers = await _api.managers();
        } catch (_) {
          // The list remains available if this role lacks global users access.
        }
      }
      if (!mounted) return;
      setState(() {
        _branches = branches;
        _managers = managers;
        _loading = false;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = '$error'.replaceFirst('Exception: ', '');
      });
    }
  }

  void _notice(String message, {bool error = false}) {
    if (!mounted) return;
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(
        content: Text(message),
        backgroundColor: error ? Colors.red.shade700 : _branchGreen,
        behavior: SnackBarBehavior.floating,
      ));
  }

  Future<void> _saveBranch(Map<String, dynamic>? existing) async {
    final payload = await _showBranchForm(existing);
    if (payload == null) return;
    setState(() => _saving = true);
    try {
      final branchId = existing == null ? '' : _id(existing);
      final requestPayload = Map<String, dynamic>.from(payload)
        ..remove('_status')
        ..remove('_managerId')
        ..remove('_removeManager');
      final response = existing == null
          ? await _api.create(requestPayload)
          : await _api.update(branchId, requestPayload);
      final rawBranch = response['branch'] ?? response['data'] ?? response;
      if (rawBranch is! Map) {
        throw const AdminBranchException(
            'The branch service returned an invalid branch record.');
      }
      final created = Map<String, dynamic>.from(rawBranch);
      final desiredStatus = payload['_status']?.toString() ?? 'DRAFT';
      final managerId = payload['_managerId']?.toString() ?? '';
      if (_statusOf(created) != desiredStatus) {
        await _api.setStatus(_id(created), desiredStatus);
      }
      if (managerId.isNotEmpty) {
        await _api.assignManager(_id(created), managerId: managerId);
      } else if (existing != null && payload['_removeManager'] == true) {
        await _api.removeManager(_id(created));
      }
      await _load();
      if (!mounted) return;
      setState(() => _saving = false);
      _notice(existing == null
          ? 'Branch created successfully.'
          : 'Branch updated successfully.');
      if (existing == null) {
        final credentials = response['temporaryCredentials'] ??
            response['credentials'] ??
            created['_temporaryCredentials'];
        if (credentials is Map && credentials.isNotEmpty) {
          await _showTemporaryCredentials(
              Map<String, dynamic>.from(credentials));
        }
      }
      await _showBranchDetail(created);
    } catch (error) {
      if (!mounted) return;
      setState(() => _saving = false);
      _notice('$error'.replaceFirst('Exception: ', ''), error: true);
    }
  }

  Future<void> _changeStatus(Map<String, dynamic> branch) async {
    final current = _statusOf(branch);
    final next = current == 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
    try {
      await _api.setStatus(_id(branch), next);
      await _load();
      _notice('Branch ${next == 'ACTIVE' ? 'activated' : 'deactivated'}.');
    } catch (error) {
      _notice('$error'.replaceFirst('Exception: ', ''), error: true);
    }
  }

  Future<void> _showBranchDetail(Map<String, dynamic> branch) async {
    final branchId = _id(branch);
    Map<String, dynamic> detail = branch;
    try {
      final response = await _api.detail(branchId);
      final raw = response['branch'] ?? response['data'];
      if (raw is Map) detail = Map<String, dynamic>.from(raw);
    } catch (_) {
      // The list record still provides a useful detail view if the enrichment
      // request is temporarily unavailable.
    }
    if (!mounted) return;
    await showDialog<void>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Row(children: [
          Expanded(child: Text(_text(detail['name'], 'Branch details'))),
          _statusPill(_statusOf(detail)),
        ]),
        content: SizedBox(
          width: 600,
          child: SingleChildScrollView(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                _detailGrid(detail),
                const SizedBox(height: 18),
                Text('Assigned modules',
                    style: Theme.of(context).textTheme.titleSmall),
                const SizedBox(height: 8),
                Text(_listText(
                    detail['assignedModules'], 'No modules assigned')),
                const SizedBox(height: 18),
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: [
                    OutlinedButton.icon(
                      onPressed: () {
                        Navigator.pop(dialogContext);
                        _showCollection(
                            title: 'Targets',
                            loader: () => _api.targets(branchId));
                      },
                      icon: const Icon(Icons.track_changes_outlined),
                      label: const Text('View targets'),
                    ),
                    if (widget.canViewReports)
                      OutlinedButton.icon(
                        onPressed: () {
                          Navigator.pop(dialogContext);
                          _showCollection(
                              title: 'Reports',
                              loader: () => _api.reports(branchId));
                        },
                        icon: const Icon(Icons.assessment_outlined),
                        label: const Text('View reports'),
                      ),
                    if (widget.canViewApprovals)
                      OutlinedButton.icon(
                        onPressed: () {
                          Navigator.pop(dialogContext);
                          _showCollection(
                              title: 'Approvals',
                              loader: () => _api.approvals(branchId));
                        },
                        icon: const Icon(Icons.fact_check_outlined),
                        label: const Text('View approvals'),
                      ),
                  ],
                ),
              ],
            ),
          ),
        ),
        actions: [
          if (widget.canManage)
            TextButton(
              onPressed: () {
                Navigator.pop(dialogContext);
                _saveBranch(detail);
              },
              child: const Text('Edit branch'),
            ),
          if (widget.canManage)
            FilledButton(
              onPressed: () {
                Navigator.pop(dialogContext);
                _changeStatus(detail);
              },
              child: Text(
                  _statusOf(detail) == 'ACTIVE' ? 'Deactivate' : 'Activate'),
            ),
        ],
      ),
    );
  }

  Future<void> _showCollection({
    required String title,
    required Future<Map<String, dynamic>> Function() loader,
  }) async {
    showDialog<void>(
      context: context,
      barrierDismissible: false,
      builder: (_) => const Center(child: CircularProgressIndicator()),
    );
    try {
      final response = await loader();
      if (mounted) Navigator.pop(context);
      if (!mounted) return;
      final value = response['targets'] ??
          response['requests'] ??
          response['transactions'] ??
          response['report'] ??
          response['data'] ??
          response;
      final entries = value is List ? value : <dynamic>[value];
      await showDialog<void>(
        context: context,
        builder: (dialogContext) => AlertDialog(
          title: Text(title),
          content: SizedBox(
            width: 620,
            height: 360,
            child: entries.isEmpty
                ? Center(child: Text('No $title found for this branch.'))
                : ListView.separated(
                    itemCount: entries.length,
                    separatorBuilder: (_, __) => const Divider(height: 1),
                    itemBuilder: (_, index) {
                      final item = entries[index];
                      if (item is! Map) return ListTile(title: Text('$item'));
                      final map = Map<String, dynamic>.from(item);
                      return ListTile(
                        title: Text(_text(
                            map['title'] ?? map['metric'] ?? map['reference'],
                            '$title item')),
                        subtitle: Text(_summary(map)),
                        trailing: Text(_text(
                            map['status'] ?? map['actual'] ?? map['count'],
                            '—')),
                      );
                    },
                  ),
          ),
          actions: [
            TextButton(
                onPressed: () => Navigator.pop(dialogContext),
                child: const Text('Close')),
          ],
        ),
      );
    } catch (error) {
      if (mounted) Navigator.pop(context);
      _notice('$error'.replaceFirst('Exception: ', ''), error: true);
    }
  }

  String _summary(Map<String, dynamic> map) {
    final values = <String>[];
    for (final key in const <String>[
      'code',
      'period',
      'type',
      'target',
      'createdAt',
    ]) {
      if (map[key] != null && '$map[key]'.isNotEmpty) {
        values.add('$key: ${map[key]}');
      }
    }
    return values.take(3).join('  •  ');
  }

  Future<Map<String, dynamic>?> _showBranchForm(
      Map<String, dynamic>? existing) async {
    final name =
        TextEditingController(text: existing?['name']?.toString() ?? '');
    final code =
        TextEditingController(text: existing?['code']?.toString() ?? '');
    final state =
        TextEditingController(text: existing?['state']?.toString() ?? '');
    final lga = TextEditingController(text: existing?['lga']?.toString() ?? '');
    final address =
        TextEditingController(text: existing?['address']?.toString() ?? '');
    final phone =
        TextEditingController(text: existing?['phone']?.toString() ?? '');
    final email =
        TextEditingController(text: existing?['email']?.toString() ?? '');
    final openingDate = TextEditingController(
        text: existing?['openingDate'] == null
            ? ''
            : '${existing?['openingDate']}'.split('T').first);
    final notes =
        TextEditingController(text: existing?['notes']?.toString() ?? '');
    final managerFullName = TextEditingController();
    final managerEmail = TextEditingController();
    final managerPhone = TextEditingController();
    var selectedModules = <String>[
      if (existing?['assignedModules'] is List)
        ...(existing!['assignedModules'] as List)
            .map((value) => '$value'.toUpperCase())
    ];
    var selectedStatus = _statusOf(existing ?? <String, dynamic>{});
    var selectedManager = _idValue(existing?['managerId']);
    final existingManagerId = TextEditingController(text: selectedManager);
    var createNewManager = existing == null;
    final formKey = GlobalKey<FormState>();

    InputDecoration decoration(String label, {String? hint}) => InputDecoration(
          labelText: label,
          hintText: hint,
          filled: true,
          fillColor: const Color(0xFFF8FAF8),
          border: OutlineInputBorder(
              borderRadius: BorderRadius.circular(12),
              borderSide: BorderSide(color: Colors.grey.shade300)),
        );

    Widget field(TextEditingController controller, String label,
        {bool required = false,
        String? hint,
        TextInputType? keyboardType,
        int maxLines = 1}) {
      return TextFormField(
        controller: controller,
        maxLines: maxLines,
        keyboardType: keyboardType,
        decoration: decoration(label, hint: hint),
        validator: required
            ? (value) => value == null || value.trim().isEmpty
                ? '$label is required.'
                : null
            : null,
      );
    }

    Widget managerField(TextEditingController controller, String label,
        {TextInputType? keyboardType}) {
      return TextFormField(
        controller: controller,
        keyboardType: keyboardType,
        decoration: decoration(label),
        validator: (value) =>
            createNewManager && (value == null || value.trim().isEmpty)
                ? '$label is required when creating a manager.'
                : null,
      );
    }

    final result = await showDialog<Map<String, dynamic>>(
      context: context,
      builder: (dialogContext) => StatefulBuilder(
        builder: (dialogContext, setDialogState) => AlertDialog(
          title: Text(existing == null ? 'Create Branch' : 'Edit Branch'),
          content: SizedBox(
            width: 680,
            child: Form(
              key: formKey,
              child: SingleChildScrollView(
                child: Column(
                  children: [
                    LayoutBuilder(builder: (_, constraints) {
                      final width = constraints.maxWidth > 500
                          ? (constraints.maxWidth - 12) / 2
                          : constraints.maxWidth;
                      return Wrap(
                        spacing: 12,
                        runSpacing: 12,
                        children: [
                          SizedBox(
                              width: width,
                              child:
                                  field(name, 'Branch Name', required: true)),
                          SizedBox(
                              width: width,
                              child: field(code, 'Branch Code',
                                  required: true, hint: 'SP-KANO-001')),
                          SizedBox(
                              width: width,
                              child: field(state, 'State', required: true)),
                          SizedBox(
                              width: width,
                              child: field(lga, 'LGA', required: true)),
                          SizedBox(
                              width: width,
                              child: field(phone, 'Phone',
                                  required: true,
                                  keyboardType: TextInputType.phone)),
                          SizedBox(
                              width: width,
                              child: field(email, 'Email',
                                  required: true,
                                  keyboardType: TextInputType.emailAddress)),
                          SizedBox(
                              width: width,
                              child: field(openingDate, 'Opening Date',
                                  required: true, hint: 'YYYY-MM-DD')),
                          SizedBox(
                            width: width,
                            child: DropdownButtonFormField<String>(
                              value: selectedStatus,
                              decoration: decoration('Status'),
                              items: const <String>[
                                'DRAFT',
                                'ACTIVE',
                                'INACTIVE',
                                'SUSPENDED',
                              ]
                                  .map((value) => DropdownMenuItem(
                                      value: value, child: Text(value)))
                                  .toList(),
                              onChanged: (value) => setDialogState(
                                  () => selectedStatus = value ?? 'DRAFT'),
                            ),
                          ),
                        ],
                      );
                    }),
                    const SizedBox(height: 16),
                    Align(
                      alignment: Alignment.centerLeft,
                      child: Text('Branch Manager',
                          style: Theme.of(context).textTheme.labelLarge),
                    ),
                    if (existing == null)
                      Column(
                        children: [
                          RadioListTile<bool>(
                            value: true,
                            groupValue: createNewManager,
                            onChanged: (value) => setDialogState(
                                () => createNewManager = value ?? true),
                            title: const Text('Create a new manager'),
                            subtitle: const Text(
                                'ServicePay generates a one-time temporary password.'),
                          ),
                          RadioListTile<bool>(
                            value: false,
                            groupValue: createNewManager,
                            onChanged: (value) => setDialogState(
                                () => createNewManager = value ?? true),
                            title: const Text('Assign an existing manager'),
                          ),
                        ],
                      ),
                    if (createNewManager)
                      LayoutBuilder(builder: (_, constraints) {
                        final width = constraints.maxWidth > 500
                            ? (constraints.maxWidth - 12) / 2
                            : constraints.maxWidth;
                        return Wrap(spacing: 12, runSpacing: 12, children: [
                          SizedBox(
                              width: width,
                              child:
                                  managerField(managerFullName, 'Full Name')),
                          SizedBox(
                              width: width,
                              child: managerField(managerEmail, 'Manager Email',
                                  keyboardType: TextInputType.emailAddress)),
                          SizedBox(
                              width: width,
                              child: managerField(managerPhone, 'Manager Phone',
                                  keyboardType: TextInputType.phone)),
                        ]);
                      })
                    else
                      Column(
                        children: [
                          DropdownButtonFormField<String>(
                            value:
                                _managers.any((m) => _id(m) == selectedManager)
                                    ? selectedManager
                                    : null,
                            decoration: decoration(
                                'Select existing manager (optional)'),
                            items: [
                              const DropdownMenuItem<String>(
                                  value: '', child: Text('Unassigned')),
                              ..._managers.map((manager) => DropdownMenuItem(
                                    value: _id(manager),
                                    child: Text(_text(
                                        manager['fullName'],
                                        _text(manager['email'],
                                            'Staff account'))),
                                  )),
                            ],
                            onChanged: (value) => setDialogState(() {
                              selectedManager = value ?? '';
                              existingManagerId.text = selectedManager;
                            }),
                          ),
                          const SizedBox(height: 12),
                          TextFormField(
                            controller: existingManagerId,
                            decoration: decoration('Existing Manager ID',
                                hint: 'Enter an ID when not selecting above'),
                            onChanged: (value) =>
                                selectedManager = value.trim(),
                          ),
                        ],
                      ),
                    const SizedBox(height: 12),
                    field(address, 'Address', required: true, maxLines: 2),
                    const SizedBox(height: 12),
                    Align(
                      alignment: Alignment.centerLeft,
                      child: Text('Assigned Modules',
                          style: Theme.of(context).textTheme.labelLarge),
                    ),
                    const SizedBox(height: 6),
                    Align(
                      alignment: Alignment.centerLeft,
                      child: Wrap(
                        spacing: 6,
                        runSpacing: 4,
                        children: _modules
                            .map((module) => FilterChip(
                                  label: Text(module),
                                  selected: selectedModules.contains(module),
                                  onSelected: (selected) => setDialogState(() {
                                    if (selected) {
                                      selectedModules = <String>[
                                        ...selectedModules,
                                        module
                                      ];
                                    } else {
                                      selectedModules = selectedModules
                                          .where((item) => item != module)
                                          .toList();
                                    }
                                  }),
                                ))
                            .toList(),
                      ),
                    ),
                    const SizedBox(height: 12),
                    field(notes, 'Notes', maxLines: 3),
                  ],
                ),
              ),
            ),
          ),
          actions: [
            TextButton(
                onPressed: () => Navigator.pop(dialogContext),
                child: const Text('Cancel')),
            FilledButton(
              onPressed: () {
                if (!(formKey.currentState?.validate() ?? false)) return;
                final normalizedCode = code.text.trim().toUpperCase();
                if (!RegExp(r'^[A-Z0-9_-]{2,32}$').hasMatch(normalizedCode)) {
                  _notice('Branch Code must use 2–32 letters, numbers, _ or -.',
                      error: true);
                  return;
                }
                Navigator.pop(dialogContext, <String, dynamic>{
                  'name': name.text.trim(),
                  'code': normalizedCode,
                  'state': state.text.trim(),
                  'lga': lga.text.trim(),
                  'address': address.text.trim(),
                  'phone': phone.text.trim(),
                  'email': email.text.trim().toLowerCase(),
                  'openingDate': openingDate.text.trim(),
                  'assignedModules': selectedModules,
                  'notes': notes.text.trim(),
                  '_status': selectedStatus,
                  if (existing == null && createNewManager)
                    'manager': <String, dynamic>{
                      'fullName': managerFullName.text.trim(),
                      'email': managerEmail.text.trim().toLowerCase(),
                      'phone': managerPhone.text.trim(),
                    }
                  else if (existing == null &&
                      existingManagerId.text.trim().isNotEmpty)
                    'managerId': existingManagerId.text.trim()
                  else if (existing != null)
                    '_managerId': existingManagerId.text.trim(),
                  if (existing != null &&
                      existingManagerId.text.trim().isEmpty &&
                      _idValue(existing['managerId']).isNotEmpty)
                    '_removeManager': true,
                });
              },
              child: Text(existing == null ? 'Create Branch' : 'Save Changes'),
            ),
          ],
        ),
      ),
    );
    name.dispose();
    code.dispose();
    state.dispose();
    lga.dispose();
    address.dispose();
    phone.dispose();
    email.dispose();
    openingDate.dispose();
    notes.dispose();
    managerFullName.dispose();
    managerEmail.dispose();
    managerPhone.dispose();
    existingManagerId.dispose();
    return result;
  }

  String _idValue(dynamic value) => value is Map
      ? _id(Map<String, dynamic>.from(value))
      : '$value' == 'null'
          ? ''
          : '$value';

  Future<void> _showTemporaryCredentials(
      Map<String, dynamic> credentials) async {
    await showDialog<void>(
      context: context,
      barrierDismissible: false,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Temporary manager credentials'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
                'Save these now. For security, they are only shown once.'),
            const SizedBox(height: 12),
            SelectableText(
              'Login identifier: ${_text(credentials['identifier'] ?? credentials['email'] ?? credentials['username'] ?? credentials['phone'])}\n'
              'Phone: ${_text(credentials['phone'] ?? credentials['identifier'])}\n'
              'Temporary password: ${_text(credentials['temporaryPassword'] ?? credentials['password'])}',
            ),
          ],
        ),
        actions: [
          FilledButton(
            onPressed: () => Navigator.pop(dialogContext),
            child: const Text('I have saved these credentials'),
          ),
        ],
      ),
    );
  }

  Widget _detailGrid(Map<String, dynamic> branch) {
    final rows = <String, String>{
      'Branch code': _text(branch['code']),
      'State / LGA': '${_text(branch['state'])} / ${_text(branch['lga'])}',
      'Address': _text(branch['address']),
      'Phone': _text(branch['phone']),
      'Email': _text(branch['email']),
      'Opening date': _text(branch['openingDate']),
      'Manager': _managerName(branch['managerId']),
      'Members': _number(branch['members'] is List
              ? (branch['members'] as List).length
              : branch['staffIds']?.length)
          .toString(),
    };
    return Column(
      children: rows.entries
          .map((entry) => Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    SizedBox(
                        width: 125,
                        child: Text(entry.key,
                            style: TextStyle(color: Colors.grey.shade600))),
                    Expanded(
                        child: Text(entry.value,
                            style:
                                const TextStyle(fontWeight: FontWeight.w600))),
                  ],
                ),
              ))
          .toList(),
    );
  }

  String _managerName(dynamic managerId) {
    if (managerId is Map) {
      return _text(managerId['fullName'] ?? managerId['name']);
    }
    final manager = _managers.where((item) => _id(item) == '$managerId');
    return manager.isEmpty ? 'Unassigned' : _text(manager.first['fullName']);
  }

  String _listText(dynamic value, String fallback) {
    if (value is List && value.isNotEmpty) return value.join(', ');
    return fallback;
  }

  Widget _statusPill(String status) {
    final color = status == 'ACTIVE'
        ? Colors.green
        : status == 'SUSPENDED'
            ? Colors.orange
            : Colors.blueGrey;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 5),
      decoration: BoxDecoration(
          color: color.withValues(alpha: .12),
          borderRadius: BorderRadius.circular(20)),
      child: Text(status,
          style: TextStyle(
              color: color, fontSize: 11, fontWeight: FontWeight.w800)),
    );
  }

  Widget _metric(String label, String value, IconData icon, Color color) =>
      Container(
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: Colors.grey.shade200)),
        child: Row(children: [
          Icon(icon, color: color),
          const SizedBox(width: 10),
          Expanded(
              child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                Text(value,
                    style: const TextStyle(
                        fontSize: 20, fontWeight: FontWeight.w900)),
                Text(label,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style:
                        TextStyle(color: Colors.grey.shade600, fontSize: 11)),
              ])),
        ]),
      );

  Widget _branchCard(Map<String, dynamic> branch) {
    final status = _statusOf(branch);
    return Card(
      elevation: 0,
      margin: EdgeInsets.zero,
      shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(16),
          side: BorderSide(color: Colors.grey.shade200)),
      child: InkWell(
        borderRadius: BorderRadius.circular(16),
        onTap: () => _showBranchDetail(branch),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(children: [
                Container(
                  padding: const EdgeInsets.all(10),
                  decoration: BoxDecoration(
                      color: _branchGreen.withValues(alpha: .1),
                      borderRadius: BorderRadius.circular(12)),
                  child: const Icon(Icons.storefront_outlined,
                      color: _branchGreen),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(_text(branch['name'], 'Unnamed branch'),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                                fontWeight: FontWeight.w800, fontSize: 16)),
                        Text(_text(branch['code']),
                            style: TextStyle(
                                color: Colors.grey.shade600, fontSize: 12)),
                      ]),
                ),
                _statusPill(status),
              ]),
              const SizedBox(height: 14),
              Text(
                '${_text(branch['state'])} • ${_text(branch['lga'])}',
                style: TextStyle(color: Colors.grey.shade700),
              ),
              const SizedBox(height: 4),
              Text(_managerName(branch['managerId']),
                  style: TextStyle(color: Colors.grey.shade600, fontSize: 12)),
              const SizedBox(height: 14),
              Row(children: [
                Expanded(
                    child: OutlinedButton(
                        onPressed: () => _showBranchDetail(branch),
                        child: const Text('View branch'))),
                const SizedBox(width: 8),
                if (widget.canManage)
                  IconButton(
                      tooltip: status == 'ACTIVE' ? 'Deactivate' : 'Activate',
                      onPressed: () => _changeStatus(branch),
                      icon: Icon(status == 'ACTIVE'
                          ? Icons.pause_circle_outline
                          : Icons.play_circle_outline)),
                if (widget.canManage)
                  IconButton(
                      tooltip: 'Edit branch',
                      onPressed: () => _saveBranch(branch),
                      icon: const Icon(Icons.edit_outlined)),
              ]),
            ],
          ),
        ),
      ),
    );
  }

  Widget _filters() => Card(
        elevation: 0,
        margin: EdgeInsets.zero,
        color: Colors.white,
        shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(16),
            side: BorderSide(color: Colors.grey.shade200)),
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Wrap(
            spacing: 10,
            runSpacing: 10,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              SizedBox(
                width: 260,
                child: TextField(
                  controller: _searchController,
                  decoration: InputDecoration(
                    prefixIcon: const Icon(Icons.search),
                    hintText: 'Search branches',
                    filled: true,
                    fillColor: _branchPaper,
                    border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(12),
                        borderSide: BorderSide.none),
                  ),
                ),
              ),
              DropdownButton<String>(
                value: _status,
                underline: const SizedBox.shrink(),
                items: const <String>[
                  'ALL',
                  'DRAFT',
                  'ACTIVE',
                  'INACTIVE',
                  'SUSPENDED'
                ]
                    .map((item) => DropdownMenuItem(
                        value: item, child: Text('Status: $item')))
                    .toList(),
                onChanged: (value) => setState(() => _status = value ?? 'ALL'),
              ),
              DropdownButton<String>(
                value: _states.contains(_state) ? _state : 'ALL',
                underline: const SizedBox.shrink(),
                items: _states
                    .map((item) => DropdownMenuItem(
                        value: item, child: Text('State: $item')))
                    .toList(),
                onChanged: (value) => setState(() => _state = value ?? 'ALL'),
              ),
              IconButton(
                  tooltip: 'Refresh branches',
                  onPressed: _load,
                  icon: const Icon(Icons.refresh)),
            ],
          ),
        ),
      );

  @override
  Widget build(BuildContext context) {
    return Container(
      color: _branchPaper,
      child: RefreshIndicator(
        onRefresh: _load,
        child: ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.fromLTRB(18, 20, 18, 32),
          children: [
            LayoutBuilder(builder: (_, constraints) {
              final compact = constraints.maxWidth < 620;
              return Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      const Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text('Branch Management',
                                style: TextStyle(
                                    color: _branchInk,
                                    fontSize: 25,
                                    fontWeight: FontWeight.w900)),
                            SizedBox(height: 4),
                            Text(
                                'Create, configure and monitor ServicePay branches.',
                                style: TextStyle(color: Colors.black54)),
                          ],
                        ),
                      ),
                      if (!compact && widget.canManage)
                        FilledButton.icon(
                          onPressed: _saving ? null : () => _saveBranch(null),
                          icon: const Icon(Icons.add_business_outlined),
                          label: const Text('Create Branch'),
                          style: FilledButton.styleFrom(
                              backgroundColor: _branchGreen),
                        ),
                    ],
                  ),
                  if (compact && widget.canManage) ...[
                    const SizedBox(height: 14),
                    SizedBox(
                      width: double.infinity,
                      child: FilledButton.icon(
                        onPressed: _saving ? null : () => _saveBranch(null),
                        icon: const Icon(Icons.add_business_outlined),
                        label: const Text('Create Branch'),
                        style: FilledButton.styleFrom(
                            backgroundColor: _branchGreen),
                      ),
                    ),
                  ],
                ],
              );
            }),
            const SizedBox(height: 18),
            LayoutBuilder(builder: (_, constraints) {
              final compact = constraints.maxWidth < 680;
              final metrics = <Widget>[
                _metric('Total branches', '${_branches.length}',
                    Icons.account_tree_outlined, _branchGreen),
                _metric('Active branches', '$_activeCount',
                    Icons.check_circle_outline, Colors.green),
                _metric('Needs attention', '$_attentionCount',
                    Icons.warning_amber_outlined, Colors.orange),
                _metric(
                    'Pending approvals',
                    '${_branches.fold<int>(0, (sum, branch) => sum + _number(branch['pendingApprovals']))}',
                    Icons.fact_check_outlined,
                    Colors.indigo),
              ];
              return compact
                  ? Wrap(
                      spacing: 10,
                      runSpacing: 10,
                      children: metrics
                          .map((item) => SizedBox(
                              width: (constraints.maxWidth - 10) / 2,
                              child: item))
                          .toList())
                  : Row(
                      children: metrics
                          .map((item) => Expanded(
                                child: Padding(
                                  padding: const EdgeInsets.only(right: 10),
                                  child: item,
                                ),
                              ))
                          .toList());
            }),
            const SizedBox(height: 16),
            _filters(),
            const SizedBox(height: 16),
            if (_loading)
              const Padding(
                  padding: EdgeInsets.all(48),
                  child: Center(child: CircularProgressIndicator()))
            else if (_error.isNotEmpty)
              _errorState()
            else if (_filteredBranches.isEmpty)
              _emptyState()
            else
              LayoutBuilder(builder: (_, constraints) {
                final columns = constraints.maxWidth >= 1100
                    ? 3
                    : constraints.maxWidth >= 700
                        ? 2
                        : 1;
                final width =
                    (constraints.maxWidth - ((columns - 1) * 12)) / columns;
                return Wrap(
                  spacing: 12,
                  runSpacing: 12,
                  children: _filteredBranches
                      .map((branch) =>
                          SizedBox(width: width, child: _branchCard(branch)))
                      .toList(),
                );
              }),
          ],
        ),
      ),
    );
  }

  Widget _emptyState() => Container(
        padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 52),
        decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(18),
            border: Border.all(color: Colors.grey.shade200)),
        child: Column(children: [
          const Icon(Icons.account_tree_outlined,
              size: 52, color: _branchGreen),
          const SizedBox(height: 14),
          Text(
              _searchController.text.isNotEmpty ||
                      _status != 'ALL' ||
                      _state != 'ALL'
                  ? 'No branches match these filters'
                  : 'No branches created yet',
              style:
                  const TextStyle(fontSize: 18, fontWeight: FontWeight.w800)),
          const SizedBox(height: 8),
          Text(
              _branches.isEmpty
                  ? 'Set up your first ServicePay branch to start managing local operations.'
                  : 'Try changing your search or filters.',
              textAlign: TextAlign.center,
              style: TextStyle(color: Colors.grey.shade600)),
          if (_branches.isEmpty && widget.canManage) ...[
            const SizedBox(height: 20),
            FilledButton.icon(
              onPressed: () => _saveBranch(null),
              icon: const Icon(Icons.add_business_outlined),
              label: const Text('Create First Branch'),
              style: FilledButton.styleFrom(backgroundColor: _branchGreen),
            ),
          ],
        ]),
      );

  Widget _errorState() => Container(
        padding: const EdgeInsets.all(24),
        decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(18),
            border: Border.all(color: Colors.red.shade100)),
        child: Column(children: [
          Icon(Icons.cloud_off_outlined, size: 42, color: Colors.red.shade400),
          const SizedBox(height: 10),
          const Text('Unable to load branches',
              style: TextStyle(fontSize: 17, fontWeight: FontWeight.w800)),
          const SizedBox(height: 6),
          Text(_error, textAlign: TextAlign.center),
          const SizedBox(height: 16),
          OutlinedButton.icon(
              onPressed: _load,
              icon: const Icon(Icons.refresh),
              label: const Text('Try again')),
        ]),
      );
}

class AdminBranchSummaryCard extends StatefulWidget {
  const AdminBranchSummaryCard({super.key});

  @override
  State<AdminBranchSummaryCard> createState() => _AdminBranchSummaryCardState();
}

class _AdminBranchSummaryCardState extends State<AdminBranchSummaryCard> {
  final AdminBranchManagementApi _api = AdminBranchManagementApi();
  int _total = 0;
  int _active = 0;
  int _behind = 0;
  int _pending = 0;
  bool _loading = true;
  bool _available = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _api.close();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final branches = await _api.list();
      final overview = await _api.overview();
      var pending = 0;
      try {
        final approvals = await _api.allApprovals();
        final requests = approvals['requests'];
        if (requests is List) {
          pending = requests
              .where((item) =>
                  item is Map &&
                  <String>['SUBMITTED', 'PENDING_HEAD_OFFICE']
                      .contains('${item['status']}'.toUpperCase()))
              .length;
        }
      } catch (_) {
        // The card remains useful when approval visibility is not granted.
      }
      final rankings = overview['overview'] is Map
          ? (overview['overview'] as Map)['rankings']
          : null;
      final behind = rankings is List
          ? rankings
              .where((item) =>
                  item is Map &&
                  (item['targetAchievement'] is num
                          ? (item['targetAchievement'] as num).toDouble()
                          : double.tryParse('${item['targetAchievement']}') ??
                              1) <
                      1)
              .length
          : 0;
      if (!mounted) return;
      setState(() {
        _total = branches.length;
        _active = branches
            .where((branch) => '${branch['status']}'.toUpperCase() == 'ACTIVE')
            .length;
        _behind = behind;
        _pending = pending;
        _loading = false;
      });
    } catch (_) {
      if (mounted) {
        setState(() {
          _loading = false;
          _available = false;
        });
      }
    }
  }

  Future<void> _open() async {
    final prefs = await SharedPreferences.getInstance();
    final role = (prefs.getString('user_role') ?? '')
        .trim()
        .toUpperCase()
        .replaceAll(RegExp(r'[\s-]+'), '_');
    final fullAccess = <String>{
      'HEAD_OFFICE',
      'ADMIN',
      'SUPER_ADMIN',
      'HEAD_OFFICE_ADMIN',
    }.contains(role);
    final permissions = (prefs.getStringList('staff_permissions') ?? <String>[])
        .map((value) => value.trim().toLowerCase())
        .toSet();
    if (!mounted) return;
    await Navigator.push<void>(
      context,
      MaterialPageRoute<void>(
        settings: const RouteSettings(name: '/branches'),
        builder: (_) => Scaffold(
          appBar: AppBar(title: const Text('Branch Management')),
          body: AdminBranchManagementScreen(
            canManage: fullAccess || permissions.contains('branches.manage'),
            canViewReports: fullAccess ||
                permissions.contains('branches.reports.view') ||
                permissions.contains('branch.reports.view'),
            canViewApprovals: fullAccess ||
                permissions.contains('branches.approvals.view') ||
                permissions.contains('branches.approvals.manage') ||
                permissions.contains('branch.approvals.view'),
          ),
        ),
      ),
    );
  }

  Widget _item(String label, int value, IconData icon) => Expanded(
        child: Column(
          children: [
            Icon(icon, color: _branchGreen, size: 20),
            const SizedBox(height: 5),
            Text('$value',
                style:
                    const TextStyle(fontSize: 18, fontWeight: FontWeight.w900)),
            Text(label,
                textAlign: TextAlign.center,
                style: TextStyle(color: Colors.grey.shade600, fontSize: 10)),
          ],
        ),
      );

  @override
  Widget build(BuildContext context) {
    if (!_available) return const SizedBox.shrink();
    return Card(
      elevation: 0,
      margin: const EdgeInsets.only(bottom: 16),
      shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(18),
          side: BorderSide(color: Colors.grey.shade200)),
      child: InkWell(
        onTap: _open,
        borderRadius: BorderRadius.circular(18),
        child: Padding(
          padding: const EdgeInsets.all(18),
          child: _loading
              ? const SizedBox(
                  height: 64, child: Center(child: CircularProgressIndicator()))
              : Column(
                  children: [
                    Row(children: [
                      const Icon(Icons.account_tree_outlined,
                          color: _branchGreen),
                      const SizedBox(width: 9),
                      const Expanded(
                        child: Text('Branch Operations',
                            style: TextStyle(
                                color: _branchInk,
                                fontSize: 17,
                                fontWeight: FontWeight.w900)),
                      ),
                      TextButton.icon(
                          onPressed: _open,
                          icon: const Icon(Icons.arrow_forward, size: 17),
                          label: const Text('Manage branches')),
                    ]),
                    const Divider(height: 22),
                    Row(children: [
                      _item('Total branches', _total, Icons.store_outlined),
                      _item('Active', _active, Icons.check_circle_outline),
                      _item('Behind target', _behind, Icons.trending_down),
                      _item('Pending approvals', _pending,
                          Icons.fact_check_outlined),
                    ]),
                  ],
                ),
        ),
      ),
    );
  }
}

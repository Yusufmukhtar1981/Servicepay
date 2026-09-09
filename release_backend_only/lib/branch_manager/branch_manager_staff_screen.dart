import 'package:flutter/material.dart';

import 'branch_manager_staff_api.dart';

class BranchManagerStaffScreen extends StatefulWidget {
  const BranchManagerStaffScreen({
    super.key,
    required this.branchId,
    this.api,
    this.officerOnly = false,
  });

  final String branchId;
  final BranchManagerStaffApi? api;
  final bool officerOnly;

  @override
  State<BranchManagerStaffScreen> createState() =>
      _BranchManagerStaffScreenState();
}

class _BranchManagerStaffScreenState extends State<BranchManagerStaffScreen> {
  static const Color _green = Color(0xff087f5b);
  static const Color _ink = Color(0xff102a2a);

  late final BranchManagerStaffApi _api;
  final TextEditingController _search = TextEditingController();
  List<BranchStaff> _staff = <BranchStaff>[];
  bool _loading = true;
  String? _error;
  String? _status;

  @override
  void initState() {
    super.initState();
    _api = widget.api ?? BranchManagerStaffHttpApi();
    _load();
  }

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final List<BranchStaff> rows = await _api.list(
        widget.branchId,
        search: _search.text.trim(),
        status: _status,
      );
      if (mounted) {
        setState(() => _staff = widget.officerOnly
            ? rows
                .where((BranchStaff member) =>
                    member.data['jobTitle'] != 'GENERAL_STAFF')
                .toList()
            : rows);
      }
    } catch (error) {
      if (mounted) {
        setState(
          () => _error = error.toString().replaceFirst('Exception: ', ''),
        );
      }
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _showCredentials(TemporaryCredentials credentials) =>
      showDialog<void>(
        context: context,
        barrierDismissible: false,
        builder: (BuildContext dialogContext) => AlertDialog(
          title: const Text('Temporary credentials'),
          content: SelectableText(
            'Login: ${credentials.identifier}\n'
            'Temporary password: ${credentials.password}\n\n'
            'Share this securely. It will not be shown again.',
          ),
          actions: <Widget>[
            FilledButton(
              onPressed: () => Navigator.pop(dialogContext),
              child: const Text('Done'),
            ),
          ],
        ),
      );

  Future<void> _form([BranchStaff? member]) async {
    final TextEditingController fullName = TextEditingController(
      text: member?.data['fullName']?.toString() ?? '',
    );
    final TextEditingController phone = TextEditingController(
      text: member?.data['phone']?.toString() ?? '',
    );
    final TextEditingController email = TextEditingController(
      text: member?.data['email']?.toString() ?? '',
    );
    String jobTitle = member?.data['jobTitle']?.toString() ??
        (widget.officerOnly ? 'KYC_OFFICER' : 'GENERAL_STAFF');
    String department = member?.data['department']?.toString() ?? 'OPERATIONS';
    final GlobalKey<FormState> form = GlobalKey<FormState>();

    final bool? saved = await showDialog<bool>(
      context: context,
      builder: (BuildContext dialogContext) => StatefulBuilder(
        builder: (BuildContext context, StateSetter setDialogState) =>
            AlertDialog(
          title: Text(
            member == null ? 'Add staff member' : 'Edit staff member',
          ),
          content: SizedBox(
            width: 440,
            child: Form(
              key: form,
              child: SingleChildScrollView(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: <Widget>[
                    TextFormField(
                      controller: fullName,
                      decoration: const InputDecoration(labelText: 'Full name'),
                      validator: (String? value) =>
                          value == null || value.trim().isEmpty
                              ? 'Full name is required'
                              : null,
                    ),
                    TextFormField(
                      controller: phone,
                      decoration: const InputDecoration(labelText: 'Phone'),
                      keyboardType: TextInputType.phone,
                      validator: (String? value) =>
                          value == null || value.trim().length < 10
                              ? 'Enter a valid phone'
                              : null,
                    ),
                    TextFormField(
                      controller: email,
                      decoration:
                          const InputDecoration(labelText: 'Email (optional)'),
                      keyboardType: TextInputType.emailAddress,
                    ),
                    DropdownButtonFormField<String>(
                      value: department,
                      decoration:
                          const InputDecoration(labelText: 'Department'),
                      items: const <String>[
                        'ADMINISTRATION',
                        'OPERATIONS',
                        'DELIVERY',
                        'FINANCE',
                        'AUDIT',
                        'COMPLIANCE',
                        'CUSTOMER_SUPPORT',
                      ]
                          .map(
                            (String value) => DropdownMenuItem<String>(
                              value: value,
                              child: Text(value.replaceAll('_', ' ')),
                            ),
                          )
                          .toList(),
                      onChanged: (String? value) {
                        if (value != null) {
                          setDialogState(() => department = value);
                        }
                      },
                    ),
                    DropdownButtonFormField<String>(
                      value: <String>[
                        'GENERAL_STAFF',
                        'KYC_OFFICER',
                        'DELIVERY_OFFICER',
                        'SOLAR_OFFICER',
                        'PHONE_FINANCING_OFFICER',
                        'MARKETPLACE_OFFICER',
                        'SUPPORT_OFFICER',
                      ].contains(jobTitle)
                          ? jobTitle
                          : (widget.officerOnly
                              ? 'KYC_OFFICER'
                              : 'GENERAL_STAFF'),
                      decoration: const InputDecoration(
                        labelText: 'Branch job type',
                      ),
                      items: <String>[
                        if (!widget.officerOnly) 'GENERAL_STAFF',
                        'KYC_OFFICER',
                        'DELIVERY_OFFICER',
                        'SOLAR_OFFICER',
                        'PHONE_FINANCING_OFFICER',
                        'MARKETPLACE_OFFICER',
                        'SUPPORT_OFFICER',
                      ]
                          .map((String value) => DropdownMenuItem<String>(
                                value: value,
                                child: Text(value.replaceAll('_', ' ')),
                              ))
                          .toList(),
                      onChanged: (String? value) {
                        if (value != null) {
                          setDialogState(() => jobTitle = value);
                        }
                      },
                    ),
                  ],
                ),
              ),
            ),
          ),
          actions: <Widget>[
            TextButton(
              onPressed: () => Navigator.pop(dialogContext, false),
              child: const Text('Cancel'),
            ),
            FilledButton(
              onPressed: () {
                if (form.currentState?.validate() == true) {
                  Navigator.pop(dialogContext, true);
                }
              },
              child: const Text('Save'),
            ),
          ],
        ),
      ),
    );

    try {
      if (saved == true) {
        final Map<String, dynamic> input = <String, dynamic>{
          'fullName': fullName.text.trim(),
          'phone': phone.text.trim(),
          'email': email.text.trim(),
          'department': department,
          'jobTitle': jobTitle,
        };
        if (member == null) {
          final result = await _api.create(widget.branchId, input);
          await _load();
          if (mounted) await _showCredentials(result.credentials);
        } else {
          await _api.update(widget.branchId, member.id, input);
          await _load();
        }
      }
    } catch (error) {
      if (mounted) {
        _message(error.toString().replaceFirst('Exception: ', ''));
      }
    } finally {
      fullName.dispose();
      phone.dispose();
      email.dispose();
    }
  }

  Future<void> _statusChange(BranchStaff member) async {
    final String? value = await showDialog<String>(
      context: context,
      builder: (BuildContext dialogContext) => SimpleDialog(
        title: Text('Set ${member.name} status'),
        children: <String>['ACTIVE', 'SUSPENDED', 'BLOCKED']
            .map(
              (String status) => SimpleDialogOption(
                onPressed: () => Navigator.pop(dialogContext, status),
                child: Text(status),
              ),
            )
            .toList(),
      ),
    );
    if (value == null) return;
    try {
      await _api.setStatus(widget.branchId, member.id, value);
      await _load();
    } catch (error) {
      if (mounted) _message(error.toString());
    }
  }

  Future<void> _resetPassword(BranchStaff member) async {
    final bool? confirmed = await showDialog<bool>(
      context: context,
      builder: (BuildContext dialogContext) => AlertDialog(
        title: const Text('Reset temporary password?'),
        content: Text(
          'This will sign ${member.name} out of existing sessions.',
        ),
        actions: <Widget>[
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(dialogContext, true),
            child: const Text('Reset password'),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    try {
      final TemporaryCredentials credentials =
          await _api.resetPassword(widget.branchId, member.id);
      if (mounted) await _showCredentials(credentials);
    } catch (error) {
      if (mounted) _message(error.toString());
    }
  }

  void _message(String value) {
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(content: Text(value)));
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        backgroundColor: const Color(0xfff5f7f6),
        appBar: AppBar(
          title: const Text(
            'Branch staff',
            style: TextStyle(fontWeight: FontWeight.w800),
          ),
          actions: <Widget>[
            IconButton(
              tooltip: 'Refresh staff',
              onPressed: _loading ? null : _load,
              icon: const Icon(Icons.refresh_rounded),
            ),
          ],
        ),
        floatingActionButton: FloatingActionButton.extended(
          key: const Key('branch-staff-create'),
          onPressed: () => _form(),
          backgroundColor: _green,
          foregroundColor: Colors.white,
          icon: const Icon(Icons.person_add_alt_1),
          label: Text(widget.officerOnly ? 'Create officer' : 'Add staff'),
        ),
        body: Column(
          children: <Widget>[
            Padding(
              padding: const EdgeInsets.all(16),
              child: LayoutBuilder(
                builder: (BuildContext context, BoxConstraints box) => Wrap(
                  spacing: 12,
                  runSpacing: 8,
                  crossAxisAlignment: WrapCrossAlignment.center,
                  children: <Widget>[
                    SizedBox(
                      width: box.maxWidth > 600 ? 360 : box.maxWidth,
                      child: TextField(
                        controller: _search,
                        onSubmitted: (_) => _load(),
                        decoration: InputDecoration(
                          prefixIcon: const Icon(Icons.search),
                          hintText: 'Search name, phone, ID or department',
                          filled: true,
                          fillColor: Colors.white,
                          suffixIcon: IconButton(
                            tooltip: 'Search',
                            onPressed: _load,
                            icon: const Icon(Icons.arrow_forward_rounded),
                          ),
                        ),
                      ),
                    ),
                    DropdownButton<String?>(
                      value: _status,
                      hint: const Text('All statuses'),
                      items: const <String?>[
                        null,
                        'ACTIVE',
                        'SUSPENDED',
                        'BLOCKED',
                      ]
                          .map(
                            (String? value) => DropdownMenuItem<String?>(
                              value: value,
                              child: Text(value ?? 'All statuses'),
                            ),
                          )
                          .toList(),
                      onChanged: (String? value) {
                        setState(() => _status = value);
                        _load();
                      },
                    ),
                  ],
                ),
              ),
            ),
            Expanded(child: _body()),
          ],
        ),
      );

  Widget _body() {
    if (_loading) {
      return const Center(child: CircularProgressIndicator(color: _green));
    }
    if (_error != null) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              const Icon(Icons.cloud_off_outlined, size: 44),
              const SizedBox(height: 10),
              Text(_error!, textAlign: TextAlign.center),
              const SizedBox(height: 10),
              FilledButton(onPressed: _load, child: const Text('Retry')),
            ],
          ),
        ),
      );
    }
    if (_staff.isEmpty) {
      return const Center(
        child: Text('No staff members match your filters.'),
      );
    }
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView.builder(
        padding: const EdgeInsets.only(bottom: 96),
        itemCount: _staff.length,
        itemBuilder: (BuildContext context, int index) {
          final BranchStaff staff = _staff[index];
          return Card(
            margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 5),
            child: ListTile(
              contentPadding:
                  const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
              leading: const CircleAvatar(
                backgroundColor: Color(0xffe8f5f0),
                child: Icon(Icons.person_outline, color: _green),
              ),
              title: Text(
                staff.name,
                style: const TextStyle(
                  color: _ink,
                  fontWeight: FontWeight.w800,
                ),
              ),
              subtitle: Text(
                '${staff.data['jobTitle'] ?? 'Staff'} • '
                '${staff.data['department'] ?? 'No department'}\n'
                '${staff.data['phone'] ?? ''}',
              ),
              isThreeLine: true,
              trailing: PopupMenuButton<String>(
                tooltip: 'Staff actions',
                onSelected: (String value) {
                  if (value == 'edit') _form(staff);
                  if (value == 'status') _statusChange(staff);
                  if (value == 'reset') _resetPassword(staff);
                },
                itemBuilder: (_) => <PopupMenuEntry<String>>[
                  PopupMenuItem<String>(
                    enabled: false,
                    child: Text(
                      staff.status,
                      style: const TextStyle(
                        color: _green,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                  ),
                  const PopupMenuDivider(),
                  const PopupMenuItem<String>(
                    value: 'edit',
                    child: Text('Edit details'),
                  ),
                  const PopupMenuItem<String>(
                    value: 'status',
                    child: Text('Change status'),
                  ),
                  const PopupMenuItem<String>(
                    value: 'reset',
                    child: Text('Reset password'),
                  ),
                ],
              ),
            ),
          );
        },
      ),
    );
  }
}

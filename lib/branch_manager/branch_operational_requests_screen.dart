import 'package:flutter/material.dart';

import 'branch_operational_requests_api.dart';
import 'branch_manager_staff_api.dart';

const String _keepCurrentAssignment = '__KEEP_CURRENT__';
const String _unassigned = '__UNASSIGNED__';

class BranchOperationalRequestsScreen extends StatefulWidget {
  const BranchOperationalRequestsScreen({
    super.key,
    this.api,
    this.staffApi,
    this.branchId = '',
    this.actorId = '',
    required this.canView,
    required this.canSubmit,
    this.canManage = false,
  });

  final BranchOperationalRequestsApi? api;
  final BranchManagerStaffApi? staffApi;
  final String branchId;
  final String actorId;
  final bool canView;
  final bool canSubmit;
  final bool canManage;

  @override
  State<BranchOperationalRequestsScreen> createState() =>
      _BranchOperationalRequestsScreenState();
}

class _BranchOperationalRequestsScreenState
    extends State<BranchOperationalRequestsScreen> {
  late final BranchOperationalRequestsApi _api =
      widget.api ?? BranchOperationalRequestsHttpApi();
  late final BranchManagerStaffApi _staffApi =
      widget.staffApi ?? BranchManagerStaffHttpApi();
  List<Map<String, dynamic>> _requests = <Map<String, dynamic>>[];
  List<BranchStaff> _eligibleStaff = <BranchStaff>[];
  bool _loading = true;
  bool _saving = false;
  bool _staffLoading = false;
  String? _error;
  String? _staffError;

  @override
  void initState() {
    super.initState();
    if (widget.canView) {
      _load();
    } else {
      _loading = false;
    }
    if (widget.canManage && widget.branchId.isNotEmpty) {
      _loadEligibleStaff();
    }
  }

  Future<void> _loadEligibleStaff() async {
    if (widget.branchId.isEmpty) return;
    setState(() {
      _staffLoading = true;
      _staffError = null;
    });
    try {
      final List<BranchStaff> staff = await _staffApi.list(
        widget.branchId,
        status: 'ACTIVE',
      );
      if (mounted) {
        setState(() {
          _eligibleStaff = staff
              .where((BranchStaff member) =>
                  member.id.isNotEmpty &&
                  member.status.toUpperCase() == 'ACTIVE')
              .toList();
        });
      }
    } catch (error) {
      if (mounted) setState(() => _staffError = '$error');
    } finally {
      if (mounted) setState(() => _staffLoading = false);
    }
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final List<Map<String, dynamic>> requests = await _api.list();
      if (mounted) setState(() => _requests = requests);
    } catch (error) {
      if (mounted) setState(() => _error = '$error');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<Map<String, String>?> _requestForm() async {
    return showDialog<Map<String, String>>(
      context: context,
      builder: (_) => const _OperationalRequestDialog(),
    );
  }

  Future<void> _create() async {
    if (_saving) return;
    final Map<String, String>? input = await _requestForm();
    if (input == null || !mounted) return;
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      final Map<String, dynamic> created = await _api.create(
        type: input['type']!.trim().toUpperCase(),
        title: input['title']!,
        description: input['description']!,
      );
      if (!mounted) return;
      if (widget.canView) {
        await _load();
      } else {
        setState(() => _requests = <Map<String, dynamic>>[created]);
      }
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Operational request submitted.')),
        );
      }
    } catch (error) {
      if (mounted) {
        if (widget.canView) {
          setState(() => _error = '$error');
        } else {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text('$error')),
          );
        }
      }
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Future<void> _manageRequest(Map<String, dynamic> request) async {
    final String requestId = _text(request['_id'] ?? request['id'], '');
    final String currentStatus = _text(request['status'], 'OPEN').toUpperCase();
    if (requestId.isEmpty ||
        !const <String>{'OPEN', 'IN_PROGRESS'}.contains(currentStatus) ||
        _saving) {
      return;
    }
    final Map<String, dynamic>? changes =
        await showDialog<Map<String, dynamic>>(
      context: context,
      builder: (_) => _OperationalRequestManageDialog(
        request: request,
        eligibleStaff: _eligibleStaff,
        staffLoading: _staffLoading,
        staffError: _staffError,
        branchIdAvailable: widget.branchId.isNotEmpty,
        onRetryStaff: _loadEligibleStaff,
      ),
    );
    if (changes == null || !mounted) return;
    setState(() => _saving = true);
    try {
      final String assignment = changes['assignment'] as String;
      final Map<String, dynamic> updated = await _api.update(
        requestId: requestId,
        status: changes['status'] as String,
        reason: changes['reason'] as String,
        updateAssignment: assignment != _keepCurrentAssignment,
        assignedStaffId:
            assignment == _unassigned || assignment == _keepCurrentAssignment
                ? null
                : assignment,
      );
      if (!mounted) return;
      if (widget.canView) {
        await _load();
      } else {
        setState(() {
          final int index = _requests.indexWhere((Map<String, dynamic> item) =>
              _text(item['_id'] ?? item['id'], '') == requestId);
          if (index >= 0) _requests[index] = updated;
        });
      }
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Operational request updated.')),
        );
      }
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text('$error')));
      }
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  String _assignedStaffId(Map<String, dynamic> request) {
    final dynamic value = request['assignedStaffId'];
    if (value is Map) return '${value['_id'] ?? value['id'] ?? ''}'.trim();
    return value?.toString().trim() ?? '';
  }

  BranchStaff? _eligibleMember(String staffId) {
    for (final BranchStaff member in _eligibleStaff) {
      if (member.id == staffId) return member;
    }
    return null;
  }

  Future<void> _updateOwnRequest(
    Map<String, dynamic> request,
    String nextStatus,
  ) async {
    if (_saving ||
        widget.canManage ||
        widget.actorId.isEmpty ||
        _assignedStaffId(request) != widget.actorId) {
      return;
    }
    final String requestId = _text(request['_id'] ?? request['id'], '');
    final String currentStatus = _text(request['status'], 'OPEN').toUpperCase();
    final bool allowedTransition =
        (currentStatus == 'OPEN' && nextStatus == 'IN_PROGRESS') ||
            (currentStatus == 'IN_PROGRESS' && nextStatus == 'RESOLVED');
    if (requestId.isEmpty || !allowedTransition) return;
    final String? reason = await showDialog<String>(
      context: context,
      builder: (_) => _SelfRequestProgressDialog(
        currentStatus: currentStatus,
        nextStatus: nextStatus,
      ),
    );
    if (reason == null || !mounted) return;
    setState(() => _saving = true);
    try {
      await _api.update(
        requestId: requestId,
        status: nextStatus,
        reason: reason,
      );
      if (mounted) await _load();
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('$error'.replaceFirst('Exception: ', ''))),
        );
      }
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  String _text(dynamic value, [String fallback = 'Not recorded']) {
    final String text = '$value'.trim();
    return text.isEmpty || text == 'null' ? fallback : text;
  }

  String _date(dynamic value) {
    final DateTime? date =
        value is DateTime ? value : DateTime.tryParse('$value');
    if (date == null) return 'Date not recorded';
    return '${date.year.toString().padLeft(4, '0')}-'
        '${date.month.toString().padLeft(2, '0')}-'
        '${date.day.toString().padLeft(2, '0')}';
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(
          title: const Text('Operational requests'),
          actions: <Widget>[
            if (widget.canView)
              IconButton(
                tooltip: 'Refresh requests',
                onPressed: _loading ? null : _load,
                icon: const Icon(Icons.refresh),
              ),
          ],
        ),
        floatingActionButton: widget.canSubmit
            ? FloatingActionButton.extended(
                key: const Key('new-operational-request'),
                onPressed: _saving ? null : _create,
                icon: const Icon(Icons.add),
                label: const Text('New request'),
              )
            : null,
        body: _loading
            ? const _RequestsSkeleton()
            : _error != null
                ? _RequestsError(message: _error!, onRetry: _load)
                : !widget.canView
                    ? const Center(
                        child: Padding(
                          padding: EdgeInsets.all(24),
                          child: Text(
                            'You can submit a request, but this account cannot view request history.',
                            textAlign: TextAlign.center,
                          ),
                        ),
                      )
                    : _requests.isEmpty
                        ? Center(
                            child: Padding(
                              padding: const EdgeInsets.all(24),
                              child: Column(
                                mainAxisSize: MainAxisSize.min,
                                children: <Widget>[
                                  const Icon(Icons.inbox_outlined, size: 42),
                                  const SizedBox(height: 10),
                                  const Text('No operational requests yet.'),
                                  if (widget.canSubmit) ...<Widget>[
                                    const SizedBox(height: 8),
                                    const Text(
                                      'Requests submitted for this branch will appear here.',
                                      textAlign: TextAlign.center,
                                    ),
                                  ],
                                ],
                              ),
                            ),
                          )
                        : RefreshIndicator(
                            onRefresh: _load,
                            child: ListView.separated(
                              padding:
                                  const EdgeInsets.fromLTRB(12, 12, 12, 96),
                              itemCount: _requests.length,
                              separatorBuilder: (_, __) =>
                                  const SizedBox(height: 8),
                              itemBuilder: (BuildContext context, int index) {
                                final Map<String, dynamic> request =
                                    _requests[index];
                                final String status =
                                    _text(request['status'], 'OPEN')
                                        .toUpperCase();
                                final bool terminal = const <String>{
                                  'RESOLVED',
                                  'CANCELLED',
                                }.contains(status);
                                final String assignedId =
                                    _assignedStaffId(request);
                                final bool assignedToSelf =
                                    widget.actorId.isNotEmpty &&
                                        assignedId == widget.actorId;
                                final BranchStaff? assignedMember =
                                    _eligibleMember(assignedId);
                                final String assignmentLabel = assignedId
                                        .isEmpty
                                    ? 'Unassigned'
                                    : assignedToSelf
                                        ? 'Assigned to you'
                                        : assignedMember?.name.isNotEmpty ==
                                                true
                                            ? 'Assigned to ${assignedMember!.name}'
                                            : 'Assigned to branch staff';
                                return Card(
                                  child: Padding(
                                    padding: const EdgeInsets.only(bottom: 4),
                                    child: Column(
                                      crossAxisAlignment:
                                          CrossAxisAlignment.stretch,
                                      children: <Widget>[
                                        ListTile(
                                          leading: const Icon(
                                              Icons.assignment_outlined),
                                          title: Text(_text(request['title'],
                                              'Operational request')),
                                          subtitle: Text(
                                            '${_text(request['type'], 'GENERAL')} · '
                                            '${_date(request['createdAt'])}\n'
                                            '${_text(request['description'], 'No description provided.')}\n'
                                            '$assignmentLabel',
                                            maxLines: 4,
                                            overflow: TextOverflow.ellipsis,
                                          ),
                                          isThreeLine: true,
                                          trailing: Text(
                                            status.replaceAll('_', ' '),
                                            textAlign: TextAlign.end,
                                          ),
                                        ),
                                        if (widget.canManage && !terminal)
                                          Align(
                                            alignment: Alignment.centerRight,
                                            child: TextButton.icon(
                                              key: Key(
                                                  'manage-operational-request-${_text(request['_id'] ?? request['id'], '')}'),
                                              onPressed: _saving
                                                  ? null
                                                  : () =>
                                                      _manageRequest(request),
                                              icon: const Icon(
                                                  Icons.edit_note_outlined),
                                              label: const Text('Manage'),
                                            ),
                                          ),
                                        if (widget.canManage && terminal)
                                          const Padding(
                                            padding: EdgeInsets.fromLTRB(
                                                16, 0, 16, 10),
                                            child: Text(
                                              'Closed requests cannot be reopened or reassigned.',
                                              style: TextStyle(
                                                color: Colors.black54,
                                                fontSize: 11,
                                              ),
                                            ),
                                          ),
                                        if (!widget.canManage &&
                                            assignedToSelf &&
                                            status == 'OPEN')
                                          Align(
                                            alignment: Alignment.centerRight,
                                            child: TextButton.icon(
                                              key: Key(
                                                  'start-own-operational-request-${_text(request['_id'] ?? request['id'], '')}'),
                                              onPressed: _saving
                                                  ? null
                                                  : () => _updateOwnRequest(
                                                      request, 'IN_PROGRESS'),
                                              icon: const Icon(
                                                  Icons.play_arrow_rounded),
                                              label: const Text('Start task'),
                                            ),
                                          ),
                                        if (!widget.canManage &&
                                            assignedToSelf &&
                                            status == 'IN_PROGRESS')
                                          Align(
                                            alignment: Alignment.centerRight,
                                            child: TextButton.icon(
                                              key: Key(
                                                  'complete-own-operational-request-${_text(request['_id'] ?? request['id'], '')}'),
                                              onPressed: _saving
                                                  ? null
                                                  : () => _updateOwnRequest(
                                                      request, 'RESOLVED'),
                                              icon: const Icon(
                                                  Icons.check_circle_outline),
                                              label:
                                                  const Text('Complete task'),
                                            ),
                                          ),
                                      ],
                                    ),
                                  ),
                                );
                              },
                            ),
                          ),
      );
}

class _OperationalRequestDialog extends StatefulWidget {
  const _OperationalRequestDialog();

  @override
  State<_OperationalRequestDialog> createState() =>
      _OperationalRequestDialogState();
}

class _OperationalRequestDialogState extends State<_OperationalRequestDialog> {
  final GlobalKey<FormState> _formKey = GlobalKey<FormState>();
  final TextEditingController _type = TextEditingController(text: 'GENERAL');
  final TextEditingController _title = TextEditingController();
  final TextEditingController _description = TextEditingController();

  @override
  void dispose() {
    _type.dispose();
    _title.dispose();
    _description.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
        title: const Text('New operational request'),
        content: SizedBox(
          width: MediaQuery.sizeOf(context).width < 560
              ? MediaQuery.sizeOf(context).width * 0.78
              : 480,
          child: Form(
            key: _formKey,
            child: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: <Widget>[
                  TextFormField(
                    key: const Key('operational-request-type'),
                    controller: _type,
                    decoration: const InputDecoration(
                      labelText: 'Request type',
                      helperText: 'Use a short category, for example DELIVERY.',
                    ),
                    validator: (String? value) =>
                        value == null || value.trim().isEmpty
                            ? 'Request type is required.'
                            : null,
                  ),
                  TextFormField(
                    key: const Key('operational-request-title'),
                    controller: _title,
                    decoration:
                        const InputDecoration(labelText: 'Request title'),
                    validator: (String? value) =>
                        value == null || value.trim().isEmpty
                            ? 'A title is required.'
                            : null,
                  ),
                  TextFormField(
                    key: const Key('operational-request-description'),
                    controller: _description,
                    minLines: 2,
                    maxLines: 5,
                    decoration: const InputDecoration(
                      labelText: 'Description',
                      alignLabelWithHint: true,
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
        actions: <Widget>[
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Cancel'),
          ),
          FilledButton(
            key: const Key('submit-operational-request'),
            onPressed: () {
              if (!(_formKey.currentState?.validate() ?? false)) return;
              Navigator.pop(context, <String, String>{
                'type': _type.text.trim(),
                'title': _title.text.trim(),
                'description': _description.text.trim(),
              });
            },
            child: const Text('Submit request'),
          ),
        ],
      );
}

class _SelfRequestProgressDialog extends StatefulWidget {
  const _SelfRequestProgressDialog({
    required this.currentStatus,
    required this.nextStatus,
  });

  final String currentStatus;
  final String nextStatus;

  @override
  State<_SelfRequestProgressDialog> createState() =>
      _SelfRequestProgressDialogState();
}

class _SelfRequestProgressDialogState
    extends State<_SelfRequestProgressDialog> {
  final GlobalKey<FormState> _formKey = GlobalKey<FormState>();
  final TextEditingController _reason = TextEditingController();

  @override
  void dispose() {
    _reason.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
        title: Text(widget.nextStatus == 'RESOLVED'
            ? 'Complete assigned task'
            : 'Start assigned task'),
        content: SizedBox(
          width: MediaQuery.sizeOf(context).width < 560
              ? MediaQuery.sizeOf(context).width * 0.78
              : 440,
          child: Form(
            key: _formKey,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: <Widget>[
                Text(
                  'Status: ${widget.currentStatus.replaceAll('_', ' ')} → '
                  '${widget.nextStatus.replaceAll('_', ' ')}',
                ),
                const SizedBox(height: 12),
                TextFormField(
                  key: const Key('own-operational-request-reason'),
                  controller: _reason,
                  minLines: 2,
                  maxLines: 4,
                  maxLength: 2000,
                  decoration: const InputDecoration(
                    labelText: 'Reason',
                    helperText: 'Enter 5–2000 characters.',
                    alignLabelWithHint: true,
                  ),
                  validator: (String? value) {
                    final int length = value?.trim().length ?? 0;
                    if (length < 5 || length > 2000) {
                      return 'Reason must be 5–2000 characters.';
                    }
                    return null;
                  },
                ),
                const Text(
                  'This records task progress only; it does not approve money or activate staff.',
                  style: TextStyle(fontSize: 11, color: Colors.black54),
                ),
              ],
            ),
          ),
        ),
        actions: <Widget>[
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Cancel'),
          ),
          FilledButton(
            key: const Key('save-own-operational-request'),
            onPressed: () {
              if (!(_formKey.currentState?.validate() ?? false)) return;
              Navigator.pop(context, _reason.text.trim());
            },
            child: Text(widget.nextStatus == 'RESOLVED' ? 'Complete' : 'Start'),
          ),
        ],
      );
}

class _OperationalRequestManageDialog extends StatefulWidget {
  const _OperationalRequestManageDialog({
    required this.request,
    required this.eligibleStaff,
    required this.staffLoading,
    required this.staffError,
    required this.branchIdAvailable,
    required this.onRetryStaff,
  });

  final Map<String, dynamic> request;
  final List<BranchStaff> eligibleStaff;
  final bool staffLoading;
  final String? staffError;
  final bool branchIdAvailable;
  final VoidCallback onRetryStaff;

  @override
  State<_OperationalRequestManageDialog> createState() =>
      _OperationalRequestManageDialogState();
}

class _OperationalRequestManageDialogState
    extends State<_OperationalRequestManageDialog> {
  static const List<String> _statuses = <String>[
    'OPEN',
    'IN_PROGRESS',
    'RESOLVED',
    'CANCELLED',
  ];

  final GlobalKey<FormState> _formKey = GlobalKey<FormState>();
  final TextEditingController _reason = TextEditingController();
  late String _status;
  late String _assignment;

  @override
  void initState() {
    super.initState();
    final String current =
        '${widget.request['status'] ?? 'OPEN'}'.toUpperCase();
    _status = _statuses.contains(current) ? current : 'OPEN';
    final String assignedId =
        '${widget.request['assignedStaffId'] ?? ''}'.trim();
    _assignment = assignedId.isEmpty ? _unassigned : _keepCurrentAssignment;
  }

  @override
  void dispose() {
    _reason.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
        title: const Text('Manage operational request'),
        content: SizedBox(
          width: MediaQuery.sizeOf(context).width < 560
              ? MediaQuery.sizeOf(context).width * 0.78
              : 480,
          child: SingleChildScrollView(
            child: Form(
              key: _formKey,
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: <Widget>[
                  DropdownButtonFormField<String>(
                    key: const Key('operational-request-status'),
                    value: _status,
                    decoration:
                        const InputDecoration(labelText: 'Request status'),
                    items: _statuses
                        .map((String status) => DropdownMenuItem<String>(
                              value: status,
                              child: Text(status.replaceAll('_', ' ')),
                            ))
                        .toList(),
                    onChanged: (String? value) {
                      if (value != null) setState(() => _status = value);
                    },
                  ),
                  const SizedBox(height: 12),
                  DropdownButtonFormField<String>(
                    key: const Key('operational-request-assignee'),
                    value: _assignment,
                    decoration: const InputDecoration(
                      labelText: 'Assigned branch staff',
                      helperText:
                          'Only active staff from this branch are listed.',
                    ),
                    items: <DropdownMenuItem<String>>[
                      if ('${widget.request['assignedStaffId'] ?? ''}'
                          .trim()
                          .isNotEmpty)
                        const DropdownMenuItem<String>(
                          value: _keepCurrentAssignment,
                          child: Text('Keep current assignment'),
                        ),
                      const DropdownMenuItem<String>(
                        value: _unassigned,
                        child: Text('Unassigned'),
                      ),
                      ...widget.eligibleStaff.map(
                        (BranchStaff staff) => DropdownMenuItem<String>(
                          value: staff.id,
                          child: Text(
                            staff.name.isEmpty ? 'Branch staff' : staff.name,
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                      ),
                    ],
                    onChanged: (String? value) {
                      if (value != null) setState(() => _assignment = value);
                    },
                  ),
                  if (widget.staffLoading)
                    const Padding(
                      padding: EdgeInsets.only(top: 8),
                      child: LinearProgressIndicator(),
                    ),
                  if (widget.staffError != null)
                    Padding(
                      padding: const EdgeInsets.only(top: 6),
                      child: Row(
                        children: <Widget>[
                          Expanded(
                            child: Text(
                              'Unable to load active branch staff.',
                              style: TextStyle(
                                  color: Theme.of(context).colorScheme.error),
                            ),
                          ),
                          TextButton(
                            onPressed: widget.onRetryStaff,
                            child: const Text('Retry'),
                          ),
                        ],
                      ),
                    ),
                  if (!widget.branchIdAvailable)
                    const Padding(
                      padding: EdgeInsets.only(top: 6),
                      child: Text(
                        'Branch context is unavailable; no staff picker can be loaded.',
                        style: TextStyle(color: Colors.black54, fontSize: 12),
                      ),
                    ),
                  const SizedBox(height: 12),
                  TextFormField(
                    key: const Key('operational-request-reason'),
                    controller: _reason,
                    minLines: 2,
                    maxLines: 4,
                    maxLength: 2000,
                    decoration: const InputDecoration(
                      labelText: 'Reason',
                      helperText: 'Enter 5–2000 characters.',
                      alignLabelWithHint: true,
                    ),
                    validator: (String? value) {
                      final int length = value?.trim().length ?? 0;
                      if (length < 5 || length > 2000) {
                        return 'Reason must be 5–2000 characters.';
                      }
                      return null;
                    },
                  ),
                ],
              ),
            ),
          ),
        ),
        actions: <Widget>[
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Cancel'),
          ),
          FilledButton(
            key: const Key('save-operational-request'),
            onPressed: () {
              if (!(_formKey.currentState?.validate() ?? false)) return;
              Navigator.pop(context, <String, dynamic>{
                'status': _status,
                'assignment': _assignment,
                'reason': _reason.text.trim(),
              });
            },
            child: const Text('Save changes'),
          ),
        ],
      );
}

class _RequestsSkeleton extends StatelessWidget {
  const _RequestsSkeleton();

  @override
  Widget build(BuildContext context) => ListView(
        padding: const EdgeInsets.all(16),
        children: List<Widget>.generate(
          4,
          (_) => const Card(
            child: SizedBox(height: 88, child: LinearProgressIndicator()),
          ),
        ),
      );
}

class _RequestsError extends StatelessWidget {
  const _RequestsError({required this.message, required this.onRetry});

  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) => Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              Text(message, textAlign: TextAlign.center),
              const SizedBox(height: 12),
              OutlinedButton.icon(
                onPressed: onRetry,
                icon: const Icon(Icons.refresh),
                label: const Text('Retry'),
              ),
            ],
          ),
        ),
      );
}

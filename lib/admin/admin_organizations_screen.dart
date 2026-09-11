import 'package:flutter/material.dart';

import 'admin_organizations_api.dart';
import 'admin_permissions.dart';

String organizationStatusPermission(
  String nextStatus, {
  String? currentStatus,
}) {
  final String next = nextStatus.toUpperCase();
  final String current = currentStatus?.toUpperCase() ?? '';
  if (current == 'SUSPENDED' && next == 'VERIFIED') {
    return AdminPermissions.organizationsStatusManage;
  }
  return next == 'VERIFIED' || next == 'REJECTED'
      ? AdminPermissions.organizationsReview
      : AdminPermissions.organizationsStatusManage;
}

class AdminOrganizationsScreen extends StatefulWidget {
  const AdminOrganizationsScreen({
    super.key,
    this.api,
    this.access,
  });

  final AdminOrganizationsApiClient? api;
  final AdminAccess? access;

  @override
  State<AdminOrganizationsScreen> createState() =>
      _AdminOrganizationsScreenState();
}

class _AdminOrganizationsScreenState extends State<AdminOrganizationsScreen> {
  late final AdminOrganizationsApiClient _api =
      widget.api ?? AdminOrganizationsApi();
  AdminAccess? _access;
  bool _loading = true;
  String? _error;
  String _status = '';
  String _search = '';
  Map<String, dynamic> _summary = <String, dynamic>{};
  List<Map<String, dynamic>> _organizations = <Map<String, dynamic>>[];

  bool _can(String permission) => _access?.has(permission) ?? false;
  String _id(Map<String, dynamic> value) =>
      (value['id'] ?? value['_id'] ?? '').toString();
  String _text(dynamic value, [String fallback = '—']) =>
      value?.toString().trim().isNotEmpty == true ? value.toString() : fallback;

  @override
  void initState() {
    super.initState();
    _loadAccess();
  }

  Future<void> _loadAccess() async {
    _access = widget.access ?? await AdminSessionStore.loadAccess();
    await _load();
  }

  List<Map<String, dynamic>> _items(Map<String, dynamic> body) {
    final dynamic raw = body['organizations'] ?? body['items'] ?? body['data'];
    return raw is List
        ? raw
            .whereType<Map>()
            .map((Map e) => Map<String, dynamic>.from(e))
            .toList()
        : <Map<String, dynamic>>[];
  }

  Future<void> _load() async {
    if (!mounted) return;
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final values = await Future.wait(<Future<Map<String, dynamic>>>[
        _api.summary(),
        _api.list(status: _status.isEmpty ? null : _status, search: _search),
      ]);
      if (!mounted) return;
      setState(() {
        _summary = values[0]['summary'] is Map
            ? Map<String, dynamic>.from(values[0]['summary'] as Map)
            : values[0];
        _organizations = _items(values[1]);
        _loading = false;
      });
    } on AdminOrganizationsApiException catch (error) {
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
          _error = 'Unable to load organizations. Please try again.';
        });
      }
    }
  }

  Future<void> _statusAction(Map<String, dynamic> item, String status) async {
    if (!_can(organizationStatusPermission(
      status,
      currentStatus: item['status']?.toString(),
    ))) {
      return;
    }
    try {
      await _api.updateStatus(_id(item), status);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
              content: Text(
                  'Organization ${status.toLowerCase().replaceAll('_', ' ')}.')),
        );
      }
      await _load();
    } on AdminOrganizationsApiException catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(error.message)));
      }
    }
  }

  Future<void> _openDetails(Map<String, dynamic> item) async {
    if (!_can(AdminPermissions.organizationsView)) return;
    try {
      final response = await _api.details(_id(item));
      final details = response['organization'] is Map
          ? Map<String, dynamic>.from(response['organization'] as Map)
          : item;
      final walletResponse = await _api.wallet(_id(item));
      if (walletResponse['wallet'] is Map) {
        details['wallet'] =
            Map<String, dynamic>.from(walletResponse['wallet'] as Map);
      }
      if (!mounted) return;
      await showModalBottomSheet<void>(
        context: context,
        isScrollControlled: true,
        builder: (_) => _DetailsSheet(
          details: details,
          api: _api,
          access: _access!,
          onStatus: (String status) => _statusAction(details, status),
        ),
      );
      await _load();
    } on AdminOrganizationsApiException catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(error.message)));
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) return const Center(child: CircularProgressIndicator());
    if (_error != null) {
      return Center(
          child: Column(mainAxisSize: MainAxisSize.min, children: [
        Text(_error!),
        const SizedBox(height: 12),
        FilledButton(onPressed: _load, child: const Text('Retry')),
      ]));
    }
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          Row(children: [
            const Expanded(
                child: Text('Organizations',
                    style:
                        TextStyle(fontSize: 28, fontWeight: FontWeight.w900))),
            IconButton(onPressed: _load, icon: const Icon(Icons.refresh)),
          ]),
          const Text('Review and manage ServicePay organizations',
              style: TextStyle(color: Color(0xFF667085))),
          const SizedBox(height: 20),
          Wrap(spacing: 12, runSpacing: 12, children: [
            _metric(
                'Total', _summary['total'] ?? _summary['totalOrganizations']),
            _metric(
                'Pending verification',
                _summary['PENDING_VERIFICATION'] ??
                    _summary['pendingVerification']),
            _metric('Verified', _summary['VERIFIED'] ?? _summary['verified']),
            _metric('Suspended', _summary['suspended']),
          ]),
          const SizedBox(height: 20),
          Wrap(
              spacing: 12,
              runSpacing: 10,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                SizedBox(
                    width: 280,
                    child: TextField(
                      decoration: const InputDecoration(
                        prefixIcon: Icon(Icons.search),
                        labelText: 'Search organizations',
                        border: OutlineInputBorder(),
                      ),
                      onSubmitted: (value) {
                        _search = value.trim();
                        _load();
                      },
                    )),
                DropdownButton<String>(
                  value: _status,
                  hint: const Text('Status'),
                  items: const [
                    DropdownMenuItem(value: '', child: Text('All statuses')),
                    DropdownMenuItem(value: 'DRAFT', child: Text('Draft')),
                    DropdownMenuItem(
                        value: 'PENDING_VERIFICATION',
                        child: Text('Pending verification')),
                    DropdownMenuItem(
                        value: 'VERIFIED', child: Text('Verified')),
                    DropdownMenuItem(
                        value: 'SUSPENDED', child: Text('Suspended')),
                    DropdownMenuItem(
                        value: 'REJECTED', child: Text('Rejected')),
                  ],
                  onChanged: (value) {
                    _status = value ?? '';
                    _load();
                  },
                ),
              ]),
          const SizedBox(height: 14),
          if (_organizations.isEmpty)
            const Card(
                child: Padding(
                    padding: EdgeInsets.all(28),
                    child: Center(child: Text('No organizations found.'))))
          else
            ..._organizations.map((item) => _organizationCard(item)),
        ],
      ),
    );
  }

  Widget _metric(String label, dynamic value) => Card(
        child: SizedBox(
            width: 150,
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(label,
                        style: const TextStyle(color: Color(0xFF667085))),
                    const SizedBox(height: 6),
                    Text(_text(value, '0'),
                        style: const TextStyle(
                            fontSize: 24, fontWeight: FontWeight.w900)),
                  ]),
            )),
      );

  Widget _organizationCard(Map<String, dynamic> item) {
    final status = _text(item['status'], 'DRAFT').toUpperCase();
    return Card(
      margin: const EdgeInsets.only(bottom: 10),
      child: ListTile(
        onTap: () => _openDetails(item),
        leading: CircleAvatar(
            child:
                Text(_text(item['name'], 'O').substring(0, 1).toUpperCase())),
        title: Text(_text(item['name'], 'Unnamed organization'),
            style: const TextStyle(fontWeight: FontWeight.w800)),
        subtitle: Text(
            '${_text(item['contact'] is Map ? (item['contact'] as Map)['email'] : item['email'])} • ${_text(item['memberCount'], '0')} members'),
        trailing: Wrap(spacing: 8, children: [
          _badge(status),
          if (status == 'PENDING_VERIFICATION' &&
              _can(AdminPermissions.organizationsReview))
            IconButton(
                tooltip: 'Review',
                onPressed: () => _openDetails(item),
                icon: const Icon(Icons.fact_check_outlined)),
        ]),
      ),
    );
  }

  Widget _badge(String status) => Chip(
        label: Text(status,
            style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w800)),
        backgroundColor: status == 'VERIFIED'
            ? const Color(0xFFE6F4EA)
            : status == 'SUSPENDED'
                ? const Color(0xFFFFF1E6)
                : status == 'PENDING_VERIFICATION'
                    ? const Color(0xFFFFF4CC)
                    : const Color(0xFFF2F4F7),
      );
}

class _DetailsSheet extends StatefulWidget {
  const _DetailsSheet({
    required this.details,
    required this.api,
    required this.access,
    required this.onStatus,
  });
  final Map<String, dynamic> details;
  final AdminOrganizationsApiClient api;
  final AdminAccess access;
  final ValueChanged<String> onStatus;

  @override
  State<_DetailsSheet> createState() => _DetailsSheetState();
}

class _DetailsSheetState extends State<_DetailsSheet> {
  bool _frozen = false;
  bool _busy = false;
  List<Map<String, dynamic>> _tabItems = <Map<String, dynamic>>[];
  String _error = '';

  String get id =>
      (widget.details['id'] ?? widget.details['_id'] ?? '').toString();
  bool can(String p) => widget.access.has(p);

  @override
  void initState() {
    super.initState();
    final dynamic wallet = widget.details['wallet'];
    final String walletStatus = wallet is Map
        ? (wallet['status'] ?? '').toString().toUpperCase()
        : (widget.details['walletStatus'] ?? '').toString().toUpperCase();
    _frozen = walletStatus == 'FROZEN';
  }

  Future<void> _loadTab(int tab) async {
    setState(() {
      _busy = true;
      _error = '';
    });
    try {
      final response = tab == 0
          ? await widget.api.members(id)
          : tab == 1
              ? await widget.api.payments(id)
              : await widget.api.audit(id);
      final raw = response['members'] ??
          response['payments'] ??
          response['activity'] ??
          response['audit'] ??
          response['items'] ??
          <dynamic>[];
      if (mounted) {
        setState(() {
          _tabItems = raw is List
              ? raw
                  .whereType<Map>()
                  .map((Map e) => Map<String, dynamic>.from(e))
                  .toList()
              : <Map<String, dynamic>>[];
          _busy = false;
        });
      }
    } on AdminOrganizationsApiException catch (e) {
      if (mounted) {
        setState(() {
          _busy = false;
          _error = e.message;
        });
      }
    }
  }

  Future<void> _freeze() async {
    if (!can(AdminPermissions.organizationsWalletManage)) return;
    setState(() => _busy = true);
    try {
      await widget.api.updateWalletFreeze(id, !_frozen);
      if (mounted) {
        setState(() {
          _frozen = !_frozen;
          _busy = false;
        });
      }
    } on AdminOrganizationsApiException catch (e) {
      if (mounted) {
        setState(() {
          _busy = false;
          _error = e.message;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) => SafeArea(
          child: Padding(
        padding: const EdgeInsets.fromLTRB(20, 20, 20, 28),
        child: SingleChildScrollView(
          child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Row(children: [
                  Expanded(
                      child: Text(
                          widget.details['name']?.toString() ?? 'Organization',
                          style: const TextStyle(
                              fontSize: 22, fontWeight: FontWeight.w900))),
                  _badge((widget.details['status'] ?? 'DRAFT')
                      .toString()
                      .toUpperCase()),
                ]),
                const SizedBox(height: 14),
                _line(
                    'Type',
                    widget.details['type'] ??
                        widget.details['organizationType']),
                _line('Registration', widget.details['registrationNumber']),
                _line('Contact', (widget.details['contact'] as Map?)?['name']),
                _line('Email', (widget.details['contact'] as Map?)?['email']),
                _line('Phone', (widget.details['contact'] as Map?)?['phone']),
                const SizedBox(height: 12),
                Wrap(spacing: 8, runSpacing: 8, children: [
                  if (widget.details['status'] == 'PENDING_VERIFICATION' &&
                      can(AdminPermissions.organizationsReview))
                    FilledButton.icon(
                        onPressed: () {
                          Navigator.pop(context);
                          widget.onStatus('VERIFIED');
                        },
                        icon: const Icon(Icons.verified_outlined),
                        label: const Text('Approve / verify')),
                  if (widget.details['status'] == 'PENDING_VERIFICATION' &&
                      can(AdminPermissions.organizationsReview))
                    OutlinedButton(
                        onPressed: () {
                          Navigator.pop(context);
                          widget.onStatus('REJECTED');
                        },
                        child: const Text('Reject')),
                  if (widget.details['status'] == 'VERIFIED' &&
                      can(AdminPermissions.organizationsStatusManage))
                    OutlinedButton(
                        onPressed: () {
                          Navigator.pop(context);
                          widget.onStatus('SUSPENDED');
                        },
                        child: const Text('Suspend')),
                  if (widget.details['status'] == 'SUSPENDED' &&
                      can(AdminPermissions.organizationsStatusManage))
                    FilledButton(
                        onPressed: () {
                          Navigator.pop(context);
                          widget.onStatus('VERIFIED');
                        },
                        child: const Text('Reactivate')),
                  if (can(AdminPermissions.organizationsWalletManage))
                    OutlinedButton.icon(
                        onPressed: _busy ? null : _freeze,
                        icon: Icon(
                            _frozen ? Icons.lock_open : Icons.lock_outline),
                        label: Text(
                            _frozen ? 'Unfreeze wallet' : 'Freeze wallet')),
                ]),
                const Divider(height: 28),
                if (can(AdminPermissions.organizationsMembersView) ||
                    can(AdminPermissions.organizationsPaymentsView) ||
                    can(AdminPermissions.organizationsAuditView))
                  DefaultTabController(
                      length: 3,
                      child: Column(children: [
                        TabBar(
                            onTap: (i) {
                              if ((i == 0 &&
                                      !can(AdminPermissions
                                          .organizationsMembersView)) ||
                                  (i == 1 &&
                                      !can(AdminPermissions
                                          .organizationsPaymentsView)) ||
                                  (i == 2 &&
                                      !can(AdminPermissions
                                          .organizationsAuditView))) {
                                return;
                              }
                              _loadTab(i);
                            },
                            tabs: const [
                              Tab(text: 'Members'),
                              Tab(text: 'Payments'),
                              Tab(text: 'Audit')
                            ]),
                        if (_busy)
                          const Padding(
                              padding: EdgeInsets.all(16),
                              child: CircularProgressIndicator()),
                        if (_error.isNotEmpty) Text(_error),
                        ..._tabItems.map((item) => ListTile(
                              dense: true,
                              title: Text((item['name'] ??
                                      item['fullName'] ??
                                      item['action'] ??
                                      item['reference'] ??
                                      'Record')
                                  .toString()),
                              subtitle: Text((item['email'] ??
                                      item['status'] ??
                                      item['createdAt'] ??
                                      '')
                                  .toString()),
                            )),
                      ])),
              ]),
        ),
      ));

  Widget _line(String label, dynamic value) => Padding(
        padding: const EdgeInsets.only(bottom: 7),
        child: Row(children: [
          SizedBox(
              width: 120,
              child: Text(label,
                  style:
                      const TextStyle(color: Color(0xFF667085), fontSize: 12))),
          Expanded(
              child: Text(value?.toString() ?? '—',
                  style: const TextStyle(fontWeight: FontWeight.w600)))
        ]),
      );

  Widget _badge(String status) => Chip(
      label: Text(status,
          style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w800)),
      backgroundColor: status == 'VERIFIED'
          ? const Color(0xFFE6F4EA)
          : status == 'SUSPENDED'
              ? const Color(0xFFFFF1E6)
              : status == 'PENDING_VERIFICATION'
                  ? const Color(0xFFFFF4CC)
                  : const Color(0xFFF2F4F7));
}

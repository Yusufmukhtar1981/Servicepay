import 'dart:convert';
import 'package:flutter/material.dart';

import 'admin_permissions.dart';
import 'svp_api_service.dart';

class SvpFormPayload {
  static Map<String, dynamic> build({
    required String fullName,
    required String executiveId,
    required String email,
    required String phone,
    required String title,
    required String department,
    required String scopeType,
    List<String> permissions = const [],
    String? password,
    Map<String, dynamic>? scopeValues,
  }) {
    final scope = <String, dynamic>{'type': scopeType};
    if (scopeValues != null) {
      scope.addAll(scopeValues);
    }
    return <String, dynamic>{
      'fullName': fullName.trim(),
      'executiveId': executiveId.trim(),
      'email': email.trim(),
      'phone': phone.trim(),
      'title': title.trim(),
      'department': department.trim(),
      'permissions': permissions,
      'scope': scope,
      if (password != null && password.trim().isNotEmpty) 'password': password,
    };
  }
}

class SvpManagementScreen extends StatefulWidget {
  const SvpManagementScreen({super.key});
  @override
  State<SvpManagementScreen> createState() => _SvpManagementScreenState();
}

class _SvpManagementScreenState extends State<SvpManagementScreen> {
  final api = SvpApiService();
  List<dynamic> items = const [];
  bool loading = true;
  String filter = '';
  String status = '';
  @override
  void initState() {
    super.initState();
    load();
  }

  Future<void> load() async {
    setState(() => loading = true);
    try {
      final result = await api.request('GET', '/svp',
          query: status.isEmpty ? null : {'status': status});
      if (mounted) {
        setState(() {
          items = (result['data'] as List?) ?? const [];
          loading = false;
        });
      }
    } catch (_) {
      if (mounted) setState(() => loading = false);
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: const Text('SVP Management'), actions: [
          IconButton(onPressed: load, icon: const Icon(Icons.refresh)),
          IconButton(onPressed: () => _form(), icon: const Icon(Icons.add))
        ]),
        body: Column(children: [
          Padding(
              padding: const EdgeInsets.fromLTRB(16, 14, 16, 6),
              child: Row(children: [
                Expanded(
                    child: TextField(
                        onChanged: (v) =>
                            setState(() => filter = v.toLowerCase()),
                        decoration: const InputDecoration(
                            prefixIcon: Icon(Icons.search),
                            hintText: 'Search name, ID or email'))),
                const SizedBox(width: 8),
                DropdownButton<String>(
                    value: status,
                    underline: const SizedBox(),
                    hint: const Text('Status'),
                    items: const [
                      DropdownMenuItem(value: '', child: Text('All')),
                      DropdownMenuItem(value: 'ACTIVE', child: Text('Active')),
                      DropdownMenuItem(
                          value: 'SUSPENDED', child: Text('Suspended')),
                      DropdownMenuItem(
                          value: 'DISABLED', child: Text('Disabled'))
                    ],
                    onChanged: (v) {
                      status = v ?? '';
                      load();
                    }),
              ])),
          Expanded(
              child: loading
                  ? const Center(child: CircularProgressIndicator())
                  : items.isEmpty
                      ? const Center(child: Text('No SVP accounts found.'))
                      : ListView(
                          children: items
                              .where((x) {
                                final s =
                                    '${x['fullName']} ${x['executiveId']} ${x['email']}'
                                        .toLowerCase();
                                return s.contains(filter);
                              })
                              .map((x) => _tile(x as Map<String, dynamic>))
                              .toList())),
        ]),
        floatingActionButton: FloatingActionButton.extended(
            onPressed: () => _form(),
            icon: const Icon(Icons.person_add_alt_1),
            label: const Text('Create SVP')),
      );
  Widget _tile(Map<String, dynamic> x) => Card(
      elevation: 0,
      margin: const EdgeInsets.fromLTRB(16, 6, 16, 2),
      child: ListTile(
        title: Text('${x['fullName'] ?? 'Unnamed'}',
            style: const TextStyle(fontWeight: FontWeight.w800)),
        subtitle: Text(
            '${x['executiveId'] ?? '—'} · ${x['department'] ?? '—'}\n${x['email'] ?? '—'}'),
        isThreeLine: true,
        trailing: PopupMenuButton<String>(
            onSelected: (v) => _action(v, x),
            itemBuilder: (_) => const [
                  PopupMenuItem(value: 'edit', child: Text('Edit access')),
                  PopupMenuItem(value: 'ACTIVE', child: Text('Activate')),
                  PopupMenuItem(value: 'SUSPENDED', child: Text('Suspend')),
                  PopupMenuItem(value: 'reset', child: Text('Reset password')),
                  PopupMenuItem(value: 'revoke', child: Text('Revoke sessions'))
                ]),
      ));
  Future<void> _action(String action, Map x) async {
    try {
      if (action == 'edit') {
        return _form(existing: x);
      }
      if (action == 'reset' || action == 'revoke') {
        final password = action == 'reset' ? await _passwordDialog() : null;
        if (action == 'reset' && password == null) {
          return;
        }
        await api.request('POST',
            '/svp/${x['id']}/${action == 'reset' ? 'reset-password' : 'revoke-sessions'}',
            body: action == 'reset' ? {'password': password} : null);
      } else {
        await api.request('PATCH', '/svp/${x['id']}/status',
            body: {'status': action});
      }
      await load();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(
            content: Text(e.toString().replaceFirst('Exception: ', ''))));
      }
    }
  }

  Future<String?> _passwordDialog() async {
    final c = TextEditingController();
    return showDialog<String>(
        context: context,
        builder: (_) => AlertDialog(
                title: const Text('Reset password'),
                content: TextField(
                    controller: c,
                    obscureText: true,
                    decoration: const InputDecoration(
                        labelText: 'Strong temporary password')),
                actions: [
                  TextButton(
                      onPressed: () => Navigator.pop(context),
                      child: const Text('Cancel')),
                  FilledButton(
                      onPressed: () => Navigator.pop(context, c.text),
                      child: const Text('Reset'))
                ]));
  }

  Future<void> _form({Map? existing}) async {
    final result = await showDialog<Map<String, dynamic>>(
        context: context, builder: (_) => _SvpForm(existing: existing));
    if (result == null) {
      return;
    }
    try {
      await api.request(existing == null ? 'POST' : 'PATCH',
          existing == null ? '/svp' : '/svp/${existing['id']}',
          body: result);
      if (existing != null &&
          result['status'] != null &&
          result['status'] != existing['status']) {
        await api.request('PATCH', '/svp/${existing['id']}/status',
            body: {'status': result['status']});
      }
      await load();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(
            content: Text(e.toString().replaceFirst('Exception: ', ''))));
      }
    }
  }
}

class _SvpForm extends StatefulWidget {
  const _SvpForm({this.existing});
  final Map? existing;
  @override
  State<_SvpForm> createState() => _SvpFormState();
}

class _SvpFormState extends State<_SvpForm> {
  final form = GlobalKey<FormState>();
  late final Map<String, TextEditingController> c;
  String scopeType = 'GLOBAL';
  String initialStatus = 'ACTIVE';
  late final TextEditingController scopeValue;
  final Set<String> permissions = {};
  static const allowlist = [
    AdminPermissions.dashboardView,
    AdminPermissions.reportsView,
    AdminPermissions.reportsExport,
    AdminPermissions.auditView,
    AdminPermissions.transactionIntelligenceView,
    AdminPermissions.usersView,
    AdminPermissions.branchesView,
    AdminPermissions.deliveryView,
    AdminPermissions.financeView,
    AdminPermissions.withdrawalsView,
    AdminPermissions.kycView
  ];
  @override
  void initState() {
    super.initState();
    final x = widget.existing ?? {};
    c = {
      for (final k in [
        'fullName',
        'executiveId',
        'email',
        'phone',
        'password',
        'title',
        'department'
      ])
        k: TextEditingController(text: '${x[k] ?? ''}')
    };
    scopeType = '${(x['scope'] as Map?)?['type'] ?? 'GLOBAL'}';
    initialStatus = '${x['status'] ?? 'ACTIVE'}';
    final scope = (x['scope'] as Map?) ?? const {};
    final raw = scope['region'] ??
        scope['state'] ??
        scope['department'] ??
        (scope['branchIds'] as List?)?.join(',') ??
        (scope['products'] as List?)?.join(',') ??
        jsonEncode(scope['filters'] ?? const {});
    scopeValue = TextEditingController(
        text: raw is String ? raw : jsonEncode(scope['filters'] ?? const {}));
    permissions
        .addAll(((x['permissions'] as List?) ?? const []).cast<String>());
  }

  @override
  void dispose() {
    for (final x in c.values) {
      x.dispose();
    }
    scopeValue.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
          title: Text(widget.existing == null
              ? 'Create SVP account'
              : 'Edit SVP access'),
          content: SizedBox(
              width: 500,
              child: Form(
                  key: form,
                  child: SingleChildScrollView(
                      child: Column(children: [
                    ...[
                      'fullName',
                      'executiveId',
                      'email',
                      'phone',
                      'password',
                      'title',
                      'department'
                    ].map((k) => Padding(
                        padding: const EdgeInsets.only(bottom: 10),
                        child: TextFormField(
                            controller: c[k],
                            obscureText: k == 'password',
                            validator: (v) =>
                                widget.existing != null && k == 'password'
                                    ? null
                                    : (v == null || v.trim().isEmpty
                                        ? 'Required'
                                        : null),
                            decoration: InputDecoration(
                                labelText: k.replaceAll(
                                    RegExp(r'([A-Z])'), ' \$1'))))),
                    DropdownButtonFormField<String>(
                        value: scopeType,
                        decoration: const InputDecoration(labelText: 'Scope'),
                        items: const [
                          'GLOBAL',
                          'REGION',
                          'STATE',
                          'BRANCHES',
                          'DEPARTMENT',
                          'PRODUCTS',
                          'CUSTOM'
                        ]
                            .map((x) =>
                                DropdownMenuItem(value: x, child: Text(x)))
                            .toList(),
                        onChanged: (v) => setState(() => scopeType = v!)),
                    if (scopeType != 'GLOBAL')
                      TextFormField(
                        controller: scopeValue,
                        maxLines: scopeType == 'CUSTOM' ? 3 : 1,
                        validator: (v) =>
                            v == null || v.trim().isEmpty ? 'Required' : null,
                        decoration: InputDecoration(
                          labelText: scopeType == 'BRANCHES'
                              ? 'Branch IDs (comma separated)'
                              : scopeType == 'PRODUCTS'
                                  ? 'Products (comma separated)'
                                  : scopeType == 'CUSTOM'
                                      ? 'Filters JSON'
                                      : 'Scope value',
                          hintText: scopeType == 'CUSTOM'
                              ? '{"state":"Lagos","branchIds":[]}'
                              : null,
                        ),
                      ),
                    const SizedBox(height: 8),
                    DropdownButtonFormField<String>(
                        value: initialStatus,
                        decoration:
                            const InputDecoration(labelText: 'Initial status'),
                        items: const ['ACTIVE', 'SUSPENDED', 'DISABLED']
                            .map((x) =>
                                DropdownMenuItem(value: x, child: Text(x)))
                            .toList(),
                        onChanged: (v) =>
                            setState(() => initialStatus = v ?? 'ACTIVE')),
                    const SizedBox(height: 12),
                    const Align(
                        alignment: Alignment.centerLeft,
                        child: Text('Allowlisted permissions',
                            style: TextStyle(fontWeight: FontWeight.w800))),
                    ...allowlist.map((p) => CheckboxListTile(
                        value: permissions.contains(p),
                        dense: true,
                        title: Text(p),
                        onChanged: (v) => setState(() => v == true
                            ? permissions.add(p)
                            : permissions.remove(p)))),
                  ])))),
          actions: [
            TextButton(
                onPressed: () => Navigator.pop(context),
                child: const Text('Cancel')),
            FilledButton(
                onPressed: () {
                  if (!(form.currentState?.validate() ?? false)) return;
                  Map<String, dynamic> scopeValues = {};
                  if (scopeType == 'REGION') {
                    scopeValues = {'region': scopeValue.text.trim()};
                  } else if (scopeType == 'STATE') {
                    scopeValues = {'state': scopeValue.text.trim()};
                  } else if (scopeType == 'DEPARTMENT') {
                    scopeValues = {
                      'department': scopeValue.text.trim().toUpperCase()
                    };
                  } else if (scopeType == 'BRANCHES') {
                    scopeValues = {
                      'branchIds': scopeValue.text
                          .split(',')
                          .map((x) => x.trim())
                          .where((x) => x.isNotEmpty)
                          .toList()
                    };
                  } else if (scopeType == 'PRODUCTS') {
                    scopeValues = {
                      'products': scopeValue.text
                          .split(',')
                          .map((x) => x.trim().toUpperCase())
                          .where((x) => x.isNotEmpty)
                          .toList()
                    };
                  } else if (scopeType == 'CUSTOM') {
                    scopeValues = {
                      'filters':
                          jsonDecode(scopeValue.text) as Map<String, dynamic>
                    };
                  }
                  final payload = SvpFormPayload.build(
                    fullName: c['fullName']!.text,
                    executiveId: c['executiveId']!.text,
                    email: c['email']!.text,
                    phone: c['phone']!.text,
                    title: c['title']!.text,
                    department: c['department']!.text,
                    scopeType: scopeType,
                    permissions: permissions.toList(),
                    password: c['password']!.text,
                    scopeValues: scopeValues,
                  );
                  payload['status'] = initialStatus;
                  Navigator.pop(context, payload);
                },
                child: const Text('Save'))
          ]);
}

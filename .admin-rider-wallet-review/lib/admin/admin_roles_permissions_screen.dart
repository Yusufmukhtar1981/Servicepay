import 'package:flutter/material.dart';

import 'admin_permissions.dart';
import 'admin_roles_permissions_api.dart';

class AdminRolesPermissionsScreen extends StatefulWidget {
  const AdminRolesPermissionsScreen({
    super.key,
    this.api,
    this.access,
  });

  final AdminRolesPermissionsApi? api;
  final AdminAccess? access;

  @override
  State<AdminRolesPermissionsScreen> createState() =>
      _AdminRolesPermissionsScreenState();
}

class _AdminRolesPermissionsScreenState
    extends State<AdminRolesPermissionsScreen> {
  late final AdminRolesPermissionsApi api =
      widget.api ?? AdminRolesPermissionsApi();
  AdminAccess access = const AdminAccess(role: '', permissions: <String>{});
  final TextEditingController searchController = TextEditingController();
  List<Map<String, dynamic>> roles = <Map<String, dynamic>>[];
  List<Map<String, dynamic>> staff = <Map<String, dynamic>>[];
  List<Map<String, dynamic>> permissions = <Map<String, dynamic>>[];
  bool loading = true;
  String? error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    searchController.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() {
      loading = true;
      error = null;
    });
    try {
      access = widget.access ?? await AdminSessionStore.loadAccess();
      if (!access.has(AdminPermissions.rolesView)) {
        throw const AdminRolesApiException(
          'You do not have permission to view roles.',
          statusCode: 403,
        );
      }
      final List<dynamic> result = await Future.wait<dynamic>(<Future<dynamic>>[
        api.loadCatalog(),
        api.loadRoles(),
        if (access.has(AdminPermissions.staffView))
          api.loadStaff()
        else
          Future<List<Map<String, dynamic>>>.value(<Map<String, dynamic>>[]),
      ]);
      final Map<String, dynamic> catalog =
          Map<String, dynamic>.from(result[0] as Map);
      if (!mounted) return;
      setState(() {
        permissions = (catalog['permissions'] as List? ?? const <dynamic>[])
            .whereType<Map>()
            .map((Map value) => Map<String, dynamic>.from(value))
            .toList();
        roles = List<Map<String, dynamic>>.from(result[1] as List);
        staff = List<Map<String, dynamic>>.from(result[2] as List);
      });
    } catch (exception) {
      if (!mounted) return;
      setState(() => error = exception.toString());
    } finally {
      if (mounted) setState(() => loading = false);
    }
  }

  void _message(String text, {bool failure = false}) {
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(
        SnackBar(
          content: Text(text),
          backgroundColor:
              failure ? Colors.red.shade700 : Colors.green.shade700,
        ),
      );
  }

  List<Map<String, dynamic>> get filteredRoles {
    final String query = searchController.text.trim().toLowerCase();
    if (query.isEmpty) return roles;
    return roles.where((Map<String, dynamic> role) {
      return <dynamic>[
        role['name'],
        role['displayName'],
        role['department'],
        role['description'],
      ].any((dynamic value) => value.toString().toLowerCase().contains(query));
    }).toList();
  }

  Future<void> _editRole([Map<String, dynamic>? existing]) async {
    final bool creating = existing == null;
    final bool allowed = creating
        ? access.has(AdminPermissions.rolesCreate)
        : access.has(AdminPermissions.rolesUpdate);
    if (!allowed) {
      _message(
          'You do not have permission to ${creating ? 'create' : 'edit'} roles.',
          failure: true);
      return;
    }
    final Map<String, dynamic>? result = await showDialog<Map<String, dynamic>>(
      context: context,
      builder: (BuildContext context) => _RoleEditorDialog(
        role: existing,
        catalog: permissions,
        canAssignPermissions:
            access.has(AdminPermissions.rolesAssignPermissions),
      ),
    );
    if (result == null) return;
    try {
      if (creating) {
        await api.createRole(result);
      } else {
        await api.updateRole(existing['_id']?.toString() ?? '', result);
      }
      _message(creating ? 'Role created.' : 'Role updated.');
      await _load();
    } catch (exception) {
      _message(exception.toString(), failure: true);
    }
  }

  Future<void> _duplicateRole(Map<String, dynamic> role) async {
    if (!access.has(AdminPermissions.rolesCreate)) {
      _message('You do not have permission to duplicate roles.', failure: true);
      return;
    }
    final TextEditingController controller = TextEditingController(
      text: '${role['displayName']} Copy',
    );
    final String? displayName = await showDialog<String>(
      context: context,
      builder: (BuildContext context) => AlertDialog(
        title: const Text('Duplicate role'),
        content: TextField(
          controller: controller,
          decoration: const InputDecoration(labelText: 'New role name'),
          autofocus: true,
        ),
        actions: <Widget>[
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, controller.text.trim()),
            child: const Text('Duplicate'),
          ),
        ],
      ),
    );
    controller.dispose();
    if (displayName == null || displayName.isEmpty) return;
    final String name = displayName
        .toUpperCase()
        .replaceAll(RegExp(r'[^A-Z0-9]+'), '_')
        .replaceAll(RegExp(r'^_+|_+$'), '');
    try {
      await api.duplicateRole(
        role['_id']?.toString() ?? '',
        <String, dynamic>{'name': name, 'displayName': displayName},
      );
      _message('Role duplicated.');
      await _load();
    } catch (exception) {
      _message(exception.toString(), failure: true);
    }
  }

  Future<void> _toggleRole(Map<String, dynamic> role) async {
    if (!access.hasAny(<String>[
      AdminPermissions.rolesEnable,
      AdminPermissions.rolesUpdate,
    ])) {
      _message('You do not have permission to change role status.',
          failure: true);
      return;
    }
    final String next = role['status'] == 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
    try {
      await api.updateRole(
        role['_id']?.toString() ?? '',
        <String, dynamic>{'status': next},
      );
      _message('Role ${next == 'ACTIVE' ? 'enabled' : 'disabled'}.');
      await _load();
    } catch (exception) {
      _message(exception.toString(), failure: true);
    }
  }

  Future<void> _showAssignedStaff(Map<String, dynamic> role) async {
    try {
      final List<Map<String, dynamic>> assigned =
          await api.loadRoleStaff(role['_id']?.toString() ?? '');
      if (!mounted) return;
      await showModalBottomSheet<void>(
        context: context,
        showDragHandle: true,
        builder: (BuildContext context) => SafeArea(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(20, 4, 20, 24),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Text(
                  '${role['displayName']} staff',
                  style: Theme.of(context).textTheme.titleLarge,
                ),
                const SizedBox(height: 12),
                if (assigned.isEmpty)
                  const Text('No staff are assigned to this role.')
                else
                  Flexible(
                    child: ListView.builder(
                      shrinkWrap: true,
                      itemCount: assigned.length,
                      itemBuilder: (BuildContext context, int index) {
                        final Map<String, dynamic> person = assigned[index];
                        return ListTile(
                          leading: const CircleAvatar(
                            child: Icon(Icons.person_outline),
                          ),
                          title:
                              Text(person['fullName']?.toString() ?? 'Staff'),
                          subtitle: Text(
                            person['email']?.toString() ??
                                person['staffId']?.toString() ??
                                '',
                          ),
                        );
                      },
                    ),
                  ),
              ],
            ),
          ),
        ),
      );
    } catch (exception) {
      _message(exception.toString(), failure: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Roles & Permissions'),
        actions: <Widget>[
          IconButton(
            tooltip: 'Refresh',
            onPressed: loading ? null : _load,
            icon: const Icon(Icons.refresh),
          ),
        ],
      ),
      floatingActionButton: access.has(AdminPermissions.rolesCreate)
          ? FloatingActionButton.extended(
              onPressed: () => _editRole(),
              icon: const Icon(Icons.add),
              label: const Text('Create role'),
            )
          : null,
      body: loading
          ? const Center(child: CircularProgressIndicator())
          : error != null
              ? _AccessState(message: error!, onRetry: _load)
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView(
                    padding: const EdgeInsets.all(16),
                    children: <Widget>[
                      Text(
                        'Staff Management',
                        style: Theme.of(context).textTheme.labelLarge?.copyWith(
                              color: Colors.green.shade800,
                            ),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        '${roles.length} roles • ${staff.length} staff',
                        style:
                            Theme.of(context).textTheme.headlineSmall?.copyWith(
                                  fontWeight: FontWeight.w800,
                                ),
                      ),
                      const SizedBox(height: 16),
                      TextField(
                        controller: searchController,
                        onChanged: (_) => setState(() {}),
                        decoration: const InputDecoration(
                          prefixIcon: Icon(Icons.search),
                          labelText: 'Search roles',
                          border: OutlineInputBorder(),
                        ),
                      ),
                      const SizedBox(height: 16),
                      if (filteredRoles.isEmpty)
                        const Padding(
                          padding: EdgeInsets.all(32),
                          child: Center(
                              child: Text('No roles match your search.')),
                        )
                      else
                        ...filteredRoles.map(
                          (Map<String, dynamic> role) => _RoleCard(
                            role: role,
                            onEdit: () => _editRole(role),
                            onDuplicate: () => _duplicateRole(role),
                            onToggle: () => _toggleRole(role),
                            onAssignedStaff: () => _showAssignedStaff(role),
                            canEdit: access.has(AdminPermissions.rolesUpdate),
                            canDuplicate:
                                access.has(AdminPermissions.rolesCreate),
                            canToggle: access.hasAny(<String>[
                              AdminPermissions.rolesEnable,
                              AdminPermissions.rolesUpdate,
                            ]),
                          ),
                        ),
                      const SizedBox(height: 80),
                    ],
                  ),
                ),
    );
  }
}

class _RoleCard extends StatelessWidget {
  const _RoleCard({
    required this.role,
    required this.onEdit,
    required this.onDuplicate,
    required this.onToggle,
    required this.onAssignedStaff,
    required this.canEdit,
    required this.canDuplicate,
    required this.canToggle,
  });

  final Map<String, dynamic> role;
  final VoidCallback onEdit;
  final VoidCallback onDuplicate;
  final VoidCallback onToggle;
  final VoidCallback onAssignedStaff;
  final bool canEdit;
  final bool canDuplicate;
  final bool canToggle;

  @override
  Widget build(BuildContext context) {
    final List<dynamic> permissions =
        role['permissions'] as List? ?? const <dynamic>[];
    final bool active = role['status'] == 'ACTIVE';
    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Row(
              children: <Widget>[
                Expanded(
                  child: Text(
                    role['displayName']?.toString() ?? role['name'].toString(),
                    style: Theme.of(context).textTheme.titleMedium?.copyWith(
                          fontWeight: FontWeight.w800,
                        ),
                  ),
                ),
                Chip(
                  label: Text(active ? 'Active' : 'Disabled'),
                  backgroundColor:
                      active ? Colors.green.shade50 : Colors.grey.shade200,
                ),
                PopupMenuButton<String>(
                  onSelected: (String value) {
                    if (value == 'edit') onEdit();
                    if (value == 'duplicate') onDuplicate();
                    if (value == 'toggle') onToggle();
                  },
                  itemBuilder: (BuildContext context) =>
                      <PopupMenuEntry<String>>[
                    if (canEdit)
                      const PopupMenuItem(value: 'edit', child: Text('Edit')),
                    if (canDuplicate)
                      const PopupMenuItem(
                        value: 'duplicate',
                        child: Text('Duplicate'),
                      ),
                    if (canToggle)
                      PopupMenuItem(
                        value: 'toggle',
                        child: Text(active ? 'Disable' : 'Enable'),
                      ),
                  ],
                ),
              ],
            ),
            Text(
              '${role['department']} • ${role['scopeType'] ?? 'GLOBAL'} scope',
              style: Theme.of(context).textTheme.bodySmall,
            ),
            if ((role['description']?.toString() ?? '').isNotEmpty) ...<Widget>[
              const SizedBox(height: 8),
              Text(role['description'].toString()),
            ],
            const SizedBox(height: 12),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: <Widget>[
                ActionChip(
                  avatar: const Icon(Icons.people_outline, size: 18),
                  label: Text('${role['assignedStaffCount'] ?? 0} staff'),
                  onPressed: onAssignedStaff,
                ),
                Chip(label: Text('${permissions.length} permissions')),
                if (role['isSystemRole'] == true)
                  const Chip(label: Text('System role')),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _RoleEditorDialog extends StatefulWidget {
  const _RoleEditorDialog({
    required this.role,
    required this.catalog,
    required this.canAssignPermissions,
  });

  final Map<String, dynamic>? role;
  final List<Map<String, dynamic>> catalog;
  final bool canAssignPermissions;

  @override
  State<_RoleEditorDialog> createState() => _RoleEditorDialogState();
}

class _RoleEditorDialogState extends State<_RoleEditorDialog> {
  late final TextEditingController displayName = TextEditingController(
    text: widget.role?['displayName']?.toString() ?? '',
  );
  late final TextEditingController description = TextEditingController(
    text: widget.role?['description']?.toString() ?? '',
  );
  late String department =
      widget.role?['department']?.toString() ?? 'OPERATIONS';
  late String scopeType = widget.role?['scopeType']?.toString() ?? 'GLOBAL';
  late final Set<String> selected =
      (widget.role?['permissions'] as List? ?? const <dynamic>[])
          .map((dynamic value) => value.toString())
          .toSet();

  Map<String, List<Map<String, dynamic>>> get grouped {
    final Map<String, List<Map<String, dynamic>>> result =
        <String, List<Map<String, dynamic>>>{};
    for (final Map<String, dynamic> item in widget.catalog) {
      result
          .putIfAbsent(
            item['module'].toString(),
            () => <Map<String, dynamic>>[],
          )
          .add(item);
    }
    return result;
  }

  @override
  void dispose() {
    displayName.dispose();
    description.dispose();
    super.dispose();
  }

  void _submit() {
    final String label = displayName.text.trim();
    if (label.isEmpty || selected.isEmpty) return;
    final String name = widget.role?['name']?.toString() ??
        label
            .toUpperCase()
            .replaceAll(RegExp(r'[^A-Z0-9]+'), '_')
            .replaceAll(RegExp(r'^_+|_+$'), '');
    Navigator.pop(context, <String, dynamic>{
      'name': name,
      'displayName': label,
      'description': description.text.trim(),
      'department': department,
      'scopeType': scopeType,
      'permissions': selected.toList()..sort(),
    });
  }

  @override
  Widget build(BuildContext context) {
    return Dialog(
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 760, maxHeight: 760),
        child: Column(
          children: <Widget>[
            Padding(
              padding: const EdgeInsets.fromLTRB(24, 20, 16, 12),
              child: Row(
                children: <Widget>[
                  Expanded(
                    child: Text(
                      widget.role == null ? 'Create role' : 'Edit role',
                      style: Theme.of(context).textTheme.headlineSmall,
                    ),
                  ),
                  IconButton(
                    onPressed: () => Navigator.pop(context),
                    icon: const Icon(Icons.close),
                  ),
                ],
              ),
            ),
            Expanded(
              child: ListView(
                padding: const EdgeInsets.symmetric(horizontal: 24),
                children: <Widget>[
                  TextField(
                    controller: displayName,
                    decoration: const InputDecoration(
                      labelText: 'Role name',
                      border: OutlineInputBorder(),
                    ),
                  ),
                  const SizedBox(height: 12),
                  TextField(
                    controller: description,
                    decoration: const InputDecoration(
                      labelText: 'Description',
                      border: OutlineInputBorder(),
                    ),
                  ),
                  const SizedBox(height: 12),
                  Row(
                    children: <Widget>[
                      Expanded(
                        child: DropdownButtonFormField<String>(
                          value: department,
                          decoration: const InputDecoration(
                            labelText: 'Department',
                            border: OutlineInputBorder(),
                          ),
                          items: const <String>[
                            'ADMINISTRATION',
                            'OPERATIONS',
                            'DELIVERY',
                            'FINANCE',
                            'AUDIT',
                            'COMPLIANCE',
                            'CUSTOMER_SUPPORT',
                          ]
                              .map((String value) => DropdownMenuItem<String>(
                                    value: value,
                                    child: Text(value.replaceAll('_', ' ')),
                                  ))
                              .toList(),
                          onChanged: (String? value) =>
                              setState(() => department = value ?? department),
                        ),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: DropdownButtonFormField<String>(
                          value: scopeType,
                          decoration: const InputDecoration(
                            labelText: 'Data scope',
                            border: OutlineInputBorder(),
                          ),
                          items: const <String>[
                            'GLOBAL',
                            'ZONE',
                            'STATE',
                            'BUSINESS_PARTNER',
                            'SELF',
                          ]
                              .map((String value) => DropdownMenuItem<String>(
                                    value: value,
                                    child: Text(value.replaceAll('_', ' ')),
                                  ))
                              .toList(),
                          onChanged: (String? value) =>
                              setState(() => scopeType = value ?? scopeType),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 20),
                  Text(
                    'Permissions',
                    style: Theme.of(context).textTheme.titleLarge,
                  ),
                  const SizedBox(height: 8),
                  ...grouped.entries.map(
                      (MapEntry<String, List<Map<String, dynamic>>> entry) {
                    final Set<String> moduleValues = entry.value
                        .map((Map<String, dynamic> item) =>
                            item['value'].toString())
                        .toSet();
                    return ExpansionTile(
                      title: Text(entry.key.replaceAll('_', ' ')),
                      subtitle: Text(
                        '${moduleValues.where(selected.contains).length}/${moduleValues.length} selected',
                      ),
                      trailing: widget.canAssignPermissions
                          ? Wrap(
                              spacing: 4,
                              children: <Widget>[
                                TextButton(
                                  onPressed: () => setState(
                                      () => selected.addAll(moduleValues)),
                                  child: const Text('Select all'),
                                ),
                                TextButton(
                                  onPressed: () => setState(
                                    () => selected.removeAll(moduleValues),
                                  ),
                                  child: const Text('Clear'),
                                ),
                              ],
                            )
                          : null,
                      children: entry.value.map((Map<String, dynamic> item) {
                        final String value = item['value'].toString();
                        return CheckboxListTile(
                          value: selected.contains(value),
                          onChanged: widget.canAssignPermissions
                              ? (bool? checked) => setState(() {
                                    if (checked == true) {
                                      selected.add(value);
                                    } else {
                                      selected.remove(value);
                                    }
                                  })
                              : null,
                          title: Text(item['label']?.toString() ?? value),
                          subtitle: Text(item['description']?.toString() ?? ''),
                          secondary: item['risk'] == 'CRITICAL'
                              ? const Icon(Icons.warning_amber,
                                  color: Colors.orange)
                              : null,
                        );
                      }).toList(),
                    );
                  }),
                ],
              ),
            ),
            Padding(
              padding: const EdgeInsets.all(16),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.end,
                children: <Widget>[
                  TextButton(
                    onPressed: () => Navigator.pop(context),
                    child: const Text('Cancel'),
                  ),
                  const SizedBox(width: 8),
                  FilledButton(
                    onPressed: selected.isEmpty ? null : _submit,
                    child: const Text('Save role'),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _AccessState extends StatelessWidget {
  const _AccessState({required this.message, required this.onRetry});

  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            const Icon(Icons.lock_outline, size: 48),
            const SizedBox(height: 12),
            Text(message, textAlign: TextAlign.center),
            const SizedBox(height: 16),
            OutlinedButton(onPressed: onRetry, child: const Text('Try again')),
          ],
        ),
      ),
    );
  }
}

import 'dart:convert';
import 'dart:math';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

import 'feature_transaction_pin_dialog.dart';

class GroupWalletScreen extends StatefulWidget {
  const GroupWalletScreen({super.key});

  @override
  State<GroupWalletScreen> createState() => _GroupWalletScreenState();
}

class _GroupWalletScreenState extends State<GroupWalletScreen> {
  static const _baseUrl = 'https://api.servicepay.ng/api';
  static const _green = Color(0xFF08783E);
  static const _surface = Color(0xFFF4F8F5);

  final _nameController = TextEditingController();
  final _amountController = TextEditingController();
  final _descriptionController = TextEditingController();
  final _random = Random.secure();

  String _frequency = 'MONTHLY';
  bool _submitting = false;
  bool _loading = true;
  List<Map<String, dynamic>> _ledGroups = [];
  List<Map<String, dynamic>> _memberGroups = [];

  @override
  void initState() {
    super.initState();
    _loadGroups();
  }

  @override
  void dispose() {
    _nameController.dispose();
    _amountController.dispose();
    _descriptionController.dispose();
    super.dispose();
  }

  Future<String> _token() async {
    final prefs = await SharedPreferences.getInstance();
    for (final key in const [
      'auth_token',
      'token',
      'access_token',
      'accessToken',
      'jwt_token',
      'jwt',
    ]) {
      final value = prefs.getString(key);
      if (value != null && value.trim().isNotEmpty) {
        return value.replaceFirst('Bearer ', '').trim();
      }
    }
    return '';
  }

  Future<Map<String, dynamic>> _request(
    String method,
    String path, {
    Map<String, dynamic>? body,
  }) async {
    final token = await _token();
    final headers = <String, String>{
      'Authorization': 'Bearer $token',
      'Accept': 'application/json',
      if (body != null) 'Content-Type': 'application/json',
    };
    final uri = Uri.parse('$_baseUrl/servicepay-features$path');
    late http.Response response;
    switch (method) {
      case 'POST':
        response = await http.post(uri, headers: headers, body: jsonEncode(body));
        break;
      case 'PATCH':
        response = await http.patch(uri, headers: headers, body: jsonEncode(body));
        break;
      case 'DELETE':
        response = await http.delete(uri, headers: headers);
        break;
      default:
        response = await http.get(uri, headers: headers);
    }
    final decoded = response.body.isNotEmpty ? jsonDecode(response.body) : <String, dynamic>{};
    final data = decoded is Map ? Map<String, dynamic>.from(decoded) : <String, dynamic>{};
    data['_statusCode'] = response.statusCode;
    return data;
  }

  bool _ok(Map<String, dynamic> data) =>
      data['_statusCode'] is int &&
      (data['_statusCode'] as int) >= 200 &&
      (data['_statusCode'] as int) < 300 &&
      data['success'] == true;

  List<Map<String, dynamic>> _maps(dynamic value) => value is List
      ? value.whereType<Map>().map((item) => Map<String, dynamic>.from(item)).toList()
      : <Map<String, dynamic>>[];

  Future<void> _loadGroups() async {
    if (mounted) setState(() => _loading = true);
    try {
      final data = await _request('GET', '/groups');
      if (!_ok(data)) throw Exception();
      final all = _maps(data['groups']);
      if (!mounted) return;
      setState(() {
        _ledGroups = _maps(data['groupsILead']);
        _memberGroups = _maps(data['groupsIBelongTo']);
        if (_ledGroups.isEmpty && _memberGroups.isEmpty && all.isNotEmpty) {
          _ledGroups = all.where((group) => group['isLeader'] == true).toList();
          _memberGroups = all.where((group) => group['isLeader'] != true).toList();
        }
      });
    } catch (_) {
      _message('Unable to refresh your Ajo groups.');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _createGroup() async {
    final amount = double.tryParse(_amountController.text.trim()) ?? 0;
    if (_nameController.text.trim().isEmpty || amount <= 0) {
      _message('Enter a group name and contribution amount.');
      return;
    }
    setState(() => _submitting = true);
    try {
      final data = await _request('POST', '/groups', body: {
        'name': _nameController.text.trim(),
        'description': _descriptionController.text.trim(),
        'contributionAmount': amount,
        'frequency': _frequency,
      });
      _message(data['message']?.toString() ?? 'Group created.');
      if (_ok(data)) {
        _nameController.clear();
        _amountController.clear();
        _descriptionController.clear();
        await _loadGroups();
      }
    } catch (_) {
      _message('Unable to create the group.');
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  Future<void> _addMember(Map<String, dynamic> group) async {
    final id = group['_id']?.toString() ?? '';
    if (id.isEmpty) return;
    final controller = TextEditingController();
    final value = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Add member'),
        content: TextField(
          controller: controller,
          keyboardType: TextInputType.phone,
          decoration: const InputDecoration(
            labelText: 'ServicePay phone number or member ID',
            border: OutlineInputBorder(),
          ),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context), child: const Text('Cancel')),
          FilledButton(
            onPressed: () => Navigator.pop(context, controller.text.trim()),
            child: const Text('Add'),
          ),
        ],
      ),
    );
    controller.dispose();
    if (value == null || value.isEmpty) return;
    try {
      final memberLookup = RegExp(r'^[a-fA-F0-9]{24}$').hasMatch(value)
          ? <String, dynamic>{'userId': value}
          : <String, dynamic>{'phone': value};
      final data = await _request('POST', '/groups/$id/members', body: memberLookup);
      _message(data['message']?.toString() ?? 'Member added.');
      if (_ok(data)) await _loadGroups();
    } catch (_) {
      _message('Unable to add this member.');
    }
  }

  Future<void> _contribute(Map<String, dynamic> group) async {
    final id = group['_id']?.toString() ?? '';
    if (id.isEmpty || group['status']?.toString() != 'ACTIVE') return;
    final pin = await showFeatureTransactionPinDialog(
      context,
      title: 'Ajo contribution',
      message: 'Contribute ${_money(group['contributionAmount'])} to ${_name(group)}.',
    );
    if (pin == null) return;
    try {
      final data = await _request('POST', '/groups/$id/contribute', body: {
        'transactionPin': pin,
        'idempotencyKey': '${DateTime.now().microsecondsSinceEpoch}-${_random.nextInt(1 << 32)}',
      });
      _message(data['message']?.toString() ?? 'Contribution completed.');
      if (_ok(data)) await _loadGroups();
    } catch (_) {
      _message('Unable to complete your contribution.');
    }
  }

  Future<void> _removeMember(Map<String, dynamic> group, Map<String, dynamic> member) async {
    final groupId = group['_id']?.toString() ?? '';
    final memberId = member['userId']?.toString() ?? '';
    if (groupId.isEmpty || memberId.isEmpty) return;
    final confirmed = await _confirm('Remove member?', 'Their contribution history will remain in the group.');
    if (!confirmed) return;
    try {
      final data = await _request('DELETE', '/groups/$groupId/members/$memberId');
      _message(data['message']?.toString() ?? 'Member removed.');
      if (_ok(data)) {
        await _loadGroups();
        if (mounted) Navigator.pop(context);
      }
    } catch (_) {
      _message('Unable to remove this member.');
    }
  }

  Future<void> _leaveGroup(Map<String, dynamic> group) async {
    final id = group['_id']?.toString() ?? '';
    if (id.isEmpty || !await _confirm('Leave this group?', 'You will no longer be able to contribute. Your history remains available.')) return;
    try {
      final data = await _request('POST', '/groups/$id/leave', body: const {});
      _message(data['message']?.toString() ?? 'You left the group.');
      if (_ok(data)) {
        await _loadGroups();
        if (mounted) Navigator.pop(context);
      }
    } catch (_) {
      _message('Unable to leave this group.');
    }
  }

  Future<void> _groupAction(Map<String, dynamic> group, String action) async {
    final id = group['_id']?.toString() ?? '';
    if (id.isEmpty) return;
    final destructive = action == 'CANCEL' || action == 'COMPLETE';
    if (destructive && !await _confirm('${action == 'CANCEL' ? 'Cancel' : 'Complete'} group?', 'This is only allowed when the pooled balance is zero.')) return;
    try {
      final data = await _request('PATCH', '/groups/$id', body: {'action': action});
      _message(data['message']?.toString() ?? 'Group updated.');
      if (_ok(data)) {
        await _loadGroups();
        if (mounted) Navigator.pop(context);
      }
    } catch (_) {
      _message('Unable to update this group.');
    }
  }

  Future<void> _editGroup(Map<String, dynamic> group) async {
    final id = group['_id']?.toString() ?? '';
    if (id.isEmpty) return;
    final name = TextEditingController(text: _name(group));
    final description = TextEditingController(text: group['description']?.toString() ?? '');
    final values = await showDialog<Map<String, String>>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Edit group'),
        content: Column(mainAxisSize: MainAxisSize.min, children: [
          TextField(controller: name, decoration: const InputDecoration(labelText: 'Group name')),
          const SizedBox(height: 12),
          TextField(controller: description, maxLines: 2, decoration: const InputDecoration(labelText: 'Description')),
        ]),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(context, {'name': name.text.trim(), 'description': description.text.trim()}), child: const Text('Save')),
        ],
      ),
    );
    name.dispose();
    description.dispose();
    if (values == null || values['name']!.isEmpty) return;
    try {
      final data = await _request('PATCH', '/groups/$id', body: values);
      _message(data['message']?.toString() ?? 'Group updated.');
      if (_ok(data)) {
        await _loadGroups();
        if (mounted) Navigator.pop(context);
      }
    } catch (_) {
      _message('Unable to update this group.');
    }
  }

  Future<void> _showDetails(Map<String, dynamic> source) async {
    final id = source['_id']?.toString() ?? '';
    if (id.isEmpty) return;
    try {
      final data = await _request('GET', '/groups/$id');
      if (!_ok(data)) {
        _message(data['message']?.toString() ?? 'Unable to open this group.');
        return;
      }
      final group = data['group'] is Map ? Map<String, dynamic>.from(data['group']) : source;
      final contributions = _maps(data['contributions']);
      final ledger = _maps(data['ledger']);
      final activity = _maps(data['activity']);
      if (!mounted) return;
      await showModalBottomSheet<void>(
        context: context,
        isScrollControlled: true,
        backgroundColor: Colors.transparent,
        builder: (context) => _GroupDetailSheet(
          group: group,
          contributions: contributions,
          ledger: ledger,
          activity: activity,
          onAddMember: () => _addMember(group),
          onContribute: () => _contribute(group),
          onRemoveMember: (member) => _removeMember(group, member),
          onLeave: () => _leaveGroup(group),
          onAction: (action) => _groupAction(group, action),
          onEdit: () => _editGroup(group),
        ),
      );
    } catch (_) {
      _message('Unable to load group details.');
    }
  }

  Future<bool> _confirm(String title, String message) async =>
      await showDialog<bool>(
        context: context,
        builder: (context) => AlertDialog(
          title: Text(title),
          content: Text(message),
          actions: [
            TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Keep')),
            FilledButton(onPressed: () => Navigator.pop(context, true), child: const Text('Continue')),
          ],
        ),
      ) ??
      false;

  String _name(Map<String, dynamic> group) => group['groupName']?.toString() ?? group['name']?.toString() ?? 'Ajo group';
  String _money(dynamic value) => '₦${(num.tryParse(value?.toString() ?? '') ?? 0).toStringAsFixed(0)}';
  String _initials(String value) => value.trim().split(RegExp(r'\s+')).where((word) => word.isNotEmpty).take(2).map((word) => word[0]).join().toUpperCase();
  void _message(String message) {
    if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message)));
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: _surface,
      appBar: AppBar(
        title: const Text('Group Wallet / Ajo'),
        backgroundColor: Colors.white,
        foregroundColor: Colors.black87,
        actions: [IconButton(onPressed: _loading ? null : _loadGroups, icon: const Icon(Icons.refresh_rounded), tooltip: 'Refresh')],
      ),
      body: RefreshIndicator(
        onRefresh: _loadGroups,
        child: ListView(
          padding: const EdgeInsets.all(18),
          children: [
            _hero(),
            const SizedBox(height: 16),
            _createCard(),
            const SizedBox(height: 26),
            _groupSection('Groups I Lead', _ledGroups, leader: true),
            const SizedBox(height: 22),
            _groupSection('Groups I Belong To', _memberGroups, leader: false),
            const SizedBox(height: 24),
          ],
        ),
      ),
    );
  }

  Widget _hero() => Container(
        padding: const EdgeInsets.all(20),
        decoration: BoxDecoration(color: _green, borderRadius: BorderRadius.circular(24)),
        child: const Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Icon(Icons.savings_rounded, color: Colors.white, size: 30),
          SizedBox(height: 18),
          Text('Contribute together with clarity.', style: TextStyle(color: Colors.white, fontSize: 22, fontWeight: FontWeight.w800)),
          SizedBox(height: 7),
          Text('Every contribution is protected by your transaction PIN and recorded in the group ledger.', style: TextStyle(color: Color(0xFFE0F2E7), height: 1.4)),
        ]),
      );

  Widget _createCard() => Card(
        elevation: 0,
        color: Colors.white,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
        child: ExpansionTile(
          leading: const CircleAvatar(backgroundColor: Color(0xFFE0F2E7), child: Icon(Icons.add_circle_outline_rounded, color: _green)),
          title: const Text('Start a new contribution group', style: TextStyle(fontWeight: FontWeight.w800)),
          subtitle: const Text('You will be the group leader'),
          childrenPadding: const EdgeInsets.fromLTRB(18, 4, 18, 18),
          children: [
            TextField(controller: _nameController, decoration: const InputDecoration(labelText: 'Group name', border: OutlineInputBorder())),
            const SizedBox(height: 12),
            TextField(controller: _amountController, keyboardType: const TextInputType.numberWithOptions(decimal: true), decoration: const InputDecoration(labelText: 'Contribution amount', prefixText: '₦ ', border: OutlineInputBorder())),
            const SizedBox(height: 12),
            DropdownButtonFormField<String>(
              value: _frequency,
              decoration: const InputDecoration(labelText: 'Contribution frequency', border: OutlineInputBorder()),
              items: const [
                DropdownMenuItem(value: 'DAILY', child: Text('Daily')),
                DropdownMenuItem(value: 'WEEKLY', child: Text('Weekly')),
                DropdownMenuItem(value: 'MONTHLY', child: Text('Monthly')),
              ],
              onChanged: (value) => value == null ? null : setState(() => _frequency = value),
            ),
            const SizedBox(height: 12),
            TextField(controller: _descriptionController, maxLines: 2, decoration: const InputDecoration(labelText: 'Description (optional)', border: OutlineInputBorder())),
            const SizedBox(height: 14),
            FilledButton.icon(
              onPressed: _submitting ? null : _createGroup,
              style: FilledButton.styleFrom(backgroundColor: _green, minimumSize: const Size.fromHeight(48)),
              icon: const Icon(Icons.groups_rounded),
              label: Text(_submitting ? 'Creating group...' : 'Create group'),
            ),
          ],
        ),
      );

  Widget _groupSection(String title, List<Map<String, dynamic>> groups, {required bool leader}) {
    if (_loading) return const Center(child: Padding(padding: EdgeInsets.all(24), child: CircularProgressIndicator()));
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Text(title, style: const TextStyle(fontSize: 19, fontWeight: FontWeight.w800)),
      const SizedBox(height: 10),
      if (groups.isEmpty)
        Container(
          width: double.infinity,
          padding: const EdgeInsets.all(18),
          decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(16)),
          child: Text(leader ? 'You are not leading any groups yet.' : 'You have not joined any contribution groups yet.', style: const TextStyle(color: Colors.black54)),
        )
      else
        ...groups.map(_groupCard),
    ]);
  }

  Widget _groupCard(Map<String, dynamic> group) {
    final members = _maps(group['members']);
    final amount = num.tryParse(group['contributionAmount']?.toString() ?? '') ?? 0;
    final total = num.tryParse(group['groupBalance']?.toString() ?? group['totalCollected']?.toString() ?? '') ?? 0;
    final target = (amount * (members.where((member) => member['membershipStatus'] == 'ACTIVE').length)).toDouble();
    final progress = target > 0 ? (total / target).clamp(0, 1).toDouble() : 0.0;
    final leader = group['leader'] is Map ? Map<String, dynamic>.from(group['leader']) : <String, dynamic>{};
    return Card(
      margin: const EdgeInsets.only(bottom: 10),
      elevation: 0,
      color: Colors.white,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18)),
      child: InkWell(
        borderRadius: BorderRadius.circular(18),
        onTap: () => _showDetails(group),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(children: [
              CircleAvatar(backgroundColor: const Color(0xFFE0F2E7), foregroundColor: _green, child: Text(_initials(_name(group)).isEmpty ? 'A' : _initials(_name(group)))),
              const SizedBox(width: 11),
              Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(_name(group), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16)),
                Text(group['isLeader'] == true ? 'You lead this group' : 'Led by ${leader['fullName'] ?? 'Group leader'}', style: const TextStyle(color: Colors.black54, fontSize: 12)),
              ])),
              _StatusChip(status: group['status']?.toString() ?? 'ACTIVE'),
            ]),
            const SizedBox(height: 16),
            Row(children: [
              Expanded(child: _amountLabel('Group balance', _money(total))),
              Expanded(child: _amountLabel('Your contribution', _money(group['myTotalContribution']))),
            ]),
            const SizedBox(height: 12),
            LinearProgressIndicator(value: progress, minHeight: 7, borderRadius: BorderRadius.circular(8), color: _green, backgroundColor: const Color(0xFFE8F0EA)),
            const SizedBox(height: 8),
            Text('${_money(amount)} • ${group['frequency'] ?? 'MONTHLY'} • ${group['memberCount'] ?? members.length} member(s)', style: const TextStyle(color: Colors.black54, fontSize: 12)),
          ]),
        ),
      ),
    );
  }

  Widget _amountLabel(String label, String value) => Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(label, style: const TextStyle(color: Colors.black54, fontSize: 12)),
        const SizedBox(height: 3),
        Text(value, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
      ]);
}

class _StatusChip extends StatelessWidget {
  const _StatusChip({required this.status});
  final String status;

  @override
  Widget build(BuildContext context) {
    final active = status == 'ACTIVE';
    final color = active ? const Color(0xFF08783E) : const Color(0xFF9A5A00);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 5),
      decoration: BoxDecoration(color: color.withValues(alpha: 0.1), borderRadius: BorderRadius.circular(20)),
      child: Text(status, style: TextStyle(color: color, fontWeight: FontWeight.w700, fontSize: 11)),
    );
  }
}

class _GroupDetailSheet extends StatelessWidget {
  const _GroupDetailSheet({
    required this.group,
    required this.contributions,
    required this.ledger,
    required this.activity,
    required this.onAddMember,
    required this.onContribute,
    required this.onRemoveMember,
    required this.onLeave,
    required this.onAction,
    required this.onEdit,
  });

  final Map<String, dynamic> group;
  final List<Map<String, dynamic>> contributions;
  final List<Map<String, dynamic>> ledger;
  final List<Map<String, dynamic>> activity;
  final VoidCallback onAddMember;
  final VoidCallback onContribute;
  final ValueChanged<Map<String, dynamic>> onRemoveMember;
  final VoidCallback onLeave;
  final ValueChanged<String> onAction;
  final VoidCallback onEdit;

  String _name() => group['groupName']?.toString() ?? group['name']?.toString() ?? 'Ajo group';
  String _money(dynamic value) => '₦${(num.tryParse(value?.toString() ?? '') ?? 0).toStringAsFixed(0)}';
  List<Map<String, dynamic>> _maps(dynamic value) => value is List ? value.whereType<Map>().map((item) => Map<String, dynamic>.from(item)).toList() : [];

  @override
  Widget build(BuildContext context) {
    final leader = group['isLeader'] == true;
    final active = group['status']?.toString() == 'ACTIVE';
    final members = _maps(group['members']);
    return SafeArea(
      top: false,
      child: Container(
        height: MediaQuery.of(context).size.height * .9,
        decoration: const BoxDecoration(color: Color(0xFFF8FAF8), borderRadius: BorderRadius.vertical(top: Radius.circular(28))),
        child: ListView(padding: const EdgeInsets.fromLTRB(20, 12, 20, 28), children: [
          Center(child: Container(width: 42, height: 4, decoration: BoxDecoration(color: Colors.black26, borderRadius: BorderRadius.circular(8)))),
          const SizedBox(height: 18),
          Row(children: [
            Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(_name(), style: const TextStyle(fontSize: 24, fontWeight: FontWeight.w900)),
              const SizedBox(height: 5),
              Text('${_money(group['contributionAmount'])} • ${group['frequency'] ?? 'MONTHLY'}', style: const TextStyle(color: Colors.black54)),
              if (group['nextContributionDate'] != null)
                Text('Next contribution: ${group['nextContributionDate'].toString().split('T').first}', style: const TextStyle(color: Colors.black54, fontSize: 12)),
            ])),
            _StatusChip(status: group['status']?.toString() ?? 'ACTIVE'),
          ]),
          if ((group['description']?.toString() ?? '').isNotEmpty) ...[
            const SizedBox(height: 8),
            Text(group['description'].toString(), style: const TextStyle(color: Colors.black54)),
          ],
          const SizedBox(height: 18),
          Row(children: [
            Expanded(child: _metric('Pooled balance', _money(group['groupBalance']))),
            const SizedBox(width: 10),
            Expanded(child: _metric('Your total', _money(group['myTotalContribution']))),
          ]),
          const SizedBox(height: 18),
          if (active) FilledButton.icon(onPressed: onContribute, style: FilledButton.styleFrom(backgroundColor: const Color(0xFF08783E), minimumSize: const Size.fromHeight(48)), icon: const Icon(Icons.payments_rounded), label: const Text('Contribute now')),
          if (leader) ...[
            const SizedBox(height: 10),
            Wrap(spacing: 8, runSpacing: 8, children: [
              OutlinedButton.icon(onPressed: active ? onAddMember : null, icon: const Icon(Icons.person_add_alt_1_rounded), label: const Text('Add member')),
              OutlinedButton.icon(onPressed: onEdit, icon: const Icon(Icons.edit_outlined), label: const Text('Edit')),
              OutlinedButton.icon(onPressed: () => onAction(active ? 'PAUSE' : 'RESUME'), icon: Icon(active ? Icons.pause_circle_outline : Icons.play_circle_outline), label: Text(active ? 'Pause' : 'Resume')),
              if ((num.tryParse(group['groupBalance']?.toString() ?? '') ?? 0) == 0)
                OutlinedButton.icon(onPressed: () => onAction('CANCEL'), icon: const Icon(Icons.cancel_outlined), label: const Text('Cancel')),
            ]),
          ] else ...[
            const SizedBox(height: 10),
            TextButton.icon(onPressed: onLeave, icon: const Icon(Icons.exit_to_app_rounded), label: const Text('Leave group')),
          ],
          const SizedBox(height: 26),
          _sectionTitle('Members (${members.length})'),
          ...members.map((member) {
            final memberLeader = member['role'] == 'LEADER';
            final state = member['membershipStatus']?.toString() ?? 'ACTIVE';
            final memberName = member['fullName']?.toString() ?? member['phone']?.toString() ?? 'Member';
            return ListTile(
              contentPadding: EdgeInsets.zero,
              leading: CircleAvatar(backgroundColor: const Color(0xFFE0F2E7), foregroundColor: const Color(0xFF08783E), child: Text(memberName.substring(0, 1).toUpperCase())),
              title: Text(memberName, style: const TextStyle(fontWeight: FontWeight.w700)),
              subtitle: Text('${memberLeader ? 'Leader • ' : ''}${_money(member['totalContributed'])} contributed • $state'),
              trailing: leader && !memberLeader && state == 'ACTIVE' ? IconButton(icon: const Icon(Icons.person_remove_outlined), tooltip: 'Remove member', onPressed: () => onRemoveMember(member)) : null,
            );
          }),
          const SizedBox(height: 22),
          _sectionTitle('Contribution history'),
          if (contributions.isEmpty)
            const Padding(padding: EdgeInsets.symmetric(vertical: 12), child: Text('No contributions have been recorded yet.', style: TextStyle(color: Colors.black54)))
          else
            ...contributions.map((item) {
              final member = item['member'] is Map ? Map<String, dynamic>.from(item['member']) : <String, dynamic>{};
              return ListTile(
                contentPadding: EdgeInsets.zero,
                leading: const CircleAvatar(backgroundColor: Color(0xFFE0F2E7), child: Icon(Icons.payments_rounded, color: Color(0xFF08783E))),
                title: Text(_money(item['amount']), style: const TextStyle(fontWeight: FontWeight.w800)),
                subtitle: Text('${member['fullName'] ?? member['phone'] ?? 'Member'} • ${item['reference'] ?? ''}'),
              );
            }),
          const SizedBox(height: 22),
          _sectionTitle('Pooled ledger'),
          if (ledger.isEmpty)
            const Padding(padding: EdgeInsets.symmetric(vertical: 12), child: Text('No ledger entries yet.', style: TextStyle(color: Colors.black54)))
          else
            ...ledger.map((item) => ListTile(
              contentPadding: EdgeInsets.zero,
              leading: const CircleAvatar(backgroundColor: Color(0xFFE0F2E7), child: Icon(Icons.account_balance_wallet_outlined, color: Color(0xFF08783E))),
              title: Text('${item['type'] ?? 'CREDIT'} • ${_money(item['amount'])}', style: const TextStyle(fontWeight: FontWeight.w800)),
              subtitle: Text('Balance after: ${_money(item['balanceAfter'])} • ${item['reference'] ?? ''}'),
            )),
          const SizedBox(height: 22),
          _sectionTitle('Group activity'),
          if (activity.isEmpty)
            const Padding(padding: EdgeInsets.symmetric(vertical: 12), child: Text('No activity yet.', style: TextStyle(color: Colors.black54)))
          else
            ...activity.take(12).map((item) => ListTile(contentPadding: EdgeInsets.zero, leading: const Icon(Icons.history_rounded, color: Color(0xFF08783E)), title: Text(item['message']?.toString() ?? 'Group activity'))),
        ]),
      ),
    );
  }

  Widget _metric(String label, String value) => Container(
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(16)),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(label, style: const TextStyle(color: Colors.black54, fontSize: 12)),
          const SizedBox(height: 4),
          Text(value, style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 16)),
        ]),
      );
  Widget _sectionTitle(String text) => Padding(
        padding: const EdgeInsets.only(bottom: 7),
        child: Text(text, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800)),
      );
}
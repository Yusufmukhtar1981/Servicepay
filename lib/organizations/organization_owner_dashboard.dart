import 'package:flutter/material.dart';
import '../servicepay_theme.dart';

import 'organization_models.dart';
import 'organizations_api.dart';

/// The owner surface deliberately keeps each section's contract visible here.
/// This prevents a new backend envelope from silently becoming a generic card.
class OrganizationOwnerDashboard extends StatefulWidget {
  const OrganizationOwnerDashboard({
    super.key,
    required this.api,
    required this.organization,
  });
  final OrganizationsApi api;
  final Organization organization;
  @override
  State<OrganizationOwnerDashboard> createState() =>
      _OrganizationOwnerDashboardState();
}

class _OrganizationOwnerDashboardState
    extends State<OrganizationOwnerDashboard> {
  static const names = [
    'Overview',
    'Members',
    'Applications',
    'Payments',
    'Fees & Dues',
    'Wallet',
    'Branches',
    'Staff & Roles',
    'Messages',
    'ID Cards',
    'Reports',
    'Audit Logs',
    'Settings',
  ];
  final data = <String, Map<String, dynamic>>{};
  final errors = <String, String?>{};
  final loading = <String, bool>{};
  final pages = <String, int>{};
  final searches = <String, String>{};
  final statuses = <String, String>{};
  final filters = <String, Map<String, String>>{};
  int selected = 0;

  @override
  void initState() {
    super.initState();
    _load(names.first);
  }

  Future<void> _load(String name) async {
    setState(() {
      loading[name] = true;
      errors[name] = null;
    });
    try {
      final id = widget.organization.id;
      final page = pages[name] ?? 1;
      final value = switch (name) {
        'Overview' => await widget.api.ownerDashboard(id),
        'Members' => await widget.api.membersSearch(
          id,
          search: searches[name] ?? '',
          status: statuses[name] ?? '',
          branchId: filters[name]?['branchId'] ?? '',
          page: page,
        ),
        'Applications' => await widget.api.applications(
          id,
          status: statuses[name] ?? '',
          page: page,
        ),
        'Payments' => await widget.api.paymentHistory(
          id,
          status: statuses[name] ?? '',
          memberId: filters[name]?['memberId'] ?? '',
          feeType: filters[name]?['feeType'] ?? '',
          from: filters[name]?['from'] ?? '',
          to: filters[name]?['to'] ?? '',
          branchId: filters[name]?['branchId'] ?? '',
          page: page,
        ),
        'Fees & Dues' => await _feesEnvelope(id, page),
        'Wallet' => await _treasuryEnvelope(id, page),
        'Branches' => await widget.api.branches(id, page: page),
        'Staff & Roles' => await widget.api.staffList(id, page: page),
        'Messages' => await widget.api.announcements(id, page: page),
        'ID Cards' => await widget.api.cards(id, page: page),
        'Reports' => await widget.api.reports(
          id,
          page: page,
          kind: filters[name]?['kind'] ?? '',
          period: filters[name]?['period'] ?? '',
        ),
        'Audit Logs' => await widget.api.audit(
          id,
          page: page,
          action: filters[name]?['action'] ?? '',
          actor: filters[name]?['actor'] ?? '',
          entityType: filters[name]?['entityType'] ?? '',
          from: filters[name]?['from'] ?? '',
          to: filters[name]?['to'] ?? '',
        ),
        'Settings' => await widget.api.settings(id),
        _ => <String, dynamic>{},
      };
      if (mounted) setState(() => data[name] = value);
    } catch (e) {
      if (mounted) {
        setState(
          () => errors[name] = e.toString().replaceFirst('Exception: ', ''),
        );
      }
    } finally {
      if (mounted) setState(() => loading[name] = false);
    }
  }

  Future<Map<String, dynamic>> _feesEnvelope(String id, int page) async {
    final result = await Future.wait([
      widget.api.fees(id, page: page),
      widget.api.feeAssignments(id),
    ]);
    return {
      ...result[0],
      'assignments': result[1]['assignments'] ?? const [],
      'summary': result[1]['summary'] ?? const {},
      'assignmentPagination': result[1]['pagination'],
    };
  }

  Future<Map<String, dynamic>> _treasuryEnvelope(String id, int page) async {
    final result = await Future.wait([
      widget.api.walletDetails(id),
      widget.api.settlementAccounts(id),
      widget.api.withdrawals(id, status: statuses['Wallet'] ?? '', page: page),
    ]);
    final treasury = _map(result[0]['data']);
    final accounts = _map(result[1]['data']);
    final withdrawals = _map(result[2]['data']);
    return {
      ...treasury,
      'settlementAccounts':
          accounts['settlementAccounts'] ??
          result[1]['settlementAccounts'] ??
          const [],
      'withdrawals':
          withdrawals['withdrawals'] ?? result[2]['withdrawals'] ?? const [],
      'withdrawalPagination': result[2]['pagination'],
    };
  }

  void _select(int index) {
    setState(() => selected = index);
    final name = names[index];
    if (!data.containsKey(name)) _load(name);
  }

  void _openFiltered(String section, String branchId) {
    final index = names.indexOf(section);
    if (index < 0) return;
    setState(() {
      filters[section] = {...filters[section] ?? {}, 'branchId': branchId};
      selected = index;
      pages[section] = 1;
    });
    _load(section);
  }

  Future<void> _action(
    String section,
    String action, [
    Map<String, dynamic> body = const {},
  ]) async {
    try {
      final id = widget.organization.id;
      if (section == 'Applications') {
        final applicationId = '${body['applicationId']}';
        if (action == 'approve') {
          await widget.api.approveApplication(id, applicationId);
        } else {
          await widget.api.rejectApplication(id, applicationId);
        }
      } else if (section == 'Members') {
        await widget.api.memberStatus(
          id,
          '${body['memberId']}',
          '${body['status']}',
        );
      } else if (section == 'Fees & Dues') {
        if (action == 'assign') {
          await widget.api.assignFee(id, body);
        } else if (action == 'create') {
          await widget.api.createFee(id, body);
        } else {
          await widget.api.updateFee(id, '${body['feeId']}', body);
        }
      } else if (section == 'Branches') {
        if (action == 'create') {
          await widget.api.createBranch(id, body);
        } else {
          await widget.api.updateBranch(id, '${body['branchId']}', body);
        }
      } else if (section == 'Staff & Roles') {
        if (action == 'create') {
          await widget.api.createStaff(id, body);
        } else {
          await widget.api.updateStaff(id, '${body['staffId']}', body);
        }
      } else if (section == 'Messages') {
        await widget.api.publishAnnouncement(id, body);
      } else if (section == 'Settings') {
        await widget.api.patchSettings(id, body);
      } else if (section == 'Wallet') {
        if (action == 'addAccount') {
          final resolved = await widget.api.resolveSettlementAccount(id, body);
          final resolvedData = _map(resolved['data']);
          final accountName =
              resolvedData['accountName'] ?? resolved['accountName'];
          if ('$accountName'.trim().isEmpty || accountName == null) {
            throw Exception('The bank account could not be resolved.');
          }
          await widget.api.addSettlementAccount(id, {
            ...body,
            'accountName': accountName,
          });
        } else if (action == 'withdraw') {
          await widget.api.createWithdrawal(id, body);
        } else if (action == 'approveWithdrawal') {
          await widget.api.approveWithdrawal(id, '${body['withdrawalId']}');
        } else if (action == 'rejectWithdrawal') {
          await widget.api.rejectWithdrawal(
            id,
            '${body['withdrawalId']}',
            reason: '${body['reason'] ?? ''}',
          );
        } else {
          throw Exception('This wallet action is not supported.');
        }
      } else {
        throw Exception('This action is not supported for $section.');
      }
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(const SnackBar(content: Text('Saved successfully')));
      }
      _load(section);
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(e.toString().replaceFirst('Exception: ', ''))),
        );
      }
    }
  }

  Future<void> _detail(String section, Map<String, dynamic> item) async {
    try {
      final id = widget.organization.id;
      final recordId = '${item['_id'] ?? item['id']}';
      final value = section == 'Members'
          ? await widget.api.memberDetail(id, recordId)
          : section == 'Applications'
          ? await widget.api.applicationDetail(id, recordId)
          : section == 'Cards'
          ? await widget.api.cardDetail(id, recordId)
          : await widget.api.withdrawalDetail(id, recordId);
      if (!mounted) return;
      final record = section == 'Members'
          ? _map(value['member'])
          : section == 'Applications'
          ? _map(value['application'])
          : section == 'Cards'
          ? _map(value['card'])
          : _map(value['withdrawal'] ?? value['data']);
      await showDialog<void>(
        context: context,
        builder: (c) => AlertDialog(
          title: Text('$section detail'),
          content: SingleChildScrollView(
            child: Text(
              record.entries.map((e) => '${e.key}: ${e.value}').join('\n'),
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(c),
              child: const Text('Close'),
            ),
          ],
        ),
      );
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(e.toString().replaceFirst('Exception: ', ''))),
        );
      }
    }
  }

  Future<void> _memberMessage(Map<String, dynamic> member) async {
    final values = await _messageForm(context);
    if (values == null) return;
    try {
      await widget.api.messageMember(
        widget.organization.id,
        '${member['_id'] ?? member['id']}',
        values,
      );
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(const SnackBar(content: Text('In-app message sent')));
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(e.toString().replaceFirst('Exception: ', ''))),
        );
      }
    }
  }

  Future<void> _memberPayments(Map<String, dynamic> member) async {
    final result = await widget.api.paymentHistory(
      widget.organization.id,
      memberId: '${member['_id'] ?? member['id']}',
    );
    if (!mounted) return;
    await showDialog<void>(
      context: context,
      builder: (c) => AlertDialog(
        title: const Text('Member payment history'),
        content: Text(
          _list(result, 'payments')
              .map(
                (p) =>
                    '${p['reference'] ?? '—'} • ${p['amount'] ?? '—'} • ${p['status'] ?? '—'}',
              )
              .join('\n'),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(c),
            child: const Text('Close'),
          ),
        ],
      ),
    );
  }

  Future<void> _memberCard(Map<String, dynamic> member) async {
    final detail = await widget.api.memberDetail(
      widget.organization.id,
      '${member['_id'] ?? member['id']}',
    );
    final card = _map(detail['card']);
    final cardId = card['_id'] ?? card['id'];
    if (cardId == null) return;
    await _detail('Cards', {'id': cardId, '_id': cardId});
  }

  Future<void> _memberEdit(Map<String, dynamic> member) async {
    final values = await _memberEditForm(context, member);
    if (values == null) return;
    try {
      await widget.api.patchMemberDetail(
        widget.organization.id,
        '${member['_id'] ?? member['id']}',
        values,
      );
      await _load('Members');
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(e.toString().replaceFirst('Exception: ', ''))),
        );
      }
    }
  }

  Future<void> _assignBranchAdmin(String branchId) async {
    final values = await _staffForm(
      context,
      existing: {
        'role': 'BRANCH_ADMIN',
        'branch': branchId,
        'permissions': ['members.view'],
      },
    );
    if (values == null) return;
    values['role'] = 'BRANCH_ADMIN';
    values['branchId'] = branchId;
    values.remove('staffId');
    await _action('Staff & Roles', 'create', values);
  }

  Widget _body(String name) {
    final value = data[name];
    if (loading[name] == true && value == null) {
      return const Center(child: CircularProgressIndicator());
    }
    if (errors[name] != null && value == null) {
      return _DashboardError(message: errors[name]!, retry: () => _load(name));
    }
    final common = DashboardInput(
      data: value ?? {},
      page: pages[name] ?? 1,
      search: searches[name] ?? '',
      status: statuses[name] ?? '',
      loading: loading[name] == true,
      onRetry: () => _load(name),
      onPage: (p) {
        setState(() => pages[name] = p);
        _load(name);
      },
      onSearch: (s) {
        setState(() {
          searches[name] = s;
          pages[name] = 1;
        });
        _load(name);
      },
      onStatus: (s) {
        setState(() {
          statuses[name] = s;
          pages[name] = 1;
        });
        _load(name);
      },
      filter: (key, value) {
        setState(() {
          filters[name] = {...filters[name] ?? {}, key: value};
          pages[name] = 1;
        });
        _load(name);
      },
      action: (a, b) => _action(name, a, b),
      detail: (item) => _detail(name, item),
      filters: filters[name] ?? const {},
      openFiltered: (section, branchId) => _openFiltered(section, branchId),
      memberMessage: (member) => _memberMessage(member),
      memberPayments: (member) => _memberPayments(member),
      memberCard: (member) => _memberCard(member),
      memberEdit: (member) => _memberEdit(member),
      branchAdmin: (branchId) => _assignBranchAdmin(branchId),
    );
    return switch (name) {
      'Overview' => OwnerOverviewSection(input: common),
      'Members' => OwnerMembersSection(input: common),
      'Applications' => OwnerApplicationsSection(input: common),
      'Payments' => OwnerPaymentsSection(input: common),
      'Fees & Dues' => OwnerFeesSection(input: common),
      'Wallet' => OwnerWalletSection(input: common),
      'Branches' => OwnerBranchesSection(input: common),
      'Staff & Roles' => OwnerStaffSection(input: common),
      'Messages' => OwnerMessagesSection(input: common),
      'ID Cards' => OwnerCardsSection(input: common),
      'Reports' => OwnerReportsSection(input: common),
      'Audit Logs' => OwnerAuditSection(input: common),
      _ => OwnerSettingsSection(input: common),
    };
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    backgroundColor: ServicePayColors.canvas,
    appBar: AppBar(
      title: Text(widget.organization.name),
      actions: [
        IconButton(
          onPressed: () => _load(names[selected]),
          icon: const Icon(Icons.refresh_rounded),
        ),
      ],
    ),
    body: LayoutBuilder(
      builder: (context, constraints) {
        if (constraints.maxWidth < 700) {
          return Column(
            children: [
              Padding(
                padding: const EdgeInsets.all(12),
                child: DropdownButtonFormField<int>(
                  value: selected,
                  decoration: const InputDecoration(
                    labelText: 'Dashboard section',
                  ),
                  items: [
                    for (var i = 0; i < names.length; i++)
                      DropdownMenuItem(value: i, child: Text(names[i])),
                  ],
                  onChanged: (v) {
                    if (v != null) _select(v);
                  },
                ),
              ),
              Expanded(child: _body(names[selected])),
            ],
          );
        }
        return Row(
          children: [
            SingleChildScrollView(
              child: NavigationRail(
                selectedIndex: selected,
                onDestinationSelected: _select,
                labelType: constraints.maxWidth < 900
                    ? NavigationRailLabelType.none
                    : NavigationRailLabelType.all,
                destinations: [
                  for (final name in names)
                    NavigationRailDestination(
                      icon: Icon(_dashboardIcon(name)),
                      selectedIcon: Icon(
                        _dashboardIcon(name),
                        color: ServicePayColors.brand,
                      ),
                      label: Text(name),
                    ),
                ],
              ),
            ),
            Expanded(child: _body(names[selected])),
          ],
        );
      },
    ),
  );
}

class DashboardInput {
  const DashboardInput({
    required this.data,
    required this.page,
    required this.search,
    required this.status,
    required this.loading,
    required this.onRetry,
    required this.onPage,
    required this.onSearch,
    required this.onStatus,
    required this.filter,
    required this.action,
    required this.detail,
    required this.memberMessage,
    required this.memberPayments,
    required this.memberCard,
    required this.filters,
    required this.openFiltered,
    required this.memberEdit,
    required this.branchAdmin,
  });
  final Map<String, dynamic> data;
  final int page;
  final String search, status;
  final bool loading;
  final VoidCallback onRetry;
  final ValueChanged<int> onPage;
  final ValueChanged<String> onSearch, onStatus;
  final void Function(String, String) filter;
  final Future<void> Function(String, Map<String, dynamic>) action;
  final Future<void> Function(Map<String, dynamic>) detail;
  final Future<void> Function(Map<String, dynamic>) memberMessage;
  final Future<void> Function(Map<String, dynamic>) memberPayments;
  final Future<void> Function(Map<String, dynamic>) memberCard;
  final Map<String, String> filters;
  final void Function(String, String) openFiltered;
  final Future<void> Function(Map<String, dynamic>) memberEdit;
  final Future<void> Function(String) branchAdmin;
}

Widget _dashboardShell(String title, Widget child) => ListView(
  padding: const EdgeInsets.all(20),
  children: [
    Text(
      title,
      style: const TextStyle(fontSize: 26, fontWeight: FontWeight.w900),
    ),
    const SizedBox(height: 14),
    child,
  ],
);

Widget _dashboardSearch(
  DashboardInput i, {
  bool statuses = false,
  bool paymentStatuses = false,
  bool searchField = true,
}) => Column(
  children: [
    if (searchField)
      TextField(
        onSubmitted: i.onSearch,
        decoration: const InputDecoration(
          labelText: 'Search',
          prefixIcon: Icon(Icons.search),
        ),
      ),
    if (statuses)
      DropdownButtonFormField<String>(
        value: i.status.isEmpty ? null : i.status,
        decoration: const InputDecoration(labelText: 'Status'),
        items: paymentStatuses
            ? const [
                DropdownMenuItem(value: 'SUCCESS', child: Text('Success')),
                DropdownMenuItem(value: 'PENDING', child: Text('Pending')),
                DropdownMenuItem(value: 'FAILED', child: Text('Failed')),
              ]
            : const [
                DropdownMenuItem(value: 'PENDING', child: Text('Pending')),
                DropdownMenuItem(value: 'ACTIVE', child: Text('Active')),
                DropdownMenuItem(value: 'REJECTED', child: Text('Rejected')),
                DropdownMenuItem(value: 'SUSPENDED', child: Text('Suspended')),
                DropdownMenuItem(value: 'EXPIRED', child: Text('Expired')),
              ],
        onChanged: (v) => i.onStatus(v ?? ''),
      ),
  ],
);

Widget _dashboardPager(DashboardInput i, Map<String, dynamic> source) {
  final pagination = source['pagination'] is Map
      ? Map<String, dynamic>.from(source['pagination'] as Map)
      : <String, dynamic>{};
  final pages = (pagination['pages'] as num?)?.toInt() ?? i.page;
  return Row(
    mainAxisAlignment: MainAxisAlignment.center,
    children: [
      IconButton(
        onPressed: i.page > 1 ? () => i.onPage(i.page - 1) : null,
        icon: const Icon(Icons.chevron_left),
      ),
      Text('Page ${i.page} of ${pages < 1 ? 1 : pages}'),
      IconButton(
        onPressed: i.page < pages ? () => i.onPage(i.page + 1) : null,
        icon: const Icon(Icons.chevron_right),
      ),
    ],
  );
}

String _text(dynamic value) => value == null ? '—' : '$value';
String _withdrawalStatusLabel(dynamic value) {
  final status = '${value ?? 'UNKNOWN'}'.toUpperCase();
  return switch (status) {
    'APPROVED' => 'APPROVED — awaiting treasury dispatch',
    'CONFIGURATION_REQUIRED' =>
      'CONFIGURATION REQUIRED — payout not dispatched',
    _ => status,
  };
}

Map<String, dynamic> _map(dynamic value) =>
    value is Map ? Map<String, dynamic>.from(value) : <String, dynamic>{};
String _branchAdminsLabel(dynamic value) {
  if (value is! List || value.isEmpty) return 'Unassigned';
  return value
      .whereType<Map>()
      .map((entry) {
        final user = _map(entry['user']);
        return _text(user['fullName'] ?? entry['fullName']);
      })
      .where((name) => name != '—')
      .join(', ');
}

List<Map<String, dynamic>> _list(Map<String, dynamic> source, String key) =>
    source[key] is List
    ? (source[key] as List)
          .whereType<Map>()
          .map((e) => Map<String, dynamic>.from(e))
          .toList()
    : <Map<String, dynamic>>[];
Widget _empty(String label) => Padding(
  padding: const EdgeInsets.symmetric(vertical: 24),
  child: Text(label, style: const TextStyle(color: Colors.black54)),
);

class OwnerOverviewSection extends StatelessWidget {
  const OwnerOverviewSection({required this.input, super.key});
  final DashboardInput input;
  @override
  Widget build(BuildContext context) {
    final summary = _map(input.data['summary']);
    final revenue = _map(summary['revenue']);
    final recentMembers = input.data['recentMembers'] is List
        ? input.data['recentMembers'] as List
        : const [];
    final recentPayments = input.data['recentPayments'] is List
        ? input.data['recentPayments'] as List
        : const [];
    final growth = input.data['membershipGrowth'] is List
        ? input.data['membershipGrowth'] as List
        : const [];
    final trends = input.data['revenueTrend'] is List
        ? input.data['revenueTrend'] as List
        : const [];
    final maxMembers = growth.fold<double>(
      0,
      (max, p) => ((p['count'] as num?)?.toDouble() ?? 0) > max
          ? ((p['count'] as num?)?.toDouble() ?? 0)
          : max,
    );
    final maxRevenue = trends.fold<double>(
      0,
      (max, p) => ((p['amount'] as num?)?.toDouble() ?? 0) > max
          ? ((p['amount'] as num?)?.toDouble() ?? 0)
          : max,
    );
    return _dashboardShell(
      'Overview',
      Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              for (final entry in {
                'Members': summary['total'],
                'Active': summary['active'],
                'Pending': summary['pending'],
                'Suspended': summary['suspended'],
                'Expired': summary['expired'],
                'Outstanding': summary['outstandingDues'],
                'Wallet': summary['walletBalance'],
              }.entries)
                if (entry.value != null)
                  Chip(label: Text('${entry.key}: ${entry.value}')),
            ],
          ),
          const SizedBox(height: 16),
          Text(
            'Revenue: ${_text(revenue['total'])} • Registration: ${_text(revenue['registration'])} • Annual: ${_text(revenue['annual'])} • Other: ${_text(revenue['other'])}',
          ),
          Text('Recent members: ${recentMembers.length}'),
          Text('Recent payments: ${recentPayments.length}'),
          Text('Membership trend points: ${growth.length}'),
          Text('Revenue trend points: ${trends.length}'),
          const SizedBox(height: 12),
          const Text(
            'Recent activity',
            style: TextStyle(fontWeight: FontWeight.bold),
          ),
          ...recentMembers.take(5).map((member) {
            final user = _map(member['user']);
            return ListTile(
              dense: true,
              leading: const Icon(Icons.person_outline),
              title: Text(_text(user['fullName'])),
              subtitle: Text(
                '${_text(member['status'])} • ${_text(member['createdAt'])}',
              ),
            );
          }),
          ...recentPayments
              .take(5)
              .map(
                (payment) => ListTile(
                  dense: true,
                  leading: const Icon(Icons.payments_outlined),
                  title: Text(
                    '${_text(payment['reference'])} • ${_text(payment['amount'])}',
                  ),
                  subtitle: Text(
                    '${_text(payment['status'])} • ${_text(payment['createdAt'])}',
                  ),
                ),
              ),
          if (growth.isNotEmpty) const Text('Membership trend'),
          ...growth
              .take(10)
              .map(
                (point) => Row(
                  children: [
                    SizedBox(width: 92, child: Text(_text(point['date']))),
                    Expanded(
                      child: LinearProgressIndicator(
                        value: maxMembers == 0
                            ? 0
                            : (((point['count'] as num?)?.toDouble() ?? 0) /
                                      maxMembers)
                                  .clamp(0, 1)
                                  .toDouble(),
                      ),
                    ),
                  ],
                ),
              ),
          if (trends.isNotEmpty) const Text('Revenue trend'),
          ...trends
              .take(10)
              .map(
                (point) => Row(
                  children: [
                    SizedBox(width: 92, child: Text(_text(point['date']))),
                    Expanded(
                      child: LinearProgressIndicator(
                        value: maxRevenue == 0
                            ? 0
                            : (((point['amount'] as num?)?.toDouble() ?? 0) /
                                      maxRevenue)
                                  .clamp(0, 1)
                                  .toDouble(),
                      ),
                    ),
                  ],
                ),
              ),
        ],
      ),
    );
  }
}

class OwnerMembersSection extends StatelessWidget {
  const OwnerMembersSection({required this.input, super.key});
  final DashboardInput input;
  @override
  Widget build(BuildContext context) => _dashboardShell(
    'Members',
    Column(
      children: [
        _dashboardSearch(input, statuses: true, paymentStatuses: false),
        ...(_list(input.data, 'members').isEmpty
            ? [_empty('No members found.')]
            : _list(input.data, 'members').map((member) {
                final user = _map(member['user']);
                final active = '${member['status']}'.toUpperCase() == 'ACTIVE';
                return Card(
                  child: ListTile(
                    leading: user['photo'] is String
                        ? CircleAvatar(
                            backgroundImage: NetworkImage('${user['photo']}'),
                          )
                        : const CircleAvatar(child: Icon(Icons.person_outline)),
                    title: Text(_text(user['fullName'])),
                    subtitle: Text(
                      'Phone: ${_text(user['phone'])} • Email: ${_text(user['email'])}\nNumber: ${_text(member['membershipNumber'])}\nCategory: ${_text(member['category'])} • Branch: ${_text(member['branch'])}\nJoined: ${_text(member['joinedAt'])} • Status: ${_text(member['status'])}\nAnnual fee: ${_text(member['annualFeeStatus'] ?? 'Unavailable')}',
                    ),
                    isThreeLine: true,
                    trailing: Wrap(
                      children: [
                        IconButton(
                          tooltip: 'View member',
                          onPressed: () => input.detail(member),
                          icon: const Icon(Icons.visibility_outlined),
                        ),
                        IconButton(
                          tooltip: 'Edit member',
                          onPressed: () => input.memberEdit(member),
                          icon: const Icon(Icons.edit_outlined),
                        ),
                        IconButton(
                          tooltip: 'Message member',
                          onPressed: () => input.memberMessage(member),
                          icon: const Icon(Icons.message_outlined),
                        ),
                        IconButton(
                          tooltip: 'View payments',
                          onPressed: () => input.memberPayments(member),
                          icon: const Icon(Icons.payments_outlined),
                        ),
                        IconButton(
                          tooltip: 'View card',
                          onPressed: () => input.memberCard(member),
                          icon: const Icon(Icons.badge_outlined),
                        ),
                        Chip(label: Text(_text(member['status']))),
                        if (active ||
                            '${member['status']}'.toUpperCase() == 'SUSPENDED')
                          IconButton(
                            tooltip: active ? 'Suspend' : 'Reactivate',
                            onPressed: () async {
                              final next = active ? 'SUSPENDED' : 'ACTIVE';
                              if (await _confirm(
                                context,
                                next == 'SUSPENDED'
                                    ? 'Suspend member'
                                    : 'Reactivate member',
                                'Confirm changing this member to $next?',
                              )) {
                                await input.action('status', {
                                  'memberId': member['_id'] ?? member['id'],
                                  'status': next,
                                });
                              }
                            },
                            icon: Icon(
                              active
                                  ? Icons.pause_circle_outline
                                  : Icons.play_circle_outline,
                            ),
                          ),
                      ],
                    ),
                  ),
                );
              })),
        _dashboardPager(input, input.data),
      ],
    ),
  );
}

class OwnerApplicationsSection extends StatelessWidget {
  const OwnerApplicationsSection({required this.input, super.key});
  final DashboardInput input;
  @override
  Widget build(BuildContext context) => _dashboardShell(
    'Applications',
    Column(
      children: [
        _dashboardSearch(input, statuses: true),
        ...(_list(input.data, 'applications').isEmpty
            ? [_empty('No applications found.')]
            : _list(input.data, 'applications').map((application) {
                final user = _map(application['user']);
                final pending =
                    '${application['status']}'.toUpperCase() == 'PENDING';
                return Card(
                  child: ListTile(
                    title: Text(_text(user['fullName'])),
                    subtitle: Text(
                      'Application data: ${_text(application['applicationData'])}\nDate: ${_text(application['createdAt'])} • Fee: ${_text(application['fee'])}\nBranch: ${_text(application['branch'])} • Category: ${_text(application['category'])}',
                    ),
                    isThreeLine: true,
                    trailing: Wrap(
                      children: [
                        IconButton(
                          tooltip: 'View application',
                          onPressed: () => input.detail(application),
                          icon: const Icon(Icons.visibility_outlined),
                        ),
                        if (pending)
                          IconButton(
                            tooltip: 'Approve',
                            onPressed: () async {
                              if (await _confirm(
                                context,
                                'Approve application',
                                'Approve this pending application?',
                              )) {
                                await input.action('approve', {
                                  'applicationId':
                                      application['_id'] ?? application['id'],
                                });
                              }
                            },
                            icon: const Icon(Icons.check),
                          ),
                        if (pending)
                          IconButton(
                            tooltip: 'Reject',
                            onPressed: () async {
                              if (await _confirm(
                                context,
                                'Reject application',
                                'Reject this pending application?',
                              )) {
                                await input.action('reject', {
                                  'applicationId':
                                      application['_id'] ?? application['id'],
                                });
                              }
                            },
                            icon: const Icon(Icons.close),
                          ),
                        if (!pending)
                          Chip(label: Text(_text(application['status']))),
                      ],
                    ),
                  ),
                );
              })),
        _dashboardPager(input, input.data),
      ],
    ),
  );
}

class OwnerPaymentsSection extends StatelessWidget {
  const OwnerPaymentsSection({required this.input, super.key});
  final DashboardInput input;
  @override
  Widget build(BuildContext context) => _dashboardShell(
    'Payments',
    Column(
      children: [
        _dashboardSearch(
          input,
          statuses: true,
          paymentStatuses: true,
          searchField: false,
        ),
        TextField(
          onSubmitted: (value) => input.filter('memberId', value),
          decoration: const InputDecoration(labelText: 'Member ID'),
        ),
        TextField(
          onSubmitted: (value) => input.filter('feeType', value),
          decoration: const InputDecoration(labelText: 'Fee type'),
        ),
        Row(
          children: [
            Expanded(
              child: TextField(
                onSubmitted: (value) => input.filter('from', value),
                decoration: const InputDecoration(labelText: 'From date'),
              ),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: TextField(
                onSubmitted: (value) => input.filter('to', value),
                decoration: const InputDecoration(labelText: 'To date'),
              ),
            ),
          ],
        ),
        if (input.data['summary'] is Map)
          Text('Summary: ${_text(input.data['summary'])}'),
        ...(_list(input.data, 'payments').isEmpty
            ? [_empty('No payments found.')]
            : _list(input.data, 'payments').map((payment) {
                final member = _map(payment['member']);
                final user = _map(member['user']);
                final fee = _map(payment['fee']);
                return Card(
                  child: ListTile(
                    title: Text(
                      '${_text(payment['memberName'] ?? user['fullName'])} • ${_text(fee['name'] ?? payment['fee'])}',
                    ),
                    subtitle: Text(
                      'Type: ${_text(fee['type'])} • Amount: ${_text(payment['amount'])}\nReference: ${_text(payment['reference'])} • Method: ${payment['method'] ?? 'Unavailable'}\nDate: ${_text(payment['date'] ?? payment['createdAt'])}',
                    ),
                    isThreeLine: true,
                    trailing: Chip(label: Text(_text(payment['status']))),
                  ),
                );
              })),
        _dashboardPager(input, input.data),
      ],
    ),
  );
}

Future<Map<String, dynamic>?> _feeForm(
  BuildContext context, {
  Map<String, dynamic>? existing,
}) async {
  final name = TextEditingController(
    text: _text(existing?['name']) == '—' ? '' : _text(existing?['name']),
  );
  final type = TextEditingController(
    text: _text(existing?['type']) == '—'
        ? 'REGISTRATION'
        : _text(existing?['type']),
  );
  final description = TextEditingController(
    text: existing?['description']?.toString() ?? '',
  );
  final amount = TextEditingController(
    text: existing?['amount']?.toString() ?? '',
  );
  final dueDate = TextEditingController(
    text: existing?['dueDate']?.toString() ?? '',
  );
  var frequency = '${existing?['frequency'] ?? 'ANNUAL'}';
  var active = existing?['active'] != false;
  final formKey = GlobalKey<FormState>();
  final result = await showDialog<Map<String, dynamic>>(
    context: context,
    builder: (dialogContext) => StatefulBuilder(
      builder: (context, setState) {
        return AlertDialog(
          title: Text(existing == null ? 'Create fee' : 'Edit fee'),
          content: SingleChildScrollView(
            child: Form(
              key: formKey,
              child: Column(
                children: [
                  TextFormField(
                    controller: name,
                    decoration: const InputDecoration(labelText: 'Name'),
                    validator: (v) =>
                        v!.trim().isEmpty ? 'Name is required' : null,
                  ),
                  DropdownButtonFormField<String>(
                    value: type.text.toUpperCase(),
                    decoration: const InputDecoration(labelText: 'Type'),
                    items: const [
                      DropdownMenuItem(
                        value: 'REGISTRATION',
                        child: Text('Registration'),
                      ),
                      DropdownMenuItem(value: 'ANNUAL', child: Text('Annual')),
                      DropdownMenuItem(value: 'OTHER', child: Text('Other')),
                    ],
                    onChanged: (v) => type.text = v ?? type.text,
                  ),
                  TextFormField(
                    controller: description,
                    decoration: const InputDecoration(labelText: 'Description'),
                  ),
                  TextFormField(
                    controller: amount,
                    keyboardType: TextInputType.number,
                    decoration: const InputDecoration(labelText: 'Amount'),
                    validator: (v) => (double.tryParse(v!.trim()) ?? 0) <= 0
                        ? 'Amount must be greater than zero'
                        : null,
                  ),
                  DropdownButtonFormField<String>(
                    value: frequency,
                    decoration: const InputDecoration(labelText: 'Frequency'),
                    items: const [
                      DropdownMenuItem(value: 'ONCE', child: Text('Once')),
                      DropdownMenuItem(
                        value: 'MONTHLY',
                        child: Text('Monthly'),
                      ),
                      DropdownMenuItem(value: 'ANNUAL', child: Text('Annual')),
                    ],
                    onChanged: (v) =>
                        setState(() => frequency = v ?? frequency),
                  ),
                  TextFormField(
                    controller: dueDate,
                    decoration: const InputDecoration(
                      labelText: 'Due date (YYYY-MM-DD)',
                    ),
                  ),
                  SwitchListTile(
                    title: const Text('Active'),
                    value: active,
                    onChanged: (v) => setState(() => active = v),
                  ),
                  const Align(
                    alignment: Alignment.centerLeft,
                    child: Text(
                      'Installment accounting is not supported.',
                      style: TextStyle(color: Colors.black54),
                    ),
                  ),
                ],
              ),
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(dialogContext),
              child: const Text('Cancel'),
            ),
            FilledButton(
              onPressed: () {
                if (!(formKey.currentState?.validate() ?? false)) {
                  return;
                }
                Navigator.pop(dialogContext, {
                  'name': name.text.trim(),
                  'description': description.text.trim(),
                  'type': type.text.trim().toUpperCase(),
                  'amount': double.parse(amount.text.trim()),
                  'frequency': frequency,
                  'dueDate': dueDate.text.trim(),
                  'active': active,
                  if (existing != null)
                    'feeId': existing['_id'] ?? existing['id'],
                });
              },
              child: const Text('Save'),
            ),
          ],
        );
      },
    ),
  );
  name.dispose();
  type.dispose();
  description.dispose();
  amount.dispose();
  dueDate.dispose();
  return result;
}

Future<Map<String, dynamic>?> _settlementAccountForm(
  BuildContext context,
) async {
  final bankCode = TextEditingController();
  final number = TextEditingController();
  final key = GlobalKey<FormState>();
  final result = await showDialog<Map<String, dynamic>>(
    context: context,
    builder: (c) => AlertDialog(
      title: const Text('Add settlement account'),
      content: Form(
        key: key,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextFormField(
              controller: bankCode,
              decoration: const InputDecoration(labelText: 'Bank code'),
              validator: (v) =>
                  v!.trim().isEmpty ? 'Bank code is required' : null,
            ),
            TextFormField(
              controller: number,
              keyboardType: TextInputType.number,
              decoration: const InputDecoration(labelText: 'Account number'),
              validator: (v) =>
                  v!.trim().length < 6 ? 'Enter a valid account number' : null,
            ),
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(c),
          child: const Text('Cancel'),
        ),
        FilledButton(
          onPressed: () {
            if (key.currentState!.validate()) {
              Navigator.pop(c, {
                'bankCode': bankCode.text.trim(),
                'accountNumber': number.text.trim(),
              });
            }
          },
          child: const Text('Submit'),
        ),
      ],
    ),
  );
  bankCode.dispose();
  number.dispose();
  return result;
}

Future<Map<String, dynamic>?> _organizationWithdrawalForm(
  BuildContext context,
  List<Map<String, dynamic>> accounts,
) async {
  final approved = accounts
      .where((a) => '${a['status']}'.toUpperCase() == 'VERIFIED')
      .toList();
  var accountId = '${approved.first['_id'] ?? approved.first['id'] ?? ''}';
  final amount = TextEditingController();
  final purpose = TextEditingController();
  final pin = TextEditingController();
  final key = GlobalKey<FormState>();
  final result = await showDialog<Map<String, dynamic>>(
    context: context,
    builder: (c) => StatefulBuilder(
      builder: (context, setState) => AlertDialog(
        title: const Text('Withdraw organization funds'),
        content: Form(
          key: key,
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                DropdownButtonFormField<String>(
                  value: accountId,
                  decoration: const InputDecoration(
                    labelText: 'Approved settlement account',
                  ),
                  items: [
                    for (final account in approved)
                      DropdownMenuItem(
                        value: '${account['_id'] ?? account['id']}',
                        child: SizedBox(
                          width: 190,
                          child: Text(
                            '${_text(account['bankName'] ?? account['bank'])} • ${_text(account['accountName'])}',
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                      ),
                  ],
                  onChanged: (v) => setState(() => accountId = v ?? accountId),
                ),
                TextFormField(
                  controller: amount,
                  keyboardType: const TextInputType.numberWithOptions(
                    decimal: true,
                  ),
                  decoration: const InputDecoration(labelText: 'Amount'),
                  validator: (v) => num.tryParse(v!.trim()) == null
                      ? 'Enter a valid amount'
                      : null,
                ),
                TextFormField(
                  controller: purpose,
                  decoration: const InputDecoration(
                    labelText: 'Purpose / narration',
                  ),
                  validator: (v) =>
                      v!.trim().isEmpty ? 'Purpose is required' : null,
                ),
                TextFormField(
                  controller: pin,
                  obscureText: true,
                  keyboardType: TextInputType.number,
                  decoration: const InputDecoration(
                    labelText: 'Transaction PIN',
                  ),
                  validator: (v) =>
                      v!.trim().isEmpty ? 'PIN is required' : null,
                ),
              ],
            ),
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(c),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () async {
              if (key.currentState!.validate()) {
                final confirmed = await showDialog<bool>(
                  context: c,
                  builder: (confirmContext) => AlertDialog(
                    title: const Text('Confirm withdrawal'),
                    content: Text(
                      'Amount: ${amount.text.trim()}\n'
                      'Destination: ${_text(approved.firstWhere((a) => '${a['_id'] ?? a['id']}' == accountId)['bankName'] ?? approved.firstWhere((a) => '${a['_id'] ?? a['id']}' == accountId)['bank'])}\n'
                      'Account: ••••${_text(approved.firstWhere((a) => '${a['_id'] ?? a['id']}' == accountId)['accountNumberMasked'] ?? approved.firstWhere((a) => '${a['_id'] ?? a['id']}' == accountId)['last4'])}\n'
                      'Purpose: ${purpose.text.trim()}\n\n'
                      'The applicable fee and total debit will be calculated by the treasury service.',
                    ),
                    actions: [
                      TextButton(
                        onPressed: () => Navigator.pop(confirmContext, false),
                        child: const Text('Back'),
                      ),
                      FilledButton(
                        onPressed: () => Navigator.pop(confirmContext, true),
                        child: const Text('Confirm'),
                      ),
                    ],
                  ),
                );
                if (confirmed != true) return;
                if (!c.mounted) return;
                Navigator.pop(c, {
                  'settlementAccountId': accountId,
                  'amount': num.parse(amount.text.trim()),
                  'narration': purpose.text.trim(),
                  'transactionPin': pin.text.trim(),
                });
              }
            },
            child: const Text('Continue'),
          ),
        ],
      ),
    ),
  );
  amount.dispose();
  purpose.dispose();
  pin.dispose();
  return result;
}

Future<bool> _confirm(
  BuildContext context,
  String title,
  String message,
) async =>
    await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: Text(title),
        content: Text(message),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(c, false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(c, true),
            child: const Text('Confirm'),
          ),
        ],
      ),
    ) ??
    false;

Future<Map<String, dynamic>?> _assignmentForm(
  BuildContext context,
  List<Map<String, dynamic>> fees,
) async {
  var feeId = '${fees.first['_id'] ?? fees.first['id'] ?? ''}';
  final memberId = TextEditingController();
  final category = TextEditingController();
  final branchId = TextEditingController();
  var target = 'selected';
  final key = GlobalKey<FormState>();
  final result = await showDialog<Map<String, dynamic>>(
    context: context,
    builder: (c) => StatefulBuilder(
      builder: (context, setState) => AlertDialog(
        title: const Text('Assign fee'),
        content: Form(
          key: key,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              DropdownButtonFormField<String>(
                value: feeId,
                decoration: const InputDecoration(labelText: 'Fee'),
                items: [
                  for (final fee in fees)
                    DropdownMenuItem(
                      value: '${fee['_id'] ?? fee['id']}',
                      child: Text(_text(fee['name'])),
                    ),
                ],
                onChanged: (v) => feeId = v ?? feeId,
              ),
              DropdownButtonFormField<String>(
                value: target,
                decoration: const InputDecoration(labelText: 'Target'),
                items: const [
                  DropdownMenuItem(
                    value: 'all',
                    child: Text('All active members'),
                  ),
                  DropdownMenuItem(value: 'category', child: Text('Category')),
                  DropdownMenuItem(value: 'branch', child: Text('Branch')),
                  DropdownMenuItem(
                    value: 'selected',
                    child: Text('Selected member'),
                  ),
                ],
                onChanged: (v) => setState(() => target = v ?? target),
              ),
              if (target == 'selected')
                TextFormField(
                  controller: memberId,
                  decoration: const InputDecoration(labelText: 'Member ID'),
                  validator: (v) =>
                      v!.trim().isEmpty ? 'Member ID is required' : null,
                ),
              if (target == 'category')
                TextFormField(
                  controller: category,
                  decoration: const InputDecoration(labelText: 'Category'),
                  validator: (v) =>
                      v!.trim().isEmpty ? 'Category is required' : null,
                ),
              if (target == 'branch')
                TextFormField(
                  controller: branchId,
                  decoration: const InputDecoration(labelText: 'Branch ID'),
                  validator: (v) =>
                      v!.trim().isEmpty ? 'Branch ID is required' : null,
                ),
            ],
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(c),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () {
              if (key.currentState!.validate()) {
                Navigator.pop(c, {
                  'feeId': feeId,
                  if (target == 'selected') 'memberId': memberId.text.trim(),
                  if (target == 'category') 'category': category.text.trim(),
                  if (target == 'branch') 'branchId': branchId.text.trim(),
                });
              }
            },
            child: const Text('Assign'),
          ),
        ],
      ),
    ),
  );
  memberId.dispose();
  category.dispose();
  branchId.dispose();
  return result;
}

Future<Map<String, dynamic>?> _branchForm(
  BuildContext context, {
  Map<String, dynamic>? existing,
}) async {
  final name = TextEditingController(text: '${existing?['name'] ?? ''}');
  final code = TextEditingController(text: '${existing?['code'] ?? ''}');
  final address = TextEditingController(text: '${existing?['address'] ?? ''}');
  var active = existing?['active'] != false;
  final key = GlobalKey<FormState>();
  final result = await showDialog<Map<String, dynamic>>(
    context: context,
    builder: (c) => AlertDialog(
      title: Text(existing == null ? 'Create branch' : 'Edit branch'),
      content: Form(
        key: key,
        child: SingleChildScrollView(
          child: Column(
            children: [
              TextFormField(
                controller: name,
                decoration: const InputDecoration(
                  labelText: 'Unique branch name',
                ),
                validator: (v) => v!.trim().isEmpty ? 'Required' : null,
              ),
              TextFormField(
                controller: code,
                decoration: const InputDecoration(
                  labelText: 'Unique branch code',
                ),
                validator: (v) => v!.trim().isEmpty ? 'Required' : null,
              ),
              TextFormField(
                controller: address,
                decoration: const InputDecoration(labelText: 'Address'),
                validator: (v) => v!.trim().isEmpty ? 'Required' : null,
              ),
              SwitchListTile(
                title: const Text('Active'),
                value: active,
                onChanged: (v) => active = v,
              ),
            ],
          ),
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(c),
          child: const Text('Cancel'),
        ),
        FilledButton(
          onPressed: () {
            if (key.currentState!.validate()) {
              Navigator.pop(c, {
                'name': name.text.trim(),
                'code': code.text.trim(),
                'address': address.text.trim(),
                'active': active,
                if (existing != null)
                  'branchId': existing['_id'] ?? existing['id'],
              });
            }
          },
          child: const Text('Save'),
        ),
      ],
    ),
  );
  name.dispose();
  code.dispose();
  address.dispose();
  return result;
}

Future<Map<String, dynamic>?> _staffForm(
  BuildContext context, {
  Map<String, dynamic>? existing,
}) async {
  final userId = TextEditingController(
    text: '${existing?['userId'] ?? _map(existing?['user'])['_id'] ?? ''}',
  );
  final branch = TextEditingController(
    text:
        '${existing?['branch'] is Map ? _map(existing?['branch'])['_id'] : existing?['branch'] ?? ''}',
  );
  final permissions = TextEditingController(
    text: existing?['permissions'] is List
        ? (existing!['permissions'] as List).join(',')
        : '',
  );
  var role = '${existing?['role'] ?? 'ADMIN'}';
  var active = existing?['active'] != false;
  final key = GlobalKey<FormState>();
  const roles = [
    'ADMIN',
    'TREASURER',
    'SECRETARY',
    'MEMBERSHIP_OFFICER',
    'AUDITOR',
    'BRANCH_ADMIN',
  ];
  final result = await showDialog<Map<String, dynamic>>(
    context: context,
    builder: (c) => StatefulBuilder(
      builder: (context, setState) => AlertDialog(
        title: Text(existing == null ? 'Add staff' : 'Edit staff'),
        content: Form(
          key: key,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              TextFormField(
                controller: userId,
                decoration: const InputDecoration(labelText: 'User ID'),
                validator: (v) => v!.trim().isEmpty ? 'Required' : null,
              ),
              DropdownButtonFormField<String>(
                value: role,
                items: [
                  for (final value in roles)
                    DropdownMenuItem(value: value, child: Text(value)),
                ],
                onChanged: (v) => setState(() => role = v ?? role),
                decoration: const InputDecoration(labelText: 'Role'),
              ),
              if (role == 'BRANCH_ADMIN')
                TextFormField(
                  controller: branch,
                  decoration: const InputDecoration(labelText: 'Branch ID'),
                  validator: (v) =>
                      v!.trim().isEmpty ? 'Required for branch admin' : null,
                ),
              TextFormField(
                controller: permissions,
                decoration: const InputDecoration(
                  labelText: 'Permissions (comma separated)',
                ),
                validator: (v) => v!.trim().isEmpty ? 'Required' : null,
              ),
              SwitchListTile(
                title: const Text('Active'),
                value: active,
                onChanged: (v) => setState(() => active = v),
              ),
            ],
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(c),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () {
              if (key.currentState!.validate()) {
                Navigator.pop(c, {
                  'userId': userId.text.trim(),
                  'role': role,
                  'branch': role == 'BRANCH_ADMIN' ? branch.text.trim() : null,
                  'branchId': role == 'BRANCH_ADMIN'
                      ? branch.text.trim()
                      : null,
                  'permissions': permissions.text
                      .split(',')
                      .map((v) => v.trim())
                      .where((v) => v.isNotEmpty)
                      .toList(),
                  'active': active,
                  if (existing != null)
                    'staffId': existing['_id'] ?? existing['id'],
                });
              }
            },
            child: const Text('Save'),
          ),
        ],
      ),
    ),
  );
  userId.dispose();
  branch.dispose();
  permissions.dispose();
  return result;
}

Future<Map<String, dynamic>?> _messageForm(BuildContext context) async {
  final title = TextEditingController();
  final body = TextEditingController();
  final branch = TextEditingController();
  var audience = 'ALL';
  final key = GlobalKey<FormState>();
  final result = await showDialog<Map<String, dynamic>>(
    context: context,
    builder: (c) => StatefulBuilder(
      builder: (context, setState) => AlertDialog(
        title: const Text('Compose in-app message'),
        content: Form(
          key: key,
          child: SingleChildScrollView(
            child: Column(
              children: [
                TextFormField(
                  controller: title,
                  decoration: const InputDecoration(labelText: 'Title'),
                  validator: (v) => v!.trim().isEmpty ? 'Required' : null,
                ),
                TextFormField(
                  controller: body,
                  maxLines: 4,
                  decoration: const InputDecoration(labelText: 'Body'),
                  validator: (v) => v!.trim().isEmpty ? 'Required' : null,
                ),
                DropdownButtonFormField<String>(
                  value: audience,
                  items: const [
                    DropdownMenuItem(value: 'ALL', child: Text('Everyone')),
                    DropdownMenuItem(value: 'MEMBERS', child: Text('Members')),
                    DropdownMenuItem(value: 'STAFF', child: Text('Staff')),
                    DropdownMenuItem(value: 'BRANCH', child: Text('Branch')),
                  ],
                  onChanged: (v) => setState(() => audience = v ?? audience),
                  decoration: const InputDecoration(labelText: 'Audience'),
                ),
                if (audience == 'BRANCH')
                  TextFormField(
                    controller: branch,
                    decoration: const InputDecoration(labelText: 'Branch ID'),
                    validator: (v) => v!.trim().isEmpty
                        ? 'Required for branch audience'
                        : null,
                  ),
                const Align(
                  alignment: Alignment.centerLeft,
                  child: Text('Delivery: in-app only'),
                ),
              ],
            ),
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(c),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () {
              if (key.currentState!.validate()) {
                Navigator.pop(c, {
                  'title': title.text.trim(),
                  'body': body.text.trim(),
                  'audience': audience,
                  if (audience == 'BRANCH') 'branch': branch.text.trim(),
                  'published': true,
                });
              }
            },
            child: const Text('Publish'),
          ),
        ],
      ),
    ),
  );
  title.dispose();
  body.dispose();
  branch.dispose();
  return result;
}

Future<Map<String, dynamic>?> _settingsForm(
  BuildContext context,
  Map<String, dynamic> current,
) async {
  final fields = <String, TextEditingController>{
    'name': TextEditingController(text: '${current['name'] ?? ''}'),
    'description': TextEditingController(
      text: '${current['description'] ?? ''}',
    ),
    'contact.address': TextEditingController(
      text: '${_map(current['contact'])['address'] ?? ''}',
    ),
    'contact.phone': TextEditingController(
      text: '${_map(current['contact'])['phone'] ?? ''}',
    ),
    'contact.email': TextEditingController(
      text: '${_map(current['contact'])['email'] ?? ''}',
    ),
    'state': TextEditingController(text: '${current['state'] ?? ''}'),
    'lga': TextEditingController(text: '${current['lga'] ?? ''}'),
    'annualFee': TextEditingController(text: '${current['annualFee'] ?? ''}'),
    'registrationFee': TextEditingController(
      text: '${current['registrationFee'] ?? ''}',
    ),
    'renewalCycle': TextEditingController(
      text: '${current['renewalCycle'] ?? 'ANNUAL'}',
    ),
    'membershipMode': TextEditingController(
      text: '${current['membershipMode'] ?? 'MANUAL'}',
    ),
  };
  final key = GlobalKey<FormState>();
  final result = await showDialog<Map<String, dynamic>>(
    context: context,
    builder: (c) => AlertDialog(
      title: const Text('Edit organization settings'),
      content: Form(
        key: key,
        child: SingleChildScrollView(
          child: Column(
            children: [
              for (final entry in fields.entries)
                entry.key == 'renewalCycle'
                    ? DropdownButtonFormField<String>(
                        value: entry.value.text,
                        decoration: InputDecoration(labelText: entry.key),
                        items: const [
                          DropdownMenuItem(value: 'NONE', child: Text('None')),
                          DropdownMenuItem(
                            value: 'MONTHLY',
                            child: Text('Monthly'),
                          ),
                          DropdownMenuItem(
                            value: 'ANNUAL',
                            child: Text('Annual'),
                          ),
                        ],
                        onChanged: (v) =>
                            entry.value.text = v ?? entry.value.text,
                      )
                    : entry.key == 'membershipMode'
                    ? DropdownButtonFormField<String>(
                        value: entry.value.text,
                        decoration: InputDecoration(labelText: entry.key),
                        items: const [
                          DropdownMenuItem(value: 'AUTO', child: Text('Auto')),
                          DropdownMenuItem(
                            value: 'MANUAL',
                            child: Text('Manual'),
                          ),
                        ],
                        onChanged: (v) =>
                            entry.value.text = v ?? entry.value.text,
                      )
                    : TextFormField(
                        controller: entry.value,
                        keyboardType: entry.key.contains('Fee')
                            ? TextInputType.number
                            : TextInputType.text,
                        decoration: InputDecoration(labelText: entry.key),
                        validator: (v) =>
                            entry.key == 'name' && v!.trim().isEmpty
                            ? 'Name is required'
                            : null,
                      ),
            ],
          ),
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(c),
          child: const Text('Cancel'),
        ),
        FilledButton(
          onPressed: () {
            if (!key.currentState!.validate()) return;
            final values = <String, dynamic>{};
            for (final entry in fields.entries) {
              final text = entry.value.text.trim();
              if (entry.key.startsWith('contact.')) continue;
              values[entry.key] = entry.key.contains('Fee')
                  ? num.tryParse(text)
                  : text;
            }
            values['contact'] = {
              'address': fields['contact.address']!.text.trim(),
              'phone': fields['contact.phone']!.text.trim(),
              'email': fields['contact.email']!.text.trim(),
            };
            Navigator.pop(c, values);
          },
          child: const Text('Save'),
        ),
      ],
    ),
  );
  for (final controller in fields.values) {
    controller.dispose();
  }
  return result;
}

Future<Map<String, dynamic>?> _memberEditForm(
  BuildContext context,
  Map<String, dynamic> member,
) async {
  final category = TextEditingController(text: '${member['category'] ?? ''}');
  final branch = TextEditingController(
    text:
        '${member['branch'] is Map ? _map(member['branch'])['_id'] : member['branch'] ?? ''}',
  );
  final key = GlobalKey<FormState>();
  final result = await showDialog<Map<String, dynamic>>(
    context: context,
    builder: (c) => AlertDialog(
      title: const Text('Edit member'),
      content: Form(
        key: key,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextFormField(
              controller: category,
              decoration: const InputDecoration(labelText: 'Category'),
            ),
            TextFormField(
              controller: branch,
              decoration: const InputDecoration(labelText: 'Branch ID'),
            ),
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(c),
          child: const Text('Cancel'),
        ),
        FilledButton(
          onPressed: () => Navigator.pop(c, {
            'category': category.text.trim(),
            'branch': branch.text.trim().isEmpty ? null : branch.text.trim(),
          }),
          child: const Text('Save'),
        ),
      ],
    ),
  );
  category.dispose();
  branch.dispose();
  return result;
}

class OwnerFeesSection extends StatelessWidget {
  const OwnerFeesSection({required this.input, super.key});
  final DashboardInput input;
  @override
  Widget build(BuildContext context) {
    final assignments = _map(input.data['summary']);
    return _dashboardShell(
      'Fees & Dues',
      Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              FilledButton(
                onPressed: () async {
                  final values = await _feeForm(context);
                  if (values != null) await input.action('create', values);
                },
                child: const Text('Create fee'),
              ),
              const SizedBox(width: 8),
              OutlinedButton(
                onPressed: () async {
                  final fees = _list(input.data, 'fees');
                  if (fees.isEmpty) return;
                  final values = await _assignmentForm(context, fees);
                  if (values != null) await input.action('assign', values);
                },
                child: const Text('Assign fee'),
              ),
            ],
          ),
          Text('Assignment summary: ${assignments['outstanding'] ?? '—'}'),
          ...(_list(input.data, 'fees').isEmpty
              ? [_empty('No fees found.')]
              : _list(input.data, 'fees').map(
                  (fee) => Card(
                    child: ListTile(
                      title: Text(_text(fee['name'])),
                      subtitle: Text(
                        'Amount: ${_text(fee['amount'])} • Frequency: ${_text(fee['frequency'])}',
                      ),
                      trailing: IconButton(
                        tooltip: 'Edit fee',
                        onPressed: () async {
                          final values = await _feeForm(context, existing: fee);
                          if (values != null) {
                            await input.action('edit', values);
                          }
                        },
                        icon: const Icon(Icons.edit),
                      ),
                    ),
                  ),
                )),
          ..._list(input.data, 'assignments').map(
            (assignment) => ListTile(
              title: Text(
                'Assignment: ${_text(_map(assignment['fee'])['name'])}',
              ),
              subtitle: Text(
                'Member: ${_text(_map(assignment['member'])['membershipNumber'])} • Amount: ${_text(assignment['amount'])}',
              ),
              trailing: Chip(label: Text(_text(assignment['status']))),
            ),
          ),
          _dashboardPager(input, input.data),
        ],
      ),
    );
  }
}

class OwnerWalletSection extends StatelessWidget {
  const OwnerWalletSection({required this.input, super.key});
  final DashboardInput input;
  @override
  Widget build(BuildContext context) {
    final wallet = {...input.data, ..._map(input.data['wallet'])};
    final ledger = _list(input.data, 'ledger');
    final accounts = _list(input.data, 'settlementAccounts');
    final withdrawals = _list(input.data, 'withdrawals');
    final summary = _map(input.data['summary']);
    return _dashboardShell(
      'Wallet',
      Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              for (final entry in {
                'Available':
                    wallet['availableBalance'] ?? summary['availableBalance'],
                'Ledger': wallet['ledgerBalance'] ?? summary['ledgerBalance'],
                'Held': wallet['heldBalance'] ?? summary['heldBalance'],
                'Pending':
                    wallet['pendingWithdrawals'] ??
                    summary['pendingWithdrawals'],
                'Money in': wallet['totalMoneyIn'] ?? summary['totalMoneyIn'],
                'Money out':
                    wallet['totalWithdrawn'] ?? summary['totalWithdrawn'],
                'Fees': wallet['totalFees'] ?? summary['totalFees'],
              }.entries)
                if (entry.value != null)
                  Chip(label: Text('${entry.key}: ${entry.value}')),
            ],
          ),
          const SizedBox(height: 12),
          Wrap(
            spacing: 8,
            children: [
              FilledButton.icon(
                onPressed: () async {
                  final values = await _settlementAccountForm(context);
                  if (values != null) await input.action('addAccount', values);
                },
                icon: const Icon(Icons.account_balance_outlined),
                label: const Text('Add bank account'),
              ),
              FilledButton.icon(
                onPressed:
                    accounts.any(
                      (a) => '${a['status'] ?? ''}'.toUpperCase() == 'VERIFIED',
                    )
                    ? () async {
                        final values = await _organizationWithdrawalForm(
                          context,
                          accounts,
                        );
                        if (values != null) {
                          await input.action('withdraw', values);
                        }
                      }
                    : null,
                icon: const Icon(Icons.call_made),
                label: const Text('Withdraw funds'),
              ),
            ],
          ),
          const SizedBox(height: 12),
          const Text(
            'Settlement accounts',
            style: TextStyle(fontWeight: FontWeight.bold),
          ),
          ...(accounts.isEmpty
              ? [_empty('No settlement accounts submitted.')]
              : accounts.map(
                  (account) => Card(
                    child: ListTile(
                      leading: const Icon(Icons.account_balance),
                      title: Text(
                        '${_text(account['bankName'])} • ${_text(account['accountName'])}',
                      ),
                      subtitle: Text(
                        'Account ending ${_text(account['accountNumberLast4'] ?? account['last4'])} • ${_text(account['status'])}',
                      ),
                      trailing: account['primary'] == true
                          ? const Chip(label: Text('Primary'))
                          : null,
                    ),
                  ),
                )),
          const SizedBox(height: 12),
          const Text(
            'Withdrawal history',
            style: TextStyle(fontWeight: FontWeight.bold),
          ),
          ...(withdrawals.isEmpty
              ? [_empty('No organization withdrawals yet.')]
              : withdrawals.map(
                  (withdrawal) => Card(
                    child: ListTile(
                      onTap: () => input.detail(withdrawal),
                      title: Text(
                        '${_text(withdrawal['reference'])} • ${_text(withdrawal['amount'])}',
                      ),
                      subtitle: Text(
                        '${_withdrawalStatusLabel(withdrawal['status'])} • ${_text(withdrawal['narration'])}\n${_text(withdrawal['createdAt'])}',
                      ),
                      isThreeLine: true,
                      trailing:
                          '${withdrawal['status']}'.toUpperCase() ==
                              'PENDING_APPROVAL'
                          ? PopupMenuButton<String>(
                              onSelected: (action) async {
                                if (action == 'approve') {
                                  await input.action('approveWithdrawal', {
                                    'withdrawalId':
                                        withdrawal['_id'] ?? withdrawal['id'],
                                  });
                                } else {
                                  await input.action('rejectWithdrawal', {
                                    'withdrawalId':
                                        withdrawal['_id'] ?? withdrawal['id'],
                                    'reason':
                                        'Rejected by organization approver',
                                  });
                                }
                              },
                              itemBuilder: (_) => const [
                                PopupMenuItem(
                                  value: 'approve',
                                  child: Text('Approve'),
                                ),
                                PopupMenuItem(
                                  value: 'reject',
                                  child: Text('Reject'),
                                ),
                              ],
                            )
                          : null,
                    ),
                  ),
                )),
          ...ledger.map(
            (entry) => ListTile(
              title: Text(_text(entry['type'])),
              subtitle: Text(
                'Amount: ${_text(entry['amount'])} • Date: ${_text(entry['createdAt'])}',
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class OwnerBranchesSection extends StatelessWidget {
  const OwnerBranchesSection({required this.input, super.key});
  final DashboardInput input;
  @override
  Widget build(BuildContext context) => _dashboardShell(
    'Branches',
    Column(
      children: [
        FilledButton(
          onPressed: () async {
            final values = await _branchForm(context);
            if (values != null) await input.action('create', values);
          },
          child: const Text('Create branch'),
        ),
        ...(_list(input.data, 'branches').isEmpty
            ? [_empty('No branches found.')]
            : _list(input.data, 'branches').map(
                (branch) => Card(
                  child: ListTile(
                    title: Text(_text(branch['name'])),
                    subtitle: Text(
                      'Code: ${_text(branch['code'])} • Address: ${_text(branch['address'])}\nManager: ${_branchAdminsLabel(branch['branchAdmins'])} • Members: ${_text(branch['membersCount'])} • Collections: ${_text(branch['successfulCollections'])}\nStatus: ${branch['active'] == true ? 'ACTIVE' : 'INACTIVE'}',
                    ),
                    trailing: Wrap(
                      children: [
                        IconButton(
                          tooltip: 'Edit / status',
                          onPressed: () async {
                            final values = await _branchForm(
                              context,
                              existing: branch,
                            );
                            if (values != null) {
                              await input.action('edit', values);
                            }
                          },
                          icon: const Icon(Icons.edit),
                        ),
                        TextButton(
                          onPressed: () => input.openFiltered(
                            'Members',
                            '${branch['_id'] ?? branch['id']}',
                          ),
                          child: const Text('View members'),
                        ),
                        TextButton(
                          onPressed: () => input.openFiltered(
                            'Payments',
                            '${branch['_id'] ?? branch['id']}',
                          ),
                          child: const Text('View payments'),
                        ),
                        TextButton(
                          onPressed: () => input.branchAdmin(
                            '${branch['_id'] ?? branch['id']}',
                          ),
                          child: const Text('Assign admin'),
                        ),
                      ],
                    ),
                  ),
                ),
              )),
        _dashboardPager(input, input.data),
      ],
    ),
  );
}

class OwnerStaffSection extends StatelessWidget {
  const OwnerStaffSection({required this.input, super.key});
  final DashboardInput input;
  @override
  Widget build(BuildContext context) => _dashboardShell(
    'Staff & Roles',
    Column(
      children: [
        FilledButton(
          onPressed: () async {
            final values = await _staffForm(context);
            if (values != null) await input.action('create', values);
          },
          child: const Text('Add staff'),
        ),
        ...(_list(input.data, 'staff').isEmpty
            ? [_empty('No staff found.')]
            : _list(input.data, 'staff').map((staff) {
                final user = _map(staff['user']);
                return Card(
                  child: ListTile(
                    title: Text(_text(user['fullName'])),
                    subtitle: Text(
                      'Role: ${_text(staff['role'])}\nPermissions: ${_text(staff['permissions'])} • Branch: ${_text(staff['branch'])}',
                    ),
                    isThreeLine: true,
                    trailing: IconButton(
                      tooltip: 'Edit / status',
                      onPressed: () async {
                        final values = await _staffForm(
                          context,
                          existing: staff,
                        );
                        if (values != null) {
                          await input.action('edit', values);
                        }
                      },
                      icon: const Icon(Icons.edit),
                    ),
                  ),
                );
              })),
        _dashboardPager(input, input.data),
      ],
    ),
  );
}

class OwnerMessagesSection extends StatelessWidget {
  const OwnerMessagesSection({required this.input, super.key});
  final DashboardInput input;
  @override
  Widget build(BuildContext context) => _dashboardShell(
    'Messages',
    Column(
      children: [
        FilledButton(
          onPressed: () async {
            final values = await _messageForm(context);
            if (values != null) await input.action('publish', values);
          },
          child: const Text('Compose in-app message'),
        ),
        const Text('Supported audiences: ALL, MEMBERS, STAFF, BRANCH'),
        ...(_list(input.data, 'announcements').isEmpty
            ? [_empty('No announcements found.')]
            : _list(input.data, 'announcements').map(
                (message) => Card(
                  child: ListTile(
                    title: Text(_text(message['title'])),
                    subtitle: Text(
                      '${_text(message['body'])}\nAudience: ${_text(message['audience'])} • Published: ${_text(message['publishedAt'])}',
                    ),
                    isThreeLine: true,
                  ),
                ),
              )),
        _dashboardPager(input, input.data),
      ],
    ),
  );
}

class OwnerCardsSection extends StatelessWidget {
  const OwnerCardsSection({required this.input, super.key});
  final DashboardInput input;
  @override
  Widget build(BuildContext context) => _dashboardShell(
    'ID Cards',
    Column(
      children: [
        ...(_list(input.data, 'cards').isEmpty
            ? [_empty('No cards found.')]
            : _list(input.data, 'cards').map((card) {
                final member = _map(card['member']);
                return Card(
                  child: ListTile(
                    title: Text(_text(card['cardNumber'])),
                    subtitle: Text(
                      'Member: ${_text(member['membershipNumber'])} • Status: ${_text(member['status'])}\nIssued: ${_text(card['issuedAt'])}',
                    ),
                    trailing: Wrap(
                      children: [
                        IconButton(
                          tooltip: 'View card detail',
                          onPressed: () => input.detail(card),
                          icon: const Icon(Icons.visibility_outlined),
                        ),
                        const Text('Regeneration/download unavailable'),
                      ],
                    ),
                  ),
                );
              })),
        _dashboardPager(input, input.data),
      ],
    ),
  );
}

class OwnerReportsSection extends StatelessWidget {
  const OwnerReportsSection({required this.input, super.key});
  final DashboardInput input;
  @override
  Widget build(BuildContext context) {
    final report = _map(input.data['report']);
    final kind = input.filters['kind'] ?? 'overview';
    return _dashboardShell(
      'Reports',
      Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          DropdownButtonFormField<String>(
            value: input.filters['kind'] ?? 'overview',
            decoration: const InputDecoration(labelText: 'Report kind'),
            items: const [
              DropdownMenuItem(value: 'overview', child: Text('Overview')),
              DropdownMenuItem(value: 'membership', child: Text('Membership')),
              DropdownMenuItem(value: 'payments', child: Text('Payments')),
              DropdownMenuItem(value: 'fees', child: Text('Fees')),
              DropdownMenuItem(value: 'branches', child: Text('Branches')),
            ],
            onChanged: (value) => input.filter('kind', value ?? ''),
          ),
          DropdownButtonFormField<String>(
            value: input.filters['period'] ?? 'all',
            decoration: const InputDecoration(labelText: 'Period'),
            items: const [
              DropdownMenuItem(value: 'all', child: Text('All')),
              DropdownMenuItem(value: 'month', child: Text('Month')),
              DropdownMenuItem(value: 'year', child: Text('Year')),
            ],
            onChanged: (value) => input.filter('period', value ?? ''),
          ),
          if (kind == 'overview') ...[
            Text('Overview members: ${_text(report['memberCount'])}'),
            Text('Overview status: ${_text(report['byStatus'])}'),
            Text('Payments by status: ${_text(report['paymentsByStatus'])}'),
            Text(
              'Assignments by status: ${_text(report['assignmentsByStatus'])}',
            ),
          ] else if (kind == 'membership') ...[
            Text('Membership count: ${_text(report['memberCount'])}'),
            Text('Membership status: ${_text(report['byStatus'])}'),
            Text('By category: ${_text(report['byCategory'])}'),
            Text('By branch: ${_text(report['byBranch'])}'),
          ] else if (kind == 'payments') ...[
            Text('Payments by status: ${_text(report['byStatus'])}'),
            Text('Successful payments: ${_text(report['successful'])}'),
          ] else if (kind == 'fees') ...[
            Text('Fee definitions: ${_text(report['fees'])}'),
            Text(
              'Assignments by status: ${_text(report['assignmentsByStatus'])}',
            ),
            Text('Amount basis: ${_text(report['amountBasis'])}'),
          ] else
            Text('Branch results: ${_text(report['branches'])}'),
        ],
      ),
    );
  }
}

class OwnerAuditSection extends StatelessWidget {
  const OwnerAuditSection({required this.input, super.key});
  final DashboardInput input;
  @override
  Widget build(BuildContext context) => _dashboardShell(
    'Audit Logs',
    Column(
      children: [
        const Text('Filters'),
        TextField(
          onSubmitted: (value) => input.filter('action', value),
          decoration: const InputDecoration(labelText: 'Action'),
        ),
        TextField(
          onSubmitted: (value) => input.filter('actor', value),
          decoration: const InputDecoration(labelText: 'Actor ID'),
        ),
        TextField(
          onSubmitted: (value) => input.filter('entityType', value),
          decoration: const InputDecoration(labelText: 'Entity type'),
        ),
        TextField(
          onSubmitted: (value) => input.filter('from', value),
          decoration: const InputDecoration(labelText: 'From date'),
        ),
        TextField(
          onSubmitted: (value) => input.filter('to', value),
          decoration: const InputDecoration(labelText: 'To date'),
        ),
        ...(_list(input.data, 'audit').isEmpty
            ? [_empty('No audit events found.')]
            : _list(input.data, 'audit').map((event) {
                final actor = _map(event['actor']);
                return ListTile(
                  title: Text(
                    '${_text(actor['fullName'])} • ${_text(event['action'])}',
                  ),
                  subtitle: Text(
                    'Entity: ${_text(event['entityType'])} • Time: ${_text(event['createdAt'])}',
                  ),
                );
              })),
        _dashboardPager(input, input.data),
      ],
    ),
  );
}

class OwnerSettingsSection extends StatelessWidget {
  const OwnerSettingsSection({required this.input, super.key});
  final DashboardInput input;
  @override
  Widget build(BuildContext context) {
    final settings = _map(input.data['settings']);
    return _dashboardShell(
      'Settings',
      Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Name: ${_text(settings['name'])}'),
          Text('Description: ${_text(settings['description'])}'),
          Text('Contact: ${_text(settings['contact'])}'),
          Text(
            'Fees: registration ${_text(settings['registrationFee'])}, annual ${_text(settings['annualFee'])}',
          ),
          Text('Renewal: ${_text(settings['renewalCycle'])}'),
          Text('Membership mode: ${_text(settings['membershipMode'])}'),
          const SizedBox(height: 12),
          FilledButton(
            onPressed: () async {
              final values = await _settingsForm(context, settings);
              if (values != null) await input.action('update', values);
            },
            child: const Text('Save settings'),
          ),
        ],
      ),
    );
  }
}

class _DashboardError extends StatelessWidget {
  const _DashboardError({required this.message, required this.retry});
  final String message;
  final VoidCallback retry;
  @override
  Widget build(BuildContext context) => Center(
    child: Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(message, textAlign: TextAlign.center),
        const SizedBox(height: 12),
        OutlinedButton(onPressed: retry, child: const Text('Retry')),
      ],
    ),
  );
}

IconData _dashboardIcon(String name) => switch (name) {
  'Overview' => Icons.space_dashboard_outlined,
  'Members' => Icons.groups_outlined,
  'Applications' => Icons.assignment_outlined,
  'Payments' => Icons.receipt_long_outlined,
  'Fees & Dues' => Icons.request_quote_outlined,
  'Wallet' => Icons.account_balance_wallet_outlined,
  'Branches' => Icons.account_tree_outlined,
  'Staff & Roles' => Icons.badge_outlined,
  'Messages' => Icons.mark_unread_chat_alt_outlined,
  'ID Cards' => Icons.contact_mail_outlined,
  'Reports' => Icons.query_stats_outlined,
  'Audit Logs' => Icons.fact_check_outlined,
  'Settings' => Icons.settings_outlined,
  _ => Icons.circle_outlined,
};

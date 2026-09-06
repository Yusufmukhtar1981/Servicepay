import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

class AdminEmpowermentScreen extends StatefulWidget {
  const AdminEmpowermentScreen({super.key});

  @override
  State<AdminEmpowermentScreen> createState() => _AdminEmpowermentScreenState();
}

class _AdminEmpowermentScreenState extends State<AdminEmpowermentScreen> {
  static const String baseUrl = 'https://api.servicepay.ng/api';

  bool isLoading = true;
  String errorMessage = '';

  Map<String, dynamic> summary = {};
  List<dynamic> recentActivity = [];

  @override
  void initState() {
    super.initState();
    loadDashboard();
  }

  Future<String> _getToken() async {
    final prefs = await SharedPreferences.getInstance();

    return prefs.getString('auth_token') ??
        prefs.getString('admin_token') ??
        prefs.getString('token') ??
        '';
  }

  int _asInt(dynamic value) {
    if (value is int) return value;

    if (value is num) {
      return value.toInt();
    }

    return int.tryParse(
          value?.toString() ?? '0',
        ) ??
        0;
  }

  double _asDouble(dynamic value) {
    if (value is double) return value;

    if (value is num) {
      return value.toDouble();
    }

    return double.tryParse(
          value?.toString() ?? '0',
        ) ??
        0;
  }

  String money(dynamic value) {
    final amount = _asDouble(value);

    final parts = amount.toStringAsFixed(0).split('');

    final buffer = StringBuffer();

    for (int i = 0; i < parts.length; i++) {
      final position = parts.length - i;

      buffer.write(parts[i]);

      if (position > 1 && position % 3 == 1) {
        buffer.write(',');
      }
    }

    return '₦${buffer.toString()}';
  }

  Future<void> loadDashboard() async {
    if (mounted) {
      setState(() {
        isLoading = true;
        errorMessage = '';
      });
    }

    try {
      final token = await _getToken();

      if (token.isEmpty) {
        throw Exception(
          'Admin login token not found.',
        );
      }

      final response = await http.get(
        Uri.parse(
          '$baseUrl/empowerment/dashboard-summary',
        ),
        headers: {
          'Accept': 'application/json',
          'Authorization': 'Bearer $token',
        },
      );

      final body = jsonDecode(response.body);

      if (response.statusCode >= 200 &&
          response.statusCode < 300 &&
          body is Map &&
          body['success'] == true) {
        final rawSummary = body['summary'];

        final rawRecent = body['recentActivity'];

        if (!mounted) return;

        setState(() {
          summary = rawSummary is Map
              ? Map<String, dynamic>.from(
                  rawSummary,
                )
              : {};

          if (rawRecent is Map) {
            final beneficiaries = rawRecent['beneficiaries'];

            final batches = rawRecent['disbursementBatches'];

            recentActivity = [
              if (beneficiaries is List)
                ...beneficiaries.map(
                  (item) => {
                    'type': 'BENEFICIARY',
                    'data': item,
                  },
                ),
              if (batches is List)
                ...batches.map(
                  (item) => {
                    'type': 'DISBURSEMENT',
                    'data': item,
                  },
                ),
            ];
          } else {
            recentActivity = [];
          }

          isLoading = false;
        });

        return;
      }

      throw Exception(
        body is Map
            ? (body['message'] ?? 'Unable to load dashboard.').toString()
            : 'Unable to load dashboard.',
      );
    } catch (e) {
      if (!mounted) return;

      setState(() {
        isLoading = false;
        errorMessage = e.toString().replaceFirst(
              'Exception: ',
              '',
            );
      });
    }
  }

  Map<String, dynamic> _section(
    String key,
  ) {
    final value = summary[key];

    if (value is Map) {
      return Map<String, dynamic>.from(
        value,
      );
    }

    return {};
  }

  Future<bool> _patchEmpowermentStatus({
    required String path,
    required String status,
    String rejectionReason = '',
  }) async {
    try {
      final token = await _getToken();

      if (token.trim().isEmpty) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              content: Text('Admin session expired. Please log in again.'),
            ),
          );
        }
        return false;
      }

      final payload = <String, dynamic>{
        'status': status,
      };

      if (rejectionReason.trim().isNotEmpty) {
        payload['rejectionReason'] = rejectionReason.trim();
      }

      final response = await http
          .patch(
            Uri.parse('$baseUrl$path'),
            headers: <String, String>{
              'Accept': 'application/json',
              'Content-Type': 'application/json',
              'Authorization': 'Bearer $token',
            },
            body: jsonEncode(payload),
          )
          .timeout(
            const Duration(seconds: 45),
          );

      dynamic body;

      try {
        body = jsonDecode(response.body);
      } catch (_) {
        body = null;
      }

      final success = response.statusCode >= 200 &&
          response.statusCode < 300 &&
          (body is! Map || body['success'] != false);

      if (!mounted) {
        return success;
      }

      final message = body is Map && body['message'] != null
          ? body['message'].toString()
          : success
              ? 'Status updated successfully.'
              : 'Unable to update status.';

      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(message),
        ),
      );

      if (success) {
        await loadDashboard();
      }

      return success;
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              e.toString().replaceFirst('Exception: ', ''),
            ),
          ),
        );
      }

      return false;
    }
  }

  Future<bool> _updateOrganizationStatus(
    String organizationId,
    String status,
  ) {
    return _patchEmpowermentStatus(
      path: '/empowerment/organizations/$organizationId/status',
      status: status,
    );
  }

  Future<bool> _updateProgramStatus(
    String programId,
    String status,
  ) {
    return _patchEmpowermentStatus(
      path: '/empowerment/programs/$programId/status',
      status: status,
    );
  }

  Future<bool> _updateBeneficiaryStatus(
    String beneficiaryId,
    String status, {
    String rejectionReason = '',
  }) {
    return _patchEmpowermentStatus(
      path: '/empowerment/beneficiaries/$beneficiaryId/status',
      status: status,
      rejectionReason: rejectionReason,
    );
  }

  @override
  Widget build(BuildContext context) {
    final organizations = _section('organizations');

    final programs = _section('programs');

    final beneficiaries = _section('beneficiaries');

    final financials = _section('financials');

    return Scaffold(
      backgroundColor: const Color(0xFFF5F8F6),
      appBar: AppBar(
        title: const Text(
          'ServicePay Empowerment',
          style: TextStyle(
            fontWeight: FontWeight.w800,
          ),
        ),
        backgroundColor: const Color(0xFF08783E),
        foregroundColor: Colors.white,
        actions: [
          IconButton(
            tooltip: 'Refresh',
            onPressed: isLoading ? null : loadDashboard,
            icon: const Icon(
              Icons.refresh_rounded,
            ),
          ),
        ],
      ),
      body: isLoading
          ? const Center(
              child: CircularProgressIndicator(),
            )
          : errorMessage.isNotEmpty
              ? _errorView()
              : RefreshIndicator(
                  onRefresh: loadDashboard,
                  child: ListView(
                    padding: const EdgeInsets.all(
                      18,
                    ),
                    children: [
                      _heroCard(),
                      const SizedBox(
                        height: 18,
                      ),
                      const Text(
                        'Overview',
                        style: TextStyle(
                          fontSize: 21,
                          fontWeight: FontWeight.w900,
                          color: Color(
                            0xFF17231C,
                          ),
                        ),
                      ),
                      const SizedBox(
                        height: 12,
                      ),
                      _metricGrid(
                        organizations,
                        programs,
                        beneficiaries,
                      ),
                      const SizedBox(
                        height: 22,
                      ),
                      const Text(
                        'Financial Summary',
                        style: TextStyle(
                          fontSize: 21,
                          fontWeight: FontWeight.w900,
                        ),
                      ),
                      const SizedBox(
                        height: 12,
                      ),
                      _financialCard(
                        financials,
                      ),
                      const SizedBox(
                        height: 22,
                      ),
                      _quickActions(),
                      const SizedBox(
                        height: 22,
                      ),
                      const Text(
                        'Recent Activity',
                        style: TextStyle(
                          fontSize: 21,
                          fontWeight: FontWeight.w900,
                        ),
                      ),
                      const SizedBox(
                        height: 12,
                      ),
                      _recentActivity(),
                    ],
                  ),
                ),
    );
  }

  Widget _heroCard() {
    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: const Color(0xFF08783E),
        borderRadius: BorderRadius.circular(22),
      ),
      child: const Row(
        children: [
          CircleAvatar(
            radius: 30,
            backgroundColor: Colors.white24,
            child: Icon(
              Icons.volunteer_activism_rounded,
              color: Colors.white,
              size: 32,
            ),
          ),
          SizedBox(width: 16),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Empowerment Control Center',
                  style: TextStyle(
                    color: Colors.white,
                    fontSize: 20,
                    fontWeight: FontWeight.w900,
                  ),
                ),
                SizedBox(height: 5),
                Text(
                  'Manage organizations, programs, beneficiaries and disbursements.',
                  style: TextStyle(
                    color: Colors.white70,
                    height: 1.4,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _metricGrid(
    Map<String, dynamic> organizations,
    Map<String, dynamic> programs,
    Map<String, dynamic> beneficiaries,
  ) {
    return LayoutBuilder(
      builder: (
        context,
        constraints,
      ) {
        final wide = constraints.maxWidth >= 700;

        final width =
            wide ? (constraints.maxWidth - 12) / 2 : constraints.maxWidth;

        final cards = [
          _MetricCard(
            title: 'Organizations',
            value: '${_asInt(organizations['total'])}',
            subtitle: '${_asInt(organizations['active'])} active',
            icon: Icons.account_balance_rounded,
          ),
          _MetricCard(
            title: 'Programs',
            value: '${_asInt(programs['total'])}',
            subtitle: '${_asInt(programs['active'])} active',
            icon: Icons.campaign_rounded,
          ),
          _MetricCard(
            title: 'Beneficiaries',
            value: '${_asInt(beneficiaries['total'])}',
            subtitle: '${_asInt(beneficiaries['approved'])} approved',
            icon: Icons.groups_rounded,
          ),
          _MetricCard(
            title: 'Paid',
            value: '${_asInt(beneficiaries['paid'])}',
            subtitle: '${_asInt(beneficiaries['pending'])} pending',
            icon: Icons.payments_rounded,
          ),
        ];

        return Wrap(
          spacing: 12,
          runSpacing: 12,
          children: cards
              .map(
                (card) => SizedBox(
                  width: width,
                  child: card,
                ),
              )
              .toList(),
        );
      },
    );
  }

  Widget _financialCard(
    Map<String, dynamic> financials,
  ) {
    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(
          color: const Color(
            0xFFE3ECE6,
          ),
        ),
      ),
      child: Column(
        children: [
          _moneyRow(
            'Total Budget',
            financials['totalBudget'],
          ),
          const Divider(height: 26),
          _moneyRow(
            'Total Disbursed',
            financials['totalDisbursed'],
          ),
          const Divider(height: 26),
          _moneyRow(
            'Remaining Budget',
            financials['remainingBudget'],
          ),
        ],
      ),
    );
  }

  Widget _moneyRow(
    String label,
    dynamic value,
  ) {
    return Row(
      children: [
        Expanded(
          child: Text(
            label,
            style: const TextStyle(
              fontSize: 15,
              color: Color(
                0xFF667085,
              ),
            ),
          ),
        ),
        Text(
          money(value),
          style: const TextStyle(
            fontSize: 18,
            fontWeight: FontWeight.w900,
            color: Color(
              0xFF08783E,
            ),
          ),
        ),
      ],
    );
  }

  Widget _quickActions() {
    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(18),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'Management',
            style: TextStyle(
              fontSize: 19,
              fontWeight: FontWeight.w900,
            ),
          ),
          const SizedBox(height: 12),
          _actionRow(
            Icons.account_balance_outlined,
            'Organizations',
            'Government, NGO and private organizations',
          ),
          _actionRow(
            Icons.campaign_outlined,
            'Programs',
            'Create and manage empowerment programs',
          ),
          _actionRow(
            Icons.groups_outlined,
            'Beneficiaries',
            'Review applications and beneficiaries',
          ),
          _actionRow(
            Icons.payments_outlined,
            'Disbursements',
            'Preview and manage payment batches',
            onTap: _openDisbursementsManager,
          ),
          _actionRow(
            Icons.history_rounded,
            'Audit Trail',
            'Review empowerment activities',
          ),
        ],
      ),
    );
  }

  Future<Map<String, String>> _empowermentHeaders() async {
    final token = await _getToken();

    if (token.trim().isEmpty) {
      throw Exception('Admin session expired. Please log in again.');
    }

    return <String, String>{
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'Authorization': 'Bearer $token',
    };
  }

  List<dynamic> _extractList(
    dynamic body,
    String key,
  ) {
    if (body is Map) {
      final direct = body[key];

      if (direct is List) {
        return direct;
      }

      final data = body['data'];

      if (data is Map && data[key] is List) {
        return data[key] as List<dynamic>;
      }
    }

    return <dynamic>[];
  }

  Future<List<dynamic>> _loadEmpowermentList(
    String path,
    String key,
  ) async {
    final headers = await _empowermentHeaders();

    final response = await http
        .get(
          Uri.parse('$baseUrl$path'),
          headers: headers,
        )
        .timeout(
          const Duration(seconds: 45),
        );

    dynamic body;

    try {
      body = jsonDecode(response.body);
    } catch (_) {
      body = null;
    }

    if (response.statusCode < 200 || response.statusCode >= 300) {
      String message = 'Unable to load $key.';

      if (body is Map && body['message'] != null) {
        message = body['message'].toString();
      }

      throw Exception(message);
    }

    return _extractList(
      body,
      key,
    );
  }

  Future<void> _showStatusPicker({
    required String title,
    required String currentStatus,
    required List<String> statuses,
    required Future<void> Function(String status) onSelected,
  }) async {
    final selected = await showDialog<String>(
      context: context,
      builder: (dialogContext) {
        return AlertDialog(
          title: Text(title),
          content: SizedBox(
            width: 420,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Current status: ${currentStatus.isEmpty ? 'UNKNOWN' : currentStatus}',
                  style: const TextStyle(
                    fontWeight: FontWeight.w700,
                  ),
                ),
                const SizedBox(height: 14),
                const Text(
                  'Select new status:',
                ),
                const SizedBox(height: 10),
                Flexible(
                  child: SingleChildScrollView(
                    child: Column(
                      children: statuses
                          .map(
                            (status) => ListTile(
                              contentPadding: EdgeInsets.zero,
                              title: Text(
                                status.replaceAll(
                                  '_',
                                  ' ',
                                ),
                              ),
                              trailing: status == currentStatus.toUpperCase()
                                  ? const Icon(
                                      Icons.check_circle_rounded,
                                    )
                                  : const Icon(
                                      Icons.chevron_right_rounded,
                                    ),
                              onTap: () {
                                Navigator.of(
                                  dialogContext,
                                ).pop(status);
                              },
                            ),
                          )
                          .toList(),
                    ),
                  ),
                ),
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: () {
                Navigator.of(
                  dialogContext,
                ).pop();
              },
              child: const Text('Cancel'),
            ),
          ],
        );
      },
    );

    if (selected == null || !mounted) {
      return;
    }

    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) {
        return AlertDialog(
          title: const Text(
            'Confirm Action',
          ),
          content: Text(
            'Are you sure you want to change this status to ${selected.replaceAll('_', ' ')}?',
          ),
          actions: [
            TextButton(
              onPressed: () {
                Navigator.of(
                  dialogContext,
                ).pop(false);
              },
              child: const Text('Cancel'),
            ),
            FilledButton(
              onPressed: () {
                Navigator.of(
                  dialogContext,
                ).pop(true);
              },
              child: const Text('Confirm'),
            ),
          ],
        );
      },
    );

    if (confirmed != true || !mounted) {
      return;
    }

    await onSelected(selected);

    if (!mounted) {
      return;
    }

    await loadDashboard();
  }

  Future<void> _openOrganizationsManager() async {
    try {
      final organizations = await _loadEmpowermentList(
        '/empowerment/organizations',
        'organizations',
      );

      if (!mounted) {
        return;
      }

      await showDialog<void>(
        context: context,
        builder: (dialogContext) {
          return AlertDialog(
            title: const Text(
              'Empowerment Organizations',
            ),
            content: SizedBox(
              width: 620,
              height: 480,
              child: organizations.isEmpty
                  ? const Center(
                      child: Text(
                        'No organizations found.',
                      ),
                    )
                  : ListView.separated(
                      itemCount: organizations.length,
                      separatorBuilder: (_, __) => const Divider(
                        height: 1,
                      ),
                      itemBuilder: (context, index) {
                        final raw = organizations[index];

                        final item = raw is Map
                            ? Map<String, dynamic>.from(
                                raw,
                              )
                            : <String, dynamic>{};

                        final id = (item['_id'] ?? item['id'] ?? '').toString();

                        final name =
                            (item['name'] ?? 'Organization').toString();

                        final status = (item['status'] ?? 'PENDING')
                            .toString()
                            .toUpperCase();

                        return ListTile(
                          leading: const CircleAvatar(
                            child: Icon(
                              Icons.account_balance_outlined,
                            ),
                          ),
                          title: Text(name),
                          subtitle: Text(
                            'Status: $status',
                          ),
                          trailing: const Icon(
                            Icons.manage_accounts_outlined,
                          ),
                          onTap: id.isEmpty
                              ? null
                              : () async {
                                  Navigator.of(
                                    dialogContext,
                                  ).pop();

                                  await _showStatusPicker(
                                    title: name,
                                    currentStatus: status,
                                    statuses: const [
                                      'PENDING',
                                      'ACTIVE',
                                      'SUSPENDED',
                                      'REJECTED',
                                    ],
                                    onSelected: (
                                      newStatus,
                                    ) async {
                                      await _updateOrganizationStatus(
                                        id,
                                        newStatus,
                                      );
                                    },
                                  );
                                },
                        );
                      },
                    ),
            ),
            actions: [
              TextButton(
                onPressed: () {
                  Navigator.of(
                    dialogContext,
                  ).pop();
                },
                child: const Text('Close'),
              ),
            ],
          );
        },
      );
    } catch (e) {
      if (!mounted) {
        return;
      }

      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            e.toString().replaceFirst(
                  'Exception: ',
                  '',
                ),
          ),
        ),
      );
    }
  }

  Future<void> _openProgramsManager() async {
    try {
      final programs = await _loadEmpowermentList(
        '/empowerment/programs',
        'programs',
      );

      if (!mounted) {
        return;
      }

      await showDialog<void>(
        context: context,
        builder: (dialogContext) {
          return AlertDialog(
            title: const Text(
              'Empowerment Programs',
            ),
            content: SizedBox(
              width: 620,
              height: 480,
              child: programs.isEmpty
                  ? const Center(
                      child: Text(
                        'No programs found.',
                      ),
                    )
                  : ListView.separated(
                      itemCount: programs.length,
                      separatorBuilder: (_, __) => const Divider(
                        height: 1,
                      ),
                      itemBuilder: (context, index) {
                        final raw = programs[index];

                        final item = raw is Map
                            ? Map<String, dynamic>.from(
                                raw,
                              )
                            : <String, dynamic>{};

                        final id = (item['_id'] ?? item['id'] ?? '').toString();

                        final name = (item['name'] ?? 'Program').toString();

                        final status = (item['status'] ?? 'DRAFT')
                            .toString()
                            .toUpperCase();

                        return ListTile(
                          leading: const CircleAvatar(
                            child: Icon(
                              Icons.volunteer_activism_outlined,
                            ),
                          ),
                          title: Text(name),
                          subtitle: Text(
                            'Status: $status',
                          ),
                          trailing: const Icon(
                            Icons.manage_accounts_outlined,
                          ),
                          onTap: id.isEmpty
                              ? null
                              : () async {
                                  Navigator.of(
                                    dialogContext,
                                  ).pop();

                                  await _showStatusPicker(
                                    title: name,
                                    currentStatus: status,
                                    statuses: const [
                                      'DRAFT',
                                      'OPEN',
                                      'UNDER_REVIEW',
                                      'APPROVED',
                                      'DISBURSING',
                                      'COMPLETED',
                                      'SUSPENDED',
                                      'CANCELLED',
                                    ],
                                    onSelected: (
                                      newStatus,
                                    ) async {
                                      await _updateProgramStatus(
                                        id,
                                        newStatus,
                                      );
                                    },
                                  );
                                },
                        );
                      },
                    ),
            ),
            actions: [
              TextButton(
                onPressed: () {
                  Navigator.of(
                    dialogContext,
                  ).pop();
                },
                child: const Text('Close'),
              ),
            ],
          );
        },
      );
    } catch (e) {
      if (!mounted) {
        return;
      }

      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            e.toString().replaceFirst(
                  'Exception: ',
                  '',
                ),
          ),
        ),
      );
    }
  }

  Future<void> _openDisbursementsManager() async {
    try {
      final items = await _loadEmpowermentList(
        '/empowerment/dashboard-summary',
        'disbursementBatches',
      );

      if (!mounted) return;

      await showDialog<void>(
        context: context,
        builder: (dialogContext) {
          return AlertDialog(
            title: const Text('Disbursements'),
            content: SizedBox(
              width: 760,
              child: items.isEmpty
                  ? const Padding(
                      padding: EdgeInsets.all(20),
                      child: Text(
                        'No disbursement records available yet.',
                      ),
                    )
                  : ListView.separated(
                      shrinkWrap: true,
                      itemCount: items.length,
                      separatorBuilder: (_, __) => const Divider(height: 1),
                      itemBuilder: (_, index) {
                        final item = items[index];
                        return ListTile(
                          leading: const CircleAvatar(
                            child: Icon(Icons.payments_outlined),
                          ),
                          title: Text(
                            item['batchReference']?.toString() ??
                                item['reference']?.toString() ??
                                'Disbursement',
                          ),
                          subtitle: Text(
                            item['status']?.toString() ?? 'Prepared',
                          ),
                        );
                      },
                    ),
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.of(dialogContext).pop(),
                child: const Text('Close'),
              ),
            ],
          );
        },
      );
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            'Unable to load disbursements: $e',
          ),
        ),
      );
    }
  }

  Future<void> _openBeneficiariesManager() async {
    try {
      final programs = await _loadEmpowermentList(
        '/empowerment/programs',
        'programs',
      );

      if (!mounted) {
        return;
      }

      final selectedProgram = await showDialog<Map<String, dynamic>>(
        context: context,
        builder: (dialogContext) {
          return AlertDialog(
            title: const Text(
              'Select Program',
            ),
            content: SizedBox(
              width: 560,
              height: 420,
              child: programs.isEmpty
                  ? const Center(
                      child: Text(
                        'No programs found.',
                      ),
                    )
                  : ListView.builder(
                      itemCount: programs.length,
                      itemBuilder: (context, index) {
                        final raw = programs[index];

                        final item = raw is Map
                            ? Map<String, dynamic>.from(
                                raw,
                              )
                            : <String, dynamic>{};

                        return ListTile(
                          leading: const Icon(
                            Icons.volunteer_activism_outlined,
                          ),
                          title: Text(
                            (item['name'] ?? 'Program').toString(),
                          ),
                          subtitle: Text(
                            (item['status'] ?? '').toString(),
                          ),
                          trailing: const Icon(
                            Icons.chevron_right_rounded,
                          ),
                          onTap: () {
                            Navigator.of(
                              dialogContext,
                            ).pop(item);
                          },
                        );
                      },
                    ),
            ),
          );
        },
      );

      if (selectedProgram == null || !mounted) {
        return;
      }

      final programId =
          (selectedProgram['_id'] ?? selectedProgram['id'] ?? '').toString();

      if (programId.isEmpty) {
        throw Exception(
          'Program ID is missing.',
        );
      }

      final beneficiaries = await _loadEmpowermentList(
        '/empowerment/programs/$programId/beneficiaries',
        'beneficiaries',
      );

      if (!mounted) {
        return;
      }

      await showDialog<void>(
        context: context,
        builder: (dialogContext) {
          return AlertDialog(
            title: Text(
              '${selectedProgram['name'] ?? 'Program'} Beneficiaries',
            ),
            content: SizedBox(
              width: 620,
              height: 480,
              child: beneficiaries.isEmpty
                  ? const Center(
                      child: Text(
                        'No beneficiaries found.',
                      ),
                    )
                  : ListView.separated(
                      itemCount: beneficiaries.length,
                      separatorBuilder: (_, __) => const Divider(
                        height: 1,
                      ),
                      itemBuilder: (context, index) {
                        final raw = beneficiaries[index];

                        final item = raw is Map
                            ? Map<String, dynamic>.from(
                                raw,
                              )
                            : <String, dynamic>{};

                        final id = (item['_id'] ?? item['id'] ?? '').toString();

                        final name = (item['fullName'] ??
                                item['name'] ??
                                item['phone'] ??
                                'Beneficiary')
                            .toString();

                        final status = (item['applicationStatus'] ??
                                item['status'] ??
                                'SUBMITTED')
                            .toString()
                            .toUpperCase();

                        return ListTile(
                          leading: const CircleAvatar(
                            child: Icon(
                              Icons.person_outline_rounded,
                            ),
                          ),
                          title: Text(name),
                          subtitle: Text(
                            'Status: $status',
                          ),
                          trailing: const Icon(
                            Icons.manage_accounts_outlined,
                          ),
                          onTap: id.isEmpty
                              ? null
                              : () async {
                                  Navigator.of(
                                    dialogContext,
                                  ).pop();

                                  await _showStatusPicker(
                                    title: name,
                                    currentStatus: status,
                                    statuses: const [
                                      'SUBMITTED',
                                      'UNDER_REVIEW',
                                      'APPROVED',
                                      'REJECTED',
                                      'PAYMENT_PENDING',
                                      'PAID',
                                      'FAILED',
                                      'REVERSED',
                                    ],
                                    onSelected: (
                                      newStatus,
                                    ) async {
                                      await _updateBeneficiaryStatus(
                                        id,
                                        newStatus,
                                      );
                                    },
                                  );
                                },
                        );
                      },
                    ),
            ),
            actions: [
              TextButton(
                onPressed: () {
                  Navigator.of(
                    dialogContext,
                  ).pop();
                },
                child: const Text('Close'),
              ),
            ],
          );
        },
      );
    } catch (e) {
      if (!mounted) {
        return;
      }

      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            e.toString().replaceFirst(
                  'Exception: ',
                  '',
                ),
          ),
        ),
      );
    }
  }

  Widget _actionRow(
    IconData icon,
    String title,
    String subtitle, {
    VoidCallback? onTap,
  }) {
    return ListTile(
      contentPadding: EdgeInsets.zero,
      leading: CircleAvatar(
        backgroundColor: const Color(
          0xFFEAF7F0,
        ),
        child: Icon(
          icon,
          color: const Color(
            0xFF08783E,
          ),
        ),
      ),
      title: Text(
        title,
        style: const TextStyle(
          fontWeight: FontWeight.w800,
        ),
      ),
      subtitle: Text(subtitle),
      trailing: const Icon(
        Icons.chevron_right_rounded,
      ),
      onTap: () async {
        if (title == 'Organizations') {
          await _openOrganizationsManager();
          return;
        }

        if (title == 'Programs') {
          await _openProgramsManager();
          return;
        }

        if (title == 'Beneficiaries') {
          await _openBeneficiariesManager();
          return;
        }

        if (!mounted) {
          return;
        }

        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              '$title management is not enabled yet.',
            ),
          ),
        );
      },
    );
  }

  Widget _recentActivity() {
    if (recentActivity.isEmpty) {
      return Container(
        padding: const EdgeInsets.all(22),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(
            18,
          ),
        ),
        child: const Center(
          child: Text(
            'No recent empowerment activity yet.',
          ),
        ),
      );
    }

    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(18),
      ),
      child: Column(
        children: recentActivity
            .take(10)
            .map(
              (item) => _activityTile(
                Map<String, dynamic>.from(
                  item as Map,
                ),
              ),
            )
            .toList(),
      ),
    );
  }

  Widget _activityTile(
    Map<String, dynamic> wrapper,
  ) {
    final type = wrapper['type']?.toString() ?? '';

    final raw = wrapper['data'];

    final data = raw is Map
        ? Map<String, dynamic>.from(
            raw,
          )
        : <String, dynamic>{};

    if (type == 'DISBURSEMENT') {
      return ListTile(
        leading: const CircleAvatar(
          child: Icon(
            Icons.payments_outlined,
          ),
        ),
        title: Text(
          data['batchReference']?.toString() ?? 'Disbursement batch',
        ),
        subtitle: Text(
          data['status']?.toString() ?? 'Prepared',
        ),
      );
    }

    return ListTile(
      leading: const CircleAvatar(
        child: Icon(
          Icons.person_outline_rounded,
        ),
      ),
      title: Text(
        data['fullName']?.toString() ??
            data['name']?.toString() ??
            'Beneficiary',
      ),
      subtitle: Text(
        data['applicationStatus']?.toString() ??
            data['status']?.toString() ??
            'Application',
      ),
    );
  }

  Widget _errorView() {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Icon(
              Icons.cloud_off_rounded,
              size: 54,
              color: Colors.grey,
            ),
            const SizedBox(height: 14),
            const Text(
              'Unable to load Empowerment',
              style: TextStyle(
                fontSize: 20,
                fontWeight: FontWeight.w900,
              ),
            ),
            const SizedBox(height: 8),
            Text(
              errorMessage,
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 18),
            ElevatedButton.icon(
              onPressed: loadDashboard,
              icon: const Icon(
                Icons.refresh,
              ),
              label: const Text(
                'Try Again',
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _MetricCard extends StatelessWidget {
  final String title;
  final String value;
  final String subtitle;
  final IconData icon;

  const _MetricCard({
    required this.title,
    required this.value,
    required this.subtitle,
    required this.icon,
  });

  @override
  Widget build(
    BuildContext context,
  ) {
    return Container(
      padding: const EdgeInsets.all(17),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(
          color: const Color(
            0xFFE5ECE8,
          ),
        ),
      ),
      child: Row(
        children: [
          Container(
            width: 48,
            height: 48,
            decoration: BoxDecoration(
              color: const Color(
                0xFFEAF7F0,
              ),
              borderRadius: BorderRadius.circular(
                14,
              ),
            ),
            child: Icon(
              icon,
              color: const Color(
                0xFF08783E,
              ),
            ),
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: const TextStyle(
                    color: Color(
                      0xFF667085,
                    ),
                  ),
                ),
                const SizedBox(
                  height: 3,
                ),
                Text(
                  value,
                  style: const TextStyle(
                    fontSize: 22,
                    fontWeight: FontWeight.w900,
                  ),
                ),
                Text(
                  subtitle,
                  style: const TextStyle(
                    fontSize: 12,
                    color: Color(
                      0xFF667085,
                    ),
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

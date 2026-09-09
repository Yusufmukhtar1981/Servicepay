import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

class AdminEmpowermentScreen extends StatefulWidget {
  const AdminEmpowermentScreen({
    super.key,
    this.httpClient,
  });

  final http.Client? httpClient;

  @override
  State<AdminEmpowermentScreen> createState() => _AdminEmpowermentScreenState();
}

class _AdminEmpowermentScreenState extends State<AdminEmpowermentScreen> {
  static const String baseUrl = 'https://api.servicepay.ng/api';

  late final http.Client _httpClient;

  bool isLoading = true;
  String errorMessage = '';
  bool isHeadOffice = false;
  bool isDisbursing = false;
  bool isFunding = false;
  final Map<String, String> _fundingIdempotencyKeys = {};
  final Map<String, String> _bulkDisbursementIdempotencyKeys = {};

  Map<String, dynamic> summary = {};
  List<dynamic> recentActivity = [];

  @override
  void initState() {
    super.initState();
    _httpClient = widget.httpClient ?? http.Client();
    _initializeScreen();
  }

  @override
  void dispose() {
    if (widget.httpClient == null) {
      _httpClient.close();
    }
    super.dispose();
  }

  Future<String> _getToken() async {
    final prefs = await SharedPreferences.getInstance();

    return prefs.getString('auth_token') ??
        prefs.getString('admin_token') ??
        prefs.getString('token') ??
        '';
  }

  Future<void> _initializeScreen() async {
    final prefs = await SharedPreferences.getInstance();
    final role = (prefs.getString('user_role') ??
            prefs.getString('role') ??
            prefs.getString('admin_role') ??
            '')
        .trim()
        .toUpperCase()
        .replaceAll(RegExp(r'[\s-]+'), '_');

    if (mounted) {
      setState(() {
        isHeadOffice = role == 'HEAD_OFFICE';
      });
    }

    await loadDashboard();
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

      final response = await _httpClient.get(
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

  Map<String, dynamic> _programMap(dynamic value) {
    return value is Map
        ? Map<String, dynamic>.from(value)
        : <String, dynamic>{};
  }

  Map<String, dynamic> _programFinancials(
    Map<String, dynamic> program,
  ) {
    final nested = _programMap(program['financials']);

    return {
      'totalBudget': nested['totalBudget'] ??
          program['totalBudget'] ??
          program['budget'] ??
          0,
      'totalFundedAmount': nested['totalFundedAmount'] ??
          nested['fundedAmount'] ??
          program['totalFundedAmount'] ??
          program['totalFunded'] ??
          0,
      'totalDisbursedAmount': nested['totalDisbursedAmount'] ??
          nested['disbursedAmount'] ??
          program['totalDisbursedAmount'] ??
          program['totalDisbursed'] ??
          0,
      'availableFundingAmount': nested['availableFundingAmount'] ??
          nested['availableBalance'] ??
          program['availableFundingAmount'] ??
          program['remainingBalance'] ??
          program['availableBalance'] ??
          0,
    };
  }

  String _programStatus(
    Map<String, dynamic> program,
  ) {
    final status = (program['status'] ?? '').toString().trim();
    return status.isEmpty
        ? 'DRAFT'
        : status.toUpperCase().replaceAll(RegExp(r'[\s-]+'), '_');
  }

  bool _isPayoutEligibleProgramStatus(String status) {
    return const {'APPROVED', 'DISBURSING'}.contains(
      status.trim().toUpperCase().replaceAll(RegExp(r'[\s-]+'), '_'),
    );
  }

  bool _hasSufficientProgramFunding({
    required dynamic remainingBalance,
    required dynamic amountPerBeneficiary,
  }) {
    final remaining = _asDouble(remainingBalance);
    final amount = _asDouble(amountPerBeneficiary);
    return amount > 0 && remaining >= amount;
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

      final response = await _httpClient
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

      final fallbackMessage =
          success ? 'Status updated successfully.' : 'Unable to update status.';
      final message = path.contains('/empowerment/beneficiaries/')
          ? _beneficiaryApiMessage(
              response.statusCode,
              body,
              fallback: fallbackMessage,
            )
          : body is Map && body['message'] != null
              ? body['message'].toString()
              : fallbackMessage;

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

  String _beneficiaryApiMessage(
    int statusCode,
    dynamic body, {
    required String fallback,
    bool isVerificationAction = false,
  }) {
    final serverMessage = body is Map && body['message'] != null
        ? body['message'].toString()
        : '';
    final normalizedMessage = serverMessage.toLowerCase();

    if (statusCode == 401 || statusCode == 403) {
      return 'You are not authorized to perform this beneficiary action.';
    }

    if (statusCode == 404 || statusCode == 405) {
      return isVerificationAction
          ? 'Beneficiary verification is not available on the production API yet. '
              'The main ServicePay backend must expose this protected action.'
          : 'The beneficiary record or application-status action is not available.';
    }

    if (normalizedMessage.contains('verify') &&
        normalizedMessage.contains('beneficiar')) {
      return 'This beneficiary must be verified before approval.';
    }

    if (normalizedMessage.contains('kyc') ||
        normalizedMessage.contains('nin') ||
        normalizedMessage.contains('bvn') ||
        normalizedMessage.contains('identity')) {
      return 'The beneficiary does not meet the KYC requirement: $serverMessage';
    }

    return serverMessage.isNotEmpty ? serverMessage : fallback;
  }

  Future<bool> _updateBeneficiaryVerification(
    String beneficiaryId,
    String verificationStatus,
  ) async {
    try {
      final token = await _getToken();

      if (token.trim().isEmpty) {
        throw Exception('Admin session expired. Please log in again.');
      }

      final response = await _httpClient
          .patch(
            Uri.parse(
              '$baseUrl/empowerment/beneficiaries/$beneficiaryId/verify',
            ),
            headers: <String, String>{
              'Accept': 'application/json',
              'Content-Type': 'application/json',
              'Authorization': 'Bearer $token',
            },
            body: jsonEncode(
              {
                'verificationStatus': verificationStatus,
              },
            ),
          )
          .timeout(const Duration(seconds: 45));

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

      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            success
                ? body is Map && body['message'] != null
                    ? body['message'].toString()
                    : 'Beneficiary verification updated successfully.'
                : _beneficiaryApiMessage(
                    response.statusCode,
                    body,
                    fallback: 'Unable to update beneficiary verification.',
                  isVerificationAction: true,
                  ),
          ),
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
          if (isHeadOffice)
            _actionRow(
              Icons.payments_outlined,
              'Disbursements',
              'Review protected payout history',
              onTap: _openDisbursementsManager,
            ),
          _actionRow(
            Icons.history_rounded,
            'Audit Trail',
            'Review empowerment activities',
            onTap: _openAuditTrailManager,
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
    String preferredKey,
  ) async {
    final prefs = await SharedPreferences.getInstance();
    final token = prefs.getString('auth_token') ?? '';

    if (token.trim().isEmpty) {
      throw Exception('Authentication token not found.');
    }

    final response = await _httpClient.get(
      Uri.parse('$baseUrl$path'),
      headers: {
        'Authorization': 'Bearer $token',
        'Accept': 'application/json',
      },
    );

    dynamic decoded;

    try {
      decoded = jsonDecode(response.body);
    } catch (_) {
      throw Exception(
        'Invalid server response (${response.statusCode}).',
      );
    }

    if (response.statusCode < 200 || response.statusCode >= 300) {
      String message = 'Unable to load empowerment information.';

      if (decoded is Map && decoded['message'] != null) {
        message = decoded['message'].toString();
      }

      throw Exception(message);
    }

    if (decoded is List) {
      return List<dynamic>.from(decoded);
    }

    if (decoded is Map) {
      final direct = decoded[preferredKey];

      if (direct is List) {
        return List<dynamic>.from(direct);
      }

      final data = decoded['data'];

      if (data is List) {
        return List<dynamic>.from(data);
      }

      if (data is Map) {
        final nestedPreferred = data[preferredKey];

        if (nestedPreferred is List) {
          return List<dynamic>.from(nestedPreferred);
        }

        for (final key in const [
          'organizations',
          'programs',
          'beneficiaries',
          'batches',
          'items',
          'results',
          'records',
        ]) {
          final value = data[key];

          if (value is List) {
            return List<dynamic>.from(value);
          }
        }
      }

      for (final key in const [
        'organizations',
        'programs',
        'beneficiaries',
        'batches',
        'items',
        'results',
        'records',
      ]) {
        final value = decoded[key];

        if (value is List) {
          return List<dynamic>.from(value);
        }
      }
    }

    return <dynamic>[];
  }

  Future<Map<String, dynamic>> _loadEmpowermentProgram(
    String programId,
  ) async {
    final headers = await _empowermentHeaders();
    final response = await _httpClient.get(
      Uri.parse('$baseUrl/empowerment/programs/$programId'),
      headers: headers,
    );

    dynamic decoded;
    try {
      decoded = jsonDecode(response.body);
    } catch (_) {
      throw Exception('Invalid program response (${response.statusCode}).');
    }

    if (response.statusCode < 200 || response.statusCode >= 300) {
      final message = decoded is Map && decoded['message'] != null
          ? decoded['message'].toString()
          : 'Unable to refresh program funding.';
      throw Exception(message);
    }

    final program = decoded is Map
        ? _programMap(
            decoded['program'] ??
                (decoded['data'] is Map
                    ? (decoded['data'] as Map)['program']
                    : null),
          )
        : <String, dynamic>{};
    if (program.isEmpty) {
      throw Exception('Program funding details are unavailable.');
    }

    final financials = decoded is Map
        ? _programMap(
            decoded['financials'] ??
                (decoded['data'] is Map
                    ? (decoded['data'] as Map)['financials']
                    : null),
          )
        : <String, dynamic>{};
    if (financials.isNotEmpty) {
      program['financials'] = financials;
    }

    return program;
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

  Future<void> _openCreateOrganizationDialog() async {
    final nameController = TextEditingController();
    final contactController = TextEditingController();
    final phoneController = TextEditingController();
    final emailController = TextEditingController();
    final stateController = TextEditingController();
    final lgaController = TextEditingController();

    String organizationType = 'COMPANY';
    bool isSubmitting = false;

    const organizationTypes = <String>[
      'STATE_GOVERNMENT',
      'LOCAL_GOVERNMENT',
      'POLITICIAN',
      'NGO',
      'FOUNDATION',
      'COMPANY',
      'COOPERATIVE',
      'INDIVIDUAL',
      'OTHER',
    ];

    try {
      await showDialog<void>(
        context: context,
        barrierDismissible: false,
        builder: (dialogContext) {
          return StatefulBuilder(
            builder: (context, setDialogState) {
              return AlertDialog(
                title: const Text(
                  'Create Empowerment Organization',
                  style: TextStyle(
                    fontWeight: FontWeight.w800,
                  ),
                ),
                content: SizedBox(
                  width: 560,
                  child: SingleChildScrollView(
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        TextField(
                          controller: nameController,
                          decoration: const InputDecoration(
                            labelText: 'Organization Name *',
                            hintText: 'e.g. Kano State Empowerment Agency',
                            border: OutlineInputBorder(),
                          ),
                        ),
                        const SizedBox(height: 14),
                        DropdownButtonFormField<String>(
                          value: organizationType,
                          decoration: const InputDecoration(
                            labelText: 'Organization Type *',
                            border: OutlineInputBorder(),
                          ),
                          items: organizationTypes
                              .map(
                                (type) => DropdownMenuItem<String>(
                                  value: type,
                                  child: Text(
                                    type.replaceAll('_', ' '),
                                  ),
                                ),
                              )
                              .toList(),
                          onChanged: isSubmitting
                              ? null
                              : (value) {
                                  if (value == null) return;
                                  setDialogState(() {
                                    organizationType = value;
                                  });
                                },
                        ),
                        const SizedBox(height: 14),
                        TextField(
                          controller: contactController,
                          decoration: const InputDecoration(
                            labelText: 'Contact Person',
                            border: OutlineInputBorder(),
                          ),
                        ),
                        const SizedBox(height: 14),
                        TextField(
                          controller: phoneController,
                          keyboardType: TextInputType.phone,
                          decoration: const InputDecoration(
                            labelText: 'Phone Number',
                            border: OutlineInputBorder(),
                          ),
                        ),
                        const SizedBox(height: 14),
                        TextField(
                          controller: emailController,
                          keyboardType: TextInputType.emailAddress,
                          decoration: const InputDecoration(
                            labelText: 'Email Address',
                            border: OutlineInputBorder(),
                          ),
                        ),
                        const SizedBox(height: 14),
                        TextField(
                          controller: stateController,
                          decoration: const InputDecoration(
                            labelText: 'State',
                            border: OutlineInputBorder(),
                          ),
                        ),
                        const SizedBox(height: 14),
                        TextField(
                          controller: lgaController,
                          decoration: const InputDecoration(
                            labelText: 'LGA',
                            border: OutlineInputBorder(),
                          ),
                        ),
                        const SizedBox(height: 12),
                        Container(
                          width: double.infinity,
                          padding: const EdgeInsets.all(12),
                          decoration: BoxDecoration(
                            color: const Color(0xFFEAF7F0),
                            borderRadius: BorderRadius.circular(12),
                          ),
                          child: const Text(
                            'New organizations are created with PENDING status and can be activated after review.',
                            style: TextStyle(
                              fontSize: 12,
                              color: Color(0xFF08783E),
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
                actions: [
                  TextButton(
                    onPressed: isSubmitting
                        ? null
                        : () => Navigator.of(dialogContext).pop(),
                    child: const Text('Cancel'),
                  ),
                  FilledButton.icon(
                    onPressed: isSubmitting
                        ? null
                        : () async {
                            final name = nameController.text.trim();

                            if (name.isEmpty) {
                              ScaffoldMessenger.of(context).showSnackBar(
                                const SnackBar(
                                  content: Text(
                                    'Organization name is required.',
                                  ),
                                ),
                              );
                              return;
                            }

                            setDialogState(() {
                              isSubmitting = true;
                            });

                            try {
                              final headers = await _empowermentHeaders();

                              final response = await _httpClient
                                  .post(
                                    Uri.parse(
                                      '$baseUrl/empowerment/organizations',
                                    ),
                                    headers: headers,
                                    body: jsonEncode({
                                      'name': name,
                                      'organizationType': organizationType,
                                      'contactName':
                                          contactController.text.trim(),
                                      'phone': phoneController.text.trim(),
                                      'email': emailController.text.trim(),
                                      'state': stateController.text.trim(),
                                      'lga': lgaController.text.trim(),
                                    }),
                                  )
                                  .timeout(
                                    const Duration(seconds: 45),
                                  );

                              dynamic data;
                              try {
                                data = jsonDecode(response.body);
                              } catch (_) {
                                data = null;
                              }

                              if (response.statusCode < 200 ||
                                  response.statusCode >= 300) {
                                String message =
                                    'Unable to create organization.';

                                if (data is Map && data['message'] != null) {
                                  message = data['message'].toString();
                                }

                                throw Exception(message);
                              }

                              if (!mounted) return;

                              Navigator.of(dialogContext).pop();

                              ScaffoldMessenger.of(context).showSnackBar(
                                SnackBar(
                                  content: Text(
                                    data is Map && data['message'] != null
                                        ? data['message'].toString()
                                        : 'Empowerment organization created successfully.',
                                  ),
                                ),
                              );

                              await loadDashboard();
                            } catch (e) {
                              if (!mounted) return;

                              setDialogState(() {
                                isSubmitting = false;
                              });

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
                          },
                    icon: isSubmitting
                        ? const SizedBox(
                            width: 17,
                            height: 17,
                            child: CircularProgressIndicator(
                              strokeWidth: 2,
                            ),
                          )
                        : const Icon(Icons.add_business_rounded),
                    label: Text(
                      isSubmitting ? 'Creating...' : 'Create Organization',
                    ),
                  ),
                ],
              );
            },
          );
        },
      );
    } finally {
      nameController.dispose();
      contactController.dispose();
      phoneController.dispose();
      emailController.dispose();
      stateController.dispose();
      lgaController.dispose();
    }
  }

  Map<String, dynamic> _organizationMap(dynamic value) {
    return value is Map
        ? Map<String, dynamic>.from(value)
        : <String, dynamic>{};
  }

  String _organizationId(Map<String, dynamic> organization) {
    return (organization['_id'] ?? organization['id'] ?? '').toString();
  }

  String _organizationStatus(Map<String, dynamic> organization) {
    return (organization['status'] ?? 'PENDING').toString().toUpperCase();
  }

  bool _isActiveOrganization(dynamic value) {
    return _organizationStatus(_organizationMap(value)) == 'ACTIVE';
  }

  String _organizationValue(
    Map<String, dynamic> organization,
    List<String> keys, {
    String fallback = 'Not provided',
  }) {
    for (final key in keys) {
      final value = organization[key]?.toString().trim();
      if (value != null && value.isNotEmpty) {
        return value;
      }
    }
    return fallback;
  }

  Future<void> _showOrganizationDetails(
    Map<String, dynamic> organization,
  ) async {
    final id = _organizationId(organization);
    final name = _organizationValue(
      organization,
      const ['name', 'organizationName'],
      fallback: 'Organization',
    );
    final status = _organizationStatus(organization);

    String? actionStatus;
    String? actionLabel;
    IconData? actionIcon;

    if (status == 'PENDING') {
      actionStatus = 'ACTIVE';
      actionLabel = 'Approve / Verify';
      actionIcon = Icons.verified_rounded;
    } else if (status == 'ACTIVE') {
      actionStatus = 'SUSPENDED';
      actionLabel = 'Suspend';
      actionIcon = Icons.pause_circle_outline_rounded;
    } else if (status == 'SUSPENDED') {
      actionStatus = 'ACTIVE';
      actionLabel = 'Reactivate';
      actionIcon = Icons.play_circle_outline_rounded;
    }

    final detailAction = await showDialog<String>(
      context: context,
      builder: (dialogContext) {
        return AlertDialog(
          title: Text(name),
          content: SizedBox(
            width: 560,
            child: SingleChildScrollView(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  _organizationDetailRow('Status', status),
                  _organizationDetailRow(
                    'Organization type',
                    _organizationValue(
                      organization,
                      const ['organizationType', 'type'],
                    ),
                  ),
                  _organizationDetailRow(
                    'Contact person',
                    _organizationValue(
                      organization,
                      const ['contactPerson', 'contactName', 'contact'],
                    ),
                  ),
                  _organizationDetailRow(
                    'Phone',
                    _organizationValue(
                      organization,
                      const ['phone', 'contactPhone', 'phoneNumber'],
                    ),
                  ),
                  _organizationDetailRow(
                    'Email',
                    _organizationValue(
                      organization,
                      const ['email', 'contactEmail'],
                    ),
                  ),
                  _organizationDetailRow(
                    'Location',
                    _organizationValue(
                      organization,
                      const ['location'],
                      fallback: [
                        organization['state'],
                        organization['lga'],
                      ].where((value) {
                        final text = value?.toString().trim() ?? '';
                        return text.isNotEmpty;
                      }).join(', '),
                    ),
                  ),
                  _organizationDetailRow(
                    'Created',
                    _organizationValue(
                      organization,
                      const ['createdAt', 'createdDate'],
                    ),
                  ),
                ],
              ),
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(dialogContext).pop(),
              child: const Text('Close'),
            ),
            if (actionStatus != null && actionLabel != null && id.isNotEmpty)
              FilledButton.icon(
                onPressed: () => Navigator.of(dialogContext).pop('update'),
                icon: Icon(actionIcon),
                label: Text(actionLabel),
              ),
            if (status == 'PENDING' && id.isNotEmpty)
              OutlinedButton.icon(
                onPressed: () => Navigator.of(dialogContext).pop('reject'),
                icon: const Icon(Icons.cancel_outlined),
                label: const Text('Reject'),
              ),
          ],
        );
      },
    );

    if (!mounted || id.isEmpty) {
      return;
    }

    if (status == 'PENDING' && detailAction == 'reject') {
      final reject = await showDialog<bool>(
        context: context,
        builder: (dialogContext) {
          return AlertDialog(
            title: const Text('Reject organization?'),
            content: Text(
              'Reject $name? This will leave the organization unavailable for program creation.',
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.of(dialogContext).pop(false),
                child: const Text('Cancel'),
              ),
              FilledButton(
                onPressed: () => Navigator.of(dialogContext).pop(true),
                style: FilledButton.styleFrom(
                  backgroundColor: Colors.red.shade700,
                ),
                child: const Text('Reject'),
              ),
            ],
          );
        },
      );

      if (reject == true) {
        await _updateOrganizationStatus(id, 'REJECTED');
      }
      return;
    }

    if (detailAction == 'update' && actionStatus != null) {
      final confirmed = await showDialog<bool>(
        context: context,
        builder: (dialogContext) {
          return AlertDialog(
            title: Text('$actionLabel organization?'),
            content: Text('Are you sure you want to $actionLabel this organization?'),
            actions: [
              TextButton(
                onPressed: () => Navigator.of(dialogContext).pop(false),
                child: const Text('Cancel'),
              ),
              FilledButton(
                onPressed: () => Navigator.of(dialogContext).pop(true),
                child: Text(actionLabel!),
              ),
            ],
          );
        },
      );

      if (confirmed == true) {
        await _updateOrganizationStatus(id, actionStatus);
      }
    }
  }

  Widget _organizationDetailRow(String label, String value) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 140,
            child: Text(
              label,
              style: const TextStyle(
                color: Color(0xFF667085),
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
          Expanded(
            child: Text(
              value,
              style: const TextStyle(fontWeight: FontWeight.w600),
            ),
          ),
        ],
      ),
    );
  }

  Future<void> _openOrganizationsManager() async {
    try {
      while (mounted) {
        final organizations = await _loadEmpowermentList(
          '/empowerment/organizations',
          'organizations',
        );

        if (!mounted) {
          return;
        }

        final action = await showDialog<String>(
          context: context,
          builder: (dialogContext) {
            return AlertDialog(
              title: const Text('Empowerment Organizations'),
              content: SizedBox(
                width: 620,
                height: 480,
                child: organizations.isEmpty
                    ? const Center(
                        child: Text('No organizations found.'),
                      )
                    : ListView.separated(
                        itemCount: organizations.length,
                        separatorBuilder: (_, __) =>
                            const Divider(height: 1),
                        itemBuilder: (context, index) {
                          final item = _organizationMap(organizations[index]);
                          final id = _organizationId(item);
                          final name = _organizationValue(
                            item,
                            const ['name', 'organizationName'],
                            fallback: 'Organization',
                          );
                          final status = _organizationStatus(item);

                          return ListTile(
                            leading: const CircleAvatar(
                              child: Icon(Icons.account_balance_outlined),
                            ),
                            title: Text(name),
                            subtitle: Text('Status: $status'),
                            trailing: const Icon(
                              Icons.chevron_right_rounded,
                            ),
                            onTap: () => Navigator.of(dialogContext).pop(id),
                          );
                        },
                      ),
              ),
              actions: [
                TextButton.icon(
                  onPressed: () {
                    Navigator.of(dialogContext).pop('CREATE');
                  },
                  icon: const Icon(Icons.add_business_rounded),
                  label: const Text('Create Organization'),
                ),
                TextButton(
                  onPressed: () => Navigator.of(dialogContext).pop(),
                  child: const Text('Close'),
                ),
              ],
            );
          },
        );

        if (!mounted || action == null) {
          return;
        }

        if (action == 'CREATE') {
          await _openCreateOrganizationDialog();
          continue;
        }

        Map<String, dynamic>? selectedOrganization;
        for (final raw in organizations) {
          final item = _organizationMap(raw);
          if (_organizationId(item) == action) {
            selectedOrganization = item;
            break;
          }
        }

        if (selectedOrganization != null) {
          await _showOrganizationDetails(selectedOrganization);
        }
      }
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

  Future<void> _openCreateProgramDialog() async {
    final nameController = TextEditingController();
    final amountController = TextEditingController();
    final targetController = TextEditingController();
    final stateController = TextEditingController();
    final lgaController = TextEditingController();
    final wardController = TextEditingController();

    String programType = 'CASH_GRANT';
    String targetGroup = 'GENERAL';
    bool publicApplicationEnabled = true;
    bool isSubmitting = false;

    try {
      final organizations = await _loadEmpowermentList(
        '/empowerment/organizations',
        'organizations',
      );

      if (!mounted) return;

      final activeOrganizations = organizations
          .where(_isActiveOrganization)
          .map(_organizationMap)
          .toList();

      String selectedOrganizationId = '';
      String selectedOrganizationName = '';

      Map<String, dynamic>? selectedOrganization;

      await showDialog<void>(
        context: context,
        barrierDismissible: false,
        builder: (dialogContext) {
          return StatefulBuilder(
            builder: (context, setDialogState) {
              return AlertDialog(
                title: const Text('Create Empowerment Program'),
                content: SizedBox(
                  width: 620,
                  child: SingleChildScrollView(
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        DropdownButtonFormField<Map<String, dynamic>>(
                          value: selectedOrganization,
                          decoration: const InputDecoration(
                            labelText: 'Organization *',
                            helperText:
                                'Only ACTIVE / verified organizations can run programs.',
                            border: OutlineInputBorder(),
                          ),
                          items: activeOrganizations
                              .map(
                                (item) => DropdownMenuItem<Map<String, dynamic>>(
                                  value: item,
                                  child: Text(
                                    _organizationValue(
                                      item,
                                      const ['name', 'organizationName'],
                                      fallback: 'Organization',
                                    ),
                                  ),
                                ),
                              )
                              .toList(),
                          onChanged: activeOrganizations.isEmpty || isSubmitting
                              ? null
                              : (value) {
                                  setDialogState(() {
                                    selectedOrganization = value;
                                  });
                                },
                        ),
                        if (activeOrganizations.isEmpty)
                          const Padding(
                            padding: EdgeInsets.only(top: 8),
                            child: Text(
                              'No ACTIVE / verified organizations are available.',
                              style: TextStyle(
                                color: Color(0xFFB42318),
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                          ),
                        const SizedBox(height: 14),
                        TextField(
                          controller: nameController,
                          decoration: const InputDecoration(
                            labelText: 'Program Name *',
                            border: OutlineInputBorder(),
                          ),
                        ),
                        const SizedBox(height: 14),
                        DropdownButtonFormField<String>(
                          value: programType,
                          decoration: const InputDecoration(
                            labelText: 'Program Type',
                            border: OutlineInputBorder(),
                          ),
                          items: const [
                            DropdownMenuItem(
                              value: 'CASH_GRANT',
                              child: Text('Cash Grant'),
                            ),
                            DropdownMenuItem(
                              value: 'CONTROLLED_GRANT',
                              child: Text('Controlled Grant'),
                            ),
                          ],
                          onChanged: (value) {
                            if (value == null) return;
                            setDialogState(() {
                              programType = value;
                            });
                          },
                        ),
                        const SizedBox(height: 14),
                        DropdownButtonFormField<String>(
                          value: targetGroup,
                          decoration: const InputDecoration(
                            labelText: 'Target Group',
                            border: OutlineInputBorder(),
                          ),
                          items: const [
                            'YOUTH',
                            'WOMEN',
                            'FARMERS',
                            'STUDENTS',
                            'TRADERS',
                            'ARTISANS',
                            'GENERAL',
                            'OTHER',
                          ].map((value) {
                            return DropdownMenuItem(
                              value: value,
                              child: Text(value),
                            );
                          }).toList(),
                          onChanged: (value) {
                            if (value == null) return;
                            setDialogState(() {
                              targetGroup = value;
                            });
                          },
                        ),
                        const SizedBox(height: 14),
                        TextField(
                          controller: amountController,
                          keyboardType: TextInputType.number,
                          decoration: const InputDecoration(
                            labelText: 'Amount Per Beneficiary *',
                            border: OutlineInputBorder(),
                          ),
                        ),
                        const SizedBox(height: 14),
                        TextField(
                          controller: targetController,
                          keyboardType: TextInputType.number,
                          decoration: const InputDecoration(
                            labelText: 'Target Beneficiaries *',
                            border: OutlineInputBorder(),
                          ),
                        ),
                        const SizedBox(height: 14),
                        TextField(
                          controller: stateController,
                          decoration: const InputDecoration(
                            labelText: 'State',
                            border: OutlineInputBorder(),
                          ),
                        ),
                        const SizedBox(height: 14),
                        TextField(
                          controller: lgaController,
                          decoration: const InputDecoration(
                            labelText: 'LGA',
                            border: OutlineInputBorder(),
                          ),
                        ),
                        const SizedBox(height: 14),
                        TextField(
                          controller: wardController,
                          decoration: const InputDecoration(
                            labelText: 'Ward',
                            border: OutlineInputBorder(),
                          ),
                        ),
                        const SizedBox(height: 8),
                        SwitchListTile(
                          contentPadding: EdgeInsets.zero,
                          title: const Text('Public Application'),
                          value: publicApplicationEnabled,
                          onChanged: (value) {
                            setDialogState(() {
                              publicApplicationEnabled = value;
                            });
                          },
                        ),
                      ],
                    ),
                  ),
                ),
                actions: [
                  TextButton(
                    onPressed: isSubmitting
                        ? null
                        : () => Navigator.of(dialogContext).pop(),
                    child: const Text('Cancel'),
                  ),
                  FilledButton.icon(
                    onPressed: isSubmitting
                        ? null
                        : () async {
                            final name = nameController.text.trim();
                            final amount =
                                double.tryParse(amountController.text.trim()) ??
                                    0;
                            final target =
                                int.tryParse(targetController.text.trim()) ?? 0;

                            if (selectedOrganization == null) {
                              ScaffoldMessenger.of(context).showSnackBar(
                                const SnackBar(
                                  content:
                                      Text('Please select an organization.'),
                                ),
                              );
                              return;
                            }

                            if (name.isEmpty || amount <= 0 || target <= 0) {
                              ScaffoldMessenger.of(context).showSnackBar(
                                const SnackBar(
                                  content: Text(
                                    'Program name, amount and target beneficiaries are required.',
                                  ),
                                ),
                              );
                              return;
                            }

                            final organizationId =
                                (selectedOrganization!['_id'] ??
                                        selectedOrganization!['id'] ??
                                        '')
                                    .toString();

                            if (organizationId.isEmpty) {
                              ScaffoldMessenger.of(context).showSnackBar(
                                const SnackBar(
                                  content: Text(
                                    'Selected organization ID is missing.',
                                  ),
                                ),
                              );
                              return;
                            }

                            setDialogState(() {
                              isSubmitting = true;
                            });

                            try {
                              final prefs =
                                  await SharedPreferences.getInstance();
                              final token = prefs.getString('auth_token') ?? '';

                              final response = await _httpClient.post(
                                Uri.parse('$baseUrl/empowerment/programs'),
                                headers: {
                                  'Content-Type': 'application/json',
                                  'Authorization': 'Bearer $token',
                                },
                                body: jsonEncode({
                                  'organizationId': organizationId,
                                  'name': name,
                                  'programType': programType,
                                  'targetGroup': targetGroup,
                                  'amountPerBeneficiary': amount,
                                  'targetBeneficiaries': target,
                                  'state': stateController.text.trim(),
                                  'lga': lgaController.text.trim(),
                                  'ward': wardController.text.trim(),
                                  'publicApplicationEnabled':
                                      publicApplicationEnabled,
                                  'status': 'DRAFT',
                                }),
                              );

                              dynamic data;
                              try {
                                data = jsonDecode(response.body);
                              } catch (_) {
                                data = null;
                              }

                              if (response.statusCode < 200 ||
                                  response.statusCode >= 300) {
                                String message =
                                    'Unable to create empowerment program.';

                                if (data is Map && data['message'] != null) {
                                  message = data['message'].toString();
                                }

                                throw Exception(message);
                              }

                              if (!mounted) return;

                              Navigator.of(dialogContext).pop();

                              ScaffoldMessenger.of(context).showSnackBar(
                                const SnackBar(
                                  content: Text(
                                    'Empowerment program created successfully.',
                                  ),
                                ),
                              );

                              await loadDashboard();
                            } catch (e) {
                              if (!mounted) return;

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
                            } finally {
                              setDialogState(() {
                                isSubmitting = false;
                              });
                            }
                          },
                    icon: isSubmitting
                        ? const SizedBox(
                            width: 18,
                            height: 18,
                            child: CircularProgressIndicator(
                              strokeWidth: 2,
                            ),
                          )
                        : const Icon(Icons.add_circle_outline),
                    label: Text(
                      isSubmitting ? 'Creating...' : 'Create Program',
                    ),
                  ),
                ],
              );
            },
          );
        },
      );
    } finally {
      nameController.dispose();
      amountController.dispose();
      targetController.dispose();
      stateController.dispose();
      lgaController.dispose();
      wardController.dispose();
    }
  }

  Future<bool> _fundProgram({
    required String programId,
    required double amount,
    String reference = '',
    String note = '',
  }) async {
    if (!isHeadOffice) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Only Head Office can fund Empowerment programs.'),
          ),
        );
      }
      return false;
    }

    if (amount <= 0) {
      return false;
    }

    if (isFunding) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('A program funding request is already processing.'),
          ),
        );
      }
      return false;
    }

    if (mounted) {
      setState(() {
        isFunding = true;
      });
    } else {
      isFunding = true;
    }

    try {
      final headers = await _empowermentHeaders();
      final requestKey = [
        programId,
        amount.toStringAsFixed(2),
        reference.trim(),
        note.trim(),
      ].join(':');
      final idempotencyKey = _fundingIdempotencyKeys.putIfAbsent(
        requestKey,
        () =>
            'empowerment-funding-$programId-${DateTime.now().microsecondsSinceEpoch}',
      );
      headers['Idempotency-Key'] = idempotencyKey;
      final response = await _httpClient
          .post(
            Uri.parse('$baseUrl/empowerment/programs/$programId/fund'),
            headers: headers,
            body: jsonEncode({
              'amount': amount,
              if (reference.trim().isNotEmpty) 'reference': reference.trim(),
              if (note.trim().isNotEmpty) 'note': note.trim(),
            }),
          )
          .timeout(const Duration(seconds: 45));

      dynamic body;
      try {
        body = jsonDecode(response.body);
      } catch (_) {
        body = null;
      }

      final success = response.statusCode >= 200 &&
          response.statusCode < 300 &&
          (body is! Map || body['success'] != false);
      final idempotent = body is Map && body['idempotent'] == true;
      final message = body is Map && body['message'] != null
          ? body['message'].toString()
          : success
              ? 'Program funded successfully.'
              : 'Unable to fund this program.';

      if (success) {
        await loadDashboard();
        _fundingIdempotencyKeys.remove(requestKey);
      }

      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              idempotent
                  ? 'This funding request was already processed. '
                      'The latest program balance has been refreshed.'
                  : message,
            ),
          ),
        );
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
    } finally {
      if (mounted) {
        setState(() {
          isFunding = false;
        });
      } else {
        isFunding = false;
      }
    }
  }

  Future<void> _openFundProgramDialog(
    Map<String, dynamic> program,
  ) async {
    if (!isHeadOffice) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Only Head Office can fund Empowerment programs.'),
          ),
        );
      }
      return;
    }

    final programId = (program['_id'] ?? program['id'] ?? '').toString();
    if (programId.isEmpty) {
      throw Exception('Program ID is missing.');
    }

    final programName = (program['name'] ?? 'Empowerment Program').toString();
    final financials = _programFinancials(program);
    final amountController = TextEditingController();
    final referenceController = TextEditingController();
    final noteController = TextEditingController();

    try {
      final funding = await showDialog<Map<String, String>>(
        context: context,
        barrierDismissible: false,
        builder: (dialogContext) {
          String? validationMessage;

          return StatefulBuilder(
            builder: (context, setDialogState) {
              return AlertDialog(
                title: Text('Fund $programName'),
                content: SizedBox(
                  width: 520,
                  child: SingleChildScrollView(
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'Remaining balance: '
                          '${money(financials['availableFundingAmount'])}',
                          style: const TextStyle(
                            color: Color(0xFF08783E),
                            fontWeight: FontWeight.w800,
                          ),
                        ),
                        const SizedBox(height: 16),
                        TextField(
                          controller: amountController,
                          autofocus: true,
                          keyboardType: const TextInputType.numberWithOptions(
                            decimal: true,
                          ),
                          decoration: InputDecoration(
                            labelText: 'Amount to add *',
                            prefixText: '₦ ',
                            border: const OutlineInputBorder(),
                            errorText: validationMessage,
                          ),
                        ),
                        const SizedBox(height: 12),
                        TextField(
                          controller: referenceController,
                          decoration: const InputDecoration(
                            labelText: 'Reference (optional)',
                            border: OutlineInputBorder(),
                          ),
                        ),
                        const SizedBox(height: 12),
                        TextField(
                          controller: noteController,
                          maxLines: 2,
                          decoration: const InputDecoration(
                            labelText: 'Note (optional)',
                            border: OutlineInputBorder(),
                          ),
                        ),
                        const SizedBox(height: 12),
                        const Text(
                          'Funds are reserved directly for this program. '
                          'They remain available only for eligible beneficiary payouts.',
                          style: TextStyle(
                            color: Color(0xFF667085),
                            height: 1.4,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
                actions: [
                  TextButton(
                    onPressed: () => Navigator.of(dialogContext).pop(),
                    child: const Text('Cancel'),
                  ),
                  FilledButton.icon(
                    onPressed: () {
                      final rawAmount =
                          amountController.text.trim().replaceAll(',', '');
                      final parsedAmount = double.tryParse(rawAmount);
                      if (parsedAmount == null || parsedAmount <= 0) {
                        setDialogState(() {
                          validationMessage = 'Enter a positive amount.';
                        });
                        return;
                      }
                       Navigator.of(dialogContext).pop({
                         'amount': parsedAmount.toString(),
                         'reference': referenceController.text.trim(),
                         'note': noteController.text.trim(),
                       });
                    },
                    icon: const Icon(Icons.account_balance_wallet_outlined),
                    label: const Text('Add Funds'),
                  ),
                ],
              );
            },
          );
        },
      );

      if (funding == null || !mounted) {
        return;
      }

      await _fundProgram(
        programId: programId,
        amount: double.parse(funding['amount']!),
        reference: funding['reference'] ?? '',
        note: funding['note'] ?? '',
      );
    } finally {
      amountController.dispose();
      referenceController.dispose();
      noteController.dispose();
    }
  }

  Future<void> _openProgramsManager() async {
    try {
      final programs = await _loadEmpowermentList(
        '/empowerment/programs',
        'programs',
      );

      if (!mounted) return;

      await showDialog<void>(
        context: context,
        builder: (dialogContext) {
          return AlertDialog(
            title: const Text('Empowerment Programs'),
            content: SizedBox(
              width: 680,
              height: 500,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Align(
                    alignment: Alignment.centerRight,
                    child: FilledButton.icon(
                      onPressed: () async {
                        Navigator.of(dialogContext).pop();

                        await _openCreateProgramDialog();

                        if (!mounted) return;
                        await _openProgramsManager();
                      },
                      icon: const Icon(Icons.add_circle_outline),
                      label: const Text('Create Program'),
                    ),
                  ),
                  const SizedBox(height: 16),
                  Expanded(
                    child: programs.isEmpty
                        ? const Center(
                            child: Text(
                              'No programs found.',
                            ),
                          )
                        : ListView.separated(
                            itemCount: programs.length,
                            separatorBuilder: (_, __) =>
                                const Divider(height: 1),
                            itemBuilder: (_, index) {
                              final raw = programs[index];

                              final item = _programMap(raw);

                              final id =
                                  (item['_id'] ?? item['id'] ?? '').toString();

                              final name =
                                  (item['name'] ?? 'Program').toString();

                              final status = _programStatus(item);

                              final targetGroup =
                                  (item['targetGroup'] ?? 'GENERAL').toString();

                              final amount = item['amountPerBeneficiary'];
                              final financials = _programFinancials(item);

                              return Padding(
                                padding:
                                    const EdgeInsets.symmetric(vertical: 6),
                                child: Column(
                                  crossAxisAlignment:
                                      CrossAxisAlignment.stretch,
                                  children: [
                                    ListTile(
                                      contentPadding: EdgeInsets.zero,
                                      leading: const CircleAvatar(
                                        child: Icon(
                                          Icons.volunteer_activism_outlined,
                                        ),
                                      ),
                                      title: Text(name),
                                      subtitle: Text(
                                        'Status: $status'
                                        '${targetGroup.isNotEmpty ? ' • $targetGroup' : ''}'
                                        '${amount != null ? ' • ${money(amount)} per beneficiary' : ''}'
                                        '\nTotal Funded: ${money(financials['totalFundedAmount'])}'
                                        ' • Total Disbursed: ${money(financials['totalDisbursedAmount'])}'
                                        '\nRemaining Balance: ${money(financials['availableFundingAmount'])}',
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
                                                onSelected: (newStatus) async {
                                                  await _updateProgramStatus(
                                                    id,
                                                    newStatus,
                                                  );
                                                },
                                              );

                                              if (!mounted) return;
                                              await _openProgramsManager();
                                            },
                                    ),
                                    if (isHeadOffice && id.isNotEmpty)
                                      Align(
                                        alignment: Alignment.centerRight,
                                        child: OutlinedButton.icon(
                                          onPressed: isFunding
                                              ? null
                                              : () async {
                                                  Navigator.of(dialogContext)
                                                      .pop();
                                                  await _openFundProgramDialog(
                                                    item,
                                                  );
                                                  if (!mounted) return;
                                                  await _openProgramsManager();
                                                },
                                          icon: const Icon(
                                            Icons.add_card_rounded,
                                          ),
                                          label: const Text('Add Funds'),
                                        ),
                                      ),
                                    const Divider(height: 1),
                                  ],
                                ),
                              );
                            },
                          ),
                  ),
                ],
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
            e.toString().replaceFirst(
                  'Exception: ',
                  '',
                ),
          ),
        ),
      );
    }
  }

  List<Map<String, dynamic>> _disbursementRows(
    List<dynamic> batches,
    String programName,
  ) {
    final rows = <Map<String, dynamic>>[];

    for (final rawBatch in batches) {
      final batch = _beneficiaryMap(rawBatch);
      final results = batch['results'];
      final batchStatus =
          (batch['status'] ?? 'UNKNOWN').toString().trim().toUpperCase();
      final batchReference = (batch['batchReference'] ??
              batch['reference'] ??
              batch['paymentReference'] ??
              'Not provided')
          .toString();
      final batchDate = (batch['completedAt'] ??
              batch['paidAt'] ??
              batch['createdAt'] ??
              batch['date'] ??
              'Not provided')
          .toString();

      if (results is! List || results.isEmpty) {
        rows.add({
          'beneficiary': _beneficiaryValue(
            batch,
            const ['beneficiaryName', 'fullName', 'recipientName'],
            fallback: 'Beneficiary',
          ),
          'program': programName,
          'amount': batch['amount'] ?? batch['totalAmount'] ?? 0,
          'status': batchStatus,
          'reference': batchReference,
          'date': batchDate,
        });
        continue;
      }

      for (final rawResult in results) {
        final result = _beneficiaryMap(rawResult);
        final beneficiary = _beneficiaryMap(result['beneficiary']);
        final recipient = _beneficiaryMap(result['recipient']);
        rows.add({
          'beneficiary': _beneficiaryValue(
            beneficiary,
            const ['fullName', 'name', 'phone'],
            fallback: _beneficiaryValue(
              recipient,
              const ['fullName', 'name', 'phone', 'email'],
              fallback: _beneficiaryValue(
                result,
                const ['beneficiaryName', 'recipientName'],
                fallback: 'Beneficiary',
              ),
            ),
          ),
          'program': programName,
          'amount': result['amount'] ?? batch['amount'] ?? 0,
          'status': (result['status'] ?? batchStatus)
              .toString()
              .trim()
              .toUpperCase(),
          'reference': (result['transactionReference'] ??
                  result['paymentReference'] ??
                  result['reference'] ??
                  batchReference)
              .toString(),
          'date': (result['paidAt'] ??
                  result['completedAt'] ??
                  batchDate)
              .toString(),
        });
      }
    }

    return rows;
  }

  Color _disbursementStatusColor(String status) {
    switch (status.toUpperCase()) {
      case 'PAID':
      case 'SUCCESSFUL':
      case 'COMPLETED':
        return const Color(0xFF08783E);
      case 'FAILED':
      case 'REVERSED':
      case 'REJECTED':
        return const Color(0xFFB42318);
      case 'PENDING':
      case 'PROCESSING':
      case 'DISBURSING':
        return const Color(0xFFB54708);
      default:
        return const Color(0xFF667085);
    }
  }

  Future<void> _openDisbursementsManager() async {
    if (!isHeadOffice) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Only Head Office can view disbursement history.'),
        ),
      );
      return;
    }

    try {
      final programs = await _loadEmpowermentList(
        '/empowerment/programs',
        'programs',
      );

      if (!mounted) return;

      final selectedProgram = await showDialog<Map<String, dynamic>>(
        context: context,
        builder: (dialogContext) {
          return AlertDialog(
            title: const Text('Select Program'),
            content: SizedBox(
              width: 600,
              height: 440,
              child: programs.isEmpty
                  ? const Center(
                      child: Text('No empowerment programs found.'),
                    )
                  : ListView.separated(
                      itemCount: programs.length,
                      separatorBuilder: (_, __) => const Divider(height: 1),
                      itemBuilder: (context, index) {
                        final program = _organizationMap(programs[index]);
                        final id = (program['_id'] ?? program['id'] ?? '')
                            .toString();
                        return ListTile(
                          leading: const CircleAvatar(
                            child: Icon(Icons.campaign_outlined),
                          ),
                          title: Text(
                            (program['name'] ?? 'Empowerment Program')
                                .toString(),
                          ),
                          subtitle: Text(
                            (program['status'] ?? '').toString(),
                          ),
                          trailing: const Icon(Icons.chevron_right_rounded),
                          onTap: id.isEmpty
                              ? null
                              : () => Navigator.of(dialogContext).pop(program),
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

      if (!mounted || selectedProgram == null) return;

      final programId =
          (selectedProgram['_id'] ?? selectedProgram['id'] ?? '').toString();
      final programName =
          (selectedProgram['name'] ?? 'Empowerment Program').toString();
      if (programId.isEmpty) {
        throw Exception('Program ID is missing.');
      }

      var rows = _disbursementRows(
        await _loadEmpowermentList(
          '/empowerment/programs/$programId/disbursements',
          'batches',
        ),
        programName,
      );

      if (!mounted) return;

      await showDialog<void>(
        context: context,
        builder: (dialogContext) {
          var refreshing = false;
          return StatefulBuilder(
            builder: (context, setDialogState) {
              Future<void> refreshHistory() async {
                setDialogState(() {
                  refreshing = true;
                });
                try {
                  final refreshed = await _loadEmpowermentList(
                    '/empowerment/programs/$programId/disbursements',
                    'batches',
                  );
                  if (context.mounted) {
                    setDialogState(() {
                      rows = _disbursementRows(refreshed, programName);
                    });
                  }
                } catch (e) {
                  if (mounted) {
                    ScaffoldMessenger.of(this.context).showSnackBar(
                      SnackBar(
                        content: Text(
                          'Unable to refresh disbursements: '
                          '${e.toString().replaceFirst('Exception: ', '')}',
                        ),
                      ),
                    );
                  }
                } finally {
                  if (context.mounted) {
                    setDialogState(() {
                      refreshing = false;
                    });
                  }
                }
              }

              return AlertDialog(
                title: Text('$programName Disbursements'),
                content: SizedBox(
                  width: 760,
                  height: 500,
                  child: refreshing
                      ? const Center(child: CircularProgressIndicator())
                      : rows.isEmpty
                          ? const Center(
                              child: Text(
                                'No disbursement records available yet.',
                              ),
                            )
                          : ListView.separated(
                              itemCount: rows.length,
                              separatorBuilder: (_, __) =>
                                  const Divider(height: 1),
                              itemBuilder: (_, index) {
                                final row = rows[index];
                                final status =
                                    row['status']?.toString() ?? 'UNKNOWN';
                                return ListTile(
                                  leading: CircleAvatar(
                                    backgroundColor:
                                        _disbursementStatusColor(status)
                                            .withOpacity(0.12),
                                    child: Icon(
                                      Icons.payments_outlined,
                                      color: _disbursementStatusColor(status),
                                    ),
                                  ),
                                  title: Text(
                                    row['beneficiary']?.toString() ??
                                        'Beneficiary',
                                  ),
                                  subtitle: Text(
                                    'Program: ${row['program']} • '
                                    'Amount: ${money(row['amount'])}\n'
                                    'Status: $status • Reference: ${row['reference']}\n'
                                    'Date: ${row['date']}',
                                  ),
                                  isThreeLine: true,
                                );
                              },
                            ),
                ),
                actions: [
                  TextButton.icon(
                    onPressed: refreshing ? null : refreshHistory,
                    icon: const Icon(Icons.refresh_rounded),
                    label: const Text('Refresh'),
                  ),
                  TextButton(
                    onPressed: () => Navigator.of(dialogContext).pop(),
                    child: const Text('Close'),
                  ),
                ],
              );
            },
          );
        },
      );
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            'Unable to load disbursements: '
            '${e.toString().replaceFirst('Exception: ', '')}',
          ),
        ),
      );
    }
  }

  Map<String, dynamic> _beneficiaryMap(dynamic value) {
    return value is Map
        ? Map<String, dynamic>.from(value)
        : <String, dynamic>{};
  }

  String _beneficiaryId(Map<String, dynamic> beneficiary) {
    return (beneficiary['_id'] ?? beneficiary['id'] ?? '').toString();
  }

  String _beneficiaryApplicationStatus(Map<String, dynamic> beneficiary) {
    final application = _beneficiaryMap(beneficiary['application']);
    final values = [
      beneficiary['applicationStatus'],
      beneficiary['status'],
      beneficiary['application_status'],
      application['applicationStatus'],
      application['status'],
      application['application_status'],
    ];

    for (final value in values) {
      final status = value?.toString().trim();
      if (status != null && status.isNotEmpty) {
        return status
            .toUpperCase()
            .replaceAll(RegExp(r'[\s-]+'), '_');
      }
    }

    return 'SUBMITTED';
  }

  String _beneficiaryVerificationStatus(Map<String, dynamic> beneficiary) {
    final verification = _beneficiaryMap(beneficiary['verification']);
    final kyc = _beneficiaryMap(beneficiary['kyc']);
    final user = _beneficiaryMap(beneficiary['user']);
    final customer = _beneficiaryMap(beneficiary['customer']);
    final customerKyc = _beneficiaryMap(customer['kyc']);
    final userKyc = _beneficiaryMap(user['kyc']);
    final values = [
      beneficiary['verificationStatus'],
      beneficiary['verification_status'],
      beneficiary['kycStatus'],
      verification['status'],
      verification['verificationStatus'],
      kyc['status'],
      kyc['verificationStatus'],
      kyc['kycStatus'],
      customer['verificationStatus'],
      customer['kycStatus'],
      customer['kycVerified'],
      customerKyc['status'],
      customerKyc['verificationStatus'],
      customerKyc['kycStatus'],
      customerKyc['verified'],
      user['verificationStatus'],
      user['kycStatus'],
      user['kycVerified'],
      userKyc['status'],
      userKyc['verificationStatus'],
      userKyc['kycStatus'],
      userKyc['verified'],
      beneficiary['isVerified'],
      beneficiary['verified'],
    ];

    for (final value in values) {
      if (value is bool && value) {
        return 'VERIFIED';
      }
      final status = value?.toString().trim().toUpperCase() ?? '';
      if (const ['VERIFIED', 'SUCCESS', 'SUCCESSFUL'].contains(status)) {
        return 'VERIFIED';
      }
    }

    final value = values.firstWhere(
      (value) => value != null && value.toString().trim().isNotEmpty,
      orElse: () => null,
    );
    if (value is bool) return 'PENDING';
    final status = value?.toString().trim().toUpperCase() ?? '';
    if (status.isEmpty || status == 'UNVERIFIED') {
      return 'PENDING';
    }
    return status;
  }

  bool _isBeneficiaryVerified(Map<String, dynamic> beneficiary) {
    return _beneficiaryVerificationStatus(beneficiary) == 'VERIFIED';
  }

  String _beneficiaryPaymentStatus(Map<String, dynamic> beneficiary) {
    final applicationStatus = _beneficiaryApplicationStatus(beneficiary);
    final payment = _beneficiaryMap(beneficiary['payment']);
    final payout = _beneficiaryMap(beneficiary['payout']);
    final disbursement = _beneficiaryMap(beneficiary['disbursement']);
    final values = [
      beneficiary['paymentStatus'],
      beneficiary['payoutStatus'],
      beneficiary['disbursementStatus'],
      payment['status'],
      payment['paymentStatus'],
      payout['status'],
      payout['payoutStatus'],
      disbursement['status'],
      disbursement['disbursementStatus'],
    ];

    for (final value in values) {
      final status = value?.toString().trim().toUpperCase() ?? '';
      if (status.isNotEmpty) {
        return const ['SUCCESS', 'SUCCESSFUL', 'COMPLETED'].contains(status)
            ? 'PAID'
            : status;
      }
    }

    if (applicationStatus == 'PAID') {
      return 'PAID';
    }

    final paidAt = beneficiary['paidAt']?.toString().trim() ?? '';
    final paymentReference =
        beneficiary['paymentReference']?.toString().trim() ?? '';
    if (paidAt.isNotEmpty || paymentReference.isNotEmpty) {
      return 'PAID';
    }

    return 'NOT PAID';
  }

  bool _hasPayableBeneficiaryState(Map<String, dynamic> beneficiary) {
    final paymentStatus = _beneficiaryPaymentStatus(beneficiary);
    return isHeadOffice &&
        _beneficiaryApplicationStatus(beneficiary) == 'APPROVED' &&
        _isBeneficiaryVerified(beneficiary) &&
        (paymentStatus == 'NOT PAID' ||
            paymentStatus == 'UNPAID' ||
            paymentStatus == 'NONE');
  }

  bool _hasLinkedServicePayAccount(Map<String, dynamic> beneficiary) {
    final user = _beneficiaryMap(beneficiary['user']);
    final userId = (user['_id'] ?? user['id'] ?? '').toString().trim();
    final userStatus = (user['status'] ?? '').toString().trim().toUpperCase();

    if (userId.isNotEmpty) {
      return userStatus.isEmpty || userStatus == 'ACTIVE';
    }

    final directUserId = beneficiary['user'] is Map
        ? ''
        : beneficiary['user']?.toString().trim() ?? '';
    if (directUserId.isNotEmpty) {
      return true;
    }

    return _beneficiaryValue(
      beneficiary,
      const ['servicePayAccount', 'accountNumber', 'accountId', 'userId'],
      fallback: '',
    ).isNotEmpty;
  }

  bool _isBulkEligibleBeneficiary(Map<String, dynamic> beneficiary) {
    return _hasPayableBeneficiaryState(beneficiary) &&
        _hasLinkedServicePayAccount(beneficiary);
  }

  bool _canDisburseBeneficiary(
    Map<String, dynamic> beneficiary, {
    required String programStatus,
    required dynamic remainingBalance,
    required dynamic amountPerBeneficiary,
  }) {
    return _hasPayableBeneficiaryState(beneficiary) &&
        programStatus == 'APPROVED' &&
        _hasSufficientProgramFunding(
          remainingBalance: remainingBalance,
          amountPerBeneficiary: amountPerBeneficiary,
        );
  }

  List<String> _beneficiaryStatusOptions(
    String applicationStatus,
    bool isVerified,
  ) {
    switch (applicationStatus) {
      case 'SUBMITTED':
        return const ['SUBMITTED', 'UNDER_REVIEW', 'REJECTED'];
      case 'UNDER_REVIEW':
        return [
          'UNDER_REVIEW',
          if (isVerified) 'APPROVED',
          'REJECTED',
        ];
      default:
        return [applicationStatus];
    }
  }

  String _beneficiaryValue(
    Map<String, dynamic> beneficiary,
    List<String> keys, {
    String fallback = 'Not provided',
  }) {
    final sources = <Map<String, dynamic>>[
      beneficiary,
      _beneficiaryMap(beneficiary['user']),
      _beneficiaryMap(beneficiary['account']),
      _beneficiaryMap(beneficiary['application']),
      _beneficiaryMap(beneficiary['verification']),
      _beneficiaryMap(beneficiary['kyc']),
      _beneficiaryMap(beneficiary['customer']),
    ];

    for (final source in sources) {
      for (final key in keys) {
        final value = source[key]?.toString().trim();
        if (value != null && value.isNotEmpty) {
          return value;
        }
      }
    }

    return fallback;
  }

  String _newIdempotencyKey(String beneficiaryId) {
    return 'empowerment-$beneficiaryId-${DateTime.now().microsecondsSinceEpoch}';
  }

  String _bulkDisbursementIdempotencyKey(
    String programId,
    List<String> beneficiaryIds,
  ) {
    final selection = [...beneficiaryIds]..sort();
    final signature = '$programId:${selection.join(",")}';
    return _bulkDisbursementIdempotencyKeys.putIfAbsent(
      signature,
      () => 'empowerment-bulk-$programId-'
          '${DateTime.now().microsecondsSinceEpoch}',
    );
  }

  String _payoutApiMessage(
    int statusCode,
    dynamic body, {
    required String fallback,
  }) {
    final serverMessage = body is Map && body['message'] != null
        ? body['message'].toString()
        : '';
    final normalized = serverMessage.toLowerCase();

    if (statusCode == 401 || statusCode == 403) {
      return 'Only Head Office can disburse Empowerment funds.';
    }

    if (statusCode == 409) {
      if (normalized.contains('already been paid') ||
          normalized.contains('already processed') ||
          normalized.contains('idempotency')) {
        return 'This payment has already been processed. The latest beneficiary data has been refreshed.';
      }

      return serverMessage.isNotEmpty
          ? '$serverMessage The latest beneficiary data has been refreshed.'
          : 'The beneficiary payout state changed. The latest data has been refreshed.';
    }

    return serverMessage.isNotEmpty ? serverMessage : fallback;
  }

  Future<bool> _disburseBeneficiary({
    required String programId,
    required String beneficiaryId,
  }) async {
    if (!isHeadOffice) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Only Head Office can disburse Empowerment funds.'),
          ),
        );
      }
      return false;
    }

    if (isDisbursing) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('A beneficiary payout is already being processed.'),
          ),
        );
      }
      return false;
    }

    if (mounted) {
      setState(() {
        isDisbursing = true;
      });
    } else {
      isDisbursing = true;
    }

    try {
      final headers = await _empowermentHeaders();
      headers['Idempotency-Key'] = _newIdempotencyKey(beneficiaryId);
      final response = await _httpClient
          .post(
            Uri.parse(
              '$baseUrl/empowerment/programs/$programId/beneficiaries/'
              '$beneficiaryId/pay',
            ),
            headers: headers,
            body: jsonEncode(<String, dynamic>{}),
          )
          .timeout(const Duration(seconds: 45));

      dynamic body;
      try {
        body = jsonDecode(response.body);
      } catch (_) {
        body = null;
      }

      final success = response.statusCode >= 200 &&
          response.statusCode < 300 &&
          (body is! Map || body['success'] != false);
      final message = _payoutApiMessage(
        response.statusCode,
        body,
        fallback: success
            ? 'Beneficiary payment recorded successfully.'
            : 'Unable to disburse to this beneficiary.',
      );
      final duplicate = response.statusCode == 409 &&
          message.startsWith('This payment has already been processed.');

      final conflict = response.statusCode == 409;
      if (success || conflict) {
        await loadDashboard();
      }

      if (mounted) {
        final displayMessage = success && body is Map && body['idempotent'] == true
            ? 'Payment was already processed. The latest beneficiary data has been refreshed.'
            : success
                ? 'Payment successful. $message'
                : message;
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(displayMessage),
          ),
        );
      }

      return success || duplicate;
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text(
              'We could not confirm this payment. Refresh beneficiary details '
              'before retrying.',
            ),
          ),
        );
      }
      return false;
    } finally {
      if (mounted) {
        setState(() {
          isDisbursing = false;
        });
      } else {
        isDisbursing = false;
      }
    }
  }

  Future<bool> _confirmBeneficiaryDisbursement({
    required Map<String, dynamic> beneficiary,
    required String programName,
    required String programId,
    required dynamic amountPerBeneficiary,
  }) async {
    final beneficiaryId = _beneficiaryId(beneficiary);
    if (beneficiaryId.isEmpty || !_hasPayableBeneficiaryState(beneficiary)) {
      return false;
    }

    Map<String, dynamic> currentProgram;
    try {
      currentProgram = await _loadEmpowermentProgram(programId);
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              'Unable to confirm current program funding. '
              '${e.toString().replaceFirst('Exception: ', '')}',
            ),
          ),
        );
      }
      return false;
    }

    final currentProgramStatus = _programStatus(currentProgram);
    final currentAmount = currentProgram['amountPerBeneficiary'] ??
        currentProgram['amount'] ??
        currentProgram['grantAmount'] ??
        amountPerBeneficiary;
    final currentFinancials = _programFinancials(currentProgram);
    final currentRemainingBalance =
        currentFinancials['availableFundingAmount'];
    final balanceAfterPayment =
        _asDouble(currentRemainingBalance) - _asDouble(currentAmount);

    if (!_isPayoutEligibleProgramStatus(currentProgramStatus)) {
      return false;
    }

    if (!_hasSufficientProgramFunding(
      remainingBalance: currentRemainingBalance,
      amountPerBeneficiary: currentAmount,
    )) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text(
              'Program funding is insufficient. Fund this program before disbursement.',
            ),
          ),
        );
      }
      return false;
    }

    final fullName = _beneficiaryValue(
      beneficiary,
      const ['fullName', 'name'],
      fallback: 'Beneficiary',
    );
    final servicePayAccount = _beneficiaryValue(
      beneficiary,
      const ['accountNumber', 'userId', 'accountId', 'servicePayAccount'],
      fallback: _beneficiaryValue(
        _beneficiaryMap(beneficiary['user']),
        const ['fullName', 'email', 'phone', '_id', 'id'],
      ),
    );
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) {
        return AlertDialog(
          title: const Text('Confirm beneficiary payment'),
          content: SizedBox(
            width: 520,
            child: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  _organizationDetailRow('Beneficiary', fullName),
                  _organizationDetailRow('Program', programName),
                  _organizationDetailRow(
                    'Configured amount per beneficiary',
                     money(currentAmount),
                  ),
                   _organizationDetailRow(
                     'Current program balance',
                     money(currentRemainingBalance),
                   ),
                   _organizationDetailRow(
                     'Program balance after payment',
                     money(balanceAfterPayment),
                   ),
                  _organizationDetailRow(
                    'ServicePay account',
                    servicePayAccount,
                  ),
                  const SizedBox(height: 12),
                  Container(
                    width: double.infinity,
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: const Color(0xFFEAF7F0),
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: const Text(
                      'This payment uses the program’s reserved balance. '
                      'The amount is controlled by the program configuration '
                      'and cannot be edited here.',
                      style: TextStyle(
                        color: Color(0xFF08783E),
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(dialogContext).pop(false),
              child: const Text('Cancel'),
            ),
            FilledButton.icon(
              onPressed: () => Navigator.of(dialogContext).pop(true),
              icon: const Icon(Icons.payments_rounded),
              label: const Text('Pay Beneficiary'),
            ),
          ],
        );
      },
    );

    if (confirmed != true) {
      return false;
    }

    return _disburseBeneficiary(
      programId: programId,
      beneficiaryId: beneficiaryId,
    );
  }

  Future<Map<String, dynamic>?> _bulkDisburseBeneficiaries({
    required String programId,
    required List<String> beneficiaryIds,
  }) async {
    if (!isHeadOffice || beneficiaryIds.isEmpty || isDisbursing) {
      return null;
    }

    if (mounted) {
      setState(() {
        isDisbursing = true;
      });
    } else {
      isDisbursing = true;
    }

    try {
      final headers = await _empowermentHeaders();
      headers['Idempotency-Key'] = _bulkDisbursementIdempotencyKey(
        programId,
        beneficiaryIds,
      );
      final response = await _httpClient
          .post(
            Uri.parse(
              '$baseUrl/empowerment/programs/$programId/bulk-disbursement',
            ),
            headers: headers,
            body: jsonEncode(
              <String, dynamic>{
                'beneficiaryIds': beneficiaryIds,
              },
            ),
          )
          .timeout(const Duration(seconds: 60));

      dynamic decoded;
      try {
        decoded = jsonDecode(response.body);
      } catch (_) {
        decoded = null;
      }

      final success = response.statusCode >= 200 &&
          response.statusCode < 300 &&
          (decoded is! Map || decoded['success'] != false);
      if (!success) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              content: Text(
                _payoutApiMessage(
                  response.statusCode,
                  decoded,
                  fallback: 'Unable to complete bulk disbursement.',
                ),
              ),
            ),
          );
        }
        return null;
      }

      await loadDashboard();
      return decoded is Map
          ? Map<String, dynamic>.from(decoded)
          : <String, dynamic>{};
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text(
              'We could not confirm this bulk disbursement. Refresh the '
              'beneficiary list before retrying.',
            ),
          ),
        );
      }
      return null;
    } finally {
      if (mounted) {
        setState(() {
          isDisbursing = false;
        });
      } else {
        isDisbursing = false;
      }
    }
  }

  Future<void> _showBulkDisbursementResult({
    required Map<String, dynamic> response,
    required Map<String, String> beneficiaryNames,
  }) async {
    final batch = _beneficiaryMap(response['batch']);
    final resultSummary = _beneficiaryMap(response['resultSummary']);
    final financials = _programFinancials(
      _beneficiaryMap(response['financials']),
    );
    final results = (batch['results'] is List)
        ? List<dynamic>.from(batch['results'] as List)
        : <dynamic>[];
    final successful = (resultSummary['successful'] is List)
        ? List<dynamic>.from(resultSummary['successful'] as List)
        : results.where((raw) {
            final result = _beneficiaryMap(raw);
            return (result['status'] ?? '').toString().toUpperCase() ==
                'SUCCESSFUL';
          }).toList();
    final skipped = (resultSummary['skipped'] is List)
        ? List<dynamic>.from(resultSummary['skipped'] as List)
        : <dynamic>[];
    final failed = (resultSummary['failed'] is List)
        ? List<dynamic>.from(resultSummary['failed'] as List)
        : results.where((raw) {
            final result = _beneficiaryMap(raw);
            return (result['status'] ?? '').toString().toUpperCase() == 'FAILED';
          }).toList();
    final totalPaid = resultSummary['totalAmountPaid'] ??
        successful.fold<num>(0, (total, raw) {
          return total + _asDouble(_beneficiaryMap(raw)['amount']);
        });
    final remainingBalance = resultSummary['remainingProgramBalance'] ??
        financials['availableFundingAmount'];

    await showDialog<void>(
      context: context,
      builder: (dialogContext) {
        return AlertDialog(
          title: const Text('Bulk Disbursement Result'),
          content: SizedBox(
            width: 680,
            child: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  _organizationDetailRow(
                    'Successful',
                    successful.length.toString(),
                  ),
                  _organizationDetailRow('Skipped', skipped.length.toString()),
                  _organizationDetailRow('Failed', failed.length.toString()),
                  _organizationDetailRow('Total amount paid', money(totalPaid)),
                  _organizationDetailRow(
                    'Remaining program balance',
                    money(remainingBalance),
                  ),
                  const SizedBox(height: 12),
                  const Text(
                    'Individual beneficiary results',
                    style: TextStyle(fontWeight: FontWeight.w800),
                  ),
                  const SizedBox(height: 6),
                  if (results.isEmpty)
                    const Text('No individual result records were returned.')
                  else
                    ...results.map((raw) {
                      final result = _beneficiaryMap(raw);
                      final beneficiary = _beneficiaryMap(result['beneficiary']);
                      final beneficiaryId = beneficiary.isNotEmpty
                          ? _beneficiaryId(beneficiary)
                          : result['beneficiary']?.toString() ?? '';
                      final name = _beneficiaryValue(
                        beneficiary,
                        const ['fullName', 'name', 'phone'],
                        fallback: beneficiaryNames[beneficiaryId] ??
                            'Beneficiary',
                      );
                      final status =
                          (result['status'] ?? 'UNKNOWN').toString().toUpperCase();
                      final reference = (result['transactionReference'] ??
                              result['paymentReference'] ??
                              result['reference'] ??
                              'Not provided')
                          .toString();
                      return ListTile(
                        contentPadding: EdgeInsets.zero,
                        leading: Icon(
                          status == 'SUCCESSFUL'
                              ? Icons.check_circle_outline_rounded
                              : Icons.error_outline_rounded,
                          color: _disbursementStatusColor(status),
                        ),
                        title: Text(name),
                        subtitle: Text(
                          'Status: $status • Amount: ${money(result['amount'])}\n'
                          'Reference: $reference',
                        ),
                        isThreeLine: true,
                      );
                    }),
                ],
              ),
            ),
          ),
          actions: [
            FilledButton(
              onPressed: () => Navigator.of(dialogContext).pop(),
              child: const Text('Done'),
            ),
          ],
        );
      },
    );
  }

  Future<void> _openBulkDisbursementDialog({
    required String programId,
    required String programName,
  }) async {
    if (!isHeadOffice) {
      return;
    }

    Map<String, dynamic> currentProgram;
    List<dynamic> eligibleRows;
    try {
      currentProgram = await _loadEmpowermentProgram(programId);
      eligibleRows = await _loadEmpowermentList(
        '/empowerment/programs/$programId/eligible-beneficiaries?limit=200',
        'beneficiaries',
      );
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              'Unable to load eligible beneficiaries: '
              '${e.toString().replaceFirst('Exception: ', '')}',
            ),
          ),
        );
      }
      return;
    }

    final programStatus = _programStatus(currentProgram);
    if (!_isPayoutEligibleProgramStatus(programStatus)) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text(
              'Program must be approved and active for disbursement.',
            ),
          ),
        );
      }
      return;
    }

    final eligible = eligibleRows
        .map(_beneficiaryMap)
        .where(_isBulkEligibleBeneficiary)
        .toList();
    if (eligible.isEmpty) {
      if (mounted) {
        await showDialog<void>(
          context: context,
          builder: (dialogContext) => AlertDialog(
            title: const Text('Bulk Disbursement'),
            content: const Text(
              'No eligible unpaid beneficiaries are available for this program.',
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.of(dialogContext).pop(),
                child: const Text('Close'),
              ),
            ],
          ),
        );
      }
      return;
    }

    final currentAmount = currentProgram['amountPerBeneficiary'] ??
        currentProgram['amount'] ??
        currentProgram['grantAmount'] ??
        0;
    final currentFinancials = _programFinancials(currentProgram);
    final currentBalance = currentFinancials['availableFundingAmount'];
    final selectedIds = await showDialog<List<String>>(
      context: context,
      builder: (dialogContext) {
        final selected = <String>{};
        return StatefulBuilder(
          builder: (context, setDialogState) {
            final selectedCount = selected.length;
            final total = _asDouble(currentAmount) * selectedCount;
            final balanceAfter = _asDouble(currentBalance) - total;
            final insufficient = selectedCount > 0 &&
                (_asDouble(currentAmount) <= 0 || balanceAfter < 0);
            final allSelected = selectedCount == eligible.length;

            return AlertDialog(
              title: Text('$programName Bulk Disbursement'),
              content: SizedBox(
                width: 720,
                height: 540,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text(
                      'Only approved, verified, linked, unpaid beneficiaries are shown.',
                      style: TextStyle(fontWeight: FontWeight.w700),
                    ),
                    const SizedBox(height: 8),
                    _organizationDetailRow(
                      'Eligible beneficiaries',
                      eligible.length.toString(),
                    ),
                    _organizationDetailRow(
                      'Configured amount per beneficiary',
                      money(currentAmount),
                    ),
                    _organizationDetailRow(
                      'Selected beneficiaries',
                      selectedCount.toString(),
                    ),
                    _organizationDetailRow(
                      'Total payout amount',
                      money(total),
                    ),
                    _organizationDetailRow(
                      'Current program balance',
                      money(currentBalance),
                    ),
                    _organizationDetailRow(
                      'Projected balance after payout',
                      money(balanceAfter),
                    ),
                    if (insufficient)
                      const Padding(
                        padding: EdgeInsets.only(top: 4),
                        child: Text(
                          'Program funding is insufficient for this selection.',
                          style: TextStyle(
                            color: Color(0xFFB42318),
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ),
                    CheckboxListTile(
                      value: allSelected,
                      onChanged: (value) {
                        setDialogState(() {
                          selected
                            ..clear()
                            ..addAll(
                              value == true
                                  ? eligible.map(_beneficiaryId)
                                  : const <String>[],
                            );
                        });
                      },
                      title: const Text('Select All Eligible'),
                      controlAffinity: ListTileControlAffinity.leading,
                      contentPadding: EdgeInsets.zero,
                    ),
                    const Divider(height: 1),
                    Expanded(
                      child: ListView.separated(
                        itemCount: eligible.length,
                        separatorBuilder: (_, __) => const Divider(height: 1),
                        itemBuilder: (_, index) {
                          final beneficiary = eligible[index];
                          final id = _beneficiaryId(beneficiary);
                          final name = _beneficiaryValue(
                            beneficiary,
                            const ['fullName', 'name', 'phone'],
                            fallback: 'Beneficiary',
                          );
                          final account = _beneficiaryValue(
                            beneficiary,
                            const [
                              'servicePayAccount',
                              'accountNumber',
                              'phone',
                              'email',
                            ],
                          );
                          return CheckboxListTile(
                            value: selected.contains(id),
                            onChanged: (value) {
                              setDialogState(() {
                                if (value == true) {
                                  selected.add(id);
                                } else {
                                  selected.remove(id);
                                }
                              });
                            },
                            title: Text(name),
                            subtitle: Text('ServicePay account: $account'),
                            controlAffinity: ListTileControlAffinity.leading,
                            contentPadding: EdgeInsets.zero,
                          );
                        },
                      ),
                    ),
                  ],
                ),
              ),
              actions: [
                TextButton(
                  onPressed: () => Navigator.of(dialogContext).pop(),
                  child: const Text('Cancel'),
                ),
                FilledButton(
                  onPressed: selected.isEmpty || insufficient
                      ? null
                      : () => Navigator.of(dialogContext).pop(
                            selected.toList()..sort(),
                          ),
                  child: const Text('Review & Continue'),
                ),
              ],
            );
          },
        );
      },
    );

    if (selectedIds == null || selectedIds.isEmpty || !mounted) {
      return;
    }

    final total = _asDouble(currentAmount) * selectedIds.length;
    final balanceAfter = _asDouble(currentBalance) - total;
    if (balanceAfter < 0 || _asDouble(currentAmount) <= 0) {
      return;
    }
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Confirm bulk disbursement'),
        content: SizedBox(
          width: 560,
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                _organizationDetailRow('Program', programName),
                _organizationDetailRow(
                  'Number of beneficiaries',
                  selectedIds.length.toString(),
                ),
                _organizationDetailRow(
                  'Amount per beneficiary',
                  money(currentAmount),
                ),
                _organizationDetailRow(
                  'Total amount to disburse',
                  money(total),
                ),
                _organizationDetailRow(
                  'Current program balance',
                  money(currentBalance),
                ),
                _organizationDetailRow(
                  'Balance after disbursement',
                  money(balanceAfter),
                ),
                const SizedBox(height: 12),
                const Text(
                  'Amounts are controlled by the program configuration. '
                  'The production API will revalidate every beneficiary and '
                  'the current program balance before any wallet is credited.',
                  style: TextStyle(fontWeight: FontWeight.w700),
                ),
              ],
            ),
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: const Text('Cancel'),
          ),
          FilledButton.icon(
            onPressed: () => Navigator.of(dialogContext).pop(true),
            icon: const Icon(Icons.payments_rounded),
            label: const Text('Confirm Bulk Disbursement'),
          ),
        ],
      ),
    );
    if (confirmed != true) {
      return;
    }

    final beneficiaryNames = {
      for (final beneficiary in eligible)
        _beneficiaryId(beneficiary): _beneficiaryValue(
          beneficiary,
          const ['fullName', 'name', 'phone'],
          fallback: 'Beneficiary',
        ),
    };
    final response = await _bulkDisburseBeneficiaries(
      programId: programId,
      beneficiaryIds: selectedIds,
    );
    if (response != null && mounted) {
      await _showBulkDisbursementResult(
        response: response,
        beneficiaryNames: beneficiaryNames,
      );
    }
  }

  Future<void> _showBeneficiaryDetails(
    Map<String, dynamic> beneficiary, {
    required String programName,
    required String programId,
    required String programStatus,
    required dynamic amountPerBeneficiary,
    required dynamic remainingBalance,
  }) async {
    final id = _beneficiaryId(beneficiary);
    final fullName = _beneficiaryValue(
      beneficiary,
      const ['fullName', 'name'],
      fallback: 'Beneficiary',
    );
    final applicationStatus = _beneficiaryApplicationStatus(beneficiary);
    final verificationStatus = _beneficiaryVerificationStatus(beneficiary);
    final isVerified = _isBeneficiaryVerified(beneficiary);
    final canVerify = !isVerified && applicationStatus == 'UNDER_REVIEW';
    final statusOptions = _beneficiaryStatusOptions(
      applicationStatus,
      isVerified,
    );
    final canUpdateStatus =
        statusOptions.any((status) => status != applicationStatus);
    final paymentStatus = _beneficiaryPaymentStatus(beneficiary);
    final canAttemptPayment =
        _hasPayableBeneficiaryState(beneficiary) && programStatus == 'APPROVED';
    final canDisburse = _canDisburseBeneficiary(
      beneficiary,
      programStatus: programStatus,
      remainingBalance: remainingBalance,
      amountPerBeneficiary: amountPerBeneficiary,
    );
    final insufficientFunding =
        canAttemptPayment && !canDisburse;
    final paidAmountValue = _beneficiaryValue(
      beneficiary,
      const ['paidAmount', 'amountPaid', 'disbursedAmount', 'amount'],
      fallback: '',
    );
    final paidAmount = paidAmountValue.isNotEmpty
        ? money(paidAmountValue)
        : paymentStatus == 'PAID'
            ? money(amountPerBeneficiary)
            : 'Not provided';
    final paymentReference = _beneficiaryValue(
      beneficiary,
      const ['paymentReference', 'transactionReference', 'reference'],
    );
    final paidAt = _beneficiaryValue(
      beneficiary,
      const ['paidAt', 'paymentDate', 'disbursedAt'],
    );
    final servicePayAccount = _beneficiaryValue(
      beneficiary,
      const ['accountNumber', 'userId', 'accountId', 'servicePayAccount'],
      fallback: _beneficiaryValue(
        _beneficiaryMap(beneficiary['user']),
        const ['fullName', 'email', 'phone', '_id', 'id'],
      ),
    );

    final detailAction = await showDialog<String>(
      context: context,
      builder: (dialogContext) {
        return AlertDialog(
          title: Text(fullName),
          content: SizedBox(
            width: 620,
            child: SingleChildScrollView(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  _organizationDetailRow(
                    'Application status',
                    applicationStatus,
                  ),
                  _organizationDetailRow(
                    'Verification status',
                    verificationStatus,
                  ),
                  _organizationDetailRow(
                    'ServicePay account',
                    servicePayAccount,
                  ),
                  _organizationDetailRow('Payment status', paymentStatus),
                   _organizationDetailRow(
                     'Program remaining balance',
                     money(remainingBalance),
                   ),
                  if (paymentStatus != 'NOT PAID') ...[
                    _organizationDetailRow('Paid amount', paidAmount),
                    _organizationDetailRow('Payment reference', paymentReference),
                    _organizationDetailRow('Paid date', paidAt),
                  ],
                  _organizationDetailRow(
                    'Phone',
                    _beneficiaryValue(
                      beneficiary,
                      const ['phone', 'phoneNumber'],
                    ),
                  ),
                  _organizationDetailRow(
                    'Email',
                    _beneficiaryValue(beneficiary, const ['email']),
                  ),
                  _organizationDetailRow('Program', programName),
                  _organizationDetailRow(
                    'State',
                    _beneficiaryValue(beneficiary, const ['state']),
                  ),
                  _organizationDetailRow(
                    'LGA',
                    _beneficiaryValue(beneficiary, const ['lga']),
                  ),
                  _organizationDetailRow(
                    'Address',
                    _beneficiaryValue(beneficiary, const ['address']),
                  ),
                  _organizationDetailRow(
                    'Gender',
                    _beneficiaryValue(beneficiary, const ['gender']),
                  ),
                  _organizationDetailRow(
                    'KYC / NIN / BVN reference',
                    _beneficiaryValue(
                      beneficiary,
                      const [
                        'kycReference',
                        'ninReference',
                        'bvnReference',
                        'maskedIdNumber',
                        'nin',
                        'bvn',
                      ],
                    ),
                  ),
                  _organizationDetailRow(
                    'Applied',
                    _beneficiaryValue(
                      beneficiary,
                      const ['appliedAt', 'createdAt', 'createdDate'],
                    ),
                  ),
                  if (!isVerified && !canVerify)
                    const Padding(
                      padding: EdgeInsets.only(top: 4),
                      child: Text(
                        'Move this application to UNDER REVIEW before verifying it.',
                        style: TextStyle(
                          color: Color(0xFFB42318),
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ),
                  if (insufficientFunding)
                    const Padding(
                      padding: EdgeInsets.only(top: 4),
                      child: Text(
                        'Program funding is insufficient. Fund this program before disbursement.',
                        style: TextStyle(
                          color: Color(0xFFB42318),
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ),
                ],
              ),
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(dialogContext).pop(),
              child: const Text('Close'),
            ),
            OutlinedButton.icon(
              onPressed: id.isEmpty || !canUpdateStatus
                  ? null
                  : () => Navigator.of(dialogContext).pop('status'),
              icon: const Icon(Icons.manage_accounts_outlined),
              label: const Text('Update Application Status'),
            ),
            if (canVerify && id.isNotEmpty)
              FilledButton.icon(
                onPressed: () => Navigator.of(dialogContext).pop('verify'),
                icon: const Icon(Icons.verified_user_rounded),
                label: const Text('Verify Beneficiary'),
              ),
            if ((canDisburse || insufficientFunding) && id.isNotEmpty)
              FilledButton.icon(
                onPressed: isDisbursing
                    ? null
                    : () => Navigator.of(dialogContext).pop('disburse'),
                icon: const Icon(Icons.payments_rounded),
                label: const Text('Pay Beneficiary'),
              ),
          ],
        );
      },
    );

    if (!mounted || id.isEmpty) {
      return;
    }

    if (detailAction == 'verify') {
      final confirmed = await showDialog<bool>(
        context: context,
        builder: (dialogContext) {
          return AlertDialog(
            title: const Text('Verify beneficiary?'),
            content: Text(
              'Confirm that the beneficiary information and KYC requirements '
              'have been reviewed before verification.',
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.of(dialogContext).pop(false),
                child: const Text('Cancel'),
              ),
              FilledButton(
                onPressed: () => Navigator.of(dialogContext).pop(true),
                child: const Text('Verify Beneficiary'),
              ),
            ],
          );
        },
      );

      if (confirmed == true) {
        await _updateBeneficiaryVerification(id, 'VERIFIED');
      }
      return;
    }

    if (detailAction == 'status') {
      await _showStatusPicker(
        title: fullName,
        currentStatus: applicationStatus,
        statuses: statusOptions,
        onSelected: (newStatus) async {
          await _updateBeneficiaryStatus(id, newStatus);
        },
      );
    }

    if (detailAction == 'disburse') {
      await _confirmBeneficiaryDisbursement(
        beneficiary: beneficiary,
        programName: programName,
        programId: programId,
        amountPerBeneficiary: amountPerBeneficiary,
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
            title: const Text('Select Program'),
            content: SizedBox(
              width: 560,
              height: 420,
              child: programs.isEmpty
                  ? const Center(child: Text('No programs found.'))
                  : ListView.builder(
                      itemCount: programs.length,
                      itemBuilder: (context, index) {
                        final item = _programMap(programs[index]);
                        final financials = _programFinancials(item);
                        return ListTile(
                          leading: const Icon(
                            Icons.volunteer_activism_outlined,
                          ),
                          title: Text(
                            (item['name'] ?? 'Program').toString(),
                          ),
                          subtitle: Text(
                            '${_programStatus(item)} • '
                            'Remaining: ${money(financials['availableFundingAmount'])}',
                          ),
                          trailing: const Icon(Icons.chevron_right_rounded),
                          onTap: () => Navigator.of(dialogContext).pop(item),
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

      var currentProgram = _programMap(selectedProgram);
      final programId =
          (currentProgram['_id'] ?? currentProgram['id'] ?? '').toString();

      if (programId.isEmpty) {
        throw Exception('Program ID is missing.');
      }

      while (mounted) {
        final programName =
            (currentProgram['name'] ?? 'Program').toString();
        final programStatus = _programStatus(currentProgram);
        final amountPerBeneficiary =
            currentProgram['amountPerBeneficiary'] ??
                currentProgram['amount'] ??
                currentProgram['grantAmount'] ??
                0;
        final programFinancials = _programFinancials(currentProgram);
        final remainingBalance =
            programFinancials['availableFundingAmount'];
        final beneficiaries = await _loadEmpowermentList(
          '/empowerment/programs/$programId/beneficiaries',
          'beneficiaries',
        );

        if (!mounted) {
          return;
        }

        final selectedAction = await showDialog<String>(
          context: context,
          builder: (dialogContext) {
            return AlertDialog(
              title: Text('$programName Beneficiaries'),
              content: SizedBox(
                width: 680,
                height: 500,
                child: beneficiaries.isEmpty
                    ? const Center(child: Text('No beneficiaries found.'))
                    : ListView.separated(
                        itemCount: beneficiaries.length,
                        separatorBuilder: (_, __) =>
                            const Divider(height: 1),
                        itemBuilder: (context, index) {
                          final item = _beneficiaryMap(beneficiaries[index]);
                          final id = _beneficiaryId(item);
                          final name = _beneficiaryValue(
                            item,
                            const ['fullName', 'name', 'phone'],
                            fallback: 'Beneficiary',
                          );
                          final applicationStatus =
                              _beneficiaryApplicationStatus(item);
                          final verificationStatus =
                              _beneficiaryVerificationStatus(item);
                          final paymentStatus =
                              _beneficiaryPaymentStatus(item);
                          final canAttemptPayment =
                              _hasPayableBeneficiaryState(item) &&
                                  programStatus == 'APPROVED';
                          final canDisburse = _canDisburseBeneficiary(
                            item,
                            programStatus: programStatus,
                            remainingBalance: remainingBalance,
                            amountPerBeneficiary: amountPerBeneficiary,
                          );
                          final insufficientFunding =
                              canAttemptPayment && !canDisburse;

                          return ListTile(
                            leading: const CircleAvatar(
                              child: Icon(Icons.person_outline_rounded),
                            ),
                            title: Text(name),
                            subtitle: Text(
                              'Application: $applicationStatus • '
                              'Verification: $verificationStatus • '
                              'Payment: $paymentStatus'
                              '${insufficientFunding ? ' • Funding insufficient' : ''}',
                            ),
                            trailing: (canDisburse || insufficientFunding) &&
                                    id.isNotEmpty
                                ? FilledButton.icon(
                                    style: FilledButton.styleFrom(
                                      backgroundColor: const Color(0xFF08783E),
                                    ),
                                    onPressed: isDisbursing
                                        ? null
                                        : () => Navigator.of(dialogContext)
                                            .pop('disburse:$id'),
                                    icon: const Icon(Icons.payments_rounded),
                                    label: const Text('Pay Beneficiary'),
                                  )
                                : const Icon(Icons.chevron_right_rounded),
                            onTap: id.isEmpty
                                ? null
                                : () => Navigator.of(dialogContext)
                                    .pop('view:$id'),
                          );
                        },
                      ),
              ),
              actions: [
                if (isHeadOffice)
                  OutlinedButton.icon(
                    onPressed: isDisbursing
                        ? null
                        : () => Navigator.of(dialogContext).pop('bulk'),
                    icon: const Icon(Icons.payments_outlined),
                    label: const Text('Bulk Disbursement'),
                  ),
                TextButton(
                  onPressed: () => Navigator.of(dialogContext).pop(),
                  child: const Text('Close'),
                ),
              ],
            );
          },
        );

        if (!mounted || selectedAction == null) {
          return;
        }

        if (selectedAction == 'bulk') {
          await _openBulkDisbursementDialog(
            programId: programId,
            programName: programName,
          );
          try {
            currentProgram = await _loadEmpowermentProgram(programId);
          } catch (e) {
            if (mounted) {
              ScaffoldMessenger.of(context).showSnackBar(
                SnackBar(
                  content: Text(
                    'Program balance could not be refreshed: '
                    '${e.toString().replaceFirst('Exception: ', '')}',
                  ),
                ),
              );
            }
          }
          continue;
        }

        final wantsDisbursement = selectedAction.startsWith('disburse:');
        final selectedId = selectedAction
            .replaceFirst(
              wantsDisbursement ? 'disburse:' : 'view:',
              '',
            )
            .trim();
        Map<String, dynamic>? selectedBeneficiary;
        for (final raw in beneficiaries) {
          final item = _beneficiaryMap(raw);
          if (_beneficiaryId(item) == selectedId) {
            selectedBeneficiary = item;
            break;
          }
        }

        if (selectedBeneficiary != null) {
          if (wantsDisbursement) {
            await _confirmBeneficiaryDisbursement(
              beneficiary: selectedBeneficiary,
              programName: programName,
              programId: programId,
              amountPerBeneficiary: amountPerBeneficiary,
            );
          } else {
            await _showBeneficiaryDetails(
              selectedBeneficiary,
              programName: programName,
              programId: programId,
                programStatus: programStatus,
              amountPerBeneficiary: amountPerBeneficiary,
                remainingBalance: remainingBalance,
            );
          }
          try {
            currentProgram = await _loadEmpowermentProgram(programId);
          } catch (e) {
            if (mounted) {
              ScaffoldMessenger.of(context).showSnackBar(
                SnackBar(
                  content: Text(
                    'Program balance could not be refreshed: '
                    '${e.toString().replaceFirst('Exception: ', '')}',
                  ),
                ),
              );
            }
          }
        }
      }
    } catch (e) {
      if (!mounted) {
        return;
      }

      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            e.toString().replaceFirst('Exception: ', ''),
          ),
        ),
      );
    }
  }

  Future<void> _openAuditTrailManager() async {
    try {
      final activities = await _loadEmpowermentList(
        '/empowerment/audit',
        'activities',
      );

      if (!mounted) return;

      await showDialog<void>(
        context: context,
        builder: (dialogContext) {
          return AlertDialog(
            title: const Text('Empowerment Audit Trail'),
            content: SizedBox(
              width: 760,
              height: 520,
              child: activities.isEmpty
                  ? const Center(
                      child: Text(
                        'No empowerment audit activity found.',
                      ),
                    )
                  : ListView.separated(
                      itemCount: activities.length,
                      separatorBuilder: (_, __) => const Divider(height: 1),
                      itemBuilder: (context, index) {
                        final item = Map<String, dynamic>.from(
                          activities[index],
                        );

                        final action = item['action']?.toString() ??
                            item['type']?.toString() ??
                            'Empowerment activity';

                        final description = item['description']?.toString() ??
                            item['message']?.toString() ??
                            '';

                        final createdAt = item['createdAt']?.toString() ??
                            item['date']?.toString() ??
                            '';

                        return ListTile(
                          leading: const CircleAvatar(
                            child: Icon(
                              Icons.history_rounded,
                            ),
                          ),
                          title: Text(action),
                          subtitle: Text(
                            [
                              if (description.isNotEmpty) description,
                              if (createdAt.isNotEmpty) createdAt,
                            ].join('\n'),
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
        if (onTap != null) {
          onTap();
          return;
        }

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

import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

class AdminAirtimeToCashScreen extends StatefulWidget {
  const AdminAirtimeToCashScreen({super.key});

  @override
  State<AdminAirtimeToCashScreen> createState() =>
      _AdminAirtimeToCashScreenState();
}

class _AdminAirtimeToCashScreenState extends State<AdminAirtimeToCashScreen> {
  static const String baseUrl = 'https://api.servicepay.ng/api';
  static const Color primaryGreen = Color(0xFF08783E);

  bool isLoading = true;
  String selectedStatus = 'PENDING';

  List<Map<String, dynamic>> requests = [];

  Future<String> _getToken() async {
    final prefs = await SharedPreferences.getInstance();

    for (final key in [
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

  @override
  void initState() {
    super.initState();
    _loadRequests();
  }

  Future<void> _loadRequests() async {
    if (mounted) {
      setState(() {
        isLoading = true;
      });
    }

    try {
      final token = await _getToken();

      final response = await http.get(
        Uri.parse(
          '$baseUrl/airtime-to-cash/admin/requests'
          '?status=$selectedStatus',
        ),
        headers: {
          'Authorization': 'Bearer $token',
          'Accept': 'application/json',
        },
      );

      final dynamic decoded = jsonDecode(response.body);

      final data = decoded is Map
          ? Map<String, dynamic>.from(decoded)
          : <String, dynamic>{};

      if (response.statusCode >= 200 &&
          response.statusCode < 300 &&
          data['success'] == true) {
        final raw = data['requests'];

        requests = raw is List
            ? raw
                .whereType<Map>()
                .map(
                  (item) => Map<String, dynamic>.from(item),
                )
                .toList()
            : [];
      } else {
        _showMessage(
          data['message']?.toString() ??
              'Unable to load Airtime to Cash requests.',
        );
      }
    } catch (_) {
      _showMessage(
        'Unable to connect to ServicePay API.',
      );
    } finally {
      if (mounted) {
        setState(() {
          isLoading = false;
        });
      }
    }
  }

  Future<void> _approve(
    Map<String, dynamic> item,
  ) async {
    final id = item['_id']?.toString() ?? '';

    if (id.isEmpty) return;

    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) {
        return AlertDialog(
          title: const Text(
            'Approve Airtime to Cash',
          ),
          content: Text(
            'Confirm that ServicePay received '
            '₦${item['airtimeAmount']} ${item['network']} airtime.\n\n'
            'Customer wallet will be credited '
            '₦${item['cashAmount']}.',
          ),
          actions: [
            TextButton(
              onPressed: () {
                Navigator.pop(dialogContext, false);
              },
              child: const Text('Cancel'),
            ),
            FilledButton(
              onPressed: () {
                Navigator.pop(dialogContext, true);
              },
              style: FilledButton.styleFrom(
                backgroundColor: primaryGreen,
              ),
              child: const Text(
                'Approve & Credit',
              ),
            ),
          ],
        );
      },
    );

    if (confirmed != true) return;

    await _performAction(
      id: id,
      action: 'approve',
    );
  }

  Future<void> _reject(
    Map<String, dynamic> item,
  ) async {
    final id = item['_id']?.toString() ?? '';

    if (id.isEmpty) return;

    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) {
        return AlertDialog(
          title: const Text('Reject Request'),
          content: const Text(
            'Are you sure you want to reject this request?',
          ),
          actions: [
            TextButton(
              onPressed: () {
                Navigator.pop(dialogContext, false);
              },
              child: const Text('Cancel'),
            ),
            FilledButton(
              onPressed: () {
                Navigator.pop(dialogContext, true);
              },
              style: FilledButton.styleFrom(
                backgroundColor: Colors.red,
              ),
              child: const Text('Reject'),
            ),
          ],
        );
      },
    );

    if (confirmed != true) return;

    await _performAction(
      id: id,
      action: 'reject',
    );
  }

  Future<void> _performAction({
    required String id,
    required String action,
  }) async {
    try {
      final token = await _getToken();

      final response = await http.post(
        Uri.parse(
          '$baseUrl/airtime-to-cash/admin/$id/$action',
        ),
        headers: {
          'Authorization': 'Bearer $token',
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
        body: jsonEncode({}),
      );

      final dynamic decoded = jsonDecode(response.body);

      final data = decoded is Map
          ? Map<String, dynamic>.from(decoded)
          : <String, dynamic>{};

      _showMessage(
        data['message']?.toString() ?? 'Action completed.',
      );

      if (response.statusCode >= 200 &&
          response.statusCode < 300 &&
          data['success'] == true) {
        await _loadRequests();
      }
    } catch (_) {
      _showMessage(
        'Unable to complete this action.',
      );
    }
  }

  void _showMessage(String message) {
    if (!mounted) return;

    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(message),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF7FAF8),
      appBar: AppBar(
        title: const Text('Airtime to Cash'),
        backgroundColor: Colors.white,
        foregroundColor: Colors.black87,
        elevation: 0,
        actions: [
          IconButton(
            onPressed: _loadRequests,
            tooltip: 'Refresh',
            icon: const Icon(
              Icons.refresh_rounded,
            ),
          ),
        ],
      ),
      body: Column(
        children: [
          Container(
            width: double.infinity,
            color: Colors.white,
            padding: const EdgeInsets.all(16),
            child: Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                _statusChip('PENDING'),
                _statusChip('APPROVED'),
                _statusChip('REJECTED'),
              ],
            ),
          ),
          Expanded(
            child: isLoading
                ? const Center(
                    child: CircularProgressIndicator(),
                  )
                : requests.isEmpty
                    ? const Center(
                        child: Text(
                          'No Airtime to Cash requests found.',
                        ),
                      )
                    : RefreshIndicator(
                        onRefresh: _loadRequests,
                        child: ListView.separated(
                          padding: const EdgeInsets.all(16),
                          itemCount: requests.length,
                          separatorBuilder: (_, __) =>
                              const SizedBox(height: 12),
                          itemBuilder: (context, index) {
                            return _requestCard(
                              requests[index],
                            );
                          },
                        ),
                      ),
          ),
        ],
      ),
    );
  }

  Widget _statusChip(String status) {
    return ChoiceChip(
      label: Text(status),
      selected: selectedStatus == status,
      selectedColor: const Color(0xFFEAF7F0),
      onSelected: (_) {
        setState(() {
          selectedStatus = status;
        });

        _loadRequests();
      },
    );
  }

  Widget _requestCard(
    Map<String, dynamic> item,
  ) {
    final user = item['user'] is Map
        ? Map<String, dynamic>.from(item['user'])
        : <String, dynamic>{};

    final status = item['status']?.toString() ?? 'PENDING';

    return Card(
      elevation: 0,
      color: Colors.white,
      shape: RoundedRectangleBorder(
        side: const BorderSide(
          color: Color(0xFFE4ECE7),
        ),
        borderRadius: BorderRadius.circular(18),
      ),
      child: Padding(
        padding: const EdgeInsets.all(18),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    item['reference']?.toString() ?? '',
                    style: const TextStyle(
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                ),
                _statusBadge(status),
              ],
            ),
            const SizedBox(height: 16),
            _detail(
              'Customer',
              user['fullName']?.toString() ?? '-',
            ),
            _detail(
              'Phone',
              user['phone']?.toString() ?? '-',
            ),
            _detail(
              'Network',
              item['network']?.toString() ?? '-',
            ),
            _detail(
              'Sender Number',
              item['senderPhone']?.toString() ?? '-',
            ),
            _detail(
              'Airtime Amount',
              '₦${item['airtimeAmount'] ?? 0}',
            ),
            _detail(
              'Rate',
              '${item['ratePercent'] ?? 0}%',
            ),
            _detail(
              'Wallet Credit',
              '₦${item['cashAmount'] ?? 0}',
            ),
            _detail(
              'Receiving Number',
              item['receivingPhone']?.toString() ?? '-',
            ),
            const SizedBox(height: 16),
            if (status == 'PENDING')
              Row(
                children: [
                  Expanded(
                    child: OutlinedButton.icon(
                      onPressed: () => _reject(item),
                      icon: const Icon(
                        Icons.close_rounded,
                      ),
                      label: const Text('Reject'),
                      style: OutlinedButton.styleFrom(
                        foregroundColor: Colors.red,
                      ),
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: FilledButton.icon(
                      onPressed: () => _approve(item),
                      icon: const Icon(
                        Icons.check_rounded,
                      ),
                      label: const Text('Approve'),
                      style: FilledButton.styleFrom(
                        backgroundColor: primaryGreen,
                      ),
                    ),
                  ),
                ],
              ),
          ],
        ),
      ),
    );
  }

  Widget _detail(
    String label,
    String value,
  ) {
    return Padding(
      padding: const EdgeInsets.symmetric(
        vertical: 5,
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 135,
            child: Text(
              label,
              style: const TextStyle(
                color: Colors.black54,
              ),
            ),
          ),
          Expanded(
            child: Text(
              value,
              style: const TextStyle(
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _statusBadge(String status) {
    final Color color;

    switch (status) {
      case 'APPROVED':
        color = primaryGreen;
        break;
      case 'REJECTED':
        color = Colors.red;
        break;
      default:
        color = Colors.orange;
    }

    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: 10,
        vertical: 6,
      ),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.10),
        borderRadius: BorderRadius.circular(30),
      ),
      child: Text(
        status,
        style: TextStyle(
          color: color,
          fontSize: 11,
          fontWeight: FontWeight.w800,
        ),
      ),
    );
  }
}

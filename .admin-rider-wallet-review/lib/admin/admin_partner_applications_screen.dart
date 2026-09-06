import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

class AdminPartnerApplicationsScreen extends StatefulWidget {
  const AdminPartnerApplicationsScreen({super.key});

  @override
  State<AdminPartnerApplicationsScreen> createState() =>
      _AdminPartnerApplicationsScreenState();
}

class _AdminPartnerApplicationsScreenState
    extends State<AdminPartnerApplicationsScreen> {
  static const String baseUrl = 'https://api.servicepay.ng/api';

  bool isLoading = true;
  String errorMessage = '';
  List<Map<String, dynamic>> applications = [];

  @override
  void initState() {
    super.initState();
    loadApplications();
  }

  Future<String?> _token() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getString('auth_token');
  }

  Map<String, String> _headers(String token) {
    return <String, String>{
      'Authorization': 'Bearer $token',
      'Accept': 'application/json',
      'Content-Type': 'application/json',
    };
  }

  String _text(dynamic value) {
    if (value == null) return '';
    return value.toString();
  }

  Future<void> loadApplications() async {
    if (mounted) {
      setState(() {
        isLoading = true;
        errorMessage = '';
      });
    }

    try {
      final token = await _token();

      if (token == null || token.isEmpty) {
        throw Exception('Admin authentication token not found.');
      }

      final candidates = <Uri>[
        Uri.parse('$baseUrl/admin/partner-applications'),
        Uri.parse('$baseUrl/admin/partner-applications?status=PENDING'),
      ];

      http.Response? response;

      for (final uri in candidates) {
        final current = await http
            .get(uri, headers: _headers(token))
            .timeout(const Duration(seconds: 30));

        response = current;

        if (current.statusCode >= 200 && current.statusCode < 300) {
          break;
        }
      }

      if (response == null) {
        throw Exception('Unable to connect to Partner Applications API.');
      }

      final dynamic decoded = response.body.isEmpty
          ? <String, dynamic>{}
          : jsonDecode(response.body);

      if (response.statusCode < 200 || response.statusCode >= 300) {
        String message = 'Unable to load partner applications.';

        if (decoded is Map) {
          message = _text(
            decoded['message'] ??
                decoded['error'] ??
                'Unable to load partner applications.',
          );
        }

        throw Exception(message);
      }

      dynamic raw;

      if (decoded is List) {
        raw = decoded;
      } else if (decoded is Map) {
        raw = decoded['applications'] ??
            decoded['data'] ??
            decoded['results'] ??
            decoded['items'] ??
            <dynamic>[];

        if (raw is Map) {
          raw = raw['applications'] ??
              raw['items'] ??
              raw['results'] ??
              <dynamic>[];
        }
      }

      final list = <Map<String, dynamic>>[];

      if (raw is List) {
        for (final item in raw) {
          if (item is Map) {
            list.add(Map<String, dynamic>.from(item));
          }
        }
      }

      list.sort((a, b) {
        final ad = _text(a['createdAt']);
        final bd = _text(b['createdAt']);
        return bd.compareTo(ad);
      });

      if (!mounted) return;

      setState(() {
        applications = list;
        isLoading = false;
      });
    } catch (error) {
      if (!mounted) return;

      setState(() {
        isLoading = false;
        errorMessage = error.toString().replaceFirst('Exception: ', '');
      });
    }
  }

  Future<void> _changeStatus(
    Map<String, dynamic> application,
    String action,
  ) async {
    final id = _text(
      application['_id'] ?? application['id'] ?? application['applicationId'],
    );

    if (id.isEmpty) {
      _showMessage('Application ID is missing.', error: true);
      return;
    }

    String reason = '';

    if (action == 'reject') {
      final controller = TextEditingController();

      final confirmed = await showDialog<bool>(
        context: context,
        builder: (context) {
          return AlertDialog(
            title: const Text('Reject Partner Application'),
            content: TextField(
              controller: controller,
              maxLines: 3,
              decoration: const InputDecoration(
                labelText: 'Reason',
                hintText: 'Enter rejection reason',
                border: OutlineInputBorder(),
              ),
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.pop(context, false),
                child: const Text('Cancel'),
              ),
              FilledButton(
                onPressed: () => Navigator.pop(context, true),
                child: const Text('Reject'),
              ),
            ],
          );
        },
      );

      reason = controller.text.trim();
      controller.dispose();

      if (confirmed != true) return;
    } else {
      final confirmed = await showDialog<bool>(
        context: context,
        builder: (context) {
          return AlertDialog(
            title: const Text('Approve Partner'),
            content: const Text(
              'Approve this application and create the Partner API account?',
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.pop(context, false),
                child: const Text('Cancel'),
              ),
              FilledButton(
                onPressed: () => Navigator.pop(context, true),
                child: const Text('Approve'),
              ),
            ],
          );
        },
      );

      if (confirmed != true) return;
    }

    try {
      final token = await _token();

      if (token == null || token.isEmpty) {
        throw Exception('Admin authentication token not found.');
      }

      final body = jsonEncode(
        action == 'reject'
            ? <String, dynamic>{'reason': reason}
            : <String, dynamic>{},
      );

      final urls = <String>[
        '$baseUrl/admin/partner-applications/$id/$action',
        '$baseUrl/admin/partner-applications/$action/$id',
      ];

      http.Response? response;

      for (final url in urls) {
        final current = await http
            .patch(
              Uri.parse(url),
              headers: _headers(token),
              body: body,
            )
            .timeout(const Duration(seconds: 30));

        response = current;

        if (current.statusCode >= 200 && current.statusCode < 300) {
          break;
        }
      }

      if (response == null) {
        throw Exception('Unable to connect to Partner Approval API.');
      }

      dynamic decoded;

      try {
        decoded = response.body.isEmpty
            ? <String, dynamic>{}
            : jsonDecode(response.body);
      } catch (_) {
        decoded = <String, dynamic>{};
      }

      if (response.statusCode < 200 || response.statusCode >= 300) {
        String message = 'Unable to $action application.';

        if (decoded is Map) {
          message = _text(
            decoded['message'] ??
                decoded['error'] ??
                'Unable to $action application.',
          );
        }

        throw Exception(message);
      }

      if (!mounted) return;

      _showMessage(
        action == 'approve'
            ? 'Partner application approved successfully.'
            : 'Partner application rejected.',
      );

      await loadApplications();
    } catch (error) {
      if (!mounted) return;

      _showMessage(
        error.toString().replaceFirst('Exception: ', ''),
        error: true,
      );
    }
  }

  void _showMessage(
    String message, {
    bool error = false,
  }) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(message),
        backgroundColor: error ? Colors.red : Colors.green,
      ),
    );
  }

  Widget _statusChip(String status) {
    final normalized = status.toUpperCase();

    Color background;
    Color foreground;

    if (normalized == 'APPROVED' || normalized == 'ACTIVE') {
      background = Colors.green.shade50;
      foreground = Colors.green.shade800;
    } else if (normalized == 'REJECTED' || normalized == 'REVOKED') {
      background = Colors.red.shade50;
      foreground = Colors.red.shade800;
    } else {
      background = Colors.orange.shade50;
      foreground = Colors.orange.shade800;
    }

    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: 10,
        vertical: 6,
      ),
      decoration: BoxDecoration(
        color: background,
        borderRadius: BorderRadius.circular(30),
      ),
      child: Text(
        normalized.isEmpty ? 'PENDING' : normalized,
        style: TextStyle(
          color: foreground,
          fontWeight: FontWeight.w700,
          fontSize: 11,
        ),
      ),
    );
  }

  Widget _applicationCard(Map<String, dynamic> item) {
    final user = item['user'] is Map
        ? Map<String, dynamic>.from(item['user'] as Map)
        : <String, dynamic>{};

    final businessName = _text(
      item['businessName'] ??
          item['companyName'] ??
          item['organizationName'] ??
          'Unnamed Business',
    );

    final contactName = _text(
      item['contactName'] ?? user['fullName'] ?? user['name'] ?? 'Not provided',
    );

    final email = _text(
      item['email'] ?? user['email'] ?? 'Not provided',
    );

    final phone = _text(
      item['phone'] ?? user['phone'] ?? 'Not provided',
    );

    final status =
        _text(item['status']).isEmpty ? 'PENDING' : _text(item['status']);

    final purpose = _text(
      item['purpose'] ?? item['description'] ?? item['businessDescription'],
    );

    final isPending = status.toUpperCase() == 'PENDING';

    return Card(
      margin: const EdgeInsets.only(bottom: 14),
      elevation: 0,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(18),
        side: BorderSide(
          color: Colors.grey.shade200,
        ),
      ),
      child: Padding(
        padding: const EdgeInsets.all(18),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                CircleAvatar(
                  radius: 24,
                  backgroundColor: const Color(0xFFEAF7F0),
                  child: const Icon(
                    Icons.handshake_rounded,
                    color: Color(0xFF08783E),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        businessName,
                        style: const TextStyle(
                          fontSize: 17,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        contactName,
                        style: TextStyle(
                          color: Colors.grey.shade700,
                        ),
                      ),
                    ],
                  ),
                ),
                _statusChip(status),
              ],
            ),
            const SizedBox(height: 16),
            _infoRow(Icons.email_outlined, email),
            const SizedBox(height: 8),
            _infoRow(Icons.phone_outlined, phone),
            if (purpose.isNotEmpty) ...[
              const SizedBox(height: 12),
              Text(
                purpose,
                style: TextStyle(
                  color: Colors.grey.shade700,
                  height: 1.4,
                ),
              ),
            ],
            if (isPending) ...[
              const SizedBox(height: 18),
              Row(
                children: [
                  Expanded(
                    child: OutlinedButton.icon(
                      onPressed: () => _changeStatus(item, 'reject'),
                      icon: const Icon(Icons.close_rounded),
                      label: const Text('Reject'),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: FilledButton.icon(
                      onPressed: () => _changeStatus(item, 'approve'),
                      icon: const Icon(Icons.check_rounded),
                      label: const Text('Approve'),
                      style: FilledButton.styleFrom(
                        backgroundColor: const Color(0xFF08783E),
                      ),
                    ),
                  ),
                ],
              ),
            ],
          ],
        ),
      ),
    );
  }

  Widget _infoRow(IconData icon, String text) {
    return Row(
      children: [
        Icon(
          icon,
          size: 18,
          color: Colors.grey.shade600,
        ),
        const SizedBox(width: 8),
        Expanded(
          child: Text(
            text,
            style: TextStyle(
              color: Colors.grey.shade800,
            ),
          ),
        ),
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    final pending = applications
        .where(
          (item) =>
              _text(item['status']).toUpperCase() == 'PENDING' ||
              _text(item['status']).isEmpty,
        )
        .length;

    return Scaffold(
      backgroundColor: const Color(0xFFF7F9F8),
      appBar: AppBar(
        title: const Text('Partner Applications'),
        actions: [
          IconButton(
            tooltip: 'Refresh',
            onPressed: loadApplications,
            icon: const Icon(Icons.refresh_rounded),
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: loadApplications,
        child: isLoading
            ? const Center(
                child: CircularProgressIndicator(),
              )
            : errorMessage.isNotEmpty
                ? ListView(
                    padding: const EdgeInsets.all(24),
                    children: [
                      const SizedBox(height: 100),
                      Icon(
                        Icons.cloud_off_rounded,
                        size: 55,
                        color: Colors.red.shade300,
                      ),
                      const SizedBox(height: 18),
                      Text(
                        errorMessage,
                        textAlign: TextAlign.center,
                      ),
                      const SizedBox(height: 18),
                      Center(
                        child: FilledButton.icon(
                          onPressed: loadApplications,
                          icon: const Icon(Icons.refresh_rounded),
                          label: const Text('Try Again'),
                        ),
                      ),
                    ],
                  )
                : ListView(
                    padding: const EdgeInsets.all(18),
                    children: [
                      Row(
                        children: [
                          Expanded(
                            child: _summaryCard(
                              'Total Applications',
                              applications.length.toString(),
                              Icons.description_outlined,
                            ),
                          ),
                          const SizedBox(width: 12),
                          Expanded(
                            child: _summaryCard(
                              'Pending Review',
                              pending.toString(),
                              Icons.hourglass_top_rounded,
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 20),
                      if (applications.isEmpty)
                        const Padding(
                          padding: EdgeInsets.symmetric(vertical: 70),
                          child: Column(
                            children: [
                              Icon(
                                Icons.inbox_outlined,
                                size: 55,
                                color: Colors.grey,
                              ),
                              SizedBox(height: 14),
                              Text(
                                'No partner applications yet.',
                                style: TextStyle(
                                  fontWeight: FontWeight.w600,
                                  color: Colors.grey,
                                ),
                              ),
                            ],
                          ),
                        )
                      else
                        ...applications.map(_applicationCard),
                    ],
                  ),
      ),
    );
  }

  Widget _summaryCard(
    String title,
    String value,
    IconData icon,
  ) {
    return Container(
      padding: const EdgeInsets.all(17),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(
          color: Colors.grey.shade200,
        ),
      ),
      child: Row(
        children: [
          Container(
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(
              color: const Color(0xFFEAF7F0),
              borderRadius: BorderRadius.circular(12),
            ),
            child: Icon(
              icon,
              color: const Color(0xFF08783E),
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  value,
                  style: const TextStyle(
                    fontSize: 22,
                    fontWeight: FontWeight.w900,
                  ),
                ),
                Text(
                  title,
                  style: TextStyle(
                    fontSize: 11,
                    color: Colors.grey.shade600,
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

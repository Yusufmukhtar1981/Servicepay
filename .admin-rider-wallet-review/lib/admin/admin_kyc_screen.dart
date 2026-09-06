import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';
import 'package:url_launcher/url_launcher.dart';

class AdminKycScreen extends StatefulWidget {
  const AdminKycScreen({
    super.key,
    this.httpClient,
    this.headOfficeOverride,
  });

  final http.Client? httpClient;
  final bool? headOfficeOverride;

  @override
  State<AdminKycScreen> createState() => _AdminKycScreenState();
}

class _AdminKycScreenState extends State<AdminKycScreen> {
  static const String baseUrl = 'https://api.servicepay.ng/api';
  static const Color primaryGreen = Color(0xFF08783E);

  late final http.Client _httpClient;
  final TextEditingController _searchController = TextEditingController();

  bool isLoading = true;
  bool isHeadOffice = false;
  bool isSubmitting = false;
  bool _accessResolved = false;
  String errorMessage = '';
  String selectedStatus = 'ALL';
  String submittedSearch = '';

  List<Map<String, dynamic>> applications = [];

  final statuses = const [
    'ALL',
    'PENDING',
    'UNDER_REVIEW',
    'VERIFIED',
    'REJECTED',
  ];

  @override
  void initState() {
    super.initState();
    _httpClient = widget.httpClient ?? http.Client();
    _loadAccessAndKyc();
  }

  @override
  void dispose() {
    _searchController.dispose();
    if (widget.httpClient == null) {
      _httpClient.close();
    }
    super.dispose();
  }

  Future<void> _loadAccessAndKyc() async {
    final prefs = await SharedPreferences.getInstance();
    final role = _normalizeRole(
      prefs.getString('user_role') ??
          prefs.getString('admin_role') ??
          prefs.getString('role'),
    );
    final allowed = widget.headOfficeOverride ?? role == 'HEAD_OFFICE';

    if (!mounted) return;

    setState(() {
      isHeadOffice = allowed;
      isLoading = allowed;
      _accessResolved = true;
      errorMessage = allowed ? '' : 'Head Office access is required for KYC review.';
    });

    if (allowed) {
      await _loadKyc();
    }
  }

  String _normalizeRole(String? value) {
    return (value ?? '').trim().toUpperCase().replaceAll(
          RegExp(r'[\s-]+'),
          '_',
        );
  }

  Future<String?> _token() async {
    final prefs = await SharedPreferences.getInstance();
    const keys = [
      'auth_token',
      'admin_token',
      'token',
      'access_token',
      'accessToken',
      'jwt_token',
      'jwt',
    ];

    for (final key in keys) {
      final value = (prefs.getString(key) ?? '').trim();
      if (value.isNotEmpty) {
        return value.startsWith('Bearer ') ? value.substring(7) : value;
      }
    }
    return null;
  }

  dynamic _decodeBody(String raw) {
    try {
      return jsonDecode(raw);
    } catch (_) {
      return <String, dynamic>{};
    }
  }

  String _messageFrom(dynamic body, String fallback) {
    if (body is Map) {
      final message = body['message'] ?? body['error'];
      if (message != null && message.toString().trim().isNotEmpty) {
        return message.toString();
      }
    }
    return fallback;
  }

  Future<bool> _loadKyc() async {
    if (!isHeadOffice) return false;

    if (mounted) {
      setState(() {
        isLoading = true;
        errorMessage = '';
      });
    }

    try {
      final token = await _token();
      if (token == null || token.isEmpty) {
        throw Exception('Admin session expired. Please log in again.');
      }

      final query = <String, String>{};
      if (submittedSearch.trim().isNotEmpty) {
        query['search'] = submittedSearch.trim();
      }
      if (selectedStatus != 'ALL') {
        query['status'] = selectedStatus;
      }

      final uri = Uri.parse('$baseUrl/admin/kyc').replace(
        queryParameters: query.isEmpty ? null : query,
      );
      final response = await _httpClient.get(
        uri,
        headers: {
          'Accept': 'application/json',
          'Authorization': 'Bearer $token',
        },
      ).timeout(const Duration(seconds: 45));
      final body = _decodeBody(response.body);

      if (response.statusCode == 401 || response.statusCode == 403) {
        throw Exception(
          response.statusCode == 403
              ? 'You are not authorized to review KYC records.'
              : 'Admin session expired. Please log in again.',
        );
      }

      final success = response.statusCode >= 200 &&
          response.statusCode < 300 &&
          (body is! Map || body['success'] != false);
      if (!success) {
        throw Exception(
          _messageFrom(body, 'Unable to load KYC applications.'),
        );
      }

      final raw = body is Map
          ? body['applications'] ??
              body['kycApplications'] ??
              body['records'] ??
              body['data']
          : null;
      final list = raw is List
          ? raw
          : raw is Map
              ? raw['applications'] ??
                  raw['kycApplications'] ??
                  raw['records'] ??
                  raw['items'] ??
                  raw['data'] ??
                  []
              : [];

      if (!mounted) return false;
      setState(() {
        applications = list is List
            ? list
                .whereType<Map>()
                .map((item) => Map<String, dynamic>.from(item))
                .toList()
            : [];
        isLoading = false;
      });
      return true;
    } catch (error) {
      if (!mounted) return false;
      setState(() {
        isLoading = false;
        errorMessage = error.toString().replaceFirst('Exception: ', '');
      });
      return false;
    }
  }

  void _submitSearch() {
    setState(() {
      submittedSearch = _searchController.text.trim();
    });
    _loadKyc();
  }

  void _clearSearch() {
    _searchController.clear();
    if (submittedSearch.isEmpty) return;
    setState(() {
      submittedSearch = '';
    });
    _loadKyc();
  }

  Future<bool> _updateKyc({
    required String id,
    required String status,
    String rejectionReason = '',
    bool manualOverride = false,
  }) async {
    if (!isHeadOffice) {
      _message('Head Office access is required for KYC actions.', error: true);
      return false;
    }

    try {
      final token = await _token();
      if (token == null || token.isEmpty) {
        _message('Admin session expired. Please log in again.', error: true);
        return false;
      }

      final payload = <String, dynamic>{
        'status': status,
        if (manualOverride) 'manualOverride': true,
        if (rejectionReason.trim().isNotEmpty)
          'rejectionReason': rejectionReason.trim(),
      };
      final response = await _httpClient.patch(
        Uri.parse('$baseUrl/admin/kyc/$id/status'),
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          'Authorization': 'Bearer $token',
        },
        body: jsonEncode(payload),
      ).timeout(const Duration(seconds: 45));
      final body = _decodeBody(response.body);
      final success = response.statusCode >= 200 &&
          response.statusCode < 300 &&
          (body is! Map || body['success'] != false);

      if (!success) {
        _message(
          response.statusCode == 403
              ? 'You are not authorized to perform this KYC action.'
              : _messageFrom(body, 'Unable to update KYC.'),
          error: true,
        );
        return false;
      }

      final refreshed = await _loadKyc();
      if (!refreshed) {
        _message(
          'KYC was updated, but the latest server state could not be loaded. Please refresh and confirm it before continuing.',
          error: true,
        );
        return false;
      }
      if (manualOverride && !_manualVerificationPersisted(id)) {
        _message(
          'KYC was updated, but the refreshed record does not confirm manual verification. Please refresh and reconcile it before continuing.',
          error: true,
        );
        return false;
      }
      if (mounted) {
        _message(
          _messageFrom(
            body,
            manualOverride
                ? 'KYC manually verified successfully.'
                : 'KYC updated successfully.',
          ),
        );
      }
      return true;
    } catch (error) {
      _message(
        error.toString().replaceFirst('Exception: ', ''),
        error: true,
      );
      return false;
    }
  }

  Future<bool> _manualVerify(Map<String, dynamic> item) async {
    if (isSubmitting) {
      return false;
    }

    final id = _id(item);
    if (id.isEmpty) {
      _message('KYC customer ID was not returned by the server.', error: true);
      return false;
    }

    setState(() {
      isSubmitting = true;
    });
    final result = await _updateKyc(
      id: id,
      status: 'VERIFIED',
      manualOverride: true,
    );
    if (mounted) {
      setState(() {
        isSubmitting = false;
      });
    }
    return result;
  }

  bool _manualVerificationPersisted(String id) {
    Map<String, dynamic>? refreshed;
    for (final item in applications) {
      if (_id(item) == id) {
        refreshed = item;
        break;
      }
    }

    if (refreshed == null || _status(refreshed) != 'VERIFIED') {
      return false;
    }

    final method = _value(
      refreshed,
      const ['verificationMethod', 'method'],
      fallback: '',
    ).toUpperCase();
    final verifiedBy = _value(
      refreshed,
      const ['verifiedBy', 'verificationBy', 'verifiedByName'],
      fallback: '',
    );
    final verifiedAt = _value(
      refreshed,
      const ['verifiedAt', 'verificationDate', 'verifiedDate'],
      fallback: '',
    );
    return method == 'MANUAL_ADMIN_OVERRIDE' &&
        verifiedBy.isNotEmpty &&
        verifiedAt.isNotEmpty;
  }

  void _message(String message, {bool error = false}) {
    if (!mounted) return;
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(
        SnackBar(
          content: Text(message),
          backgroundColor: error ? Colors.red.shade700 : primaryGreen,
        ),
      );
  }

  String _id(Map<String, dynamic> item) {
    final value = item['_id'] ?? item['id'] ?? item['kycId'] ?? item['customerId'];
    if (value is Map) {
      return (value['_id'] ?? value['id'] ?? '').toString();
    }
    return value?.toString().trim() ?? '';
  }

  Map<String, dynamic> _map(dynamic value) {
    return value is Map ? Map<String, dynamic>.from(value) : {};
  }

  List<Map<String, dynamic>> _sources(Map<String, dynamic> item) {
    return [
      item,
      _map(item['kyc']),
      _map(item['verification']),
      _map(item['customer']),
      _map(item['user']),
      _map(item['account']),
      _map(item['data']),
    ];
  }

  String _value(
    Map<String, dynamic> item,
    List<String> keys, {
    String fallback = 'Not provided',
  }) {
    for (final source in _sources(item)) {
      for (final key in keys) {
        final value = source[key];
        if (value == null) continue;
        final text = value is String ? value.trim() : value.toString().trim();
        if (text.isNotEmpty) return text;
      }
    }
    return fallback;
  }

  String _name(Map<String, dynamic> item) {
    final fullName = _value(
      item,
      const ['fullName', 'name', 'customerName'],
      fallback: '',
    );
    if (fullName.isNotEmpty) return fullName;

    final parts = [
      _value(item, const ['firstName'], fallback: ''),
      _value(item, const ['middleName'], fallback: ''),
      _value(item, const ['lastName'], fallback: ''),
    ].where((part) => part.isNotEmpty).toList();
    return parts.isEmpty ? 'Customer' : parts.join(' ');
  }

  String _status(Map<String, dynamic> item) {
    return _value(
      item,
      const ['status', 'kycStatus', 'verificationStatus'],
      fallback: 'PENDING',
    ).toUpperCase();
  }

  String _statusLabel(String status) {
    return status
        .replaceAll('_', ' ')
        .split(' ')
        .map(
          (part) => part.isEmpty
              ? part
              : '${part[0].toUpperCase()}${part.substring(1).toLowerCase()}',
        )
        .join(' ');
  }

  Color _statusColor(String status) {
    switch (status.toUpperCase()) {
      case 'VERIFIED':
        return Colors.green;
      case 'REJECTED':
        return Colors.red;
      case 'UNDER_REVIEW':
        return Colors.orange;
      case 'PENDING':
        return Colors.blue;
      default:
        return Colors.grey;
    }
  }

  String _label(String key) {
    final spaced = key.replaceAllMapped(
      RegExp(r'([a-z])([A-Z])'),
      (match) => '${match.group(1)} ${match.group(2)}',
    );
    return spaced
        .replaceAll('_', ' ')
        .replaceAll('-', ' ')
        .split(' ')
        .map(
          (part) => part.isEmpty
              ? part
              : '${part[0].toUpperCase()}${part.substring(1)}',
        )
        .join(' ');
  }

  String _dateValue(Map<String, dynamic> item) {
    return _value(
      item,
      const ['verifiedAt', 'verificationDate', 'verifiedDate'],
    );
  }

  List<MapEntry<String, String>> _allDetails(Map<String, dynamic> item) {
    final entries = <MapEntry<String, String>>[];
    final hidden = {
      '_id',
      'id',
      'customerId',
      'userId',
      'kycId',
      'createdAt',
      'updatedAt',
    };

    void addValues(dynamic value, String prefix) {
      if (value is! Map) return;
      for (final entry in value.entries) {
        final key = entry.key.toString();
        if (hidden.contains(key)) continue;
        final label = prefix.isEmpty ? _label(key) : '$prefix / ${_label(key)}';
        final child = entry.value;
        if (child is Map) {
          addValues(child, label);
        } else if (child is List) {
          if (child.isEmpty) {
            entries.add(MapEntry(label, 'Not provided'));
          } else {
            entries.add(
              MapEntry(
                label,
                child
                    .map((value) => value is Map ? jsonEncode(value) : '$value')
                    .join(', '),
              ),
            );
          }
        } else if (child != null && child.toString().trim().isNotEmpty) {
          entries.add(MapEntry(label, child.toString()));
        } else {
          entries.add(MapEntry(label, 'Not provided'));
        }
      }
    }

    addValues(item, '');
    return entries;
  }

  Future<void> _openApplication(Map<String, dynamic> item) async {
    final reasonController = TextEditingController();
    final id = _id(item);
    var dialogSubmitting = false;

    await showDialog<void>(
      context: context,
      builder: (dialogContext) {
        final status = _status(item);
        final canManualVerify = isHeadOffice && status != 'VERIFIED';
        return Dialog(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 760, maxHeight: 800),
            child: Column(
              children: [
                Container(
                  padding: const EdgeInsets.fromLTRB(18, 12, 8, 12),
                  color: primaryGreen,
                  child: Row(
                    children: [
                      const Icon(Icons.verified_user, color: Colors.white),
                      const SizedBox(width: 10),
                      Expanded(
                        child: Text(
                          _name(item),
                          style: const TextStyle(
                            color: Colors.white,
                            fontSize: 18,
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                      ),
                      IconButton(
                        tooltip: 'Close',
                        onPressed: () => Navigator.pop(dialogContext),
                        icon: const Icon(Icons.close, color: Colors.white),
                      ),
                    ],
                  ),
                ),
                Expanded(
                  child: SingleChildScrollView(
                    padding: const EdgeInsets.all(18),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        _detailRow('Phone', _value(item, const ['phone', 'phoneNumber'])),
                        _detailRow('Email', _value(item, const ['email'])),
                        _detailRow(
                          'KYC status',
                          _statusLabel(status),
                        ),
                        _detailRow(
                          'Submitted NIN',
                          _value(item, const [
                            'nin',
                            'ninNumber',
                            'ninValue',
                            'submittedNin',
                            'submittedNIN',
                          ]),
                        ),
                        _detailRow(
                          'Submitted BVN',
                          _value(item, const [
                            'bvn',
                            'bvnNumber',
                            'bvnValue',
                            'submittedBvn',
                            'submittedBVN',
                          ]),
                        ),
                        _detailRow(
                          'Tier',
                          _value(item, const ['tier', 'level', 'kycTier']),
                        ),
                        _detailRow(
                          'Verification method',
                          _value(item, const [
                            'verificationMethod',
                            'method',
                          ]),
                        ),
                        _detailRow(
                          'Verified by',
                          _value(item, const [
                            'verifiedBy',
                            'verificationBy',
                            'verifiedByName',
                          ]),
                        ),
                        _detailRow('Verified at', _dateValue(item)),
                        const Divider(height: 28),
                        Text(
                          'Submitted KYC information and documents',
                          style: Theme.of(context).textTheme.titleMedium?.copyWith(
                                fontWeight: FontWeight.w800,
                              ),
                        ),
                        const SizedBox(height: 10),
                        ..._allDetails(item).map(
                          (entry) {
                            final isLink = Uri.tryParse(entry.value)?.hasAbsolutePath == true &&
                                (entry.value.startsWith('http://') ||
                                    entry.value.startsWith('https://'));
                            return _detailRow(
                              entry.key,
                              entry.value,
                              trailing: isLink
                                  ? TextButton.icon(
                                      onPressed: () async {
                                        final uri = Uri.tryParse(entry.value);
                                        if (uri != null) {
                                          await launchUrl(
                                            uri,
                                            mode: LaunchMode.externalApplication,
                                          );
                                        }
                                      },
                                      icon: const Icon(Icons.open_in_new, size: 16),
                                      label: const Text('Open'),
                                    )
                                  : null,
                            );
                          },
                        ),
                        if (_allDetails(item).isEmpty)
                          const Text('No additional KYC fields or documents were returned.'),
                        if (canManualVerify) ...[
                          const SizedBox(height: 18),
                          Container(
                            padding: const EdgeInsets.all(12),
                            decoration: BoxDecoration(
                              color: const Color(0xFFFFF8E7),
                              borderRadius: BorderRadius.circular(10),
                            ),
                            child: const Text(
                              'Head Office manual override may verify this record '
                              'without requiring NIN, BVN, or optional KYC fields. '
                              'Any submitted identifiers are preserved and missing '
                              'values are never fabricated.',
                            ),
                          ),
                        ],
                        const SizedBox(height: 18),
                        if (isHeadOffice)
                          Wrap(
                            spacing: 10,
                            runSpacing: 10,
                            children: [
                              OutlinedButton.icon(
                                onPressed: id.isEmpty || isSubmitting
                                    ? null
                                    : () async {
                                        final ok = await _updateKyc(
                                          id: id,
                                          status: 'UNDER_REVIEW',
                                        );
                                        if (ok && dialogContext.mounted) {
                                          Navigator.pop(dialogContext);
                                        }
                                      },
                                icon: const Icon(Icons.manage_search),
                                label: const Text('Under Review'),
                              ),
                              if (canManualVerify)
                                StatefulBuilder(
                                  builder: (context, setDialogState) {
                                    return FilledButton.icon(
                                      onPressed: id.isEmpty || dialogSubmitting
                                          ? null
                                          : () async {
                                              setDialogState(() {
                                                dialogSubmitting = true;
                                              });
                                              final ok = await _manualVerify(item);
                                              if (dialogContext.mounted) {
                                                setDialogState(() {
                                                  dialogSubmitting = false;
                                                });
                                              }
                                              if (ok && dialogContext.mounted) {
                                                Navigator.pop(dialogContext);
                                              }
                                            },
                                      icon: dialogSubmitting
                                          ? const SizedBox(
                                              width: 18,
                                              height: 18,
                                              child: CircularProgressIndicator(
                                                strokeWidth: 2,
                                                color: Colors.white,
                                              ),
                                            )
                                          : const Icon(Icons.verified),
                                      label: const Text('Manual Verify / Approve'),
                                    );
                                  },
                                ),
                            ],
                          ),
                        if (isHeadOffice) ...[
                          const SizedBox(height: 20),
                          TextField(
                            controller: reasonController,
                            maxLines: 3,
                            decoration: const InputDecoration(
                              labelText: 'Rejection reason',
                              border: OutlineInputBorder(),
                            ),
                          ),
                          const SizedBox(height: 12),
                          SizedBox(
                            width: double.infinity,
                            child: OutlinedButton.icon(
                              style: OutlinedButton.styleFrom(
                                foregroundColor: Colors.red,
                              ),
                              onPressed: id.isEmpty || isSubmitting
                                  ? null
                                  : () async {
                                      final reason = reasonController.text.trim();
                                      if (reason.isEmpty) {
                                        _message('Please enter a rejection reason.', error: true);
                                        return;
                                      }
                                      final ok = await _updateKyc(
                                        id: id,
                                        status: 'REJECTED',
                                        rejectionReason: reason,
                                      );
                                      if (ok && dialogContext.mounted) {
                                        Navigator.pop(dialogContext);
                                      }
                                    },
                              icon: const Icon(Icons.cancel),
                              label: const Text('Reject KYC'),
                            ),
                          ),
                        ],
                      ],
                    ),
                  ),
                ),
              ],
            ),
          ),
        );
      },
    );
    reasonController.dispose();
  }

  Widget _detailRow(
    String title,
    String value, {
    Widget? trailing,
  }) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 11),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 170,
            child: Text(
              title,
              style: const TextStyle(
                color: Colors.black54,
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
          Expanded(child: SelectableText(value)),
          if (trailing != null) trailing,
        ],
      ),
    );
  }

  Widget _searchBar() {
    return Padding(
      padding: const EdgeInsets.fromLTRB(14, 14, 14, 4),
      child: Row(
        children: [
          Expanded(
            child: TextField(
              controller: _searchController,
              textInputAction: TextInputAction.search,
              onSubmitted: (_) => _submitSearch(),
              decoration: InputDecoration(
                labelText: 'Search customers',
                hintText: 'Full name, phone, email, exact NIN or BVN',
                prefixIcon: const Icon(Icons.search),
                suffixIcon: _searchController.text.isEmpty
                    ? null
                    : IconButton(
                        tooltip: 'Clear search',
                        onPressed: _clearSearch,
                        icon: const Icon(Icons.clear),
                      ),
                border: const OutlineInputBorder(),
              ),
              onChanged: (_) => setState(() {}),
            ),
          ),
          const SizedBox(width: 10),
          SizedBox(
            height: 56,
            child: FilledButton.icon(
              onPressed: isLoading ? null : _submitSearch,
              icon: const Icon(Icons.search),
              label: const Text('Search'),
            ),
          ),
        ],
      ),
    );
  }

  Widget _emptyView() {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.person_search, size: 54, color: Colors.grey),
            const SizedBox(height: 12),
            Text(
              submittedSearch.isEmpty
                  ? 'No KYC applications found.'
                  : 'No customer found for “$submittedSearch”.',
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 12),
            OutlinedButton.icon(
              onPressed: _loadKyc,
              icon: const Icon(Icons.refresh),
              label: const Text('Refresh'),
            ),
          ],
        ),
      ),
    );
  }

  Widget _errorView() {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.cloud_off, size: 52, color: Colors.grey),
            const SizedBox(height: 12),
            Text(errorMessage, textAlign: TextAlign.center),
            const SizedBox(height: 12),
            ElevatedButton.icon(
              onPressed: _loadKyc,
              icon: const Icon(Icons.refresh),
              label: const Text('Try Again'),
            ),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('KYC Review'),
        backgroundColor: primaryGreen,
        foregroundColor: Colors.white,
        actions: [
          IconButton(
            tooltip: 'Refresh',
            onPressed: isLoading || !isHeadOffice ? null : _loadKyc,
            icon: const Icon(Icons.refresh),
          ),
        ],
      ),
      body: !_accessResolved
          ? const Center(child: CircularProgressIndicator())
          : !isHeadOffice
              ? _errorView()
          : Column(
              children: [
                _searchBar(),
                SizedBox(
                  height: 58,
                  child: ListView(
                    scrollDirection: Axis.horizontal,
                    padding: const EdgeInsets.fromLTRB(14, 4, 14, 10),
                    children: statuses.map((status) {
                      return Padding(
                        padding: const EdgeInsets.only(right: 8),
                        child: ChoiceChip(
                          label: Text(_statusLabel(status)),
                          selected: selectedStatus == status,
                          onSelected: isLoading
                              ? null
                              : (_) {
                                  setState(() {
                                    selectedStatus = status;
                                  });
                                  _loadKyc();
                                },
                        ),
                      );
                    }).toList(),
                  ),
                ),
                Expanded(
                  child: isLoading
                      ? const Center(child: CircularProgressIndicator())
                      : errorMessage.isNotEmpty
                          ? _errorView()
                          : applications.isEmpty
                              ? _emptyView()
                              : RefreshIndicator(
                                  onRefresh: _loadKyc,
                                  child: LayoutBuilder(
                                    builder: (context, constraints) {
                                      final wide = constraints.maxWidth >= 800;
                                      return ListView.builder(
                                        padding: EdgeInsets.symmetric(
                                          horizontal: wide ? 28 : 14,
                                          vertical: 10,
                                        ),
                                        itemCount: applications.length,
                                        itemBuilder: (context, index) {
                                          final item = applications[index];
                                          final status = _status(item);
                                          final color = _statusColor(status);
                                          return Card(
                                            margin: const EdgeInsets.only(bottom: 10),
                                            child: ListTile(
                                              contentPadding: const EdgeInsets.all(14),
                                              leading: CircleAvatar(
                                                backgroundColor: color.withAlpha(30),
                                                child: Icon(
                                                  Icons.person_search,
                                                  color: color,
                                                ),
                                              ),
                                              title: Text(
                                                _name(item),
                                                style: const TextStyle(
                                                  fontWeight: FontWeight.bold,
                                                ),
                                              ),
                                              subtitle: Padding(
                                                padding: const EdgeInsets.only(top: 6),
                                                child: Wrap(
                                                  spacing: 12,
                                                  runSpacing: 4,
                                                  children: [
                                                    Text(_value(item, const ['phone', 'phoneNumber'])),
                                                    Text(_value(item, const ['email'])),
                                                    Text(
                                                      'NIN: ${_value(item, const ['nin', 'ninNumber', 'submittedNin', 'submittedNIN'])}',
                                                    ),
                                                    Text(
                                                      'BVN: ${_value(item, const ['bvn', 'bvnNumber', 'submittedBvn', 'submittedBVN'])}',
                                                    ),
                                                    Text(
                                                      'Tier: ${_value(item, const ['tier', 'level', 'kycTier'])}',
                                                    ),
                                                    Text(
                                                      'Method: ${_value(item, const ['verificationMethod', 'method'])}',
                                                    ),
                                                    Text(
                                                      'Verified by: ${_value(item, const ['verifiedBy', 'verifiedByName'])}',
                                                    ),
                                                    Text('Verified: ${_dateValue(item)}'),
                                                    Text(
                                                      _statusLabel(status),
                                                      style: TextStyle(
                                                        color: color,
                                                        fontWeight: FontWeight.bold,
                                                      ),
                                                    ),
                                                  ],
                                                ),
                                              ),
                                              trailing: const Icon(Icons.chevron_right),
                                              onTap: () => _openApplication(item),
                                            ),
                                          );
                                        },
                                      );
                                    },
                                  ),
                                ),
                ),
              ],
            ),
    );
  }
}
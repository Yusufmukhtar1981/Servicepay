import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

class AdminPlatformConfigurationScreen extends StatefulWidget {
  final String? initialSection;

  const AdminPlatformConfigurationScreen({
    super.key,
    this.initialSection,
  });

  @override
  State<AdminPlatformConfigurationScreen> createState() =>
      _AdminPlatformConfigurationScreenState();
}

class _AdminPlatformConfigurationScreenState
    extends State<AdminPlatformConfigurationScreen> {
  static const String _baseUrl = 'https://api.servicepay.ng/api';
  static const String _endpoint = '$_baseUrl/settings/admin/fintech-control';

  bool _loading = true;
  bool _saving = false;
  String? _error;

  Map<String, dynamic> _data = <String, dynamic>{};

  late String _section;

  final TextEditingController _maintenanceMessage = TextEditingController();

  final TextEditingController _scheduledStart = TextEditingController();

  final TextEditingController _scheduledEnd = TextEditingController();

  bool _maintenanceEnabled = false;
  bool _customerAppEnabled = true;
  bool _apiEnabled = true;

  final Map<String, TextEditingController> _feeControllers = {};
  final Map<String, TextEditingController> _legalControllers = {};
  final Map<String, TextEditingController> _limitControllers = {};

  static const List<String> _feeKeys = <String>[
    'servicepayTransfer',
    'bankTransfer',
    'walletFunding',
    'withdrawal',
    'merchantPayment',
    'airtime',
    'data',
  ];

  static const List<String> _legalKeys = <String>[
    'privacyPolicyUrl',
    'termsUrl',
    'kycAmlPolicyUrl',
    'complaintsPolicyUrl',
    'dataProtectionPolicyUrl',
  ];

  static const List<String> _limitKeys = <String>[
    'tier1Daily',
    'tier1PerTransaction',
    'tier2Daily',
    'tier2PerTransaction',
    'tier3Daily',
    'tier3PerTransaction',
    'servicepayTransfer',
    'bankTransfer',
    'walletFunding',
    'withdrawal',
  ];

  @override
  void initState() {
    super.initState();

    _section = widget.initialSection ?? 'Maintenance Mode';

    for (final key in _feeKeys) {
      _feeControllers[key] = TextEditingController();
    }

    for (final key in _legalKeys) {
      _legalControllers[key] = TextEditingController();
    }

    for (final key in _limitKeys) {
      _limitControllers[key] = TextEditingController();
    }

    _load();
  }

  @override
  void dispose() {
    _maintenanceMessage.dispose();
    _scheduledStart.dispose();
    _scheduledEnd.dispose();

    for (final c in _feeControllers.values) {
      c.dispose();
    }

    for (final c in _legalControllers.values) {
      c.dispose();
    }

    for (final c in _limitControllers.values) {
      c.dispose();
    }

    super.dispose();
  }

  Future<String> _token() async {
    final prefs = await SharedPreferences.getInstance();

    return prefs.getString('auth_token') ?? prefs.getString('token') ?? '';
  }

  Map<String, String> _headers(String token) {
    return <String, String>{
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Authorization': 'Bearer $token',
    };
  }

  Map<String, dynamic> _asMap(dynamic value) {
    if (value is Map<String, dynamic>) {
      return value;
    }

    if (value is Map) {
      return Map<String, dynamic>.from(value);
    }

    return <String, dynamic>{};
  }

  dynamic _pickRoot(dynamic decoded) {
    if (decoded is! Map) {
      return decoded;
    }

    final map = Map<String, dynamic>.from(decoded);

    if (map['data'] is Map) {
      return map['data'];
    }

    if (map['settings'] is Map) {
      return map['settings'];
    }

    if (map['fintechControl'] is Map) {
      return map['fintechControl'];
    }

    return map;
  }

  bool _asBool(dynamic value, bool fallback) {
    if (value is bool) {
      return value;
    }

    if (value is num) {
      return value != 0;
    }

    if (value is String) {
      final v = value.toLowerCase().trim();

      if (v == 'true' || v == '1' || v == 'yes') {
        return true;
      }

      if (v == 'false' || v == '0' || v == 'no') {
        return false;
      }
    }

    return fallback;
  }

  String _text(dynamic value) {
    if (value == null) {
      return '';
    }

    return value.toString();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });

    try {
      final token = await _token();

      if (token.isEmpty) {
        throw Exception('Admin authentication token not found.');
      }

      final response = await http
          .get(
            Uri.parse(_endpoint),
            headers: _headers(token),
          )
          .timeout(const Duration(seconds: 30));

      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw Exception(
          'GET failed (${response.statusCode}): ${response.body}',
        );
      }

      dynamic decoded;

      try {
        decoded = jsonDecode(response.body);
      } catch (_) {
        throw Exception('Backend returned invalid JSON.');
      }

      final root = _asMap(_pickRoot(decoded));

      Map<String, dynamic> fintech = root;

      if (root['fintechControl'] is Map) {
        fintech = _asMap(root['fintechControl']);
      }

      _data = fintech;

      final maintenance = _asMap(fintech['maintenance']);

      _maintenanceEnabled = _asBool(maintenance['enabled'], false);

      _customerAppEnabled = _asBool(maintenance['customerAppEnabled'], true);

      _apiEnabled = _asBool(maintenance['apiEnabled'], true);

      _maintenanceMessage.text = _text(maintenance['message']);

      _scheduledStart.text = _text(maintenance['scheduledStartAt']);

      _scheduledEnd.text = _text(maintenance['scheduledEndAt']);

      final fees = _asMap(fintech['transactionFees']);

      for (final key in _feeKeys) {
        _feeControllers[key]!.text = _text(fees[key]);
      }

      final legal = _asMap(fintech['legalPolicies']);

      for (final key in _legalKeys) {
        _legalControllers[key]!.text = _text(legal[key]);
      }

      final limits = _asMap(
        fintech['serviceLimits'] ?? fintech['limits'],
      );

      for (final key in _limitKeys) {
        _limitControllers[key]!.text = _text(limits[key]);
      }
    } catch (e) {
      _error = e.toString();
    } finally {
      if (mounted) {
        setState(() {
          _loading = false;
        });
      }
    }
  }

  dynamic _numberOrString(String raw) {
    final value = raw.trim();

    if (value.isEmpty) {
      return '';
    }

    final number = num.tryParse(
      value.replaceAll(',', ''),
    );

    return number ?? value;
  }

  Map<String, dynamic> _buildPayload() {
    final fees = <String, dynamic>{};

    for (final entry in _feeControllers.entries) {
      fees[entry.key] = _numberOrString(entry.value.text);
    }

    final legal = <String, dynamic>{};

    for (final entry in _legalControllers.entries) {
      legal[entry.key] = entry.value.text.trim();
    }

    final limits = <String, dynamic>{};

    for (final entry in _limitControllers.entries) {
      limits[entry.key] = _numberOrString(entry.value.text);
    }

    return <String, dynamic>{
      'maintenance': <String, dynamic>{
        'enabled': _maintenanceEnabled,
        'customerAppEnabled': _customerAppEnabled,
        'apiEnabled': _apiEnabled,
        'message': _maintenanceMessage.text.trim(),
        'scheduledStartAt': _scheduledStart.text.trim(),
        'scheduledEndAt': _scheduledEnd.text.trim(),
      },
      'transactionFees': fees,
      'serviceLimits': limits,
      'legalPolicies': legal,
    };
  }

  Future<void> _save() async {
    if (_saving) {
      return;
    }

    setState(() {
      _saving = true;
      _error = null;
    });

    try {
      final token = await _token();

      if (token.isEmpty) {
        throw Exception('Admin authentication token not found.');
      }

      final response = await http
          .put(
            Uri.parse(_endpoint),
            headers: _headers(token),
            body: jsonEncode(_buildPayload()),
          )
          .timeout(const Duration(seconds: 30));

      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw Exception(
          'PUT failed (${response.statusCode}): ${response.body}',
        );
      }

      if (!mounted) {
        return;
      }

      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text(
            'Platform configuration saved successfully.',
          ),
        ),
      );

      await _load();
    } catch (e) {
      if (mounted) {
        setState(() {
          _error = e.toString();
        });

        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Save failed: $e'),
          ),
        );
      }
    } finally {
      if (mounted) {
        setState(() {
          _saving = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF6F8FA),
      appBar: AppBar(
        title: const Text(
          'Platform Configuration',
          style: TextStyle(
            fontWeight: FontWeight.w800,
          ),
        ),
        actions: [
          IconButton(
            tooltip: 'Refresh',
            onPressed: _loading ? null : _load,
            icon: const Icon(Icons.refresh),
          ),
        ],
      ),
      body: _loading
          ? const Center(
              child: CircularProgressIndicator(),
            )
          : RefreshIndicator(
              onRefresh: _load,
              child: ListView(
                padding: const EdgeInsets.all(16),
                children: [
                  _header(),
                  const SizedBox(height: 16),
                  _sectionSelector(),
                  const SizedBox(height: 16),
                  if (_error != null) _errorCard(_error!),
                  if (_error != null) const SizedBox(height: 16),
                  if (_section == 'Maintenance Mode') _maintenanceSection(),
                  if (_section == 'Service Limits') _limitsSection(),
                  if (_section == 'Transaction Fees') _feesSection(),
                  if (_section == 'Legal & Policies') _legalSection(),
                  const SizedBox(height: 22),
                  SizedBox(
                    height: 52,
                    child: FilledButton.icon(
                      onPressed: _saving ? null : _save,
                      icon: _saving
                          ? const SizedBox(
                              width: 20,
                              height: 20,
                              child: CircularProgressIndicator(
                                strokeWidth: 2,
                              ),
                            )
                          : const Icon(Icons.save_outlined),
                      label: Text(
                        _saving ? 'Saving...' : 'Save Configuration',
                        style: const TextStyle(
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(height: 30),
                ],
              ),
            ),
    );
  }

  Widget _header() {
    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: const Color(0xFF08783E),
        borderRadius: BorderRadius.circular(18),
      ),
      child: const Row(
        children: [
          Icon(
            Icons.admin_panel_settings_outlined,
            color: Colors.white,
            size: 34,
          ),
          SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'ServicePay Fintech Control',
                  style: TextStyle(
                    color: Colors.white,
                    fontSize: 19,
                    fontWeight: FontWeight.w900,
                  ),
                ),
                SizedBox(height: 5),
                Text(
                  'Live administration connected to the ServicePay backend.',
                  style: TextStyle(
                    color: Colors.white70,
                    height: 1.35,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _sectionSelector() {
    const sections = <String>[
      'Maintenance Mode',
      'Service Limits',
      'Transaction Fees',
      'Legal & Policies',
    ];

    return Wrap(
      spacing: 8,
      runSpacing: 8,
      children: sections.map((item) {
        return ChoiceChip(
          label: Text(item),
          selected: _section == item,
          onSelected: (_) {
            setState(() {
              _section = item;
            });
          },
        );
      }).toList(),
    );
  }

  Widget _maintenanceSection() {
    return _panel(
      title: 'Maintenance Mode',
      subtitle: 'Control ServicePay customer access and API availability.',
      icon: Icons.engineering_outlined,
      children: [
        SwitchListTile(
          contentPadding: EdgeInsets.zero,
          title: const Text(
            'Global Maintenance',
            style: TextStyle(
              fontWeight: FontWeight.w800,
            ),
          ),
          subtitle: const Text(
            'Enable maintenance mode for the platform.',
          ),
          value: _maintenanceEnabled,
          onChanged: (value) {
            setState(() {
              _maintenanceEnabled = value;
            });
          },
        ),
        const Divider(),
        SwitchListTile(
          contentPadding: EdgeInsets.zero,
          title: const Text(
            'Customer App Enabled',
            style: TextStyle(
              fontWeight: FontWeight.w800,
            ),
          ),
          value: _customerAppEnabled,
          onChanged: (value) {
            setState(() {
              _customerAppEnabled = value;
            });
          },
        ),
        SwitchListTile(
          contentPadding: EdgeInsets.zero,
          title: const Text(
            'API Enabled',
            style: TextStyle(
              fontWeight: FontWeight.w800,
            ),
          ),
          value: _apiEnabled,
          onChanged: (value) {
            setState(() {
              _apiEnabled = value;
            });
          },
        ),
        _field(
          controller: _maintenanceMessage,
          label: 'Maintenance Message',
          hint: 'ServicePay is temporarily unavailable...',
          maxLines: 3,
        ),
        _field(
          controller: _scheduledStart,
          label: 'Scheduled Start',
          hint: '2026-08-17T23:00:00.000Z',
        ),
        _field(
          controller: _scheduledEnd,
          label: 'Scheduled End',
          hint: '2026-08-18T01:00:00.000Z',
        ),
      ],
    );
  }

  Widget _limitsSection() {
    return _panel(
      title: 'Service Limits',
      subtitle: 'Manage transaction and operational limits.',
      icon: Icons.speed_outlined,
      children: [
        for (final key in _limitKeys)
          _field(
            controller: _limitControllers[key]!,
            label: _pretty(key),
            keyboardType: const TextInputType.numberWithOptions(
              decimal: true,
            ),
          ),
      ],
    );
  }

  Widget _feesSection() {
    return _panel(
      title: 'Transaction Fees',
      subtitle: 'Central fee administration for ServicePay products.',
      icon: Icons.price_change_outlined,
      children: [
        for (final key in _feeKeys)
          _field(
            controller: _feeControllers[key]!,
            label: _pretty(key),
            keyboardType: const TextInputType.numberWithOptions(
              decimal: true,
            ),
          ),
      ],
    );
  }

  Widget _legalSection() {
    return _panel(
      title: 'Legal & Policies',
      subtitle: 'Manage ServicePay policy document URLs.',
      icon: Icons.gavel_outlined,
      children: [
        for (final key in _legalKeys)
          _field(
            controller: _legalControllers[key]!,
            label: _pretty(key),
            hint: 'https://servicepay.ng/...',
          ),
      ],
    );
  }

  Widget _panel({
    required String title,
    required String subtitle,
    required IconData icon,
    required List<Widget> children,
  }) {
    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(18),
        boxShadow: const [
          BoxShadow(
            color: Color(0x0D000000),
            blurRadius: 12,
            offset: Offset(0, 4),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(
                icon,
                color: const Color(0xFF08783E),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      title,
                      style: const TextStyle(
                        fontSize: 18,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                    const SizedBox(height: 3),
                    Text(
                      subtitle,
                      style: const TextStyle(
                        color: Colors.black54,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 18),
          ...children,
        ],
      ),
    );
  }

  Widget _field({
    required TextEditingController controller,
    required String label,
    String? hint,
    int maxLines = 1,
    TextInputType? keyboardType,
  }) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 14),
      child: TextField(
        controller: controller,
        maxLines: maxLines,
        keyboardType: keyboardType,
        decoration: InputDecoration(
          labelText: label,
          hintText: hint,
          border: OutlineInputBorder(
            borderRadius: BorderRadius.circular(12),
          ),
        ),
      ),
    );
  }

  Widget _errorCard(String message) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: const Color(0xFFFFF1F1),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(
          color: const Color(0xFFFFC8C8),
        ),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Icon(
            Icons.error_outline,
            color: Colors.red,
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              message,
              style: const TextStyle(
                color: Colors.red,
              ),
            ),
          ),
        ],
      ),
    );
  }

  String _pretty(String value) {
    final spaced = value
        .replaceAllMapped(
          RegExp(r'([a-z])([A-Z])'),
          (match) => '${match.group(1)} ${match.group(2)}',
        )
        .replaceAll('_', ' ');

    return spaced
        .split(' ')
        .where((e) => e.isNotEmpty)
        .map(
          (e) => '${e[0].toUpperCase()}${e.substring(1)}',
        )
        .join(' ');
  }
}

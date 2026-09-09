import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

class AdminPlatformConfigurationScreen extends StatefulWidget {
  final String initialSection;

  const AdminPlatformConfigurationScreen({
    super.key,
    this.initialSection = 'Maintenance Mode',
  });

  @override
  State<AdminPlatformConfigurationScreen> createState() =>
      _AdminPlatformConfigurationScreenState();
}

class _AdminPlatformConfigurationScreenState
    extends State<AdminPlatformConfigurationScreen> {
  static const String _baseUrl = 'https://api.servicepay.ng/api';
  static const String _endpoint = '/settings/admin/fintech-control';

  bool _loading = true;
  bool _saving = false;
  String? _error;

  late String _section;

  bool _maintenanceEnabled = false;
  bool _customerAppEnabled = true;
  bool _apiEnabled = true;

  final Map<String, TextEditingController> _c = {};

  final List<String> _sections = const [
    'Maintenance Mode',
    'Service Limits',
    'Transaction Fees',
    'Legal & Policies',
  ];

  @override
  void initState() {
    super.initState();

    _section = _sections.contains(widget.initialSection)
        ? widget.initialSection
        : 'Maintenance Mode';

    for (final key in [
      'maintenanceMessage',
      'scheduledStartAt',
      'scheduledEndAt',
      'tier1Daily',
      'tier1PerTransaction',
      'tier2Daily',
      'tier2PerTransaction',
      'tier3Daily',
      'tier3PerTransaction',
      'servicepayTransferLimit',
      'bankTransferLimit',
      'walletFundingLimit',
      'withdrawalLimit',
      'servicepayTransferFee',
      'bankTransferFee',
      'walletFundingFee',
      'withdrawalFee',
      'merchantPaymentFee',
      'airtimeFee',
      'dataFee',
      'privacyPolicyUrl',
      'termsUrl',
      'kycAmlPolicyUrl',
      'complaintsPolicyUrl',
      'dataProtectionPolicyUrl',
    ]) {
      _c[key] = TextEditingController();
    }

    _load();
  }

  @override
  void dispose() {
    for (final controller in _c.values) {
      controller.dispose();
    }
    super.dispose();
  }

  Future<String> _token() async {
    final prefs = await SharedPreferences.getInstance();

    final raw = prefs.getString('auth_token') ??
        prefs.getString('token') ??
        prefs.getString('admin_token') ??
        '';

    return raw.startsWith('Bearer ') ? raw.substring(7).trim() : raw.trim();
  }

  Map<String, String> _headers(String token) => {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        if (token.isNotEmpty) 'Authorization': 'Bearer $token',
      };

  Map<String, dynamic> _asMap(dynamic value) {
    if (value is Map<String, dynamic>) return value;

    if (value is Map) {
      return value.map(
        (key, value) => MapEntry(key.toString(), value),
      );
    }

    return <String, dynamic>{};
  }

  dynamic _firstNonNull(List<dynamic> values) {
    for (final value in values) {
      if (value != null) return value;
    }
    return null;
  }

  Map<String, dynamic> _extractFintechControl(dynamic decoded) {
    final root = _asMap(decoded);
    final data = _asMap(root['data']);
    final settings = _asMap(root['settings']);
    final dataSettings = _asMap(data['settings']);

    final candidates = [
      root['fintechControl'],
      data['fintechControl'],
      settings['fintechControl'],
      dataSettings['fintechControl'],
      root['data'],
      root,
    ];

    for (final candidate in candidates) {
      final map = _asMap(candidate);

      if (map.isNotEmpty &&
          (map.containsKey('maintenance') ||
              map.containsKey('serviceLimits') ||
              map.containsKey('transactionFees') ||
              map.containsKey('legalPolicies') ||
              map.containsKey('tier1Daily') ||
              map.containsKey('customerAppEnabled'))) {
        return map;
      }
    }

    return <String, dynamic>{};
  }

  bool _boolValue(dynamic value, bool fallback) {
    if (value is bool) return value;

    final text = value?.toString().trim().toLowerCase();

    if (text == 'true' || text == '1' || text == 'yes' || text == 'on') {
      return true;
    }

    if (text == 'false' || text == '0' || text == 'no' || text == 'off') {
      return false;
    }

    return fallback;
  }

  String _text(dynamic value) {
    if (value == null) return '';

    if (value is num) {
      if (value is double && value == value.roundToDouble()) {
        return value.toInt().toString();
      }
      return value.toString();
    }

    return value.toString();
  }

  void _setText(String key, dynamic value) {
    final controller = _c[key];

    if (controller == null) return;

    controller.text = _text(value);
  }

  dynamic _readNested(
    Map<String, dynamic> root,
    String group,
    List<String> keys,
  ) {
    final nested = _asMap(root[group]);

    return _firstNonNull([
      for (final key in keys) nested[key],
      for (final key in keys) root[key],
    ]);
  }

  void _applyServerState(Map<String, dynamic> fc) {
    final maintenance = _asMap(fc['maintenance']);
    final limits = _asMap(fc['serviceLimits']);
    final fees = _asMap(fc['transactionFees']);
    final legal = _asMap(fc['legalPolicies']);

    _maintenanceEnabled = _boolValue(
      _firstNonNull([
        maintenance['enabled'],
        fc['maintenanceEnabled'],
      ]),
      false,
    );

    _customerAppEnabled = _boolValue(
      _firstNonNull([
        maintenance['customerAppEnabled'],
        fc['customerAppEnabled'],
      ]),
      true,
    );

    _apiEnabled = _boolValue(
      _firstNonNull([
        maintenance['apiEnabled'],
        fc['apiEnabled'],
      ]),
      true,
    );

    _setText(
      'maintenanceMessage',
      _firstNonNull([
        maintenance['message'],
        fc['maintenanceMessage'],
      ]),
    );

    _setText(
      'scheduledStartAt',
      _firstNonNull([
        maintenance['scheduledStartAt'],
        maintenance['scheduledStart'],
        fc['scheduledStartAt'],
        fc['scheduledStart'],
      ]),
    );

    _setText(
      'scheduledEndAt',
      _firstNonNull([
        maintenance['scheduledEndAt'],
        maintenance['scheduledEnd'],
        fc['scheduledEndAt'],
        fc['scheduledEnd'],
      ]),
    );

    _setText(
      'tier1Daily',
      _firstNonNull([
        limits['tier1Daily'],
        fc['tier1Daily'],
      ]),
    );

    _setText(
      'tier1PerTransaction',
      _firstNonNull([
        limits['tier1PerTransaction'],
        fc['tier1PerTransaction'],
      ]),
    );

    _setText(
      'tier2Daily',
      _firstNonNull([
        limits['tier2Daily'],
        fc['tier2Daily'],
      ]),
    );

    _setText(
      'tier2PerTransaction',
      _firstNonNull([
        limits['tier2PerTransaction'],
        fc['tier2PerTransaction'],
      ]),
    );

    _setText(
      'tier3Daily',
      _firstNonNull([
        limits['tier3Daily'],
        fc['tier3Daily'],
      ]),
    );

    _setText(
      'tier3PerTransaction',
      _firstNonNull([
        limits['tier3PerTransaction'],
        fc['tier3PerTransaction'],
      ]),
    );

    _setText(
      'servicepayTransferLimit',
      _firstNonNull([
        limits['servicepayTransfer'],
        limits['servicePayTransfer'],
        limits['servicepayTransferLimit'],
        limits['servicePayTransferLimit'],
        fc['servicepayTransferLimit'],
        fc['servicePayTransferLimit'],
        fc['dailyServicepayTransferLimit'],
        fc['dailyServicePayTransferLimit'],
      ]),
    );

    _setText(
      'bankTransferLimit',
      _firstNonNull([
        limits['bankTransfer'],
        limits['bankTransferLimit'],
        fc['bankTransferLimit'],
        fc['maximumBankTransfer'],
        fc['dailyBankTransferLimit'],
      ]),
    );

    _setText(
      'walletFundingLimit',
      _firstNonNull([
        limits['walletFunding'],
        limits['walletFundingLimit'],
        fc['walletFundingLimit'],
      ]),
    );

    _setText(
      'withdrawalLimit',
      _firstNonNull([
        limits['withdrawal'],
        limits['withdrawalLimit'],
        fc['withdrawalLimit'],
      ]),
    );

    _setText(
      'servicepayTransferFee',
      _firstNonNull([
        fees['servicepayTransfer'],
        fees['servicePayTransfer'],
        fc['servicepayTransferFee'],
        fc['servicePayTransferFee'],
      ]),
    );

    _setText(
      'bankTransferFee',
      _firstNonNull([
        fees['bankTransfer'],
        fc['bankTransferFee'],
      ]),
    );

    _setText(
      'walletFundingFee',
      _firstNonNull([
        fees['walletFunding'],
        fc['walletFundingFee'],
      ]),
    );

    _setText(
      'withdrawalFee',
      _firstNonNull([
        fees['withdrawal'],
        fc['withdrawalFee'],
      ]),
    );

    _setText(
      'merchantPaymentFee',
      _firstNonNull([
        fees['merchantPayment'],
        fc['merchantPaymentFee'],
      ]),
    );

    _setText(
      'airtimeFee',
      _firstNonNull([
        fees['airtime'],
        fc['airtimeFee'],
      ]),
    );

    _setText(
      'dataFee',
      _firstNonNull([
        fees['data'],
        fc['dataFee'],
      ]),
    );

    _setText(
      'privacyPolicyUrl',
      _firstNonNull([
        legal['privacyPolicyUrl'],
        legal['privacyPolicyURL'],
        fc['privacyPolicyUrl'],
        fc['privacyPolicyURL'],
      ]),
    );

    _setText(
      'termsUrl',
      _firstNonNull([
        legal['termsUrl'],
        legal['termsURL'],
        legal['termsAndConditionsUrl'],
        fc['termsUrl'],
        fc['termsURL'],
        fc['termsAndConditionsUrl'],
      ]),
    );

    _setText(
      'kycAmlPolicyUrl',
      _firstNonNull([
        legal['kycAmlPolicyUrl'],
        legal['kycAMLPolicyUrl'],
        fc['kycAmlPolicyUrl'],
        fc['kycAMLPolicyUrl'],
      ]),
    );

    _setText(
      'complaintsPolicyUrl',
      _firstNonNull([
        legal['complaintsPolicyUrl'],
        fc['complaintsPolicyUrl'],
      ]),
    );

    _setText(
      'dataProtectionPolicyUrl',
      _firstNonNull([
        legal['dataProtectionPolicyUrl'],
        fc['dataProtectionPolicyUrl'],
      ]),
    );
  }

  Future<Map<String, dynamic>> _fetch() async {
    final token = await _token();

    if (token.isEmpty) {
      throw Exception('Admin login token not found. Please login again.');
    }

    final response = await http.get(
      Uri.parse('$_baseUrl$_endpoint'),
      headers: _headers(token),
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
      final body = _asMap(decoded);

      throw Exception(
        body['message']?.toString() ?? 'GET failed (${response.statusCode})',
      );
    }

    return _extractFintechControl(decoded);
  }

  Future<void> _load({
    bool showLoading = true,
  }) async {
    if (mounted && showLoading) {
      setState(() {
        _loading = true;
        _error = null;
      });
    }

    try {
      final fc = await _fetch();

      if (!mounted) return;

      setState(() {
        _applyServerState(fc);
        _error = null;
        _loading = false;
      });
    } catch (error) {
      if (!mounted) return;

      setState(() {
        _loading = false;
        _error = error.toString().replaceFirst('Exception: ', '');
      });
    }
  }

  num? _number(String key) {
    final raw = _c[key]?.text.trim() ?? '';

    if (raw.isEmpty) return null;

    final cleaned =
        raw.replaceAll(',', '').replaceAll('₦', '').replaceAll('N', '').trim();

    final value = num.tryParse(cleaned);

    return value;
  }

  Map<String, dynamic> _buildFintechControl() {
    final maintenance = <String, dynamic>{
      'enabled': _maintenanceEnabled,
      'customerAppEnabled': _customerAppEnabled,
      'apiEnabled': _apiEnabled,
      'message': _c['maintenanceMessage']!.text.trim(),
      'scheduledStartAt': _c['scheduledStartAt']!.text.trim(),
      'scheduledEndAt': _c['scheduledEndAt']!.text.trim(),
    };

    final serviceLimits = <String, dynamic>{
      if (_number('tier1Daily') != null) 'tier1Daily': _number('tier1Daily'),
      if (_number('tier1PerTransaction') != null)
        'tier1PerTransaction': _number('tier1PerTransaction'),
      if (_number('tier2Daily') != null) 'tier2Daily': _number('tier2Daily'),
      if (_number('tier2PerTransaction') != null)
        'tier2PerTransaction': _number('tier2PerTransaction'),
      if (_number('tier3Daily') != null) 'tier3Daily': _number('tier3Daily'),
      if (_number('tier3PerTransaction') != null)
        'tier3PerTransaction': _number('tier3PerTransaction'),
      if (_number('servicepayTransferLimit') != null)
        'servicepayTransfer': _number('servicepayTransferLimit'),
      if (_number('bankTransferLimit') != null)
        'bankTransfer': _number('bankTransferLimit'),
      if (_number('walletFundingLimit') != null)
        'walletFunding': _number('walletFundingLimit'),
      if (_number('withdrawalLimit') != null)
        'withdrawal': _number('withdrawalLimit'),
    };

    final transactionFees = <String, dynamic>{
      if (_number('servicepayTransferFee') != null)
        'servicepayTransfer': _number('servicepayTransferFee'),
      if (_number('bankTransferFee') != null)
        'bankTransfer': _number('bankTransferFee'),
      if (_number('walletFundingFee') != null)
        'walletFunding': _number('walletFundingFee'),
      if (_number('withdrawalFee') != null)
        'withdrawal': _number('withdrawalFee'),
      if (_number('merchantPaymentFee') != null)
        'merchantPayment': _number('merchantPaymentFee'),
      if (_number('airtimeFee') != null) 'airtime': _number('airtimeFee'),
      if (_number('dataFee') != null) 'data': _number('dataFee'),
    };

    final legalPolicies = <String, dynamic>{
      'privacyPolicyUrl': _c['privacyPolicyUrl']!.text.trim(),
      'termsUrl': _c['termsUrl']!.text.trim(),
      'kycAmlPolicyUrl': _c['kycAmlPolicyUrl']!.text.trim(),
      'complaintsPolicyUrl': _c['complaintsPolicyUrl']!.text.trim(),
      'dataProtectionPolicyUrl': _c['dataProtectionPolicyUrl']!.text.trim(),
    };

    return {
      'maintenance': maintenance,
      'serviceLimits': serviceLimits,
      'transactionFees': transactionFees,
      'legalPolicies': legalPolicies,
    };
  }

  Future<bool> _sendPayload(
    Map<String, dynamic> payload,
  ) async {
    final token = await _token();

    final response = await http.put(
      Uri.parse('$_baseUrl$_endpoint'),
      headers: _headers(token),
      body: jsonEncode(payload),
    );

    if (response.statusCode >= 200 && response.statusCode < 300) {
      return true;
    }

    return false;
  }

  Future<void> _save() async {
    if (_saving) return;

    setState(() {
      _saving = true;
      _error = null;
    });

    try {
      final fc = _buildFintechControl();

      bool saved = await _sendPayload({
        'fintechControl': fc,
      });

      if (!saved) {
        saved = await _sendPayload(fc);
      }

      if (!saved) {
        saved = await _sendPayload({
          'settings': {
            'fintechControl': fc,
          },
        });
      }

      if (!saved) {
        throw Exception(
          'Backend rejected the configuration update.',
        );
      }

      // IMPORTANT:
      // Read the server again after save.
      // The UI therefore shows what the backend REALLY persisted,
      // not merely what was typed locally.
      final serverState = await _fetch();

      if (!mounted) return;

      setState(() {
        _applyServerState(serverState);
        _saving = false;
        _error = null;
      });

      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text(
            'Platform configuration saved and reloaded successfully.',
          ),
        ),
      );
    } catch (error) {
      if (!mounted) return;

      setState(() {
        _saving = false;
        _error = error.toString().replaceFirst('Exception: ', '');
      });
    }
  }

  InputDecoration _decoration(
    String label, {
    String? hint,
  }) {
    return InputDecoration(
      labelText: label,
      hintText: hint,
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(14),
      ),
      contentPadding: const EdgeInsets.symmetric(
        horizontal: 16,
        vertical: 16,
      ),
    );
  }

  Widget _numberField(
    String key,
    String label,
  ) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: TextField(
        controller: _c[key],
        keyboardType: const TextInputType.numberWithOptions(
          decimal: true,
        ),
        decoration: _decoration(label),
      ),
    );
  }

  Widget _textField(
    String key,
    String label, {
    int maxLines = 1,
  }) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: TextField(
        controller: _c[key],
        maxLines: maxLines,
        decoration: _decoration(label),
      ),
    );
  }

  Widget _switchTile({
    required String title,
    required String subtitle,
    required bool value,
    required ValueChanged<bool> onChanged,
  }) {
    return SwitchListTile(
      contentPadding: EdgeInsets.zero,
      title: Text(
        title,
        style: const TextStyle(
          fontWeight: FontWeight.w700,
        ),
      ),
      subtitle: Text(subtitle),
      value: value,
      onChanged: onChanged,
    );
  }

  Widget _sectionHeader(
    IconData icon,
    String title,
    String subtitle,
  ) {
    return Padding(
      padding: const EdgeInsets.only(
        bottom: 18,
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(
            icon,
            color: const Color(0xFF08783E),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: const TextStyle(
                    fontSize: 18,
                    fontWeight: FontWeight.w800,
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
    );
  }

  Widget _maintenance() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _sectionHeader(
          Icons.engineering_outlined,
          'Maintenance Mode',
          'Control ServicePay customer access and API availability.',
        ),
        _switchTile(
          title: 'Global Maintenance',
          subtitle: 'Enable maintenance mode for the platform.',
          value: _maintenanceEnabled,
          onChanged: (value) {
            setState(() {
              _maintenanceEnabled = value;
            });
          },
        ),
        _switchTile(
          title: 'Customer App Enabled',
          subtitle: 'Allow customers to use ServicePay.',
          value: _customerAppEnabled,
          onChanged: (value) {
            setState(() {
              _customerAppEnabled = value;
            });
          },
        ),
        _switchTile(
          title: 'API Enabled',
          subtitle: 'Allow normal ServicePay API operations.',
          value: _apiEnabled,
          onChanged: (value) {
            setState(() {
              _apiEnabled = value;
            });
          },
        ),
        const SizedBox(height: 8),
        _textField(
          'maintenanceMessage',
          'Maintenance Message',
          maxLines: 3,
        ),
        _textField(
          'scheduledStartAt',
          'Scheduled Start',
        ),
        _textField(
          'scheduledEndAt',
          'Scheduled End',
        ),
      ],
    );
  }

  Widget _serviceLimits() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _sectionHeader(
          Icons.speed_outlined,
          'Service Limits',
          'Manage transaction and operational limits.',
        ),
        _numberField(
          'tier1Daily',
          'Tier 1 Daily',
        ),
        _numberField(
          'tier1PerTransaction',
          'Tier 1 Per Transaction',
        ),
        _numberField(
          'tier2Daily',
          'Tier 2 Daily',
        ),
        _numberField(
          'tier2PerTransaction',
          'Tier 2 Per Transaction',
        ),
        _numberField(
          'tier3Daily',
          'Tier 3 Daily',
        ),
        _numberField(
          'tier3PerTransaction',
          'Tier 3 Per Transaction',
        ),
        _numberField(
          'servicepayTransferLimit',
          'ServicePay Transfer',
        ),
        _numberField(
          'bankTransferLimit',
          'Bank Transfer',
        ),
        _numberField(
          'walletFundingLimit',
          'Wallet Funding',
        ),
        _numberField(
          'withdrawalLimit',
          'Withdrawal',
        ),
      ],
    );
  }

  Widget _transactionFees() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _sectionHeader(
          Icons.price_change_outlined,
          'Transaction Fees',
          'Central fee administration for ServicePay products.',
        ),
        _numberField(
          'servicepayTransferFee',
          'ServicePay Transfer',
        ),
        _numberField(
          'bankTransferFee',
          'Bank Transfer',
        ),
        _numberField(
          'walletFundingFee',
          'Wallet Funding',
        ),
        _numberField(
          'withdrawalFee',
          'Withdrawal',
        ),
        _numberField(
          'merchantPaymentFee',
          'Merchant Payment',
        ),
        _numberField(
          'airtimeFee',
          'Airtime',
        ),
        _numberField(
          'dataFee',
          'Data',
        ),
      ],
    );
  }

  Widget _legalPolicies() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _sectionHeader(
          Icons.gavel_outlined,
          'Legal & Policies',
          'Manage ServicePay policy document URLs.',
        ),
        _textField(
          'privacyPolicyUrl',
          'Privacy Policy URL',
        ),
        _textField(
          'termsUrl',
          'Terms URL',
        ),
        _textField(
          'kycAmlPolicyUrl',
          'KYC / AML Policy URL',
        ),
        _textField(
          'complaintsPolicyUrl',
          'Complaints Policy URL',
        ),
        _textField(
          'dataProtectionPolicyUrl',
          'Data Protection Policy URL',
        ),
      ],
    );
  }

  Widget _activeSection() {
    switch (_section) {
      case 'Service Limits':
        return _serviceLimits();

      case 'Transaction Fees':
        return _transactionFees();

      case 'Legal & Policies':
        return _legalPolicies();

      default:
        return _maintenance();
    }
  }

  @override
  Widget build(BuildContext context) {
    const green = Color(0xFF08783E);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Platform Configuration'),
        backgroundColor: Colors.white,
        foregroundColor: Colors.black87,
        elevation: 0,
        actions: [
          IconButton(
            tooltip: 'Reload configuration',
            onPressed: _loading || _saving ? null : () => _load(),
            icon: const Icon(Icons.refresh),
          ),
        ],
      ),
      backgroundColor: const Color(0xFFF7F9F8),
      body: _loading
          ? const Center(
              child: CircularProgressIndicator(),
            )
          : RefreshIndicator(
              onRefresh: () => _load(
                showLoading: false,
              ),
              child: ListView(
                padding: const EdgeInsets.all(18),
                children: [
                  Container(
                    padding: const EdgeInsets.all(18),
                    decoration: BoxDecoration(
                      color: green,
                      borderRadius: BorderRadius.circular(18),
                    ),
                    child: const Row(
                      children: [
                        Icon(
                          Icons.admin_panel_settings_outlined,
                          color: Colors.white,
                          size: 30,
                        ),
                        SizedBox(width: 12),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                'ServicePay Fintech Control',
                                style: TextStyle(
                                  color: Colors.white,
                                  fontSize: 18,
                                  fontWeight: FontWeight.w800,
                                ),
                              ),
                              SizedBox(height: 4),
                              Text(
                                'Live administration connected to the ServicePay backend.',
                                style: TextStyle(
                                  color: Colors.white70,
                                ),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 16),
                  SingleChildScrollView(
                    scrollDirection: Axis.horizontal,
                    child: Row(
                      children: _sections.map((section) {
                        final selected = section == _section;

                        return Padding(
                          padding: const EdgeInsets.only(right: 8),
                          child: ChoiceChip(
                            selected: selected,
                            label: Text(section),
                            avatar: selected
                                ? const Icon(
                                    Icons.check,
                                    size: 18,
                                  )
                                : null,
                            onSelected: (_) {
                              setState(() {
                                _section = section;
                              });
                            },
                          ),
                        );
                      }).toList(),
                    ),
                  ),
                  if (_error != null) ...[
                    const SizedBox(height: 14),
                    Container(
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(
                        color: Colors.red.shade50,
                        borderRadius: BorderRadius.circular(12),
                        border: Border.all(
                          color: Colors.red.shade200,
                        ),
                      ),
                      child: Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Icon(
                            Icons.error_outline,
                            color: Colors.red,
                          ),
                          const SizedBox(width: 8),
                          Expanded(
                            child: Text(
                              _error!,
                              style: const TextStyle(
                                color: Colors.red,
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                  const SizedBox(height: 18),
                  Container(
                    padding: const EdgeInsets.all(18),
                    decoration: BoxDecoration(
                      color: Colors.white,
                      borderRadius: BorderRadius.circular(18),
                      border: Border.all(
                        color: Colors.black12,
                      ),
                    ),
                    child: _activeSection(),
                  ),
                  const SizedBox(height: 18),
                  SizedBox(
                    height: 52,
                    child: ElevatedButton.icon(
                      onPressed: _saving ? null : _save,
                      icon: _saving
                          ? const SizedBox(
                              width: 20,
                              height: 20,
                              child: CircularProgressIndicator(
                                strokeWidth: 2,
                                color: Colors.white,
                              ),
                            )
                          : const Icon(Icons.save_outlined),
                      label: Text(
                        _saving
                            ? 'Saving & Verifying...'
                            : 'Save Configuration',
                      ),
                      style: ElevatedButton.styleFrom(
                        backgroundColor: green,
                        foregroundColor: Colors.white,
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(14),
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(height: 40),
                ],
              ),
            ),
    );
  }
}

import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

class PartnerApplicationScreen extends StatefulWidget {
  const PartnerApplicationScreen({super.key});

  @override
  State<PartnerApplicationScreen> createState() =>
      _PartnerApplicationScreenState();
}

class _PartnerApplicationScreenState extends State<PartnerApplicationScreen> {
  static const String baseUrl = 'https://api.servicepay.ng/api';
  static const Color _green = Color(0xFF08783E);

  final businessNameController = TextEditingController();
  final contactNameController = TextEditingController();
  final emailController = TextEditingController();
  final phoneController = TextEditingController();

  bool loading = true;
  bool submitting = false;
  bool actionLoading = false;
  bool showApiKey = false;
  String error = '';
  Map<String, dynamic>? application;
  Map<String, dynamic>? partner;
  List<dynamic> activity = [];

  String get applicationStatus =>
      (application?['status'] ?? 'NOT_APPLIED').toString().toUpperCase();

  String get partnerStatus =>
      (partner?['status'] ?? applicationStatus).toString().toUpperCase();

  bool get isApproved => applicationStatus == 'APPROVED' && partner != null;

  @override
  void initState() {
    super.initState();
    _loadPortal();
  }

  @override
  void dispose() {
    businessNameController.dispose();
    contactNameController.dispose();
    emailController.dispose();
    phoneController.dispose();
    super.dispose();
  }

  Future<String?> _token() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getString('auth_token') ?? prefs.getString('token');
  }

  Future<Map<String, String>> _headers() async {
    final token = await _token();
    if (token == null || token.isEmpty) {
      throw Exception('Please log in again to access Partner API.');
    }
    return {
      'Authorization': 'Bearer $token',
      'Accept': 'application/json',
      'Content-Type': 'application/json',
    };
  }

  Map<String, dynamic>? _mapFromResponse(dynamic decoded, String key) {
    if (decoded is! Map) return null;
    final value = decoded[key] ?? decoded['data'];
    return value is Map ? Map<String, dynamic>.from(value) : null;
  }

  String _message(dynamic decoded, String fallback) {
    if (decoded is Map) {
      final value = decoded['message'] ?? decoded['error'];
      if (value != null && value.toString().trim().isNotEmpty) {
        return value.toString();
      }
    }
    return fallback;
  }

  Future<void> _loadPortal() async {
    if (mounted) {
      setState(() {
        loading = true;
        error = '';
      });
    }
    try {
      final headers = await _headers();
      final appResponse = await http.get(
        Uri.parse('$baseUrl/partner-applications/my'),
        headers: headers,
      );
      dynamic appDecoded;
      try {
        appDecoded = jsonDecode(appResponse.body);
      } catch (_) {}

      Map<String, dynamic>? loadedApplication;
      if (appResponse.statusCode >= 200 && appResponse.statusCode < 300) {
        loadedApplication = _mapFromResponse(appDecoded, 'application');
        if (loadedApplication == null && appDecoded is Map) {
          loadedApplication = Map<String, dynamic>.from(appDecoded);
        }
      } else if (appResponse.statusCode != 404) {
        throw Exception(_message(appDecoded, 'Unable to load Partner API status.'));
      }

      Map<String, dynamic>? loadedPartner;
      List<dynamic> loadedActivity = [];
      if ((loadedApplication?['status'] ?? '').toString().toUpperCase() ==
          'APPROVED') {
        final results = await Future.wait([
          http.get(Uri.parse('$baseUrl/partner/me'), headers: headers),
          http.get(
            Uri.parse('$baseUrl/partner/me/transactions'),
            headers: headers,
          ),
        ]);
        final profileResponse = results[0];
        final activityResponse = results[1];
        dynamic profileDecoded;
        dynamic activityDecoded;
        try {
          profileDecoded = jsonDecode(profileResponse.body);
        } catch (_) {}
        try {
          activityDecoded = jsonDecode(activityResponse.body);
        } catch (_) {}
        if (profileResponse.statusCode >= 200 &&
            profileResponse.statusCode < 300) {
          loadedPartner = _mapFromResponse(profileDecoded, 'partner');
        } else if (profileResponse.statusCode != 404) {
          throw Exception(
            _message(profileDecoded, 'Unable to load developer dashboard.'),
          );
        }
        if (activityResponse.statusCode >= 200 &&
            activityResponse.statusCode < 300 &&
            activityDecoded is Map &&
            activityDecoded['transactions'] is List) {
          loadedActivity = List<dynamic>.from(activityDecoded['transactions']);
        }
      }
      if (!mounted) return;
      setState(() {
        application = loadedApplication;
        partner = loadedPartner;
        activity = loadedActivity;
      });
    } catch (exception) {
      if (mounted) setState(() => error = exception.toString().replaceFirst('Exception: ', ''));
    } finally {
      if (mounted) setState(() => loading = false);
    }
  }

  Future<void> _submit() async {
    final values = {
      'businessName': businessNameController.text.trim(),
      'contactName': contactNameController.text.trim(),
      'email': emailController.text.trim(),
      'phone': phoneController.text.trim(),
    };
    if (values.values.any((value) => value.isEmpty)) {
      _toast('Please complete all required business details.');
      return;
    }
    setState(() => submitting = true);
    try {
      final response = await http.post(
        Uri.parse('$baseUrl/partner-applications/apply'),
        headers: await _headers(),
        body: jsonEncode(values),
      );
      dynamic decoded;
      try {
        decoded = jsonDecode(response.body);
      } catch (_) {}
      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw Exception(_message(decoded, 'Unable to submit application.'));
      }
      businessNameController.clear();
      contactNameController.clear();
      emailController.clear();
      phoneController.clear();
      _toast(_message(decoded, 'Partner application submitted.'));
      await _loadPortal();
    } catch (exception) {
      _toast(exception.toString().replaceFirst('Exception: ', ''));
    } finally {
      if (mounted) setState(() => submitting = false);
    }
  }

  Future<void> _regenerateCredentials() async {
    final confirmed = await _confirm(
      title: 'Regenerate API credentials?',
      message:
          'Your current API key and secret will stop working immediately. Update your integration before sending new requests.',
      confirmText: 'Regenerate',
      destructive: true,
    );
    if (!confirmed) return;
    await _postPartnerAction(
      path: '/partner/me/regenerate-credentials',
      onSuccess: (decoded) async {
        final credentials = _mapFromResponse(decoded, 'credentials');
        if (credentials == null) {
          throw Exception('Credentials were not returned securely.');
        }
        if (!mounted) return;
        await _credentialsDialog(
          apiKey: (credentials['apiKey'] ?? '').toString(),
          apiSecret: (credentials['apiSecret'] ?? '').toString(),
        );
        await _loadPortal();
      },
    );
  }

  Future<void> _activateCredentials() async {
    final confirmed = await _confirm(
      title: 'Activate API credentials?',
      message:
          'Your API Key and one-time API Secret will be shown next. Save the secret securely before closing the dialog.',
      confirmText: 'Activate credentials',
    );
    if (!confirmed) return;
    await _postPartnerAction(
      path: '/partner/me/activate-credentials',
      onSuccess: (decoded) async {
        final credentials = _mapFromResponse(decoded, 'credentials');
        if (credentials == null) {
          throw Exception('Credentials were not returned securely.');
        }
        if (!mounted) return;
        await _credentialsDialog(
          apiKey: (credentials['apiKey'] ?? '').toString(),
          apiSecret: (credentials['apiSecret'] ?? '').toString(),
        );
        await _loadPortal();
      },
    );
  }

  Future<void> _revokeAccess() async {
    final confirmed = await _confirm(
      title: 'Revoke Partner API access?',
      message:
          'This immediately blocks all API credentials. Transaction history is retained, but only ServicePay Head Office can restore access.',
      confirmText: 'Revoke access',
      destructive: true,
    );
    if (!confirmed) return;
    await _postPartnerAction(
      path: '/partner/me/revoke',
      onSuccess: (_) async {
        _toast('Partner API access revoked.');
        await _loadPortal();
      },
    );
  }

  Future<void> _postPartnerAction({
    required String path,
    required Future<void> Function(dynamic decoded) onSuccess,
  }) async {
    setState(() => actionLoading = true);
    try {
      final response = await http.post(
        Uri.parse('$baseUrl$path'),
        headers: await _headers(),
        body: '{}',
      );
      dynamic decoded;
      try {
        decoded = jsonDecode(response.body);
      } catch (_) {}
      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw Exception(_message(decoded, 'Unable to complete this action.'));
      }
      await onSuccess(decoded);
    } catch (exception) {
      _toast(exception.toString().replaceFirst('Exception: ', ''));
    } finally {
      if (mounted) setState(() => actionLoading = false);
    }
  }

  Future<bool> _confirm({
    required String title,
    required String message,
    required String confirmText,
    bool destructive = false,
  }) async {
    return await showDialog<bool>(
          context: context,
          builder: (context) => AlertDialog(
            title: Text(title),
            content: Text(message),
            actions: [
              TextButton(
                onPressed: () => Navigator.pop(context, false),
                child: const Text('Cancel'),
              ),
              FilledButton(
                style: FilledButton.styleFrom(
                  backgroundColor: destructive ? const Color(0xFFB42318) : _green,
                ),
                onPressed: () => Navigator.pop(context, true),
                child: Text(confirmText),
              ),
            ],
          ),
        ) ??
        false;
  }

  Future<void> _credentialsDialog({
    required String apiKey,
    required String apiSecret,
  }) async {
    await showDialog<void>(
      context: context,
      barrierDismissible: false,
      builder: (context) => AlertDialog(
        title: const Row(
          children: [
            Icon(Icons.security_rounded, color: _green),
            SizedBox(width: 10),
            Expanded(child: Text('Save your API Secret')),
          ],
        ),
        content: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text(
                'This is the only time ServicePay will show this API Secret. Store it in a secure secret manager and never put it in a mobile app, browser code, URL, or public repository.',
                style: TextStyle(height: 1.45),
              ),
              const SizedBox(height: 18),
              _secretValue('API Key', apiKey),
              const SizedBox(height: 12),
              _secretValue('API Secret', apiSecret),
            ],
          ),
        ),
        actions: [
          TextButton.icon(
            onPressed: () => _copy('$apiKey\n$apiSecret', 'API key and secret copied.'),
            icon: const Icon(Icons.copy_all_rounded),
            label: const Text('Copy both'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('I saved it'),
          ),
        ],
      ),
    );
  }

  Widget _secretValue(String label, String value) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: const Color(0xFFF1F5F9),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label, style: const TextStyle(fontWeight: FontWeight.w800)),
          const SizedBox(height: 5),
          SelectableText(
            value,
            style: const TextStyle(fontFamily: 'monospace', fontSize: 12),
          ),
          Align(
            alignment: Alignment.centerRight,
            child: TextButton.icon(
              onPressed: () => _copy(value, '$label copied.'),
              icon: const Icon(Icons.copy_rounded, size: 17),
              label: const Text('Copy'),
            ),
          ),
        ],
      ),
    );
  }

  Future<void> _copy(String text, String message) async {
    await Clipboard.setData(ClipboardData(text: text));
    if (mounted) _toast(message);
  }

  void _toast(String message) {
    if (!mounted) return;
    ScaffoldMessenger.of(context)
      ..clearSnackBars()
      ..showSnackBar(SnackBar(content: Text(message)));
  }

  double _number(dynamic value) =>
      value is num ? value.toDouble() : double.tryParse('${value ?? 0}') ?? 0;

  String _money(dynamic value) => '₦${_number(value).toStringAsFixed(2)}';

  String _maskedKey(String key) {
    if (key.length <= 12) return '••••••••';
    return '${key.substring(0, 8)}••••••••${key.substring(key.length - 4)}';
  }

  Color _statusColor(String value) {
    switch (value) {
      case 'ACTIVE':
      case 'APPROVED':
      case 'SUCCESSFUL':
        return const Color(0xFF08783E);
      case 'PENDING':
      case 'PROCESSING':
        return const Color(0xFFB54708);
      case 'SUSPENDED':
      case 'REVOKED':
      case 'REJECTED':
      case 'REVERSED':
        return const Color(0xFFB42318);
      default:
        return const Color(0xFF475569);
    }
  }

  Widget _statusPill(String value) {
    final color = _statusColor(value);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.11),
        borderRadius: BorderRadius.circular(99),
      ),
      child: Text(
        value.replaceAll('_', ' '),
        style: TextStyle(color: color, fontSize: 11, fontWeight: FontWeight.w800),
      ),
    );
  }

  Widget _hero() {
    return Container(
      padding: const EdgeInsets.all(22),
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          colors: [Color(0xFF064E2A), Color(0xFF0F9D58)],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        borderRadius: BorderRadius.circular(24),
      ),
      child: const Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(Icons.developer_mode_rounded, size: 38, color: Colors.white),
          SizedBox(height: 13),
          Text(
            'ServicePay Developer Portal',
            style: TextStyle(color: Colors.white, fontSize: 22, fontWeight: FontWeight.w900),
          ),
          SizedBox(height: 8),
          Text(
            'Manage secure credentials, partner wallet limits and your live ServicePay API activity.',
            style: TextStyle(color: Colors.white, height: 1.45),
          ),
        ],
      ),
    );
  }

  Widget _metric(String label, String value, IconData icon) {
    return Container(
      width: 155,
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: const Color(0xFFE2E8F0)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, size: 20, color: _green),
          const SizedBox(height: 10),
          Text(label, style: const TextStyle(fontSize: 11, color: Color(0xFF64748B))),
          const SizedBox(height: 4),
          Text(value, style: const TextStyle(fontWeight: FontWeight.w900, color: Color(0xFF0F172A))),
        ],
      ),
    );
  }

  Widget _credentialsCard() {
    final apiKey = (partner?['apiKey'] ?? '').toString();
    final activationPending =
        partner?['initialCredentialDeliveryPending'] == true;
    return _card(
      title: 'API credentials',
      icon: Icons.key_rounded,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (activationPending) ...[
            const Text(
              'Your application is approved. Activate your credentials to receive your one-time API Secret.',
              style: TextStyle(height: 1.45, color: Color(0xFF475569)),
            ),
            const SizedBox(height: 12),
            FilledButton.icon(
              style: FilledButton.styleFrom(backgroundColor: _green),
              onPressed: actionLoading ? null : _activateCredentials,
              icon: const Icon(Icons.lock_open_rounded),
              label: const Text('Activate credentials'),
            ),
            const SizedBox(height: 8),
            const Text(
              'ServicePay will not display the API Secret again after this one-time secure delivery.',
              style: TextStyle(fontSize: 12, height: 1.4, color: Color(0xFF64748B)),
            ),
          ] else ...[
          const Text('API Key', style: TextStyle(fontSize: 12, color: Color(0xFF64748B), fontWeight: FontWeight.w700)),
          const SizedBox(height: 6),
          Container(
            width: double.infinity,
            padding: const EdgeInsets.fromLTRB(12, 9, 8, 9),
            decoration: BoxDecoration(
              color: const Color(0xFFF8FAFC),
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: const Color(0xFFE2E8F0)),
            ),
            child: Row(
              children: [
                Expanded(
                  child: SelectableText(
                    showApiKey ? apiKey : _maskedKey(apiKey),
                    style: const TextStyle(fontFamily: 'monospace', fontSize: 12, fontWeight: FontWeight.w700),
                  ),
                ),
                IconButton(
                  tooltip: showApiKey ? 'Hide API key' : 'Reveal API key',
                  onPressed: apiKey.isEmpty ? null : () => setState(() => showApiKey = !showApiKey),
                  icon: Icon(showApiKey ? Icons.visibility_off_rounded : Icons.visibility_rounded),
                ),
                IconButton(
                  tooltip: 'Copy API key',
                  onPressed: apiKey.isEmpty ? null : () => _copy(apiKey, 'API key copied.'),
                  icon: const Icon(Icons.copy_rounded),
                ),
              ],
            ),
          ),
          const SizedBox(height: 12),
          const Text(
            'Your API Secret is never stored in this portal. Regeneration immediately invalidates both current credentials.',
            style: TextStyle(fontSize: 12, height: 1.4, color: Color(0xFF64748B)),
          ),
          const SizedBox(height: 14),
          Wrap(
            spacing: 10,
            runSpacing: 10,
            children: [
              OutlinedButton.icon(
                onPressed: actionLoading || partnerStatus != 'ACTIVE' ? null : _regenerateCredentials,
                icon: const Icon(Icons.refresh_rounded),
                label: const Text('Regenerate'),
              ),
              TextButton.icon(
                style: TextButton.styleFrom(foregroundColor: const Color(0xFFB42318)),
                onPressed: actionLoading || partnerStatus != 'ACTIVE' ? null : _revokeAccess,
                icon: const Icon(Icons.block_rounded),
                label: const Text('Revoke access'),
              ),
            ],
          ),
          ],
        ],
      ),
    );
  }

  Widget _portalDashboard() {
    final permissions = partner?['permissions'] is List
        ? List<dynamic>.from(partner?['permissions'])
        : <dynamic>[];
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _card(
          title: 'Partner API status',
          icon: Icons.verified_user_rounded,
          trailing: _statusPill(partnerStatus),
          child: Text(
            partnerStatus == 'ACTIVE'
                ? 'Your live API access is active. Server-side permissions, wallet balance and limits apply to every request.'
                : partnerStatus == 'SUSPENDED'
                    ? 'Your API access is temporarily suspended. Contact ServicePay Head Office for a review.'
                    : 'Your API credentials no longer have access. Transaction history remains available for reconciliation.',
            style: const TextStyle(height: 1.45, color: Color(0xFF475569)),
          ),
        ),
        const SizedBox(height: 14),
        _credentialsCard(),
        const SizedBox(height: 14),
        const Text('Wallet & limits', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w900, color: Color(0xFF0F172A))),
        const SizedBox(height: 10),
        Wrap(
          spacing: 10,
          runSpacing: 10,
          children: [
            _metric('Partner wallet', _money(partner?['walletBalance']), Icons.account_balance_wallet_rounded),
            _metric('Daily remaining', _money(partner?['dailyRemaining']), Icons.today_rounded),
            _metric(
              'Per transaction',
              partner?['perTransactionLimit'] == null ? 'Not set' : _money(partner?['perTransactionLimit']),
              Icons.shield_rounded,
            ),
            _metric('Daily limit', _money(partner?['dailyLimit']), Icons.speed_rounded),
          ],
        ),
        const SizedBox(height: 14),
        _card(
          title: 'Approved live services',
          icon: Icons.rocket_launch_rounded,
          child: permissions.isEmpty
              ? const Text('No live services are assigned yet. ServicePay Head Office must assign a supported service before you can make API requests.', style: TextStyle(height: 1.45, color: Color(0xFF64748B)))
              : Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: permissions
                      .map((permission) => Chip(
                            avatar: const Icon(Icons.check_circle_rounded, color: _green, size: 18),
                            label: Text(permission.toString()),
                          ))
                      .toList(),
                ),
        ),
        const SizedBox(height: 14),
        _documentationCard(),
        const SizedBox(height: 14),
        _activityCard(),
      ],
    );
  }

  Widget _documentationCard() {
    return _card(
      title: 'Live API documentation',
      icon: Icons.menu_book_rounded,
      child: const Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Authentication', style: TextStyle(fontWeight: FontWeight.w900)),
          SizedBox(height: 5),
          SelectableText(
            'X-API-Key: sp_live_...\\nX-API-Secret: your secret\\nIdempotency-Key: a unique value per purchase',
            style: TextStyle(fontFamily: 'monospace', fontSize: 12, height: 1.5),
          ),
          SizedBox(height: 13),
          Text('Supported endpoints', style: TextStyle(fontWeight: FontWeight.w900)),
          SizedBox(height: 5),
          Text('GET  /api/partner/profile\\nGET  /api/partner/balance\\nGET  /api/partner/transactions\\nGET  /api/partner/data-plans/:network  (DATA)\\nPOST /api/partner/airtime  (AIRTIME)\\nPOST /api/partner/data  (DATA)', style: TextStyle(fontFamily: 'monospace', fontSize: 12, height: 1.55)),
          SizedBox(height: 13),
          Text('Airtime body: network, phone, amount. Data body: network, phone, planCode. Every purchase requires an Idempotency-Key and is restricted by your wallet, permissions, daily and per-transaction limits.', style: TextStyle(fontSize: 12, height: 1.45, color: Color(0xFF64748B))),
          SizedBox(height: 12),
          Text('Airtime request example', style: TextStyle(fontWeight: FontWeight.w900)),
          SizedBox(height: 5),
          SelectableText('POST /api/partner/airtime\\n{ "network": "MTN", "phone": "08030000000", "amount": 100 }', style: TextStyle(fontFamily: 'monospace', fontSize: 11, height: 1.45)),
          SizedBox(height: 10),
          Text('Data request example', style: TextStyle(fontWeight: FontWeight.w900)),
          SizedBox(height: 5),
          SelectableText('POST /api/partner/data\\n{ "network": "MTN", "phone": "08030000000", "planCode": "provider-plan-code" }', style: TextStyle(fontFamily: 'monospace', fontSize: 11, height: 1.45)),
        ],
      ),
    );
  }

  Widget _activityCard() {
    return _card(
      title: 'Recent API activity',
      icon: Icons.history_rounded,
      child: activity.isEmpty
          ? const Text('No Partner API requests yet. Successful and reversed requests will appear here.', style: TextStyle(color: Color(0xFF64748B)))
          : Column(
              children: activity.take(8).map((item) {
                final map = item is Map ? Map<String, dynamic>.from(item) : <String, dynamic>{};
                final status = (map['status'] ?? 'UNKNOWN').toString().toUpperCase();
                return Padding(
                  padding: const EdgeInsets.only(bottom: 10),
                  child: Row(
                    children: [
                      CircleAvatar(
                        backgroundColor: _statusColor(status).withValues(alpha: 0.12),
                        foregroundColor: _statusColor(status),
                        child: Icon(status == 'SUCCESSFUL' ? Icons.check_rounded : Icons.sync_rounded),
                      ),
                      const SizedBox(width: 10),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text('${map['service'] ?? 'API request'} · ${_money(map['amount'])}', style: const TextStyle(fontWeight: FontWeight.w800)),
                            const SizedBox(height: 2),
                            Text((map['reference'] ?? '').toString(), style: const TextStyle(fontFamily: 'monospace', fontSize: 10, color: Color(0xFF64748B))),
                          ],
                        ),
                      ),
                      _statusPill(status),
                    ],
                  ),
                );
              }).toList(),
            ),
    );
  }

  Widget _card({
    required String title,
    required IconData icon,
    required Widget child,
    Widget? trailing,
  }) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(17),
      decoration: BoxDecoration(
        color: Colors.white,
        border: Border.all(color: const Color(0xFFE2E8F0)),
        borderRadius: BorderRadius.circular(18),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(icon, color: _green),
              const SizedBox(width: 8),
              Expanded(child: Text(title, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w900, color: Color(0xFF0F172A)))),
              if (trailing != null) trailing,
            ],
          ),
          const SizedBox(height: 14),
          child,
        ],
      ),
    );
  }

  Widget _applicationCard() {
    final color = _statusColor(applicationStatus);
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(17),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.07),
        border: Border.all(color: color.withValues(alpha: 0.22)),
        borderRadius: BorderRadius.circular(18),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(children: [Icon(Icons.assignment_turned_in_rounded, color: color), const SizedBox(width: 8), Expanded(child: Text('Application status', style: TextStyle(fontWeight: FontWeight.w900, color: color))), _statusPill(applicationStatus)]),
          const SizedBox(height: 10),
          Text(
            applicationStatus == 'PENDING'
                ? 'ServicePay Head Office is reviewing your application. API credentials cannot be used until approval.'
                : 'This application was not approved. Contact ServicePay support if you need clarification before applying again.',
            style: const TextStyle(height: 1.45, color: Color(0xFF475569)),
          ),
        ],
      ),
    );
  }

  Widget _applicationForm() {
    return _card(
      title: 'Partner application',
      icon: Icons.handshake_rounded,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('Submit your business details for Head Office review before credentials and service permissions are issued.', style: TextStyle(height: 1.45, color: Color(0xFF64748B))),
          const SizedBox(height: 16),
          _field(businessNameController, 'Business / Company name', Icons.business_rounded),
          _field(contactNameController, 'Contact person', Icons.person_rounded),
          _field(emailController, 'Business email', Icons.email_rounded, keyboardType: TextInputType.emailAddress),
          _field(phoneController, 'Phone number', Icons.phone_rounded, keyboardType: TextInputType.phone),
          const SizedBox(height: 4),
          SizedBox(
            width: double.infinity,
            height: 50,
            child: FilledButton.icon(
              style: FilledButton.styleFrom(backgroundColor: _green),
              onPressed: submitting ? null : _submit,
              icon: submitting ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white)) : const Icon(Icons.send_rounded),
              label: Text(submitting ? 'Submitting...' : 'Submit application'),
            ),
          ),
        ],
      ),
    );
  }

  Widget _field(
    TextEditingController controller,
    String label,
    IconData icon, {
    TextInputType? keyboardType,
  }) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: TextField(
        controller: controller,
        keyboardType: keyboardType,
        decoration: InputDecoration(
          labelText: label,
          prefixIcon: Icon(icon),
          filled: true,
          fillColor: const Color(0xFFF8FAFC),
          border: OutlineInputBorder(borderRadius: BorderRadius.circular(14), borderSide: const BorderSide(color: Color(0xFFE2E8F0))),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF8FAFC),
      appBar: AppBar(
        title: const Text('Partner API'),
        backgroundColor: _green,
        foregroundColor: Colors.white,
        actions: [
          IconButton(onPressed: loading ? null : _loadPortal, icon: const Icon(Icons.refresh_rounded), tooltip: 'Refresh'),
        ],
      ),
      body: loading
          ? const Center(child: CircularProgressIndicator())
          : RefreshIndicator(
              onRefresh: _loadPortal,
              child: ListView(
                padding: const EdgeInsets.all(18),
                children: [
                  _hero(),
                  const SizedBox(height: 16),
                  if (error.isNotEmpty) ...[
                    Container(
                      padding: const EdgeInsets.all(14),
                      decoration: BoxDecoration(color: const Color(0xFFFFF3F2), borderRadius: BorderRadius.circular(14)),
                      child: Text(error, style: const TextStyle(color: Color(0xFFB42318))),
                    ),
                    const SizedBox(height: 14),
                  ],
                  if (isApproved) _portalDashboard() else ...[
                    if (application != null) ...[
                      _applicationCard(),
                      const SizedBox(height: 14),
                    ],
                    if (application == null || applicationStatus == 'REJECTED') _applicationForm(),
                  ],
                  const SizedBox(height: 28),
                ],
              ),
            ),
    );
  }
}
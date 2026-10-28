import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;

import 'services/session_store.dart';

class CustomerProfileEditSheet extends StatefulWidget {
  const CustomerProfileEditSheet({
    super.key,
    required this.user,
    required this.client,
    required this.baseUrl,
  });

  final Map<String, dynamic> user;
  final http.Client client;
  final String baseUrl;

  @override
  State<CustomerProfileEditSheet> createState() =>
      _CustomerProfileEditSheetState();
}

class _CustomerProfileEditSheetState extends State<CustomerProfileEditSheet> {
  final _formKey = GlobalKey<FormState>();
  late final Map<String, TextEditingController> _fields;
  final _password = TextEditingController();
  final Map<String, String> _challengeIds = {};
  final Map<String, TextEditingController> _newCodes = {};
  final Map<String, TextEditingController> _approvalCodes = {};
  final Map<String, DateTime> _expiresAt = {};
  final Set<String> _requesting = {};
  final Map<String, Timer> _timers = {};
  final Map<String, int> _remaining = {};
  bool _saving = false;
  String? _error;

  static const _green = Color(0xFF08783E);

  @override
  void initState() {
    super.initState();
    String value(String key) => widget.user[key]?.toString() ?? '';
    _fields = {
      'fullName': TextEditingController(text: value('fullName')),
      'phone': TextEditingController(text: value('phone')),
      'email': TextEditingController(text: value('email')),
      'address': TextEditingController(text: value('address')),
      'state': TextEditingController(text: value('state')),
      'lga': TextEditingController(text: value('lga')),
      'zone': TextEditingController(text: value('zone')),
    };
    for (final field in ['email', 'phone']) {
      _newCodes[field] = TextEditingController();
      _approvalCodes[field] = TextEditingController();
      _fields[field]!.addListener(() {
        _clearChallengeIfValueChanged(field);
        if (mounted) setState(() {});
      });
    }
  }

  @override
  void dispose() {
    for (final controller in _fields.values) {
      controller.dispose();
    }
    _password.dispose();
    for (final controller in _newCodes.values) {
      controller.dispose();
    }
    for (final controller in _approvalCodes.values) {
      controller.dispose();
    }
    for (final timer in _timers.values) {
      timer.cancel();
    }
    super.dispose();
  }

  String _original(String field) =>
      (widget.user[field] ?? '').toString().trim();
  String _value(String field) => _fields[field]!.text.trim();
  bool _changed(String field) =>
      _value(field).toLowerCase() != _original(field).toLowerCase();

  void _clearChallengeIfValueChanged(String field) {
    if (!_challengeIds.containsKey(field) ||
        _value(field).toLowerCase() == _requestedValue(field).toLowerCase()) {
      return;
    }
    setState(() {
      _challengeIds.remove(field);
      _requestedValues.remove(field);
      _newCodes[field]!.clear();
      _approvalCodes[field]!.clear();
      _expiresAt.remove(field);
      _remaining.remove(field);
      _timers.remove(field)?.cancel();
    });
  }

  final Map<String, String> _requestedValues = {};
  String _requestedValue(String field) => _requestedValues[field] ?? '';

  Map<String, dynamic> _decode(String body) {
    try {
      final decoded = jsonDecode(body);
      return decoded is Map ? Map<String, dynamic>.from(decoded) : {};
    } catch (_) {
      return {};
    }
  }

  String _message(Map<String, dynamic> data, String fallback) =>
      (data['message'] ?? data['error'] ?? fallback).toString();

  Future<String> _token() async {
    final token = await SessionStore.readToken();
    if (token == null || token.trim().isEmpty) {
      throw StateError('Your login session has expired. Please sign in again.');
    }
    return token;
  }

  Future<void> _requestCode(String field) async {
    final other = field == 'email' ? 'phone' : 'email';
    if (_changed(other)) {
      setState(() => _error =
          'Change and save one contact method at a time. Update $other after this change is complete.');
      return;
    }
    final value = _value(field);
    if (value.isEmpty || _password.text.isEmpty) {
      setState(() => _error =
          'Enter the new ${field == 'email' ? 'email address' : 'phone number'} and your current password first.');
      return;
    }
    setState(() {
      _requesting.add(field);
      _error = null;
    });
    try {
      final token = await _token();
      final response = await widget.client
          .post(
            Uri.parse('${widget.baseUrl}/auth/profile/contact/request'),
            headers: {
              'Accept': 'application/json',
              'Content-Type': 'application/json',
              'Authorization': 'Bearer $token',
            },
            body: jsonEncode({
              'field': field,
              'value': value,
              'currentPassword': _password.text,
            }),
          )
          .timeout(const Duration(seconds: 30));
      final body = _decode(response.body);
      final data = body['data'];
      final challengeId = data is Map ? data['challengeId']?.toString() : null;
      if (response.statusCode < 200 ||
          response.statusCode >= 300 ||
          body['success'] != true ||
          challengeId == null ||
          challengeId.isEmpty) {
        throw Exception(_message(body, 'Unable to send verification codes.'));
      }
      final seconds = data is Map
          ? int.tryParse('${data['expiresInSeconds'] ?? 600}') ?? 600
          : 600;
      _timers.remove(field)?.cancel();
      setState(() {
        _challengeIds[field] = challengeId;
        _requestedValues[field] = value;
        _expiresAt[field] = DateTime.now().add(Duration(seconds: seconds));
        _remaining[field] = seconds;
        _newCodes[field]!.clear();
        _approvalCodes[field]!.clear();
      });
      _timers[field] = Timer.periodic(const Duration(seconds: 1), (timer) {
        if (!mounted) return timer.cancel();
        final remaining =
            _expiresAt[field]!.difference(DateTime.now()).inSeconds;
        setState(() => _remaining[field] = remaining.clamp(0, seconds));
        if (remaining <= 0) timer.cancel();
      });
    } catch (error) {
      if (mounted) {
        setState(() => _error = error
            .toString()
            .replaceFirst('Exception: ', '')
            .replaceFirst('Bad state: ', ''));
      }
    } finally {
      if (mounted) setState(() => _requesting.remove(field));
    }
  }

  Future<void> _save() async {
    if (!_formKey.currentState!.validate()) return;
    if (_changed('email') && _changed('phone')) {
      setState(() => _error =
          'Change and save one contact method at a time. Save either phone or email, then edit the other.');
      return;
    }
    for (final field in ['email', 'phone']) {
      if (_changed(field) && !_challengeIds.containsKey(field)) {
        setState(() => _error =
            'Request and enter both verification codes for your changed $field.');
        return;
      }
      if (_changed(field) &&
          ((_remaining[field] ?? 0) <= 0 ||
              _newCodes[field]!.text.trim().isEmpty ||
              _approvalCodes[field]!.text.trim().isEmpty)) {
        setState(() => _error =
            'Both current-contact approval and new-contact codes are required for $field.');
        return;
      }
    }
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      final token = await _token();
      final contactVerifications = <String, dynamic>{};
      for (final field in ['email', 'phone']) {
        if (_changed(field)) {
          contactVerifications[field] = {
            'challengeId': _challengeIds[field],
            'code': _newCodes[field]!.text.trim(),
            'approvalCode': _approvalCodes[field]!.text.trim(),
          };
        }
      }
      final response = await widget.client
          .put(
            Uri.parse('${widget.baseUrl}/auth/profile'),
            headers: {
              'Accept': 'application/json',
              'Content-Type': 'application/json',
              'Authorization': 'Bearer $token',
            },
            body: jsonEncode({
              for (final entry in _fields.entries)
                entry.key: entry.value.text.trim(),
              if (contactVerifications.isNotEmpty)
                'contactVerifications': contactVerifications,
            }),
          )
          .timeout(const Duration(seconds: 30));
      final body = _decode(response.body);
      if (response.statusCode < 200 ||
          response.statusCode >= 300 ||
          body['success'] == false) {
        throw Exception(_message(body, 'Unable to update profile.'));
      }
      final data = body['data'];
      final requiresLogin = data is Map && data['requiresLogin'] == true;
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(requiresLogin
                ? 'Contact updated. Please sign in again to continue.'
                : 'Profile updated successfully.'),
            backgroundColor: _green,
          ),
        );
        if (requiresLogin) {
          await Future<void>.delayed(const Duration(milliseconds: 900));
        }
        if (mounted) {
          Navigator.of(context).pop(requiresLogin ? 'requiresLogin' : true);
        }
      }
    } catch (error) {
      if (mounted) {
        setState(() => _error = error
            .toString()
            .replaceFirst('Exception: ', '')
            .replaceFirst('Bad state: ', ''));
      }
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Widget _textField(String key, String label, IconData icon,
      {TextInputType keyboard = TextInputType.text,
      String? Function(String?)? validator}) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: TextFormField(
        controller: _fields[key],
        keyboardType: keyboard,
        textCapitalization:
            key == 'email' ? TextCapitalization.none : TextCapitalization.words,
        decoration: InputDecoration(
          labelText: label,
          prefixIcon: Icon(icon),
          border: OutlineInputBorder(borderRadius: BorderRadius.circular(13)),
        ),
        validator: validator,
      ),
    );
  }

  Widget _contactVerification(String field) {
    if (!_changed(field)) return const SizedBox.shrink();
    final requested = _challengeIds.containsKey(field);
    final label = field == 'email' ? 'email address' : 'phone number';
    return Container(
      margin: const EdgeInsets.only(bottom: 14),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: const Color(0xFFF1F7F3),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: const Color(0xFFD7E8DD)),
      ),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text('Verify your new $label',
            style: const TextStyle(fontWeight: FontWeight.w800)),
        const SizedBox(height: 5),
        Text(requested
            ? 'One code was sent to the new contact and a separate approval code to your existing contact. ${(_remaining[field] ?? 0) > 0 ? 'Expires in ${_remaining[field]}s.' : 'Codes expired; resend to continue.'}'
            : 'We will send one code to the new contact and a separate approval code to your existing contact.'),
        const SizedBox(height: 10),
        TextField(
          controller: _newCodes[field],
          keyboardType: TextInputType.number,
          decoration: InputDecoration(
            labelText: 'Code sent to new $label',
            border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
          ),
        ),
        const SizedBox(height: 9),
        TextField(
          controller: _approvalCodes[field],
          keyboardType: TextInputType.number,
          decoration: InputDecoration(
            labelText: 'Approval code sent to existing contact',
            border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
          ),
        ),
        const SizedBox(height: 8),
        Align(
          alignment: Alignment.centerRight,
          child: TextButton.icon(
            onPressed:
                _requesting.contains(field) ? null : () => _requestCode(field),
            icon: _requesting.contains(field)
                ? const SizedBox(
                    width: 16,
                    height: 16,
                    child: CircularProgressIndicator(strokeWidth: 2))
                : Icon(requested ? Icons.refresh_rounded : Icons.send_rounded),
            label: Text(requested ? 'Resend codes' : 'Send verification codes'),
          ),
        ),
      ]),
    );
  }

  @override
  Widget build(BuildContext context) => Container(
        padding: EdgeInsets.fromLTRB(
            18, 18, 18, MediaQuery.of(context).viewInsets.bottom + 20),
        decoration: const BoxDecoration(
          color: Color(0xFFFCFDFC),
          borderRadius: BorderRadius.vertical(top: Radius.circular(26)),
        ),
        child: SafeArea(
          top: false,
          child: Form(
            key: _formKey,
            child: SingleChildScrollView(
              child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Center(
                        child: Container(
                            width: 44,
                            height: 5,
                            decoration: BoxDecoration(
                                color: Colors.black12,
                                borderRadius: BorderRadius.circular(8)))),
                    const SizedBox(height: 18),
                    const Text('Edit Profile',
                        style: TextStyle(
                            fontSize: 23, fontWeight: FontWeight.w900)),
                    const SizedBox(height: 5),
                    const Text(
                        'Your wallet and verified identity details stay protected.',
                        style: TextStyle(color: Color(0xFF65736A))),
                    if (_changed('email') && _changed('phone')) ...[
                      const SizedBox(height: 12),
                      Container(
                        width: double.infinity,
                        padding: const EdgeInsets.all(12),
                        decoration: BoxDecoration(
                          color: const Color(0xFFFFF7E8),
                          borderRadius: BorderRadius.circular(12),
                        ),
                        child: const Text(
                          'For account safety, change and save one contact method at a time. Save phone or email first, then return to update the other.',
                        ),
                      ),
                    ],
                    if (_changed('email') || _changed('phone')) ...[
                      const SizedBox(height: 12),
                      TextField(
                        controller: _password,
                        obscureText: true,
                        decoration: InputDecoration(
                          labelText:
                              'Current password (required for contact changes)',
                          prefixIcon: const Icon(Icons.lock_outline_rounded),
                          border: OutlineInputBorder(
                            borderRadius: BorderRadius.circular(13),
                          ),
                        ),
                      ),
                    ],
                    const SizedBox(height: 18),
                    _textField(
                        'fullName', 'Full Name', Icons.person_outline_rounded,
                        validator: (value) =>
                            value == null || value.trim().length < 2
                                ? 'Enter your full name.'
                                : null),
                    _textField('phone', 'Phone Number', Icons.phone_outlined,
                        keyboard: TextInputType.phone,
                        validator: (value) =>
                            value == null || value.trim().length < 10
                                ? 'Enter a valid phone number.'
                                : null),
                    _contactVerification('phone'),
                    _textField('email', 'Email Address', Icons.email_outlined,
                        keyboard: TextInputType.emailAddress,
                        validator: (value) => value != null &&
                                value.isNotEmpty &&
                                !RegExp(r'^[^@\s]+@[^@\s]+\.[^@\s]+$')
                                    .hasMatch(value.trim())
                            ? 'Enter a valid email address.'
                            : null),
                    _contactVerification('email'),
                    _textField(
                        'address', 'Residential Address', Icons.home_outlined),
                    _textField('state', 'State', Icons.location_city_outlined),
                    _textField('lga', 'LGA', Icons.location_on_outlined),
                    _textField('zone', 'Zone', Icons.map_outlined),
                    if (_error != null)
                      Container(
                        width: double.infinity,
                        margin: const EdgeInsets.only(bottom: 12),
                        padding: const EdgeInsets.all(12),
                        decoration: BoxDecoration(
                            color: const Color(0xFFFFF1F0),
                            borderRadius: BorderRadius.circular(12)),
                        child: Text(_error!,
                            style: const TextStyle(color: Color(0xFFB42318))),
                      ),
                    SizedBox(
                      width: double.infinity,
                      height: 52,
                      child: FilledButton(
                        onPressed: _saving ? null : _save,
                        style: FilledButton.styleFrom(
                            backgroundColor: _green,
                            foregroundColor: Colors.white),
                        child: _saving
                            ? const SizedBox(
                                width: 21,
                                height: 21,
                                child: CircularProgressIndicator(
                                    strokeWidth: 2, color: Colors.white))
                            : const Text('Save changes',
                                style: TextStyle(fontWeight: FontWeight.w800)),
                      ),
                    ),
                  ]),
            ),
          ),
        ),
      );
}

import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

import 'login_routing.dart';

class ForcedPasswordChangeScreen extends StatefulWidget {
  const ForcedPasswordChangeScreen({
    super.key,
    required this.role,
    this.client,
  });

  final String role;
  final http.Client? client;

  @override
  State<ForcedPasswordChangeScreen> createState() =>
      _ForcedPasswordChangeScreenState();
}

class _ForcedPasswordChangeScreenState
    extends State<ForcedPasswordChangeScreen> {
  final TextEditingController _temporaryPassword = TextEditingController();
  final TextEditingController _password = TextEditingController();
  final TextEditingController _confirm = TextEditingController();

  bool _saving = false;
  bool _showTemporaryPassword = false;
  bool _showPassword = false;
  bool _showConfirmPassword = false;
  String? _error;

  @override
  void dispose() {
    _temporaryPassword.dispose();
    _password.dispose();
    _confirm.dispose();
    super.dispose();
  }

  String? _passwordPolicyError(String value) {
    if (value.length < 8) {
      return 'Password must be at least 8 characters long.';
    }
    if (!RegExp(r'[A-Z]').hasMatch(value)) {
      return 'Password must contain at least one uppercase letter.';
    }
    if (!RegExp(r'[a-z]').hasMatch(value)) {
      return 'Password must contain at least one lowercase letter.';
    }
    if (!RegExp(r'[0-9]').hasMatch(value)) {
      return 'Password must contain at least one number.';
    }
    if (!RegExp(r'[^A-Za-z0-9]').hasMatch(value)) {
      return 'Password must contain at least one special character.';
    }
    return null;
  }

  Future<void> _submit() async {
    final temporaryPassword = _temporaryPassword.text;
    final newPassword = _password.text;
    final confirmPassword = _confirm.text;

    if (temporaryPassword.trim().isEmpty) {
      setState(() => _error = 'Enter your temporary password.');
      return;
    }
    if (newPassword.isEmpty) {
      setState(() => _error = 'Enter a new password.');
      return;
    }
    if (confirmPassword.isEmpty) {
      setState(() => _error = 'Confirm your new password.');
      return;
    }
    if (newPassword != confirmPassword) {
      setState(() => _error = 'New password and confirmation do not match.');
      return;
    }
    final policyError = _passwordPolicyError(newPassword);
    if (policyError != null) {
      setState(() => _error = policyError);
      return;
    }

    setState(() {
      _saving = true;
      _error = null;
    });

    try {
      final prefs = await SharedPreferences.getInstance();
      final token = prefs.getString('auth_token') ??
          prefs.getString('access_token') ??
          '';
      if (token.trim().isEmpty) {
        throw Exception(
            'Your login session was not found. Please sign in again.');
      }

      final requestUri =
          Uri.parse('https://api.servicepay.ng/api/auth/change-password');
      final requestHeaders = <String, String>{
        'Authorization': 'Bearer $token',
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      };
      final requestBody = jsonEncode(<String, dynamic>{
        'currentPassword': temporaryPassword,
        'newPassword': newPassword,
        'confirmPassword': confirmPassword,
      });
      final response = widget.client == null
          ? await http.put(
              requestUri,
              headers: requestHeaders,
              body: requestBody,
            )
          : await widget.client!.put(
              requestUri,
              headers: requestHeaders,
              body: requestBody,
            );

      dynamic decoded;
      try {
        decoded = jsonDecode(response.body);
      } catch (_) {
        decoded = null;
      }
      final result = decoded is Map
          ? Map<String, dynamic>.from(decoded)
          : <String, dynamic>{};

      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw Exception(
          result['message']?.toString() ?? 'Password change failed.',
        );
      }

      final newToken = result['token']?.toString().trim();
      if (newToken != null && newToken.isNotEmpty) {
        await prefs.setString('auth_token', newToken);
      }
      if (!mounted) return;

      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Password changed successfully')),
      );
      Navigator.of(context).pushAndRemoveUntil(
        MaterialPageRoute<void>(
          builder: (_) => authenticatedHomeForRole(widget.role),
        ),
        (_) => false,
      );
    } catch (error) {
      if (mounted) {
        setState(
          () => _error = error.toString().replaceFirst('Exception: ', ''),
        );
      }
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Widget _passwordField({
    required Key fieldKey,
    required TextEditingController controller,
    required String label,
    required bool visible,
    required VoidCallback onToggle,
    String? hintText,
  }) {
    return TextField(
      key: fieldKey,
      controller: controller,
      obscureText: !visible,
      autocorrect: false,
      enableSuggestions: false,
      textInputAction: TextInputAction.next,
      decoration: InputDecoration(
        labelText: label,
        hintText: hintText,
        prefixIcon: const Icon(Icons.lock_outline),
        suffixIcon: IconButton(
          tooltip: visible ? 'Hide password' : 'Show password',
          onPressed: onToggle,
          icon: Icon(
            visible ? Icons.visibility_off_outlined : Icons.visibility_outlined,
          ),
        ),
        border: OutlineInputBorder(borderRadius: BorderRadius.circular(14)),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF4F7F5),
      appBar: AppBar(
        title: const Text('Change temporary password'),
        backgroundColor: const Color(0xFF08783E),
        foregroundColor: Colors.white,
      ),
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  const Text(
                    'Confirm your temporary password and set a new one.',
                    style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700),
                  ),
                  const SizedBox(height: 16),
                  _passwordField(
                    fieldKey: const Key('temporary-password-field'),
                    controller: _temporaryPassword,
                    label: 'Temporary password',
                    hintText: 'Temporary password',
                    visible: _showTemporaryPassword,
                    onToggle: () => setState(
                      () => _showTemporaryPassword = !_showTemporaryPassword,
                    ),
                  ),
                  const SizedBox(height: 14),
                  _passwordField(
                    fieldKey: const Key('new-password-field'),
                    controller: _password,
                    label: 'New password',
                    visible: _showPassword,
                    onToggle: () =>
                        setState(() => _showPassword = !_showPassword),
                  ),
                  const SizedBox(height: 14),
                  _passwordField(
                    fieldKey: const Key('confirm-password-field'),
                    controller: _confirm,
                    label: 'Confirm new password',
                    visible: _showConfirmPassword,
                    onToggle: () => setState(
                      () => _showConfirmPassword = !_showConfirmPassword,
                    ),
                  ),
                  if (_error != null) ...[
                    const SizedBox(height: 12),
                    Text(
                      _error!,
                      style: const TextStyle(color: Colors.red),
                    ),
                  ],
                  const SizedBox(height: 18),
                  FilledButton(
                    key: const Key('forced-password-submit'),
                    onPressed: _saving ? null : _submit,
                    style: FilledButton.styleFrom(
                      backgroundColor: const Color(0xFF08783E),
                      padding: const EdgeInsets.symmetric(vertical: 15),
                    ),
                    child: Text(_saving ? 'Saving…' : 'Continue'),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

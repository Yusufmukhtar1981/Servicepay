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
  bool _showTemporaryPassword = false;
  bool _showPassword = false;
  bool _showConfirm = false;
  bool _saving = false;
  String? _error;

  http.Client get _client => widget.client ?? http.Client();

  @override
  void dispose() {
    _temporaryPassword.dispose();
    _password.dispose();
    _confirm.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (_temporaryPassword.text.isEmpty) {
      setState(() => _error = 'Enter your temporary password.');
      return;
    }
    if (_password.text.length < 8) {
      setState(
          () => _error = 'New password must contain at least 8 characters.');
      return;
    }
    if (_password.text != _confirm.text) {
      setState(() => _error = 'New passwords do not match.');
      return;
    }
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      final SharedPreferences prefs = await SharedPreferences.getInstance();
      final String token = prefs.getString('auth_token') ??
          prefs.getString('access_token') ??
          '';
      final http.Response response = await _client.put(
        Uri.parse(
          '${const String.fromEnvironment(
            'SERVICEPAY_API_BASE_URL',
            defaultValue: 'https://api.servicepay.ng/api',
          )}/auth/change-password',
        ),
        headers: <String, String>{
          'Authorization': 'Bearer $token',
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: jsonEncode(<String, dynamic>{
          'currentPassword': _temporaryPassword.text,
          'newPassword': _password.text,
          'confirmPassword': _confirm.text,
        }),
      );
      dynamic decoded;
      try {
        decoded = jsonDecode(response.body);
      } catch (_) {
        decoded = null;
      }
      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw Exception(decoded is Map
            ? decoded['message'] ?? 'Password change failed.'
            : 'Password change failed.');
      }
      if (decoded is Map) {
        final replacementToken =
            (decoded['token'] ?? decoded['accessToken'] ?? '')
                .toString()
                .trim();
        if (replacementToken.isNotEmpty) {
          await prefs.setString('auth_token', replacementToken);
        }
      }
      if (!mounted) return;
      Navigator.of(context).pushAndRemoveUntil(
        MaterialPageRoute<void>(
            builder: (_) => authenticatedHomeForRole(widget.role)),
        (_) => false,
      );
    } catch (error) {
      if (mounted) {
        setState(
            () => _error = error.toString().replaceFirst('Exception: ', ''));
      }
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: const Text('Change temporary password')),
        body: Center(
            child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 420),
          child: Padding(
              padding: const EdgeInsets.all(24),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  const Text('Set a new password to continue.',
                      style:
                          TextStyle(fontSize: 18, fontWeight: FontWeight.w700)),
                  const SizedBox(height: 16),
                  TextField(
                      key: const Key('temporary-password-field'),
                      controller: _temporaryPassword,
                      obscureText: !_showTemporaryPassword,
                      decoration: InputDecoration(
                        labelText: 'Temporary password',
                        suffixIcon: IconButton(
                          onPressed: () => setState(() =>
                              _showTemporaryPassword = !_showTemporaryPassword),
                          icon: Icon(_showTemporaryPassword
                              ? Icons.visibility_off_outlined
                              : Icons.visibility_outlined),
                        ),
                      )),
                  const SizedBox(height: 12),
                  TextField(
                      key: const Key('new-password-field'),
                      controller: _password,
                      obscureText: !_showPassword,
                      decoration: InputDecoration(
                        labelText: 'New password',
                        suffixIcon: IconButton(
                          onPressed: () =>
                              setState(() => _showPassword = !_showPassword),
                          icon: Icon(_showPassword
                              ? Icons.visibility_off_outlined
                              : Icons.visibility_outlined),
                        ),
                      )),
                  const SizedBox(height: 12),
                  TextField(
                      key: const Key('confirm-password-field'),
                      controller: _confirm,
                      obscureText: !_showConfirm,
                      decoration: InputDecoration(
                        labelText: 'Confirm new password',
                        suffixIcon: IconButton(
                          onPressed: () =>
                              setState(() => _showConfirm = !_showConfirm),
                          icon: Icon(_showConfirm
                              ? Icons.visibility_off_outlined
                              : Icons.visibility_outlined),
                        ),
                      )),
                  if (_error != null)
                    Padding(
                        padding: const EdgeInsets.only(top: 8),
                        child: Text(_error!,
                            style: const TextStyle(color: Colors.red))),
                  const SizedBox(height: 16),
                  FilledButton(
                      key: const Key('forced-password-submit'),
                      onPressed: _saving ? null : _submit,
                      child: Text(_saving ? 'Saving…' : 'Continue')),
                ],
              )),
        )),
      );
}

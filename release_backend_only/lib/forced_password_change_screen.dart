import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

import 'login_routing.dart';

class ForcedPasswordChangeScreen extends StatefulWidget {
  const ForcedPasswordChangeScreen({super.key, required this.role});
  final String role;

  @override
  State<ForcedPasswordChangeScreen> createState() =>
      _ForcedPasswordChangeScreenState();
}

class _ForcedPasswordChangeScreenState
    extends State<ForcedPasswordChangeScreen> {
  final TextEditingController _password = TextEditingController();
  final TextEditingController _confirm = TextEditingController();
  bool _saving = false;
  String? _error;

  @override
  void dispose() {
    _password.dispose();
    _confirm.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (_password.text.length < 6 || _password.text != _confirm.text) {
      setState(() =>
          _error = 'Passwords must match and contain at least 6 characters.');
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
      final http.Response response = await http.put(
        Uri.parse('https://api.servicepay.ng/api/auth/change-password'),
        headers: <String, String>{
          'Authorization': 'Bearer $token',
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: jsonEncode(<String, dynamic>{
          'newPassword': _password.text,
          'password': _password.text,
        }),
      );
      if (response.statusCode < 200 || response.statusCode >= 300) {
        final dynamic body = jsonDecode(response.body);
        throw Exception(body is Map
            ? body['message'] ?? 'Password change failed.'
            : 'Password change failed.');
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
                      controller: _password,
                      obscureText: true,
                      decoration:
                          const InputDecoration(labelText: 'New password')),
                  TextField(
                      controller: _confirm,
                      obscureText: true,
                      decoration: const InputDecoration(
                          labelText: 'Confirm new password')),
                  if (_error != null)
                    Padding(
                        padding: const EdgeInsets.only(top: 8),
                        child: Text(_error!,
                            style: const TextStyle(color: Colors.red))),
                  const SizedBox(height: 16),
                  FilledButton(
                      onPressed: _saving ? null : _submit,
                      child: Text(_saving ? 'Saving…' : 'Continue')),
                ],
              )),
        )),
      );
}

import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

import 'login_routing.dart';
import 'services/session_store.dart';

class ForcedPasswordChangeScreen extends StatefulWidget {
  const ForcedPasswordChangeScreen({
    super.key,
    required this.role,
    this.staffUser = const <String, dynamic>{},
    this.client,
    this.onRelogin,
    this.authenticatedHomeBuilder,
  });

  final String role;
  final Map<String, dynamic> staffUser;
  final http.Client? client;
  final VoidCallback? onRelogin;
  final WidgetBuilder? authenticatedHomeBuilder;

  @override
  State<ForcedPasswordChangeScreen> createState() =>
      _ForcedPasswordChangeScreenState();
}

class _ForcedPasswordChangeScreenState
    extends State<ForcedPasswordChangeScreen> {
  final GlobalKey<FormState> _formKey = GlobalKey<FormState>();
  final TextEditingController _temporaryPassword = TextEditingController();
  final TextEditingController _password = TextEditingController();
  final TextEditingController _confirm = TextEditingController();
  bool _showTemporaryPassword = false;
  bool _showPassword = false;
  bool _showConfirm = false;
  bool _saving = false;
  bool _needsRelogin = false;
  String? _error;

  static const String _baseUrl = String.fromEnvironment(
    'SERVICEPAY_API_BASE_URL',
    defaultValue: 'https://api.servicepay.ng/api',
  );

  http.Client get _client => widget.client ?? http.Client();

  @override
  void dispose() {
    _temporaryPassword.dispose();
    _password.dispose();
    _confirm.dispose();
    super.dispose();
  }

  String? _strongPasswordError(String value) {
    if (value.length < 8) return 'Use at least 8 characters.';
    if (!RegExp(r'[A-Z]').hasMatch(value)) {
      return 'Add at least one uppercase letter.';
    }
    if (!RegExp(r'[a-z]').hasMatch(value)) {
      return 'Add at least one lowercase letter.';
    }
    if (!RegExp(r'[0-9]').hasMatch(value)) {
      return 'Add at least one number.';
    }
    if (!RegExp(r'[^A-Za-z0-9]').hasMatch(value)) {
      return 'Add at least one special character.';
    }
    return null;
  }

  Future<void> _clearTemporarySession() async {
    try {
      await SessionStore.clear();
      final SharedPreferences preferences =
          await SharedPreferences.getInstance();
      await preferences.remove('must_change_password');
      await preferences.remove('forced_password_user_context');
    } catch (_) {
      // The dashboard remains blocked; sign-in can recover with a fresh session.
    }
  }

  Future<void> _submit() async {
    if (_saving || !(_formKey.currentState?.validate() ?? false)) return;
    FocusScope.of(context).unfocus();
    setState(() {
      _saving = true;
      _error = null;
      _needsRelogin = false;
    });

    bool serverChangedPassword = false;
    try {
      final String token = (await SessionStore.readToken() ?? '').trim();
      if (token.isEmpty) {
        setState(() {
          _error =
              'Your temporary session is no longer available. Sign in again.';
          _needsRelogin = true;
        });
        return;
      }

      final http.Response response = await _client
          .put(
            Uri.parse('$_baseUrl/auth/change-password'),
            headers: <String, String>{
              'Authorization': 'Bearer $token',
              'Content-Type': 'application/json',
              'Accept': 'application/json',
            },
            body: jsonEncode(<String, String>{
              'currentPassword': _temporaryPassword.text,
              'newPassword': _password.text,
              'confirmPassword': _confirm.text,
            }),
          )
          .timeout(const Duration(seconds: 30));
      dynamic decoded;
      try {
        decoded =
            response.body.trim().isEmpty ? null : jsonDecode(response.body);
      } on FormatException {
        decoded = null;
      }
      final Map<String, dynamic> result = decoded is Map
          ? Map<String, dynamic>.from(decoded)
          : <String, dynamic>{};
      if (response.statusCode < 200 ||
          response.statusCode >= 300 ||
          result['success'] != true) {
        throw Exception(
          result['message']?.toString().trim().isNotEmpty == true
              ? result['message'].toString()
              : 'Password change failed. Check your current password and try again.',
        );
      }
      serverChangedPassword = true;
      final Map<String, dynamic> data = result['data'] is Map
          ? Map<String, dynamic>.from(result['data'] as Map)
          : <String, dynamic>{};
      final String replacementToken =
          (result['token'] ?? result['accessToken'] ?? data['token'] ?? '')
              .toString()
              .replaceFirst(RegExp(r'^Bearer\s+', caseSensitive: false), '')
              .trim();
      if (replacementToken.isEmpty) {
        throw const _ReloginRequiredException(
          'Password changed, but the refreshed session was not returned. Sign in again with your new password.',
        );
      }

      final bool tokenStored =
          await SessionStore.writeSessionVerified(replacementToken);
      if (!tokenStored ||
          (await SessionStore.readToken())?.trim() != replacementToken) {
        throw const _ReloginRequiredException(
          'Password changed, but the refreshed session could not be saved. Sign in again with your new password.',
        );
      }

      final SharedPreferences preferences =
          await SharedPreferences.getInstance();
      await preferences.remove('must_change_password');
      await preferences.remove('forced_password_user_context');
      if (preferences.getBool('must_change_password') == true) {
        throw const _ReloginRequiredException(
          'Password changed, but this device could not refresh the session. Sign in again with your new password.',
        );
      }
      if (!mounted) return;
      Navigator.of(context).pushAndRemoveUntil(
        MaterialPageRoute<void>(
          builder: (BuildContext context) =>
              widget.authenticatedHomeBuilder?.call(context) ??
              authenticatedHomeForRole(
                widget.role,
                user: widget.staffUser,
              ),
        ),
        (Route<dynamic> route) => false,
      );
    } on _ReloginRequiredException catch (error) {
      if (serverChangedPassword) await _clearTemporarySession();
      if (mounted) {
        setState(() {
          _error = error.message;
          _needsRelogin = true;
        });
      }
    } on http.ClientException {
      if (mounted) {
        setState(() =>
            _error = 'Unable to connect. Check your network and try again.');
      }
    } on FormatException {
      if (mounted) {
        setState(() => _error = 'The server returned an invalid response.');
      }
    } catch (error) {
      if (mounted) {
        setState(() => _error = '$error'.replaceFirst('Exception: ', ''));
      }
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  InputDecoration _fieldDecoration({
    required String label,
    required bool visible,
    required VoidCallback onToggle,
  }) =>
      InputDecoration(
        labelText: label,
        border: const OutlineInputBorder(),
        suffixIcon: IconButton(
          tooltip: visible ? 'Hide $label' : 'Show $label',
          onPressed: _saving ? null : onToggle,
          icon: Icon(
            visible ? Icons.visibility_outlined : Icons.visibility_off_outlined,
          ),
        ),
      );

  @override
  Widget build(BuildContext context) {
    final ColorScheme colors = Theme.of(context).colorScheme;
    return Scaffold(
      appBar: AppBar(title: const Text('Change temporary password')),
      body: SafeArea(
        child: LayoutBuilder(
          builder: (BuildContext context, BoxConstraints constraints) =>
              SingleChildScrollView(
            padding: EdgeInsets.fromLTRB(
              constraints.maxWidth < 600 ? 16 : 28,
              20,
              constraints.maxWidth < 600 ? 16 : 28,
              32,
            ),
            child: Center(
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 500),
                child: Card(
                  child: Padding(
                    padding: EdgeInsets.all(
                      constraints.maxWidth < 360 ? 16 : 24,
                    ),
                    child: AutofillGroup(
                      child: Form(
                        key: _formKey,
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: <Widget>[
                            Icon(Icons.lock_reset_outlined,
                                size: 40, color: colors.primary),
                            const SizedBox(height: 12),
                            Text(
                              'Set a new password to continue',
                              textAlign: TextAlign.center,
                              style: Theme.of(context).textTheme.headlineSmall,
                            ),
                            const SizedBox(height: 8),
                            const Text(
                              'Replace your temporary password before opening your workspace.',
                              textAlign: TextAlign.center,
                            ),
                            const SizedBox(height: 20),
                            TextFormField(
                              key: const Key('temporary-password-field'),
                              controller: _temporaryPassword,
                              obscureText: !_showTemporaryPassword,
                              autofillHints: const [AutofillHints.password],
                              textInputAction: TextInputAction.next,
                              decoration: _fieldDecoration(
                                label: 'Temporary password',
                                visible: _showTemporaryPassword,
                                onToggle: () => setState(() =>
                                    _showTemporaryPassword =
                                        !_showTemporaryPassword),
                              ),
                              validator: (String? value) =>
                                  (value ?? '').isEmpty
                                      ? 'Enter your temporary password.'
                                      : null,
                            ),
                            const SizedBox(height: 14),
                            TextFormField(
                              key: const Key('new-password-field'),
                              controller: _password,
                              obscureText: !_showPassword,
                              autofillHints: const [AutofillHints.newPassword],
                              textInputAction: TextInputAction.next,
                              decoration: _fieldDecoration(
                                label: 'New password',
                                visible: _showPassword,
                                onToggle: () => setState(
                                    () => _showPassword = !_showPassword),
                              ),
                              validator: (String? value) =>
                                  _strongPasswordError(value ?? ''),
                            ),
                            const SizedBox(height: 14),
                            TextFormField(
                              key: const Key('confirm-password-field'),
                              controller: _confirm,
                              obscureText: !_showConfirm,
                              autofillHints: const [AutofillHints.newPassword],
                              textInputAction: TextInputAction.done,
                              onFieldSubmitted: (_) => _submit(),
                              decoration: _fieldDecoration(
                                label: 'Confirm new password',
                                visible: _showConfirm,
                                onToggle: () => setState(
                                    () => _showConfirm = !_showConfirm),
                              ),
                              validator: (String? value) =>
                                  value != _password.text
                                      ? 'New passwords do not match.'
                                      : null,
                            ),
                            const SizedBox(height: 12),
                            Text(
                              'Use at least 8 characters with uppercase, lowercase, a number, and a special character.',
                              style: Theme.of(context).textTheme.bodySmall,
                            ),
                            if (_error != null) ...<Widget>[
                              const SizedBox(height: 12),
                              Semantics(
                                liveRegion: true,
                                child: Text(
                                  _error!,
                                  key: const Key('forced-password-error'),
                                  style: TextStyle(color: colors.error),
                                ),
                              ),
                            ],
                            const SizedBox(height: 18),
                            SizedBox(
                              height: 50,
                              child: FilledButton(
                                key: const Key('forced-password-submit'),
                                onPressed: _saving ? null : _submit,
                                child: _saving
                                    ? const SizedBox(
                                        width: 21,
                                        height: 21,
                                        child: CircularProgressIndicator(
                                            strokeWidth: 2),
                                      )
                                    : const Text('Continue'),
                              ),
                            ),
                            if (_needsRelogin) ...<Widget>[
                              const SizedBox(height: 10),
                              OutlinedButton(
                                key: const Key('forced-password-relogin'),
                                onPressed: widget.onRelogin,
                                child: const Text('Sign in again'),
                              ),
                            ],
                          ],
                        ),
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _ReloginRequiredException implements Exception {
  const _ReloginRequiredException(this.message);

  final String message;
}

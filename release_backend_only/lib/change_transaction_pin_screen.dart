import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:http/http.dart' as http;

import 'security_utils.dart';

class ChangeTransactionPinScreen extends StatefulWidget {
  const ChangeTransactionPinScreen({super.key, this.client});
  final http.Client? client;

  @override
  State<ChangeTransactionPinScreen> createState() =>
      _ChangeTransactionPinScreenState();
}

class _ChangeTransactionPinScreenState
    extends State<ChangeTransactionPinScreen> {
  static const _baseUrl = 'https://api.servicepay.ng/api';
  final _current = TextEditingController();
  final _newPin = TextEditingController();
  final _confirm = TextEditingController();
  late final http.Client _client;
  late final bool _ownsClient;
  bool _submitting = false;

  @override
  void initState() {
    super.initState();
    _ownsClient = widget.client == null;
    _client = widget.client ?? http.Client();
  }

  @override
  void dispose() {
    _current.dispose();
    _newPin.dispose();
    _confirm.dispose();
    if (_ownsClient) {
      _client.close();
    }
    super.dispose();
  }

  void _message(String value, {bool error = true}) {
    if (!mounted) return;
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(
        content: Text(value),
        backgroundColor: error ? Colors.red : const Color(0xFF2E7D32),
      ));
  }

  Map<String, dynamic> _decode(String body) {
    try {
      final value = jsonDecode(body);
      return value is Map ? Map<String, dynamic>.from(value) : {};
    } catch (_) {
      return {};
    }
  }

  Future<void> _submit() async {
    if (_submitting) return;
    final currentPin = _current.text.trim();
    final newPin = _newPin.text.trim();
    final confirmNewPin = _confirm.text.trim();
    if (!RegExp(r'^\d{4}$').hasMatch(currentPin)) {
      _message('Current transaction PIN must contain exactly 4 digits.');
      return;
    }
    final error = transactionPinError(newPin);
    if (error != null) {
      _message(error);
      return;
    }
    if (newPin != confirmNewPin) {
      _message('Transaction PINs do not match.');
      return;
    }
    setState(() => _submitting = true);
    try {
      final token = await readAuthToken();
      if (token == null) {
        throw StateError(
            'Your login session has expired. Please sign in again.');
      }
      final response = await _client
          .put(
            Uri.parse('$_baseUrl/transaction-pin/change'),
            headers: {
              'Accept': 'application/json',
              'Content-Type': 'application/json',
              'Authorization': 'Bearer $token'
            },
            body: jsonEncode({
              'currentPin': currentPin,
              'newPin': newPin,
              'confirmNewPin': confirmNewPin
            }),
          )
          .timeout(const Duration(seconds: 30));
      final data = _decode(response.body);
      if (response.statusCode >= 200 &&
          response.statusCode < 300 &&
          data['success'] == true) {
        _message(
            data['message']?.toString() ??
                'Transaction PIN changed successfully.',
            error: false);
        if (mounted) {
          Navigator.of(context).pop(true);
        }
      } else {
        _message(
            data['message']?.toString() ?? 'Unable to change transaction PIN.');
      }
    } catch (e) {
      _message(e is StateError
          ? e.message.toString()
          : 'Unable to connect to the server. Please try again.');
    } finally {
      if (mounted) {
        setState(() => _submitting = false);
      }
    }
  }

  Widget _field(Key key, TextEditingController controller, String label) =>
      TextField(
        key: key,
        controller: controller,
        obscureText: true,
        keyboardType: TextInputType.number,
        maxLength: 4,
        inputFormatters: [FilteringTextInputFormatter.digitsOnly],
        decoration: InputDecoration(
            labelText: label,
            counterText: '',
            border: const OutlineInputBorder()),
      );

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: const Text('Change Transaction PIN')),
        body: Padding(
          padding: const EdgeInsets.all(20),
          child:
              Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            _field(const Key('change-pin-current'), _current,
                'Current 4-digit PIN'),
            const SizedBox(height: 16),
            _field(const Key('change-pin-new'), _newPin, 'New 4-digit PIN'),
            const SizedBox(height: 16),
            _field(
                const Key('change-pin-confirm'), _confirm, 'Confirm new PIN'),
            const SizedBox(height: 24),
            ElevatedButton(
              key: const Key('change-transaction-pin-submit'),
              onPressed: _submitting ? null : _submit,
              child: _submitting
                  ? const CircularProgressIndicator()
                  : const Text('Change Transaction PIN'),
            ),
          ]),
        ),
      );
}

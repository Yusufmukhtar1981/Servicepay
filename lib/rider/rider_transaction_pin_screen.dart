import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

class RiderTransactionPinScreen extends StatefulWidget {
  const RiderTransactionPinScreen({super.key});

  @override
  State<RiderTransactionPinScreen> createState() =>
      _RiderTransactionPinScreenState();
}

class _RiderTransactionPinScreenState extends State<RiderTransactionPinScreen> {
  static const String baseUrl = 'https://api.servicepay.ng/api';

  static const String statusPath = '/transaction-pin/status';
  static const String createPath = '/transaction-pin/status';
  static const String changePath = '/transaction-pin/status';

  final _newPinController = TextEditingController();
  final _confirmPinController = TextEditingController();
  final _currentPinController = TextEditingController();

  bool _loading = true;
  bool _submitting = false;
  bool _pinIsSet = false;
  bool _hideCurrent = true;
  bool _hideNew = true;
  bool _hideConfirm = true;

  String? _token;
  String? _error;

  static const Color servicePayGreen = Color(0xFF08783E);

  @override
  void initState() {
    super.initState();
    _loadStatus();
  }

  @override
  void dispose() {
    _newPinController.dispose();
    _confirmPinController.dispose();
    _currentPinController.dispose();
    super.dispose();
  }

  Future<String?> _getToken() async {
    final prefs = await SharedPreferences.getInstance();

    final possibleKeys = <String>[
      'auth_token',
      'token',
      'access_token',
      'jwt_token',
    ];

    for (final key in possibleKeys) {
      final value = prefs.getString(key);
      if (value != null && value.trim().isNotEmpty) {
        return value.trim();
      }
    }

    return null;
  }

  Map<String, String> _headers() {
    return <String, String>{
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      if (_token != null) 'Authorization': 'Bearer $_token',
    };
  }

  Map<String, dynamic> _decode(http.Response response) {
    try {
      final decoded = jsonDecode(response.body);

      if (decoded is Map<String, dynamic>) {
        return decoded;
      }

      if (decoded is Map) {
        return Map<String, dynamic>.from(decoded);
      }
    } catch (_) {}

    return <String, dynamic>{};
  }

  String _messageFrom(
    Map<String, dynamic> data, {
    String fallback = 'Something went wrong.',
  }) {
    final possible = <dynamic>[
      data['message'],
      data['error'],
      data['detail'],
      data['msg'],
    ];

    for (final item in possible) {
      if (item != null && item.toString().trim().isNotEmpty) {
        return item.toString();
      }
    }

    return fallback;
  }

  bool _extractStatus(Map<String, dynamic> data) {
    final candidates = <dynamic>[
      data['transactionPinSet'],
      data['pinSet'],
      data['hasTransactionPin'],
      data['hasPin'],
      data['isSet'],
      data['data'] is Map ? data['data']['transactionPinSet'] : null,
      data['data'] is Map ? data['data']['pinSet'] : null,
      data['data'] is Map ? data['data']['hasTransactionPin'] : null,
      data['user'] is Map ? data['user']['transactionPinSet'] : null,
    ];

    for (final value in candidates) {
      if (value == true) return true;

      if (value is String &&
          <String>{'true', 'yes', 'set', '1'}
              .contains(value.toLowerCase().trim())) {
        return true;
      }
    }

    return false;
  }

  Future<void> _loadStatus() async {
    if (mounted) {
      setState(() {
        _loading = true;
        _error = null;
      });
    }

    try {
      _token = await _getToken();

      if (_token == null) {
        throw Exception('Your session has expired. Please log in again.');
      }

      final response = await http
          .get(
            Uri.parse('$baseUrl$statusPath'),
            headers: _headers(),
          )
          .timeout(const Duration(seconds: 25));

      final data = _decode(response);

      if (response.statusCode >= 200 && response.statusCode < 300) {
        if (!mounted) return;

        setState(() {
          _pinIsSet = _extractStatus(data);
          _loading = false;
        });

        return;
      }

      throw Exception(
        _messageFrom(
          data,
          fallback: 'Unable to check Transaction PIN status.',
        ),
      );
    } catch (e) {
      if (!mounted) return;

      setState(() {
        _loading = false;
        _error = e.toString().replaceFirst('Exception: ', '');
      });
    }
  }

  bool _validateNewPin() {
    final pin = _newPinController.text.trim();
    final confirm = _confirmPinController.text.trim();

    if (!RegExp(r'^\d{4}$').hasMatch(pin)) {
      _showMessage('Transaction PIN must contain exactly 4 digits.');
      return false;
    }

    if (pin != confirm) {
      _showMessage('New PIN and Confirm PIN do not match.');
      return false;
    }

    return true;
  }

  Future<void> _createPin() async {
    if (!_validateNewPin()) return;

    await _submit(
      path: createPath,
      body: <String, dynamic>{
        'transactionPin': _newPinController.text.trim(),
        'pin': _newPinController.text.trim(),
        'confirmTransactionPin': _confirmPinController.text.trim(),
        'confirmPin': _confirmPinController.text.trim(),
      },
      successFallback: 'Transaction PIN created successfully.',
    );
  }

  Future<void> _changePin() async {
    final current = _currentPinController.text.trim();

    if (!RegExp(r'^\d{4}$').hasMatch(current)) {
      _showMessage('Enter your valid current 4-digit Transaction PIN.');
      return;
    }

    if (!_validateNewPin()) return;

    await _submit(
      path: changePath,
      body: <String, dynamic>{
        'currentPin': current,
        'currentTransactionPin': current,
        'oldPin': current,
        'oldTransactionPin': current,
        'newPin': _newPinController.text.trim(),
        'newTransactionPin': _newPinController.text.trim(),
        'transactionPin': _newPinController.text.trim(),
        'confirmPin': _confirmPinController.text.trim(),
        'confirmTransactionPin': _confirmPinController.text.trim(),
      },
      successFallback: 'Transaction PIN changed successfully.',
    );
  }

  Future<void> _submit({
    required String path,
    required Map<String, dynamic> body,
    required String successFallback,
  }) async {
    if (_submitting) return;

    FocusScope.of(context).unfocus();

    setState(() => _submitting = true);

    try {
      _token ??= await _getToken();

      if (_token == null) {
        throw Exception('Your session has expired. Please log in again.');
      }

      final response = await http
          .post(
            Uri.parse('$baseUrl$path'),
            headers: _headers(),
            body: jsonEncode(body),
          )
          .timeout(const Duration(seconds: 30));

      final data = _decode(response);

      if (response.statusCode >= 200 && response.statusCode < 300) {
        _currentPinController.clear();
        _newPinController.clear();
        _confirmPinController.clear();

        if (!mounted) return;

        _showMessage(
          _messageFrom(
            data,
            fallback: successFallback,
          ),
          success: true,
        );

        await _loadStatus();
        return;
      }

      throw Exception(
        _messageFrom(
          data,
          fallback: 'Unable to update Transaction PIN.',
        ),
      );
    } catch (e) {
      if (!mounted) return;

      _showMessage(
        e.toString().replaceFirst('Exception: ', ''),
      );
    } finally {
      if (mounted) {
        setState(() => _submitting = false);
      }
    }
  }

  void _showMessage(String message, {bool success = false}) {
    if (!mounted) return;

    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(
        SnackBar(
          content: Text(message),
          behavior: SnackBarBehavior.floating,
          backgroundColor: success ? servicePayGreen : Colors.red.shade700,
        ),
      );
  }

  InputDecoration _decoration(
    String label,
    IconData icon, {
    Widget? suffixIcon,
  }) {
    return InputDecoration(
      labelText: label,
      prefixIcon: Icon(icon),
      suffixIcon: suffixIcon,
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(14),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(14),
        borderSide: BorderSide(color: Colors.grey.shade300),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(14),
        borderSide: const BorderSide(
          color: servicePayGreen,
          width: 1.8,
        ),
      ),
    );
  }

  Widget _pinField({
    required TextEditingController controller,
    required String label,
    required bool obscure,
    required VoidCallback onToggle,
  }) {
    return TextField(
      controller: controller,
      keyboardType: TextInputType.number,
      obscureText: obscure,
      maxLength: 4,
      inputFormatters: <TextInputFormatter>[
        FilteringTextInputFormatter.digitsOnly,
        LengthLimitingTextInputFormatter(4),
      ],
      decoration: _decoration(
        label,
        Icons.lock_outline,
        suffixIcon: IconButton(
          onPressed: onToggle,
          icon: Icon(
            obscure ? Icons.visibility_outlined : Icons.visibility_off_outlined,
          ),
        ),
      ).copyWith(counterText: ''),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF6F8F7),
      appBar: AppBar(
        title: const Text(
          'Transaction PIN',
          style: TextStyle(
            fontWeight: FontWeight.w700,
          ),
        ),
        backgroundColor: Colors.white,
        foregroundColor: const Color(0xFF17201C),
        elevation: 0.5,
        actions: <Widget>[
          IconButton(
            tooltip: 'Refresh',
            onPressed: _loading ? null : _loadStatus,
            icon: const Icon(Icons.refresh_rounded),
          ),
        ],
      ),
      body: _loading
          ? const Center(
              child: CircularProgressIndicator(
                color: servicePayGreen,
              ),
            )
          : _error != null
              ? Center(
                  child: Padding(
                    padding: const EdgeInsets.all(24),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: <Widget>[
                        Icon(
                          Icons.error_outline_rounded,
                          size: 52,
                          color: Colors.red.shade400,
                        ),
                        const SizedBox(height: 16),
                        Text(
                          _error!,
                          textAlign: TextAlign.center,
                        ),
                        const SizedBox(height: 18),
                        FilledButton.icon(
                          onPressed: _loadStatus,
                          icon: const Icon(Icons.refresh),
                          label: const Text('Try Again'),
                          style: FilledButton.styleFrom(
                            backgroundColor: servicePayGreen,
                          ),
                        ),
                      ],
                    ),
                  ),
                )
              : ListView(
                  padding: const EdgeInsets.all(18),
                  children: <Widget>[
                    Container(
                      padding: const EdgeInsets.all(18),
                      decoration: BoxDecoration(
                        color: _pinIsSet
                            ? const Color(0xFFEAF7F0)
                            : const Color(0xFFFFF8E7),
                        borderRadius: BorderRadius.circular(18),
                      ),
                      child: Row(
                        children: <Widget>[
                          Container(
                            width: 48,
                            height: 48,
                            decoration: BoxDecoration(
                              color: Colors.white,
                              borderRadius: BorderRadius.circular(14),
                            ),
                            child: Icon(
                              _pinIsSet
                                  ? Icons.verified_user_outlined
                                  : Icons.lock_open_outlined,
                              color: _pinIsSet
                                  ? servicePayGreen
                                  : Colors.orange.shade800,
                            ),
                          ),
                          const SizedBox(width: 14),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: <Widget>[
                                Text(
                                  _pinIsSet
                                      ? 'Transaction PIN Active'
                                      : 'Create Transaction PIN',
                                  style: const TextStyle(
                                    fontSize: 17,
                                    fontWeight: FontWeight.w800,
                                  ),
                                ),
                                const SizedBox(height: 5),
                                Text(
                                  _pinIsSet
                                      ? 'Your 4-digit PIN protects withdrawals and transactions.'
                                      : 'Create a secure 4-digit PIN before making a withdrawal.',
                                  style: TextStyle(
                                    color: Colors.grey.shade700,
                                    height: 1.35,
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: 24),
                    if (_pinIsSet) ...<Widget>[
                      const Text(
                        'Change Transaction PIN',
                        style: TextStyle(
                          fontSize: 18,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                      const SizedBox(height: 16),
                      _pinField(
                        controller: _currentPinController,
                        label: 'Current PIN',
                        obscure: _hideCurrent,
                        onToggle: () {
                          setState(() => _hideCurrent = !_hideCurrent);
                        },
                      ),
                      const SizedBox(height: 14),
                    ] else ...<Widget>[
                      const Text(
                        'Set Transaction PIN',
                        style: TextStyle(
                          fontSize: 18,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                      const SizedBox(height: 16),
                    ],
                    _pinField(
                      controller: _newPinController,
                      label: _pinIsSet ? 'New PIN' : '4-digit PIN',
                      obscure: _hideNew,
                      onToggle: () {
                        setState(() => _hideNew = !_hideNew);
                      },
                    ),
                    const SizedBox(height: 14),
                    _pinField(
                      controller: _confirmPinController,
                      label: 'Confirm PIN',
                      obscure: _hideConfirm,
                      onToggle: () {
                        setState(() => _hideConfirm = !_hideConfirm);
                      },
                    ),
                    const SizedBox(height: 24),
                    SizedBox(
                      height: 54,
                      child: FilledButton(
                        onPressed: _submitting
                            ? null
                            : (_pinIsSet ? _changePin : _createPin),
                        style: FilledButton.styleFrom(
                          backgroundColor: servicePayGreen,
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(14),
                          ),
                        ),
                        child: _submitting
                            ? const SizedBox(
                                width: 23,
                                height: 23,
                                child: CircularProgressIndicator(
                                  strokeWidth: 2.5,
                                  color: Colors.white,
                                ),
                              )
                            : Text(
                                _pinIsSet
                                    ? 'Change Transaction PIN'
                                    : 'Create Transaction PIN',
                                style: const TextStyle(
                                  fontSize: 16,
                                  fontWeight: FontWeight.w700,
                                ),
                              ),
                      ),
                    ),
                    const SizedBox(height: 18),
                    const Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: <Widget>[
                        Icon(
                          Icons.shield_outlined,
                          size: 20,
                          color: servicePayGreen,
                        ),
                        SizedBox(width: 9),
                        Expanded(
                          child: Text(
                            'Never share your Transaction PIN with anyone, including ServicePay staff.',
                            style: TextStyle(
                              color: Color(0xFF59645F),
                              height: 1.4,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
    );
  }
}

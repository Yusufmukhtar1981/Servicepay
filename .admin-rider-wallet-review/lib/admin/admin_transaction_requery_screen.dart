import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

class AdminTransactionRequeryScreen extends StatefulWidget {
  const AdminTransactionRequeryScreen({super.key});

  @override
  State<AdminTransactionRequeryScreen> createState() =>
      _AdminTransactionRequeryScreenState();
}

class _AdminTransactionRequeryScreenState
    extends State<AdminTransactionRequeryScreen> {
  static const String _baseUrl = 'https://api.servicepay.ng/api';

  final TextEditingController _referenceController = TextEditingController();

  bool _loading = false;
  String? _error;
  Map<String, dynamic>? _result;

  Future<String?> _getToken() async {
    final prefs = await SharedPreferences.getInstance();

    final raw = prefs.getString('auth_token') ??
        prefs.getString('token') ??
        prefs.getString('admin_token');
    return raw?.replaceFirst(RegExp(r'^Bearer\s+', caseSensitive: false), '').trim();
  }

  Future<void> _requery() async {
    final reference = _referenceController.text.trim();

    if (reference.isEmpty) {
      setState(() {
        _error = 'Enter a transaction reference.';
        _result = null;
      });
      return;
    }

    setState(() {
      _loading = true;
      _error = null;
      _result = null;
    });

    try {
      final token = await _getToken();

      if (token == null || token.trim().isEmpty) {
        throw Exception('Your login session has expired.');
      }

      final response = await http
          .post(
            Uri.parse('$_baseUrl/admin/transaction-requery'),
            headers: {
              'Accept': 'application/json',
              'Content-Type': 'application/json',
              'Authorization': 'Bearer ${token.trim()}',
            },
            body: jsonEncode({
              'reference': reference,
            }),
          )
          .timeout(const Duration(seconds: 45));

      dynamic decoded;

      try {
        decoded = jsonDecode(response.body);
      } catch (_) {
        decoded = {
          'message': response.body,
        };
      }

      if (response.statusCode == 401) {
        throw Exception(
          _extractMessage(
            decoded,
            fallback: 'Your login session has expired.',
          ),
        );
      }

      if (response.statusCode == 403) {
        throw Exception(
          _extractMessage(
            decoded,
            fallback: 'HEAD OFFICE access is required.',
          ),
        );
      }

      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw Exception(
          _extractMessage(
            decoded,
            fallback: 'Requery failed with HTTP ${response.statusCode}.',
          ),
        );
      }

      final manualReview = decoded is Map && decoded['manualReviewRequired'] == true;
      final requestStillProcessing =
          decoded is Map && decoded['code'] == 'REQUERY_ALREADY_PROCESSING';
      if (manualReview || requestStillProcessing) {
        throw Exception(
          _extractMessage(
            decoded,
            fallback: 'Manual review is required. No balance change was made.',
          ),
        );
      }

      if (!mounted) return;

      setState(() {
        if (decoded is Map) {
          _result = Map<String, dynamic>.from(decoded);
        } else {
          _result = {
            'data': decoded,
          };
        }
      });
    } catch (e) {
      if (!mounted) return;

      setState(() {
        _error = e.toString().replaceFirst('Exception: ', '');
      });
    } finally {
      if (mounted) {
        setState(() {
          _loading = false;
        });
      }
    }
  }

  String _extractMessage(
    dynamic data, {
    required String fallback,
  }) {
    if (data is Map) {
      final candidates = [
        data['message'],
        data['error'],
        data['detail'],
      ];

      for (final item in candidates) {
        if (item != null && item.toString().trim().isNotEmpty) {
          return item.toString();
        }
      }
    }

    return fallback;
  }

  String _pretty(dynamic value) {
    try {
      return const JsonEncoder.withIndent('  ').convert(value);
    } catch (_) {
      return value.toString();
    }
  }

  @override
  void dispose() {
    _referenceController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    const green = Color(0xFF08783E);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Transaction Requery'),
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(24),
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(
              maxWidth: 900,
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Container(
                  padding: const EdgeInsets.all(24),
                  decoration: BoxDecoration(
                    color: green,
                    borderRadius: BorderRadius.circular(18),
                  ),
                  child: const Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'SERVICEPAY FINTECH CONTROL CENTER',
                        style: TextStyle(
                          color: Colors.white70,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                      SizedBox(height: 14),
                      Text(
                        'Transaction Requery',
                        style: TextStyle(
                          color: Colors.white,
                          fontSize: 28,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                      SizedBox(height: 6),
                      Text(
                        'Verify the latest status of a bank transaction using its ServicePay reference.',
                        style: TextStyle(
                          color: Colors.white70,
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 24),
                Card(
                  child: Padding(
                    padding: const EdgeInsets.all(22),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        const Text(
                          'Transaction Reference',
                          style: TextStyle(
                            fontSize: 17,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                        const SizedBox(height: 12),
                        TextField(
                          controller: _referenceController,
                          textInputAction: TextInputAction.search,
                          onSubmitted: (_) {
                            if (!_loading) {
                              _requery();
                            }
                          },
                          decoration: const InputDecoration(
                            hintText:
                                'Enter ServicePay / bank transfer reference',
                            border: OutlineInputBorder(),
                            prefixIcon: Icon(
                              Icons.manage_search_outlined,
                            ),
                          ),
                        ),
                        const SizedBox(height: 16),
                        FilledButton.icon(
                          onPressed: _loading ? null : _requery,
                          icon: _loading
                              ? const SizedBox(
                                  width: 18,
                                  height: 18,
                                  child: CircularProgressIndicator(
                                    strokeWidth: 2,
                                  ),
                                )
                              : const Icon(Icons.refresh),
                          label: Text(
                            _loading ? 'Requerying...' : 'Requery Transaction',
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
                if (_error != null) ...[
                  const SizedBox(height: 20),
                  Card(
                    child: Padding(
                      padding: const EdgeInsets.all(20),
                      child: Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Icon(
                            Icons.error_outline,
                            color: Colors.red,
                          ),
                          const SizedBox(width: 12),
                          Expanded(
                            child: Text(
                              _error!,
                              style: const TextStyle(
                                color: Colors.red,
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                ],
                if (_result != null) ...[
                  const SizedBox(height: 20),
                  Card(
                    child: Padding(
                      padding: const EdgeInsets.all(22),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Row(
                            children: [
                              Icon(
                                Icons.verified_outlined,
                                color: green,
                              ),
                              SizedBox(width: 10),
                              Text(
                                'Requery Result',
                                style: TextStyle(
                                  fontSize: 18,
                                  fontWeight: FontWeight.bold,
                                ),
                              ),
                            ],
                          ),
                          const SizedBox(height: 16),
                          SelectableText(
                            _pretty(_result),
                            style: const TextStyle(
                              fontFamily: 'monospace',
                              height: 1.5,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}

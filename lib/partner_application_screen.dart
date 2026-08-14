import 'dart:convert';

import 'package:flutter/material.dart';
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

  final businessNameController = TextEditingController();
  final contactNameController = TextEditingController();
  final emailController = TextEditingController();
  final phoneController = TextEditingController();

  bool loading = true;
  bool submitting = false;

  Map<String, dynamic>? application;

  String get status =>
      (application?['status'] ?? 'NOT_APPLIED').toString().toUpperCase();

  @override
  void initState() {
    super.initState();
    _loadApplication();
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
    return prefs.getString('auth_token');
  }

  Future<void> _loadApplication() async {
    try {
      final token = await _token();

      if (token == null || token.isEmpty) {
        if (mounted) {
          setState(() => loading = false);
        }
        return;
      }

      final response = await http.get(
        Uri.parse('$baseUrl/partner-applications/my'),
        headers: {
          'Authorization': 'Bearer $token',
          'Accept': 'application/json',
        },
      );

      if (response.statusCode >= 200 && response.statusCode < 300) {
        final decoded = jsonDecode(response.body);

        Map<String, dynamic>? found;

        if (decoded is Map<String, dynamic>) {
          if (decoded['application'] is Map) {
            found = Map<String, dynamic>.from(decoded['application']);
          } else if (decoded['data'] is Map) {
            found = Map<String, dynamic>.from(decoded['data']);
          } else if (decoded['status'] != null ||
              decoded['businessName'] != null) {
            found = decoded;
          }
        }

        if (mounted) {
          setState(() {
            application = found;
            loading = false;
          });
        }
        return;
      }

      if (response.statusCode == 404) {
        if (mounted) {
          setState(() {
            application = null;
            loading = false;
          });
        }
        return;
      }

      if (mounted) {
        setState(() => loading = false);
      }
    } catch (_) {
      if (mounted) {
        setState(() => loading = false);
      }
    }
  }

  String _messageFrom(dynamic decoded, String fallback) {
    if (decoded is Map) {
      final value = decoded['message'] ?? decoded['error'] ?? decoded['detail'];
      if (value != null && value.toString().trim().isNotEmpty) {
        return value.toString();
      }
    }
    return fallback;
  }

  Future<void> _submit() async {
    final businessName = businessNameController.text.trim();
    final contactName = contactNameController.text.trim();
    final email = emailController.text.trim();
    final phone = phoneController.text.trim();

    if (businessName.isEmpty ||
        contactName.isEmpty ||
        email.isEmpty ||
        phone.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Please complete all required fields.'),
        ),
      );
      return;
    }

    setState(() => submitting = true);

    try {
      final token = await _token();

      if (token == null || token.isEmpty) {
        throw Exception('Please login again.');
      }

      final response = await http.post(
        Uri.parse('$baseUrl/partner-applications/apply'),
        headers: {
          'Authorization': 'Bearer $token',
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: jsonEncode({
          'businessName': businessName,
          'contactName': contactName,
          'email': email,
          'phone': phone,
        }),
      );

      dynamic decoded;
      try {
        decoded = jsonDecode(response.body);
      } catch (_) {
        decoded = null;
      }

      if (response.statusCode >= 200 && response.statusCode < 300) {
        if (!mounted) return;

        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              _messageFrom(
                decoded,
                'Partner application submitted successfully.',
              ),
            ),
          ),
        );

        businessNameController.clear();
        contactNameController.clear();
        emailController.clear();
        phoneController.clear();

        await _loadApplication();
        return;
      }

      if (!mounted) return;

      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            _messageFrom(
              decoded,
              'Unable to submit partner application.',
            ),
          ),
        ),
      );
    } catch (error) {
      if (!mounted) return;

      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            error.toString().replaceFirst('Exception: ', ''),
          ),
        ),
      );
    } finally {
      if (mounted) {
        setState(() => submitting = false);
      }
    }
  }

  Color _statusColor() {
    switch (status) {
      case 'APPROVED':
        return Colors.green;
      case 'REJECTED':
        return Colors.red;
      case 'PENDING':
        return Colors.orange;
      default:
        return Colors.blueGrey;
    }
  }

  Widget _statusCard() {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: _statusColor().withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(18),
        border: Border.all(
          color: _statusColor().withValues(alpha: 0.25),
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(
                status == 'APPROVED'
                    ? Icons.verified_rounded
                    : status == 'REJECTED'
                        ? Icons.cancel_rounded
                        : Icons.schedule_rounded,
                color: _statusColor(),
              ),
              const SizedBox(width: 10),
              Text(
                'Application Status: $status',
                style: TextStyle(
                  fontSize: 16,
                  fontWeight: FontWeight.w800,
                  color: _statusColor(),
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          Text(
            status == 'APPROVED'
                ? 'Your ServicePay Partner application has been approved.'
                : status == 'REJECTED'
                    ? 'Your application was not approved. Contact ServicePay support if you need clarification.'
                    : 'Your application is under review by ServicePay Head Office.',
            style: const TextStyle(
              height: 1.45,
              color: Color(0xFF475569),
            ),
          ),
          if (status == 'APPROVED') ...[
            const SizedBox(height: 12),
            const Text(
              'API credentials are issued securely after approval. Keep your API Secret private.',
              style: TextStyle(
                fontWeight: FontWeight.w600,
                color: Color(0xFF334155),
              ),
            ),
          ],
        ],
      ),
    );
  }

  Widget _field({
    required TextEditingController controller,
    required String label,
    required IconData icon,
    TextInputType? keyboardType,
  }) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 14),
      child: TextField(
        controller: controller,
        keyboardType: keyboardType,
        decoration: InputDecoration(
          labelText: label,
          prefixIcon: Icon(icon),
          filled: true,
          fillColor: Colors.white,
          border: OutlineInputBorder(
            borderRadius: BorderRadius.circular(16),
          ),
          enabledBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(16),
            borderSide: const BorderSide(
              color: Color(0xFFE2E8F0),
            ),
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    const green = Color(0xFF08783E);

    return Scaffold(
      backgroundColor: const Color(0xFFF8FAFC),
      appBar: AppBar(
        title: const Text('ServicePay Partner API'),
        backgroundColor: green,
        foregroundColor: Colors.white,
      ),
      body: loading
          ? const Center(
              child: CircularProgressIndicator(),
            )
          : RefreshIndicator(
              onRefresh: _loadApplication,
              child: ListView(
                padding: const EdgeInsets.all(18),
                children: [
                  Container(
                    padding: const EdgeInsets.all(20),
                    decoration: BoxDecoration(
                      gradient: const LinearGradient(
                        colors: [
                          Color(0xFF08783E),
                          Color(0xFF0F9D58),
                        ],
                      ),
                      borderRadius: BorderRadius.circular(22),
                    ),
                    child: const Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Icon(
                          Icons.handshake_rounded,
                          size: 38,
                          color: Colors.white,
                        ),
                        SizedBox(height: 12),
                        Text(
                          'Become a ServicePay API Partner',
                          style: TextStyle(
                            color: Colors.white,
                            fontSize: 21,
                            fontWeight: FontWeight.w800,
                          ),
                        ),
                        SizedBox(height: 8),
                        Text(
                          'Connect your business or platform to approved ServicePay services through our Partner API.',
                          style: TextStyle(
                            color: Colors.white,
                            height: 1.45,
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 18),
                  if (application != null) ...[
                    _statusCard(),
                    const SizedBox(height: 18),
                  ],
                  if (application == null || status == 'REJECTED') ...[
                    const Text(
                      'Partner Application',
                      style: TextStyle(
                        fontSize: 19,
                        fontWeight: FontWeight.w800,
                        color: Color(0xFF0F172A),
                      ),
                    ),
                    const SizedBox(height: 6),
                    const Text(
                      'Submit your business details. ServicePay Head Office will review your application before API access is activated.',
                      style: TextStyle(
                        color: Color(0xFF64748B),
                        height: 1.4,
                      ),
                    ),
                    const SizedBox(height: 18),
                    _field(
                      controller: businessNameController,
                      label: 'Business / Company Name',
                      icon: Icons.business_rounded,
                    ),
                    _field(
                      controller: contactNameController,
                      label: 'Contact Person',
                      icon: Icons.person_rounded,
                    ),
                    _field(
                      controller: emailController,
                      label: 'Business Email',
                      icon: Icons.email_rounded,
                      keyboardType: TextInputType.emailAddress,
                    ),
                    _field(
                      controller: phoneController,
                      label: 'Phone Number',
                      icon: Icons.phone_rounded,
                      keyboardType: TextInputType.phone,
                    ),
                    const SizedBox(height: 4),
                    SizedBox(
                      height: 54,
                      child: ElevatedButton.icon(
                        onPressed: submitting ? null : _submit,
                        icon: submitting
                            ? const SizedBox(
                                width: 20,
                                height: 20,
                                child: CircularProgressIndicator(
                                  strokeWidth: 2,
                                ),
                              )
                            : const Icon(Icons.send_rounded),
                        label: Text(
                          submitting
                              ? 'Submitting...'
                              : 'Submit Partner Application',
                        ),
                        style: ElevatedButton.styleFrom(
                          backgroundColor: green,
                          foregroundColor: Colors.white,
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(16),
                          ),
                        ),
                      ),
                    ),
                  ],
                ],
              ),
            ),
    );
  }
}

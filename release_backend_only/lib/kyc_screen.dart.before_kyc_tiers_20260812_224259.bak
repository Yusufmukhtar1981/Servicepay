import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

class KycScreen extends StatefulWidget {
  const KycScreen({super.key});

  @override
  State<KycScreen> createState() => _KycScreenState();
}

class _KycScreenState extends State<KycScreen> {
  static const String baseUrl = 'https://api.servicepay.ng/api';

  final _formKey = GlobalKey<FormState>();

  final firstNameController = TextEditingController();
  final middleNameController = TextEditingController();
  final lastNameController = TextEditingController();
  final addressController = TextEditingController();
  final stateController = TextEditingController();
  final lgaController = TextEditingController();

  DateTime? dateOfBirth;
  String gender = '';
  String status = 'NOT_STARTED';
  String level = 'TIER_1';
  String rejectionReason = '';

  bool isLoading = true;
  bool isSubmitting = false;

  @override
  void initState() {
    super.initState();
    _loadKyc();
  }

  @override
  void dispose() {
    firstNameController.dispose();
    middleNameController.dispose();
    lastNameController.dispose();
    addressController.dispose();
    stateController.dispose();
    lgaController.dispose();
    super.dispose();
  }

  Future<String?> _getToken() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getString('auth_token');
  }

  Future<void> _loadKyc() async {
    try {
      final token = await _getToken();

      if (token == null || token.isEmpty) {
        if (!mounted) return;
        setState(() => isLoading = false);
        _showMessage('Please log in again.');
        return;
      }

      final response = await http.get(
        Uri.parse('$baseUrl/kyc/status'),
        headers: {
          'Authorization': 'Bearer $token',
          'Content-Type': 'application/json',
        },
      );

      final body = jsonDecode(response.body);

      if (response.statusCode >= 200 &&
          response.statusCode < 300 &&
          body['success'] == true) {
        final kyc = body['kyc'] ?? {};

        firstNameController.text = (kyc['firstName'] ?? '').toString();
        middleNameController.text = (kyc['middleName'] ?? '').toString();
        lastNameController.text = (kyc['lastName'] ?? '').toString();
        addressController.text = (kyc['address'] ?? '').toString();
        stateController.text = (kyc['state'] ?? '').toString();
        lgaController.text = (kyc['lga'] ?? '').toString();

        final dob = kyc['dateOfBirth'];
        if (dob != null && dob.toString().isNotEmpty) {
          dateOfBirth = DateTime.tryParse(dob.toString());
        }

        final loadedGender = (kyc['gender'] ?? '').toString().toUpperCase();

        if (['MALE', 'FEMALE', 'OTHER'].contains(loadedGender)) {
          gender = loadedGender;
        }

        status = (kyc['status'] ?? 'NOT_STARTED').toString();
        level = (kyc['level'] ?? 'TIER_1').toString();
        rejectionReason = (kyc['rejectionReason'] ?? '').toString();
      } else {
        _showMessage(
          (body['message'] ?? 'Unable to load KYC.').toString(),
        );
      }
    } catch (e) {
      _showMessage('Unable to load KYC. Please try again.');
    } finally {
      if (mounted) {
        setState(() => isLoading = false);
      }
    }
  }

  Future<void> _pickDate() async {
    final now = DateTime.now();

    final picked = await showDatePicker(
      context: context,
      initialDate: dateOfBirth ?? DateTime(now.year - 25, now.month, now.day),
      firstDate: DateTime(1900),
      lastDate: DateTime(now.year - 18, now.month, now.day),
    );

    if (picked != null) {
      setState(() => dateOfBirth = picked);
    }
  }

  Future<void> _submitKyc() async {
    if (!_formKey.currentState!.validate()) return;

    if (dateOfBirth == null) {
      _showMessage('Please select your date of birth.');
      return;
    }

    if (gender.isEmpty) {
      _showMessage('Please select your gender.');
      return;
    }

    setState(() => isSubmitting = true);

    try {
      final token = await _getToken();

      if (token == null || token.isEmpty) {
        _showMessage('Please log in again.');
        return;
      }

      final payload = {
        'firstName': firstNameController.text.trim(),
        'middleName': middleNameController.text.trim(),
        'lastName': lastNameController.text.trim(),
        'dateOfBirth': dateOfBirth!.toIso8601String(),
        'gender': gender,
        'address': addressController.text.trim(),
        'state': stateController.text.trim(),
        'lga': lgaController.text.trim(),
      };

      final response = await http.post(
        Uri.parse('$baseUrl/kyc/submit'),
        headers: {
          'Authorization': 'Bearer $token',
          'Content-Type': 'application/json',
        },
        body: jsonEncode(payload),
      );

      final body = jsonDecode(response.body);

      if (response.statusCode >= 200 &&
          response.statusCode < 300 &&
          body['success'] == true) {
        final kyc = body['kyc'] ?? {};

        setState(() {
          status = (kyc['status'] ?? 'PENDING').toString();
          level = (kyc['level'] ?? 'TIER_1').toString();
          rejectionReason = (kyc['rejectionReason'] ?? '').toString();
        });

        _showMessage(
          (body['message'] ?? 'KYC submitted successfully.').toString(),
        );
      } else {
        _showMessage(
          (body['message'] ?? 'Unable to submit KYC.').toString(),
        );
      }
    } catch (e) {
      _showMessage(
        'Unable to submit KYC. Please try again.',
      );
    } finally {
      if (mounted) {
        setState(() => isSubmitting = false);
      }
    }
  }

  void _showMessage(String message) {
    if (!mounted) return;

    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(message)),
    );
  }

  Color _statusColor() {
    switch (status) {
      case 'VERIFIED':
        return Colors.green;
      case 'REJECTED':
        return Colors.red;
      case 'UNDER_REVIEW':
        return Colors.orange;
      case 'PENDING':
        return Colors.blue;
      default:
        return Colors.grey;
    }
  }

  IconData _statusIcon() {
    switch (status) {
      case 'VERIFIED':
        return Icons.verified_rounded;
      case 'REJECTED':
        return Icons.cancel_rounded;
      case 'UNDER_REVIEW':
        return Icons.manage_search_rounded;
      case 'PENDING':
        return Icons.hourglass_top_rounded;
      default:
        return Icons.person_search_rounded;
    }
  }

  String _statusLabel() {
    return status
        .replaceAll('_', ' ')
        .split(' ')
        .map(
          (e) => e.isEmpty
              ? e
              : '${e[0].toUpperCase()}${e.substring(1).toLowerCase()}',
        )
        .join(' ');
  }

  String _formatDate(DateTime date) {
    final day = date.day.toString().padLeft(2, '0');
    final month = date.month.toString().padLeft(2, '0');
    return '$day/$month/${date.year}';
  }

  @override
  Widget build(BuildContext context) {
    const primary = Color(0xFF08783E);

    return Scaffold(
      appBar: AppBar(
        title: const Text('KYC Verification'),
        backgroundColor: primary,
        foregroundColor: Colors.white,
      ),
      body: isLoading
          ? const Center(
              child: CircularProgressIndicator(),
            )
          : RefreshIndicator(
              onRefresh: _loadKyc,
              child: ListView(
                padding: const EdgeInsets.all(16),
                children: [
                  Container(
                    padding: const EdgeInsets.all(18),
                    decoration: BoxDecoration(
                      color: _statusColor().withValues(alpha: 0.08),
                      borderRadius: BorderRadius.circular(18),
                      border: Border.all(
                        color: _statusColor().withValues(alpha: 0.25),
                      ),
                    ),
                    child: Row(
                      children: [
                        CircleAvatar(
                          radius: 27,
                          backgroundColor:
                              _statusColor().withValues(alpha: 0.15),
                          child: Icon(
                            _statusIcon(),
                            color: _statusColor(),
                            size: 30,
                          ),
                        ),
                        const SizedBox(width: 14),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              const Text(
                                'Verification Status',
                                style: TextStyle(
                                  fontSize: 13,
                                  color: Colors.black54,
                                ),
                              ),
                              const SizedBox(height: 4),
                              Text(
                                _statusLabel(),
                                style: TextStyle(
                                  fontSize: 19,
                                  fontWeight: FontWeight.bold,
                                  color: _statusColor(),
                                ),
                              ),
                              const SizedBox(height: 4),
                              Text(
                                'Current level: ${level.replaceAll('_', ' ')}',
                                style: const TextStyle(
                                  fontSize: 13,
                                ),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ),
                  if (status == 'REJECTED' && rejectionReason.isNotEmpty) ...[
                    const SizedBox(height: 14),
                    Container(
                      padding: const EdgeInsets.all(14),
                      decoration: BoxDecoration(
                        color: Colors.red.shade50,
                        borderRadius: BorderRadius.circular(14),
                      ),
                      child: Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Icon(
                            Icons.info_outline,
                            color: Colors.red,
                          ),
                          const SizedBox(width: 10),
                          Expanded(
                            child: Text(
                              'Reason: $rejectionReason',
                              style: const TextStyle(
                                color: Colors.red,
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                  const SizedBox(height: 22),
                  const Text(
                    'Personal Information',
                    style: TextStyle(
                      fontSize: 18,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                  const SizedBox(height: 14),
                  Form(
                    key: _formKey,
                    child: Column(
                      children: [
                        _textField(
                          controller: firstNameController,
                          label: 'First Name',
                          icon: Icons.person_outline,
                          required: true,
                        ),
                        _textField(
                          controller: middleNameController,
                          label: 'Middle Name',
                          icon: Icons.person_outline,
                        ),
                        _textField(
                          controller: lastNameController,
                          label: 'Last Name',
                          icon: Icons.person_outline,
                          required: true,
                        ),
                        InkWell(
                          onTap: _pickDate,
                          borderRadius: BorderRadius.circular(14),
                          child: InputDecorator(
                            decoration: const InputDecoration(
                              labelText: 'Date of Birth',
                              prefixIcon: Icon(Icons.cake_outlined),
                              border: OutlineInputBorder(),
                            ),
                            child: Text(
                              dateOfBirth == null
                                  ? 'Select date'
                                  : _formatDate(
                                      dateOfBirth!,
                                    ),
                            ),
                          ),
                        ),
                        const SizedBox(height: 14),
                        DropdownButtonFormField<String>(
                          initialValue: gender.isEmpty ? null : gender,
                          decoration: const InputDecoration(
                            labelText: 'Gender',
                            prefixIcon: Icon(Icons.people_outline),
                            border: OutlineInputBorder(),
                          ),
                          items: const [
                            DropdownMenuItem(
                              value: 'MALE',
                              child: Text('Male'),
                            ),
                            DropdownMenuItem(
                              value: 'FEMALE',
                              child: Text('Female'),
                            ),
                            DropdownMenuItem(
                              value: 'OTHER',
                              child: Text('Other'),
                            ),
                          ],
                          onChanged: (value) {
                            setState(() {
                              gender = value ?? '';
                            });
                          },
                        ),
                        const SizedBox(height: 14),
                        _textField(
                          controller: addressController,
                          label: 'Residential Address',
                          icon: Icons.home_outlined,
                          required: true,
                          maxLines: 2,
                        ),
                        _textField(
                          controller: stateController,
                          label: 'State',
                          icon: Icons.location_on_outlined,
                          required: true,
                        ),
                        _textField(
                          controller: lgaController,
                          label: 'LGA',
                          icon: Icons.map_outlined,
                        ),
                        const SizedBox(height: 8),
                        Container(
                          width: double.infinity,
                          padding: const EdgeInsets.all(14),
                          decoration: BoxDecoration(
                            color: Colors.green.shade50,
                            borderRadius: BorderRadius.circular(14),
                          ),
                          child: const Row(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Icon(
                                Icons.security_rounded,
                                color: primary,
                              ),
                              SizedBox(width: 10),
                              Expanded(
                                child: Text(
                                  'Your NIN/BVN will be linked securely through ServicePay verification. Raw identity numbers are not stored in this KYC form.',
                                  style: TextStyle(
                                    fontSize: 13,
                                  ),
                                ),
                              ),
                            ],
                          ),
                        ),
                        const SizedBox(height: 22),
                        SizedBox(
                          width: double.infinity,
                          height: 52,
                          child: ElevatedButton.icon(
                            onPressed: isSubmitting ? null : _submitKyc,
                            icon: isSubmitting
                                ? const SizedBox(
                                    width: 20,
                                    height: 20,
                                    child: CircularProgressIndicator(
                                      strokeWidth: 2,
                                    ),
                                  )
                                : const Icon(
                                    Icons.verified_user_outlined,
                                  ),
                            label: Text(
                              isSubmitting
                                  ? 'Submitting...'
                                  : status == 'VERIFIED'
                                      ? 'Update KYC Information'
                                      : 'Submit KYC',
                            ),
                            style: ElevatedButton.styleFrom(
                              backgroundColor: primary,
                              foregroundColor: Colors.white,
                              shape: RoundedRectangleBorder(
                                borderRadius: BorderRadius.circular(
                                  14,
                                ),
                              ),
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 20),
                ],
              ),
            ),
    );
  }

  Widget _textField({
    required TextEditingController controller,
    required String label,
    required IconData icon,
    bool required = false,
    int maxLines = 1,
  }) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 14),
      child: TextFormField(
        controller: controller,
        maxLines: maxLines,
        validator: (value) {
          if (required && (value == null || value.trim().isEmpty)) {
            return '$label is required';
          }
          return null;
        },
        decoration: InputDecoration(
          labelText: label,
          prefixIcon: Icon(icon),
          border: const OutlineInputBorder(),
        ),
      ),
    );
  }
}

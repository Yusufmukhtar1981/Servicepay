import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;

import 'services/session_store.dart';
import 'widgets/registration_details_fields.dart';

class CreateAgentScreen extends StatefulWidget {
  const CreateAgentScreen({super.key});

  @override
  State<CreateAgentScreen> createState() => _CreateAgentScreenState();
}

class _CreateAgentScreenState extends State<CreateAgentScreen> {
  static const String baseUrl = 'https://api.servicepay.ng/api';

  static const Color primaryGreen = Color(0xFF08783E);

  final GlobalKey<FormState> formKey = GlobalKey<FormState>();

  final TextEditingController fullNameController = TextEditingController();

  final TextEditingController phoneController = TextEditingController();

  final TextEditingController emailController = TextEditingController();

  final TextEditingController lgaController = TextEditingController();

  final TextEditingController passwordController = TextEditingController();
  final TextEditingController confirmPasswordController = TextEditingController();

  bool isSaving = false;
  bool hidePassword = true;

  @override
  void dispose() {
    fullNameController.dispose();
    phoneController.dispose();
    emailController.dispose();
    lgaController.dispose();
    passwordController.dispose();
    confirmPasswordController.dispose();
    super.dispose();
  }

  Future<String?> getSavedToken() async {
    return SessionStore.readToken();
  }

  void showMessage(
    String message, {
    bool isError = true,
  }) {
    if (!mounted) {
      return;
    }

    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(
        SnackBar(
          backgroundColor: isError ? const Color(0xFFB42318) : primaryGreen,
          content: Text(message),
        ),
      );
  }

  String? validateRequired(
    String? value,
    String fieldName,
  ) {
    if (value == null || value.trim().isEmpty) {
      return '$fieldName is required.';
    }

    return null;
  }

  String? validatePhone(String? value) {
    return RegistrationValidators.phone(value);
  }

  String? validateEmail(String? value) {
    final String email = (value ?? '').toString().trim();

    if (email.isEmpty) {
      return null;
    }

    final bool validEmail = RegExp(
      r'^[^@\s]+@[^@\s]+\.[^@\s]+$',
    ).hasMatch(email);

    if (!validEmail) {
      return 'Enter a valid email address.';
    }

    return null;
  }

  String? validatePassword(String? value) {
    final String password = (value ?? '').toString();

    if (password.isEmpty) {
      return 'Temporary password is required.';
    }

    if (password.length < 6) {
      return 'Password must be at least 6 characters.';
    }

    return null;
  }

  Future<void> createAgent() async {
    if (isSaving) {
      return;
    }

    final FormState? form = formKey.currentState;

    if (form == null || !form.validate()) {
      return;
    }

    FocusScope.of(context).unfocus();

    setState(() {
      isSaving = true;
    });

    try {
      final String? token = await getSavedToken();

      if (token == null || token.isEmpty) {
        throw Exception(
          'Your login session has expired. Please sign in again.',
        );
      }

      final Uri uri = Uri.parse(
        '$baseUrl/management/aggregators',
      );

      final http.Response response = await http
          .post(
            uri,
            headers: {
              'Accept': 'application/json',
              'Content-Type': 'application/json',
              'Authorization': 'Bearer $token',
            },
            body: jsonEncode({
              'fullName': fullNameController.text.trim(),
              'phone': normalizeNigerianPhone(phoneController.text)!,
              'email': emailController.text.trim(),
              'lga': lgaController.text.trim(),
              'password': passwordController.text,
            }),
          )
          .timeout(
            const Duration(seconds: 45),
          );

      dynamic decoded;

      try {
        decoded = jsonDecode(response.body);
      } catch (_) {
        decoded = null;
      }

      final Map<String, dynamic> result = decoded is Map
          ? Map<String, dynamic>.from(
              decoded,
            )
          : <String, dynamic>{};

      final String message = result['message']?.toString().trim() ??
          'Unable to create Aggregator.';

      if (response.statusCode >= 200 &&
          response.statusCode < 300 &&
          result['success'] == true) {
        if (!mounted) {
          return;
        }

        showMessage(
          message,
          isError: false,
        );

        await Future<void>.delayed(
          const Duration(milliseconds: 700),
        );

        if (!mounted) {
          return;
        }

        Navigator.of(context).pop(true);
        return;
      }

      throw Exception(message);
    } on TimeoutException {
      showMessage(
        'The server took too long to respond. Please try again.',
      );
    } catch (error) {
      final String message = error.toString().replaceFirst(
            'Exception: ',
            '',
          );

      showMessage(message);
    } finally {
      if (mounted) {
        setState(() {
          isSaving = false;
        });
      }
    }
  }

  InputDecoration fieldDecoration({
    required String label,
    required IconData icon,
    String? hint,
    Widget? suffixIcon,
  }) {
    return InputDecoration(
      labelText: label,
      hintText: hint,
      prefixIcon: Icon(
        icon,
        color: primaryGreen,
      ),
      suffixIcon: suffixIcon,
      filled: true,
      fillColor: Colors.white,
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(16),
        borderSide: const BorderSide(
          color: Color(0xFFE4E7EC),
        ),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(16),
        borderSide: const BorderSide(
          color: Color(0xFFE4E7EC),
        ),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(16),
        borderSide: const BorderSide(
          color: primaryGreen,
          width: 1.7,
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF7F9FB),
      appBar: AppBar(
        title: const Text(
          'Create Aggregator',
        ),
        backgroundColor: Colors.white,
        foregroundColor: const Color(0xFF101828),
        elevation: 0,
      ),
      body: SafeArea(
        child: Form(
          key: formKey,
          child: ListView(
            padding: const EdgeInsets.fromLTRB(
              17,
              18,
              17,
              35,
            ),
            children: [
              Container(
                padding: const EdgeInsets.all(18),
                decoration: BoxDecoration(
                  gradient: const LinearGradient(
                    colors: [
                      Color(0xFF004E2C),
                      primaryGreen,
                      Color(0xFF12A85B),
                    ],
                  ),
                  borderRadius: BorderRadius.circular(22),
                  boxShadow: const [
                    BoxShadow(
                      color: Color(0x29004E2C),
                      blurRadius: 20,
                      offset: Offset(0, 9),
                    ),
                  ],
                ),
                child: const Row(
                  children: [
                    CircleAvatar(
                      radius: 25,
                      backgroundColor: Color(0x26FFFFFF),
                      child: Icon(
                        Icons.support_agent_rounded,
                        color: Colors.white,
                        size: 29,
                      ),
                    ),
                    SizedBox(width: 13),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'New Aggregator',
                            style: TextStyle(
                              color: Colors.white,
                              fontSize: 18,
                              fontWeight: FontWeight.w900,
                            ),
                          ),
                          SizedBox(height: 4),
                          Text(
                            'The account will be linked automatically to your State Manager account.',
                            style: TextStyle(
                              color: Color(0xFFD9F7E6),
                              fontSize: 12,
                              height: 1.35,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 21),
              FullNameField(
                controller: fullNameController,
                validator: (String? value) => validateRequired(
                  value,
                  'Full name',
                ),
              ),
              const SizedBox(height: 14),
              NigerianPhoneField(
                controller: phoneController,
                validator: validatePhone,
              ),
              const SizedBox(height: 14),
              EmailField(
                controller: emailController,
                label: 'Email Address (Optional)',
                validator: validateEmail,
              ),
              const SizedBox(height: 14),
              TextFormField(
                controller: lgaController,
                textCapitalization: TextCapitalization.words,
                decoration: fieldDecoration(
                  label: 'LGA (Optional)',
                  icon: Icons.map_outlined,
                  hint: 'Enter LGA',
                ),
              ),
              const SizedBox(height: 14),
              PasswordField(
                controller: passwordController,
                label: 'Temporary Password',
                validator: validatePassword,
              ),
              ConfirmPasswordField(
                controller: confirmPasswordController,
                passwordController: passwordController,
              ),
              const SizedBox(height: 9),
              Container(
                padding: const EdgeInsets.all(13),
                decoration: BoxDecoration(
                  color: const Color(0xFFEAF7F0),
                  borderRadius: BorderRadius.circular(15),
                ),
                child: const Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Icon(
                      Icons.info_outline_rounded,
                      color: primaryGreen,
                      size: 20,
                    ),
                    SizedBox(width: 9),
                    Expanded(
                      child: Text(
                        'The Aggregator can change the temporary password after signing in.',
                        style: TextStyle(
                          color: Color(0xFF344054),
                          fontSize: 12,
                          height: 1.35,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 22),
              SizedBox(
                height: 55,
                child: FilledButton.icon(
                  onPressed: isSaving ? null : createAgent,
                  style: FilledButton.styleFrom(
                    backgroundColor: primaryGreen,
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(
                        17,
                      ),
                    ),
                  ),
                  icon: isSaving
                      ? const SizedBox(
                          width: 21,
                          height: 21,
                          child: CircularProgressIndicator(
                            strokeWidth: 2.3,
                            color: Colors.white,
                          ),
                        )
                      : const Icon(
                          Icons.person_add_alt_1_rounded,
                        ),
                  label: Text(
                    isSaving ? 'Creating Aggregator...' : 'Create Aggregator',
                    style: const TextStyle(
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

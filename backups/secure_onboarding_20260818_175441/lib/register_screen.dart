import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;

class RegisterScreen extends StatefulWidget {
  const RegisterScreen({
    super.key,
  });

  @override
  State<RegisterScreen> createState() => _RegisterScreenState();
}

class _RegisterScreenState extends State<RegisterScreen> {
  static const String baseUrl = 'https://api.servicepay.ng/api';

  static const Color primaryColor = Color(0xFF0F766E);

  final TextEditingController fullNameController = TextEditingController();

  final TextEditingController phoneController = TextEditingController();

  final TextEditingController referralCodeController = TextEditingController();

  final TextEditingController emailController = TextEditingController();

  final TextEditingController passwordController = TextEditingController();

  final TextEditingController confirmPasswordController =
      TextEditingController();

  bool hidePassword = true;
  bool hideConfirmPassword = true;
  bool isLoading = false;

  @override
  void dispose() {
    referralCodeController.dispose();
    fullNameController.dispose();
    phoneController.dispose();
    emailController.dispose();
    passwordController.dispose();
    confirmPasswordController.dispose();
    super.dispose();
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
          content: Text(
            message,
          ),
          behavior: SnackBarBehavior.floating,
          duration: const Duration(
            seconds: 4,
          ),
          backgroundColor: isError ? Colors.red.shade700 : primaryColor,
        ),
      );
  }

  bool validateFields() {
    final String fullName = fullNameController.text.trim();

    final String phone = phoneController.text.replaceAll(
      RegExp(r'\D'),
      '',
    );

    final String email = emailController.text.trim();

    final String password = passwordController.text;

    final String confirmPassword = confirmPasswordController.text;

    if (fullName.isEmpty ||
        phone.isEmpty ||
        email.isEmpty ||
        password.isEmpty ||
        confirmPassword.isEmpty) {
      showMessage(
        'Please complete all the fields.',
      );

      return false;
    }

    if (fullName.length < 3 || !fullName.contains(' ')) {
      showMessage(
        'Please enter your full name.',
      );

      return false;
    }

    if (phone.length != 11) {
      showMessage(
        'Please enter a valid 11-digit phone number.',
      );

      return false;
    }

    final RegExp emailPattern = RegExp(
      r'^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$',
    );

    if (!emailPattern.hasMatch(
      email,
    )) {
      showMessage(
        'Please enter a valid email address.',
      );

      return false;
    }

    if (password.length < 6) {
      showMessage(
        'Password must be at least 6 characters.',
      );

      return false;
    }

    if (password != confirmPassword) {
      showMessage(
        'Passwords do not match.',
      );

      return false;
    }

    return true;
  }

  Future<void> registerCustomer() async {
    if (!validateFields()) {
      return;
    }

    FocusScope.of(context).unfocus();

    setState(() {
      isLoading = true;
    });

    try {
      final Uri endpoint = Uri.parse(
        '$baseUrl/auth/register',
      );

      final String phone = phoneController.text.replaceAll(
        RegExp(r'\D'),
        '',
      );

      final http.Response response = await http
          .post(
            endpoint,
            headers: const {
              'Content-Type': 'application/json',
              'Accept': 'application/json',
            },
            body: jsonEncode({
              'fullName': fullNameController.text.trim(),
              'phone': phone,
              'email': emailController.text.trim().toLowerCase(),
              'password': passwordController.text,
              'referralCode': referralCodeController.text.trim().toUpperCase(),
              'role': 'CUSTOMER',
            }),
          )
          .timeout(
            const Duration(
              seconds: 30,
            ),
          );

      final String responseBody = response.body.trim();

      if (responseBody.isEmpty) {
        showMessage(
          'The server returned an empty response. Please try again.',
        );

        return;
      }

      final dynamic decodedResponse = jsonDecode(
        responseBody,
      );

      if (decodedResponse is! Map) {
        showMessage(
          'The server returned an invalid response.',
        );

        return;
      }

      final Map<String, dynamic> result = Map<String, dynamic>.from(
        decodedResponse,
      );

      final String serverMessage = result['message']?.toString().trim() ?? '';

      final bool success = response.statusCode >= 200 &&
          response.statusCode < 300 &&
          (result['success'] == true || result['success'] == null);

      if (!success) {
        showMessage(
          serverMessage.isNotEmpty
              ? serverMessage
              : 'Unable to create account.',
        );

        return;
      }

      showMessage(
        serverMessage.isNotEmpty
            ? serverMessage
            : 'Account created successfully.',
        isError: false,
      );

      if (!mounted) {
        return;
      }

      await Future<void>.delayed(
        const Duration(
          milliseconds: 700,
        ),
      );

      if (!mounted) {
        return;
      }

      Navigator.pop(context);
    } on TimeoutException {
      showMessage(
        'The server took too long to respond. Please try again.',
      );
    } on FormatException {
      showMessage(
        'The server returned an invalid response.',
      );
    } on http.ClientException {
      showMessage(
        'Unable to connect to the ServicePay server.',
      );
    } catch (error) {
      debugPrint(
        'Registration error: $error',
      );

      showMessage(
        'Something went wrong. Please try again.',
      );
    } finally {
      if (mounted) {
        setState(() {
          isLoading = false;
        });
      }
    }
  }

  Widget buildServicePayLogo() {
    return SizedBox(
      width: 210,
      height: 130,
      child: Image.asset(
        'assets/image/servicepay_logo.png',
        fit: BoxFit.contain,
        filterQuality: FilterQuality.high,
        gaplessPlayback: true,
        errorBuilder: (
          BuildContext context,
          Object error,
          StackTrace? stackTrace,
        ) {
          debugPrint(
            'SERVICEPAY LOGO ERROR: $error',
          );

          return const Center(
            child: Text(
              'ServicePay',
              textAlign: TextAlign.center,
              style: TextStyle(
                fontSize: 32,
                fontWeight: FontWeight.w900,
                color: primaryColor,
              ),
            ),
          );
        },
      ),
    );
  }

  InputDecoration buildInputDecoration({
    required String label,
    required String hint,
    required IconData icon,
    Widget? suffixIcon,
  }) {
    return InputDecoration(
      labelText: label,
      hintText: hint,
      prefixIcon: Icon(
        icon,
      ),
      suffixIcon: suffixIcon,
      filled: true,
      fillColor: const Color(
        0xFFF8FAFC,
      ),
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(
          14,
        ),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(
          14,
        ),
        borderSide: const BorderSide(
          color: Color(
            0xFFE2E8F0,
          ),
        ),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(
          14,
        ),
        borderSide: const BorderSide(
          color: primaryColor,
          width: 2,
        ),
      ),
      errorBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(
          14,
        ),
        borderSide: const BorderSide(
          color: Colors.red,
        ),
      ),
    );
  }

  @override
  Widget build(
    BuildContext context,
  ) {
    return Scaffold(
      backgroundColor: const Color(
        0xFFF4F7F9,
      ),
      appBar: AppBar(
        title: const Text(
          'Create account',
          style: TextStyle(
            fontWeight: FontWeight.w700,
          ),
        ),
        centerTitle: true,
        backgroundColor: Colors.white,
        foregroundColor: const Color(
          0xFF172033,
        ),
        elevation: 0,
        surfaceTintColor: Colors.white,
      ),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(
            22,
          ),
          child: Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(
                maxWidth: 460,
              ),
              child: Container(
                decoration: BoxDecoration(
                  color: Colors.white,
                  borderRadius: BorderRadius.circular(
                    26,
                  ),
                  border: Border.all(
                    color: const Color(
                      0xFFE2E8F0,
                    ),
                  ),
                  boxShadow: [
                    BoxShadow(
                      color: Colors.black.withValues(
                        alpha: 0.07,
                      ),
                      blurRadius: 24,
                      offset: const Offset(
                        0,
                        10,
                      ),
                    ),
                  ],
                ),
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(
                    28,
                    20,
                    28,
                    30,
                  ),
                  child: AutofillGroup(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        Center(
                          child: buildServicePayLogo(),
                        ),
                        const SizedBox(
                          height: 2,
                        ),
                        const Text(
                          'Join ServicePay',
                          textAlign: TextAlign.center,
                          style: TextStyle(
                            fontSize: 25,
                            fontWeight: FontWeight.w800,
                            color: Color(
                              0xFF172033,
                            ),
                          ),
                        ),
                        const SizedBox(
                          height: 7,
                        ),
                        Text(
                          'Create your customer account and access everyday services.',
                          textAlign: TextAlign.center,
                          style: TextStyle(
                            fontSize: 14,
                            height: 1.45,
                            color: Colors.grey.shade600,
                          ),
                        ),
                        const SizedBox(
                          height: 26,
                        ),
                        TextField(
                          controller: fullNameController,
                          textInputAction: TextInputAction.next,
                          textCapitalization: TextCapitalization.words,
                          autofillHints: const [
                            AutofillHints.name,
                          ],
                          enabled: !isLoading,
                          decoration: buildInputDecoration(
                            label: 'Full name',
                            hint: 'Enter your full name',
                            icon: Icons.person_outline_rounded,
                          ),
                        ),
                        const SizedBox(
                          height: 16,
                        ),
                        TextField(
                          controller: phoneController,
                          keyboardType: TextInputType.phone,
                          textInputAction: TextInputAction.next,
                          autofillHints: const [
                            AutofillHints.telephoneNumber,
                          ],
                          enabled: !isLoading,
                          decoration: buildInputDecoration(
                            label: 'Phone number',
                            hint: '08012345678',
                            icon: Icons.phone_outlined,
                          ),
                        ),
                        const SizedBox(
                          height: 16,
                        ),
                        TextField(
                          controller: emailController,
                          keyboardType: TextInputType.emailAddress,
                          textInputAction: TextInputAction.next,
                          autofillHints: const [
                            AutofillHints.email,
                          ],
                          enabled: !isLoading,
                          decoration: buildInputDecoration(
                            label: 'Email address',
                            hint: 'customer@example.com',
                            icon: Icons.email_outlined,
                          ),
                        ),
                        const SizedBox(
                          height: 16,
                        ),
                        TextField(
                          controller: referralCodeController,
                          textCapitalization: TextCapitalization.characters,
                          textInputAction: TextInputAction.next,
                          decoration: buildInputDecoration(
                            label: 'Referral Code (Optional)',
                            hint: 'e.g. SP-SALI-XBZE',
                            icon: Icons.card_giftcard_rounded,
                          ),
                        ),
                        const SizedBox(
                          height: 16,
                        ),
                        TextField(
                          controller: passwordController,
                          obscureText: hidePassword,
                          textInputAction: TextInputAction.next,
                          autofillHints: const [
                            AutofillHints.newPassword,
                          ],
                          enabled: !isLoading,
                          decoration: buildInputDecoration(
                            label: 'Password',
                            hint: 'Minimum 6 characters',
                            icon: Icons.lock_outline_rounded,
                            suffixIcon: IconButton(
                              tooltip: hidePassword
                                  ? 'Show password'
                                  : 'Hide password',
                              onPressed: isLoading
                                  ? null
                                  : () {
                                      setState(
                                        () {
                                          hidePassword = !hidePassword;
                                        },
                                      );
                                    },
                              icon: Icon(
                                hidePassword
                                    ? Icons.visibility_off_outlined
                                    : Icons.visibility_outlined,
                              ),
                            ),
                          ),
                        ),
                        const SizedBox(
                          height: 16,
                        ),
                        TextField(
                          controller: confirmPasswordController,
                          obscureText: hideConfirmPassword,
                          textInputAction: TextInputAction.done,
                          autofillHints: const [
                            AutofillHints.newPassword,
                          ],
                          enabled: !isLoading,
                          onSubmitted: (_) {
                            if (!isLoading) {
                              registerCustomer();
                            }
                          },
                          decoration: buildInputDecoration(
                            label: 'Confirm password',
                            hint: 'Re-enter your password',
                            icon: Icons.lock_reset_rounded,
                            suffixIcon: IconButton(
                              tooltip: hideConfirmPassword
                                  ? 'Show password'
                                  : 'Hide password',
                              onPressed: isLoading
                                  ? null
                                  : () {
                                      setState(
                                        () {
                                          hideConfirmPassword =
                                              !hideConfirmPassword;
                                        },
                                      );
                                    },
                              icon: Icon(
                                hideConfirmPassword
                                    ? Icons.visibility_off_outlined
                                    : Icons.visibility_outlined,
                              ),
                            ),
                          ),
                        ),
                        const SizedBox(
                          height: 24,
                        ),
                        SizedBox(
                          height: 54,
                          child: ElevatedButton(
                            onPressed: isLoading ? null : registerCustomer,
                            style: ElevatedButton.styleFrom(
                              backgroundColor: primaryColor,
                              foregroundColor: Colors.white,
                              disabledBackgroundColor: primaryColor.withValues(
                                alpha: 0.45,
                              ),
                              elevation: 0,
                              shape: RoundedRectangleBorder(
                                borderRadius: BorderRadius.circular(
                                  14,
                                ),
                              ),
                            ),
                            child: isLoading
                                ? const SizedBox(
                                    width: 24,
                                    height: 24,
                                    child: CircularProgressIndicator(
                                      strokeWidth: 2.5,
                                      color: Colors.white,
                                    ),
                                  )
                                : const Text(
                                    'Create account',
                                    style: TextStyle(
                                      fontSize: 17,
                                      fontWeight: FontWeight.bold,
                                    ),
                                  ),
                          ),
                        ),
                        const SizedBox(
                          height: 14,
                        ),
                        TextButton(
                          onPressed: isLoading
                              ? null
                              : () {
                                  Navigator.pop(
                                    context,
                                  );
                                },
                          child: const Text(
                            'Already have an account? Sign in',
                            style: TextStyle(
                              color: primaryColor,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                        ),
                        const SizedBox(
                          height: 10,
                        ),
                        Container(
                          padding: const EdgeInsets.all(
                            13,
                          ),
                          decoration: BoxDecoration(
                            color: primaryColor.withValues(
                              alpha: 0.07,
                            ),
                            borderRadius: BorderRadius.circular(
                              13,
                            ),
                          ),
                          child: const Row(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Icon(
                                Icons.security_rounded,
                                color: primaryColor,
                                size: 20,
                              ),
                              SizedBox(
                                width: 9,
                              ),
                              Expanded(
                                child: Text(
                                  'Your information is protected and used only to provide ServicePay services.',
                                  style: TextStyle(
                                    fontSize: 12,
                                    height: 1.45,
                                    color: Color(
                                      0xFF334155,
                                    ),
                                    fontWeight: FontWeight.w600,
                                  ),
                                ),
                              ),
                            ],
                          ),
                        ),
                        const SizedBox(
                          height: 15,
                        ),
                        Text(
                          'One Platform, Many Solutions.',
                          textAlign: TextAlign.center,
                          style: TextStyle(
                            fontSize: 12,
                            color: Colors.grey.shade600,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ],
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

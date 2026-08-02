import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;

import 'login_screen.dart';

class ResetPasswordScreen extends StatefulWidget {
  final String token;

  const ResetPasswordScreen({
    super.key,
    required this.token,
  });

  @override
  State<ResetPasswordScreen> createState() => _ResetPasswordScreenState();
}

class _ResetPasswordScreenState extends State<ResetPasswordScreen> {
  static const String baseUrl = 'https://api.servicepay.ng/api';

  static const Color primaryGreen = Color(0xFF159447);

  final GlobalKey<FormState> formKey = GlobalKey<FormState>();

  final TextEditingController passwordController = TextEditingController();

  final TextEditingController confirmPasswordController =
      TextEditingController();

  bool hidePassword = true;
  bool hideConfirmPassword = true;
  bool isLoading = false;
  bool passwordChanged = false;

  @override
  void dispose() {
    passwordController.dispose();
    confirmPasswordController.dispose();
    super.dispose();
  }

  String? validatePassword(
    String? value,
  ) {
    final String password = value ?? '';

    if (password.isEmpty) {
      return 'Enter your new password.';
    }

    if (password.length < 6) {
      return 'Password must contain at least 6 characters.';
    }

    return null;
  }

  String? validateConfirmation(
    String? value,
  ) {
    final String confirmation = value ?? '';

    if (confirmation.isEmpty) {
      return 'Confirm your new password.';
    }

    if (confirmation != passwordController.text) {
      return 'The passwords do not match.';
    }

    return null;
  }

  Map<String, dynamic> decodeResponse(
    http.Response response,
  ) {
    final String body = response.body.trim();

    if (body.isEmpty) {
      return {
        'success': false,
        'message': 'The server returned an empty response.',
      };
    }

    try {
      final dynamic decoded = jsonDecode(body);

      if (decoded is Map) {
        return Map<String, dynamic>.from(decoded);
      }
    } catch (_) {
      // A friendly message is returned below.
    }

    return {
      'success': false,
      'message': 'The server returned an invalid response.',
    };
  }

  void showMessage(
    String message, {
    required bool isError,
  }) {
    if (!mounted) {
      return;
    }

    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(
        SnackBar(
          content: Text(message),
          behavior: SnackBarBehavior.floating,
          duration: const Duration(seconds: 5),
          backgroundColor: isError ? Colors.red.shade700 : primaryGreen,
        ),
      );
  }

  Future<void> resetPassword() async {
    final bool valid = formKey.currentState?.validate() ?? false;

    if (!valid || isLoading) {
      return;
    }

    if (widget.token.trim().isEmpty) {
      showMessage(
        'The password reset link is invalid.',
        isError: true,
      );
      return;
    }

    FocusScope.of(context).unfocus();

    setState(() {
      isLoading = true;
    });

    try {
      final http.Response response = await http
          .post(
            Uri.parse(
              '$baseUrl/auth/reset-password',
            ),
            headers: const {
              'Accept': 'application/json',
              'Content-Type': 'application/json',
            },
            body: jsonEncode({
              'token': widget.token.trim(),
              'newPassword': passwordController.text,
              'confirmPassword': confirmPasswordController.text,
            }),
          )
          .timeout(
            const Duration(seconds: 120),
          );

      final Map<String, dynamic> result = decodeResponse(response);

      if (!mounted) {
        return;
      }

      if (response.statusCode < 200 ||
          response.statusCode >= 300 ||
          result['success'] != true) {
        showMessage(
          result['message']?.toString() ?? 'Unable to reset your password.',
          isError: true,
        );
        return;
      }

      setState(() {
        passwordChanged = true;
      });

      showMessage(
        result['message']?.toString() ?? 'Password reset successfully.',
        isError: false,
      );
    } on TimeoutException {
      showMessage(
        'The request took too long. Please try again.',
        isError: true,
      );
    } on http.ClientException {
      showMessage(
        'Unable to connect to the ServicePay server.',
        isError: true,
      );
    } catch (error) {
      debugPrint('Reset password error: $error');

      showMessage(
        'Reset failed: $error',
        isError: true,
      );
    } finally {
      if (mounted) {
        setState(() {
          isLoading = false;
        });
      }
    }
  }

  void returnToLogin() {
    Navigator.pushAndRemoveUntil(
      context,
      MaterialPageRoute(
        builder: (_) => const LoginScreen(),
      ),
      (Route<dynamic> route) => false,
    );
  }

  @override
  Widget build(
    BuildContext context,
  ) {
    return Scaffold(
      backgroundColor: const Color(0xFFF5F7FA),
      appBar: AppBar(
        backgroundColor: Colors.transparent,
        elevation: 0,
        automaticallyImplyLeading: !passwordChanged,
        title: const Text(
          'Reset Password',
          style: TextStyle(
            fontWeight: FontWeight.w800,
          ),
        ),
      ),
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(
                maxWidth: 440,
              ),
              child: Card(
                elevation: 8,
                shadowColor: Colors.black12,
                color: Colors.white,
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(24),
                ),
                child: Padding(
                  padding: const EdgeInsets.all(28),
                  child: passwordChanged
                      ? buildSuccessContent()
                      : buildResetForm(),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget buildResetForm() {
    final bool hasToken = widget.token.trim().isNotEmpty;

    if (!hasToken) {
      return buildInvalidLinkContent();
    }

    return Form(
      key: formKey,
      child: AutofillGroup(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Center(
              child: Container(
                width: 84,
                height: 84,
                decoration: BoxDecoration(
                  color: primaryGreen.withValues(
                    alpha: 0.12,
                  ),
                  shape: BoxShape.circle,
                ),
                child: const Icon(
                  Icons.password_rounded,
                  color: primaryGreen,
                  size: 48,
                ),
              ),
            ),
            const SizedBox(height: 20),
            const Text(
              'Create a new password',
              textAlign: TextAlign.center,
              style: TextStyle(
                color: Color(0xFF1F2937),
                fontSize: 24,
                fontWeight: FontWeight.w900,
              ),
            ),
            const SizedBox(height: 10),
            Text(
              'Enter a secure new password for your '
              'ServicePay account.',
              textAlign: TextAlign.center,
              style: TextStyle(
                color: Colors.grey.shade600,
                height: 1.5,
              ),
            ),
            const SizedBox(height: 28),
            TextFormField(
              controller: passwordController,
              enabled: !isLoading,
              obscureText: hidePassword,
              textInputAction: TextInputAction.next,
              autofillHints: const [
                AutofillHints.newPassword,
              ],
              validator: validatePassword,
              decoration: InputDecoration(
                labelText: 'New password',
                prefixIcon: const Icon(
                  Icons.lock_outline_rounded,
                ),
                suffixIcon: IconButton(
                  onPressed: isLoading
                      ? null
                      : () {
                          setState(() {
                            hidePassword = !hidePassword;
                          });
                        },
                  icon: Icon(
                    hidePassword
                        ? Icons.visibility_off_outlined
                        : Icons.visibility_outlined,
                  ),
                ),
                filled: true,
                fillColor: const Color(0xFFF8FAFC),
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(14),
                ),
                enabledBorder: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(14),
                  borderSide: const BorderSide(
                    color: Color(0xFFE2E8F0),
                  ),
                ),
                focusedBorder: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(14),
                  borderSide: const BorderSide(
                    color: primaryGreen,
                    width: 2,
                  ),
                ),
              ),
            ),
            const SizedBox(height: 18),
            TextFormField(
              controller: confirmPasswordController,
              enabled: !isLoading,
              obscureText: hideConfirmPassword,
              textInputAction: TextInputAction.done,
              autofillHints: const [
                AutofillHints.newPassword,
              ],
              validator: validateConfirmation,
              onFieldSubmitted: (_) {
                if (!isLoading) {
                  resetPassword();
                }
              },
              decoration: InputDecoration(
                labelText: 'Confirm new password',
                prefixIcon: const Icon(
                  Icons.lock_reset_rounded,
                ),
                suffixIcon: IconButton(
                  onPressed: isLoading
                      ? null
                      : () {
                          setState(() {
                            hideConfirmPassword = !hideConfirmPassword;
                          });
                        },
                  icon: Icon(
                    hideConfirmPassword
                        ? Icons.visibility_off_outlined
                        : Icons.visibility_outlined,
                  ),
                ),
                filled: true,
                fillColor: const Color(0xFFF8FAFC),
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(14),
                ),
                enabledBorder: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(14),
                  borderSide: const BorderSide(
                    color: Color(0xFFE2E8F0),
                  ),
                ),
                focusedBorder: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(14),
                  borderSide: const BorderSide(
                    color: primaryGreen,
                    width: 2,
                  ),
                ),
              ),
            ),
            const SizedBox(height: 14),
            const Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Icon(
                  Icons.info_outline_rounded,
                  size: 20,
                  color: Color(0xFF64748B),
                ),
                SizedBox(width: 8),
                Expanded(
                  child: Text(
                    'Your password must contain at '
                    'least 6 characters.',
                    style: TextStyle(
                      color: Color(0xFF64748B),
                      height: 1.4,
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 22),
            SizedBox(
              height: 54,
              child: FilledButton.icon(
                onPressed: isLoading ? null : resetPassword,
                style: FilledButton.styleFrom(
                  backgroundColor: primaryGreen,
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(14),
                  ),
                ),
                icon: isLoading
                    ? const SizedBox(
                        width: 22,
                        height: 22,
                        child: CircularProgressIndicator(
                          strokeWidth: 2.4,
                          color: Colors.white,
                        ),
                      )
                    : const Icon(
                        Icons.check_circle_outline,
                      ),
                label: Text(
                  isLoading ? 'Changing Password...' : 'Change Password',
                  style: const TextStyle(
                    fontSize: 16,
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ),
            ),
            const SizedBox(height: 16),
            TextButton.icon(
              onPressed: isLoading ? null : returnToLogin,
              icon: const Icon(
                Icons.arrow_back_rounded,
              ),
              label: const Text(
                'Back to Sign In',
                style: TextStyle(
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget buildSuccessContent() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Center(
          child: Container(
            width: 88,
            height: 88,
            decoration: BoxDecoration(
              color: primaryGreen.withValues(
                alpha: 0.12,
              ),
              shape: BoxShape.circle,
            ),
            child: const Icon(
              Icons.verified_rounded,
              color: primaryGreen,
              size: 52,
            ),
          ),
        ),
        const SizedBox(height: 22),
        const Text(
          'Password changed',
          textAlign: TextAlign.center,
          style: TextStyle(
            color: Color(0xFF1F2937),
            fontSize: 25,
            fontWeight: FontWeight.w900,
          ),
        ),
        const SizedBox(height: 12),
        Text(
          'Your ServicePay password has been '
          'changed successfully. You can now sign '
          'in with your new password.',
          textAlign: TextAlign.center,
          style: TextStyle(
            color: Colors.grey.shade700,
            height: 1.5,
          ),
        ),
        const SizedBox(height: 26),
        SizedBox(
          height: 54,
          child: FilledButton.icon(
            onPressed: returnToLogin,
            style: FilledButton.styleFrom(
              backgroundColor: primaryGreen,
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(14),
              ),
            ),
            icon: const Icon(
              Icons.login_rounded,
            ),
            label: const Text(
              'Sign In',
              style: TextStyle(
                fontSize: 16,
                fontWeight: FontWeight.w800,
              ),
            ),
          ),
        ),
      ],
    );
  }

  Widget buildInvalidLinkContent() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const Icon(
          Icons.link_off_rounded,
          color: Color(0xFFDC2626),
          size: 72,
        ),
        const SizedBox(height: 18),
        const Text(
          'Invalid reset link',
          textAlign: TextAlign.center,
          style: TextStyle(
            color: Color(0xFF1F2937),
            fontSize: 24,
            fontWeight: FontWeight.w900,
          ),
        ),
        const SizedBox(height: 12),
        Text(
          'This password reset link is missing its '
          'security token. Request a new link from '
          'the ServicePay login page.',
          textAlign: TextAlign.center,
          style: TextStyle(
            color: Colors.grey.shade700,
            height: 1.5,
          ),
        ),
        const SizedBox(height: 24),
        SizedBox(
          height: 54,
          child: FilledButton(
            onPressed: returnToLogin,
            style: FilledButton.styleFrom(
              backgroundColor: primaryGreen,
            ),
            child: const Text(
              'Return to Sign In',
              style: TextStyle(
                fontWeight: FontWeight.w800,
              ),
            ),
          ),
        ),
      ],
    );
  }
}

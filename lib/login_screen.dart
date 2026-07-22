import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

import 'main_navigation.dart';
import 'register_screen.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  static const String baseUrl = 'https://api.servicepay.ng/api';

  final TextEditingController emailController = TextEditingController();
  final TextEditingController passwordController = TextEditingController();

  bool hidePassword = true;
  bool isLoading = false;

  @override
  void dispose() {
    emailController.dispose();
    passwordController.dispose();
    super.dispose();
  }

  void showMessage(String message) {
    if (!mounted) return;

    ScaffoldMessenger.of(context).hideCurrentSnackBar();

    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(message),
        behavior: SnackBarBehavior.floating,
        duration: const Duration(seconds: 4),
      ),
    );
  }

  bool validateFields() {
    final String email = emailController.text.trim();
    final String password = passwordController.text;

    if (email.isEmpty || password.isEmpty) {
      showMessage('Please enter your email and password.');
      return false;
    }

    final emailPattern = RegExp(
      r'^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$',
    );

    if (!emailPattern.hasMatch(email)) {
      showMessage('Please enter a valid email address.');
      return false;
    }

    if (password.length < 6) {
      showMessage('Password must be at least 6 characters.');
      return false;
    }

    return true;
  }

  Future<void> saveLoginData(
    Map<String, dynamic> result,
    Map<String, dynamic> user,
  ) async {
    final String token = result['token']?.toString() ?? '';

    if (token.isEmpty) {
      throw Exception('Login token was not received.');
    }

    final SharedPreferences prefs =
        await SharedPreferences.getInstance();

    await prefs.setString('auth_token', token);

    await prefs.setString(
      'user_id',
      user['_id']?.toString() ??
          user['id']?.toString() ??
          '',
    );

    await prefs.setString(
      'user_name',
      user['fullName']?.toString() ??
          user['name']?.toString() ??
          '',
    );

    await prefs.setString(
      'user_phone',
      user['phone']?.toString() ?? '',
    );

    await prefs.setString(
      'user_email',
      user['email']?.toString() ?? '',
    );

    await prefs.setString(
      'user_role',
      user['role']?.toString() ?? '',
    );

    final double walletBalance =
        double.tryParse(
          user['walletBalance']?.toString() ?? '0',
        ) ??
        0;

    await prefs.setDouble(
      'wallet_balance',
      walletBalance,
    );
  }

  Future<void> login() async {
    if (!validateFields()) return;

    FocusScope.of(context).unfocus();

    setState(() {
      isLoading = true;
    });

    try {
      final http.Response response = await http
          .post(
            Uri.parse('$baseUrl/auth/login'),
            headers: const {
              'Content-Type': 'application/json',
              'Accept': 'application/json',
            },
            body: jsonEncode({
              'email': emailController.text.trim().toLowerCase(),
              'password': passwordController.text,
            }),
          )
          .timeout(const Duration(seconds: 30));

      debugPrint('Login status: ${response.statusCode}');
      debugPrint('Login response: ${response.body}');

      if (response.body.trim().isEmpty) {
        showMessage(
          'The server returned an empty response. '
          'Status code: ${response.statusCode}',
        );
        return;
      }

      final dynamic decodedResponse = jsonDecode(response.body);

      if (decodedResponse is! Map<String, dynamic>) {
        showMessage('The server returned an invalid response.');
        return;
      }

      final Map<String, dynamic> result = decodedResponse;

      if (response.statusCode < 200 ||
          response.statusCode >= 300) {
        showMessage(
          result['message']?.toString() ??
              'Incorrect email address or password.',
        );
        return;
      }

      final String token = result['token']?.toString() ?? '';
      final dynamic userData = result['user'];

      if (token.isEmpty) {
        showMessage(
          result['message']?.toString() ??
              'Login token was not received.',
        );
        return;
      }

      if (userData is! Map<String, dynamic>) {
        showMessage('User information was not received.');
        return;
      }

      final Map<String, dynamic> user = userData;

      final String role =
          user['role']?.toString().trim().toUpperCase() ?? '';

      final String status =
          user['status']?.toString().trim().toUpperCase() ??
              'ACTIVE';

      const Set<String> allowedAdminRoles = {
        'ADMIN',
        'SUPER_ADMIN',
        'HEAD_OFFICE',
        'HEAD_OFFICE_ADMIN',
      };

      if (!allowedAdminRoles.contains(role)) {
        showMessage(
          'This account is not authorized to access '
          'the Admin Dashboard.',
        );
        return;
      }

      if (status != 'ACTIVE') {
        showMessage(
          'This account has been suspended. '
          'Please contact Servicepay support.',
        );
        return;
      }

      await saveLoginData(result, user);

      if (!mounted) return;

      Navigator.pushReplacement(
        context,
        MaterialPageRoute(
          builder: (_) => const MainNavigation(),
        ),
      );
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
        'Unable to connect to the Servicepay server.',
      );
    } catch (error) {
      debugPrint('Login error: $error');

      showMessage(
        error
            .toString()
            .replaceFirst('Exception: ', ''),
      );
    } finally {
      if (mounted) {
        setState(() {
          isLoading = false;
        });
      }
    }
  }

  void openRegisterScreen() {
    Navigator.push(
      context,
      MaterialPageRoute(
        builder: (_) => const RegisterScreen(),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF5F7FA),
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
                color: const Color(0xFFFCFFF7),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(24),
                ),
                child: Padding(
                  padding: const EdgeInsets.all(28),
                  child: AutofillGroup(
                    child: Column(
                      crossAxisAlignment:
                          CrossAxisAlignment.stretch,
                      children: [
                        Center(
                          child: Container(
                            width: 86,
                            height: 86,
                            decoration: BoxDecoration(
                              color: Colors.green.withValues(
                                alpha: 0.12,
                              ),
                              shape: BoxShape.circle,
                            ),
                            child: const Icon(
                              Icons
                                  .account_balance_wallet_rounded,
                              color: Colors.green,
                              size: 48,
                            ),
                          ),
                        ),
                        const SizedBox(height: 18),
                        const Text(
                          'Servicepay Admin',
                          textAlign: TextAlign.center,
                          style: TextStyle(
                            fontSize: 30,
                            fontWeight: FontWeight.bold,
                            color: Colors.green,
                          ),
                        ),
                        const SizedBox(height: 8),
                        const Text(
                          'Welcome back',
                          textAlign: TextAlign.center,
                          style: TextStyle(
                            fontSize: 22,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                        const SizedBox(height: 6),
                        Text(
                          'Sign in to continue to the '
                          'Admin Dashboard.',
                          textAlign: TextAlign.center,
                          style: TextStyle(
                            fontSize: 14,
                            color: Colors.grey.shade600,
                          ),
                        ),
                        const SizedBox(height: 30),
                        TextField(
                          controller: emailController,
                          keyboardType:
                              TextInputType.emailAddress,
                          textInputAction:
                              TextInputAction.next,
                          autofillHints: const [
                            AutofillHints.email,
                            AutofillHints.username,
                          ],
                          enabled: !isLoading,
                          decoration: InputDecoration(
                            labelText: 'Email address',
                            hintText: 'admin@servicepay.ng',
                            prefixIcon: const Icon(
                              Icons.email_outlined,
                            ),
                            filled: true,
                            fillColor:
                                const Color(0xFFF8FAFC),
                            border: OutlineInputBorder(
                              borderRadius:
                                  BorderRadius.circular(14),
                            ),
                            enabledBorder:
                                OutlineInputBorder(
                              borderRadius:
                                  BorderRadius.circular(14),
                              borderSide:
                                  const BorderSide(
                                color:
                                    Color(0xFFE2E8F0),
                              ),
                            ),
                            focusedBorder:
                                OutlineInputBorder(
                              borderRadius:
                                  BorderRadius.circular(14),
                              borderSide:
                                  const BorderSide(
                                color: Colors.green,
                                width: 2,
                              ),
                            ),
                          ),
                        ),
                        const SizedBox(height: 18),
                        TextField(
                          controller: passwordController,
                          obscureText: hidePassword,
                          textInputAction:
                              TextInputAction.done,
                          autofillHints: const [
                            AutofillHints.password,
                          ],
                          enabled: !isLoading,
                          onSubmitted: (_) {
                            if (!isLoading) {
                              login();
                            }
                          },
                          decoration: InputDecoration(
                            labelText: 'Password',
                            prefixIcon: const Icon(
                              Icons.lock_outline,
                            ),
                            filled: true,
                            fillColor:
                                const Color(0xFFF8FAFC),
                            border: OutlineInputBorder(
                              borderRadius:
                                  BorderRadius.circular(14),
                            ),
                            enabledBorder:
                                OutlineInputBorder(
                              borderRadius:
                                  BorderRadius.circular(14),
                              borderSide:
                                  const BorderSide(
                                color:
                                    Color(0xFFE2E8F0),
                              ),
                            ),
                            focusedBorder:
                                OutlineInputBorder(
                              borderRadius:
                                  BorderRadius.circular(14),
                              borderSide:
                                  const BorderSide(
                                color: Colors.green,
                                width: 2,
                              ),
                            ),
                            suffixIcon: IconButton(
                              icon: Icon(
                                hidePassword
                                    ? Icons
                                        .visibility_off_outlined
                                    : Icons
                                        .visibility_outlined,
                              ),
                              onPressed: isLoading
                                  ? null
                                  : () {
                                      setState(() {
                                        hidePassword =
                                            !hidePassword;
                                      });
                                    },
                            ),
                          ),
                        ),
                        const SizedBox(height: 22),
                        SizedBox(
                          height: 54,
                          child: ElevatedButton(
                            onPressed:
                                isLoading ? null : login,
                            style: ElevatedButton.styleFrom(
                              backgroundColor:
                                  Colors.green,
                              foregroundColor:
                                  Colors.white,
                              disabledBackgroundColor:
                                  Colors.green.shade200,
                              shape: RoundedRectangleBorder(
                                borderRadius:
                                    BorderRadius.circular(14),
                              ),
                            ),
                            child: isLoading
                                ? const SizedBox(
                                    width: 24,
                                    height: 24,
                                    child:
                                        CircularProgressIndicator(
                                      strokeWidth: 2.5,
                                      color: Colors.white,
                                    ),
                                  )
                                : const Text(
                                    'Sign in',
                                    style: TextStyle(
                                      fontSize: 17,
                                      fontWeight:
                                          FontWeight.bold,
                                    ),
                                  ),
                          ),
                        ),
                        const SizedBox(height: 18),
                        SizedBox(
                          height: 52,
                          child: OutlinedButton(
                            onPressed: isLoading
                                ? null
                                : openRegisterScreen,
                            style:
                                OutlinedButton.styleFrom(
                              foregroundColor:
                                  Colors.green,
                              side: const BorderSide(
                                color: Colors.green,
                              ),
                              shape: RoundedRectangleBorder(
                                borderRadius:
                                    BorderRadius.circular(14),
                              ),
                            ),
                            child: const Text(
                              'Create account',
                              style: TextStyle(
                                fontSize: 16,
                                fontWeight:
                                    FontWeight.bold,
                              ),
                            ),
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
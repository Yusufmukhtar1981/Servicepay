import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

import 'main_navigation.dart';
import 'admin_permissions.dart';

class AdminLoginScreen extends StatefulWidget {
  const AdminLoginScreen({super.key});

  @override
  State<AdminLoginScreen> createState() =>
      _AdminLoginScreenState();
}

class _AdminLoginScreenState extends State<AdminLoginScreen> {
  static const String baseUrl = 'https://api.servicepay.ng/api';

  final TextEditingController emailController =
      TextEditingController();

  final TextEditingController passwordController =
      TextEditingController();

  bool hidePassword = true;
  bool isLoading = false;

  @override
  void dispose() {
    emailController.dispose();
    passwordController.dispose();
    super.dispose();
  }

  void showMessage(
    String message, {
    bool isError = true,
  }) {
    if (!mounted) return;

    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(
        SnackBar(
          content: Text(message),
          behavior: SnackBarBehavior.floating,
          duration: const Duration(seconds: 4),
          backgroundColor: isError
              ? Colors.red.shade700
              : Colors.green.shade700,
        ),
      );
  }

  bool validateFields() {
    final String email = emailController.text.trim();
    final String password = passwordController.text;

    if (email.isEmpty || password.isEmpty) {
      showMessage(
        'Please enter your admin email and password.',
      );
      return false;
    }

    final RegExp emailPattern = RegExp(
      r'^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$',
    );

    if (!emailPattern.hasMatch(email)) {
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

    return true;
  }

  Map<String, dynamic> mapFromDynamic(dynamic value) {
    if (value is Map) {
      return Map<String, dynamic>.from(value);
    }

    return <String, dynamic>{};
  }

  String extractToken(
    Map<String, dynamic> result,
  ) {
    final Map<String, dynamic> data =
        mapFromDynamic(result['data']);

    final Map<String, dynamic> authentication =
        mapFromDynamic(result['authentication']);

    final Map<String, dynamic> auth =
        mapFromDynamic(result['auth']);

    final dynamic tokenValue =
        result['token'] ??
        result['accessToken'] ??
        result['access_token'] ??
        result['jwt'] ??
        data['token'] ??
        data['accessToken'] ??
        data['access_token'] ??
        data['jwt'] ??
        authentication['token'] ??
        authentication['accessToken'] ??
        auth['token'] ??
        auth['accessToken'];

    String token = tokenValue?.toString().trim() ?? '';

    if (token.toLowerCase().startsWith('bearer ')) {
      token = token.substring(7).trim();
    }

    return token;
  }

  Map<String, dynamic> extractUser(
    Map<String, dynamic> result,
  ) {
    final Map<String, dynamic> directUser =
        mapFromDynamic(result['user']);

    if (directUser.isNotEmpty) {
      return directUser;
    }

    final Map<String, dynamic> data =
        mapFromDynamic(result['data']);

    final Map<String, dynamic> nestedUser =
        mapFromDynamic(data['user']);

    if (nestedUser.isNotEmpty) {
      return nestedUser;
    }

    final bool dataLooksLikeUser =
        data.containsKey('_id') ||
        data.containsKey('id') ||
        data.containsKey('email') ||
        data.containsKey('phone') ||
        data.containsKey('fullName') ||
        data.containsKey('role');

    if (dataLooksLikeUser) {
      return data;
    }

    return <String, dynamic>{};
  }

  Future<void> clearOldLoginData(
    SharedPreferences prefs,
  ) async {
    const List<String> loginKeys = [
      'auth_token',
      'token',
      'access_token',
      'accessToken',
      'jwt_token',
      'jwt',
      'user_id',
      'user_name',
      'user_phone',
      'user_email',
      'user_role',
      'user_status',
      'wallet_balance',
    ];

    for (final String key in loginKeys) {
      await prefs.remove(key);
    }
  }

  Future<void> saveAdminLoginData(
    String token,
    Map<String, dynamic> user,
  ) async {
    if (token.trim().isEmpty) {
      throw Exception(
        'Admin login token was not received.',
      );
    }

    final SharedPreferences prefs =
        await SharedPreferences.getInstance();

    await clearOldLoginData(prefs);

    final bool tokenSaved = await prefs.setString(
      'auth_token',
      token.trim(),
    );

    if (!tokenSaved) {
      throw Exception(
        'Unable to save the admin login session.',
      );
    }

    await prefs.setString(
      'user_id',
      user['_id']?.toString() ??
          user['id']?.toString() ??
          '',
    );

    await prefs.setString(
      'user_name',
      user['fullName']?.toString() ??
          user['full_name']?.toString() ??
          user['name']?.toString() ??
          'Admin',
    );

    await prefs.setString(
      'user_phone',
      user['phone']?.toString() ??
          user['phoneNumber']?.toString() ??
          '',
    );

    await prefs.setString(
      'user_email',
      user['email']?.toString() ?? '',
    );

    await prefs.setString(
      'user_role',
      user['role']?.toString().toUpperCase() ??
          'ADMIN',
    );

    await prefs.setString(
      'user_status',
      user['status']?.toString().toUpperCase() ??
          'ACTIVE',
    );

    final String? savedToken =
        prefs.getString('auth_token');

    if (savedToken == null ||
        savedToken.trim().isEmpty) {
      throw Exception(
        'The admin login session could not be saved.',
      );
    }
  }

  Future<void> loginAdmin() async {
    if (!validateFields()) return;

    FocusScope.of(context).unfocus();

    setState(() {
      isLoading = true;
    });

    try {
      final Uri endpoint =
          Uri.parse('$baseUrl/auth/login');

      final http.Response response = await http
          .post(
            endpoint,
            headers: const {
              'Content-Type': 'application/json',
              'Accept': 'application/json',
            },
            body: jsonEncode({
              'email':
                  emailController.text.trim().toLowerCase(),
              'password': passwordController.text,
            }),
          )
          .timeout(
            const Duration(seconds: 30),
          );

      final String responseBody =
          response.body.trim();

      if (responseBody.isEmpty) {
        showMessage(
          'The server returned an empty response.',
        );
        return;
      }

      final dynamic decodedResponse =
          jsonDecode(responseBody);

      if (decodedResponse is! Map) {
        showMessage(
          'The server returned an invalid response.',
        );
        return;
      }

      final Map<String, dynamic> result =
          Map<String, dynamic>.from(
        decodedResponse,
      );

      if (response.statusCode < 200 ||
          response.statusCode >= 300) {
        showMessage(
          result['message']?.toString().trim().isNotEmpty ==
                  true
              ? result['message'].toString()
              : 'Incorrect admin email or password.',
        );
        return;
      }

      final bool successValue =
          result['success'] == true ||
          result['success'] == null;

      if (!successValue) {
        showMessage(
          result['message']?.toString() ??
              'Admin login was not successful.',
        );
        return;
      }

      final String token =
          extractToken(result);

      if (token.isEmpty) {
        showMessage(
          'Login succeeded, but no authentication token was received.',
        );
        return;
      }

      final Map<String, dynamic> user =
          extractUser(result);

      if (user.isEmpty) {
        showMessage(
          'Admin account information was not received.',
        );
        return;
      }

      final String role = user['role']
              ?.toString()
              .trim()
              .toUpperCase() ??
          'CUSTOMER';

      final String status = user['status']
              ?.toString()
              .trim()
              .toUpperCase() ??
          'ACTIVE';

      const Set<String> allowedAdminRoles = {
        'HEAD_OFFICE',
        'ADMIN',
        'SUPER_ADMIN',
        'HEAD_OFFICE_ADMIN',
        'STAFF',
        'ZONAL_MANAGER',
        'STATE_MANAGER',
      };

      if (!allowedAdminRoles.contains(role)) {
        showMessage(
          'Only Head Office and authorized ServicePay staff can access this portal.',
        );
        return;
      }

      if (status != 'ACTIVE') {
        showMessage(
          'This admin account is not active. Please contact Servicepay support.',
        );
        return;
      }

      await saveAdminLoginData(
        token,
        user,
      );

      final SharedPreferences preferences =
          await SharedPreferences.getInstance();

      final dynamic rawStaffRole =
          user['staffRole'];

      final Map<String, dynamic> staffRole =
          rawStaffRole is Map
              ? Map<String, dynamic>.from(
                  rawStaffRole,
                )
              : <String, dynamic>{};

      final dynamic rawPermissions =
          user['permissions'] ??
          staffRole['permissions'];

      final List<String> permissions =
          rawPermissions is List
              ? rawPermissions
                  .map(
                    (dynamic item) =>
                        item.toString().trim(),
                  )
                  .where(
                    (String item) =>
                        item.isNotEmpty,
                  )
                  .toSet()
                  .toList()
              : <String>[];

      await preferences.setString(
        'staff_id',
        user['staffId']?.toString() ?? '',
      );

      await preferences.setString(
        'staff_role_name',
        staffRole['name']?.toString() ?? '',
      );

      await preferences.setString(
        'staff_role_display_name',
        staffRole['displayName']?.toString() ?? '',
      );

      await preferences.setString(
        'staff_department',
        user['department']?.toString() ??
            staffRole['department']?.toString() ??
            '',
      );

      await preferences.setStringList(
        'staff_permissions',
        permissions,
      );

      await preferences.setBool(
        'must_change_password',
        user['mustChangePassword'] == true,
      );

      await preferences.setBool(
        'is_staff',
        user['isStaff'] == true,
      );

      await AdminSessionStore.saveAccess(
        AdminAccess.fromUser(user),
      );

      if (!mounted) return;

      showMessage(
        'Admin login successful.',
        isError: false,
      );

      Navigator.pushAndRemoveUntil(
        context,
        MaterialPageRoute(
          builder: (_) =>
              const AdminMainNavigation(),
        ),
        (Route<dynamic> route) => false,
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
      showMessage(
        error.toString().replaceFirst(
              'Exception: ',
              '',
            ),
      );
    } finally {
      if (mounted) {
        setState(() {
          isLoading = false;
        });
      }
    }
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
                color: Colors.white,
                shape: RoundedRectangleBorder(
                  borderRadius:
                      BorderRadius.circular(24),
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
                            width: 88,
                            height: 88,
                            decoration: BoxDecoration(
                              color: Colors.green.withValues(
                                alpha: 0.12,
                              ),
                              shape: BoxShape.circle,
                            ),
                            child: const Icon(
                              Icons
                                  .admin_panel_settings_rounded,
                              color: Colors.green,
                              size: 50,
                            ),
                          ),
                        ),
                        const SizedBox(height: 18),
                        const Text(
                          'Servicepay Admin',
                          textAlign: TextAlign.center,
                          style: TextStyle(
                            fontSize: 29,
                            fontWeight: FontWeight.bold,
                            color: Colors.green,
                          ),
                        ),
                        const SizedBox(height: 8),
                        const Text(
                          'Admin Dashboard Login',
                          textAlign: TextAlign.center,
                          style: TextStyle(
                            fontSize: 20,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                        const SizedBox(height: 6),
                        Text(
                          'Sign in with an authorized Servicepay administrator account.',
                          textAlign: TextAlign.center,
                          style: TextStyle(
                            fontSize: 14,
                            height: 1.4,
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
                            labelText: 'Admin email',
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
                                color: Color(0xFFE2E8F0),
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
                              loginAdmin();
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
                                color: Color(0xFFE2E8F0),
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
                              onPressed: isLoading
                                  ? null
                                  : () {
                                      setState(() {
                                        hidePassword =
                                            !hidePassword;
                                      });
                                    },
                              icon: Icon(
                                hidePassword
                                    ? Icons
                                        .visibility_off_outlined
                                    : Icons
                                        .visibility_outlined,
                              ),
                            ),
                          ),
                        ),
                        const SizedBox(height: 24),
                        SizedBox(
                          height: 54,
                          child: ElevatedButton.icon(
                            onPressed: isLoading
                                ? null
                                : loginAdmin,
                            style: ElevatedButton.styleFrom(
                              backgroundColor: Colors.green,
                              foregroundColor: Colors.white,
                              disabledBackgroundColor:
                                  Colors.green.withValues(
                                alpha: 0.45,
                              ),
                              shape: RoundedRectangleBorder(
                                borderRadius:
                                    BorderRadius.circular(14),
                              ),
                            ),
                            icon: isLoading
                                ? const SizedBox(
                                    width: 22,
                                    height: 22,
                                    child:
                                        CircularProgressIndicator(
                                      strokeWidth: 2.5,
                                      color: Colors.white,
                                    ),
                                  )
                                : const Icon(
                                    Icons.login,
                                  ),
                            label: Text(
                              isLoading
                                  ? 'Signing in...'
                                  : 'Sign in as Admin',
                              style: const TextStyle(
                                fontSize: 16,
                                fontWeight:
                                    FontWeight.bold,
                              ),
                            ),
                          ),
                        ),
                        const SizedBox(height: 18),
                        Container(
                          padding: const EdgeInsets.all(14),
                          decoration: BoxDecoration(
                            color: Colors.orange.withValues(
                              alpha: 0.08,
                            ),
                            borderRadius:
                                BorderRadius.circular(12),
                          ),
                          child: const Row(
                            crossAxisAlignment:
                                CrossAxisAlignment.start,
                            children: [
                              Icon(
                                Icons.security_outlined,
                                color: Colors.orange,
                                size: 21,
                              ),
                              SizedBox(width: 10),
                              Expanded(
                                child: Text(
                                  'Only authorized Servicepay administrators can access this dashboard.',
                                  style: TextStyle(
                                    fontSize: 13,
                                    height: 1.4,
                                  ),
                                ),
                              ),
                            ],
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
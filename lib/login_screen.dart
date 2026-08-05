import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

import 'forgot_password_screen.dart';
import 'main_navigation.dart';
import 'register_screen.dart';
import 'rider/rider_main_navigation.dart';
import 'role_dashboard_screen.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({
    super.key,
  });

  @override
  State<LoginScreen> createState() =>
      _LoginScreenState();
}

class _LoginScreenState
    extends State<LoginScreen> {
  static const String baseUrl =
      'https://api.servicepay.ng/api';

  static const Color primaryColor =
      Color(0xFF0F766E);

  final TextEditingController
      emailController =
      TextEditingController();

  final TextEditingController
      passwordController =
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
          behavior:
              SnackBarBehavior.floating,
          duration:
              const Duration(
            seconds: 4,
          ),
          backgroundColor:
              isError
                  ? Colors.red.shade700
                  : primaryColor,
        ),
      );
  }

  bool validateFields() {
    final String email =
        emailController.text.trim();

    final String password =
        passwordController.text;

    if (email.isEmpty ||
        password.isEmpty) {
      showMessage(
        'Please enter your email address and password.',
      );

      return false;
    }

    final RegExp emailPattern =
        RegExp(
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

    return true;
  }

  Map<String, dynamic> mapFromDynamic(
    dynamic value,
  ) {
    if (value is Map) {
      return Map<String, dynamic>.from(
        value,
      );
    }

    return <String, dynamic>{};
  }

  String extractToken(
    Map<String, dynamic> result,
  ) {
    final Map<String, dynamic> data =
        mapFromDynamic(
      result['data'],
    );

    final Map<String, dynamic>
        authentication =
        mapFromDynamic(
      result['authentication'],
    );

    final Map<String, dynamic> auth =
        mapFromDynamic(
      result['auth'],
    );

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
            authentication[
                'accessToken'] ??
            auth['token'] ??
            auth['accessToken'];

    String token =
        tokenValue
                ?.toString()
                .trim() ??
            '';

    if (token
        .toLowerCase()
        .startsWith(
          'bearer ',
        )) {
      token =
          token.substring(7).trim();
    }

    return token;
  }

  Map<String, dynamic> extractUser(
    Map<String, dynamic> result,
  ) {
    final Map<String, dynamic>
        directUser =
        mapFromDynamic(
      result['user'],
    );

    if (directUser.isNotEmpty) {
      return directUser;
    }

    final Map<String, dynamic> data =
        mapFromDynamic(
      result['data'],
    );

    final Map<String, dynamic>
        nestedUser =
        mapFromDynamic(
      data['user'],
    );

    if (nestedUser.isNotEmpty) {
      return nestedUser;
    }

    final bool dataLooksLikeUser =
        data.containsKey('_id') ||
            data.containsKey('id') ||
            data.containsKey(
              'email',
            ) ||
            data.containsKey(
              'phone',
            ) ||
            data.containsKey(
              'fullName',
            );

    if (dataLooksLikeUser) {
      return data;
    }

    return <String, dynamic>{};
  }

  Future<void> clearOldLoginData(
    SharedPreferences prefs,
  ) async {
    const List<String> oldTokenKeys = [
      'auth_token',
      'token',
      'access_token',
      'accessToken',
      'jwt_token',
      'jwt',
    ];

    for (final String key
        in oldTokenKeys) {
      await prefs.remove(key);
    }
  }

  Future<void> saveLoginData(
    String token,
    Map<String, dynamic> user,
  ) async {
    if (token.trim().isEmpty) {
      throw Exception(
        'Login token was not received.',
      );
    }

    final SharedPreferences prefs =
        await SharedPreferences
            .getInstance();

    await clearOldLoginData(
      prefs,
    );

    final bool tokenSaved =
        await prefs.setString(
      'auth_token',
      token.trim(),
    );

    if (!tokenSaved) {
      throw Exception(
        'Unable to save the login session.',
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
          user['full_name']
              ?.toString() ??
          user['name']?.toString() ??
          '',
    );

    await prefs.setString(
      'user_phone',
      user['phone']?.toString() ??
          user['phoneNumber']
              ?.toString() ??
          '',
    );

    await prefs.setString(
      'user_email',
      user['email']?.toString() ??
          '',
    );

    await prefs.setString(
      'user_role',
      user['role']?.toString() ??
          'CUSTOMER',
    );

    await prefs.setString(
      'user_status',
      user['status']?.toString() ??
          'ACTIVE',
    );

    await prefs.setString(
      'rider_id',
      user['riderId']?.toString() ??
          user['rider_id']
              ?.toString() ??
          '',
    );

    await prefs.setString(
      'rider_verification_status',
      user['riderVerificationStatus']
              ?.toString()
              .trim()
              .toUpperCase() ??
          'PENDING',
    );

    await prefs.setString(
      'rider_availability_status',
      user['availabilityStatus']
              ?.toString()
              .trim()
              .toUpperCase() ??
          'OFFLINE',
    );

    await prefs.setString(
      'rider_vehicle_type',
      user['vehicleType']
              ?.toString() ??
          '',
    );

    await prefs.setString(
      'rider_plate_number',
      user['plateNumber']
              ?.toString() ??
          '',
    );

    await prefs.setString(
      'rider_state',
      user['riderState']
              ?.toString() ??
          user['state']?.toString() ??
          '',
    );

    await prefs.setString(
      'rider_lga',
      user['riderLga']?.toString() ??
          user['lga']?.toString() ??
          '',
    );

    final String riderAvailability =
        user['availabilityStatus']
                ?.toString()
                .trim()
                .toUpperCase() ??
            'OFFLINE';

    await prefs.setBool(
      'rider_is_online',
      riderAvailability ==
          'ONLINE',
    );

    final dynamic balanceValue =
        user['walletBalance'] ??
            user['wallet_balance'] ??
            user['balance'];

    final double walletBalance =
        double.tryParse(
              balanceValue
                      ?.toString() ??
                  '0',
            ) ??
            0.0;

    await prefs.setDouble(
      'wallet_balance',
      walletBalance,
    );

    final String? savedToken =
        prefs.getString(
      'auth_token',
    );

    if (savedToken == null ||
        savedToken.trim().isEmpty) {
      throw Exception(
        'The login session could not be saved.',
      );
    }

    debugPrint(
      'Authentication token saved successfully.',
    );
  }
  Future<void> login() async {
    if (!validateFields()) {
      return;
    }

    FocusScope.of(context).unfocus();

    setState(() {
      isLoading = true;
    });

    try {
      final Uri endpoint =
          Uri.parse(
        '$baseUrl/auth/login',
      );

      final http.Response response =
          await http
              .post(
                endpoint,
                headers: const {
                  'Content-Type':
                      'application/json',
                  'Accept':
                      'application/json',
                },
                body: jsonEncode({
                  'email': emailController
                      .text
                      .trim()
                      .toLowerCase(),
                  'password':
                      passwordController
                          .text,
                }),
              )
              .timeout(
                const Duration(
                  seconds: 30,
                ),
              );

      debugPrint(
        'Login status: ${response.statusCode}',
      );

      debugPrint(
        'Login response: ${response.body}',
      );

      final String responseBody =
          response.body.trim();

      if (responseBody.isEmpty) {
        showMessage(
          'The server returned an empty response. Please try again.',
        );

        return;
      }

      final dynamic decodedResponse =
          jsonDecode(
        responseBody,
      );

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
          result['message']
                      ?.toString()
                      .trim()
                      .isNotEmpty ==
                  true
              ? result['message']
                  .toString()
              : 'Incorrect email address or password.',
        );

        return;
      }

      final bool successValue =
          result['success'] == true ||
              result['success'] == null;

      if (!successValue) {
        showMessage(
          result['message']
                  ?.toString() ??
              'Login was not successful.',
        );

        return;
      }

      final String token =
          extractToken(
        result,
      );

      if (token.isEmpty) {
        showMessage(
          'Login was successful, but the server did not return an authentication token.',
        );

        debugPrint(
          'No token found in login response.',
        );

        return;
      }

      final Map<String, dynamic> user =
          extractUser(
        result,
      );

      if (user.isEmpty) {
        showMessage(
          'User information was not received.',
        );

        return;
      }

      final String role =
          user['role']
                  ?.toString()
                  .trim()
                  .toUpperCase() ??
              'CUSTOMER';

      final String status =
          user['status']
                  ?.toString()
                  .trim()
                  .toUpperCase() ??
              'ACTIVE';

      const Set<String> adminRoles = {
        'ADMIN',
        'SUPER_ADMIN',
        'HEAD_OFFICE',
        'HEAD_OFFICE_ADMIN',
      };

      if (adminRoles.contains(
        role,
      )) {
        showMessage(
          'Admin accounts must sign in through admin.servicepay.ng.',
        );

        return;
      }

      if (status != 'ACTIVE') {
        showMessage(
          'This account has been suspended. Please contact ServicePay support.',
        );

        return;
      }

      await saveLoginData(
        token,
        user,
      );

      if (!mounted) {
        return;
      }

      showMessage(
        'Login successful.',
        isError: false,
      );

      Navigator.pushAndRemoveUntil(
        context,
        MaterialPageRoute(
          builder: (
            BuildContext context,
          ) {
            if (role ==
                'DELIVERY_RIDER') {
              return const RiderMainNavigation();
            }

            if (role ==
                'CUSTOMER') {
              return const MainNavigation();
            }

            return RoleDashboardScreen(
              role: role,
            );
          },
        ),
        (
          Route<dynamic> route,
        ) =>
            false,
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
        'Unable to connect to the ServicePay server.',
      );
    } catch (error) {
      debugPrint(
        'Login error: $error',
      );

      showMessage(
        error
            .toString()
            .replaceFirst(
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

  void openForgotPasswordScreen() {
    Navigator.push(
      context,
      MaterialPageRoute(
        builder: (
          BuildContext context,
        ) =>
            const ForgotPasswordScreen(),
      ),
    );
  }

  void openRegisterScreen() {
    Navigator.push(
      context,
      MaterialPageRoute(
        builder: (
          BuildContext context,
        ) =>
            const RegisterScreen(),
      ),
    );
  }

  Widget buildServicePayLogo() {
    return Image.asset(
      'assets/image/servicepay_logo.png',
      width: 250,
      height: 170,
      fit: BoxFit.contain,
      errorBuilder: (
        BuildContext context,
        Object error,
        StackTrace? stackTrace,
      ) {
        return Column(
          mainAxisSize:
              MainAxisSize.min,
          children: [
            Container(
              width: 92,
              height: 92,
              decoration:
                  BoxDecoration(
                color: primaryColor
                    .withValues(
                  alpha: 0.12,
                ),
                borderRadius:
                    BorderRadius.circular(
                  24,
                ),
              ),
              child: const Icon(
                Icons
                    .account_balance_wallet_rounded,
                color: primaryColor,
                size: 50,
              ),
            ),
            const SizedBox(
              height: 12,
            ),
            const Text(
              'ServicePay',
              style: TextStyle(
                fontSize: 30,
                fontWeight:
                    FontWeight.w800,
                color: primaryColor,
              ),
            ),
          ],
        );
      },
    );
  }

  InputDecoration inputDecoration({
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
      fillColor:
          const Color(
        0xFFF8FAFC,
      ),
      border:
          OutlineInputBorder(
        borderRadius:
            BorderRadius.circular(
          14,
        ),
      ),
      enabledBorder:
          OutlineInputBorder(
        borderRadius:
            BorderRadius.circular(
          14,
        ),
        borderSide:
            const BorderSide(
          color:
              Color(
            0xFFE2E8F0,
          ),
        ),
      ),
      focusedBorder:
          OutlineInputBorder(
        borderRadius:
            BorderRadius.circular(
          14,
        ),
        borderSide:
            const BorderSide(
          color:
              primaryColor,
          width: 2,
        ),
      ),
    );
  }
  @override
  Widget build(
    BuildContext context,
  ) {
    return Scaffold(
      backgroundColor:
          const Color(
        0xFFF4F7F9,
      ),
      body: SafeArea(
        child: Center(
          child:
              SingleChildScrollView(
            padding:
                const EdgeInsets.all(
              22,
            ),
            child:
                ConstrainedBox(
              constraints:
                  const BoxConstraints(
                maxWidth: 460,
              ),
              child:
                  Container(
                decoration:
                    BoxDecoration(
                  color:
                      Colors.white,
                  borderRadius:
                      BorderRadius.circular(
                    26,
                  ),
                  border:
                      Border.all(
                    color:
                        const Color(
                      0xFFE2E8F0,
                    ),
                  ),
                  boxShadow: [
                    BoxShadow(
                      color:
                          Colors.black.withValues(
                        alpha:
                            0.07,
                      ),
                      blurRadius:
                          24,
                      offset:
                          const Offset(
                        0,
                        10,
                      ),
                    ),
                  ],
                ),
                child:
                    Padding(
                  padding:
                      const EdgeInsets.fromLTRB(
                    28,
                    24,
                    28,
                    30,
                  ),
                  child:
                      AutofillGroup(
                    child:
                        Column(
                      crossAxisAlignment:
                          CrossAxisAlignment.stretch,
                      children: [
                        Center(
                          child:
                              buildServicePayLogo(),
                        ),
                        const SizedBox(
                          height:
                              4,
                        ),
                        const Text(
                          'Welcome back',
                          textAlign:
                              TextAlign.center,
                          style:
                              TextStyle(
                            fontSize:
                                23,
                            fontWeight:
                                FontWeight.w800,
                            color:
                                Color(
                              0xFF172033,
                            ),
                          ),
                        ),
                        const SizedBox(
                          height:
                              7,
                        ),
                        Text(
                          'Sign in to continue to your ServicePay account.',
                          textAlign:
                              TextAlign.center,
                          style:
                              TextStyle(
                            fontSize:
                                14,
                            height:
                                1.45,
                            color:
                                Colors.grey.shade600,
                          ),
                        ),
                        const SizedBox(
                          height:
                              28,
                        ),
                        TextField(
                          controller:
                              emailController,
                          keyboardType:
                              TextInputType.emailAddress,
                          textInputAction:
                              TextInputAction.next,
                          autofillHints:
                              const [
                            AutofillHints.email,
                            AutofillHints.username,
                          ],
                          enabled:
                              !isLoading,
                          decoration:
                              inputDecoration(
                            label:
                                'Email address',
                            hint:
                                'customer@example.com',
                            icon:
                                Icons.email_outlined,
                          ),
                        ),
                        const SizedBox(
                          height:
                              18,
                        ),
                        TextField(
                          controller:
                              passwordController,
                          obscureText:
                              hidePassword,
                          textInputAction:
                              TextInputAction.done,
                          autofillHints:
                              const [
                            AutofillHints.password,
                          ],
                          enabled:
                              !isLoading,
                          onSubmitted:
                              (_) {
                            if (!isLoading) {
                              login();
                            }
                          },
                          decoration:
                              inputDecoration(
                            label:
                                'Password',
                            hint:
                                'Enter your password',
                            icon:
                                Icons.lock_outline_rounded,
                            suffixIcon:
                                IconButton(
                              tooltip:
                                  hidePassword
                                      ? 'Show password'
                                      : 'Hide password',
                              onPressed:
                                  isLoading
                                      ? null
                                      : () {
                                          setState(
                                            () {
                                              hidePassword =
                                                  !hidePassword;
                                            },
                                          );
                                        },
                              icon:
                                  Icon(
                                hidePassword
                                    ? Icons.visibility_off_outlined
                                    : Icons.visibility_outlined,
                              ),
                            ),
                          ),
                        ),
                        const SizedBox(
                          height:
                              7,
                        ),
                        Align(
                          alignment:
                              Alignment.centerRight,
                          child:
                              TextButton(
                            onPressed:
                                isLoading
                                    ? null
                                    : openForgotPasswordScreen,
                            child:
                                const Text(
                              'Forgot Password?',
                              style:
                                  TextStyle(
                                color:
                                    primaryColor,
                                fontWeight:
                                    FontWeight.w800,
                              ),
                            ),
                          ),
                        ),
                        const SizedBox(
                          height:
                              8,
                        ),
                        SizedBox(
                          height:
                              54,
                          child:
                              ElevatedButton(
                            onPressed:
                                isLoading
                                    ? null
                                    : login,
                            style:
                                ElevatedButton.styleFrom(
                              backgroundColor:
                                  primaryColor,
                              foregroundColor:
                                  Colors.white,
                              disabledBackgroundColor:
                                  primaryColor.withValues(
                                alpha:
                                    0.45,
                              ),
                              elevation:
                                  0,
                              shape:
                                  RoundedRectangleBorder(
                                borderRadius:
                                    BorderRadius.circular(
                                  14,
                                ),
                              ),
                            ),
                            child:
                                isLoading
                                    ? const SizedBox(
                                        width:
                                            24,
                                        height:
                                            24,
                                        child:
                                            CircularProgressIndicator(
                                          strokeWidth:
                                              2.5,
                                          color:
                                              Colors.white,
                                        ),
                                      )
                                    : const Text(
                                        'Sign in',
                                        style:
                                            TextStyle(
                                          fontSize:
                                              17,
                                          fontWeight:
                                              FontWeight.bold,
                                        ),
                                      ),
                          ),
                        ),
                        const SizedBox(
                          height:
                              17,
                        ),
                        Row(
                          children: [
                            Expanded(
                              child:
                                  Divider(
                                color:
                                    Colors.grey.shade300,
                              ),
                            ),
                            Padding(
                              padding:
                                  const EdgeInsets.symmetric(
                                horizontal:
                                    12,
                              ),
                              child:
                                  Text(
                                'or',
                                style:
                                    TextStyle(
                                  color:
                                      Colors.grey.shade500,
                                  fontWeight:
                                      FontWeight.w600,
                                ),
                              ),
                            ),
                            Expanded(
                              child:
                                  Divider(
                                color:
                                    Colors.grey.shade300,
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(
                          height:
                              17,
                        ),
                        SizedBox(
                          height:
                              52,
                          child:
                              OutlinedButton.icon(
                            onPressed:
                                isLoading
                                    ? null
                                    : openRegisterScreen,
                            style:
                                OutlinedButton.styleFrom(
                              foregroundColor:
                                  primaryColor,
                              side:
                                  const BorderSide(
                                color:
                                    primaryColor,
                                width:
                                    1.4,
                              ),
                              shape:
                                  RoundedRectangleBorder(
                                borderRadius:
                                    BorderRadius.circular(
                                  14,
                                ),
                              ),
                            ),
                            icon:
                                const Icon(
                              Icons.person_add_alt_1_rounded,
                            ),
                            label:
                                const Text(
                              'Create account',
                              style:
                                  TextStyle(
                                fontSize:
                                    16,
                                fontWeight:
                                    FontWeight.bold,
                              ),
                            ),
                          ),
                        ),
                        const SizedBox(
                          height:
                              20,
                        ),
                        Container(
                          padding:
                              const EdgeInsets.all(
                            13,
                          ),
                          decoration:
                              BoxDecoration(
                            color:
                                primaryColor.withValues(
                              alpha:
                                  0.07,
                            ),
                            borderRadius:
                                BorderRadius.circular(
                              13,
                            ),
                          ),
                          child:
                              const Row(
                            crossAxisAlignment:
                                CrossAxisAlignment.start,
                            children: [
                              Icon(
                                Icons.security_rounded,
                                color:
                                    primaryColor,
                                size:
                                    20,
                              ),
                              SizedBox(
                                width:
                                    9,
                              ),
                              Expanded(
                                child:
                                    Text(
                                  'Fast, secure and reliable access to everyday services.',
                                  style:
                                      TextStyle(
                                    fontSize:
                                        12,
                                    height:
                                        1.45,
                                    color:
                                        Color(
                                      0xFF334155,
                                    ),
                                    fontWeight:
                                        FontWeight.w600,
                                  ),
                                ),
                              ),
                            ],
                          ),
                        ),
                        const SizedBox(
                          height:
                              15,
                        ),
                        Text(
                          'One Platform, Many Solutions.',
                          textAlign:
                              TextAlign.center,
                          style:
                              TextStyle(
                            fontSize:
                                12,
                            color:
                                Colors.grey.shade600,
                            fontWeight:
                                FontWeight.w700,
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

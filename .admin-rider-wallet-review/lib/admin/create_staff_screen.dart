import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

class CreateStaffScreen extends StatefulWidget {
  const CreateStaffScreen({
    super.key,
  });

  @override
  State<CreateStaffScreen> createState() =>
      _CreateStaffScreenState();
}

class _CreateStaffScreenState
    extends State<CreateStaffScreen> {
  static const String baseUrl =
      'https://api.servicepay.ng/api';

  static const Color primaryGreen =
      Color(0xFF149B8F);

  final GlobalKey<FormState> formKey =
      GlobalKey<FormState>();

  final TextEditingController fullNameController =
      TextEditingController();

  final TextEditingController phoneController =
      TextEditingController();

  final TextEditingController emailController =
      TextEditingController();

  final TextEditingController passwordController =
      TextEditingController();

  bool isLoadingRoles = true;
  bool isCreating = false;
  bool hidePassword = true;

  String errorMessage = '';
  String selectedRoleId = '';

  List<Map<String, dynamic>> roles = [];

  @override
  void initState() {
    super.initState();
    loadRoles();
  }

  @override
  void dispose() {
    fullNameController.dispose();
    phoneController.dispose();
    emailController.dispose();
    passwordController.dispose();
    super.dispose();
  }

  Future<String?> getToken() async {
    final SharedPreferences prefs =
        await SharedPreferences.getInstance();

    const List<String> keys = [
      'auth_token',
      'token',
      'access_token',
      'accessToken',
      'jwt_token',
      'jwt',
    ];

    for (final String key in keys) {
      final String? value =
          prefs.getString(key);

      if (value == null ||
          value.trim().isEmpty) {
        continue;
      }

      String token = value.trim();

      if (token
          .toLowerCase()
          .startsWith('bearer ')) {
        token = token
            .substring(7)
            .trim();
      }

      if (token.isNotEmpty) {
        return token;
      }
    }

    return null;
  }

  Map<String, dynamic> decodeResponse(
    http.Response response,
  ) {
    try {
      final dynamic decoded =
          jsonDecode(response.body);

      if (decoded is Map) {
        return Map<String, dynamic>.from(
          decoded,
        );
      }
    } catch (_) {}

    return {
      'success': false,
      'message':
          'The server returned an invalid response.',
    };
  }

  String textValue(
    Map<String, dynamic> data,
    List<String> keys, {
    String fallback = '',
  }) {
    for (final String key in keys) {
      final dynamic value = data[key];

      if (value == null) {
        continue;
      }

      final String text =
          value.toString().trim();

      if (text.isNotEmpty &&
          text.toLowerCase() != 'null') {
        return text;
      }
    }

    return fallback;
  }

  Future<void> loadRoles() async {
    setState(() {
      isLoadingRoles = true;
      errorMessage = '';
    });

    try {
      final String? token =
          await getToken();

      if (token == null ||
          token.isEmpty) {
        throw Exception(
          'Login session has expired.',
        );
      }

      final http.Response response =
          await http.get(
        Uri.parse(
          '$baseUrl/staff-management/roles',
        ),
        headers: {
          'Accept': 'application/json',
          'Authorization': 'Bearer $token',
        },
      );

      final Map<String, dynamic> result =
          decodeResponse(response);

      if (response.statusCode < 200 ||
          response.statusCode >= 300 ||
          result['success'] != true) {
        throw Exception(
          result['message']?.toString() ??
              'Unable to load staff roles.',
        );
      }

      final dynamic rawRoles =
          result['roles'] ??
          result['data'] ??
          result['results'];

      final List<Map<String, dynamic>> list =
          rawRoles is List
              ? rawRoles
                  .whereType<Map>()
                  .map(
                    (Map item) =>
                        Map<String, dynamic>.from(
                      item,
                    ),
                  )
                  .where(
                    (Map<String, dynamic> role) {
                      final String status =
                          textValue(
                        role,
                        const ['status'],
                        fallback: 'ACTIVE',
                      ).toUpperCase();

                      return status == 'ACTIVE';
                    },
                  )
                  .toList()
              : <Map<String, dynamic>>[];

      if (!mounted) {
        return;
      }

      setState(() {
        roles = list;

        if (roles.isNotEmpty) {
          selectedRoleId = textValue(
            roles.first,
            const [
              '_id',
              'id',
            ],
          );
        }
      });
    } catch (error) {
      if (!mounted) {
        return;
      }

      setState(() {
        errorMessage = error
            .toString()
            .replaceFirst(
              'Exception: ',
              '',
            );
      });
    } finally {
      if (mounted) {
        setState(() {
          isLoadingRoles = false;
        });
      }
    }
  }

  String? validateFullName(
    String? value,
  ) {
    final String text =
        value?.trim() ?? '';

    if (text.isEmpty) {
      return 'Enter staff full name';
    }

    if (text.length < 3) {
      return 'Full name is too short';
    }

    return null;
  }

  String? validatePhone(
    String? value,
  ) {
    final String text =
        value?.trim() ?? '';

    if (text.isEmpty) {
      return 'Enter staff phone number';
    }

    if (!RegExp(r'^\d+$').hasMatch(text)) {
      return 'Phone number must contain digits only';
    }

    if (text.length < 10) {
      return 'Enter a valid phone number';
    }

    return null;
  }

  String? validateEmail(
    String? value,
  ) {
    final String text =
        value?.trim().toLowerCase() ?? '';

    if (text.isEmpty) {
      return 'Enter staff email address';
    }

    final RegExp emailPattern = RegExp(
      r'^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$',
    );

    if (!emailPattern.hasMatch(text)) {
      return 'Enter a valid email address';
    }

    return null;
  }

  String? validatePassword(
    String? value,
  ) {
    final String text = value ?? '';

    if (text.isEmpty) {
      return 'Enter a temporary password';
    }

    if (text.length < 6) {
      return 'Password must be at least 6 characters';
    }

    return null;
  }

  Future<void> createStaff() async {
    FocusScope.of(context).unfocus();

    final bool valid =
        formKey.currentState?.validate() ??
            false;

    if (!valid) {
      return;
    }

    if (selectedRoleId.isEmpty) {
      showMessage(
        'Please select a staff role.',
        isError: true,
      );
      return;
    }

    if (isCreating) {
      return;
    }

    setState(() {
      isCreating = true;
    });

    try {
      final String? token =
          await getToken();

      if (token == null ||
          token.isEmpty) {
        throw Exception(
          'Login session has expired.',
        );
      }

      final http.Response response =
          await http.post(
        Uri.parse(
          '$baseUrl/staff-management/staff',
        ),
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          'Authorization': 'Bearer $token',
        },
        body: jsonEncode({
          'fullName':
              fullNameController.text.trim(),
          'phone':
              phoneController.text.trim(),
          'email': emailController.text
              .trim()
              .toLowerCase(),
          'password':
              passwordController.text,
          'roleId': selectedRoleId,
        }),
      );

      final Map<String, dynamic> result =
          decodeResponse(response);

      if (response.statusCode < 200 ||
          response.statusCode >= 300 ||
          result['success'] != true) {
        throw Exception(
          result['message']?.toString() ??
              'Unable to create staff account.',
        );
      }

      final Map<String, dynamic> staff =
          result['staff'] is Map
              ? Map<String, dynamic>.from(
                  result['staff'],
                )
              : <String, dynamic>{};

      final String staffId = textValue(
        staff,
        const ['staffId'],
      );

      if (!mounted) {
        return;
      }

      showMessage(
        staffId.isEmpty
            ? 'Staff account created successfully.'
            : 'Staff account created successfully. Staff ID: $staffId',
        isError: false,
      );

      Navigator.of(context).pop(true);
    } catch (error) {
      showMessage(
        error
            .toString()
            .replaceFirst(
              'Exception: ',
              '',
            ),
        isError: true,
      );
    } finally {
      if (mounted) {
        setState(() {
          isCreating = false;
        });
      }
    }
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
          behavior:
              SnackBarBehavior.floating,
          backgroundColor: isError
              ? Colors.red.shade700
              : primaryGreen,
        ),
      );
  }

  String roleLabel(
    Map<String, dynamic> role,
  ) {
    final String displayName =
        textValue(
      role,
      const [
        'displayName',
        'name',
      ],
      fallback: 'Staff Role',
    );

    final String department =
        textValue(
      role,
      const ['department'],
    );

    if (department.isEmpty) {
      return displayName;
    }

    return '$displayName — '
        '${department.replaceAll('_', ' ')}';
  }

  @override
  Widget build(
    BuildContext context,
  ) {
    return Scaffold(
      backgroundColor:
          const Color(0xFFF7F9F8),
      appBar: AppBar(
        title: const Text(
          'Create Staff',
          style: TextStyle(
            fontWeight:
                FontWeight.w900,
          ),
        ),
      ),
      body: isLoadingRoles
          ? const Center(
              child:
                  CircularProgressIndicator(),
            )
          : Form(
              key: formKey,
              child: ListView(
                padding:
                    const EdgeInsets.all(20),
                children: [
                  Container(
                    padding:
                        const EdgeInsets.all(
                      18,
                    ),
                    decoration: BoxDecoration(
                      color: Colors.white,
                      borderRadius:
                          BorderRadius.circular(
                        20,
                      ),
                      border: Border.all(
                        color:
                            const Color(
                              0xFFE5E7EB,
                            ),
                      ),
                    ),
                    child: const Column(
                      children: [
                        Icon(
                          Icons.person_add_alt_1_rounded,
                          color: primaryGreen,
                          size: 52,
                        ),
                        SizedBox(height: 10),
                        Text(
                          'Create a ServicePay staff account',
                          textAlign:
                              TextAlign.center,
                          style: TextStyle(
                            fontSize: 19,
                            fontWeight:
                                FontWeight.w900,
                          ),
                        ),
                        SizedBox(height: 5),
                        Text(
                          'The staff member will be required to change the temporary password after login.',
                          textAlign:
                              TextAlign.center,
                          style: TextStyle(
                            color:
                                Color(
                                  0xFF6B7280,
                                ),
                            height: 1.4,
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 18),
                  if (errorMessage.isNotEmpty)
                    Container(
                      margin:
                          const EdgeInsets.only(
                        bottom: 16,
                      ),
                      padding:
                          const EdgeInsets.all(
                        14,
                      ),
                      decoration:
                          BoxDecoration(
                        color:
                            const Color(
                              0xFFFEE2E2,
                            ),
                        borderRadius:
                            BorderRadius.circular(
                          14,
                        ),
                      ),
                      child: Column(
                        children: [
                          Text(
                            errorMessage,
                            textAlign:
                                TextAlign.center,
                            style:
                                const TextStyle(
                              color:
                                  Color(
                                    0xFF991B1B,
                                  ),
                              fontWeight:
                                  FontWeight.w700,
                            ),
                          ),
                          const SizedBox(
                            height: 10,
                          ),
                          TextButton(
                            onPressed:
                                loadRoles,
                            child: const Text(
                              'Reload Roles',
                            ),
                          ),
                        ],
                      ),
                    ),
                  TextFormField(
                    controller:
                        fullNameController,
                    validator:
                        validateFullName,
                    textInputAction:
                        TextInputAction.next,
                    decoration:
                        const InputDecoration(
                      labelText:
                          'Full name',
                      prefixIcon: Icon(
                        Icons.person_outline,
                      ),
                      border:
                          OutlineInputBorder(),
                    ),
                  ),
                  const SizedBox(height: 16),
                  TextFormField(
                    controller:
                        phoneController,
                    validator:
                        validatePhone,
                    keyboardType:
                        TextInputType.phone,
                    textInputAction:
                        TextInputAction.next,
                    decoration:
                        const InputDecoration(
                      labelText:
                          'Phone number',
                      prefixIcon: Icon(
                        Icons.phone_outlined,
                      ),
                      border:
                          OutlineInputBorder(),
                    ),
                  ),
                  const SizedBox(height: 16),
                  TextFormField(
                    controller:
                        emailController,
                    validator:
                        validateEmail,
                    keyboardType:
                        TextInputType.emailAddress,
                    textInputAction:
                        TextInputAction.next,
                    decoration:
                        const InputDecoration(
                      labelText:
                          'Email address',
                      prefixIcon: Icon(
                        Icons.email_outlined,
                      ),
                      border:
                          OutlineInputBorder(),
                    ),
                  ),
                  const SizedBox(height: 16),
                  DropdownButtonFormField<String>(
                    value:
                        selectedRoleId.isEmpty
                            ? null
                            : selectedRoleId,
                    decoration:
                        const InputDecoration(
                      labelText:
                          'Staff role',
                      prefixIcon: Icon(
                        Icons.badge_outlined,
                      ),
                      border:
                          OutlineInputBorder(),
                    ),
                    items: roles.map(
                      (
                        Map<String, dynamic>
                            role,
                      ) {
                        final String id =
                            textValue(
                          role,
                          const [
                            '_id',
                            'id',
                          ],
                        );

                        return DropdownMenuItem<
                            String>(
                          value: id,
                          child: Text(
                            roleLabel(role),
                            overflow:
                                TextOverflow
                                    .ellipsis,
                          ),
                        );
                      },
                    ).toList(),
                    onChanged: isCreating
                        ? null
                        : (
                            String? value,
                          ) {
                            setState(() {
                              selectedRoleId =
                                  value ?? '';
                            });
                          },
                    validator: (
                      String? value,
                    ) {
                      if (value == null ||
                          value.isEmpty) {
                        return 'Select a staff role';
                      }

                      return null;
                    },
                  ),
                  const SizedBox(height: 16),
                  TextFormField(
                    controller:
                        passwordController,
                    validator:
                        validatePassword,
                    obscureText:
                        hidePassword,
                    textInputAction:
                        TextInputAction.done,
                    onFieldSubmitted: (_) {
                      if (!isCreating) {
                        createStaff();
                      }
                    },
                    decoration:
                        InputDecoration(
                      labelText:
                          'Temporary password',
                      prefixIcon:
                          const Icon(
                        Icons.lock_outline,
                      ),
                      suffixIcon:
                          IconButton(
                        onPressed:
                            isCreating
                                ? null
                                : () {
                                    setState(
                                      () {
                                        hidePassword =
                                            !hidePassword;
                                      },
                                    );
                                  },
                        icon: Icon(
                          hidePassword
                              ? Icons
                                  .visibility_off_outlined
                              : Icons
                                  .visibility_outlined,
                        ),
                      ),
                      border:
                          const OutlineInputBorder(),
                    ),
                  ),
                  const SizedBox(height: 10),
                  const Text(
                    'Use at least 6 characters. The staff member must change this password after the first login.',
                    style: TextStyle(
                      color:
                          Color(0xFF6B7280),
                      height: 1.4,
                    ),
                  ),
                  const SizedBox(height: 24),
                  SizedBox(
                    height: 56,
                    child:
                        FilledButton.icon(
                      onPressed: isCreating
                          ? null
                          : createStaff,
                      style:
                          FilledButton.styleFrom(
                        backgroundColor:
                            primaryGreen,
                      ),
                      icon: isCreating
                          ? const SizedBox(
                              width: 22,
                              height: 22,
                              child:
                                  CircularProgressIndicator(
                                strokeWidth:
                                    2.5,
                                color:
                                    Colors.white,
                              ),
                            )
                          : const Icon(
                              Icons
                                  .person_add_alt_1_rounded,
                            ),
                      label: Text(
                        isCreating
                            ? 'Creating Staff...'
                            : 'Create Staff Account',
                        style:
                            const TextStyle(
                          fontSize: 16,
                          fontWeight:
                              FontWeight.w800,
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            ),
    );
  }
}

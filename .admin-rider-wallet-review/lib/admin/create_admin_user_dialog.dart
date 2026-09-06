import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

Future<bool?> showCreateAdminUserDialog(
  BuildContext context,
  List<Map<String, dynamic>> users,
) {
  return showDialog<bool>(
    context: context,
    barrierDismissible: false,
    builder: (_) => _CreateAdminUserDialog(users: users),
  );
}

class _CreateAdminUserDialog extends StatefulWidget {
  const _CreateAdminUserDialog({
    required this.users,
  });

  final List<Map<String, dynamic>> users;

  @override
  State<_CreateAdminUserDialog> createState() =>
      _CreateAdminUserDialogState();
}

class _CreateAdminUserDialogState
    extends State<_CreateAdminUserDialog> {
  static const baseUrl =
      'https://api.servicepay.ng/api';

  final nameController = TextEditingController();
  final phoneController = TextEditingController();
  final emailController = TextEditingController();
  final passwordController = TextEditingController();
  final stateController = TextEditingController();
  final lgaController = TextEditingController();

  String role = 'ZONAL_MANAGER';
  String creatorRole = 'HEAD_OFFICE';
  String? creatorId;
  String status = 'ACTIVE';
  String? zone;
  String? zonalManagerId;
  String? stateManagerId;

  bool saving = false;
  bool hidePassword = true;

  static const zones = [
    'North Central',
    'North East',
    'North West',
    'South East',
    'South South',
    'South West',
  ];

  @override
  void initState() {
    super.initState();
    loadCreatorDetails();
  }

  Future<void> loadCreatorDetails() async {
    final prefs =
        await SharedPreferences.getInstance();

    final savedRole =
        (prefs.getString('user_role') ??
                prefs.getString('admin_role') ??
                'HEAD_OFFICE')
            .trim()
            .toUpperCase();

    final savedId =
        prefs.getString('user_id') ??
        prefs.getString('admin_id');

    if (!mounted) {
      return;
    }

    setState(() {
      creatorRole = savedRole;
      creatorId = savedId;

      if (creatorRole == 'ZONAL_MANAGER') {
        role = 'STATE_MANAGER';
        zonalManagerId = creatorId;
      } else if (creatorRole ==
          'STATE_MANAGER') {
        role = 'AGENT';
        stateManagerId = creatorId;
      } else {
        role = 'ZONAL_MANAGER';
      }
    });
  }

  @override
  void dispose() {
    nameController.dispose();
    phoneController.dispose();
    emailController.dispose();
    passwordController.dispose();
    stateController.dispose();
    lgaController.dispose();
    super.dispose();
  }

  List<Map<String, dynamic>> usersByRole(
    String selectedRole,
  ) {
    return widget.users
        .where(
          (user) =>
              user['role']?.toString() == selectedRole &&
              user['status']?.toString() == 'ACTIVE',
        )
        .toList();
  }

  Future<String?> getToken() async {
    final prefs =
        await SharedPreferences.getInstance();

    return prefs.getString('auth_token') ??
        prefs.getString('token') ??
        prefs.getString('admin_token');
  }

  void showMessage(String message) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(message),
        backgroundColor: Colors.red,
      ),
    );
  }

  Future<void> createAccount() async {
    final fullName = nameController.text.trim();
    final phone = phoneController.text.trim();
    final email = emailController.text.trim();
    final password = passwordController.text;
    final state = stateController.text.trim();
    final lga = lgaController.text.trim();

    if (fullName.isEmpty) {
      showMessage('Enter full name.');
      return;
    }

    if (phone.isEmpty) {
      showMessage('Enter phone number.');
      return;
    }

    if (password.length < 6) {
      showMessage(
        'Password must contain at least 6 characters.',
      );
      return;
    }

    if (zone == null || zone!.isEmpty) {
      showMessage('Select zone.');
      return;
    }

    if (role != 'ZONAL_MANAGER' && state.isEmpty) {
      showMessage('Enter state.');
      return;
    }

    if (role == 'AGENT' && lga.isEmpty) {
      showMessage('Enter LGA.');
      return;
    }

    if (role == 'STATE_MANAGER' &&
        creatorRole == 'HEAD_OFFICE' &&
        zonalManagerId == null) {
      showMessage('Select a Zonal Manager.');
      return;
    }

    if (role == 'AGENT' &&
        creatorRole == 'HEAD_OFFICE' &&
        stateManagerId == null) {
      showMessage('Select a State Manager.');
      return;
    }

    setState(() {
      saving = true;
    });

    try {
      final token = await getToken();

      if (token == null || token.isEmpty) {
        throw Exception(
          'Admin authentication token was not found.',
        );
      }

      final payload = <String, dynamic>{
        'fullName': fullName,
        'phone': phone,
        'password': password,
        'role': role,
        'status': status,
        'zone': zone,
      };

      if (email.isNotEmpty) {
        payload['email'] = email;
      }

      if (state.isNotEmpty) {
        payload['state'] = state;
      }

      if (lga.isNotEmpty) {
        payload['lga'] = lga;
      }

      if (zonalManagerId != null) {
        payload['zonalManagerId'] =
            zonalManagerId;
      }

      if (stateManagerId != null) {
        payload['stateManagerId'] =
            stateManagerId;
      }

      final response = await http
          .post(
            Uri.parse('$baseUrl/admin/users'),
            headers: {
              'Accept': 'application/json',
              'Content-Type':
                  'application/json',
              'Authorization':
                  'Bearer $token',
            },
            body: jsonEncode(payload),
          )
          .timeout(
            const Duration(seconds: 45),
          );

      final body = jsonDecode(response.body);

      if ((response.statusCode == 200 ||
              response.statusCode == 201) &&
          body['success'] == true) {
        if (!mounted) {
          return;
        }

        Navigator.pop(context, true);
        return;
      }

      throw Exception(
        body['message'] ??
            'Failed to create account.',
      );
    } catch (error) {
      showMessage(
        error
            .toString()
            .replaceFirst('Exception: ', ''),
      );
    } finally {
      if (mounted) {
        setState(() {
          saving = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final zonalManagers =
        usersByRole('ZONAL_MANAGER');

    final stateManagers =
        usersByRole('STATE_MANAGER');

    return AlertDialog(
      title: Text(
        'Create ${role.replaceAll('_', ' ')}',
      ),
      content: SizedBox(
        width: 500,
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              DropdownButtonFormField<String>(
                value: role,
                isExpanded: true,
                decoration: const InputDecoration(
                  labelText: 'Role',
                  border: OutlineInputBorder(),
                ),
                items: creatorRole == 'ZONAL_MANAGER'
                    ? const [
                        DropdownMenuItem(
                          value: 'STATE_MANAGER',
                          child: Text('State Manager'),
                        ),
                      ]
                    : creatorRole == 'STATE_MANAGER'
                        ? const [
                            DropdownMenuItem(
                              value: 'AGENT',
                              child: Text('Agent'),
                            ),
                          ]
                        : const [
                            DropdownMenuItem(
                              value: 'ZONAL_MANAGER',
                              child: Text('Zonal Manager'),
                            ),
                            DropdownMenuItem(
                              value: 'STATE_MANAGER',
                              child: Text('State Manager'),
                            ),
                            DropdownMenuItem(
                              value: 'AGENT',
                              child: Text('Agent'),
                            ),
                          ],
                onChanged: saving ||
                        creatorRole != 'HEAD_OFFICE'
                    ? null
                    : (value) {
                        if (value == null) {
                          return;
                        }

                        setState(() {
                          role = value;
                          zonalManagerId = null;
                          stateManagerId = null;
                        });
                      },
              ),
              const SizedBox(height: 14),
              TextField(
                controller: nameController,
                decoration: const InputDecoration(
                  labelText: 'Full name',
                  prefixIcon:
                      Icon(Icons.person_outline),
                  border: OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: 14),
              TextField(
                controller: phoneController,
                keyboardType: TextInputType.phone,
                decoration: const InputDecoration(
                  labelText: 'Phone number',
                  prefixIcon:
                      Icon(Icons.phone_outlined),
                  border: OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: 14),
              TextField(
                controller: emailController,
                keyboardType:
                    TextInputType.emailAddress,
                decoration: const InputDecoration(
                  labelText: 'Email (optional)',
                  prefixIcon:
                      Icon(Icons.email_outlined),
                  border: OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: 14),
              TextField(
                controller: passwordController,
                obscureText: hidePassword,
                decoration: InputDecoration(
                  labelText: 'Temporary password',
                  prefixIcon:
                      const Icon(Icons.lock_outline),
                  suffixIcon: IconButton(
                    onPressed: () {
                      setState(() {
                        hidePassword =
                            !hidePassword;
                      });
                    },
                    icon: Icon(
                      hidePassword
                          ? Icons.visibility_outlined
                          : Icons
                              .visibility_off_outlined,
                    ),
                  ),
                  border:
                      const OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: 14),
              DropdownButtonFormField<String>(
                value: zone,
                isExpanded: true,
                decoration: const InputDecoration(
                  labelText: 'Zone',
                  border: OutlineInputBorder(),
                ),
                items: zones
                    .map(
                      (item) =>
                          DropdownMenuItem(
                        value: item,
                        child: Text(item),
                      ),
                    )
                    .toList(),
                onChanged: saving
                    ? null
                    : (value) {
                        setState(() {
                          zone = value;
                        });
                      },
              ),
              if (role != 'ZONAL_MANAGER') ...[
                const SizedBox(height: 14),
                TextField(
                  controller: stateController,
                  decoration:
                      const InputDecoration(
                    labelText: 'State',
                    border: OutlineInputBorder(),
                  ),
                ),
              ],
              if (role == 'AGENT') ...[
                const SizedBox(height: 14),
                TextField(
                  controller: lgaController,
                  decoration:
                      const InputDecoration(
                    labelText: 'LGA',
                    border: OutlineInputBorder(),
                  ),
                ),
              ],
              if (role == 'STATE_MANAGER' &&
                  creatorRole == 'HEAD_OFFICE') ...[
                const SizedBox(height: 14),
                DropdownButtonFormField<String>(
                  value: zonalManagerId,
                  isExpanded: true,
                  decoration:
                      const InputDecoration(
                    labelText: 'Zonal Manager',
                    border: OutlineInputBorder(),
                  ),
                  items: zonalManagers
                      .map(
                        (manager) =>
                            DropdownMenuItem(
                          value: manager['_id']
                              ?.toString(),
                          child: Text(
                            manager['fullName']
                                    ?.toString() ??
                                'Unknown Manager',
                          ),
                        ),
                      )
                      .toList(),
                  onChanged: saving
                      ? null
                      : (value) {
                          setState(() {
                            zonalManagerId = value;
                          });
                        },
                ),
              ],
              if (role == 'AGENT' &&
                  creatorRole == 'HEAD_OFFICE') ...[
                const SizedBox(height: 14),
                DropdownButtonFormField<String>(
                  value: stateManagerId,
                  isExpanded: true,
                  decoration:
                      const InputDecoration(
                    labelText: 'State Manager',
                    border: OutlineInputBorder(),
                  ),
                  items: stateManagers
                      .map(
                        (manager) =>
                            DropdownMenuItem(
                          value: manager['_id']
                              ?.toString(),
                          child: Text(
                            manager['fullName']
                                    ?.toString() ??
                                'Unknown Manager',
                          ),
                        ),
                      )
                      .toList(),
                  onChanged: saving
                      ? null
                      : (value) {
                          setState(() {
                            stateManagerId = value;
                          });
                        },
                ),
              ],
              const SizedBox(height: 14),
              DropdownButtonFormField<String>(
                value: status,
                decoration: const InputDecoration(
                  labelText: 'Status',
                  border: OutlineInputBorder(),
                ),
                items: const [
                  DropdownMenuItem(
                    value: 'ACTIVE',
                    child: Text('Active'),
                  ),
                  DropdownMenuItem(
                    value: 'SUSPENDED',
                    child: Text('Suspended'),
                  ),
                  DropdownMenuItem(
                    value: 'BLOCKED',
                    child: Text('Blocked'),
                  ),
                ],
                onChanged: saving
                    ? null
                    : (value) {
                        if (value != null) {
                          setState(() {
                            status = value;
                          });
                        }
                      },
              ),
              if (saving) ...[
                const SizedBox(height: 18),
                const LinearProgressIndicator(),
              ],
            ],
          ),
        ),
      ),
      actions: [
        TextButton(
          onPressed: saving
              ? null
              : () {
                  Navigator.pop(context, false);
                },
          child: const Text('Cancel'),
        ),
        FilledButton.icon(
          onPressed:
              saving ? null : createAccount,
          icon: const Icon(
            Icons.person_add_alt_1,
          ),
          label: const Text('Create'),
        ),
      ],
    );
  }
}

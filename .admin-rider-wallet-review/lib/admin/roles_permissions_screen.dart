import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

class RolesPermissionsScreen extends StatefulWidget {
  const RolesPermissionsScreen({
    super.key,
  });

  @override
  State<RolesPermissionsScreen> createState() =>
      _RolesPermissionsScreenState();
}

class _RolesPermissionsScreenState
    extends State<RolesPermissionsScreen> {
  static const String baseUrl =
      'https://api.servicepay.ng/api';

  static const Color primaryColor =
      Color(0xFF149B8F);

  bool isLoading = true;
  bool isRefreshing = false;

  String errorMessage = '';

  List<Map<String, dynamic>> roles = [];
  List<String> permissionCatalog = [];

  @override
  void initState() {
    super.initState();
    loadData();
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
      final String? value = prefs.getString(key);

      if (value == null || value.trim().isEmpty) {
        continue;
      }

      String token = value.trim();

      if (token.toLowerCase().startsWith('bearer ')) {
        token = token.substring(7).trim();
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
      final dynamic decoded = jsonDecode(
        response.body,
      );

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

      final String text = value.toString().trim();

      if (text.isNotEmpty &&
          text.toLowerCase() != 'null') {
        return text;
      }
    }

    return fallback;
  }

  List<String> stringList(
    dynamic value,
  ) {
    if (value is! List) {
      return <String>[];
    }

    return value
        .map(
          (dynamic item) =>
              item.toString().trim().toLowerCase(),
        )
        .where(
          (String item) => item.isNotEmpty,
        )
        .toSet()
        .toList();
  }

  Future<void> loadData({
    bool refresh = false,
  }) async {
    if (refresh) {
      setState(() {
        isRefreshing = true;
      });
    } else {
      setState(() {
        isLoading = true;
      });
    }

    try {
      final String? token = await getToken();

      if (token == null || token.isEmpty) {
        throw Exception(
          'Login session has expired.',
        );
      }

      final Future<http.Response> rolesRequest =
          http.get(
        Uri.parse(
          '$baseUrl/staff-management/roles',
        ),
        headers: {
          'Accept': 'application/json',
          'Authorization': 'Bearer $token',
        },
      );

      final Future<http.Response> permissionsRequest =
          http.get(
        Uri.parse(
          '$baseUrl/staff-management/permissions',
        ),
        headers: {
          'Accept': 'application/json',
          'Authorization': 'Bearer $token',
        },
      );

      final List<http.Response> responses =
          await Future.wait(
        [
          rolesRequest,
          permissionsRequest,
        ],
      );

      final http.Response rolesResponse =
          responses[0];

      final http.Response permissionsResponse =
          responses[1];

      final Map<String, dynamic> rolesResult =
          decodeResponse(
        rolesResponse,
      );

      final Map<String, dynamic> permissionsResult =
          decodeResponse(
        permissionsResponse,
      );

      if (rolesResponse.statusCode < 200 ||
          rolesResponse.statusCode >= 300 ||
          rolesResult['success'] != true) {
        throw Exception(
          rolesResult['message']?.toString() ??
              'Unable to load staff roles.',
        );
      }

      if (permissionsResponse.statusCode < 200 ||
          permissionsResponse.statusCode >= 300 ||
          permissionsResult['success'] != true) {
        throw Exception(
          permissionsResult['message']?.toString() ??
              'Unable to load permissions.',
        );
      }

      final dynamic rawRoles =
          rolesResult['roles'] ??
          rolesResult['data'] ??
          rolesResult['results'];

      final List<Map<String, dynamic>> loadedRoles =
          rawRoles is List
              ? rawRoles
                  .whereType<Map>()
                  .map(
                    (Map item) =>
                        Map<String, dynamic>.from(
                      item,
                    ),
                  )
                  .toList()
              : <Map<String, dynamic>>[];

      final List<String> loadedPermissions =
          stringList(
        permissionsResult['permissions'] ??
            permissionsResult['data'],
      );

      loadedPermissions.sort();

      if (!mounted) {
        return;
      }

      setState(() {
        roles = loadedRoles;
        permissionCatalog = loadedPermissions;
        errorMessage = '';
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
          isLoading = false;
          isRefreshing = false;
        });
      }
    }
  }

  Future<void> openRoleEditor(
    Map<String, dynamic> role,
  ) async {
    final String roleId = textValue(
      role,
      const [
        '_id',
        'id',
      ],
    );

    if (roleId.isEmpty) {
      showMessage(
        'Role ID was not received.',
        isError: true,
      );
      return;
    }

    final TextEditingController displayNameController =
        TextEditingController(
      text: textValue(
        role,
        const [
          'displayName',
          'name',
        ],
      ),
    );

    final TextEditingController departmentController =
        TextEditingController(
      text: textValue(
        role,
        const ['department'],
      ),
    );

    final TextEditingController descriptionController =
        TextEditingController(
      text: textValue(
        role,
        const ['description'],
      ),
    );

    final Set<String> selectedPermissions =
        stringList(
      role['permissions'],
    ).toSet();

    String selectedStatus = textValue(
      role,
      const ['status'],
      fallback: 'ACTIVE',
    ).toUpperCase();

    bool isSaving = false;

    final bool? updated =
        await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (
        BuildContext sheetContext,
      ) {
        return StatefulBuilder(
          builder: (
            BuildContext context,
            StateSetter setSheetState,
          ) {
            Future<void> saveRole() async {
              final String displayName =
                  displayNameController.text.trim();

              final String department =
                  departmentController.text
                      .trim()
                      .toUpperCase()
                      .replaceAll(' ', '_');

              if (displayName.isEmpty) {
                showMessage(
                  'Display name is required.',
                  isError: true,
                );
                return;
              }

              if (department.isEmpty) {
                showMessage(
                  'Department is required.',
                  isError: true,
                );
                return;
              }

              setSheetState(() {
                isSaving = true;
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
                    await http.put(
                  Uri.parse(
                    '$baseUrl/staff-management/roles/$roleId',
                  ),
                  headers: {
                    'Accept': 'application/json',
                    'Content-Type':
                        'application/json',
                    'Authorization':
                        'Bearer $token',
                  },
                  body: jsonEncode({
                    'displayName': displayName,
                    'department': department,
                    'description':
                        descriptionController.text
                            .trim(),
                    'permissions':
                        selectedPermissions.toList()
                          ..sort(),
                    'status': selectedStatus,
                  }),
                );

                final Map<String, dynamic> result =
                    decodeResponse(response);

                if (response.statusCode < 200 ||
                    response.statusCode >= 300 ||
                    result['success'] != true) {
                  throw Exception(
                    result['message']?.toString() ??
                        'Unable to update role.',
                  );
                }

                if (!sheetContext.mounted) {
                  return;
                }

                Navigator.of(sheetContext).pop(true);
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
                if (sheetContext.mounted) {
                  setSheetState(() {
                    isSaving = false;
                  });
                }
              }
            }

            return Padding(
              padding: EdgeInsets.only(
                left: 18,
                right: 18,
                top: 18,
                bottom:
                    MediaQuery.of(context)
                            .viewInsets
                            .bottom +
                        20,
              ),
              child: Column(
                children: [
                  Container(
                    width: 46,
                    height: 5,
                    decoration: BoxDecoration(
                      color: Colors.grey.shade300,
                      borderRadius:
                          BorderRadius.circular(20),
                    ),
                  ),
                  const SizedBox(height: 16),
                  Row(
                    children: [
                      const Expanded(
                        child: Text(
                          'Edit Role & Permissions',
                          style: TextStyle(
                            fontSize: 21,
                            fontWeight:
                                FontWeight.w900,
                          ),
                        ),
                      ),
                      IconButton(
                        onPressed: isSaving
                            ? null
                            : () {
                                Navigator.of(context)
                                    .pop(false);
                              },
                        icon: const Icon(
                          Icons.close_rounded,
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 16),
                  Expanded(
                    child: ListView(
                      children: [
                        TextField(
                          controller:
                              displayNameController,
                          enabled: !isSaving,
                          decoration:
                              const InputDecoration(
                            labelText:
                                'Role display name',
                            prefixIcon: Icon(
                              Icons.badge_outlined,
                            ),
                            border:
                                OutlineInputBorder(),
                          ),
                        ),
                        const SizedBox(height: 14),
                        TextField(
                          controller:
                              departmentController,
                          enabled: !isSaving,
                          decoration:
                              const InputDecoration(
                            labelText: 'Department',
                            prefixIcon: Icon(
                              Icons.business_outlined,
                            ),
                            border:
                                OutlineInputBorder(),
                          ),
                        ),
                        const SizedBox(height: 14),
                        TextField(
                          controller:
                              descriptionController,
                          enabled: !isSaving,
                          maxLines: 3,
                          decoration:
                              const InputDecoration(
                            labelText:
                                'Role description',
                            prefixIcon: Icon(
                              Icons.notes_rounded,
                            ),
                            border:
                                OutlineInputBorder(),
                          ),
                        ),
                        const SizedBox(height: 14),
                        DropdownButtonFormField<String>(
                          value:
                              selectedStatus,
                          decoration:
                              const InputDecoration(
                            labelText: 'Role status',
                            prefixIcon: Icon(
                              Icons.toggle_on_outlined,
                            ),
                            border:
                                OutlineInputBorder(),
                          ),
                          items: const [
                            DropdownMenuItem(
                              value: 'ACTIVE',
                              child: Text('ACTIVE'),
                            ),
                            DropdownMenuItem(
                              value: 'INACTIVE',
                              child: Text('INACTIVE'),
                            ),
                          ],
                          onChanged: isSaving
                              ? null
                              : (
                                  String? value,
                                ) {
                                  setSheetState(() {
                                    selectedStatus =
                                        value ??
                                            'ACTIVE';
                                  });
                                },
                        ),
                        const SizedBox(height: 22),
                        Row(
                          children: [
                            const Expanded(
                              child: Text(
                                'Permissions',
                                style: TextStyle(
                                  fontSize: 18,
                                  fontWeight:
                                      FontWeight.w900,
                                ),
                              ),
                            ),
                            TextButton(
                              onPressed: isSaving
                                  ? null
                                  : () {
                                      setSheetState(() {
                                        selectedPermissions
                                          ..clear()
                                          ..addAll(
                                            permissionCatalog,
                                          );
                                      });
                                    },
                              child: const Text(
                                'Select all',
                              ),
                            ),
                            TextButton(
                              onPressed: isSaving
                                  ? null
                                  : () {
                                      setSheetState(() {
                                        selectedPermissions
                                            .clear();
                                      });
                                    },
                              child: const Text(
                                'Clear',
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 6),
                        ...buildPermissionGroups(
                          selectedPermissions:
                              selectedPermissions,
                          isSaving: isSaving,
                          setSheetState:
                              setSheetState,
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 14),
                  SizedBox(
                    width: double.infinity,
                    height: 54,
                    child: FilledButton.icon(
                      onPressed:
                          isSaving ? null : saveRole,
                      style: FilledButton.styleFrom(
                        backgroundColor:
                            primaryColor,
                      ),
                      icon: isSaving
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
                              Icons.save_rounded,
                            ),
                      label: Text(
                        isSaving
                            ? 'Saving...'
                            : 'Save Role',
                        style: const TextStyle(
                          fontWeight:
                              FontWeight.w800,
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            );
          },
        );
      },
    );

    displayNameController.dispose();
    departmentController.dispose();
    descriptionController.dispose();

    if (updated == true) {
      showMessage(
        'Role updated successfully.',
        isError: false,
      );

      await loadData(
        refresh: true,
      );
    }
  }

  List<Widget> buildPermissionGroups({
    required Set<String> selectedPermissions,
    required bool isSaving,
    required StateSetter setSheetState,
  }) {
    final Map<String, List<String>> groups = {};

    for (final String permission
        in permissionCatalog) {
      final String group =
          permission.contains('.')
              ? permission.split('.').first
              : 'other';

      groups
          .putIfAbsent(
            group,
            () => <String>[],
          )
          .add(permission);
    }

    final List<String> groupNames =
        groups.keys.toList()..sort();

    return groupNames.map(
      (String groupName) {
        final List<String> permissions =
            groups[groupName]!..sort();

        return Card(
          elevation: 0,
          margin: const EdgeInsets.only(
            bottom: 10,
          ),
          shape: RoundedRectangleBorder(
            borderRadius:
                BorderRadius.circular(14),
            side: const BorderSide(
              color: Color(0xFFE5E7EB),
            ),
          ),
          child: ExpansionTile(
            title: Text(
              groupName
                  .replaceAll('_', ' ')
                  .toUpperCase(),
              style: const TextStyle(
                fontWeight: FontWeight.w900,
              ),
            ),
            subtitle: Text(
              '${permissions.where(selectedPermissions.contains).length}'
              ' of ${permissions.length} selected',
            ),
            children: permissions.map(
              (String permission) {
                final bool selected =
                    selectedPermissions.contains(
                  permission,
                );

                return CheckboxListTile(
                  value: selected,
                  title: Text(
                    permission,
                  ),
                  controlAffinity:
                      ListTileControlAffinity.leading,
                  onChanged: isSaving
                      ? null
                      : (
                          bool? value,
                        ) {
                          setSheetState(() {
                            if (value == true) {
                              selectedPermissions.add(
                                permission,
                              );
                            } else {
                              selectedPermissions.remove(
                                permission,
                              );
                            }
                          });
                        },
                );
              },
            ).toList(),
          ),
        );
      },
    ).toList();
  }

  Widget buildRoleCard(
    Map<String, dynamic> role,
  ) {
    final String displayName = textValue(
      role,
      const [
        'displayName',
        'name',
      ],
      fallback: 'Staff Role',
    );

    final String internalName = textValue(
      role,
      const ['name'],
    );

    final String department = textValue(
      role,
      const ['department'],
      fallback: 'GENERAL',
    );

    final String description = textValue(
      role,
      const ['description'],
      fallback: 'No description has been added.',
    );

    final String status = textValue(
      role,
      const ['status'],
      fallback: 'ACTIVE',
    ).toUpperCase();

    final List<String> permissions =
        stringList(
      role['permissions'],
    );

    final bool active = status == 'ACTIVE';

    return Card(
      elevation: 0,
      margin: const EdgeInsets.only(
        bottom: 14,
      ),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(
          18,
        ),
        side: const BorderSide(
          color: Color(0xFFE5E7EB),
        ),
      ),
      child: InkWell(
        borderRadius: BorderRadius.circular(
          18,
        ),
        onTap: () {
          openRoleEditor(role);
        },
        child: Padding(
          padding: const EdgeInsets.all(17),
          child: Column(
            crossAxisAlignment:
                CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  CircleAvatar(
                    backgroundColor:
                        const Color(
                      0xFFE5F7F4,
                    ),
                    child: const Icon(
                      Icons.admin_panel_settings_outlined,
                      color: primaryColor,
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment:
                          CrossAxisAlignment.start,
                      children: [
                        Text(
                          displayName,
                          style: const TextStyle(
                            fontSize: 17,
                            fontWeight:
                                FontWeight.w900,
                          ),
                        ),
                        if (internalName.isNotEmpty)
                          Text(
                            internalName,
                            style: const TextStyle(
                              color:
                                  Color(0xFF6B7280),
                              fontSize: 12,
                            ),
                          ),
                      ],
                    ),
                  ),
                  Container(
                    padding:
                        const EdgeInsets.symmetric(
                      horizontal: 10,
                      vertical: 6,
                    ),
                    decoration: BoxDecoration(
                      color: active
                          ? const Color(
                              0xFFE7F7EE,
                            )
                          : const Color(
                              0xFFFEE2E2,
                            ),
                      borderRadius:
                          BorderRadius.circular(
                        20,
                      ),
                    ),
                    child: Text(
                      status,
                      style: TextStyle(
                        color: active
                            ? const Color(
                                0xFF15803D,
                              )
                            : const Color(
                                0xFFB91C1C,
                              ),
                        fontSize: 11,
                        fontWeight:
                            FontWeight.w900,
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 14),
              Text(
                'Department: '
                '${department.replaceAll('_', ' ')}',
                style: const TextStyle(
                  fontWeight: FontWeight.w700,
                ),
              ),
              const SizedBox(height: 7),
              Text(
                description,
                style: const TextStyle(
                  color: Color(0xFF6B7280),
                  height: 1.4,
                ),
              ),
              const SizedBox(height: 14),
              Row(
                children: [
                  const Icon(
                    Icons.key_rounded,
                    size: 18,
                    color: primaryColor,
                  ),
                  const SizedBox(width: 7),
                  Text(
                    '${permissions.length} permissions',
                    style: const TextStyle(
                      color: primaryColor,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                  const Spacer(),
                  const Text(
                    'Tap to edit',
                    style: TextStyle(
                      color: Color(0xFF6B7280),
                    ),
                  ),
                  const SizedBox(width: 5),
                  const Icon(
                    Icons.chevron_right_rounded,
                    color: Color(0xFF6B7280),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
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
          backgroundColor: isError
              ? Colors.red.shade700
              : primaryColor,
        ),
      );
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
          'Roles & Permissions',
          style: TextStyle(
            fontWeight: FontWeight.w900,
          ),
        ),
        actions: [
          IconButton(
            onPressed: isRefreshing
                ? null
                : () {
                    loadData(
                      refresh: true,
                    );
                  },
            icon: const Icon(
              Icons.refresh_rounded,
            ),
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: () => loadData(
          refresh: true,
        ),
        child: ListView(
          padding: const EdgeInsets.all(18),
          children: [
            Container(
              padding: const EdgeInsets.all(17),
              decoration: BoxDecoration(
                color: const Color(0xFFE5F7F4),
                borderRadius:
                    BorderRadius.circular(18),
              ),
              child: const Row(
                crossAxisAlignment:
                    CrossAxisAlignment.start,
                children: [
                  Icon(
                    Icons.security_rounded,
                    color: primaryColor,
                  ),
                  SizedBox(width: 12),
                  Expanded(
                    child: Text(
                      'Select a role to control its department, status and permissions. Staff assigned to the role will inherit these permissions.',
                      style: TextStyle(
                        height: 1.4,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 18),
            if (isLoading)
              const Padding(
                padding: EdgeInsets.all(40),
                child: Center(
                  child:
                      CircularProgressIndicator(),
                ),
              )
            else if (errorMessage.isNotEmpty)
              Container(
                padding: const EdgeInsets.all(18),
                decoration: BoxDecoration(
                  color:
                      const Color(0xFFFEE2E2),
                  borderRadius:
                      BorderRadius.circular(16),
                ),
                child: Column(
                  children: [
                    Text(
                      errorMessage,
                      textAlign: TextAlign.center,
                      style: const TextStyle(
                        color:
                            Color(0xFF991B1B),
                        fontWeight:
                            FontWeight.w700,
                      ),
                    ),
                    const SizedBox(height: 12),
                    FilledButton(
                      onPressed: loadData,
                      child: const Text(
                        'Try Again',
                      ),
                    ),
                  ],
                ),
              )
            else if (roles.isEmpty)
              const Padding(
                padding: EdgeInsets.all(40),
                child: Center(
                  child: Text(
                    'No staff role was found.',
                    style: TextStyle(
                      fontWeight:
                          FontWeight.w700,
                    ),
                  ),
                ),
              )
            else
              ...roles.map(
                buildRoleCard,
              ),
          ],
        ),
      ),
    );
  }
}

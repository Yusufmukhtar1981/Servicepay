import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

import 'create_staff_screen.dart';
import 'roles_permissions_screen.dart';

class StaffManagementScreen extends StatefulWidget {
  const StaffManagementScreen({
    super.key,
  });

  @override
  State<StaffManagementScreen> createState() =>
      _StaffManagementScreenState();
}

class _StaffManagementScreenState
    extends State<StaffManagementScreen> {
  static const String baseUrl =
      'https://api.servicepay.ng/api';

  bool isLoading = true;
  bool isRefreshing = false;
  String errorMessage = '';

  final TextEditingController searchController =
      TextEditingController();

  List<Map<String, dynamic>> staff = [];

  @override
  void initState() {
    super.initState();
    loadStaff();
  }

  @override
  void dispose() {
    searchController.dispose();
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
      final String? value = prefs.getString(key);

      if (value == null || value.trim().isEmpty) {
        continue;
      }

      String token = value.trim();

      if (token.toLowerCase().startsWith(
            'bearer ',
          )) {
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

  Future<void> loadStaff({
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

      final String query =
          searchController.text.trim();

      final Uri uri = Uri.parse(
        '$baseUrl/staff-management/staff',
      ).replace(
        queryParameters: {
          if (query.isNotEmpty) 'search': query,
        },
      );

      final http.Response response =
          await http.get(
        uri,
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
              'Unable to load staff.',
        );
      }

      final dynamic rawData =
          result['staff'] ??
          result['data'] ??
          result['results'];

      final List<Map<String, dynamic>> list =
          rawData is List
              ? rawData
                  .whereType<Map>()
                  .map(
                    (Map item) =>
                        Map<String, dynamic>.from(
                      item,
                    ),
                  )
                  .toList()
              : <Map<String, dynamic>>[];

      if (!mounted) {
        return;
      }

      setState(() {
        staff = list;
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

  Map<String, dynamic> mapValue(
    dynamic value,
  ) {
    if (value is Map) {
      return Map<String, dynamic>.from(value);
    }

    return <String, dynamic>{};
  }

  Future<void> updateStatus(
    Map<String, dynamic> staffMember,
    String newStatus,
  ) async {
    final String staffId = textValue(
      staffMember,
      const [
        '_id',
        'id',
      ],
    );

    if (staffId.isEmpty) {
      return;
    }

    try {
      final String? token = await getToken();

      if (token == null || token.isEmpty) {
        throw Exception(
          'Login session has expired.',
        );
      }

      final http.Response response =
          await http.put(
        Uri.parse(
          '$baseUrl/staff-management/staff/'
          '$staffId/status',
        ),
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          'Authorization': 'Bearer $token',
        },
        body: jsonEncode({
          'status': newStatus,
        }),
      );

      final Map<String, dynamic> result =
          decodeResponse(response);

      if (response.statusCode < 200 ||
          response.statusCode >= 300 ||
          result['success'] != true) {
        throw Exception(
          result['message']?.toString() ??
              'Unable to update staff status.',
        );
      }

      if (!mounted) {
        return;
      }

      ScaffoldMessenger.of(context)
        ..hideCurrentSnackBar()
        ..showSnackBar(
          SnackBar(
            content: Text(
              'Staff status changed to $newStatus.',
            ),
            behavior: SnackBarBehavior.floating,
          ),
        );

      await loadStaff(
        refresh: true,
      );
    } catch (error) {
      if (!mounted) {
        return;
      }

      ScaffoldMessenger.of(context)
        ..hideCurrentSnackBar()
        ..showSnackBar(
          SnackBar(
            content: Text(
              error
                  .toString()
                  .replaceFirst(
                    'Exception: ',
                    '',
                  ),
            ),
            backgroundColor:
                Colors.red.shade700,
            behavior: SnackBarBehavior.floating,
          ),
        );
    }
  }

  Widget buildStaffCard(
    Map<String, dynamic> item,
  ) {
    final Map<String, dynamic> role =
        mapValue(item['staffRole']);

    final String fullName = textValue(
      item,
      const [
        'fullName',
        'full_name',
        'name',
      ],
      fallback: 'ServicePay Staff',
    );

    final String email = textValue(
      item,
      const ['email'],
    );

    final String phone = textValue(
      item,
      const [
        'phone',
        'phoneNumber',
      ],
    );

    final String staffId = textValue(
      item,
      const ['staffId'],
    );

    final String roleName = textValue(
      role,
      const [
        'displayName',
        'name',
      ],
      fallback: 'Staff',
    );

    final String department = textValue(
      item,
      const ['department'],
      fallback: textValue(
        role,
        const ['department'],
        fallback: 'General',
      ),
    );

    final String status = textValue(
      item,
      const ['status'],
      fallback: 'ACTIVE',
    ).toUpperCase();

    final bool active = status == 'ACTIVE';

    return Card(
      margin: const EdgeInsets.only(
        bottom: 12,
      ),
      elevation: 0,
      color: Colors.white,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(
          18,
        ),
        side: const BorderSide(
          color: Color(0xFFE5E7EB),
        ),
      ),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment:
              CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                CircleAvatar(
                  backgroundColor: active
                      ? const Color(0xFFE7F7EE)
                      : const Color(0xFFFEE2E2),
                  child: Icon(
                    Icons.badge_outlined,
                    color: active
                        ? const Color(0xFF15803D)
                        : const Color(0xFFB91C1C),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment:
                        CrossAxisAlignment.start,
                    children: [
                      Text(
                        fullName,
                        style: const TextStyle(
                          fontSize: 16,
                          fontWeight:
                              FontWeight.w900,
                        ),
                      ),
                      const SizedBox(height: 3),
                      Text(
                        roleName,
                        style: const TextStyle(
                          color:
                              Color(0xFF0F766E),
                          fontWeight:
                              FontWeight.w700,
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
                        ? const Color(0xFFE7F7EE)
                        : const Color(0xFFFEE2E2),
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
            if (staffId.isNotEmpty)
              Text(
                'Staff ID: $staffId',
              ),
            if (department.isNotEmpty)
              Text(
                'Department: '
                '${department.replaceAll('_', ' ')}',
              ),
            if (email.isNotEmpty)
              Text(
                'Email: $email',
              ),
            if (phone.isNotEmpty)
              Text(
                'Phone: $phone',
              ),
            const SizedBox(height: 14),
            Align(
              alignment: Alignment.centerRight,
              child: OutlinedButton.icon(
                onPressed: () {
                  updateStatus(
                    item,
                    active
                        ? 'SUSPENDED'
                        : 'ACTIVE',
                  );
                },
                icon: Icon(
                  active
                      ? Icons.pause_circle_outline
                      : Icons.check_circle_outline,
                ),
                label: Text(
                  active
                      ? 'Suspend'
                      : 'Activate',
                ),
              ),
            ),
          ],
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
          const Color(0xFFF7F9F8),
      appBar: AppBar(
        title: const Text(
          'Staff Management',
          style: TextStyle(
            fontWeight: FontWeight.w900,
          ),
        ),
        actions: [
          IconButton(
            onPressed: isRefreshing
                ? null
                : () {
                    loadStaff(
                      refresh: true,
                    );
                  },
            icon: const Icon(
              Icons.refresh_rounded,
            ),
          ),
        ],
      ),
      floatingActionButton:
          FloatingActionButton.extended(
        onPressed: () async {
          final bool? created =
              await Navigator.of(context).push<bool>(
            MaterialPageRoute<bool>(
              builder: (_) =>
                  const CreateStaffScreen(),
            ),
          );

          if (created == true && mounted) {
            await loadStaff(
              refresh: true,
            );
          }
        },
        icon: const Icon(
          Icons.person_add_alt_1_rounded,
        ),
        label: const Text(
          'Create Staff',
        ),
      ),
      body: RefreshIndicator(
        onRefresh: () => loadStaff(
          refresh: true,
        ),
        child: ListView(
          padding: const EdgeInsets.all(18),
          children: [
            SizedBox(
              width: double.infinity,
              child: OutlinedButton.icon(
                onPressed: () async {
                  await Navigator.of(context).push<void>(
                    MaterialPageRoute<void>(
                      builder: (_) =>
                          const RolesPermissionsScreen(),
                    ),
                  );
                },
                icon: const Icon(
                  Icons.admin_panel_settings_outlined,
                ),
                label: const Text(
                  'Roles & Permissions',
                  style: TextStyle(
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ),
            ),
            const SizedBox(height: 14),
            TextField(
              controller: searchController,
              textInputAction:
                  TextInputAction.search,
              onSubmitted: (_) {
                loadStaff(
                  refresh: true,
                );
              },
              decoration: InputDecoration(
                hintText:
                    'Search staff by name, email or ID',
                prefixIcon: const Icon(
                  Icons.search_rounded,
                ),
                suffixIcon:
                    searchController.text.isEmpty
                        ? null
                        : IconButton(
                            onPressed: () {
                              searchController
                                  .clear();

                              loadStaff(
                                refresh: true,
                              );
                            },
                            icon: const Icon(
                              Icons.close_rounded,
                            ),
                          ),
                filled: true,
                fillColor: Colors.white,
                border: OutlineInputBorder(
                  borderRadius:
                      BorderRadius.circular(
                    16,
                  ),
                ),
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
                padding:
                    const EdgeInsets.all(18),
                decoration: BoxDecoration(
                  color:
                      const Color(0xFFFEE2E2),
                  borderRadius:
                      BorderRadius.circular(
                    16,
                  ),
                ),
                child: Column(
                  children: [
                    Text(
                      errorMessage,
                      textAlign:
                          TextAlign.center,
                      style: const TextStyle(
                        color:
                            Color(0xFF991B1B),
                        fontWeight:
                            FontWeight.w700,
                      ),
                    ),
                    const SizedBox(height: 12),
                    FilledButton(
                      onPressed: loadStaff,
                      child: const Text(
                        'Try Again',
                      ),
                    ),
                  ],
                ),
              )
            else if (staff.isEmpty)
              const Padding(
                padding: EdgeInsets.all(40),
                child: Center(
                  child: Column(
                    children: [
                      Icon(
                        Icons.groups_outlined,
                        size: 54,
                        color: Colors.grey,
                      ),
                      SizedBox(height: 10),
                      Text(
                        'No staff account found.',
                        style: TextStyle(
                          fontWeight:
                              FontWeight.w700,
                        ),
                      ),
                    ],
                  ),
                ),
              )
            else
              ...staff.map(
                buildStaffCard,
              ),
            const SizedBox(height: 90),
          ],
        ),
      ),
    );
  }
}

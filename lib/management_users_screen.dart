import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

class ManagementUsersScreen extends StatefulWidget {
  final String title;
  final String endpoint;
  final String responseKey;
  final String emptyMessage;

  const ManagementUsersScreen({
    super.key,
    required this.title,
    required this.endpoint,
    required this.responseKey,
    required this.emptyMessage,
  });

  const ManagementUsersScreen.agents({super.key})
      : title = 'Agents',
        endpoint = '/management/agents',
        responseKey = 'agents',
        emptyMessage = 'No Agent has been registered under your state.';

  const ManagementUsersScreen.stateManagers({super.key})
      : title = 'State Managers',
        endpoint = '/management/state-managers',
        responseKey = 'stateManagers',
        emptyMessage = 'No State Manager has been registered under your zone.';

  @override
  State<ManagementUsersScreen> createState() => _ManagementUsersScreenState();
}

class _ManagementUsersScreenState extends State<ManagementUsersScreen> {
  static const String baseUrl = 'https://api.servicepay.ng/api';

  bool isLoading = true;
  bool isRefreshing = false;
  String errorMessage = '';

  List<Map<String, dynamic>> users = [];

  @override
  void initState() {
    super.initState();
    loadUsers();
  }

  Future<String?> getSavedAuthToken() async {
    final SharedPreferences preferences = await SharedPreferences.getInstance();

    const List<String> tokenKeys = [
      'auth_token',
      'token',
      'access_token',
      'admin_token',
    ];

    for (final String key in tokenKeys) {
      final String? value = preferences.getString(key);

      if (value != null && value.trim().isNotEmpty) {
        return value.trim();
      }
    }

    return null;
  }

  Future<void> loadUsers({bool refresh = false}) async {
    if (refresh) {
      setState(() {
        isRefreshing = true;
        errorMessage = '';
      });
    } else {
      setState(() {
        isLoading = true;
        errorMessage = '';
      });
    }

    try {
      final String? token = await getSavedAuthToken();

      if (token == null) {
        throw Exception('Session expired. Please log in again.');
      }

      final Uri uri = Uri.parse('$baseUrl${widget.endpoint}');

      final http.Response response = await http.get(
        uri,
        headers: {
          'Accept': 'application/json',
          'Authorization': 'Bearer $token',
        },
      ).timeout(const Duration(seconds: 65));

      Map<String, dynamic> data = {};

      try {
        final dynamic decoded = jsonDecode(response.body);

        if (decoded is Map<String, dynamic>) {
          data = decoded;
        }
      } catch (_) {
        data = {};
      }

      if (response.statusCode == 401) {
        throw Exception('Session expired. Please log in again.');
      }

      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw Exception(
          data['message']?.toString() ?? 'Unable to load ${widget.title}.',
        );
      }

      final dynamic rawUsers = data[widget.responseKey];

      final List<Map<String, dynamic>> loadedUsers = rawUsers is List
          ? rawUsers
              .whereType<Map>()
              .map(
                (item) => Map<String, dynamic>.from(item),
              )
              .toList()
          : <Map<String, dynamic>>[];

      if (!mounted) {
        return;
      }

      setState(() {
        users = loadedUsers;
      });
    } catch (error) {
      if (!mounted) {
        return;
      }

      setState(() {
        errorMessage = error.toString().replaceFirst('Exception: ', '');
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
    Map<String, dynamic> user,
    List<String> keys, {
    String fallback = '',
  }) {
    for (final String key in keys) {
      final dynamic value = user[key];

      if (value != null && value.toString().trim().isNotEmpty) {
        return value.toString().trim();
      }
    }

    return fallback;
  }

  String initials(String name) {
    final List<String> parts = name
        .trim()
        .split(RegExp(r'\s+'))
        .where((part) => part.isNotEmpty)
        .toList();

    if (parts.isEmpty) {
      return 'SP';
    }

    if (parts.length == 1) {
      return parts.first.substring(0, 1).toUpperCase();
    }

    return '${parts.first[0]}${parts.last[0]}'.toUpperCase();
  }

  Color statusColor(String status) {
    switch (status.toUpperCase()) {
      case 'ACTIVE':
        return Colors.green;
      case 'SUSPENDED':
        return Colors.orange;
      case 'BLOCKED':
        return Colors.red;
      default:
        return Colors.grey;
    }
  }

  Widget buildUserCard(Map<String, dynamic> user) {
    final String name = textValue(
      user,
      ['fullName', 'name', 'userName'],
      fallback: 'ServicePay User',
    );

    final String phone = textValue(
      user,
      ['phone', 'phoneNumber'],
    );

    final String email = textValue(
      user,
      ['email'],
    );

    final String status = textValue(
      user,
      ['status'],
      fallback: 'ACTIVE',
    );

    final String state = textValue(
      user,
      ['state'],
    );

    final String zone = textValue(
      user,
      ['zone'],
    );

    final String location = [
      if (state.isNotEmpty) state,
      if (zone.isNotEmpty) zone,
    ].join(' • ');

    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      elevation: 0,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(18),
        side: BorderSide(
          color: Colors.grey.shade200,
        ),
      ),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            CircleAvatar(
              radius: 25,
              backgroundColor: Colors.green.shade50,
              child: Text(
                initials(name),
                style: TextStyle(
                  color: Colors.green.shade800,
                  fontWeight: FontWeight.w800,
                ),
              ),
            ),
            const SizedBox(width: 14),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Expanded(
                        child: Text(
                          name,
                          style: const TextStyle(
                            fontSize: 16,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ),
                      Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 9,
                          vertical: 5,
                        ),
                        decoration: BoxDecoration(
                          color: statusColor(status).withValues(
                            alpha: 0.10,
                          ),
                          borderRadius: BorderRadius.circular(20),
                        ),
                        child: Text(
                          status.toUpperCase(),
                          style: TextStyle(
                            color: statusColor(status),
                            fontSize: 11,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ),
                    ],
                  ),
                  if (phone.isNotEmpty) ...[
                    const SizedBox(height: 8),
                    Row(
                      children: [
                        const Icon(
                          Icons.phone_outlined,
                          size: 17,
                        ),
                        const SizedBox(width: 7),
                        Expanded(child: Text(phone)),
                      ],
                    ),
                  ],
                  if (email.isNotEmpty) ...[
                    const SizedBox(height: 6),
                    Row(
                      children: [
                        const Icon(
                          Icons.email_outlined,
                          size: 17,
                        ),
                        const SizedBox(width: 7),
                        Expanded(child: Text(email)),
                      ],
                    ),
                  ],
                  if (location.isNotEmpty) ...[
                    const SizedBox(height: 6),
                    Row(
                      children: [
                        const Icon(
                          Icons.location_on_outlined,
                          size: 17,
                        ),
                        const SizedBox(width: 7),
                        Expanded(child: Text(location)),
                      ],
                    ),
                  ],
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget buildBody() {
    if (isLoading) {
      return const Center(
        child: CircularProgressIndicator(),
      );
    }

    if (errorMessage.isNotEmpty && users.isEmpty) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(
                Icons.error_outline,
                size: 58,
                color: Colors.red.shade400,
              ),
              const SizedBox(height: 14),
              Text(
                errorMessage,
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 16),
              FilledButton.icon(
                onPressed: loadUsers,
                icon: const Icon(Icons.refresh),
                label: const Text('Try Again'),
              ),
            ],
          ),
        ),
      );
    }

    if (users.isEmpty) {
      return RefreshIndicator(
        onRefresh: () => loadUsers(refresh: true),
        child: ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.all(24),
          children: [
            const SizedBox(height: 100),
            Icon(
              Icons.people_outline,
              size: 70,
              color: Colors.grey.shade400,
            ),
            const SizedBox(height: 18),
            Text(
              widget.emptyMessage,
              textAlign: TextAlign.center,
              style: TextStyle(
                color: Colors.grey.shade700,
                fontSize: 16,
              ),
            ),
          ],
        ),
      );
    }

    return RefreshIndicator(
      onRefresh: () => loadUsers(refresh: true),
      child: ListView.builder(
        padding: const EdgeInsets.all(16),
        itemCount: users.length,
        itemBuilder: (context, index) {
          return buildUserCard(users[index]);
        },
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text(widget.title),
        actions: [
          IconButton(
            onPressed: isRefreshing ? null : () => loadUsers(refresh: true),
            icon: const Icon(Icons.refresh),
          ),
        ],
      ),
      body: buildBody(),
    );
  }
}

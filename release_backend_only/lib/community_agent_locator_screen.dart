import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

class CommunityAgentLocatorScreen extends StatefulWidget {
  const CommunityAgentLocatorScreen({
    super.key,
  });

  @override
  State<CommunityAgentLocatorScreen> createState() =>
      _CommunityAgentLocatorScreenState();
}

class _CommunityAgentLocatorScreenState
    extends State<CommunityAgentLocatorScreen> {
  static const String baseUrl = 'https://api.servicepay.ng/api';

  static const Color primaryGreen = Color(0xFF08783E);

  final stateController = TextEditingController();

  final lgaController = TextEditingController();

  bool isLoading = false;

  List<Map<String, dynamic>> agents = [];

  @override
  void dispose() {
    stateController.dispose();
    lgaController.dispose();
    super.dispose();
  }

  Future<String> getToken() async {
    final prefs = await SharedPreferences.getInstance();

    for (final key in [
      'auth_token',
      'token',
      'access_token',
      'accessToken',
      'jwt_token',
      'jwt',
    ]) {
      final value = prefs.getString(key);

      if (value != null && value.trim().isNotEmpty) {
        return value.replaceFirst('Bearer ', '').trim();
      }
    }

    return '';
  }

  Future<void> searchAgents() async {
    setState(() {
      isLoading = true;
    });

    try {
      final token = await getToken();

      final uri = Uri.parse(
        '$baseUrl/servicepay-features/agents',
      ).replace(
        queryParameters: {
          if (stateController.text.trim().isNotEmpty)
            'state': stateController.text.trim(),
          if (lgaController.text.trim().isNotEmpty)
            'lga': lgaController.text.trim(),
        },
      );

      final response = await http.get(
        uri,
        headers: {
          'Authorization': 'Bearer $token',
          'Accept': 'application/json',
        },
      );

      final dynamic decoded = jsonDecode(response.body);

      final data = decoded is Map
          ? Map<String, dynamic>.from(
              decoded,
            )
          : <String, dynamic>{};

      final raw = data['agents'];

      agents = raw is List
          ? raw
              .whereType<Map>()
              .map(
                (item) => Map<String, dynamic>.from(
                  item,
                ),
              )
              .toList()
          : [];
    } catch (_) {
      agents = [];
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
      backgroundColor: const Color(0xFFF7FAF8),
      appBar: AppBar(
        title: const Text(
          'Community Agent Locator',
        ),
        backgroundColor: Colors.white,
        foregroundColor: Colors.black87,
      ),
      body: ListView(
        padding: const EdgeInsets.all(18),
        children: [
          const Text(
            'Find a ServicePay Agent',
            style: TextStyle(
              fontSize: 22,
              fontWeight: FontWeight.w900,
            ),
          ),
          const SizedBox(height: 8),
          const Text(
            'Search verified ServicePay field representatives by State or LGA.',
            style: TextStyle(
              color: Colors.black54,
            ),
          ),
          const SizedBox(height: 18),
          TextField(
            controller: stateController,
            decoration: const InputDecoration(
              labelText: 'State',
              border: OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: lgaController,
            decoration: const InputDecoration(
              labelText: 'LGA',
              border: OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: 14),
          FilledButton.icon(
            onPressed: isLoading ? null : searchAgents,
            style: FilledButton.styleFrom(
              backgroundColor: primaryGreen,
            ),
            icon: const Icon(
              Icons.search_rounded,
            ),
            label: const Text(
              'Search Agents',
            ),
          ),
          const SizedBox(height: 24),
          if (isLoading)
            const Center(
              child: CircularProgressIndicator(),
            )
          else if (agents.isEmpty)
            const Text(
              'Search to find available agents.',
            )
          else
            ...agents.map(
              (agent) => Card(
                child: ListTile(
                  leading: const CircleAvatar(
                    child: Icon(
                      Icons.support_agent_rounded,
                    ),
                  ),
                  title: Text(
                    agent['fullName']?.toString() ?? 'ServicePay Agent',
                  ),
                  subtitle: Text(
                    '${agent['phone'] ?? ''}\n'
                    '${agent['state'] ?? ''} • ${agent['lga'] ?? ''}',
                  ),
                  isThreeLine: true,
                  trailing: Text(
                    agent['role']?.toString() ?? '',
                    style: const TextStyle(
                      color: primaryGreen,
                      fontSize: 11,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

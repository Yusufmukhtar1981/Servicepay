import 'package:flutter/material.dart';

import 'community_agent_locator_screen.dart';

class ServicePayFeatureHubScreen extends StatelessWidget {
  const ServicePayFeatureHubScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final items = [
      (
        'Community Agent Locator',
        Icons.location_on_rounded,
        const CommunityAgentLocatorScreen(),
      ),
    ];

    return Scaffold(
      appBar: AppBar(
        title: const Text('More ServicePay'),
      ),
      body: ListView.separated(
        padding: const EdgeInsets.all(16),
        itemCount: items.length,
        separatorBuilder: (_, __) => const SizedBox(height: 10),
        itemBuilder: (context, index) {
          final item = items[index];

          return Card(
            child: ListTile(
              leading: Icon(
                item.$2,
                color: const Color(0xFF08783E),
              ),
              title: Text(item.$1),
              trailing: const Icon(
                Icons.arrow_forward_ios_rounded,
                size: 16,
              ),
              onTap: () {
                Navigator.of(context).push(
                  MaterialPageRoute(
                    builder: (_) => item.$3,
                  ),
                );
              },
            ),
          );
        },
      ),
    );
  }
}

import 'package:flutter/material.dart';

import 'airtime_screen.dart';
import 'data_screen.dart';

class AirtimeDataScreen extends StatelessWidget {
  const AirtimeDataScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF6F8F7),
      appBar: AppBar(
        title: const Text('Airtime & Data'),
        backgroundColor: Colors.white,
        foregroundColor: const Color(0xFF13251A),
        elevation: 0,
      ),
      body: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          Container(
            padding: const EdgeInsets.all(22),
            decoration: BoxDecoration(
              color: const Color(0xFF08783E),
              borderRadius: BorderRadius.circular(24),
            ),
            child: const Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Icon(
                  Icons.signal_cellular_alt_rounded,
                  color: Colors.white,
                  size: 36,
                ),
                SizedBox(height: 14),
                Text(
                  'Stay connected',
                  style: TextStyle(
                    color: Colors.white,
                    fontSize: 24,
                    fontWeight: FontWeight.w900,
                  ),
                ),
                SizedBox(height: 8),
                Text(
                  'Choose an existing ServicePay purchase flow.',
                  style: TextStyle(
                    color: Color(0xFFE3F8EA),
                    height: 1.45,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 20),
          _ServiceChoice(
            key: const Key('mini-app-airtime-choice'),
            icon: Icons.phone_android_rounded,
            title: 'Buy Airtime',
            subtitle: 'Recharge any Nigerian mobile network.',
            onTap: () {
              Navigator.of(context).push(
                MaterialPageRoute<void>(
                  settings: const RouteSettings(name: '/airtime'),
                  builder: (_) => const AirtimeScreen(),
                ),
              );
            },
          ),
          const SizedBox(height: 12),
          _ServiceChoice(
            key: const Key('mini-app-data-choice'),
            icon: Icons.language_rounded,
            title: 'Buy Data',
            subtitle: 'Choose a data plan for your mobile number.',
            onTap: () {
              Navigator.of(context).push(
                MaterialPageRoute<void>(
                  settings: const RouteSettings(name: '/data'),
                  builder: (_) => const DataScreen(),
                ),
              );
            },
          ),
        ],
      ),
    );
  }
}

class _ServiceChoice extends StatelessWidget {
  const _ServiceChoice({
    super.key,
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.onTap,
  });

  final IconData icon;
  final String title;
  final String subtitle;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.white,
      borderRadius: BorderRadius.circular(20),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(20),
        child: Container(
          padding: const EdgeInsets.all(18),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(20),
            border: Border.all(color: const Color(0xFFE1EAE4)),
          ),
          child: Row(
            children: [
              Container(
                width: 52,
                height: 52,
                decoration: BoxDecoration(
                  color: const Color(0xFFEAF7F0),
                  borderRadius: BorderRadius.circular(16),
                ),
                child: Icon(icon, color: const Color(0xFF08783E)),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      title,
                      style: const TextStyle(
                        fontSize: 16,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      subtitle,
                      style: TextStyle(
                        color: Colors.grey.shade600,
                        height: 1.35,
                      ),
                    ),
                  ],
                ),
              ),
              const Icon(Icons.arrow_forward_ios_rounded, size: 16),
            ],
          ),
        ),
      ),
    );
  }
}
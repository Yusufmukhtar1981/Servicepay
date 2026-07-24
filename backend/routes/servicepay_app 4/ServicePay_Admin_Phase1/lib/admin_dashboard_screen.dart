import 'package:flutter/material.dart';

class AdminDashboardScreen extends StatefulWidget {
  const AdminDashboardScreen({super.key});

  @override
  State<AdminDashboardScreen> createState() =>
      _AdminDashboardScreenState();
}

class _AdminDashboardScreenState
    extends State<AdminDashboardScreen> {
  int selectedIndex = 0;

  final pages = const [
    DashboardHome(),
    Center(child: Text('Users Management')),
    Center(child: Text('Transactions')),
    Center(child: Text('Wallet Management')),
    Center(child: Text('Settings')),
  ];

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF4F7F6),
      body: Row(
        children: [
          Container(
            width: 250,
            color: const Color(0xFF087F5B),
            child: Column(
              children: [
                const SizedBox(height: 40),
                const Icon(
                  Icons.admin_panel_settings,
                  size: 55,
                  color: Colors.white,
                ),
                const SizedBox(height: 12),
                const Text(
                  'ServicePay Admin',
                  style: TextStyle(
                    color: Colors.white,
                    fontSize: 21,
                    fontWeight: FontWeight.bold,
                  ),
                ),
                const SizedBox(height: 35),
                menuItem(Icons.dashboard, 'Dashboard', 0),
                menuItem(Icons.people, 'Users', 1),
                menuItem(Icons.receipt_long, 'Transactions', 2),
                menuItem(Icons.account_balance_wallet, 'Wallets', 3),
                menuItem(Icons.settings, 'Settings', 4),
                const Spacer(),
                const Padding(
                  padding: EdgeInsets.all(20),
                  child: Text(
                    'ServicePay © 2026',
                    style: TextStyle(color: Colors.white70),
                  ),
                ),
              ],
            ),
          ),
          Expanded(
            child: Column(
              children: [
                Container(
                  height: 75,
                  color: Colors.white,
                  padding:
                      const EdgeInsets.symmetric(horizontal: 30),
                  child: const Row(
                    children: [
                      Text(
                        'Admin Dashboard',
                        style: TextStyle(
                          fontSize: 24,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                      Spacer(),
                      CircleAvatar(
                        backgroundColor: Color(0xFF087F5B),
                        child: Icon(
                          Icons.person,
                          color: Colors.white,
                        ),
                      ),
                      SizedBox(width: 10),
                      Text(
                        'Administrator',
                        style: TextStyle(
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ],
                  ),
                ),
                Expanded(child: pages[selectedIndex]),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget menuItem(IconData icon, String title, int index) {
    final selected = selectedIndex == index;

    return InkWell(
      onTap: () {
        setState(() => selectedIndex = index);
      },
      child: Container(
        margin:
            const EdgeInsets.symmetric(horizontal: 12, vertical: 5),
        padding:
            const EdgeInsets.symmetric(horizontal: 18, vertical: 15),
        decoration: BoxDecoration(
          color: selected
              ? Colors.white.withValues(alpha: 0.18)
              : Colors.transparent,
          borderRadius: BorderRadius.circular(12),
        ),
        child: Row(
          children: [
            Icon(icon, color: Colors.white),
            const SizedBox(width: 15),
            Text(
              title,
              style: const TextStyle(
                color: Colors.white,
                fontSize: 16,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class DashboardHome extends StatelessWidget {
  const DashboardHome({super.key});

  @override
  Widget build(BuildContext context) {
    return SingleChildScrollView(
      padding: const EdgeInsets.all(30),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'Overview',
            style: TextStyle(
              fontSize: 27,
              fontWeight: FontWeight.bold,
            ),
          ),
          const SizedBox(height: 24),
          Wrap(
            spacing: 20,
            runSpacing: 20,
            children: const [
              SummaryCard(
                title: 'Total Users',
                value: '0',
                icon: Icons.people,
              ),
              SummaryCard(
                title: 'Total Wallet Balance',
                value: '₦0.00',
                icon: Icons.account_balance_wallet,
              ),
              SummaryCard(
                title: 'Total Transfers',
                value: '0',
                icon: Icons.swap_horiz,
              ),
              SummaryCard(
                title: 'Wallet Funding',
                value: '₦0.00',
                icon: Icons.add_card,
              ),
            ],
          ),
          const SizedBox(height: 35),
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(25),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(16),
            ),
            child: const Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Recent Transactions',
                  style: TextStyle(
                    fontSize: 20,
                    fontWeight: FontWeight.bold,
                  ),
                ),
                SizedBox(height: 30),
                Center(
                  child: Text(
                    'No transactions available yet',
                    style: TextStyle(color: Colors.grey),
                  ),
                ),
                SizedBox(height: 25),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class SummaryCard extends StatelessWidget {
  final String title;
  final String value;
  final IconData icon;

  const SummaryCard({
    super.key,
    required this.title,
    required this.value,
    required this.icon,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 245,
      padding: const EdgeInsets.all(22),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        boxShadow: const [
          BoxShadow(
            color: Color(0x14000000),
            blurRadius: 12,
            offset: Offset(0, 5),
          ),
        ],
      ),
      child: Row(
        children: [
          CircleAvatar(
            radius: 27,
            backgroundColor:
                const Color(0xFF087F5B).withValues(alpha: 0.12),
            child: Icon(
              icon,
              color: const Color(0xFF087F5B),
            ),
          ),
          const SizedBox(width: 16),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: const TextStyle(
                    color: Colors.grey,
                  ),
                ),
                const SizedBox(height: 7),
                Text(
                  value,
                  style: const TextStyle(
                    fontSize: 21,
                    fontWeight: FontWeight.bold,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

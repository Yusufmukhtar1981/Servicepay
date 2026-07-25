import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'admin_notifications_screen.dart';

class AdminDashboardScreen extends StatefulWidget {
  const AdminDashboardScreen({super.key});

  @override
  State<AdminDashboardScreen> createState() =>
      _AdminDashboardScreenState();
}

class _AdminDashboardScreenState
    extends State<AdminDashboardScreen> {
  String adminName = 'Admin';
  String adminRole = 'ADMIN';

  bool isLoading = true;

  int totalUsers = 0;
  int activeUsers = 0;
  int pendingUsers = 0;
  int totalTransactions = 0;
  int pendingDeliveries = 0;
  int pendingVerifications = 0;

  @override
  void initState() {
    super.initState();
    loadAdminDetails();
  }

  Future<void> loadAdminDetails() async {
    final prefs = await SharedPreferences.getInstance();

    final savedName =
        prefs.getString('user_name') ??
        prefs.getString('full_name') ??
        prefs.getString('name');

    final savedRole =
        prefs.getString('user_role') ?? 'ADMIN';

    if (!mounted) return;

    setState(() {
      adminName = savedName?.trim().isNotEmpty == true
          ? savedName!.trim()
          : 'Admin';

      adminRole = savedRole.trim().isNotEmpty
          ? savedRole.trim().toUpperCase()
          : 'ADMIN';

      isLoading = false;
    });
  }

  Future<void> refreshDashboard() async {
    await loadAdminDetails();
  }

  Future<void> openPage(Widget page) async {
    await Navigator.push(
      context,
      MaterialPageRoute(
        builder: (_) => page,
      ),
    );

    await refreshDashboard();
  }

  void showComingSoon(String title) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text('$title is coming soon.'),
        behavior: SnackBarBehavior.floating,
      ),
    );
  }

  Widget buildStatCard({
    required String title,
    required String value,
    required IconData icon,
    required Color color,
  }) {
    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(18),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(
              alpha: 0.05,
            ),
            blurRadius: 12,
            offset: const Offset(0, 5),
          ),
        ],
      ),
      child: Row(
        children: [
          Container(
            width: 52,
            height: 52,
            decoration: BoxDecoration(
              color: color.withValues(
                alpha: 0.12,
              ),
              borderRadius: BorderRadius.circular(15),
            ),
            child: Icon(
              icon,
              color: color,
              size: 28,
            ),
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment:
                  CrossAxisAlignment.start,
              children: [
                Text(
                  value,
                  style: const TextStyle(
                    fontSize: 22,
                    fontWeight: FontWeight.bold,
                  ),
                ),
                const SizedBox(height: 3),
                Text(
                  title,
                  style: TextStyle(
                    color: Colors.grey.shade600,
                    fontSize: 13,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget buildAdminAction({
    required String title,
    required String subtitle,
    required IconData icon,
    required VoidCallback onTap,
  }) {
    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      elevation: 0,
      color: Colors.white,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: BorderSide(
          color: Colors.grey.shade200,
        ),
      ),
      child: ListTile(
        contentPadding: const EdgeInsets.symmetric(
          horizontal: 16,
          vertical: 8,
        ),
        leading: Container(
          width: 48,
          height: 48,
          decoration: BoxDecoration(
            color: Colors.green.withValues(
              alpha: 0.1,
            ),
            borderRadius: BorderRadius.circular(14),
          ),
          child: const Icon(
            Icons.admin_panel_settings_outlined,
            color: Colors.green,
          ),
        ),
        title: Text(
          title,
          style: const TextStyle(
            fontWeight: FontWeight.bold,
          ),
        ),
        subtitle: Padding(
          padding: const EdgeInsets.only(top: 4),
          child: Text(subtitle),
        ),
        trailing: const Icon(
          Icons.arrow_forward_ios,
          size: 17,
        ),
        onTap: onTap,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF5F7FA),
      appBar: AppBar(
        backgroundColor: Colors.green,
        foregroundColor: Colors.white,
        elevation: 0,
        title: const Text(
          'Admin Dashboard',
          style: TextStyle(
            fontWeight: FontWeight.bold,
          ),
        ),
        actions: [
          IconButton(
            tooltip: 'Refresh',
            onPressed: refreshDashboard,
            icon: const Icon(Icons.refresh),
          ),
          IconButton(
            tooltip: 'Send Notifications',
            onPressed: () {
              openPage(
                const AdminNotificationsScreen(),
              );
            },
            icon: const Icon(
              Icons.notifications_active_outlined,
            ),
          ),
        ],
      ),
      body: isLoading
          ? const Center(
              child: CircularProgressIndicator(),
            )
          : RefreshIndicator(
              onRefresh: refreshDashboard,
              child: ListView(
                physics:
                    const AlwaysScrollableScrollPhysics(),
                padding: const EdgeInsets.all(18),
                children: [
                  Container(
                    width: double.infinity,
                    padding: const EdgeInsets.all(22),
                    decoration: BoxDecoration(
                      color: Colors.green,
                      borderRadius:
                          BorderRadius.circular(20),
                      boxShadow: [
                        BoxShadow(
                          color: Colors.green.withValues(
                            alpha: 0.25,
                          ),
                          blurRadius: 15,
                          offset: const Offset(0, 7),
                        ),
                      ],
                    ),
                    child: Column(
                      crossAxisAlignment:
                          CrossAxisAlignment.start,
                      children: [
                        const Text(
                          'Welcome Back',
                          style: TextStyle(
                            color: Colors.white70,
                            fontSize: 15,
                          ),
                        ),
                        const SizedBox(height: 6),
                        Text(
                          adminName,
                          style: const TextStyle(
                            color: Colors.white,
                            fontSize: 26,
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                        const SizedBox(height: 8),
                        Container(
                          padding:
                              const EdgeInsets.symmetric(
                            horizontal: 12,
                            vertical: 6,
                          ),
                          decoration: BoxDecoration(
                            color: Colors.white.withValues(
                              alpha: 0.18,
                            ),
                            borderRadius:
                                BorderRadius.circular(20),
                          ),
                          child: Text(
                            adminRole.replaceAll('_', ' '),
                            style: const TextStyle(
                              color: Colors.white,
                              fontWeight: FontWeight.w600,
                              fontSize: 12,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 26),
                  const Text(
                    'Overview',
                    style: TextStyle(
                      fontSize: 20,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                  const SizedBox(height: 15),
                  GridView.count(
                    crossAxisCount: 2,
                    shrinkWrap: true,
                    physics:
                        const NeverScrollableScrollPhysics(),
                    mainAxisSpacing: 14,
                    crossAxisSpacing: 14,
                    childAspectRatio: 1.55,
                    children: [
                      buildStatCard(
                        title: 'Total Users',
                        value: totalUsers.toString(),
                        icon: Icons.groups_outlined,
                        color: Colors.blue,
                      ),
                      buildStatCard(
                        title: 'Active Users',
                        value: activeUsers.toString(),
                        icon: Icons.verified_user_outlined,
                        color: Colors.green,
                      ),
                      buildStatCard(
                        title: 'Pending Users',
                        value: pendingUsers.toString(),
                        icon: Icons.person_add_alt_1_outlined,
                        color: Colors.orange,
                      ),
                      buildStatCard(
                        title: 'Transactions',
                        value: totalTransactions.toString(),
                        icon: Icons.receipt_long_outlined,
                        color: Colors.purple,
                      ),
                      buildStatCard(
                        title: 'Pending Deliveries',
                        value: pendingDeliveries.toString(),
                        icon: Icons.local_shipping_outlined,
                        color: Colors.deepOrange,
                      ),
                      buildStatCard(
                        title: 'ID Verifications',
                        value:
                            pendingVerifications.toString(),
                        icon: Icons.badge_outlined,
                        color: Colors.teal,
                      ),
                    ],
                  ),
                  const SizedBox(height: 28),
                  const Text(
                    'Admin Tools',
                    style: TextStyle(
                      fontSize: 20,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                  const SizedBox(height: 14),
                  buildAdminAction(
                    title: 'Manage Users',
                    subtitle:
                        'View, activate, suspend and manage Servicepay users.',
                    icon: Icons.manage_accounts_outlined,
                    onTap: () {
                      showComingSoon('User Management');
                    },
                  ),
                  buildAdminAction(
                    title: 'Transactions',
                    subtitle:
                        'Monitor all customer transactions.',
                    icon: Icons.receipt_long_outlined,
                    onTap: () {
                      showComingSoon(
                        'Admin Transactions',
                      );
                    },
                  ),
                  buildAdminAction(
                    title: 'Delivery Management',
                    subtitle:
                        'Set delivery fees and update delivery status.',
                    icon: Icons.local_shipping_outlined,
                    onTap: () {
                      showComingSoon(
                        'Delivery Management',
                      );
                    },
                  ),
                  buildAdminAction(
                    title: 'ID Verification',
                    subtitle:
                        'Review and approve customer verification requests.',
                    icon: Icons.verified_user_outlined,
                    onTap: () {
                      showComingSoon(
                        'ID Verification Management',
                      );
                    },
                  ),
                  buildAdminAction(
                    title: 'Send Notifications',
                    subtitle:
                        'Send direct or broadcast notifications to users.',
                    icon: Icons.notifications_active_outlined,
                    onTap: () {
                      openPage(
                        const AdminNotificationsScreen(),
                      );
                    },
                  ),
                  buildAdminAction(
                    title: 'Commission Management',
                    subtitle:
                        'Manage agent and manager commissions.',
                    icon: Icons.percent_outlined,
                    onTap: () {
                      showComingSoon(
                        'Commission Management',
                      );
                    },
                  ),
                ],
              ),
            ),
    );
  }
}
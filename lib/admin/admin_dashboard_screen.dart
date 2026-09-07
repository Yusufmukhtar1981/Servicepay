import 'package:flutter/material.dart';
import 'admin_manual_funding_screen.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'admin_notifications_screen.dart';
import 'admin_bulk_email_screen.dart';
import 'admin_customer_support_screen.dart';
import 'admin_product_commission_screen.dart';
import 'admin_solar_screen.dart';
import 'admin_trust_profiles_screen.dart';
import 'admin_phone_financing_screen.dart';
import 'admin_delivery_management_screen.dart';
import 'admin_build_info.dart';

class AdminDashboardScreen extends StatefulWidget {
  const AdminDashboardScreen({
    super.key,
    this.showExecutiveManagement = false,
    this.onOpenExecutiveManagement,
    this.onCreateSvp,
  });

  final bool showExecutiveManagement;
  final VoidCallback? onOpenExecutiveManagement;
  final VoidCallback? onCreateSvp;

  @override
  State<AdminDashboardScreen> createState() => _AdminDashboardScreenState();
}

class _AdminDashboardScreenState extends State<AdminDashboardScreen> {
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

    final savedName = prefs.getString('user_name') ??
        prefs.getString('full_name') ??
        prefs.getString('name');

    final savedRole = prefs.getString('user_role') ?? 'ADMIN';

    if (!mounted) return;

    setState(() {
      adminName =
          savedName?.trim().isNotEmpty == true ? savedName!.trim() : 'Admin';

      adminRole = savedRole.trim().isNotEmpty
          ? savedRole.trim().toUpperCase()
          : 'ADMIN';

      isLoading = false;
    });
  }

  Future<void> refreshDashboard() async {
    await loadAdminDetails();
  }

  Future<void> openPage(
    Widget page, {
    String? routeName,
  }) async {
    await Navigator.push(
      context,
      MaterialPageRoute(
        settings: RouteSettings(name: routeName),
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
    return LayoutBuilder(
      builder: (BuildContext context, BoxConstraints constraints) {
        final bool compact = constraints.maxWidth < 220;
        return Container(
          padding: EdgeInsets.all(compact ? 12 : 18),
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
                width: compact ? 44 : 52,
                height: compact ? 44 : 52,
                decoration: BoxDecoration(
                  color: color.withValues(
                    alpha: 0.12,
                  ),
                  borderRadius: BorderRadius.circular(15),
                ),
                child: Icon(
                  icon,
                  color: color,
                  size: compact ? 24 : 28,
                ),
              ),
              SizedBox(width: compact ? 10 : 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      value,
                      style: TextStyle(
                        fontSize: compact ? 20 : 22,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                    const SizedBox(height: 3),
                    Text(
                      title,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        color: Colors.grey.shade600,
                        fontSize: compact ? 12 : 13,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        );
      },
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

  Widget buildExecutiveManagementCard() {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          colors: <Color>[Color(0xFF102C35), Color(0xFF087E6A)],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        borderRadius: BorderRadius.circular(20),
        boxShadow: <BoxShadow>[
          BoxShadow(
            color: const Color(0xFF087E6A).withValues(alpha: 0.2),
            blurRadius: 16,
            offset: const Offset(0, 7),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          const Row(
            children: <Widget>[
              Icon(Icons.account_balance_rounded,
                  color: Colors.white, size: 28),
              SizedBox(width: 12),
              Expanded(
                child: Text(
                  'EXECUTIVE MANAGEMENT',
                  style: TextStyle(
                    color: Colors.white,
                    fontSize: 18,
                    fontWeight: FontWeight.w900,
                    letterSpacing: 0.4,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          const Text(
            'Manage SVPs, executive reports, permissions and performance',
            style: TextStyle(color: Color(0xFFD5E9E4), height: 1.35),
          ),
          const SizedBox(height: 18),
          Wrap(
            spacing: 10,
            runSpacing: 10,
            children: <Widget>[
              FilledButton.icon(
                onPressed: widget.onOpenExecutiveManagement,
                style: FilledButton.styleFrom(
                  backgroundColor: Colors.white,
                  foregroundColor: const Color(0xFF087E6A),
                ),
                icon: const Icon(Icons.open_in_new_rounded),
                label: const Text('OPEN EXECUTIVE MANAGEMENT'),
              ),
              OutlinedButton.icon(
                onPressed: widget.onCreateSvp,
                style: OutlinedButton.styleFrom(
                  foregroundColor: Colors.white,
                  side: const BorderSide(color: Colors.white70),
                ),
                icon: const Icon(Icons.person_add_alt_1_rounded),
                label: const Text('+ CREATE SVP'),
              ),
            ],
          ),
        ],
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
            tooltip: 'In-App Notifications',
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
                physics: const AlwaysScrollableScrollPhysics(),
                padding: const EdgeInsets.all(18),
                children: [
                  Container(
                    width: double.infinity,
                    padding: const EdgeInsets.all(22),
                    decoration: BoxDecoration(
                      color: Colors.green,
                      borderRadius: BorderRadius.circular(20),
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
                      crossAxisAlignment: CrossAxisAlignment.start,
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
                          padding: const EdgeInsets.symmetric(
                            horizontal: 12,
                            vertical: 6,
                          ),
                          decoration: BoxDecoration(
                            color: Colors.white.withValues(
                              alpha: 0.18,
                            ),
                            borderRadius: BorderRadius.circular(20),
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
                        const SizedBox(height: 12),
                        Text(
                          AdminBuildInfo.label,
                          style: const TextStyle(
                            color: Colors.white70,
                            fontSize: 11,
                            fontWeight: FontWeight.w500,
                          ),
                        ),
                      ],
                    ),
                  ),
                  if (widget.showExecutiveManagement) ...<Widget>[
                    const SizedBox(height: 18),
                    buildExecutiveManagementCard(),
                  ],
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
                    physics: const NeverScrollableScrollPhysics(),
                    mainAxisSpacing: 14,
                    crossAxisSpacing: 14,
                    childAspectRatio:
                        MediaQuery.sizeOf(context).width < 600 ? 1.25 : 1.55,
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
                        value: pendingVerifications.toString(),
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
                    title: 'ServicePay Solar',
                    subtitle:
                        'Manage Solar packages, applications, finance and recovery.',
                    icon: Icons.solar_power_rounded,
                    onTap: () {
                      openPage(
                        const AdminSolarScreen(),
                        routeName: '/admin/solar',
                      );
                    },
                  ),
                  buildAdminAction(
                    title: 'Phone Financing',
                    subtitle:
                        'Manage products, applications, IMEI stock and repayment risk.',
                    icon: Icons.phone_android_outlined,
                    onTap: () {
                      openPage(
                        const AdminPhoneFinancingScreen(),
                        routeName: '/admin/phone-financing',
                      );
                    },
                  ),
                  buildAdminAction(
                    title: 'Trust Profiles',
                    subtitle: 'Search and review ServicePay Trust profiles.',
                    icon: Icons.shield_outlined,
                    onTap: () {
                      openPage(const AdminTrustProfilesScreen());
                    },
                  ),
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
                    subtitle: 'Monitor all customer transactions.',
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
                        'Review deliveries, load available riders and assign jobs.',
                    icon: Icons.local_shipping_outlined,
                    onTap: () {
                      openPage(
                        const AdminDeliveryManagementScreen(),
                        routeName: '/admin/deliveries',
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
                    title: 'In-App Notifications',
                    subtitle:
                        'Send targeted messages to the customer notification area.',
                    icon: Icons.notifications_active_outlined,
                    onTap: () {
                      openPage(
                        const AdminNotificationsScreen(),
                      );
                    },
                  ),
                  buildAdminAction(
                    title: 'Bulk Email',
                    subtitle:
                        'Send Resend-powered customer broadcasts and review delivery history.',
                    icon: Icons.mark_email_unread_outlined,
                    onTap: () {
                      openPage(
                        const AdminBulkEmailScreen(),
                      );
                    },
                  ),
                  buildAdminAction(
                    title: 'Customer Support',
                    subtitle:
                        'Review, assign, reply to, and resolve customer tickets.',
                    icon: Icons.support_agent_outlined,
                    onTap: () {
                      openPage(
                        const AdminCustomerSupportScreen(),
                      );
                    },
                  ),
                  buildAdminAction(
                    title: 'Commission Management',
                    subtitle: 'Manage aggregator and manager commissions.',
                    icon: Icons.percent_outlined,
                    onTap: () {
                      Navigator.push(
                        context,
                        MaterialPageRoute(
                          builder: (_) => const AdminProductCommissionScreen(),
                        ),
                      );
                    },
                  ),
                ],
              ),
            ),
    );
  }

  // ignore: unused_element
  Widget _buildHeadOfficeControlCenter() {
    return Container(
      margin: const EdgeInsets.fromLTRB(
        16,
        8,
        16,
        16,
      ),
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(22),
        border: Border.all(
          color: const Color(0xFFE5E7EB),
        ),
        boxShadow: const <BoxShadow>[
          BoxShadow(
            color: Color(0x0D000000),
            blurRadius: 16,
            offset: Offset(0, 6),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          _buildHeadOfficeControlCenter(),
          const Row(
            children: <Widget>[
              Icon(
                Icons.admin_panel_settings_rounded,
                color: Color(0xFF08783E),
              ),
              SizedBox(width: 10),
              Expanded(
                child: Text(
                  'Head Office Control Center',
                  style: TextStyle(
                    fontSize: 18,
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 6),
          const Text(
            'Manage customer services and wallet adjustments.',
            style: TextStyle(
              color: Colors.black54,
            ),
          ),
          const SizedBox(height: 18),
          Row(
            children: <Widget>[
              Expanded(
                child: _headOfficeControlButton(
                  icon: Icons.tune_rounded,
                  title: 'Service Control',
                  subtitle: 'Turn customer features ON or OFF',
                  onTap: () {
                    Navigator.of(context).push(
                      MaterialPageRoute<void>(
                        builder: (_) => const AdminManualFundingScreen(),
                      ),
                    );
                  },
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: _headOfficeControlButton(
                  icon: Icons.account_balance_wallet_rounded,
                  title: 'Customer Wallet',
                  subtitle: 'Credit or debit customer balance',
                  onTap: () {
                    Navigator.of(context).push(
                      MaterialPageRoute<void>(
                        builder: (_) => const AdminManualFundingScreen(),
                      ),
                    );
                  },
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _headOfficeControlButton({
    required IconData icon,
    required String title,
    required String subtitle,
    required VoidCallback onTap,
  }) {
    return Material(
      color: const Color(0xFFF0FDF4),
      borderRadius: BorderRadius.circular(18),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(18),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Container(
                width: 44,
                height: 44,
                decoration: BoxDecoration(
                  color: const Color(0xFF08783E),
                  borderRadius: BorderRadius.circular(13),
                ),
                child: Icon(
                  icon,
                  color: Colors.white,
                ),
              ),
              const SizedBox(height: 12),
              Text(
                title,
                style: const TextStyle(
                  fontWeight: FontWeight.w800,
                  fontSize: 15,
                ),
              ),
              const SizedBox(height: 4),
              Text(
                subtitle,
                style: const TextStyle(
                  fontSize: 12,
                  color: Colors.black54,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

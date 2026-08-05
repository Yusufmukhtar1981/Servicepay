import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../login_screen.dart';

class RiderMainNavigation extends StatefulWidget {
  const RiderMainNavigation({
    super.key,
  });

  @override
  State<RiderMainNavigation> createState() =>
      _RiderMainNavigationState();
}

class _RiderMainNavigationState
    extends State<RiderMainNavigation> {
  int currentIndex = 0;

  final List<Widget> pages = const [
    RiderDashboardScreen(),
    RiderDeliveriesScreen(),
    RiderEarningsScreen(),
    RiderProfileScreen(),
  ];

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: IndexedStack(
        index: currentIndex,
        children: pages,
      ),
      bottomNavigationBar: NavigationBar(
        selectedIndex: currentIndex,
        onDestinationSelected: (int index) {
          setState(() {
            currentIndex = index;
          });
        },
        destinations: const [
          NavigationDestination(
            icon: Icon(
              Icons.dashboard_outlined,
            ),
            selectedIcon: Icon(
              Icons.dashboard_rounded,
            ),
            label: 'Dashboard',
          ),
          NavigationDestination(
            icon: Icon(
              Icons.local_shipping_outlined,
            ),
            selectedIcon: Icon(
              Icons.local_shipping_rounded,
            ),
            label: 'Deliveries',
          ),
          NavigationDestination(
            icon: Icon(
              Icons.account_balance_wallet_outlined,
            ),
            selectedIcon: Icon(
              Icons.account_balance_wallet_rounded,
            ),
            label: 'Earnings',
          ),
          NavigationDestination(
            icon: Icon(
              Icons.person_outline,
            ),
            selectedIcon: Icon(
              Icons.person_rounded,
            ),
            label: 'Profile',
          ),
        ],
      ),
    );
  }
}

class RiderDashboardScreen extends StatefulWidget {
  const RiderDashboardScreen({
    super.key,
  });

  @override
  State<RiderDashboardScreen> createState() =>
      _RiderDashboardScreenState();
}

class _RiderDashboardScreenState
    extends State<RiderDashboardScreen> {
  static const Color primaryGreen =
      Color(0xFF159447);

  String riderName = 'Delivery Rider';
  String riderId = '';
  String verificationStatus = 'PENDING';

  bool isOnline = false;
  bool isLoading = true;

  int assignedDeliveries = 0;
  int activeDeliveries = 0;
  int completedDeliveries = 0;

  double todayEarnings = 0;
  double totalEarnings = 0;

  @override
  void initState() {
    super.initState();
    loadRiderDetails();
  }

  Future<void> loadRiderDetails() async {
    final SharedPreferences prefs =
        await SharedPreferences.getInstance();

    if (!mounted) {
      return;
    }

    setState(() {
      riderName =
          prefs.getString('user_name') ??
              'Delivery Rider';

      riderId =
          prefs.getString('rider_id') ?? '';

      verificationStatus =
          prefs.getString(
                'rider_verification_status',
              ) ??
              'PENDING';

      isOnline =
          prefs.getBool('rider_is_online') ??
              false;

      isLoading = false;
    });
  }

  Future<void> toggleAvailability(
    bool value,
  ) async {
    final SharedPreferences prefs =
        await SharedPreferences.getInstance();

    await prefs.setBool(
      'rider_is_online',
      value,
    );

    if (!mounted) {
      return;
    }

    setState(() {
      isOnline = value;
    });

    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(
        SnackBar(
          content: Text(
            value
                ? 'You are now online and available for deliveries.'
                : 'You are now offline.',
          ),
          behavior: SnackBarBehavior.floating,
          backgroundColor: value
              ? Colors.green.shade700
              : Colors.orange.shade700,
        ),
      );
  }

  String formatMoney(
    double value,
  ) {
    return '₦${value.toStringAsFixed(2)}';
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor:
          const Color(0xFFF5F7FA),
      appBar: AppBar(
        automaticallyImplyLeading: false,
        backgroundColor: Colors.white,
        surfaceTintColor: Colors.white,
        title: const Text(
          'Rider Dashboard',
          style: TextStyle(
            fontWeight: FontWeight.bold,
          ),
        ),
        actions: [
          IconButton(
            onPressed: () {},
            icon: const Badge(
              child: Icon(
                Icons.notifications_outlined,
              ),
            ),
          ),
          const SizedBox(width: 8),
        ],
      ),
      body: isLoading
          ? const Center(
              child:
                  CircularProgressIndicator(),
            )
          : RefreshIndicator(
              onRefresh: loadRiderDetails,
              child: ListView(
                padding:
                    const EdgeInsets.all(16),
                children: [
                  Container(
                    padding:
                        const EdgeInsets.all(18),
                    decoration: BoxDecoration(
                      gradient:
                          const LinearGradient(
                        colors: [
                          Color(0xFF159447),
                          Color(0xFF0F766E),
                        ],
                        begin:
                            Alignment.topLeft,
                        end:
                            Alignment.bottomRight,
                      ),
                      borderRadius:
                          BorderRadius.circular(
                        22,
                      ),
                      boxShadow: [
                        BoxShadow(
                          color: primaryGreen
                              .withValues(
                            alpha: 0.22,
                          ),
                          blurRadius: 18,
                          offset:
                              const Offset(0, 8),
                        ),
                      ],
                    ),
                    child: Column(
                      crossAxisAlignment:
                          CrossAxisAlignment
                              .start,
                      children: [
                        Row(
                          children: [
                            Container(
                              width: 56,
                              height: 56,
                              decoration:
                                  BoxDecoration(
                                color: Colors.white
                                    .withValues(
                                  alpha: 0.18,
                                ),
                                shape:
                                    BoxShape.circle,
                              ),
                              child: const Icon(
                                Icons
                                    .delivery_dining_rounded,
                                color:
                                    Colors.white,
                                size: 34,
                              ),
                            ),
                            const SizedBox(
                              width: 14,
                            ),
                            Expanded(
                              child: Column(
                                crossAxisAlignment:
                                    CrossAxisAlignment
                                        .start,
                                children: [
                                  const Text(
                                    'Welcome back',
                                    style:
                                        TextStyle(
                                      color: Colors
                                          .white70,
                                      fontSize: 13,
                                    ),
                                  ),
                                  const SizedBox(
                                    height: 3,
                                  ),
                                  Text(
                                    riderName,
                                    maxLines: 1,
                                    overflow:
                                        TextOverflow
                                            .ellipsis,
                                    style:
                                        const TextStyle(
                                      color:
                                          Colors.white,
                                      fontSize: 20,
                                      fontWeight:
                                          FontWeight
                                              .bold,
                                    ),
                                  ),
                                  if (riderId
                                      .isNotEmpty)
                                    Text(
                                      'Rider ID: $riderId',
                                      style:
                                          const TextStyle(
                                        color: Colors
                                            .white70,
                                        fontSize: 12,
                                      ),
                                    ),
                                ],
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 22),
                        Container(
                          padding:
                              const EdgeInsets
                                  .symmetric(
                            horizontal: 14,
                            vertical: 10,
                          ),
                          decoration:
                              BoxDecoration(
                            color: Colors.white
                                .withValues(
                              alpha: 0.14,
                            ),
                            borderRadius:
                                BorderRadius
                                    .circular(14),
                          ),
                          child: Row(
                            children: [
                              Icon(
                                isOnline
                                    ? Icons
                                        .radio_button_checked
                                    : Icons
                                        .radio_button_off,
                                color:
                                    Colors.white,
                              ),
                              const SizedBox(
                                width: 10,
                              ),
                              Expanded(
                                child: Text(
                                  isOnline
                                      ? 'You are online'
                                      : 'You are offline',
                                  style:
                                      const TextStyle(
                                    color:
                                        Colors.white,
                                    fontWeight:
                                        FontWeight
                                            .w700,
                                  ),
                                ),
                              ),
                              Switch(
                                value: isOnline,
                                onChanged:
                                    toggleAvailability,
                                activeThumbColor:
                                    Colors.white,
                                activeTrackColor:
                                    Colors
                                        .greenAccent,
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 16),
                  if (verificationStatus !=
                      'VERIFIED')
                    Container(
                      padding:
                          const EdgeInsets.all(
                        14,
                      ),
                      decoration: BoxDecoration(
                        color: Colors.orange
                            .withValues(
                          alpha: 0.10,
                        ),
                        borderRadius:
                            BorderRadius.circular(
                          14,
                        ),
                        border: Border.all(
                          color: Colors.orange
                              .withValues(
                            alpha: 0.30,
                          ),
                        ),
                      ),
                      child: Row(
                        crossAxisAlignment:
                            CrossAxisAlignment
                                .start,
                        children: [
                          const Icon(
                            Icons
                                .verified_user_outlined,
                            color: Colors.orange,
                          ),
                          const SizedBox(
                            width: 10,
                          ),
                          Expanded(
                            child: Text(
                              'Verification status: '
                              '$verificationStatus. '
                              'You will receive delivery jobs after Head Office verification.',
                              style:
                                  const TextStyle(
                                height: 1.4,
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                  const SizedBox(height: 20),
                  const Text(
                    'Delivery Summary',
                    style: TextStyle(
                      fontSize: 18,
                      fontWeight:
                          FontWeight.bold,
                    ),
                  ),
                  const SizedBox(height: 12),
                  GridView.count(
                    crossAxisCount: 3,
                    shrinkWrap: true,
                    physics:
                        const NeverScrollableScrollPhysics(),
                    crossAxisSpacing: 10,
                    mainAxisSpacing: 10,
                    childAspectRatio: 0.92,
                    children: [
                      RiderSummaryCard(
                        title: 'Assigned',
                        value:
                            assignedDeliveries
                                .toString(),
                        icon: Icons
                            .assignment_outlined,
                      ),
                      RiderSummaryCard(
                        title: 'Active',
                        value:
                            activeDeliveries
                                .toString(),
                        icon: Icons
                            .local_shipping_outlined,
                      ),
                      RiderSummaryCard(
                        title: 'Completed',
                        value:
                            completedDeliveries
                                .toString(),
                        icon: Icons
                            .check_circle_outline,
                      ),
                    ],
                  ),
                  const SizedBox(height: 20),
                  const Text(
                    'Earnings',
                    style: TextStyle(
                      fontSize: 18,
                      fontWeight:
                          FontWeight.bold,
                    ),
                  ),
                  const SizedBox(height: 12),
                  Row(
                    children: [
                      Expanded(
                        child:
                            RiderEarningCard(
                          title:
                              'Today Earnings',
                          amount: formatMoney(
                            todayEarnings,
                          ),
                          icon: Icons
                              .today_outlined,
                        ),
                      ),
                      const SizedBox(
                        width: 12,
                      ),
                      Expanded(
                        child:
                            RiderEarningCard(
                          title:
                              'Total Earnings',
                          amount: formatMoney(
                            totalEarnings,
                          ),
                          icon: Icons
                              .account_balance_wallet_outlined,
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 20),
                  const Text(
                    'Quick Actions',
                    style: TextStyle(
                      fontSize: 18,
                      fontWeight:
                          FontWeight.bold,
                    ),
                  ),
                  const SizedBox(height: 12),
                  Row(
                    children: [
                      Expanded(
                        child:
                            RiderActionButton(
                          label:
                              'View Deliveries',
                          icon: Icons
                              .local_shipping_outlined,
                          onTap: () {
                            ScaffoldMessenger
                                .of(context)
                              ..hideCurrentSnackBar()
                              ..showSnackBar(
                                const SnackBar(
                                  content: Text(
                                    'Delivery jobs will appear here after assignment.',
                                  ),
                                  behavior:
                                      SnackBarBehavior
                                          .floating,
                                ),
                              );
                          },
                        ),
                      ),
                      const SizedBox(
                        width: 12,
                      ),
                      Expanded(
                        child:
                            RiderActionButton(
                          label:
                              'Delivery History',
                          icon: Icons
                              .history_rounded,
                          onTap: () {
                            ScaffoldMessenger
                                .of(context)
                              ..hideCurrentSnackBar()
                              ..showSnackBar(
                                const SnackBar(
                                  content: Text(
                                    'Delivery history will be connected in the next part.',
                                  ),
                                  behavior:
                                      SnackBarBehavior
                                          .floating,
                                ),
                              );
                          },
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
    );
  }
}

class RiderSummaryCard extends StatelessWidget {
  const RiderSummaryCard({
    required this.title,
    required this.value,
    required this.icon,
    super.key,
  });

  final String title;
  final String value;
  final IconData icon;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius:
            BorderRadius.circular(16),
        boxShadow: const [
          BoxShadow(
            color: Colors.black12,
            blurRadius: 10,
            offset: Offset(0, 4),
          ),
        ],
      ),
      child: Column(
        mainAxisAlignment:
            MainAxisAlignment.center,
        children: [
          Container(
            width: 40,
            height: 40,
            decoration: BoxDecoration(
              color: const Color(0xFF159447)
                  .withValues(
                alpha: 0.10,
              ),
              borderRadius:
                  BorderRadius.circular(12),
            ),
            child: Icon(
              icon,
              color:
                  const Color(0xFF159447),
            ),
          ),
          const SizedBox(height: 8),
          Text(
            value,
            style: const TextStyle(
              fontSize: 20,
              fontWeight: FontWeight.bold,
            ),
          ),
          Text(
            title,
            textAlign: TextAlign.center,
            style: const TextStyle(
              fontSize: 12,
              color: Colors.black54,
            ),
          ),
        ],
      ),
    );
  }
}

class RiderEarningCard
    extends StatelessWidget {
  const RiderEarningCard({
    required this.title,
    required this.amount,
    required this.icon,
    super.key,
  });

  final String title;
  final String amount;
  final IconData icon;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius:
            BorderRadius.circular(16),
        boxShadow: const [
          BoxShadow(
            color: Colors.black12,
            blurRadius: 10,
            offset: Offset(0, 4),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment:
            CrossAxisAlignment.start,
        children: [
          Icon(
            icon,
            color:
                const Color(0xFF159447),
          ),
          const SizedBox(height: 10),
          Text(
            title,
            style: const TextStyle(
              color: Colors.black54,
              fontSize: 12,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            amount,
            style: const TextStyle(
              fontSize: 17,
              fontWeight: FontWeight.bold,
            ),
          ),
        ],
      ),
    );
  }
}

class RiderActionButton
    extends StatelessWidget {
  const RiderActionButton({
    required this.label,
    required this.icon,
    required this.onTap,
    super.key,
  });

  final String label;
  final IconData icon;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.white,
      borderRadius:
          BorderRadius.circular(16),
      child: InkWell(
        onTap: onTap,
        borderRadius:
            BorderRadius.circular(16),
        child: Container(
          padding:
              const EdgeInsets.symmetric(
            vertical: 18,
            horizontal: 12,
          ),
          decoration: BoxDecoration(
            borderRadius:
                BorderRadius.circular(16),
            border: Border.all(
              color:
                  const Color(0xFFE2E8F0),
            ),
          ),
          child: Column(
            children: [
              Icon(
                icon,
                color:
                    const Color(0xFF159447),
                size: 28,
              ),
              const SizedBox(height: 8),
              Text(
                label,
                textAlign: TextAlign.center,
                style: const TextStyle(
                  fontWeight:
                      FontWeight.w700,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class RiderDeliveriesScreen
    extends StatelessWidget {
  const RiderDeliveriesScreen({
    super.key,
  });

  @override
  Widget build(BuildContext context) {
    return const RiderEmptyScreen(
      title: 'My Deliveries',
      message:
          'Assigned delivery jobs will appear here.',
      icon: Icons.local_shipping_outlined,
    );
  }
}

class RiderEarningsScreen
    extends StatelessWidget {
  const RiderEarningsScreen({
    super.key,
  });

  @override
  Widget build(BuildContext context) {
    return const RiderEmptyScreen(
      title: 'Rider Earnings',
      message:
          'Your completed delivery earnings and settlements will appear here.',
      icon:
          Icons.account_balance_wallet_outlined,
    );
  }
}

class RiderProfileScreen
    extends StatelessWidget {
  const RiderProfileScreen({
    super.key,
  });

  Future<void> logout(
    BuildContext context,
  ) async {
    final SharedPreferences prefs =
        await SharedPreferences.getInstance();

    await prefs.clear();

    if (!context.mounted) {
      return;
    }

    Navigator.pushAndRemoveUntil(
      context,
      MaterialPageRoute(
        builder: (_) =>
            const LoginScreen(),
      ),
      (Route<dynamic> route) => false,
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor:
          const Color(0xFFF5F7FA),
      appBar: AppBar(
        automaticallyImplyLeading: false,
        backgroundColor: Colors.white,
        surfaceTintColor: Colors.white,
        title: const Text(
          'Rider Profile',
          style: TextStyle(
            fontWeight: FontWeight.bold,
          ),
        ),
      ),
      body: ListView(
        padding:
            const EdgeInsets.all(16),
        children: [
          Container(
            padding:
                const EdgeInsets.all(20),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius:
                  BorderRadius.circular(18),
            ),
            child: const Column(
              children: [
                CircleAvatar(
                  radius: 38,
                  backgroundColor:
                      Color(0xFFE6F4EA),
                  child: Icon(
                    Icons
                        .delivery_dining_rounded,
                    size: 44,
                    color:
                        Color(0xFF159447),
                  ),
                ),
                SizedBox(height: 12),
                Text(
                  'ServicePay Delivery Rider',
                  style: TextStyle(
                    fontSize: 18,
                    fontWeight:
                        FontWeight.bold,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 16),
          Card(
            child: ListTile(
              leading: const Icon(
                Icons.logout,
                color: Colors.red,
              ),
              title: const Text(
                'Log out',
                style: TextStyle(
                  color: Colors.red,
                  fontWeight:
                      FontWeight.w700,
                ),
              ),
              onTap: () => logout(context),
            ),
          ),
        ],
      ),
    );
  }
}

class RiderEmptyScreen
    extends StatelessWidget {
  const RiderEmptyScreen({
    required this.title,
    required this.message,
    required this.icon,
    super.key,
  });

  final String title;
  final String message;
  final IconData icon;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor:
          const Color(0xFFF5F7FA),
      appBar: AppBar(
        automaticallyImplyLeading: false,
        backgroundColor: Colors.white,
        surfaceTintColor: Colors.white,
        title: Text(
          title,
          style: const TextStyle(
            fontWeight: FontWeight.bold,
          ),
        ),
      ),
      body: Center(
        child: Padding(
          padding:
              const EdgeInsets.all(24),
          child: Column(
            mainAxisAlignment:
                MainAxisAlignment.center,
            children: [
              Container(
                width: 90,
                height: 90,
                decoration: BoxDecoration(
                  color:
                      const Color(0xFF159447)
                          .withValues(
                    alpha: 0.10,
                  ),
                  shape: BoxShape.circle,
                ),
                child: Icon(
                  icon,
                  size: 46,
                  color:
                      const Color(0xFF159447),
                ),
              ),
              const SizedBox(height: 18),
              Text(
                title,
                style: const TextStyle(
                  fontSize: 22,
                  fontWeight:
                      FontWeight.bold,
                ),
              ),
              const SizedBox(height: 8),
              Text(
                message,
                textAlign: TextAlign.center,
                style: const TextStyle(
                  color: Colors.black54,
                  height: 1.5,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
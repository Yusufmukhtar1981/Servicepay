import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'airtime_screen.dart';
import 'cable_screen.dart';
import 'data_screen.dart';
import 'electricity_screen.dart';
import 'exam_pin_screen.dart';
import 'id_verification_screen.dart';
import 'logistics_screen.dart';
import 'notifications_screen.dart';
import 'transfer_screen.dart';
import 'wallet_screen.dart';
import 'widgets.dart';

class DashboardScreen extends StatefulWidget {
  const DashboardScreen({super.key});

  @override
  State<DashboardScreen> createState() => _DashboardScreenState();
}

class _DashboardScreenState extends State<DashboardScreen> {
  String name = 'User';
  double balance = 0;
  bool isLoading = true;

  @override
  void initState() {
    super.initState();
    loadUserDetails();
  }

  Future<void> loadUserDetails() async {
    final prefs = await SharedPreferences.getInstance();

    final savedName =
        prefs.getString('user_name') ??
        prefs.getString('full_name') ??
        prefs.getString('name');

    final savedBalance = prefs.getDouble('wallet_balance');

    if (!mounted) return;

    setState(() {
      name = savedName?.trim().isNotEmpty == true
          ? savedName!.trim()
          : 'User';

      balance = savedBalance ?? 0;
      isLoading = false;
    });
  }

  Future<void> openPage(
    BuildContext context,
    Widget page,
  ) async {
    await Navigator.push(
      context,
      MaterialPageRoute(
        builder: (_) => page,
      ),
    );

    await loadUserDetails();
  }

  void openComingSoon({
    required String title,
    required IconData icon,
    required String description,
  }) {
    openPage(
      context,
      ComingSoonScreen(
        title: title,
        icon: icon,
        description: description,
      ),
    );
  }

  Widget sectionTitle(String title) {
    return Padding(
      padding: const EdgeInsets.only(
        top: 8,
        bottom: 14,
      ),
      child: Text(
        title,
        style: const TextStyle(
          fontSize: 20,
          fontWeight: FontWeight.bold,
        ),
      ),
    );
  }

  Widget serviceGrid({
    required List<Widget> children,
  }) {
    return GridView.count(
      crossAxisCount: 3,
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      mainAxisSpacing: 16,
      crossAxisSpacing: 16,
      childAspectRatio: 0.95,
      children: children,
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
          'Servicepay',
          style: TextStyle(
            fontWeight: FontWeight.bold,
          ),
        ),
        actions: [
          IconButton(
            tooltip: 'Refresh',
            onPressed: loadUserDetails,
            icon: const Icon(Icons.refresh),
          ),
          IconButton(
            tooltip: 'Notifications',
            onPressed: () {
              openPage(
                context,
                const NotificationsScreen(),
              );
            },
            icon: const Icon(
              Icons.notifications_outlined,
            ),
          ),
        ],
      ),
      body: isLoading
          ? const Center(
              child: CircularProgressIndicator(),
            )
          : RefreshIndicator(
              onRefresh: loadUserDetails,
              child: SingleChildScrollView(
                physics: const AlwaysScrollableScrollPhysics(),
                padding: const EdgeInsets.all(18),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text(
                      'Welcome Back',
                      style: TextStyle(
                        fontSize: 16,
                        color: Colors.grey,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      name,
                      style: const TextStyle(
                        fontSize: 24,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                    const SizedBox(height: 20),

                    // Wallet balance card
                    Container(
                      width: double.infinity,
                      padding: const EdgeInsets.all(22),
                      decoration: BoxDecoration(
                        color: Colors.green,
                        borderRadius: BorderRadius.circular(18),
                        boxShadow: [
                          BoxShadow(
                            color: Colors.black.withValues(
                              alpha: 0.08,
                            ),
                            blurRadius: 12,
                            offset: const Offset(0, 6),
                          ),
                        ],
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Text(
                            'Wallet Balance',
                            style: TextStyle(
                              color: Colors.white70,
                              fontSize: 15,
                            ),
                          ),
                          const SizedBox(height: 10),
                          Text(
                            '₦${balance.toStringAsFixed(2)}',
                            style: const TextStyle(
                              color: Colors.white,
                              fontSize: 32,
                              fontWeight: FontWeight.bold,
                            ),
                          ),
                          const SizedBox(height: 18),
                          ElevatedButton.icon(
                            onPressed: () {
                              openPage(
                                context,
                                const WalletScreen(),
                              );
                            },
                            icon: const Icon(Icons.add),
                            label: const Text('Fund Wallet'),
                            style: ElevatedButton.styleFrom(
                              backgroundColor: Colors.white,
                              foregroundColor: Colors.green,
                            ),
                          ),
                        ],
                      ),
                    ),

                    const SizedBox(height: 26),

                    // Payments section
                    sectionTitle('Payments'),

                    serviceGrid(
                      children: [
                        serviceCard(
                          icon: Icons.phone_android,
                          title: 'Airtime',
                          onTap: () {
                            openPage(
                              context,
                              const AirtimeScreen(),
                            );
                          },
                        ),
                        serviceCard(
                          icon: Icons.wifi,
                          title: 'Data',
                          onTap: () {
                            openPage(
                              context,
                              const DataScreen(),
                            );
                          },
                        ),
                        serviceCard(
                          icon: Icons.tv,
                          title: 'Cable TV',
                          onTap: () {
                            openPage(
                              context,
                              const CableScreen(),
                            );
                          },
                        ),
                        serviceCard(
                          icon: Icons.lightbulb_outline,
                          title: 'Electricity',
                          onTap: () {
                            openPage(
                              context,
                              const ElectricityScreen(),
                            );
                          },
                        ),
                        serviceCard(
                          icon: Icons.school_outlined,
                          title: 'Exam PIN',
                          onTap: () {
                            openPage(
                              context,
                              const ExamPinScreen(),
                            );
                          },
                        ),
                        serviceCard(
                          icon: Icons.account_balance_outlined,
                          title: 'School Fees',
                          onTap: () {
                            openComingSoon(
                              title: 'School Fees',
                              icon: Icons.account_balance_outlined,
                              description:
                                  'Pay school fees securely through Servicepay.',
                            );
                          },
                        ),
                      ],
                    ),

                    const SizedBox(height: 26),

                    // Travel section
                    sectionTitle('Travel & Transport'),

                    serviceGrid(
                      children: [
                        serviceCard(
                          icon: Icons.flight_takeoff,
                          title: 'Flights',
                          onTap: () {
                            openComingSoon(
                              title: 'Flight Booking',
                              icon: Icons.flight_takeoff,
                              description:
                                  'Search and book local and international flights.',
                            );
                          },
                        ),
                        serviceCard(
                          icon: Icons.hotel_outlined,
                          title: 'Hotels',
                          onTap: () {
                            openComingSoon(
                              title: 'Hotel Booking',
                              icon: Icons.hotel_outlined,
                              description:
                                  'Find and reserve hotels through Servicepay.',
                            );
                          },
                        ),
                        serviceCard(
                          icon: Icons.local_taxi_outlined,
                          title: 'Taxi',
                          onTap: () {
                            openComingSoon(
                              title: 'Taxi Booking',
                              icon: Icons.local_taxi_outlined,
                              description:
                                  'Request a taxi and travel safely to your destination.',
                            );
                          },
                        ),
                        serviceCard(
                          icon: Icons.electric_rickshaw_outlined,
                          title: 'Keke Napep',
                          onTap: () {
                            openComingSoon(
                              title: 'Keke Napep Booking',
                              icon: Icons.electric_rickshaw_outlined,
                              description:
                                  'Request a nearby Keke Napep for short and affordable trips.',
                            );
                          },
                        ),
                        serviceCard(
                          icon: Icons.local_shipping_outlined,
                          title: 'Logistics',
                          onTap: () {
                            openPage(
                              context,
                              const LogisticsScreen(),
                            );
                          },
                        ),
                      ],
                    ),

                    const SizedBox(height: 26),

                    // Food and marketplace section
                    sectionTitle('Food & Marketplace'),

                    serviceGrid(
                      children: [
                        serviceCard(
                          icon: Icons.restaurant_outlined,
                          title: 'Food Order',
                          onTap: () {
                            openComingSoon(
                              title: 'Restaurant Food Order',
                              icon: Icons.restaurant_outlined,
                              description:
                                  'Order food from restaurants near you.',
                            );
                          },
                        ),
                        serviceCard(
                          icon: Icons.handyman_outlined,
                          title: 'Professionals',
                          onTap: () {
                            openComingSoon(
                              title: 'Hire a Professional',
                              icon: Icons.handyman_outlined,
                              description:
                                  'Find plumbers, electricians, mechanics, cleaners and other professionals.',
                            );
                          },
                        ),
                        serviceCard(
                          icon: Icons.storefront_outlined,
                          title: 'Buy & Sell',
                          onTap: () {
                            openComingSoon(
                              title: 'Buy & Sell Marketplace',
                              icon: Icons.storefront_outlined,
                              description:
                                  'Buy and sell products safely through Servicepay.',
                            );
                          },
                        ),
                      ],
                    ),

                    const SizedBox(height: 26),

                    // Account services section
                    sectionTitle('Account Services'),

                    serviceGrid(
                      children: [
                        serviceCard(
                          icon: Icons.account_balance_wallet_outlined,
                          title: 'Wallet',
                          onTap: () {
                            openPage(
                              context,
                              const WalletScreen(),
                            );
                          },
                        ),
                        serviceCard(
                          icon: Icons.send_rounded,
                          title: 'Transfer',
                          onTap: () {
                            openPage(
                              context,
                              const TransferScreen(),
                            );
                          },
                        ),
                        serviceCard(
                          icon: Icons.verified_user_outlined,
                          title: 'ID Verification',
                          onTap: () {
                            openPage(
                              context,
                              const IdVerificationScreen(),
                            );
                          },
                        ),
                        serviceCard(
                          icon: Icons.sim_card_outlined,
                          title: 'SIM Services',
                          onTap: () {
                            openComingSoon(
                              title: 'SIM Registration Service',
                              icon: Icons.sim_card_outlined,
                              description:
                                  'Access SIM registration and related services.',
                            );
                          },
                        ),
                      ],
                    ),

                    const SizedBox(height: 30),

                    const Text(
                      'Recent Transactions',
                      style: TextStyle(
                        fontSize: 20,
                        fontWeight: FontWeight.bold,
                      ),
                    ),

                    const SizedBox(height: 15),

                    Container(
                      width: double.infinity,
                      padding: const EdgeInsets.all(24),
                      decoration: BoxDecoration(
                        color: Colors.white,
                        borderRadius: BorderRadius.circular(16),
                      ),
                      child: const Column(
                        children: [
                          Icon(
                            Icons.receipt_long_outlined,
                            size: 50,
                            color: Colors.grey,
                          ),
                          SizedBox(height: 10),
                          Text(
                            'No transactions yet',
                            style: TextStyle(
                              color: Colors.grey,
                            ),
                          ),
                        ],
                      ),
                    ),

                    const SizedBox(height: 25),
                  ],
                ),
              ),
            ),
    );
  }
}

class ComingSoonScreen extends StatelessWidget {
  final String title;
  final IconData icon;
  final String description;

  const ComingSoonScreen({
    super.key,
    required this.title,
    required this.icon,
    required this.description,
  });

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF5F7FA),
      appBar: AppBar(
        backgroundColor: Colors.green,
        foregroundColor: Colors.white,
        title: Text(title),
      ),
      body: Center(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24),
          child: Container(
            width: double.infinity,
            constraints: const BoxConstraints(
              maxWidth: 500,
            ),
            padding: const EdgeInsets.all(30),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(22),
              boxShadow: [
                BoxShadow(
                  color: Colors.black.withValues(
                    alpha: 0.07,
                  ),
                  blurRadius: 18,
                  offset: const Offset(0, 8),
                ),
              ],
            ),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Container(
                  width: 100,
                  height: 100,
                  decoration: BoxDecoration(
                    color: Colors.green.withValues(
                      alpha: 0.12,
                    ),
                    shape: BoxShape.circle,
                  ),
                  child: Icon(
                    icon,
                    size: 52,
                    color: Colors.green,
                  ),
                ),
                const SizedBox(height: 24),
                Text(
                  title,
                  textAlign: TextAlign.center,
                  style: const TextStyle(
                    fontSize: 25,
                    fontWeight: FontWeight.bold,
                  ),
                ),
                const SizedBox(height: 12),
                Text(
                  description,
                  textAlign: TextAlign.center,
                  style: const TextStyle(
                    fontSize: 16,
                    color: Colors.grey,
                    height: 1.5,
                  ),
                ),
                const SizedBox(height: 24),
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 20,
                    vertical: 12,
                  ),
                  decoration: BoxDecoration(
                    color: Colors.orange.withValues(
                      alpha: 0.12,
                    ),
                    borderRadius: BorderRadius.circular(30),
                  ),
                  child: const Text(
                    'Coming Soon',
                    style: TextStyle(
                      color: Colors.orange,
                      fontWeight: FontWeight.bold,
                      fontSize: 16,
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
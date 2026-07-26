import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'airtime_screen.dart';
import 'cable_screen.dart';
import 'data_screen.dart';
import 'electricity_screen.dart';
import 'exam_pin_screen.dart';
import 'flight_booking_screen.dart';
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

    if (!mounted) return;
    await loadUserDetails();
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
                            openPage(
                              context,
                              const ServiceFeatureScreen(
                                title: 'School Fees',
                                icon: Icons.account_balance_outlined,
                                description:
                                    'Select a school, enter the student details and pay school fees securely through Servicepay.',
                              ),
                            );
                          },
                        ),
                      ],
                    ),

                    const SizedBox(height: 26),

                    sectionTitle('Travel & Transport'),

                    serviceGrid(
                      children: [
                        serviceCard(
                          icon: Icons.flight_takeoff,
                          title: 'Flights',
                          onTap: () {
                            openPage(
                              context,
                              const FlightBookingScreen(),
                            );
                          },
                        ),
                        serviceCard(
                          icon: Icons.hotel_outlined,
                          title: 'Hotels',
                          onTap: () {
                            openPage(
                              context,
                              const ServiceFeatureScreen(
                                title: 'Hotel Booking',
                                icon: Icons.hotel_outlined,
                                description:
                                    'Search for hotels, select rooms and make reservations through Servicepay.',
                              ),
                            );
                          },
                        ),
                        serviceCard(
                          icon: Icons.local_taxi_outlined,
                          title: 'Taxi',
                          onTap: () {
                            openPage(
                              context,
                              const ServiceFeatureScreen(
                                title: 'Taxi Booking',
                                icon: Icons.local_taxi_outlined,
                                description:
                                    'Enter your pickup location and destination to request a taxi.',
                              ),
                            );
                          },
                        ),
                        serviceCard(
                          icon: Icons.electric_rickshaw_outlined,
                          title: 'Keke Napep',
                          onTap: () {
                            openPage(
                              context,
                              const ServiceFeatureScreen(
                                title: 'Keke Napep Booking',
                                icon:
                                    Icons.electric_rickshaw_outlined,
                                description:
                                    'Request a nearby Keke Napep for convenient and affordable local trips.',
                              ),
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

                    sectionTitle('Food & Marketplace'),

                    serviceGrid(
                      children: [
                        serviceCard(
                          icon: Icons.restaurant_outlined,
                          title: 'Food Order',
                          onTap: () {
                            openPage(
                              context,
                              const ServiceFeatureScreen(
                                title: 'Restaurant Food Order',
                                icon: Icons.restaurant_outlined,
                                description:
                                    'Browse nearby restaurants, select meals and place your order.',
                              ),
                            );
                          },
                        ),
                        serviceCard(
                          icon: Icons.handyman_outlined,
                          title: 'Professionals',
                          onTap: () {
                            openPage(
                              context,
                              const ServiceFeatureScreen(
                                title: 'Hire a Professional',
                                icon: Icons.handyman_outlined,
                                description:
                                    'Find plumbers, electricians, mechanics, cleaners and other trusted professionals.',
                              ),
                            );
                          },
                        ),
                        serviceCard(
                          icon: Icons.storefront_outlined,
                          title: 'Buy & Sell',
                          onTap: () {
                            openPage(
                              context,
                              const ServiceFeatureScreen(
                                title: 'Buy & Sell Marketplace',
                                icon: Icons.storefront_outlined,
                                description:
                                    'Browse products, create listings and buy or sell safely through Servicepay.',
                              ),
                            );
                          },
                        ),
                      ],
                    ),

                    const SizedBox(height: 26),

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
                            openPage(
                              context,
                              const ServiceFeatureScreen(
                                title: 'SIM Registration Service',
                                icon: Icons.sim_card_outlined,
                                description:
                                    'Start SIM registration and access other supported SIM-related services.',
                              ),
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

class ServiceFeatureScreen extends StatelessWidget {
  final String title;
  final IconData icon;
  final String description;

  const ServiceFeatureScreen({
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
        title: Text(
          title,
          style: const TextStyle(
            fontWeight: FontWeight.bold,
          ),
        ),
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(20),
        child: Column(
          children: [
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(28),
              decoration: BoxDecoration(
                color: Colors.green,
                borderRadius: BorderRadius.circular(22),
              ),
              child: Column(
                children: [
                  Container(
                    width: 90,
                    height: 90,
                    decoration: BoxDecoration(
                      color: Colors.white.withValues(
                        alpha: 0.18,
                      ),
                      shape: BoxShape.circle,
                    ),
                    child: Icon(
                      icon,
                      size: 48,
                      color: Colors.white,
                    ),
                  ),
                  const SizedBox(height: 18),
                  Text(
                    title,
                    textAlign: TextAlign.center,
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 24,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                  const SizedBox(height: 10),
                  Text(
                    description,
                    textAlign: TextAlign.center,
                    style: const TextStyle(
                      color: Colors.white70,
                      fontSize: 15,
                      height: 1.5,
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 22),
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(22),
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(18),
              ),
              child: Column(
                children: [
                  Icon(
                    icon,
                    size: 55,
                    color: Colors.green,
                  ),
                  const SizedBox(height: 16),
                  const Text(
                    'Service Setup',
                    style: TextStyle(
                      fontSize: 21,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                  const SizedBox(height: 10),
                  const Text(
                    'The booking form and service provider connection will be added during the next development stage.',
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      color: Colors.grey,
                      fontSize: 15,
                      height: 1.5,
                    ),
                  ),
                  const SizedBox(height: 22),
                  SizedBox(
                    width: double.infinity,
                    height: 52,
                    child: ElevatedButton.icon(
                      onPressed: () {
                        Navigator.pop(context);
                      },
                      icon: const Icon(Icons.arrow_back),
                      label: const Text(
                        'Back to Dashboard',
                        style: TextStyle(
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                      style: ElevatedButton.styleFrom(
                        backgroundColor: Colors.green,
                        foregroundColor: Colors.white,
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(14),
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
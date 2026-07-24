import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'airtime_screen.dart';
import 'cable_screen.dart';
import 'data_screen.dart';
import 'electricity_screen.dart';
import 'exam_pin_screen.dart';
import 'id_verification_screen.dart';
import 'transfer_screen.dart';
import 'wallet_screen.dart';
import 'widgets.dart';

class DashboardScreen extends StatefulWidget {
  const DashboardScreen({super.key});

  @override
  State<DashboardScreen> createState() => _DashboardScreenState();
}

class _DashboardScreenState extends State<DashboardScreen> {
  String name = 'Customer';
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
      name = savedName?.isNotEmpty == true ? savedName! : 'Customer';
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

  void showComingSoon(
    BuildContext context,
    String serviceName,
  ) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text('$serviceName is coming soon.'),
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
        title: const Text(
          'Servicepay',
          style: TextStyle(
            fontWeight: FontWeight.bold,
          ),
        ),
        actions: [
          IconButton(
            onPressed: loadUserDetails,
            icon: const Icon(Icons.refresh),
          ),
          IconButton(
            onPressed: () {
              showComingSoon(context, 'Notifications');
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
                      'Welcome back',
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
                    const SizedBox(height: 28),
                    const Text(
                      'Services',
                      style: TextStyle(
                        fontSize: 20,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                    const SizedBox(height: 16),
                    GridView.count(
                      crossAxisCount: 3,
                      shrinkWrap: true,
                      physics: const NeverScrollableScrollPhysics(),
                      mainAxisSpacing: 16,
                      crossAxisSpacing: 16,
                      childAspectRatio: 1.05,
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
                          title: 'Servicepay Transfer',
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
                      ],
                    ),
                    const SizedBox(height: 28),
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
                  ],
                ),
              ),
            ),
    );
  }
}
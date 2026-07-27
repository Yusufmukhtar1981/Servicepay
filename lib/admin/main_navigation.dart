import 'package:flutter/material.dart';

import 'admin_dashboard_screen.dart';
import 'admin_manual_funding_screen.dart';
import 'admin_notifications_screen.dart';

class AdminMainNavigation extends StatefulWidget {
  const AdminMainNavigation({super.key});

  @override
  State<AdminMainNavigation> createState() =>
      _AdminMainNavigationState();
}

class _AdminMainNavigationState
    extends State<AdminMainNavigation> {
  int currentIndex = 0;

  final List<Widget> pages = const [
    AdminDashboardScreen(),
    AdminManualFundingScreen(),
    AdminNotificationsScreen(),
    Center(
      child: Text(
        'Admin Profile',
        style: TextStyle(
          fontSize: 24,
          fontWeight: FontWeight.bold,
        ),
      ),
    ),
  ];

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: IndexedStack(
        index: currentIndex,
        children: pages,
      ),
      bottomNavigationBar: BottomNavigationBar(
        currentIndex: currentIndex,
        type: BottomNavigationBarType.fixed,
        selectedItemColor:
            const Color(0xFF0F766E),
        unselectedItemColor:
            const Color(0xFF94A3B8),
        backgroundColor: Colors.white,
        elevation: 12,
        selectedLabelStyle: const TextStyle(
          fontWeight: FontWeight.w700,
          fontSize: 11,
        ),
        unselectedLabelStyle: const TextStyle(
          fontWeight: FontWeight.w600,
          fontSize: 11,
        ),
        onTap: (int index) {
          setState(() {
            currentIndex = index;
          });
        },
        items: const [
          BottomNavigationBarItem(
            icon: Icon(
              Icons.dashboard_outlined,
            ),
            activeIcon: Icon(
              Icons.dashboard_rounded,
            ),
            label: 'Dashboard',
          ),
          BottomNavigationBarItem(
            icon: Icon(
              Icons.account_balance_wallet_outlined,
            ),
            activeIcon: Icon(
              Icons.account_balance_wallet_rounded,
            ),
            label: 'Funding',
          ),
          BottomNavigationBarItem(
            icon: Icon(
              Icons.notifications_outlined,
            ),
            activeIcon: Icon(
              Icons.notifications_rounded,
            ),
            label: 'Notifications',
          ),
          BottomNavigationBarItem(
            icon: Icon(
              Icons.admin_panel_settings_outlined,
            ),
            activeIcon: Icon(
              Icons.admin_panel_settings_rounded,
            ),
            label: 'Profile',
          ),
        ],
      ),
    );
  }
}
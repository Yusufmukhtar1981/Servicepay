import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'admin_dashboard_screen.dart';
import 'admin_delivery_screen.dart';
import 'admin_manual_funding_screen.dart';
import 'admin_notifications_screen.dart';
import 'admin_settings_screen.dart';
import 'users_screen.dart';

class AdminMainNavigation extends StatefulWidget {
  const AdminMainNavigation({
    super.key,
  });

  @override
  State<AdminMainNavigation> createState() =>
      _AdminMainNavigationState();
}

class _AdminMainNavigationState
    extends State<AdminMainNavigation> {
  int currentIndex = 0;

  bool isLoadingRole = true;

  String adminRole = 'HEAD_OFFICE';

  List<Widget> pages = const [];

  List<BottomNavigationBarItem> navigationItems =
      const [];

  @override
  void initState() {
    super.initState();
    loadAdminRole();
  }

  String normalizeRole(
    String? value,
  ) {
    return (value ?? '')
        .trim()
        .toUpperCase()
        .replaceAll(
          RegExp(r'[\s-]+'),
          '_',
        );
  }

  Future<void> loadAdminRole() async {
    final SharedPreferences prefs =
        await SharedPreferences.getInstance();

    final String savedRole = normalizeRole(
      prefs.getString('user_role') ??
          prefs.getString('admin_role') ??
          prefs.getString('role') ??
          'HEAD_OFFICE',
    );

    if (!mounted) {
      return;
    }

    setState(() {
      adminRole = savedRole;
      currentIndex = 0;

      configureNavigation();

      isLoadingRole = false;
    });
  }

  void configureNavigation() {
    if (adminRole == 'HEAD_OFFICE') {
      pages = const [
        AdminDashboardScreen(),
        AdminDeliveryScreen(),
        AdminManualFundingScreen(),
        AdminNotificationsScreen(),
        AdminSettingsScreen(),
      ];

      navigationItems = const [
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
            Icons.local_shipping_outlined,
          ),
          activeIcon: Icon(
            Icons.local_shipping_rounded,
          ),
          label: 'Deliveries',
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
          label: 'Alerts',
        ),
        BottomNavigationBarItem(
          icon: Icon(
            Icons.settings_outlined,
          ),
          activeIcon: Icon(
            Icons.settings_rounded,
          ),
          label: 'Settings',
        ),
      ];

      return;
    }

    if (adminRole == 'ZONAL_MANAGER' ||
        adminRole == 'STATE_MANAGER') {
      pages = const [
        AdminDashboardScreen(),
        AdminUsersScreen(),
      ];

      navigationItems = const [
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
            Icons.manage_accounts_outlined,
          ),
          activeIcon: Icon(
            Icons.manage_accounts_rounded,
          ),
          label: 'Users',
        ),
      ];

      return;
    }

    pages = const [
      _AccessDeniedScreen(),
    ];

    navigationItems = const [
      BottomNavigationBarItem(
        icon: Icon(
          Icons.block_outlined,
        ),
        activeIcon: Icon(
          Icons.block_rounded,
        ),
        label: 'Access',
      ),
    ];
  }

  @override
  Widget build(
    BuildContext context,
  ) {
    if (isLoadingRole) {
      return const Scaffold(
        backgroundColor: Color(
          0xFFF8FAFC,
        ),
        body: Center(
          child: CircularProgressIndicator(
            color: Color(
              0xFF0F766E,
            ),
          ),
        ),
      );
    }

    if (pages.isEmpty ||
        navigationItems.isEmpty) {
      return const Scaffold(
        body: Center(
          child: Text(
            'Unable to load navigation.',
          ),
        ),
      );
    }

    final int safeIndex =
        currentIndex >= pages.length
            ? 0
            : currentIndex;

    return Scaffold(
      body: IndexedStack(
        index: safeIndex,
        children: pages,
      ),
      bottomNavigationBar:
          BottomNavigationBar(
        currentIndex: safeIndex,
        type:
            BottomNavigationBarType.fixed,
        selectedItemColor:
            const Color(
          0xFF0F766E,
        ),
        unselectedItemColor:
            const Color(
          0xFF94A3B8,
        ),
        backgroundColor:
            Colors.white,
        elevation: 12,
        selectedFontSize: 10,
        unselectedFontSize: 10,
        selectedLabelStyle:
            const TextStyle(
          fontWeight:
              FontWeight.w700,
        ),
        unselectedLabelStyle:
            const TextStyle(
          fontWeight:
              FontWeight.w600,
        ),
        onTap: (
          int index,
        ) {
          if (index < 0 ||
              index >= pages.length) {
            return;
          }

          setState(() {
            currentIndex = index;
          });
        },
        items: navigationItems,
      ),
    );
  }
}

class _AccessDeniedScreen
    extends StatelessWidget {
  const _AccessDeniedScreen();

  @override
  Widget build(
    BuildContext context,
  ) {
    return Scaffold(
      backgroundColor:
          const Color(
        0xFFF8FAFC,
      ),
      appBar: AppBar(
        backgroundColor:
            const Color(
          0xFF0F766E,
        ),
        foregroundColor:
            Colors.white,
        title: const Text(
          'ServicePay Admin',
          style: TextStyle(
            fontWeight:
                FontWeight.w800,
          ),
        ),
      ),
      body: const Center(
        child: Padding(
          padding:
              EdgeInsets.all(
            24,
          ),
          child: Column(
            mainAxisSize:
                MainAxisSize.min,
            children: [
              Icon(
                Icons
                    .admin_panel_settings_outlined,
                size: 68,
                color:
                    Color(
                  0xFFDC2626,
                ),
              ),
              SizedBox(
                height: 18,
              ),
              Text(
                'Access denied',
                textAlign:
                    TextAlign.center,
                style: TextStyle(
                  fontSize: 22,
                  fontWeight:
                      FontWeight.w900,
                ),
              ),
              SizedBox(
                height: 8,
              ),
              Text(
                'This account does not have permission to use the management application.',
                textAlign:
                    TextAlign.center,
                style: TextStyle(
                  color:
                      Color(
                    0xFF64748B,
                  ),
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
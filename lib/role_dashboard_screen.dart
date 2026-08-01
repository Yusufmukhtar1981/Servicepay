import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'main_navigation.dart';
import 'profile_screen.dart';
import 'transactions_screen.dart';

class RoleDashboardScreen extends StatefulWidget {
  final String role;

  const RoleDashboardScreen({
    super.key,
    required this.role,
  });

  @override
  State<RoleDashboardScreen> createState() => _RoleDashboardScreenState();
}

class _RoleDashboardScreenState extends State<RoleDashboardScreen> {
  static const Color primaryGreen = Color(0xFF08783E);
  static const Color darkGreen = Color(0xFF004E2C);
  static const Color softGreen = Color(0xFFEAF7F0);

  String userName = 'ServicePay User';
  double walletBalance = 0;

  @override
  void initState() {
    super.initState();
    loadUserDetails();
  }

  Future<void> loadUserDetails() async {
    final SharedPreferences preferences = await SharedPreferences.getInstance();

    final String savedName = preferences.getString('user_name') ??
        preferences.getString('full_name') ??
        preferences.getString('name') ??
        'ServicePay User';

    final double savedBalance = preferences.getDouble('wallet_balance') ?? 0;

    if (!mounted) {
      return;
    }

    setState(() {
      userName =
          savedName.trim().isEmpty ? 'ServicePay User' : savedName.trim();

      walletBalance = savedBalance;
    });
  }

  String get normalizedRole => widget.role.trim().toUpperCase();

  String get roleTitle {
    switch (normalizedRole) {
      case 'AGENT':
        return 'Agent';
      case 'STATE_MANAGER':
        return 'State Manager';
      case 'ZONAL_MANAGER':
        return 'Zonal Manager';
      default:
        return 'ServicePay User';
    }
  }

  String get roleDescription {
    switch (normalizedRole) {
      case 'AGENT':
        return 'Manage your customers, transactions and commissions.';
      case 'STATE_MANAGER':
        return 'Monitor agents and performance across your state.';
      case 'ZONAL_MANAGER':
        return 'Monitor state managers and performance across your zone.';
      default:
        return 'Manage your ServicePay activities.';
    }
  }

  String get firstName {
    final String trimmed = userName.trim();

    if (trimmed.isEmpty) {
      return 'User';
    }

    return trimmed.split(RegExp(r'\s+')).first;
  }

  String formatMoney(double amount) {
    final String value = amount.toStringAsFixed(2);
    final List<String> parts = value.split('.');
    final String whole = parts.first;

    final StringBuffer formatted = StringBuffer();

    for (int index = 0; index < whole.length; index++) {
      final int remaining = whole.length - index;

      formatted.write(whole[index]);

      if (remaining > 1 && remaining % 3 == 1) {
        formatted.write(',');
      }
    }

    return '₦${formatted.toString()}.${parts.last}';
  }

  void openScreen(Widget screen) {
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => screen,
      ),
    );
  }

  List<_RoleMenuItem> roleItems() {
    switch (normalizedRole) {
      case 'AGENT':
        return [
          _RoleMenuItem(
            title: 'My Customers',
            subtitle: 'Customers registered under you',
            icon: Icons.groups_rounded,
          ),
          _RoleMenuItem(
            title: 'Commission',
            subtitle: 'Agent commission and earnings',
            icon: Icons.account_balance_wallet_rounded,
          ),
          _RoleMenuItem(
            title: 'Transactions',
            subtitle: 'Customer and commission transactions',
            icon: Icons.receipt_long_rounded,
            onTap: () {
              openScreen(const TransactionsScreen());
            },
          ),
          _RoleMenuItem(
            title: 'Performance',
            subtitle: 'Track your daily and monthly results',
            icon: Icons.insights_rounded,
          ),
        ];

      case 'STATE_MANAGER':
        return [
          _RoleMenuItem(
            title: 'Agents',
            subtitle: 'Agents registered under your state',
            icon: Icons.support_agent_rounded,
          ),
          _RoleMenuItem(
            title: 'State Commission',
            subtitle: 'Your state manager earnings',
            icon: Icons.account_balance_wallet_rounded,
          ),
          _RoleMenuItem(
            title: 'State Transactions',
            subtitle: 'Transactions completed in your state',
            icon: Icons.receipt_long_rounded,
            onTap: () {
              openScreen(const TransactionsScreen());
            },
          ),
          _RoleMenuItem(
            title: 'State Performance',
            subtitle: 'Monitor agents and customer activity',
            icon: Icons.bar_chart_rounded,
          ),
        ];

      case 'ZONAL_MANAGER':
        return [
          _RoleMenuItem(
            title: 'State Managers',
            subtitle: 'Managers registered under your zone',
            icon: Icons.manage_accounts_rounded,
          ),
          _RoleMenuItem(
            title: 'Zonal Commission',
            subtitle: 'Your zonal manager earnings',
            icon: Icons.account_balance_wallet_rounded,
          ),
          _RoleMenuItem(
            title: 'Zone Transactions',
            subtitle: 'Transactions completed in your zone',
            icon: Icons.receipt_long_rounded,
            onTap: () {
              openScreen(const TransactionsScreen());
            },
          ),
          _RoleMenuItem(
            title: 'Zone Performance',
            subtitle: 'Monitor states, agents and customers',
            icon: Icons.query_stats_rounded,
          ),
        ];

      default:
        return [];
    }
  }

  @override
  Widget build(BuildContext context) {
    final List<_RoleMenuItem> items = roleItems();

    return Scaffold(
      backgroundColor: const Color(0xFFF7F9FB),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(
            17,
            17,
            17,
            32,
          ),
          children: [
            Row(
              children: [
                Container(
                  width: 46,
                  height: 46,
                  decoration: BoxDecoration(
                    gradient: const LinearGradient(
                      colors: [
                        Color(0xFF13A85B),
                        primaryGreen,
                      ],
                    ),
                    borderRadius: BorderRadius.circular(15),
                  ),
                  alignment: Alignment.center,
                  child: const Text(
                    'S',
                    style: TextStyle(
                      color: Colors.white,
                      fontSize: 27,
                      fontWeight: FontWeight.w900,
                      fontStyle: FontStyle.italic,
                    ),
                  ),
                ),
                const SizedBox(width: 11),
                const Expanded(
                  child: Text(
                    'ServicePay',
                    style: TextStyle(
                      color: darkGreen,
                      fontSize: 23,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                ),
                IconButton.filledTonal(
                  onPressed: () {
                    openScreen(const ProfileScreen());
                  },
                  style: IconButton.styleFrom(
                    backgroundColor: softGreen,
                    foregroundColor: primaryGreen,
                  ),
                  icon: const Icon(
                    Icons.person_outline_rounded,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 23),
            Text(
              'Hello, $firstName',
              style: const TextStyle(
                color: Color(0xFF101828),
                fontSize: 25,
                fontWeight: FontWeight.w900,
              ),
            ),
            const SizedBox(height: 4),
            Text(
              roleDescription,
              style: const TextStyle(
                color: Color(0xFF667085),
                fontSize: 13,
                height: 1.4,
              ),
            ),
            const SizedBox(height: 20),
            Container(
              padding: const EdgeInsets.all(21),
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(26),
                gradient: const LinearGradient(
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                  colors: [
                    darkGreen,
                    primaryGreen,
                    Color(0xFF12A85B),
                  ],
                ),
                boxShadow: const [
                  BoxShadow(
                    color: Color(0x33004E2C),
                    blurRadius: 24,
                    offset: Offset(0, 12),
                  ),
                ],
              ),
              child: Stack(
                children: [
                  Positioned(
                    right: -35,
                    top: -50,
                    child: Container(
                      width: 170,
                      height: 170,
                      decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        border: Border.all(
                          color: Colors.white.withValues(
                            alpha: 0.08,
                          ),
                          width: 23,
                        ),
                      ),
                    ),
                  ),
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Expanded(
                            child: Text(
                              '$roleTitle Dashboard',
                              style: const TextStyle(
                                color: Color(0xFFD9F7E6),
                                fontSize: 15,
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                          ),
                          Container(
                            padding: const EdgeInsets.symmetric(
                              horizontal: 11,
                              vertical: 7,
                            ),
                            decoration: BoxDecoration(
                              color: Colors.white.withValues(
                                alpha: 0.14,
                              ),
                              borderRadius: BorderRadius.circular(30),
                            ),
                            child: Text(
                              normalizedRole,
                              style: const TextStyle(
                                color: Colors.white,
                                fontSize: 10,
                                fontWeight: FontWeight.w800,
                              ),
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 20),
                      const Text(
                        'Wallet Balance',
                        style: TextStyle(
                          color: Color(0xFFD9F7E6),
                        ),
                      ),
                      const SizedBox(height: 5),
                      Text(
                        formatMoney(walletBalance),
                        style: const TextStyle(
                          color: Colors.white,
                          fontSize: 31,
                          fontWeight: FontWeight.w900,
                        ),
                      ),
                      const SizedBox(height: 18),
                      Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 11,
                          vertical: 7,
                        ),
                        decoration: BoxDecoration(
                          color: Colors.white.withValues(
                            alpha: 0.11,
                          ),
                          borderRadius: BorderRadius.circular(30),
                        ),
                        child: const Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Icon(
                              Icons.verified_user_outlined,
                              color: Color(0xFFB7F7D2),
                              size: 17,
                            ),
                            SizedBox(width: 6),
                            Text(
                              'Verified ServicePay Account',
                              style: TextStyle(
                                color: Colors.white,
                                fontSize: 11,
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
            const SizedBox(height: 23),
            Row(
              children: [
                const Expanded(
                  child: Text(
                    'Management Tools',
                    style: TextStyle(
                      color: Color(0xFF101828),
                      fontSize: 19,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                ),
                Text(
                  roleTitle,
                  style: const TextStyle(
                    color: primaryGreen,
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 13),
            GridView.builder(
              itemCount: items.length,
              shrinkWrap: true,
              physics: const NeverScrollableScrollPhysics(),
              gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                crossAxisCount: 2,
                mainAxisSpacing: 12,
                crossAxisSpacing: 12,
                childAspectRatio: 1.16,
              ),
              itemBuilder: (
                BuildContext context,
                int index,
              ) {
                final _RoleMenuItem item = items[index];

                return Material(
                  color: Colors.white,
                  borderRadius: BorderRadius.circular(21),
                  child: InkWell(
                    onTap: item.onTap ??
                        () {
                          ScaffoldMessenger.of(context)
                            ..hideCurrentSnackBar()
                            ..showSnackBar(
                              SnackBar(
                                content: Text(
                                  '${item.title} will be connected next.',
                                ),
                              ),
                            );
                        },
                    borderRadius: BorderRadius.circular(21),
                    child: Container(
                      padding: const EdgeInsets.all(16),
                      decoration: BoxDecoration(
                        borderRadius: BorderRadius.circular(21),
                        border: Border.all(
                          color: const Color(0xFFE7EAEF),
                        ),
                        boxShadow: const [
                          BoxShadow(
                            color: Color(0x0C101828),
                            blurRadius: 14,
                            offset: Offset(0, 5),
                          ),
                        ],
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Container(
                            width: 45,
                            height: 45,
                            decoration: BoxDecoration(
                              color: softGreen,
                              borderRadius: BorderRadius.circular(14),
                            ),
                            child: Icon(
                              item.icon,
                              color: primaryGreen,
                              size: 25,
                            ),
                          ),
                          const Spacer(),
                          Text(
                            item.title,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                              color: Color(0xFF1D2939),
                              fontSize: 14,
                              fontWeight: FontWeight.w900,
                            ),
                          ),
                          const SizedBox(height: 4),
                          Text(
                            item.subtitle,
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                              color: Color(0xFF667085),
                              fontSize: 11,
                              height: 1.3,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                );
              },
            ),
            const SizedBox(height: 19),
            SizedBox(
              height: 54,
              child: FilledButton.icon(
                onPressed: () {
                  openScreen(const MainNavigation());
                },
                style: FilledButton.styleFrom(
                  backgroundColor: primaryGreen,
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(18),
                  ),
                ),
                icon: const Icon(
                  Icons.apps_rounded,
                ),
                label: const Text(
                  'Open ServicePay Services',
                  style: TextStyle(
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _RoleMenuItem {
  final String title;
  final String subtitle;
  final IconData icon;
  final VoidCallback? onTap;

  const _RoleMenuItem({
    required this.title,
    required this.subtitle,
    required this.icon,
    this.onTap,
  });
}

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

class DashboardScreen extends StatefulWidget {
  const DashboardScreen({super.key});

  @override
  State<DashboardScreen> createState() => _DashboardScreenState();
}

class _DashboardScreenState extends State<DashboardScreen> {
  static const Color primaryGreen = Color(0xFF2E7D32);
  static const Color secondaryGreen = Color(0xFF43A047);
  static const Color backgroundColor = Color(0xFFF8FAFC);
  static const Color cardBorderColor = Color(0xFFE8ECE8);

  final TextEditingController searchController =
      TextEditingController();

  String name = 'User';
  String searchQuery = '';

  double balance = 0;

  int unreadNotifications = 1;

  bool isLoading = true;
  bool hideBalance = false;
  bool showMoreServices = false;

  @override
  void initState() {
    super.initState();
    loadUserDetails();
  }

  @override
  void dispose() {
    searchController.dispose();
    super.dispose();
  }

  Future<void> loadUserDetails() async {
    final prefs = await SharedPreferences.getInstance();

    final savedName =
        prefs.getString('user_name') ??
        prefs.getString('full_name') ??
        prefs.getString('name');

    final savedBalance = prefs.getDouble('wallet_balance');

    final savedNotificationCount =
        prefs.getInt('unread_notifications');

    if (!mounted) return;

    setState(() {
      name = savedName?.trim().isNotEmpty == true
          ? savedName!.trim()
          : 'User';

      balance = savedBalance ?? 0;

      unreadNotifications = savedNotificationCount ?? 1;

      isLoading = false;
    });
  }

  Future<void> openPage(
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

  String get firstName {
    final trimmedName = name.trim();

    if (trimmedName.isEmpty) {
      return 'User';
    }

    return trimmedName.split(' ').first;
  }

  void openTransactionsMessage() {
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(
        content: Text(
          'Tap Transactions on the bottom navigation to view your transaction history.',
        ),
        behavior: SnackBarBehavior.floating,
      ),
    );
  }

  List<_ServiceItem> get popularServices {
    return [
      _ServiceItem(
        title: 'Airtime',
        icon: Icons.phone_android_rounded,
        onTap: () {
          openPage(
            const AirtimeScreen(),
          );
        },
      ),
      _ServiceItem(
        title: 'Data',
        icon: Icons.wifi_rounded,
        onTap: () {
          openPage(
            const DataScreen(),
          );
        },
      ),
      _ServiceItem(
        title: 'Cable TV',
        icon: Icons.live_tv_outlined,
        onTap: () {
          openPage(
            const CableScreen(),
          );
        },
      ),
      _ServiceItem(
        title: 'Electricity',
        icon: Icons.lightbulb_outline_rounded,
        onTap: () {
          openPage(
            const ElectricityScreen(),
          );
        },
      ),
      _ServiceItem(
        title: 'Exam PIN',
        icon: Icons.school_outlined,
        onTap: () {
          openPage(
            const ExamPinScreen(),
          );
        },
      ),
      _ServiceItem(
        title: 'School Fees',
        icon: Icons.account_balance_outlined,
        onTap: () {
          openPage(
            const ServiceFeatureScreen(
              title: 'School Fees',
              icon: Icons.account_balance_outlined,
              description:
                  'Select a school, enter the student details and pay school fees securely through Servicepay.',
            ),
          );
        },
      ),
      _ServiceItem(
        title: 'Wallet',
        icon: Icons.account_balance_wallet_outlined,
        onTap: () {
          openPage(
            const WalletScreen(),
          );
        },
      ),
      _ServiceItem(
        title: 'Transfer',
        icon: Icons.send_rounded,
        onTap: () {
          openPage(
            const TransferScreen(),
          );
        },
      ),
    ];
  }

  List<_ServiceItem> get moreServices {
    return [
      _ServiceItem(
        title: 'Flights',
        icon: Icons.flight_takeoff_rounded,
        onTap: () {
          openPage(
            const FlightBookingScreen(),
          );
        },
      ),
      _ServiceItem(
        title: 'Hotels',
        icon: Icons.hotel_outlined,
        onTap: () {
          openPage(
            const ServiceFeatureScreen(
              title: 'Hotel Booking',
              icon: Icons.hotel_outlined,
              description:
                  'Search for hotels, select rooms and make reservations through Servicepay.',
            ),
          );
        },
      ),
      _ServiceItem(
        title: 'Taxi',
        icon: Icons.local_taxi_outlined,
        onTap: () {
          openPage(
            const ServiceFeatureScreen(
              title: 'Taxi Booking',
              icon: Icons.local_taxi_outlined,
              description:
                  'Enter your pickup location and destination to request a taxi.',
            ),
          );
        },
      ),
      _ServiceItem(
        title: 'Keke',
        icon: Icons.electric_rickshaw_outlined,
        onTap: () {
          openPage(
            const ServiceFeatureScreen(
              title: 'Keke Napep Booking',
              icon: Icons.electric_rickshaw_outlined,
              description:
                  'Request a nearby Keke Napep for convenient and affordable local trips.',
            ),
          );
        },
      ),
      _ServiceItem(
        title: 'Logistics',
        icon: Icons.local_shipping_outlined,
        onTap: () {
          openPage(
            const LogisticsScreen(),
          );
        },
      ),
      _ServiceItem(
        title: 'Food Order',
        icon: Icons.restaurant_outlined,
        onTap: () {
          openPage(
            const ServiceFeatureScreen(
              title: 'Restaurant Food Order',
              icon: Icons.restaurant_outlined,
              description:
                  'Browse nearby restaurants, select meals and place your order.',
            ),
          );
        },
      ),
      _ServiceItem(
        title: 'Professionals',
        icon: Icons.handyman_outlined,
        onTap: () {
          openPage(
            const ServiceFeatureScreen(
              title: 'Hire a Professional',
              icon: Icons.handyman_outlined,
              description:
                  'Find plumbers, electricians, mechanics, cleaners and other trusted professionals.',
            ),
          );
        },
      ),
      _ServiceItem(
        title: 'Buy & Sell',
        icon: Icons.storefront_outlined,
        onTap: () {
          openPage(
            const ServiceFeatureScreen(
              title: 'Buy & Sell Marketplace',
              icon: Icons.storefront_outlined,
              description:
                  'Browse products, create listings and buy or sell safely through Servicepay.',
            ),
          );
        },
      ),
      _ServiceItem(
        title: 'Verify ID',
        icon: Icons.verified_user_outlined,
        onTap: () {
          openPage(
            const IdVerificationScreen(),
          );
        },
      ),
      _ServiceItem(
        title: 'SIM Services',
        icon: Icons.sim_card_outlined,
        onTap: () {
          openPage(
            const ServiceFeatureScreen(
              title: 'SIM Registration Service',
              icon: Icons.sim_card_outlined,
              description:
                  'Start SIM registration and access supported SIM-related services.',
            ),
          );
        },
      ),
    ];
  }

  List<_ServiceItem> filterServices(
    List<_ServiceItem> services,
  ) {
    final query = searchQuery.trim().toLowerCase();

    if (query.isEmpty) {
      return services;
    }

    return services.where((service) {
      return service.title.toLowerCase().contains(query);
    }).toList();
  }

  Widget buildServiceGrid(
    List<_ServiceItem> services,
    int crossAxisCount,
  ) {
    if (services.isEmpty) {
      return Container(
        width: double.infinity,
        padding: const EdgeInsets.symmetric(
          vertical: 28,
          horizontal: 18,
        ),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(18),
          border: Border.all(
            color: cardBorderColor,
          ),
        ),
        child: const Column(
          children: [
            Icon(
              Icons.search_off_rounded,
              size: 42,
              color: Colors.grey,
            ),
            SizedBox(height: 8),
            Text(
              'No matching service found',
              style: TextStyle(
                color: Colors.grey,
                fontWeight: FontWeight.w600,
              ),
            ),
          ],
        ),
      );
    }

    return GridView.builder(
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      itemCount: services.length,
      gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
        crossAxisCount: crossAxisCount,
        mainAxisSpacing: 10,
        crossAxisSpacing: 10,
        childAspectRatio: 0.88,
      ),
      itemBuilder: (context, index) {
        final service = services[index];

        return _ServiceCard(
          service: service,
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    final filteredPopularServices =
        filterServices(popularServices);

    final filteredMoreServices =
        filterServices(moreServices);

    final searching = searchQuery.trim().isNotEmpty;

    return Scaffold(
      backgroundColor: backgroundColor,
      appBar: AppBar(
        toolbarHeight: 58,
        elevation: 0,
        backgroundColor: primaryGreen,
        foregroundColor: Colors.white,
        titleSpacing: 16,
        title: const Row(
          children: [
            _ServicepayLogo(),
            SizedBox(width: 10),
            Text(
              'Servicepay',
              style: TextStyle(
                fontSize: 23,
                fontWeight: FontWeight.w800,
                letterSpacing: -0.5,
              ),
            ),
          ],
        ),
        actions: [
          IconButton(
            tooltip: 'Refresh',
            onPressed: loadUserDetails,
            icon: const Icon(
              Icons.refresh_rounded,
            ),
          ),
          Padding(
            padding: const EdgeInsets.only(
              right: 8,
            ),
            child: Stack(
              clipBehavior: Clip.none,
              children: [
                IconButton(
                  tooltip: 'Notifications',
                  onPressed: () {
                    openPage(
                      const NotificationsScreen(),
                    );
                  },
                  icon: const Icon(
                    Icons.notifications_none_rounded,
                    size: 27,
                  ),
                ),
                if (unreadNotifications > 0)
                  Positioned(
                    right: 5,
                    top: 5,
                    child: Container(
                      constraints: const BoxConstraints(
                        minWidth: 18,
                        minHeight: 18,
                      ),
                      padding: const EdgeInsets.symmetric(
                        horizontal: 4,
                      ),
                      decoration: BoxDecoration(
                        color: Colors.red,
                        borderRadius:
                            BorderRadius.circular(20),
                        border: Border.all(
                          color: primaryGreen,
                          width: 2,
                        ),
                      ),
                      alignment: Alignment.center,
                      child: Text(
                        unreadNotifications > 9
                            ? '9+'
                            : unreadNotifications.toString(),
                        style: const TextStyle(
                          color: Colors.white,
                          fontSize: 9,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                    ),
                  ),
              ],
            ),
          ),
        ],
      ),
      body: isLoading
          ? const Center(
              child: CircularProgressIndicator(
                color: primaryGreen,
              ),
            )
          : RefreshIndicator(
              color: primaryGreen,
              onRefresh: loadUserDetails,
              child: LayoutBuilder(
                builder: (context, constraints) {
                  final width = constraints.maxWidth;

                  int crossAxisCount = 4;

                  if (width >= 1100) {
                    crossAxisCount = 8;
                  } else if (width >= 850) {
                    crossAxisCount = 7;
                  } else if (width >= 650) {
                    crossAxisCount = 6;
                  } else if (width >= 500) {
                    crossAxisCount = 5;
                  }

                  return SingleChildScrollView(
                    physics:
                        const AlwaysScrollableScrollPhysics(),
                    padding: const EdgeInsets.fromLTRB(
                      14,
                      12,
                      14,
                      24,
                    ),
                    child: Center(
                      child: ConstrainedBox(
                        constraints: const BoxConstraints(
                          maxWidth: 1100,
                        ),
                        child: Column(
                          crossAxisAlignment:
                              CrossAxisAlignment.start,
                          children: [
                            _WelcomeHeader(
                              firstName: firstName,
                            ),
                            const SizedBox(height: 12),

                            TweenAnimationBuilder<double>(
                              tween: Tween(
                                begin: 0.94,
                                end: 1,
                              ),
                              duration: const Duration(
                                milliseconds: 450,
                              ),
                              curve: Curves.easeOutBack,
                              builder: (
                                context,
                                animationValue,
                                child,
                              ) {
                                return Transform.scale(
                                  scale: animationValue,
                                  child: child,
                                );
                              },
                              child: _WalletCard(
                                balance: balance,
                                hideBalance: hideBalance,
                                onToggleBalance: () {
                                  setState(() {
                                    hideBalance =
                                        !hideBalance;
                                  });
                                },
                                onFundWallet: () {
                                  openPage(
                                    const WalletScreen(),
                                  );
                                },
                                onTransfer: () {
                                  openPage(
                                    const TransferScreen(),
                                  );
                                },
                                onTransactions:
                                    openTransactionsMessage,
                              ),
                            ),

                            const SizedBox(height: 12),

                            _SearchBox(
                              controller: searchController,
                              onChanged: (value) {
                                setState(() {
                                  searchQuery = value;
                                });
                              },
                              onClear: () {
                                searchController.clear();

                                setState(() {
                                  searchQuery = '';
                                });
                              },
                            ),

                            const SizedBox(height: 14),

                            _QuickActions(
                              onFundWallet: () {
                                openPage(
                                  const WalletScreen(),
                                );
                              },
                              onTransfer: () {
                                openPage(
                                  const TransferScreen(),
                                );
                              },
                              onTransactions:
                                  openTransactionsMessage,
                              onVerifyId: () {
                                openPage(
                                  const IdVerificationScreen(),
                                );
                              },
                            ),

                            const SizedBox(height: 14),

                            const _PromoBanner(),

                            const SizedBox(height: 18),

                            _SectionHeader(
                              title: searching
                                  ? 'Search Results'
                                  : 'Popular Services',
                              subtitle: searching
                                  ? '${filteredPopularServices.length + filteredMoreServices.length} found'
                                  : 'Frequently used',
                            ),

                            const SizedBox(height: 10),

                            if (searching)
                              buildServiceGrid(
                                [
                                  ...filteredPopularServices,
                                  ...filteredMoreServices,
                                ],
                                crossAxisCount,
                              )
                            else
                              buildServiceGrid(
                                filteredPopularServices,
                                crossAxisCount,
                              ),

                            if (!searching) ...[
                              const SizedBox(height: 18),

                              _SectionHeader(
                                title: 'More Services',
                                subtitle: showMoreServices
                                    ? 'Hide services'
                                    : 'View all',
                                onTap: () {
                                  setState(() {
                                    showMoreServices =
                                        !showMoreServices;
                                  });
                                },
                              ),

                              const SizedBox(height: 10),

                              AnimatedCrossFade(
                                duration: const Duration(
                                  milliseconds: 300,
                                ),
                                crossFadeState:
                                    showMoreServices
                                        ? CrossFadeState
                                            .showSecond
                                        : CrossFadeState
                                            .showFirst,
                                firstChild:
                                    _MoreServicesPreview(
                                  services: moreServices,
                                  onViewAll: () {
                                    setState(() {
                                      showMoreServices = true;
                                    });
                                  },
                                ),
                                secondChild: buildServiceGrid(
                                  moreServices,
                                  crossAxisCount,
                                ),
                              ),
                            ],
                          ],
                        ),
                      ),
                    ),
                  );
                },
              ),
            ),
    );
  }
}

class _ServicepayLogo extends StatelessWidget {
  const _ServicepayLogo();

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 34,
      height: 34,
      decoration: BoxDecoration(
        color: Colors.white.withValues(
          alpha: 0.18,
        ),
        borderRadius: BorderRadius.circular(11),
      ),
      alignment: Alignment.center,
      child: const Text(
        'S',
        style: TextStyle(
          color: Colors.white,
          fontSize: 21,
          fontWeight: FontWeight.w900,
        ),
      ),
    );
  }
}

class _WelcomeHeader extends StatelessWidget {
  final String firstName;

  const _WelcomeHeader({
    required this.firstName,
  });

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Expanded(
          child: Column(
            crossAxisAlignment:
                CrossAxisAlignment.start,
            children: [
              const Text(
                'Welcome back',
                style: TextStyle(
                  color: Color(0xFF7C847E),
                  fontSize: 13,
                  fontWeight: FontWeight.w500,
                ),
              ),
              const SizedBox(height: 2),
              Text(
                firstName,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  color: Color(0xFF171A18),
                  fontSize: 21,
                  fontWeight: FontWeight.w800,
                ),
              ),
            ],
          ),
        ),
        Container(
          width: 42,
          height: 42,
          decoration: BoxDecoration(
            color: const Color(0xFFE8F5E9),
            shape: BoxShape.circle,
            border: Border.all(
              color: const Color(0xFFC8E6C9),
            ),
          ),
          child: const Icon(
            Icons.person_outline_rounded,
            color: _DashboardScreenState.primaryGreen,
          ),
        ),
      ],
    );
  }
}

class _WalletCard extends StatelessWidget {
  final double balance;
  final bool hideBalance;

  final VoidCallback onToggleBalance;
  final VoidCallback onFundWallet;
  final VoidCallback onTransfer;
  final VoidCallback onTransactions;

  const _WalletCard({
    required this.balance,
    required this.hideBalance,
    required this.onToggleBalance,
    required this.onFundWallet,
    required this.onTransfer,
    required this.onTransactions,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.fromLTRB(
        18,
        15,
        15,
        14,
      ),
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          colors: [
            _DashboardScreenState.primaryGreen,
            _DashboardScreenState.secondaryGreen,
          ],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        borderRadius: BorderRadius.circular(22),
        boxShadow: [
          BoxShadow(
            color: _DashboardScreenState.primaryGreen
                .withValues(
              alpha: 0.22,
            ),
            blurRadius: 18,
            offset: const Offset(0, 8),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment:
            CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Text(
                'Wallet Balance',
                style: TextStyle(
                  color: Colors.white70,
                  fontSize: 13,
                  fontWeight: FontWeight.w500,
                ),
              ),
              const SizedBox(width: 5),
              InkWell(
                onTap: onToggleBalance,
                borderRadius: BorderRadius.circular(20),
                child: Padding(
                  padding: const EdgeInsets.all(4),
                  child: Icon(
                    hideBalance
                        ? Icons.visibility_off_outlined
                        : Icons.visibility_outlined,
                    color: Colors.white70,
                    size: 18,
                  ),
                ),
              ),
              const Spacer(),
              Container(
                width: 38,
                height: 38,
                decoration: BoxDecoration(
                  color: Colors.white.withValues(
                    alpha: 0.16,
                  ),
                  shape: BoxShape.circle,
                ),
                child: const Icon(
                  Icons.account_balance_wallet_rounded,
                  color: Colors.white,
                  size: 21,
                ),
              ),
            ],
          ),
          const SizedBox(height: 2),
          FittedBox(
            fit: BoxFit.scaleDown,
            alignment: Alignment.centerLeft,
            child: Text(
              hideBalance
                  ? '₦ ••••••'
                  : '₦${balance.toStringAsFixed(2)}',
              style: const TextStyle(
                color: Colors.white,
                fontSize: 30,
                fontWeight: FontWeight.w900,
                letterSpacing: -0.7,
              ),
            ),
          ),
          const SizedBox(height: 13),
          Row(
            children: [
              Expanded(
                child: _WalletButton(
                  icon: Icons.add_rounded,
                  label: 'Fund',
                  onTap: onFundWallet,
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: _WalletButton(
                  icon: Icons.send_rounded,
                  label: 'Transfer',
                  onTap: onTransfer,
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: _WalletButton(
                  icon: Icons.receipt_long_outlined,
                  label: 'History',
                  onTap: onTransactions,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _WalletButton extends StatelessWidget {
  final IconData icon;
  final String label;
  final VoidCallback onTap;

  const _WalletButton({
    required this.icon,
    required this.label,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.white.withValues(
        alpha: 0.96,
      ),
      borderRadius: BorderRadius.circular(12),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(12),
        child: Padding(
          padding: const EdgeInsets.symmetric(
            horizontal: 5,
            vertical: 9,
          ),
          child: Row(
            mainAxisAlignment:
                MainAxisAlignment.center,
            children: [
              Icon(
                icon,
                size: 16,
                color:
                    _DashboardScreenState.primaryGreen,
              ),
              const SizedBox(width: 4),
              Flexible(
                child: Text(
                  label,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color:
                        _DashboardScreenState.primaryGreen,
                    fontSize: 11.5,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _SearchBox extends StatelessWidget {
  final TextEditingController controller;
  final ValueChanged<String> onChanged;
  final VoidCallback onClear;

  const _SearchBox({
    required this.controller,
    required this.onChanged,
    required this.onClear,
  });

  @override
  Widget build(BuildContext context) {
    return TextField(
      controller: controller,
      onChanged: onChanged,
      textInputAction: TextInputAction.search,
      decoration: InputDecoration(
        hintText: 'Search services...',
        hintStyle: const TextStyle(
          color: Color(0xFF979D99),
          fontSize: 14,
        ),
        prefixIcon: const Icon(
          Icons.search_rounded,
          color: _DashboardScreenState.primaryGreen,
        ),
        suffixIcon: controller.text.isEmpty
            ? null
            : IconButton(
                onPressed: onClear,
                icon: const Icon(
                  Icons.close_rounded,
                ),
              ),
        filled: true,
        fillColor: Colors.white,
        contentPadding: const EdgeInsets.symmetric(
          vertical: 13,
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(16),
          borderSide: const BorderSide(
            color:
                _DashboardScreenState.cardBorderColor,
          ),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(16),
          borderSide: const BorderSide(
            color:
                _DashboardScreenState.primaryGreen,
            width: 1.4,
          ),
        ),
      ),
    );
  }
}

class _QuickActions extends StatelessWidget {
  final VoidCallback onFundWallet;
  final VoidCallback onTransfer;
  final VoidCallback onTransactions;
  final VoidCallback onVerifyId;

  const _QuickActions({
    required this.onFundWallet,
    required this.onTransfer,
    required this.onTransactions,
    required this.onVerifyId,
  });

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Expanded(
          child: _QuickActionButton(
            icon: Icons.add_card_rounded,
            label: 'Fund',
            onTap: onFundWallet,
          ),
        ),
        const SizedBox(width: 8),
        Expanded(
          child: _QuickActionButton(
            icon: Icons.send_rounded,
            label: 'Transfer',
            onTap: onTransfer,
          ),
        ),
        const SizedBox(width: 8),
        Expanded(
          child: _QuickActionButton(
            icon: Icons.history_rounded,
            label: 'History',
            onTap: onTransactions,
          ),
        ),
        const SizedBox(width: 8),
        Expanded(
          child: _QuickActionButton(
            icon: Icons.verified_user_outlined,
            label: 'Verify ID',
            onTap: onVerifyId,
          ),
        ),
      ],
    );
  }
}

class _QuickActionButton extends StatelessWidget {
  final IconData icon;
  final String label;
  final VoidCallback onTap;

  const _QuickActionButton({
    required this.icon,
    required this.label,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.white,
      borderRadius: BorderRadius.circular(15),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(15),
        child: Container(
          padding: const EdgeInsets.symmetric(
            vertical: 11,
            horizontal: 3,
          ),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(15),
            border: Border.all(
              color:
                  _DashboardScreenState.cardBorderColor,
            ),
          ),
          child: Column(
            children: [
              Container(
                width: 34,
                height: 34,
                decoration: BoxDecoration(
                  color: const Color(0xFFE8F5E9),
                  borderRadius: BorderRadius.circular(11),
                ),
                child: Icon(
                  icon,
                  size: 19,
                  color:
                      _DashboardScreenState.primaryGreen,
                ),
              ),
              const SizedBox(height: 6),
              Text(
                label,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  color: Color(0xFF252925),
                  fontSize: 10.5,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _PromoBanner extends StatelessWidget {
  const _PromoBanner();

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(
        horizontal: 14,
        vertical: 12,
      ),
      decoration: BoxDecoration(
        color: const Color(0xFFFFF8E1),
        borderRadius: BorderRadius.circular(17),
        border: Border.all(
          color: const Color(0xFFFFECB3),
        ),
      ),
      child: const Row(
        children: [
          CircleAvatar(
            radius: 19,
            backgroundColor: Color(0xFFFFECB3),
            child: Icon(
              Icons.card_giftcard_rounded,
              color: Color(0xFFF57F17),
              size: 20,
            ),
          ),
          SizedBox(width: 11),
          Expanded(
            child: Column(
              crossAxisAlignment:
                  CrossAxisAlignment.start,
              children: [
                Text(
                  'Enjoy fast digital payments',
                  style: TextStyle(
                    color: Color(0xFF4A3B00),
                    fontSize: 13,
                    fontWeight: FontWeight.w800,
                  ),
                ),
                SizedBox(height: 2),
                Text(
                  'Pay bills and access everyday services in one place.',
                  style: TextStyle(
                    color: Color(0xFF766526),
                    fontSize: 11.5,
                  ),
                ),
              ],
            ),
          ),
          Icon(
            Icons.arrow_forward_ios_rounded,
            color: Color(0xFFF57F17),
            size: 15,
          ),
        ],
      ),
    );
  }
}

class _SectionHeader extends StatelessWidget {
  final String title;
  final String subtitle;
  final VoidCallback? onTap;

  const _SectionHeader({
    required this.title,
    required this.subtitle,
    this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Text(
          title,
          style: const TextStyle(
            color: Color(0xFF181B19),
            fontSize: 18,
            fontWeight: FontWeight.w800,
          ),
        ),
        const Spacer(),
        InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(20),
          child: Padding(
            padding: const EdgeInsets.symmetric(
              horizontal: 5,
              vertical: 4,
            ),
            child: Text(
              subtitle,
              style: const TextStyle(
                color:
                    _DashboardScreenState.primaryGreen,
                fontSize: 12,
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
        ),
      ],
    );
  }
}

class _ServiceCard extends StatelessWidget {
  final _ServiceItem service;

  const _ServiceCard({
    required this.service,
  });

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.white,
      borderRadius: BorderRadius.circular(16),
      child: InkWell(
        onTap: service.onTap,
        borderRadius: BorderRadius.circular(16),
        splashColor: _DashboardScreenState.primaryGreen
            .withValues(
          alpha: 0.10,
        ),
        child: Container(
          padding: const EdgeInsets.symmetric(
            horizontal: 4,
            vertical: 9,
          ),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(16),
            border: Border.all(
              color:
                  _DashboardScreenState.cardBorderColor,
            ),
            boxShadow: [
              BoxShadow(
                color: Colors.black.withValues(
                  alpha: 0.035,
                ),
                blurRadius: 6,
                offset: const Offset(0, 3),
              ),
            ],
          ),
          child: Column(
            mainAxisAlignment:
                MainAxisAlignment.center,
            children: [
              Container(
                width: 41,
                height: 41,
                decoration: BoxDecoration(
                  color: const Color(0xFFE8F5E9),
                  borderRadius: BorderRadius.circular(13),
                ),
                child: Icon(
                  service.icon,
                  size: 23,
                  color:
                      _DashboardScreenState.primaryGreen,
                ),
              ),
              const SizedBox(height: 7),
              Text(
                service.title,
                textAlign: TextAlign.center,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  color: Color(0xFF202420),
                  fontSize: 11,
                  height: 1.15,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _MoreServicesPreview extends StatelessWidget {
  final List<_ServiceItem> services;
  final VoidCallback onViewAll;

  const _MoreServicesPreview({
    required this.services,
    required this.onViewAll,
  });

  @override
  Widget build(BuildContext context) {
    final previewServices = services.take(4).toList();

    return Row(
      children: [
        for (int index = 0;
            index < previewServices.length;
            index++) ...[
          Expanded(
            child: _ServiceCard(
              service: previewServices[index],
            ),
          ),
          if (index < previewServices.length - 1)
            const SizedBox(width: 10),
        ],
      ],
    );
  }
}

class _ServiceItem {
  final String title;
  final IconData icon;
  final VoidCallback onTap;

  const _ServiceItem({
    required this.title,
    required this.icon,
    required this.onTap,
  });
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
    const primaryGreen = Color(0xFF2E7D32);

    return Scaffold(
      backgroundColor: const Color(0xFFF8FAFC),
      appBar: AppBar(
        backgroundColor: primaryGreen,
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
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(
              maxWidth: 650,
            ),
            child: Column(
              children: [
                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.all(28),
                  decoration: BoxDecoration(
                    gradient: const LinearGradient(
                      colors: [
                        Color(0xFF2E7D32),
                        Color(0xFF43A047),
                      ],
                    ),
                    borderRadius: BorderRadius.circular(22),
                  ),
                  child: Column(
                    children: [
                      Container(
                        width: 88,
                        height: 88,
                        decoration: BoxDecoration(
                          color: Colors.white.withValues(
                            alpha: 0.18,
                          ),
                          shape: BoxShape.circle,
                        ),
                        child: Icon(
                          icon,
                          size: 46,
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
                    border: Border.all(
                      color: const Color(0xFFE8ECE8),
                    ),
                  ),
                  child: Column(
                    children: [
                      Icon(
                        icon,
                        size: 52,
                        color: primaryGreen,
                      ),
                      const SizedBox(height: 15),
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
                        height: 50,
                        child: ElevatedButton.icon(
                          onPressed: () {
                            Navigator.pop(context);
                          },
                          icon: const Icon(
                            Icons.arrow_back_rounded,
                          ),
                          label: const Text(
                            'Back to Dashboard',
                            style: TextStyle(
                              fontWeight: FontWeight.bold,
                            ),
                          ),
                          style: ElevatedButton.styleFrom(
                            backgroundColor: primaryGreen,
                            foregroundColor: Colors.white,
                            shape: RoundedRectangleBorder(
                              borderRadius:
                                  BorderRadius.circular(14),
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
        ),
      ),
    );
  }
}
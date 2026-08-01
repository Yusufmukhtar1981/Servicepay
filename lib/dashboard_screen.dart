import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
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
import 'transactions_screen.dart';
import 'transfer_screen.dart';
import 'wallet_screen.dart';

class DashboardScreen extends StatefulWidget {
  const DashboardScreen({super.key});

  @override
  State<DashboardScreen> createState() => _DashboardScreenState();
}

class _DashboardScreenState extends State<DashboardScreen> {
  static const String baseUrl = 'https://api.servicepay.ng/api';

  static const Color primaryGreen = Color(0xFF08783E);
  static const Color softGreen = Color(0xFFEAF7F0);

  final TextEditingController searchController = TextEditingController();

  String userName = 'Customer';
  double walletBalance = 0;

  int unreadNotifications = 1;

  bool isLoading = true;
  bool isRefreshing = false;
  bool hideBalance = false;

  String searchQuery = '';

  @override
  void initState() {
    super.initState();
    loadDashboard();
  }

  @override
  void dispose() {
    searchController.dispose();
    super.dispose();
  }

  Future<String?> getSavedAuthToken(
    SharedPreferences preferences,
  ) async {
    const List<String> tokenKeys = [
      'auth_token',
      'token',
      'access_token',
      'accessToken',
      'jwt_token',
      'jwt',
    ];

    for (final String key in tokenKeys) {
      final String? value = preferences.getString(key);

      if (value == null || value.trim().isEmpty) {
        continue;
      }

      String token = value.trim();

      if (token.toLowerCase().startsWith(
            'bearer ',
          )) {
        token = token.substring(7).trim();
      }

      if (token.isNotEmpty) {
        return token;
      }
    }

    return null;
  }

  Future<void> loadDashboard({
    bool refreshing = false,
  }) async {
    if (mounted) {
      setState(() {
        if (refreshing) {
          isRefreshing = true;
        } else {
          isLoading = true;
        }
      });
    }

    try {
      final SharedPreferences preferences =
          await SharedPreferences.getInstance();

      final String savedName = preferences.getString('user_name') ??
          preferences.getString('full_name') ??
          preferences.getString('name') ??
          'Customer';

      final double savedBalance = preferences.getDouble('wallet_balance') ?? 0;

      if (mounted) {
        setState(() {
          userName = savedName.trim().isEmpty ? 'Customer' : savedName.trim();

          walletBalance = savedBalance;
        });
      }

      final String? token = await getSavedAuthToken(preferences);

      if (token == null || token.isEmpty) {
        return;
      }

      final http.Response response = await http.get(
        Uri.parse('$baseUrl/wallet'),
        headers: {
          'Accept': 'application/json',
          'Authorization': 'Bearer $token',
        },
      ).timeout(
        const Duration(seconds: 30),
      );

      if (response.statusCode != 200) {
        return;
      }

      final dynamic decoded = jsonDecode(response.body);

      if (decoded is! Map) {
        return;
      }

      final Map<String, dynamic> data = Map<String, dynamic>.from(decoded);

      dynamic rawBalance = data['walletBalance'] ?? data['balance'];

      if (data['data'] is Map) {
        final Map<String, dynamic> nested = Map<String, dynamic>.from(
          data['data'] as Map,
        );

        rawBalance ??= nested['walletBalance'] ?? nested['balance'];
      }

      final double freshBalance = rawBalance is num
          ? rawBalance.toDouble()
          : double.tryParse(
                rawBalance?.toString() ?? '',
              ) ??
              walletBalance;

      await preferences.setDouble(
        'wallet_balance',
        freshBalance,
      );

      if (mounted) {
        setState(() {
          walletBalance = freshBalance;
        });
      }
    } catch (_) {
      // Keep locally saved dashboard values.
    } finally {
      if (mounted) {
        setState(() {
          isLoading = false;
          isRefreshing = false;
        });
      }
    }
  }

  String firstName() {
    final String trimmed = userName.trim();

    if (trimmed.isEmpty) {
      return 'Customer';
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

  void showBankTransferNotice() {
    showModalBottomSheet<void>(
      context: context,
      showDragHandle: true,
      builder: (BuildContext context) {
        return Padding(
          padding: const EdgeInsets.fromLTRB(
            22,
            8,
            22,
            30,
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: 64,
                height: 64,
                decoration: const BoxDecoration(
                  color: softGreen,
                  shape: BoxShape.circle,
                ),
                child: const Icon(
                  Icons.account_balance_rounded,
                  size: 32,
                  color: primaryGreen,
                ),
              ),
              const SizedBox(height: 16),
              const Text(
                'Bank Transfer',
                style: TextStyle(
                  fontSize: 21,
                  fontWeight: FontWeight.w900,
                ),
              ),
              const SizedBox(height: 8),
              const Text(
                'Bank Transfer is being prepared. '
                'It will become available after '
                'final security and provider checks.',
                textAlign: TextAlign.center,
                style: TextStyle(
                  color: Color(0xFF667085),
                  height: 1.45,
                ),
              ),
              const SizedBox(height: 20),
              SizedBox(
                width: double.infinity,
                height: 50,
                child: FilledButton(
                  onPressed: () {
                    Navigator.pop(context);
                  },
                  style: FilledButton.styleFrom(
                    backgroundColor: primaryGreen,
                  ),
                  child: const Text('Okay'),
                ),
              ),
            ],
          ),
        );
      },
    );
  }

  List<_DashboardService> popularServices() {
    return [
      _DashboardService(
        title: 'Airtime',
        icon: Icons.phone_android_rounded,
        iconColor: const Color(0xFF08783E),
        backgroundColor: const Color(0xFFEAF7F0),
        keywords: 'airtime recharge phone',
        onTap: () {
          openScreen(const AirtimeScreen());
        },
      ),
      _DashboardService(
        title: 'Data',
        icon: Icons.signal_cellular_alt_rounded,
        iconColor: const Color(0xFF08783E),
        backgroundColor: const Color(0xFFF0F7FF),
        keywords: 'data internet bundle',
        onTap: () {
          openScreen(const DataScreen());
        },
      ),
      _DashboardService(
        title: 'Electricity',
        icon: Icons.lightbulb_rounded,
        iconColor: const Color(0xFFF59E0B),
        backgroundColor: const Color(0xFFFFF7DF),
        keywords: 'electricity power light bill',
        onTap: () {
          openScreen(const ElectricityScreen());
        },
      ),
      _DashboardService(
        title: 'Cable TV',
        icon: Icons.live_tv_rounded,
        iconColor: const Color(0xFF08783E),
        backgroundColor: const Color(0xFFEAF7F0),
        keywords: 'cable tv dstv gotv startimes',
        onTap: () {
          openScreen(const CableScreen());
        },
      ),
      _DashboardService(
        title: 'Exam PIN',
        icon: Icons.workspace_premium_rounded,
        iconColor: const Color(0xFF08783E),
        backgroundColor: const Color(0xFFEAF7F0),
        keywords: 'exam pin waec neco jamb',
        onTap: () {
          openScreen(const ExamPinScreen());
        },
      ),
    ];
  }

  List<_DashboardService> moreServices() {
    return [
      _DashboardService(
        title: 'NIN Verification',
        icon: Icons.fingerprint_rounded,
        iconColor: const Color(0xFF08783E),
        backgroundColor: const Color(0xFFEAF7F0),
        keywords: 'nin verification identity',
        onTap: () {
          openScreen(
            const IdVerificationScreen(),
          );
        },
      ),
      _DashboardService(
        title: 'Delivery',
        icon: Icons.local_shipping_rounded,
        iconColor: const Color(0xFF08783E),
        backgroundColor: const Color(0xFFEAF7F0),
        keywords: 'delivery logistics courier',
        onTap: () {
          openScreen(const LogisticsScreen());
        },
      ),
      _DashboardService(
        title: 'Flight Booking',
        icon: Icons.flight_takeoff_rounded,
        iconColor: const Color(0xFF08783E),
        backgroundColor: const Color(0xFFEAF7F0),
        keywords: 'flight booking airline travel',
        onTap: () {
          openScreen(
            const FlightBookingScreen(),
          );
        },
      ),
    ];
  }

  List<_DashboardService> filtered(
    List<_DashboardService> services,
  ) {
    final String query = searchQuery.trim().toLowerCase();

    if (query.isEmpty) {
      return services;
    }

    return services.where(
      (_DashboardService service) {
        final String searchable =
            '${service.title} ${service.keywords}'.toLowerCase();

        return searchable.contains(query);
      },
    ).toList();
  }

  Widget buildHeader() {
    return Column(
      children: [
        Row(
          children: [
            Container(
              width: 42,
              height: 42,
              decoration: BoxDecoration(
                gradient: const LinearGradient(
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                  colors: [
                    Color(0xFF12A85B),
                    Color(0xFF006837),
                  ],
                ),
                borderRadius: BorderRadius.circular(15),
                boxShadow: const [
                  BoxShadow(
                    color: Color(0x3308783E),
                    blurRadius: 14,
                    offset: Offset(0, 7),
                  ),
                ],
              ),
              child: const Center(
                child: Text(
                  'S',
                  style: TextStyle(
                    color: Colors.white,
                    fontSize: 25,
                    fontWeight: FontWeight.w900,
                    fontStyle: FontStyle.italic,
                  ),
                ),
              ),
            ),
            const SizedBox(width: 11),
            const Expanded(
              child: Text(
                'ServicePay',
                style: TextStyle(
                  color: Color(0xFF064E2F),
                  fontSize: 21,
                  fontWeight: FontWeight.w900,
                  letterSpacing: -0.7,
                ),
              ),
            ),
            Stack(
              clipBehavior: Clip.none,
              children: [
                IconButton(
                  onPressed: () {
                    openScreen(
                      const NotificationsScreen(),
                    );
                  },
                  style: IconButton.styleFrom(
                    backgroundColor: const Color(0xFFEAF7F0),
                    foregroundColor: primaryGreen,
                    minimumSize: const Size(45, 45),
                  ),
                  icon: const Icon(
                    Icons.notifications_none_rounded,
                    size: 25,
                  ),
                ),
                if (unreadNotifications > 0)
                  Positioned(
                    right: -1,
                    top: -4,
                    child: Container(
                      constraints: const BoxConstraints(
                        minWidth: 20,
                        minHeight: 20,
                      ),
                      padding: const EdgeInsets.symmetric(
                        horizontal: 5,
                      ),
                      alignment: Alignment.center,
                      decoration: const BoxDecoration(
                        color: Color(0xFF16A34A),
                        shape: BoxShape.circle,
                      ),
                      child: Text(
                        unreadNotifications > 9 ? '9+' : '$unreadNotifications',
                        style: const TextStyle(
                          color: Colors.white,
                          fontSize: 10,
                          fontWeight: FontWeight.w900,
                        ),
                      ),
                    ),
                  ),
              ],
            ),
          ],
        ),
        const SizedBox(height: 13),
        Row(
          children: [
            Container(
              width: 46,
              height: 46,
              decoration: const BoxDecoration(
                color: primaryGreen,
                shape: BoxShape.circle,
              ),
              child: Center(
                child: Text(
                  firstName().substring(0, 1).toUpperCase(),
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 19,
                    fontWeight: FontWeight.w900,
                  ),
                ),
              ),
            ),
            const SizedBox(width: 13),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'Hello, ${firstName()}',
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      color: Color(0xFF101828),
                      fontSize: 19,
                      fontWeight: FontWeight.w900,
                      letterSpacing: -0.5,
                    ),
                  ),
                  const SizedBox(height: 3),
                  const Text(
                    'Welcome back! Glad to see you.',
                    style: TextStyle(
                      color: Color(0xFF667085),
                      fontSize: 13,
                    ),
                  ),
                ],
              ),
            ),
            Container(
              padding: const EdgeInsets.symmetric(
                horizontal: 12,
                vertical: 9,
              ),
              decoration: BoxDecoration(
                color: const Color(0xFFEAF7F0),
                borderRadius: BorderRadius.circular(25),
              ),
              child: const Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(
                    Icons.verified_user_outlined,
                    color: primaryGreen,
                    size: 18,
                  ),
                  SizedBox(width: 6),
                  Text(
                    'Verified',
                    style: TextStyle(
                      color: primaryGreen,
                      fontSize: 12,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ],
    );
  }

  Widget buildWalletCard() {
    return Container(
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(27),
        gradient: const LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [
            Color(0xFF00482C),
            Color(0xFF08783E),
            Color(0xFF12A85B),
          ],
        ),
        boxShadow: const [
          BoxShadow(
            color: Color(0x38004E2C),
            blurRadius: 28,
            offset: Offset(0, 14),
          ),
        ],
      ),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(27),
        child: Stack(
          children: [
            Positioned(
              right: -50,
              top: -58,
              child: Container(
                width: 220,
                height: 220,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  border: Border.all(
                    color: Colors.white.withValues(
                      alpha: 0.07,
                    ),
                    width: 27,
                  ),
                ),
              ),
            ),
            Positioned(
              right: 20,
              top: 42,
              child: Container(
                width: 88,
                height: 76,
                decoration: BoxDecoration(
                  color: Colors.white.withValues(
                    alpha: 0.12,
                  ),
                  borderRadius: BorderRadius.circular(24),
                  border: Border.all(
                    color: Colors.white.withValues(
                      alpha: 0.15,
                    ),
                  ),
                ),
                child: Stack(
                  alignment: Alignment.center,
                  children: [
                    const Positioned(
                      right: 13,
                      top: 17,
                      child: Icon(
                        Icons.credit_card_rounded,
                        color: Color(0xFFB9F5D1),
                        size: 54,
                      ),
                    ),
                    Positioned(
                      left: 8,
                      bottom: 5,
                      child: Container(
                        width: 43,
                        height: 43,
                        decoration: const BoxDecoration(
                          color: Color(0xFFEAF7F0),
                          shape: BoxShape.circle,
                        ),
                        child: const Icon(
                          Icons.verified_user_rounded,
                          color: primaryGreen,
                          size: 25,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(
                19,
                18,
                19,
                16,
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      const Text(
                        'Wallet Balance',
                        style: TextStyle(
                          color: Color(0xFFD9F7E6),
                          fontSize: 15,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                      const SizedBox(width: 8),
                      InkWell(
                        onTap: () {
                          setState(() {
                            hideBalance = !hideBalance;
                          });
                        },
                        borderRadius: BorderRadius.circular(30),
                        child: Padding(
                          padding: const EdgeInsets.all(4),
                          child: Icon(
                            hideBalance
                                ? Icons.visibility_off_outlined
                                : Icons.visibility_outlined,
                            color: Colors.white,
                            size: 22,
                          ),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 15),
                  SizedBox(
                    width: 205,
                    child: Text(
                      hideBalance ? '₦ ••••••••' : formatMoney(walletBalance),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: Colors.white,
                        fontSize: 30,
                        fontWeight: FontWeight.w900,
                        letterSpacing: -1.4,
                      ),
                    ),
                  ),
                  const SizedBox(height: 15),
                  Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 11,
                      vertical: 7,
                    ),
                    decoration: BoxDecoration(
                      color: Colors.white.withValues(
                        alpha: 0.10,
                      ),
                      borderRadius: BorderRadius.circular(30),
                      border: Border.all(
                        color: Colors.white.withValues(
                          alpha: 0.18,
                        ),
                      ),
                    ),
                    child: const Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(
                          Icons.shield_outlined,
                          color: Color(0xFFB7F7D2),
                          size: 17,
                        ),
                        SizedBox(width: 6),
                        Text(
                          'Secured & Protected',
                          style: TextStyle(
                            color: Colors.white,
                            fontSize: 12,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 17),
                  Divider(
                    height: 1,
                    color: Colors.white.withValues(
                      alpha: 0.17,
                    ),
                  ),
                  const SizedBox(height: 17),
                  Row(
                    children: [
                      Expanded(
                        child: _WalletAction(
                          icon: Icons.add_circle_outline,
                          label: 'Fund Wallet',
                          onTap: () {
                            openScreen(
                              const WalletScreen(),
                            );
                          },
                        ),
                      ),
                      _walletDivider(),
                      Expanded(
                        child: _WalletAction(
                          icon: Icons.account_balance_rounded,
                          label: 'Bank Transfer',
                          onTap: showBankTransferNotice,
                        ),
                      ),
                      _walletDivider(),
                      Expanded(
                        child: _WalletAction(
                          icon: Icons.send_rounded,
                          label: 'ServicePay Transfer',
                          onTap: () {
                            openScreen(
                              const TransferScreen(),
                            );
                          },
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _walletDivider() {
    return Container(
      width: 1,
      height: 38,
      margin: const EdgeInsets.symmetric(
        horizontal: 6,
      ),
      color: Colors.white.withValues(alpha: 0.16),
    );
  }

  Widget buildSearchBar() {
    return TextField(
      controller: searchController,
      onChanged: (String value) {
        setState(() {
          searchQuery = value;
        });
      },
      decoration: InputDecoration(
        hintText: 'Search services',
        hintStyle: const TextStyle(
          color: Color(0xFF98A2B3),
        ),
        prefixIcon: const Icon(
          Icons.search_rounded,
          color: primaryGreen,
        ),
        suffixIcon: searchQuery.isEmpty
            ? Container(
                margin: const EdgeInsets.all(7),
                decoration: BoxDecoration(
                  color: softGreen,
                  borderRadius: BorderRadius.circular(14),
                ),
                child: const Icon(
                  Icons.tune_rounded,
                  color: primaryGreen,
                ),
              )
            : IconButton(
                onPressed: () {
                  searchController.clear();

                  setState(() {
                    searchQuery = '';
                  });
                },
                icon: const Icon(
                  Icons.close_rounded,
                ),
              ),
        filled: true,
        fillColor: Colors.white,
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(20),
          borderSide: const BorderSide(
            color: Color(0xFFE4E7EC),
          ),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(20),
          borderSide: const BorderSide(
            color: Color(0xFFE4E7EC),
          ),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(20),
          borderSide: const BorderSide(
            color: primaryGreen,
            width: 1.5,
          ),
        ),
        contentPadding: const EdgeInsets.symmetric(
          vertical: 18,
        ),
      ),
    );
  }

  Widget buildQuickActions() {
    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: 10,
        vertical: 17,
      ),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(23),
        border: Border.all(
          color: const Color(0xFFE7EAEF),
        ),
        boxShadow: const [
          BoxShadow(
            color: Color(0x0F101828),
            blurRadius: 16,
            offset: Offset(0, 6),
          ),
        ],
      ),
      child: Row(
        children: [
          Expanded(
            child: _QuickAction(
              icon: Icons.account_balance_wallet_rounded,
              label: 'Fund Wallet',
              onTap: () {
                openScreen(const WalletScreen());
              },
            ),
          ),
          _quickDivider(),
          Expanded(
            child: _QuickAction(
              icon: Icons.account_balance_rounded,
              label: 'Bank Transfer',
              onTap: showBankTransferNotice,
            ),
          ),
          _quickDivider(),
          Expanded(
            child: _QuickAction(
              icon: Icons.receipt_long_rounded,
              label: 'Transactions',
              onTap: () {
                openScreen(
                  const TransactionsScreen(),
                );
              },
            ),
          ),
          _quickDivider(),
          Expanded(
            child: _QuickAction(
              icon: Icons.badge_rounded,
              label: 'Verify ID',
              onTap: () {
                openScreen(
                  const IdVerificationScreen(),
                );
              },
            ),
          ),
        ],
      ),
    );
  }

  Widget _quickDivider() {
    return Container(
      width: 1,
      height: 55,
      color: const Color(0xFFE4E7EC),
    );
  }

  Widget buildPopularServices() {
    final List<_DashboardService> services = filtered(popularServices());

    if (services.isEmpty) {
      return const SizedBox.shrink();
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const _SectionHeader(
          title: 'Popular Services',
        ),
        const SizedBox(height: 13),
        SizedBox(
          height: 108,
          child: ListView.separated(
            scrollDirection: Axis.horizontal,
            itemCount: services.length,
            padding: const EdgeInsets.only(
              right: 3,
            ),
            separatorBuilder: (_, __) => const SizedBox(width: 11),
            itemBuilder: (
              BuildContext context,
              int index,
            ) {
              return SizedBox(
                width: 88,
                child: _PopularServiceCard(
                  service: services[index],
                ),
              );
            },
          ),
        ),
      ],
    );
  }

  Widget buildMoreServices() {
    final List<_DashboardService> services = filtered(moreServices());

    if (services.isEmpty) {
      return const SizedBox.shrink();
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const _SectionHeader(
          title: 'More Services',
        ),
        const SizedBox(height: 12),
        SizedBox(
          height: 105,
          child: ListView.separated(
            scrollDirection: Axis.horizontal,
            itemCount: services.length,
            padding: const EdgeInsets.only(right: 3),
            separatorBuilder: (_, __) => const SizedBox(width: 11),
            itemBuilder: (
              BuildContext context,
              int index,
            ) {
              final _DashboardService service = services[index];

              return Material(
                color: Colors.white,
                borderRadius: BorderRadius.circular(19),
                child: InkWell(
                  onTap: service.onTap,
                  borderRadius: BorderRadius.circular(19),
                  child: Container(
                    width: 145,
                    padding: const EdgeInsets.symmetric(
                      horizontal: 12,
                      vertical: 12,
                    ),
                    decoration: BoxDecoration(
                      borderRadius: BorderRadius.circular(19),
                      border: Border.all(
                        color: const Color(0xFFE7EAEF),
                      ),
                      boxShadow: const [
                        BoxShadow(
                          color: Color(0x0B101828),
                          blurRadius: 12,
                          offset: Offset(0, 4),
                        ),
                      ],
                    ),
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Container(
                          width: 43,
                          height: 43,
                          decoration: BoxDecoration(
                            color: service.backgroundColor,
                            borderRadius: BorderRadius.circular(14),
                          ),
                          child: Icon(
                            service.icon,
                            color: service.iconColor,
                            size: 24,
                          ),
                        ),
                        const SizedBox(height: 8),
                        Text(
                          service.title,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          textAlign: TextAlign.center,
                          style: const TextStyle(
                            color: Color(0xFF1D2939),
                            fontSize: 12,
                            fontWeight: FontWeight.w800,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              );
            },
          ),
        ),
      ],
    );
  }

  Widget buildEmptySearch() {
    if (searchQuery.trim().isEmpty) {
      return const SizedBox.shrink();
    }

    final bool hasPopular = filtered(popularServices()).isNotEmpty;

    final bool hasMore = filtered(moreServices()).isNotEmpty;

    if (hasPopular || hasMore) {
      return const SizedBox.shrink();
    }

    return Container(
      padding: const EdgeInsets.all(28),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(22),
        border: Border.all(
          color: const Color(0xFFE4E7EC),
        ),
      ),
      child: Column(
        children: [
          const Icon(
            Icons.search_off_rounded,
            size: 44,
            color: Color(0xFF98A2B3),
          ),
          const SizedBox(height: 10),
          Text(
            'No service found for “$searchQuery”',
            textAlign: TextAlign.center,
            style: const TextStyle(
              color: Color(0xFF475467),
              fontWeight: FontWeight.w700,
            ),
          ),
        ],
      ),
    );
  }

  Widget buildPromoBanner() {
    return Container(
      constraints: const BoxConstraints(
        minHeight: 122,
      ),
      padding: const EdgeInsets.fromLTRB(
        21,
        20,
        17,
        18,
      ),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(25),
        gradient: const LinearGradient(
          begin: Alignment.centerLeft,
          end: Alignment.centerRight,
          colors: [
            Color(0xFF003A28),
            Color(0xFF00633A),
            Color(0xFF0B8248),
          ],
        ),
        boxShadow: const [
          BoxShadow(
            color: Color(0x2B004E2C),
            blurRadius: 23,
            offset: Offset(0, 11),
          ),
        ],
      ),
      child: Stack(
        children: [
          Positioned(
            right: -22,
            top: -35,
            child: Container(
              width: 150,
              height: 150,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                border: Border.all(
                  color: Colors.white.withValues(
                    alpha: 0.08,
                  ),
                  width: 22,
                ),
              ),
            ),
          ),
          Positioned(
            right: 15,
            bottom: 4,
            child: Transform.rotate(
              angle: -0.12,
              child: Container(
                width: 64,
                height: 86,
                decoration: BoxDecoration(
                  gradient: const LinearGradient(
                    colors: [
                      Color(0xFF14B866),
                      Color(0xFF006837),
                    ],
                  ),
                  borderRadius: BorderRadius.circular(17),
                  border: Border.all(
                    color: Colors.white.withValues(
                      alpha: 0.28,
                    ),
                    width: 2,
                  ),
                  boxShadow: const [
                    BoxShadow(
                      color: Color(0x59000000),
                      blurRadius: 13,
                      offset: Offset(0, 8),
                    ),
                  ],
                ),
                child: const Center(
                  child: Text(
                    'S',
                    style: TextStyle(
                      color: Colors.white,
                      fontSize: 36,
                      fontWeight: FontWeight.w900,
                      fontStyle: FontStyle.italic,
                    ),
                  ),
                ),
              ),
            ),
          ),
          Padding(
            padding: const EdgeInsets.only(
              right: 100,
            ),
            child: const Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Text(
                  'One Platform,',
                  style: TextStyle(
                    color: Colors.white,
                    fontSize: 19,
                    fontWeight: FontWeight.w900,
                    letterSpacing: -0.4,
                  ),
                ),
                Text(
                  'Many Solutions',
                  style: TextStyle(
                    color: Color(0xFF91EE96),
                    fontSize: 19,
                    fontWeight: FontWeight.w900,
                    letterSpacing: -0.5,
                  ),
                ),
                SizedBox(height: 10),
                Text(
                  'Fast. Secure. Reliable.',
                  style: TextStyle(
                    color: Color(0xFFD9F5E4),
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF7F9FB),
      body: SafeArea(
        child: RefreshIndicator(
          color: primaryGreen,
          onRefresh: () {
            return loadDashboard(
              refreshing: true,
            );
          },
          child: ListView(
            physics: const AlwaysScrollableScrollPhysics(),
            padding: const EdgeInsets.fromLTRB(
              15,
              14,
              15,
              30,
            ),
            children: [
              buildHeader(),
              const SizedBox(height: 20),
              if (isLoading)
                const LinearProgressIndicator(
                  color: primaryGreen,
                  backgroundColor: softGreen,
                  minHeight: 2,
                ),
              if (isLoading) const SizedBox(height: 10),
              buildWalletCard(),
              const SizedBox(height: 13),
              buildSearchBar(),
              const SizedBox(height: 16),
              buildQuickActions(),
              const SizedBox(height: 18),
              buildPopularServices(),
              if (filtered(popularServices()).isNotEmpty)
                const SizedBox(height: 18),
              buildMoreServices(),
              buildEmptySearch(),
              if (searchQuery.trim().isEmpty) const SizedBox(height: 18),
              if (searchQuery.trim().isEmpty) buildPromoBanner(),
              if (isRefreshing)
                const Padding(
                  padding: EdgeInsets.only(top: 20),
                  child: Center(
                    child: Text(
                      'Refreshing dashboard...',
                      style: TextStyle(
                        color: Color(0xFF667085),
                      ),
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

class _DashboardService {
  final String title;
  final IconData icon;
  final Color iconColor;
  final Color backgroundColor;
  final String keywords;
  final VoidCallback onTap;

  const _DashboardService({
    required this.title,
    required this.icon,
    required this.iconColor,
    required this.backgroundColor,
    required this.keywords,
    required this.onTap,
  });
}

class _WalletAction extends StatelessWidget {
  final IconData icon;
  final String label;
  final VoidCallback onTap;

  const _WalletAction({
    required this.icon,
    required this.label,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(14),
      child: Padding(
        padding: const EdgeInsets.symmetric(
          vertical: 5,
          horizontal: 2,
        ),
        child: Column(
          children: [
            Container(
              width: 42,
              height: 42,
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(13),
              ),
              child: Icon(
                icon,
                color: _DashboardScreenState.primaryGreen,
                size: 22,
              ),
            ),
            const SizedBox(height: 7),
            Text(
              label,
              maxLines: 2,
              textAlign: TextAlign.center,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(
                color: Colors.white,
                fontSize: 11,
                fontWeight: FontWeight.w700,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _QuickAction extends StatelessWidget {
  final IconData icon;
  final String label;
  final VoidCallback onTap;

  const _QuickAction({
    required this.icon,
    required this.label,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(15),
      child: Padding(
        padding: const EdgeInsets.symmetric(
          horizontal: 4,
        ),
        child: Column(
          children: [
            Container(
              width: 45,
              height: 45,
              decoration: BoxDecoration(
                color: _DashboardScreenState.softGreen,
                borderRadius: BorderRadius.circular(14),
              ),
              child: Icon(
                icon,
                color: _DashboardScreenState.primaryGreen,
                size: 24,
              ),
            ),
            const SizedBox(height: 8),
            Text(
              label,
              maxLines: 2,
              textAlign: TextAlign.center,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(
                color: Color(0xFF344054),
                fontSize: 11,
                fontWeight: FontWeight.w700,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _SectionHeader extends StatelessWidget {
  final String title;

  const _SectionHeader({
    required this.title,
  });

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Expanded(
          child: Text(
            title,
            style: const TextStyle(
              fontSize: 19,
              color: Color(0xFF101828),
              fontWeight: FontWeight.w900,
            ),
          ),
        ),
        const Text(
          'View All',
          style: TextStyle(
            color: _DashboardScreenState.primaryGreen,
            fontWeight: FontWeight.w800,
          ),
        ),
        const SizedBox(width: 4),
        const Icon(
          Icons.chevron_right_rounded,
          color: _DashboardScreenState.primaryGreen,
        ),
      ],
    );
  }
}

class _PopularServiceCard extends StatelessWidget {
  final _DashboardService service;

  const _PopularServiceCard({
    required this.service,
  });

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.white,
      borderRadius: BorderRadius.circular(20),
      child: InkWell(
        onTap: service.onTap,
        borderRadius: BorderRadius.circular(20),
        child: Container(
          padding: const EdgeInsets.symmetric(
            horizontal: 8,
            vertical: 13,
          ),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(20),
            border: Border.all(
              color: const Color(0xFFE7EAEF),
            ),
            boxShadow: const [
              BoxShadow(
                color: Color(0x0D101828),
                blurRadius: 13,
                offset: Offset(0, 5),
              ),
            ],
          ),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Container(
                width: 49,
                height: 49,
                decoration: BoxDecoration(
                  color: service.backgroundColor,
                  borderRadius: BorderRadius.circular(15),
                ),
                child: Icon(
                  service.icon,
                  color: service.iconColor,
                  size: 27,
                ),
              ),
              const SizedBox(height: 10),
              Text(
                service.title,
                maxLines: 2,
                textAlign: TextAlign.center,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  color: Color(0xFF1D2939),
                  fontSize: 12,
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

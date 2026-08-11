import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

import 'airtime_screen.dart';
import 'amana_screen.dart';
import 'bank_transfer_screen.dart';
import 'cable_screen.dart';
import 'data_screen.dart';
import 'electricity_screen.dart';
import 'exam_pin_screen.dart';
import 'flight_booking_screen.dart';
import 'id_verification_screen.dart';
import 'keke_order_screen.dart';
import 'logistics_screen.dart';
import 'notifications_screen.dart';
import 'transactions_screen.dart';
import 'transfer_screen.dart';
import 'wallet_screen.dart';

import 'airtime_to_cash_screen.dart';

import 'pay_by_link_screen.dart';
import 'request_money_screen.dart';
import 'business_wallet_screen.dart';
import 'community_agent_locator_screen.dart';
import 'group_wallet_screen.dart';

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

  Map<String, bool> serviceAvailability = <String, bool>{
    'kekeNapep': true,
    'amana': true,
    'airtime': true,
    'data': true,
    'electricity': true,
    'cableTv': true,
    'examPin': true,
    'ninVerification': true,
    'delivery': true,
    'flightBooking': true,
    'walletFunding': true,
    'bankTransfer': true,
    'servicepayTransfer': true,
  };

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
    const List<String> tokenKeys = <String>[
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

      if (token.toLowerCase().startsWith('bearer ')) {
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

      await _loadServiceAvailability();

      final String? token = await getSavedAuthToken(preferences);

      if (token == null || token.isEmpty) {
        return;
      }

      final http.Response response = await http.get(
        Uri.parse('$baseUrl/wallet'),
        headers: <String, String>{
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

  Future<void> _loadServiceAvailability() async {
    try {
      final http.Response response = await http.get(
        Uri.parse(
          '$baseUrl/settings/public',
        ),
        headers: const <String, String>{
          'Accept': 'application/json',
        },
      ).timeout(
        const Duration(seconds: 20),
      );

      if (response.statusCode != 200) {
        return;
      }

      final dynamic decoded = jsonDecode(response.body);

      if (decoded is! Map) {
        return;
      }

      dynamic settings = decoded['settings'];

      settings ??= decoded['data'] is Map ? decoded['data']['settings'] : null;

      if (settings is! Map) {
        return;
      }

      final dynamic rawServices = settings['services'];

      if (rawServices is! Map) {
        return;
      }

      final Map<String, bool> fresh = Map<String, bool>.from(
        serviceAvailability,
      );

      for (final String key in fresh.keys.toList()) {
        if (rawServices[key] is bool) {
          fresh[key] = rawServices[key] == true;
        }
      }

      if (mounted) {
        setState(() {
          serviceAvailability = fresh;
        });
      }
    } catch (_) {
      // Keep last/default visibility values.
    }
  }

  String? _serviceKeyForTitle(
    String title,
  ) {
    const Map<String, String> map = <String, String>{
      'Keke Napep': 'kekeNapep',
      'ServicePay Amana': 'amana',
      'Airtime': 'airtime',
      'Data': 'data',
      'Electricity': 'electricity',
      'Cable TV': 'cableTv',
      'Exam PIN': 'examPin',
      'NIN Verification': 'ninVerification',
      'Delivery': 'delivery',
      'Flight Booking': 'flightBooking',
      'Wallet Funding': 'walletFunding',
      'Bank Transfer': 'bankTransfer',
      'ServicePay Transfer': 'servicepayTransfer',
    };

    return map[title];
  }

  bool _isServiceVisible(
    String title,
  ) {
    final String? key = _serviceKeyForTitle(title);

    if (key == null) {
      return true;
    }

    return serviceAvailability[key] != false;
  }

  String firstName() {
    final String trimmed = userName.trim();

    if (trimmed.isEmpty) {
      return 'Customer';
    }

    return trimmed
        .split(
          RegExp(r'\s+'),
        )
        .first;
  }

  String formatMoney(double amount) {
    final String value = amount.toStringAsFixed(2);

    final List<String> parts = value.split('.');

    final String whole = parts.first;

    final StringBuffer formatted = StringBuffer();

    for (int index = 0; index < whole.length; index++) {
      final int remaining = whole.length - index;

      formatted.write(
        whole[index],
      );

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

  List<_DashboardService> popularServices() {
    return <_DashboardService>[
      _DashboardService(
        title: 'Keke Napep',
        icon: Icons.electric_rickshaw_rounded,
        iconColor: const Color(0xFFF59E0B),
        backgroundColor: const Color(0xFFFFF7DF),
        keywords:
            'keke napep ride transport tricycle taxi driver trip movement',
        onTap: () {
          openScreen(
            const KekeOrderScreen(),
          );
        },
      ),
      _DashboardService(
        title: 'ServicePay Amana',
        icon: Icons.volunteer_activism_rounded,
        iconColor: const Color(0xFF08783E),
        backgroundColor: const Color(0xFFEAF7F0),
        keywords: 'amana family support food school fees medical assistance',
        onTap: () {
          openScreen(
            const AmanaScreen(),
          );
        },
      ),
      _DashboardService(
        title: 'Airtime',
        icon: Icons.phone_android_rounded,
        iconColor: const Color(0xFF08783E),
        backgroundColor: const Color(0xFFEAF7F0),
        keywords: 'airtime recharge phone',
        onTap: () {
          openScreen(
            const AirtimeScreen(),
          );
        },
      ),
      _DashboardService(
        title: 'Data',
        icon: Icons.signal_cellular_alt_rounded,
        iconColor: const Color(0xFF08783E),
        backgroundColor: const Color(0xFFF0F7FF),
        keywords: 'data internet bundle',
        onTap: () {
          openScreen(
            const DataScreen(),
          );
        },
      ),
      _DashboardService(
        title: 'Electricity',
        icon: Icons.lightbulb_rounded,
        iconColor: const Color(0xFFF59E0B),
        backgroundColor: const Color(0xFFFFF7DF),
        keywords: 'electricity power light bill',
        onTap: () {
          openScreen(
            const ElectricityScreen(),
          );
        },
      ),
      _DashboardService(
        title: 'Cable TV',
        icon: Icons.live_tv_rounded,
        iconColor: const Color(0xFF08783E),
        backgroundColor: const Color(0xFFEAF7F0),
        keywords: 'cable tv dstv gotv startimes',
        onTap: () {
          openScreen(
            const CableScreen(),
          );
        },
      ),
      _DashboardService(
        title: 'Exam PIN',
        icon: Icons.workspace_premium_rounded,
        iconColor: const Color(0xFF08783E),
        backgroundColor: const Color(0xFFEAF7F0),
        keywords: 'exam pin waec neco jamb',
        onTap: () {
          openScreen(
            const ExamPinScreen(),
          );
        },
      ),
    ];
  }

  List<_DashboardService> moreServices() {
    return <_DashboardService>[
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
          openScreen(
            const LogisticsScreen(),
          );
        },
      ),
      _DashboardService(
        title: 'Airtime to Cash',
        icon: Icons.currency_exchange_rounded,
        iconColor: const Color(0xFF08783E),
        backgroundColor: const Color(0xFFEAF7F0),
        keywords: 'airtime cash convert airtime wallet mtn airtel glo 9mobile',
        onTap: () {
          openScreen(
            const AirtimeToCashScreen(),
          );
        },
      ),
      _DashboardService(
        title: 'Pay-by-Link',
        icon: Icons.link_rounded,
        iconColor: const Color(0xFF08783E),
        backgroundColor: const Color(0xFFEAF7F0),
        keywords: 'merchant payment link pay by link',
        onTap: () {
          openScreen(
            const PayByLinkScreen(),
          );
        },
      ),
      _DashboardService(
        title: 'Request Money',
        icon: Icons.request_page_rounded,
        iconColor: const Color(0xFF2563EB),
        backgroundColor: const Color(0xFFEFF6FF),
        keywords: 'request money collect payment',
        onTap: () {
          openScreen(
            const RequestMoneyScreen(),
          );
        },
      ),
      _DashboardService(
        title: 'Business Wallet',
        icon: Icons.storefront_rounded,
        iconColor: const Color(0xFF7C3AED),
        backgroundColor: const Color(0xFFF5F3FF),
        keywords: 'business wallet sme merchant',
        onTap: () {
          openScreen(
            const BusinessWalletScreen(),
          );
        },
      ),
      _DashboardService(
        title: 'Agent Locator',
        icon: Icons.location_on_rounded,
        iconColor: const Color(0xFFEA580C),
        backgroundColor: const Color(0xFFFFF7ED),
        keywords: 'agent locator aggregator nearby',
        onTap: () {
          openScreen(
            const CommunityAgentLocatorScreen(),
          );
        },
      ),
      _DashboardService(
        title: 'Group Wallet / Ajo',
        icon: Icons.groups_rounded,
        iconColor: const Color(0xFF0F766E),
        backgroundColor: const Color(0xFFF0FDFA),
        keywords: 'group wallet ajo contribution savings',
        onTap: () {
          openScreen(
            const GroupWalletScreen(),
          );
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
      _DashboardService(
        title: 'Wallet Funding',
        icon: Icons.account_balance_wallet_rounded,
        iconColor: const Color(0xFF08783E),
        backgroundColor: const Color(0xFFEAF7F0),
        keywords: 'wallet funding fund wallet deposit',
        onTap: () {
          openScreen(
            const WalletScreen(),
          );
        },
      ),
      _DashboardService(
        title: 'Bank Transfer',
        icon: Icons.account_balance_rounded,
        iconColor: const Color(0xFF08783E),
        backgroundColor: const Color(0xFFEAF7F0),
        keywords: 'bank transfer send money',
        onTap: () {
          openScreen(
            const BankTransferScreen(),
          );
        },
      ),
      _DashboardService(
        title: 'ServicePay Transfer',
        icon: Icons.send_rounded,
        iconColor: const Color(0xFF08783E),
        backgroundColor: const Color(0xFFEAF7F0),
        keywords: 'servicepay transfer send money',
        onTap: () {
          openScreen(
            const TransferScreen(),
          );
        },
      ),
    ];
  }

  List<_DashboardService> filtered(
    List<_DashboardService> services,
  ) {
    final List<_DashboardService> visible = services
        .where(
          (_DashboardService service) => _isServiceVisible(
            service.title,
          ),
        )
        .toList();

    final String query = searchQuery.trim().toLowerCase();

    if (query.isEmpty) {
      return visible;
    }

    return visible.where(
      (_DashboardService service) {
        final String searchable =
            '${service.title} ${service.keywords}'.toLowerCase();

        return searchable.contains(
          query,
        );
      },
    ).toList();
  }

  Widget buildHeader() {
    return Column(
      children: <Widget>[
        Row(
          children: <Widget>[
            SizedBox(
              width: 165,
              height: 58,
              child: Image.asset(
                'assets/image/servicepay_logo.png',
                fit: BoxFit.contain,
                alignment: Alignment.centerLeft,
                filterQuality: FilterQuality.high,
                errorBuilder: (
                  BuildContext context,
                  Object error,
                  StackTrace? stackTrace,
                ) {
                  return const Align(
                    alignment: Alignment.centerLeft,
                    child: Text(
                      'ServicePay',
                      style: TextStyle(
                        color: Color(0xFF064E2F),
                        fontSize: 22,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                  );
                },
              ),
            ),
            const Spacer(),
            Stack(
              clipBehavior: Clip.none,
              children: <Widget>[
                IconButton(
                  onPressed: () {
                    openScreen(
                      const NotificationsScreen(),
                    );
                  },
                  style: IconButton.styleFrom(
                    backgroundColor: softGreen,
                    foregroundColor: primaryGreen,
                    minimumSize: const Size(
                      45,
                      45,
                    ),
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
          children: <Widget>[
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
                children: <Widget>[
                  Text(
                    'Hello, ${firstName()}',
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      color: Color(0xFF101828),
                      fontSize: 19,
                      fontWeight: FontWeight.w900,
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
                color: softGreen,
                borderRadius: BorderRadius.circular(25),
              ),
              child: const Row(
                mainAxisSize: MainAxisSize.min,
                children: <Widget>[
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
          colors: <Color>[
            Color(0xFF00482C),
            Color(0xFF08783E),
            Color(0xFF12A85B),
          ],
        ),
        boxShadow: const <BoxShadow>[
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
          children: <Widget>[
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
            Padding(
              padding: const EdgeInsets.fromLTRB(
                19,
                18,
                19,
                16,
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Row(
                    children: <Widget>[
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
                  Text(
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
                      children: <Widget>[
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
                    children: <Widget>[
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
                          onTap: () {
                            openScreen(
                              const BankTransferScreen(),
                            );
                          },
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
      color: Colors.white.withValues(
        alpha: 0.16,
      ),
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
    final List<Widget> items = <Widget>[];

    void addItem({
      required String feature,
      required IconData icon,
      required String label,
      required VoidCallback onTap,
    }) {
      if (serviceAvailability[feature] == false) {
        return;
      }

      if (items.isNotEmpty) {
        items.add(
          _quickDivider(),
        );
      }

      items.add(
        Expanded(
          child: _QuickAction(
            icon: icon,
            label: label,
            onTap: onTap,
          ),
        ),
      );
    }

    addItem(
      feature: 'walletFunding',
      icon: Icons.account_balance_wallet_rounded,
      label: 'Fund Wallet',
      onTap: () {
        openScreen(
          const WalletScreen(),
        );
      },
    );

    addItem(
      feature: 'bankTransfer',
      icon: Icons.account_balance_rounded,
      label: 'Bank Transfer',
      onTap: () {
        openScreen(
          const BankTransferScreen(),
        );
      },
    );

    // Transactions is not a service switch.
    if (items.isNotEmpty) {
      items.add(
        _quickDivider(),
      );
    }

    items.add(
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
    );

    if (serviceAvailability['ninVerification'] != false) {
      items.add(
        _quickDivider(),
      );

      items.add(
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
      );
    }

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
        boxShadow: const <BoxShadow>[
          BoxShadow(
            color: Color(0x0F101828),
            blurRadius: 16,
            offset: Offset(0, 6),
          ),
        ],
      ),
      child: Row(
        children: items,
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
    final List<_DashboardService> services = filtered(
      popularServices(),
    );

    if (services.isEmpty) {
      return const SizedBox.shrink();
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        const _SectionHeader(
          title: 'Popular Services',
        ),
        const SizedBox(height: 13),
        SizedBox(
          height: 128,
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
    final List<_DashboardService> services = filtered(
      moreServices(),
    );

    if (services.isEmpty) {
      return const SizedBox.shrink();
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        const _SectionHeader(
          title: 'More Services',
        ),
        const SizedBox(height: 12),
        SizedBox(
          height: 120,
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
                        color: const Color(
                          0xFFE7EAEF,
                        ),
                      ),
                      boxShadow: const <BoxShadow>[
                        BoxShadow(
                          color: Color(
                            0x0B101828,
                          ),
                          blurRadius: 12,
                          offset: Offset(0, 4),
                        ),
                      ],
                    ),
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: <Widget>[
                        Container(
                          width: 43,
                          height: 43,
                          decoration: BoxDecoration(
                            color: service.backgroundColor,
                            borderRadius: BorderRadius.circular(
                              14,
                            ),
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
                            color: Color(
                              0xFF1D2939,
                            ),
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

    final bool hasPopular = filtered(
      popularServices(),
    ).isNotEmpty;

    final bool hasMore = filtered(
      moreServices(),
    ).isNotEmpty;

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
        children: <Widget>[
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
      height: 144,
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(25),
        gradient: const LinearGradient(
          begin: Alignment.centerLeft,
          end: Alignment.centerRight,
          colors: <Color>[
            Color(0xFF003B29),
            Color(0xFF006A3C),
            Color(0xFF088149),
          ],
        ),
        boxShadow: const <BoxShadow>[
          BoxShadow(
            color: Color(0x33004E2C),
            blurRadius: 22,
            offset: Offset(0, 11),
          ),
        ],
      ),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(25),
        child: Stack(
          children: <Widget>[
            Positioned(
              right: -35,
              top: -48,
              child: Container(
                width: 190,
                height: 190,
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
              right: 15,
              bottom: 8,
              child: Transform.rotate(
                angle: -0.12,
                child: Container(
                  width: 73,
                  height: 109,
                  decoration: BoxDecoration(
                    gradient: const LinearGradient(
                      begin: Alignment.topLeft,
                      end: Alignment.bottomRight,
                      colors: <Color>[
                        Color(0xFF17C86B),
                        Color(0xFF006B3B),
                      ],
                    ),
                    borderRadius: BorderRadius.circular(18),
                    border: Border.all(
                      color: Colors.white.withValues(
                        alpha: 0.40,
                      ),
                      width: 2,
                    ),
                    boxShadow: const <BoxShadow>[
                      BoxShadow(
                        color: Color(
                          0x66000000,
                        ),
                        blurRadius: 16,
                        offset: Offset(0, 9),
                      ),
                    ],
                  ),
                  child: const Center(
                    child: Text(
                      'S',
                      style: TextStyle(
                        color: Colors.white,
                        fontSize: 39,
                        fontWeight: FontWeight.w900,
                        fontStyle: FontStyle.italic,
                      ),
                    ),
                  ),
                ),
              ),
            ),
            const Positioned(
              right: 94,
              top: 18,
              child: Icon(
                Icons.bolt_rounded,
                color: Color(0x66FFD54F),
                size: 29,
              ),
            ),
            const Positioned(
              right: 112,
              bottom: 21,
              child: Icon(
                Icons.monetization_on_rounded,
                color: Color(0xFFFFC94B),
                size: 28,
              ),
            ),
            const Positioned(
              right: 28,
              top: 15,
              child: Icon(
                Icons.wifi_rounded,
                color: Color(0x668EEA93),
                size: 27,
              ),
            ),
            const Positioned(
              left: 21,
              top: 20,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Text(
                    'One Platform,',
                    style: TextStyle(
                      color: Colors.white,
                      fontSize: 21,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                  Text(
                    'Many Solutions',
                    style: TextStyle(
                      color: Color(
                        0xFF91EE96,
                      ),
                      fontSize: 22,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                  SizedBox(height: 10),
                  Text(
                    'Fast. Secure. Reliable.',
                    style: TextStyle(
                      color: Color(
                        0xFFD9F5E4,
                      ),
                      fontSize: 13,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ],
              ),
            ),
            const Positioned(
              right: 53,
              bottom: 9,
              child: Icon(
                Icons.shield_rounded,
                color: Color(0xFF9DE8B9),
                size: 31,
              ),
            ),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(
    BuildContext context,
  ) {
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
            children: <Widget>[
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
              if (filtered(
                popularServices(),
              ).isNotEmpty)
                const SizedBox(height: 18),
              buildMoreServices(),
              buildEmptySearch(),
              if (searchQuery.trim().isEmpty) const SizedBox(height: 18),
              if (searchQuery.trim().isEmpty) buildPromoBanner(),
              if (isRefreshing)
                const Padding(
                  padding: EdgeInsets.only(
                    top: 20,
                  ),
                  child: Center(
                    child: Text(
                      'Refreshing dashboard...',
                      style: TextStyle(
                        color: Color(
                          0xFF667085,
                        ),
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
  Widget build(
    BuildContext context,
  ) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(14),
      child: Padding(
        padding: const EdgeInsets.symmetric(
          vertical: 5,
          horizontal: 2,
        ),
        child: Column(
          children: <Widget>[
            Container(
              width: 42,
              height: 42,
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(
                  13,
                ),
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
  Widget build(
    BuildContext context,
  ) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(15),
      child: Padding(
        padding: const EdgeInsets.symmetric(
          horizontal: 4,
        ),
        child: Column(
          children: <Widget>[
            Container(
              width: 45,
              height: 45,
              decoration: BoxDecoration(
                color: _DashboardScreenState.softGreen,
                borderRadius: BorderRadius.circular(
                  14,
                ),
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
  Widget build(
    BuildContext context,
  ) {
    return Row(
      children: <Widget>[
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
  Widget build(
    BuildContext context,
  ) {
    return Material(
      color: Colors.white,
      borderRadius: BorderRadius.circular(20),
      child: InkWell(
        onTap: service.onTap,
        borderRadius: BorderRadius.circular(20),
        child: Container(
          padding: const EdgeInsets.symmetric(
            horizontal: 8,
            vertical: 9,
          ),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(
              20,
            ),
            border: Border.all(
              color: const Color(
                0xFFE7EAEF,
              ),
            ),
            boxShadow: const <BoxShadow>[
              BoxShadow(
                color: Color(
                  0x0D101828,
                ),
                blurRadius: 13,
                offset: Offset(0, 5),
              ),
            ],
          ),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: <Widget>[
              Container(
                width: 44,
                height: 44,
                decoration: BoxDecoration(
                  color: service.backgroundColor,
                  borderRadius: BorderRadius.circular(
                    15,
                  ),
                ),
                child: Icon(
                  service.icon,
                  color: service.iconColor,
                  size: 27,
                ),
              ),
              const SizedBox(height: 7),
              Text(
                service.title,
                maxLines: 2,
                textAlign: TextAlign.center,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  color: Color(
                    0xFF1D2939,
                  ),
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

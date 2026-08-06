import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

import '../login_screen.dart';
import 'rider_withdrawal_screen.dart';

class RiderApi {
  static const String baseUrl = 'https://api.servicepay.ng/api';

  static Map<String, dynamic> mapFromDynamic(
    dynamic value,
  ) {
    if (value is Map) {
      return Map<String, dynamic>.from(value);
    }

    return <String, dynamic>{};
  }

  static List<Map<String, dynamic>> listFromDynamic(
    dynamic value,
  ) {
    if (value is! List) {
      return <Map<String, dynamic>>[];
    }

    return value
        .whereType<Map>()
        .map(
          (Map item) => Map<String, dynamic>.from(item),
        )
        .toList();
  }

  static String text(
    dynamic value, {
    String fallback = '',
  }) {
    final String result = value?.toString().trim() ?? '';

    return result.isEmpty ? fallback : result;
  }

  static int integer(
    dynamic value,
  ) {
    return int.tryParse(
          value?.toString() ?? '0',
        ) ??
        0;
  }

  static double number(
    dynamic value,
  ) {
    return double.tryParse(
          value?.toString() ?? '0',
        ) ??
        0;
  }

  static Map<String, dynamic> decodeResponse(
    http.Response response,
  ) {
    final String body = response.body.trim();

    if (body.isEmpty) {
      return <String, dynamic>{};
    }

    final dynamic decoded = jsonDecode(body);

    return mapFromDynamic(decoded);
  }

  static Future<String> getToken() async {
    final SharedPreferences prefs = await SharedPreferences.getInstance();

    const List<String> tokenKeys = [
      'auth_token',
      'token',
      'access_token',
      'accessToken',
      'jwt_token',
      'jwt',
    ];

    for (final String key in tokenKeys) {
      String token = prefs.getString(key)?.trim() ?? '';

      if (token.toLowerCase().startsWith(
            'bearer ',
          )) {
        token = token.substring(7).trim();
      }

      if (token.isNotEmpty) {
        return token;
      }
    }

    return '';
  }

  static Future<Map<String, dynamic>> getProfile() async {
    final String token = await getToken();

    if (token.isEmpty) {
      throw Exception(
        'Rider login token was not found.',
      );
    }

    final http.Response response = await http.get(
      Uri.parse(
        '$baseUrl/auth/profile',
      ),
      headers: {
        'Accept': 'application/json',
        'Authorization': 'Bearer $token',
      },
    ).timeout(
      const Duration(seconds: 35),
    );

    final Map<String, dynamic> root = decodeResponse(response);

    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw Exception(
        text(
          root['message'],
          fallback: 'Unable to load rider profile.',
        ),
      );
    }

    Map<String, dynamic> user = mapFromDynamic(root['user']);

    if (user.isEmpty) {
      final Map<String, dynamic> data = mapFromDynamic(root['data']);

      user = mapFromDynamic(
        data['user'],
      );
    }

    if (user.isEmpty) {
      throw Exception(
        'Rider profile information was not received.',
      );
    }

    return user;
  }

  static Future<void> saveProfile(
    Map<String, dynamic> user,
  ) async {
    final SharedPreferences prefs = await SharedPreferences.getInstance();

    final String riderName = text(
      user['fullName'],
      fallback: 'Delivery Rider',
    );

    final String riderId = text(
      user['riderId'],
    );

    final String verificationStatus = text(
      user['riderVerificationStatus'],
      fallback: 'PENDING',
    ).toUpperCase();

    final String availabilityStatus = text(
      user['availabilityStatus'],
      fallback: 'OFFLINE',
    ).toUpperCase();

    await prefs.setString(
      'user_name',
      riderName,
    );

    await prefs.setString(
      'user_phone',
      text(user['phone']),
    );

    await prefs.setString(
      'user_email',
      text(user['email']),
    );

    await prefs.setString(
      'rider_id',
      riderId,
    );

    await prefs.setString(
      'rider_verification_status',
      verificationStatus,
    );

    await prefs.setString(
      'rider_availability_status',
      availabilityStatus,
    );

    await prefs.setBool(
      'rider_is_online',
      availabilityStatus == 'ONLINE',
    );

    await prefs.setString(
      'rider_vehicle_type',
      text(user['vehicleType']),
    );

    await prefs.setString(
      'rider_plate_number',
      text(user['plateNumber']),
    );

    await prefs.setString(
      'rider_state',
      text(
        user['riderState'] ?? user['state'],
      ),
    );

    await prefs.setString(
      'rider_lga',
      text(
        user['riderLga'] ?? user['lga'],
      ),
    );
  }
}

class RiderMainNavigation extends StatefulWidget {
  const RiderMainNavigation({
    super.key,
  });

  @override
  State<RiderMainNavigation> createState() => _RiderMainNavigationState();
}

class _RiderMainNavigationState extends State<RiderMainNavigation> {
  int currentIndex = 0;

  late final List<Widget> pages;

  @override
  void initState() {
    super.initState();

    pages = <Widget>[
      RiderDashboardScreen(
        openDeliveries: () {
          setState(() {
            currentIndex = 1;
          });
        },
      ),
      const RiderDeliveriesScreen(),
      const RiderEarningsScreen(),
      const RiderProfileScreen(),
    ];
  }

  @override
  Widget build(
    BuildContext context,
  ) {
    return Scaffold(
      body: IndexedStack(
        index: currentIndex,
        children: pages,
      ),
      bottomNavigationBar: NavigationBar(
        selectedIndex: currentIndex,
        onDestinationSelected: (
          int index,
        ) {
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
    required this.openDeliveries,
    super.key,
  });

  final VoidCallback openDeliveries;

  @override
  State<RiderDashboardScreen> createState() => _RiderDashboardScreenState();
}

class _RiderDashboardScreenState extends State<RiderDashboardScreen> {
  static const Color primaryGreen = Color(0xFF159447);

  String riderName = 'Delivery Rider';

  String riderId = '';

  String verificationStatus = 'PENDING';

  String availabilityStatus = 'OFFLINE';

  bool isOnline = false;
  bool isLoading = true;
  bool isUpdatingAvailability = false;

  int assignedDeliveries = 0;
  int activeDeliveries = 0;
  int completedDeliveries = 0;
  int pendingAcceptance = 0;

  double todayEarnings = 0;
  double totalEarnings = 0;

  @override
  void initState() {
    super.initState();
    loadDashboard();
  }

  void showMessage(
    String message, {
    bool isError = true,
  }) {
    if (!mounted) {
      return;
    }

    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(
        SnackBar(
          content: Text(message),
          behavior: SnackBarBehavior.floating,
          backgroundColor:
              isError ? Colors.red.shade700 : Colors.green.shade700,
        ),
      );
  }

  Future<Map<String, dynamic>> loadDeliverySummary() async {
    final String token = await RiderApi.getToken();

    if (token.isEmpty) {
      throw Exception(
        'Rider login token was not found.',
      );
    }

    final http.Response response = await http.get(
      Uri.parse(
        '${RiderApi.baseUrl}'
        '/rider/deliveries',
      ),
      headers: {
        'Accept': 'application/json',
        'Authorization': 'Bearer $token',
      },
    ).timeout(
      const Duration(seconds: 35),
    );

    final Map<String, dynamic> root = RiderApi.decodeResponse(response);

    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw Exception(
        RiderApi.text(
          root['message'],
          fallback: 'Unable to load delivery summary.',
        ),
      );
    }

    final Map<String, dynamic> data = RiderApi.mapFromDynamic(
      root['data'],
    );

    return RiderApi.mapFromDynamic(
      data['summary'],
    );
  }

  Future<void> loadDashboard() async {
    if (mounted) {
      setState(() {
        isLoading = true;
      });
    }

    try {
      final List<dynamic> responses = await Future.wait<dynamic>([
        RiderApi.getProfile(),
        loadDeliverySummary(),
      ]);

      final Map<String, dynamic> user = RiderApi.mapFromDynamic(
        responses[0],
      );

      final Map<String, dynamic> summary = RiderApi.mapFromDynamic(
        responses[1],
      );

      final String role = RiderApi.text(
        user['role'],
        fallback: 'CUSTOMER',
      ).toUpperCase();

      if (role != 'DELIVERY_RIDER') {
        throw Exception(
          'This account is not a Delivery Rider account.',
        );
      }

      await RiderApi.saveProfile(user);

      if (!mounted) {
        return;
      }

      setState(() {
        riderName = RiderApi.text(
          user['fullName'],
          fallback: 'Delivery Rider',
        );

        riderId = RiderApi.text(
          user['riderId'],
        );

        verificationStatus = RiderApi.text(
          user['riderVerificationStatus'],
          fallback: 'PENDING',
        ).toUpperCase();

        availabilityStatus = RiderApi.text(
          user['availabilityStatus'],
          fallback: 'OFFLINE',
        ).toUpperCase();

        isOnline = availabilityStatus == 'ONLINE';

        assignedDeliveries = RiderApi.integer(
          summary['totalAssigned'] ?? user['totalAssignedDeliveries'],
        );

        activeDeliveries = RiderApi.integer(
          summary['active'],
        );

        completedDeliveries = RiderApi.integer(
          summary['completed'] ?? user['totalCompletedDeliveries'],
        );

        pendingAcceptance = RiderApi.integer(
          summary['pendingAcceptance'],
        );

        totalEarnings = RiderApi.number(
          user['totalRiderEarnings'],
        );

        todayEarnings = RiderApi.number(
          user['todayRiderEarnings'],
        );

        isLoading = false;
      });
    } on TimeoutException {
      showMessage(
        'The server took too long to respond.',
      );

      if (mounted) {
        setState(() {
          isLoading = false;
        });
      }
    } on FormatException {
      showMessage(
        'The server returned an invalid response.',
      );

      if (mounted) {
        setState(() {
          isLoading = false;
        });
      }
    } catch (error) {
      showMessage(
        error.toString().replaceFirst(
              'Exception: ',
              '',
            ),
      );

      if (mounted) {
        setState(() {
          isLoading = false;
        });
      }
    }
  }

  Future<void> toggleAvailability(
    bool value,
  ) async {
    if (isUpdatingAvailability) {
      return;
    }

    if (value && verificationStatus != 'VERIFIED') {
      showMessage(
        'Your rider account must be verified before going online.',
      );
      return;
    }

    setState(() {
      isUpdatingAvailability = true;
    });

    try {
      final String token = await RiderApi.getToken();

      if (token.isEmpty) {
        throw Exception(
          'Rider login token was not found.',
        );
      }

      final String requestedStatus = value ? 'ONLINE' : 'OFFLINE';

      final http.Response response = await http
          .patch(
            Uri.parse(
              '${RiderApi.baseUrl}'
              '/auth/rider/availability',
            ),
            headers: {
              'Accept': 'application/json',
              'Content-Type': 'application/json',
              'Authorization': 'Bearer $token',
            },
            body: jsonEncode({
              'availabilityStatus': requestedStatus,
            }),
          )
          .timeout(
            const Duration(seconds: 35),
          );

      final Map<String, dynamic> root = RiderApi.decodeResponse(
        response,
      );

      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw Exception(
          RiderApi.text(
            root['message'],
            fallback: 'Unable to update rider availability.',
          ),
        );
      }

      Map<String, dynamic> user = RiderApi.mapFromDynamic(
        root['user'],
      );

      if (user.isEmpty) {
        final Map<String, dynamic> data = RiderApi.mapFromDynamic(
          root['data'],
        );

        user = RiderApi.mapFromDynamic(
          data['user'],
        );
      }

      final String updatedStatus = RiderApi.text(
        user['availabilityStatus'],
        fallback: requestedStatus,
      ).toUpperCase();

      await RiderApi.saveProfile(user);

      if (!mounted) {
        return;
      }

      setState(() {
        availabilityStatus = updatedStatus;

        isOnline = updatedStatus == 'ONLINE';
      });

      showMessage(
        RiderApi.text(
          root['message'],
          fallback: isOnline ? 'You are now online.' : 'You are now offline.',
        ),
        isError: false,
      );
    } on TimeoutException {
      showMessage(
        'The server took too long to respond.',
      );
    } on FormatException {
      showMessage(
        'The server returned an invalid response.',
      );
    } catch (error) {
      showMessage(
        error.toString().replaceFirst(
              'Exception: ',
              '',
            ),
      );
    } finally {
      if (mounted) {
        setState(() {
          isUpdatingAvailability = false;
        });
      }
    }
  }

  String formatMoney(
    double value,
  ) {
    return '₦${value.toStringAsFixed(2)}';
  }

  @override
  Widget build(
    BuildContext context,
  ) {
    return Scaffold(
      backgroundColor: const Color(0xFFF5F7FA),
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
            tooltip: 'Refresh',
            onPressed: isLoading ? null : loadDashboard,
            icon: const Icon(
              Icons.refresh_rounded,
            ),
          ),
          IconButton(
            tooltip: 'Deliveries',
            onPressed: widget.openDeliveries,
            icon: Badge(
              isLabelVisible: pendingAcceptance > 0,
              label: Text(
                pendingAcceptance.toString(),
              ),
              child: const Icon(
                Icons.notifications_outlined,
              ),
            ),
          ),
          const SizedBox(width: 8),
        ],
      ),
      body: isLoading
          ? const Center(
              child: CircularProgressIndicator(),
            )
          : RefreshIndicator(
              onRefresh: loadDashboard,
              child: ListView(
                padding: const EdgeInsets.all(16),
                children: [
                  Container(
                    padding: const EdgeInsets.all(18),
                    decoration: BoxDecoration(
                      gradient: const LinearGradient(
                        colors: [
                          Color(0xFF159447),
                          Color(0xFF0F766E),
                        ],
                        begin: Alignment.topLeft,
                        end: Alignment.bottomRight,
                      ),
                      borderRadius: BorderRadius.circular(
                        22,
                      ),
                      boxShadow: [
                        BoxShadow(
                          color: primaryGreen.withValues(
                            alpha: 0.22,
                          ),
                          blurRadius: 18,
                          offset: const Offset(0, 8),
                        ),
                      ],
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            Container(
                              width: 56,
                              height: 56,
                              decoration: BoxDecoration(
                                color: Colors.white.withValues(
                                  alpha: 0.18,
                                ),
                                shape: BoxShape.circle,
                              ),
                              child: const Icon(
                                Icons.delivery_dining_rounded,
                                color: Colors.white,
                                size: 34,
                              ),
                            ),
                            const SizedBox(
                              width: 14,
                            ),
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  const Text(
                                    'Welcome back',
                                    style: TextStyle(
                                      color: Colors.white70,
                                      fontSize: 13,
                                    ),
                                  ),
                                  const SizedBox(
                                    height: 3,
                                  ),
                                  Text(
                                    riderName,
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                    style: const TextStyle(
                                      color: Colors.white,
                                      fontSize: 20,
                                      fontWeight: FontWeight.bold,
                                    ),
                                  ),
                                  if (riderId.isNotEmpty)
                                    Text(
                                      'Rider ID: $riderId',
                                      style: const TextStyle(
                                        color: Colors.white70,
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
                          padding: const EdgeInsets.symmetric(
                            horizontal: 14,
                            vertical: 10,
                          ),
                          decoration: BoxDecoration(
                            color: Colors.white.withValues(
                              alpha: 0.14,
                            ),
                            borderRadius: BorderRadius.circular(14),
                          ),
                          child: Row(
                            children: [
                              Icon(
                                isOnline
                                    ? Icons.radio_button_checked
                                    : Icons.radio_button_off,
                                color: Colors.white,
                              ),
                              const SizedBox(
                                width: 10,
                              ),
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text(
                                      isOnline
                                          ? 'You are online'
                                          : availabilityStatus == 'BUSY'
                                              ? 'You are busy'
                                              : 'You are offline',
                                      style: const TextStyle(
                                        color: Colors.white,
                                        fontWeight: FontWeight.w700,
                                      ),
                                    ),
                                    Text(
                                      isOnline
                                          ? 'Available for new delivery jobs'
                                          : availabilityStatus == 'BUSY'
                                              ? 'Complete your active delivery'
                                              : 'Turn on when you are ready',
                                      style: const TextStyle(
                                        color: Colors.white70,
                                        fontSize: 11,
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                              if (isUpdatingAvailability)
                                const SizedBox(
                                  width: 22,
                                  height: 22,
                                  child: CircularProgressIndicator(
                                    strokeWidth: 2,
                                    color: Colors.white,
                                  ),
                                )
                              else
                                Switch(
                                  value: isOnline,
                                  onChanged: availabilityStatus == 'BUSY'
                                      ? null
                                      : toggleAvailability,
                                  activeThumbColor: Colors.white,
                                  activeTrackColor: Colors.greenAccent,
                                ),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 16),
                  if (pendingAcceptance > 0)
                    Material(
                      color: Colors.orange.withValues(
                        alpha: 0.12,
                      ),
                      borderRadius: BorderRadius.circular(
                        16,
                      ),
                      child: InkWell(
                        onTap: widget.openDeliveries,
                        borderRadius: BorderRadius.circular(
                          16,
                        ),
                        child: Padding(
                          padding: const EdgeInsets.all(
                            16,
                          ),
                          child: Row(
                            children: [
                              const Icon(
                                Icons.notifications_active_rounded,
                                color: Colors.orange,
                                size: 30,
                              ),
                              const SizedBox(
                                width: 12,
                              ),
                              Expanded(
                                child: Text(
                                  pendingAcceptance == 1
                                      ? 'You have 1 new delivery job waiting for your response.'
                                      : 'You have $pendingAcceptance new delivery jobs waiting for your response.',
                                  style: const TextStyle(
                                    fontWeight: FontWeight.w700,
                                    height: 1.4,
                                  ),
                                ),
                              ),
                              const Icon(
                                Icons.chevron_right_rounded,
                              ),
                            ],
                          ),
                        ),
                      ),
                    ),
                  if (pendingAcceptance > 0)
                    const SizedBox(
                      height: 16,
                    ),
                  Container(
                    padding: const EdgeInsets.all(
                      14,
                    ),
                    decoration: BoxDecoration(
                      color: verificationStatus == 'VERIFIED'
                          ? Colors.green.withValues(
                              alpha: 0.10,
                            )
                          : Colors.orange.withValues(
                              alpha: 0.10,
                            ),
                      borderRadius: BorderRadius.circular(
                        14,
                      ),
                      border: Border.all(
                        color: verificationStatus == 'VERIFIED'
                            ? Colors.green.withValues(
                                alpha: 0.30,
                              )
                            : Colors.orange.withValues(
                                alpha: 0.30,
                              ),
                      ),
                    ),
                    child: Row(
                      children: [
                        Icon(
                          verificationStatus == 'VERIFIED'
                              ? Icons.verified_rounded
                              : Icons.verified_user_outlined,
                          color: verificationStatus == 'VERIFIED'
                              ? Colors.green
                              : Colors.orange,
                        ),
                        const SizedBox(
                          width: 10,
                        ),
                        Expanded(
                          child: Text(
                            verificationStatus == 'VERIFIED'
                                ? 'Your rider account has been verified by ServicePay Head Office.'
                                : 'Verification status: $verificationStatus. You can go online after verification.',
                            style: const TextStyle(
                              height: 1.4,
                              fontWeight: FontWeight.w600,
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
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                  const SizedBox(height: 12),
                  GridView.count(
                    crossAxisCount: 3,
                    shrinkWrap: true,
                    physics: const NeverScrollableScrollPhysics(),
                    crossAxisSpacing: 10,
                    mainAxisSpacing: 10,
                    childAspectRatio: 0.92,
                    children: [
                      RiderSummaryCard(
                        title: 'Assigned',
                        value: assignedDeliveries.toString(),
                        icon: Icons.assignment_outlined,
                      ),
                      RiderSummaryCard(
                        title: 'Active',
                        value: activeDeliveries.toString(),
                        icon: Icons.local_shipping_outlined,
                      ),
                      RiderSummaryCard(
                        title: 'Completed',
                        value: completedDeliveries.toString(),
                        icon: Icons.check_circle_outline,
                      ),
                    ],
                  ),
                  const SizedBox(height: 20),
                  const Text(
                    'Earnings',
                    style: TextStyle(
                      fontSize: 18,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                  const SizedBox(height: 12),
                  Row(
                    children: [
                      Expanded(
                        child: RiderEarningCard(
                          title: 'Today Earnings',
                          amount: formatMoney(
                            todayEarnings,
                          ),
                          icon: Icons.today_outlined,
                        ),
                      ),
                      const SizedBox(
                        width: 12,
                      ),
                      Expanded(
                        child: RiderEarningCard(
                          title: 'Total Earnings',
                          amount: formatMoney(
                            totalEarnings,
                          ),
                          icon: Icons.account_balance_wallet_outlined,
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 20),
                  Row(
                    children: [
                      Expanded(
                        child: RiderActionButton(
                          label: 'View Deliveries',
                          icon: Icons.local_shipping_outlined,
                          onTap: widget.openDeliveries,
                        ),
                      ),
                      const SizedBox(
                        width: 12,
                      ),
                      Expanded(
                        child: RiderActionButton(
                          label: 'Refresh Status',
                          icon: Icons.sync_rounded,
                          onTap: loadDashboard,
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
  Widget build(
    BuildContext context,
  ) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        boxShadow: const [
          BoxShadow(
            color: Colors.black12,
            blurRadius: 10,
            offset: Offset(0, 4),
          ),
        ],
      ),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Container(
            width: 40,
            height: 40,
            decoration: BoxDecoration(
              color: const Color(0xFF159447).withValues(
                alpha: 0.10,
              ),
              borderRadius: BorderRadius.circular(12),
            ),
            child: Icon(
              icon,
              color: const Color(0xFF159447),
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

class RiderEarningCard extends StatelessWidget {
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
  Widget build(
    BuildContext context,
  ) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        boxShadow: const [
          BoxShadow(
            color: Colors.black12,
            blurRadius: 10,
            offset: Offset(0, 4),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(
            icon,
            color: const Color(0xFF159447),
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

class RiderActionButton extends StatelessWidget {
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
  Widget build(
    BuildContext context,
  ) {
    return Material(
      color: Colors.white,
      borderRadius: BorderRadius.circular(16),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(16),
        child: Container(
          padding: const EdgeInsets.symmetric(
            vertical: 18,
            horizontal: 12,
          ),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(16),
            border: Border.all(
              color: const Color(0xFFE2E8F0),
            ),
          ),
          child: Column(
            children: [
              Icon(
                icon,
                color: const Color(0xFF159447),
                size: 28,
              ),
              const SizedBox(height: 8),
              Text(
                label,
                textAlign: TextAlign.center,
                style: const TextStyle(
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

class RiderDeliveriesScreen extends StatefulWidget {
  const RiderDeliveriesScreen({
    super.key,
  });

  @override
  State<RiderDeliveriesScreen> createState() => _RiderDeliveriesScreenState();
}

class _RiderDeliveriesScreenState extends State<RiderDeliveriesScreen>
    with SingleTickerProviderStateMixin {
  static const Color primaryGreen = Color(0xFF159447);

  late final AnimationController pulseController;

  late final Animation<double> pulseAnimation;

  List<Map<String, dynamic>> deliveries = <Map<String, dynamic>>[];

  bool isLoading = true;
  bool isRefreshing = false;
  bool hasError = false;

  String errorMessage = '';
  String selectedStatus = 'ALL';

  @override
  void initState() {
    super.initState();

    pulseController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 850),
    );

    pulseAnimation = Tween<double>(
      begin: 0.98,
      end: 1.02,
    ).animate(
      CurvedAnimation(
        parent: pulseController,
        curve: Curves.easeInOut,
      ),
    );

    pulseController.repeat(
      reverse: true,
    );

    loadDeliveries();
  }

  @override
  void dispose() {
    pulseController.dispose();
    super.dispose();
  }

  void showMessage(
    String message, {
    bool isError = false,
  }) {
    if (!mounted) {
      return;
    }

    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(
        SnackBar(
          content: Text(message),
          behavior: SnackBarBehavior.floating,
          backgroundColor: isError ? Colors.red.shade700 : primaryGreen,
        ),
      );
  }

  Future<void> loadDeliveries({
    bool refresh = false,
  }) async {
    if (mounted) {
      setState(() {
        if (refresh) {
          isRefreshing = true;
        } else {
          isLoading = true;
        }

        hasError = false;
        errorMessage = '';
      });
    }

    try {
      final String token = await RiderApi.getToken();

      if (token.isEmpty) {
        throw Exception(
          'Rider login token was not found.',
        );
      }

      final Map<String, String> queryParameters = <String, String>{};

      if (selectedStatus != 'ALL') {
        queryParameters['status'] = selectedStatus;
      }

      final Uri endpoint = Uri.parse(
        '${RiderApi.baseUrl}'
        '/rider/deliveries',
      ).replace(
        queryParameters: queryParameters.isEmpty ? null : queryParameters,
      );

      final http.Response response = await http.get(
        endpoint,
        headers: {
          'Accept': 'application/json',
          'Authorization': 'Bearer $token',
        },
      ).timeout(
        const Duration(seconds: 35),
      );

      final Map<String, dynamic> root = RiderApi.decodeResponse(
        response,
      );

      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw Exception(
          RiderApi.text(
            root['message'],
            fallback: 'Unable to load assigned deliveries.',
          ),
        );
      }

      final Map<String, dynamic> data = RiderApi.mapFromDynamic(
        root['data'],
      );

      final List<Map<String, dynamic>> loadedDeliveries =
          RiderApi.listFromDynamic(
        root['deliveries'] ?? data['deliveries'],
      );

      if (!mounted) {
        return;
      }

      setState(() {
        deliveries = loadedDeliveries;

        isLoading = false;
        isRefreshing = false;
        hasError = false;
        errorMessage = '';
      });
    } on TimeoutException {
      if (!mounted) {
        return;
      }

      setState(() {
        isLoading = false;
        isRefreshing = false;
        hasError = true;
        errorMessage = 'The server took too long to respond.';
      });
    } on FormatException {
      if (!mounted) {
        return;
      }

      setState(() {
        isLoading = false;
        isRefreshing = false;
        hasError = true;
        errorMessage = 'The server returned an invalid response.';
      });
    } catch (error) {
      if (!mounted) {
        return;
      }

      setState(() {
        isLoading = false;
        isRefreshing = false;
        hasError = true;
        errorMessage = error.toString().replaceFirst(
              'Exception: ',
              '',
            );
      });
    }
  }

  Future<bool> performAction({
    required Map<String, dynamic> delivery,
    required String action,
    String? status,
    String? reason,
  }) async {
    final String deliveryId = RiderApi.text(
      delivery['_id'],
    );

    if (deliveryId.isEmpty) {
      showMessage(
        'Invalid delivery ID.',
        isError: true,
      );

      return false;
    }

    try {
      final String token = await RiderApi.getToken();

      if (token.isEmpty) {
        throw Exception(
          'Rider login token was not found.',
        );
      }

      final Uri endpoint = action == 'STATUS'
          ? Uri.parse(
              '${RiderApi.baseUrl}'
              '/rider/deliveries/'
              '$deliveryId/status',
            )
          : Uri.parse(
              '${RiderApi.baseUrl}'
              '/rider/deliveries/'
              '$deliveryId/'
              '${action.toLowerCase()}',
            );

      final Map<String, dynamic> payload = <String, dynamic>{};

      if (status != null) {
        payload['status'] = status;
      }

      if (reason != null && reason.trim().isNotEmpty) {
        payload['reason'] = reason.trim();
      }

      final http.Response response = await http
          .patch(
            endpoint,
            headers: {
              'Accept': 'application/json',
              'Content-Type': 'application/json',
              'Authorization': 'Bearer $token',
            },
            body: jsonEncode(
              payload,
            ),
          )
          .timeout(
            const Duration(seconds: 35),
          );

      final Map<String, dynamic> root = RiderApi.decodeResponse(
        response,
      );

      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw Exception(
          RiderApi.text(
            root['message'],
            fallback: 'Unable to update delivery.',
          ),
        );
      }

      showMessage(
        RiderApi.text(
          root['message'],
          fallback: 'Delivery updated successfully.',
        ),
      );

      await loadDeliveries(
        refresh: true,
      );

      return true;
    } on TimeoutException {
      showMessage(
        'The server took too long to respond.',
        isError: true,
      );

      return false;
    } on FormatException {
      showMessage(
        'The server returned an invalid response.',
        isError: true,
      );

      return false;
    } catch (error) {
      showMessage(
        error.toString().replaceFirst(
              'Exception: ',
              '',
            ),
        isError: true,
      );

      return false;
    }
  }

  String formatStatus(
    String status,
  ) {
    return status
        .replaceAll('_', ' ')
        .split(' ')
        .map(
          (String word) => word.isEmpty
              ? word
              : '${word[0].toUpperCase()}'
                  '${word.substring(1).toLowerCase()}',
        )
        .join(' ');
  }

  String formatMoney(
    dynamic value,
  ) {
    return '₦${RiderApi.number(value).toStringAsFixed(2)}';
  }

  String formatDate(
    dynamic value,
  ) {
    if (value == null) {
      return 'Not available';
    }

    final DateTime? date = DateTime.tryParse(
      value.toString(),
    );

    if (date == null) {
      return value.toString();
    }

    final DateTime local = date.toLocal();

    return '${local.day.toString().padLeft(2, '0')}/'
        '${local.month.toString().padLeft(2, '0')}/'
        '${local.year}';
  }

  Color getStatusColor(
    String status,
  ) {
    switch (status.toUpperCase()) {
      case 'ASSIGNED':
        return Colors.orange;

      case 'ACCEPTED':
        return Colors.blue;

      case 'PICKED_UP':
        return Colors.deepPurple;

      case 'IN_TRANSIT':
        return Colors.indigo;

      case 'DELIVERED':
        return Colors.green;

      case 'CANCELLED':
      case 'FAILED':
        return Colors.red;

      default:
        return Colors.grey;
    }
  }

  String customerName(
    Map<String, dynamic> delivery,
  ) {
    final Map<String, dynamic> customer = RiderApi.mapFromDynamic(
      delivery['customerId'],
    );

    return RiderApi.text(
      customer['fullName'] ?? delivery['senderName'],
      fallback: 'ServicePay Customer',
    );
  }

  String customerPhone(
    Map<String, dynamic> delivery,
  ) {
    final Map<String, dynamic> customer = RiderApi.mapFromDynamic(
      delivery['customerId'],
    );

    return RiderApi.text(
      customer['phone'] ?? delivery['senderPhone'],
      fallback: 'Not available',
    );
  }

  String packageName(
    Map<String, dynamic> delivery,
  ) {
    return RiderApi.text(
      delivery['packageName'] ?? delivery['packageDescription'],
      fallback: 'Package',
    );
  }

  Future<void> rejectDelivery(
    Map<String, dynamic> delivery,
  ) async {
    final TextEditingController reasonController = TextEditingController();

    final bool confirmed = await showDialog<bool>(
          context: context,
          builder: (
            BuildContext dialogContext,
          ) {
            return AlertDialog(
              title: const Text(
                'Reject Delivery Job',
              ),
              content: TextField(
                controller: reasonController,
                maxLines: 3,
                decoration: const InputDecoration(
                  labelText: 'Reason for rejection',
                  hintText: 'Enter your reason',
                  border: OutlineInputBorder(),
                ),
              ),
              actions: [
                TextButton(
                  onPressed: () {
                    Navigator.of(
                      dialogContext,
                    ).pop(false);
                  },
                  child: const Text(
                    'Cancel',
                  ),
                ),
                ElevatedButton(
                  onPressed: () {
                    Navigator.of(
                      dialogContext,
                    ).pop(true);
                  },
                  style: ElevatedButton.styleFrom(
                    backgroundColor: Colors.red,
                    foregroundColor: Colors.white,
                  ),
                  child: const Text(
                    'Reject Job',
                  ),
                ),
              ],
            );
          },
        ) ??
        false;

    if (!confirmed) {
      reasonController.dispose();
      return;
    }

    await performAction(
      delivery: delivery,
      action: 'REJECT',
      reason: reasonController.text.trim(),
    );

    reasonController.dispose();
  }

  String? nextStatus(
    String currentStatus,
  ) {
    switch (currentStatus.toUpperCase()) {
      case 'ACCEPTED':
        return 'PICKED_UP';

      case 'PICKED_UP':
        return 'IN_TRANSIT';

      case 'IN_TRANSIT':
        return 'DELIVERED';

      default:
        return null;
    }
  }

  String nextStatusLabel(
    String status,
  ) {
    switch (status) {
      case 'PICKED_UP':
        return 'Mark as Picked Up';

      case 'IN_TRANSIT':
        return 'Start Delivery';

      case 'DELIVERED':
        return 'Mark as Delivered';

      default:
        return 'Update Delivery';
    }
  }

  void openDeliveryDetails(
    Map<String, dynamic> delivery,
  ) {
    final String status = RiderApi.text(
      delivery['status'],
      fallback: 'ASSIGNED',
    ).toUpperCase();

    final String? upcomingStatus = nextStatus(status);

    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (
        BuildContext sheetContext,
      ) {
        bool isProcessing = false;

        return StatefulBuilder(
          builder: (
            BuildContext sheetContext,
            void Function(
              void Function(),
            ) setSheetState,
          ) {
            return Container(
              constraints: BoxConstraints(
                maxHeight: MediaQuery.sizeOf(
                      context,
                    ).height *
                    0.92,
              ),
              decoration: const BoxDecoration(
                color: Color(
                  0xFFF8FAFC,
                ),
                borderRadius: BorderRadius.vertical(
                  top: Radius.circular(26),
                ),
              ),
              child: Column(
                children: [
                  Container(
                    margin: const EdgeInsets.only(
                      top: 10,
                    ),
                    width: 46,
                    height: 5,
                    decoration: BoxDecoration(
                      color: Colors.grey.shade300,
                      borderRadius: BorderRadius.circular(10),
                    ),
                  ),
                  Expanded(
                    child: ListView(
                      padding: const EdgeInsets.all(
                        20,
                      ),
                      children: [
                        Row(
                          children: [
                            Container(
                              width: 54,
                              height: 54,
                              decoration: BoxDecoration(
                                color: getStatusColor(
                                  status,
                                ).withValues(
                                  alpha: 0.12,
                                ),
                                borderRadius: BorderRadius.circular(
                                  15,
                                ),
                              ),
                              child: Icon(
                                Icons.local_shipping_rounded,
                                color: getStatusColor(
                                  status,
                                ),
                                size: 30,
                              ),
                            ),
                            const SizedBox(
                              width: 12,
                            ),
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(
                                    RiderApi.text(
                                      delivery['trackingNumber'],
                                      fallback: 'Delivery Job',
                                    ),
                                    style: const TextStyle(
                                      fontSize: 19,
                                      fontWeight: FontWeight.bold,
                                    ),
                                  ),
                                  const SizedBox(
                                    height: 4,
                                  ),
                                  Text(
                                    formatDate(
                                      delivery['assignedAt'] ??
                                          delivery['createdAt'],
                                    ),
                                    style: const TextStyle(
                                      color: Colors.black54,
                                    ),
                                  ),
                                ],
                              ),
                            ),
                            _RiderStatusBadge(
                              text: formatStatus(
                                status,
                              ),
                              color: getStatusColor(
                                status,
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(
                          height: 20,
                        ),
                        _RiderDetailSection(
                          title: 'Customer Information',
                          children: [
                            _RiderDetailRow(
                              icon: Icons.person_outline,
                              label: 'Customer',
                              value: customerName(
                                delivery,
                              ),
                            ),
                            _RiderDetailRow(
                              icon: Icons.phone_outlined,
                              label: 'Customer Phone',
                              value: customerPhone(
                                delivery,
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(
                          height: 14,
                        ),
                        _RiderDetailSection(
                          title: 'Pickup and Destination',
                          children: [
                            _RiderDetailRow(
                              icon: Icons.location_on_outlined,
                              label: 'Pickup Address',
                              value: RiderApi.text(
                                delivery['pickupAddress'],
                                fallback: 'Not available',
                              ),
                            ),
                            _RiderDetailRow(
                              icon: Icons.flag_outlined,
                              label: 'Delivery Address',
                              value: RiderApi.text(
                                delivery['deliveryAddress'],
                                fallback: 'Not available',
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(
                          height: 14,
                        ),
                        _RiderDetailSection(
                          title: 'Receiver Information',
                          children: [
                            _RiderDetailRow(
                              icon: Icons.person_pin_outlined,
                              label: 'Receiver Name',
                              value: RiderApi.text(
                                delivery['receiverName'],
                                fallback: 'Not available',
                              ),
                            ),
                            _RiderDetailRow(
                              icon: Icons.phone_in_talk_outlined,
                              label: 'Receiver Phone',
                              value: RiderApi.text(
                                delivery['receiverPhone'],
                                fallback: 'Not available',
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(
                          height: 14,
                        ),
                        _RiderDetailSection(
                          title: 'Package Information',
                          children: [
                            _RiderDetailRow(
                              icon: Icons.inventory_2_outlined,
                              label: 'Package',
                              value: packageName(
                                delivery,
                              ),
                            ),
                            _RiderDetailRow(
                              icon: Icons.description_outlined,
                              label: 'Description',
                              value: RiderApi.text(
                                delivery['packageDescription'],
                                fallback: 'No description',
                              ),
                            ),
                            _RiderDetailRow(
                              icon: Icons.scale_outlined,
                              label: 'Weight',
                              value:
                                  '${RiderApi.number(delivery['packageWeight']).toStringAsFixed(2)} kg',
                            ),
                            _RiderDetailRow(
                              icon: Icons.payments_outlined,
                              label: 'Delivery Fee',
                              value: formatMoney(
                                delivery['deliveryFee'],
                              ),
                            ),
                            _RiderDetailRow(
                              icon: Icons.account_balance_wallet_outlined,
                              label: 'Payment Status',
                              value: formatStatus(
                                RiderApi.text(
                                  delivery['paymentStatus'],
                                  fallback: 'UNPAID',
                                ),
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(
                          height: 20,
                        ),
                        if (status == 'ASSIGNED') ...[
                          Row(
                            children: [
                              Expanded(
                                child: OutlinedButton.icon(
                                  onPressed: isProcessing
                                      ? null
                                      : () async {
                                          setSheetState(
                                            () {
                                              isProcessing = true;
                                            },
                                          );

                                          final bool success =
                                              await performAction(
                                            delivery: delivery,
                                            action: 'REJECT',
                                            reason: 'Rejected by rider.',
                                          );

                                          if (!sheetContext.mounted) {
                                            return;
                                          }

                                          if (success) {
                                            Navigator.of(
                                              sheetContext,
                                            ).pop();
                                            return;
                                          }

                                          setSheetState(
                                            () {
                                              isProcessing = false;
                                            },
                                          );
                                        },
                                  style: OutlinedButton.styleFrom(
                                    foregroundColor: Colors.red,
                                    side: const BorderSide(
                                      color: Colors.red,
                                    ),
                                    minimumSize: const Size(
                                      double.infinity,
                                      52,
                                    ),
                                  ),
                                  icon: const Icon(
                                    Icons.close_rounded,
                                  ),
                                  label: const Text(
                                    'Reject Job',
                                  ),
                                ),
                              ),
                              const SizedBox(
                                width: 12,
                              ),
                              Expanded(
                                child: ElevatedButton.icon(
                                  onPressed: isProcessing
                                      ? null
                                      : () async {
                                          setSheetState(
                                            () {
                                              isProcessing = true;
                                            },
                                          );

                                          final bool success =
                                              await performAction(
                                            delivery: delivery,
                                            action: 'ACCEPT',
                                          );

                                          if (!sheetContext.mounted) {
                                            return;
                                          }

                                          if (success) {
                                            Navigator.of(
                                              sheetContext,
                                            ).pop();
                                            return;
                                          }

                                          setSheetState(
                                            () {
                                              isProcessing = false;
                                            },
                                          );
                                        },
                                  style: ElevatedButton.styleFrom(
                                    backgroundColor: primaryGreen,
                                    foregroundColor: Colors.white,
                                    minimumSize: const Size(
                                      double.infinity,
                                      52,
                                    ),
                                  ),
                                  icon: isProcessing
                                      ? const SizedBox(
                                          width: 18,
                                          height: 18,
                                          child: CircularProgressIndicator(
                                            strokeWidth: 2,
                                            color: Colors.white,
                                          ),
                                        )
                                      : const Icon(
                                          Icons.check_rounded,
                                        ),
                                  label: const Text(
                                    'Accept Job',
                                  ),
                                ),
                              ),
                            ],
                          ),
                        ] else if (upcomingStatus != null)
                          SizedBox(
                            width: double.infinity,
                            child: ElevatedButton.icon(
                              onPressed: isProcessing
                                  ? null
                                  : () async {
                                      setSheetState(
                                        () {
                                          isProcessing = true;
                                        },
                                      );

                                      final bool success = await performAction(
                                        delivery: delivery,
                                        action: 'STATUS',
                                        status: upcomingStatus,
                                      );

                                      if (!sheetContext.mounted) {
                                        return;
                                      }

                                      if (success) {
                                        Navigator.of(
                                          sheetContext,
                                        ).pop();
                                        return;
                                      }

                                      setSheetState(
                                        () {
                                          isProcessing = false;
                                        },
                                      );
                                    },
                              style: ElevatedButton.styleFrom(
                                backgroundColor: primaryGreen,
                                foregroundColor: Colors.white,
                                minimumSize: const Size(
                                  double.infinity,
                                  54,
                                ),
                              ),
                              icon: isProcessing
                                  ? const SizedBox(
                                      width: 18,
                                      height: 18,
                                      child: CircularProgressIndicator(
                                        strokeWidth: 2,
                                        color: Colors.white,
                                      ),
                                    )
                                  : const Icon(
                                      Icons.arrow_forward_rounded,
                                    ),
                              label: Text(
                                nextStatusLabel(
                                  upcomingStatus,
                                ),
                              ),
                            ),
                          )
                        else if (status == 'DELIVERED')
                          Container(
                            padding: const EdgeInsets.all(
                              16,
                            ),
                            decoration: BoxDecoration(
                              color: Colors.green.withValues(
                                alpha: 0.10,
                              ),
                              borderRadius: BorderRadius.circular(
                                14,
                              ),
                            ),
                            child: const Row(
                              children: [
                                Icon(
                                  Icons.check_circle_rounded,
                                  color: Colors.green,
                                ),
                                SizedBox(
                                  width: 10,
                                ),
                                Expanded(
                                  child: Text(
                                    'This delivery has been completed successfully.',
                                    style: TextStyle(
                                      fontWeight: FontWeight.w700,
                                    ),
                                  ),
                                ),
                              ],
                            ),
                          ),
                        const SizedBox(
                          height: 30,
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            );
          },
        );
      },
    );
  }

  Widget buildDeliveryCard(
    Map<String, dynamic> delivery,
  ) {
    final String status = RiderApi.text(
      delivery['status'],
      fallback: 'ASSIGNED',
    ).toUpperCase();

    final bool isNewJob = status == 'ASSIGNED';

    final Widget card = Card(
      elevation: isNewJob ? 6 : 1,
      margin: const EdgeInsets.only(
        bottom: 14,
      ),
      color: Colors.white,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(18),
        side: BorderSide(
          color: isNewJob ? Colors.orange : const Color(0xFFE2E8F0),
          width: isNewJob ? 2 : 1,
        ),
      ),
      child: InkWell(
        onTap: () {
          openDeliveryDetails(
            delivery,
          );
        },
        borderRadius: BorderRadius.circular(18),
        child: Padding(
          padding: const EdgeInsets.all(
            16,
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Container(
                    width: 48,
                    height: 48,
                    decoration: BoxDecoration(
                      color: getStatusColor(
                        status,
                      ).withValues(
                        alpha: 0.12,
                      ),
                      borderRadius: BorderRadius.circular(14),
                    ),
                    child: Icon(
                      isNewJob
                          ? Icons.notifications_active_rounded
                          : Icons.local_shipping_rounded,
                      color: getStatusColor(
                        status,
                      ),
                    ),
                  ),
                  const SizedBox(
                    width: 12,
                  ),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          RiderApi.text(
                            delivery['trackingNumber'],
                            fallback: 'Delivery Job',
                          ),
                          style: const TextStyle(
                            fontSize: 16,
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                        const SizedBox(
                          height: 3,
                        ),
                        Text(
                          customerName(
                            delivery,
                          ),
                          style: const TextStyle(
                            color: Colors.black54,
                          ),
                        ),
                      ],
                    ),
                  ),
                  _RiderStatusBadge(
                    text: formatStatus(
                      status,
                    ),
                    color: getStatusColor(
                      status,
                    ),
                  ),
                ],
              ),
              const SizedBox(
                height: 14,
              ),
              _DeliveryAddressLine(
                icon: Icons.location_on_outlined,
                label: 'Pickup',
                value: RiderApi.text(
                  delivery['pickupAddress'],
                  fallback: 'Not available',
                ),
              ),
              const SizedBox(
                height: 8,
              ),
              _DeliveryAddressLine(
                icon: Icons.flag_outlined,
                label: 'Destination',
                value: RiderApi.text(
                  delivery['deliveryAddress'],
                  fallback: 'Not available',
                ),
              ),
              const SizedBox(
                height: 12,
              ),
              Row(
                children: [
                  Expanded(
                    child: Text(
                      packageName(
                        delivery,
                      ),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ),
                  Text(
                    formatMoney(
                      delivery['deliveryFee'],
                    ),
                    style: const TextStyle(
                      color: primaryGreen,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                ],
              ),
              if (isNewJob) ...[
                const SizedBox(
                  height: 12,
                ),
                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.symmetric(
                    horizontal: 12,
                    vertical: 10,
                  ),
                  decoration: BoxDecoration(
                    color: Colors.orange.withValues(
                      alpha: 0.10,
                    ),
                    borderRadius: BorderRadius.circular(
                      12,
                    ),
                  ),
                  child: const Text(
                    'New delivery job — tap to view and respond.',
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      color: Colors.orange,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                ),
              ],
            ],
          ),
        ),
      ),
    );

    if (!isNewJob) {
      return card;
    }

    return ScaleTransition(
      scale: pulseAnimation,
      child: card,
    );
  }

  @override
  Widget build(
    BuildContext context,
  ) {
    return Scaffold(
      backgroundColor: const Color(0xFFF5F7FA),
      appBar: AppBar(
        automaticallyImplyLeading: false,
        backgroundColor: Colors.white,
        surfaceTintColor: Colors.white,
        title: const Text(
          'My Deliveries',
          style: TextStyle(
            fontWeight: FontWeight.bold,
          ),
        ),
        actions: [
          IconButton(
            tooltip: 'Refresh',
            onPressed: isRefreshing
                ? null
                : () {
                    loadDeliveries(
                      refresh: true,
                    );
                  },
            icon: isRefreshing
                ? const SizedBox(
                    width: 20,
                    height: 20,
                    child: CircularProgressIndicator(
                      strokeWidth: 2,
                    ),
                  )
                : const Icon(
                    Icons.refresh_rounded,
                  ),
          ),
        ],
      ),
      body: isLoading
          ? const Center(
              child: CircularProgressIndicator(),
            )
          : hasError
              ? Center(
                  child: Padding(
                    padding: const EdgeInsets.all(24),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        const Icon(
                          Icons.cloud_off_rounded,
                          size: 60,
                          color: Colors.red,
                        ),
                        const SizedBox(
                          height: 14,
                        ),
                        Text(
                          errorMessage,
                          textAlign: TextAlign.center,
                        ),
                        const SizedBox(
                          height: 14,
                        ),
                        ElevatedButton.icon(
                          onPressed: loadDeliveries,
                          icon: const Icon(
                            Icons.refresh_rounded,
                          ),
                          label: const Text(
                            'Try Again',
                          ),
                        ),
                      ],
                    ),
                  ),
                )
              : RefreshIndicator(
                  onRefresh: () {
                    return loadDeliveries(
                      refresh: true,
                    );
                  },
                  child: ListView(
                    padding: const EdgeInsets.all(16),
                    children: [
                      SizedBox(
                        height: 42,
                        child: ListView(
                          scrollDirection: Axis.horizontal,
                          children: [
                            'ALL',
                            'ASSIGNED',
                            'ACCEPTED',
                            'PICKED_UP',
                            'IN_TRANSIT',
                            'DELIVERED',
                          ].map(
                            (
                              String status,
                            ) {
                              final bool selected = selectedStatus == status;

                              return Padding(
                                padding: const EdgeInsets.only(
                                  right: 8,
                                ),
                                child: ChoiceChip(
                                  selected: selected,
                                  label: Text(
                                    formatStatus(
                                      status,
                                    ),
                                  ),
                                  selectedColor: primaryGreen,
                                  backgroundColor: Colors.white,
                                  labelStyle: TextStyle(
                                    color: selected
                                        ? Colors.white
                                        : Colors.black54,
                                    fontWeight: FontWeight.w700,
                                  ),
                                  onSelected: (_) {
                                    setState(
                                      () {
                                        selectedStatus = status;
                                      },
                                    );

                                    loadDeliveries();
                                  },
                                ),
                              );
                            },
                          ).toList(),
                        ),
                      ),
                      const SizedBox(
                        height: 16,
                      ),
                      if (deliveries.isEmpty)
                        const RiderEmptyScreen(
                          title: 'No Deliveries',
                          message:
                              'Your assigned delivery jobs will appear here.',
                          icon: Icons.local_shipping_outlined,
                          showAppBar: false,
                        )
                      else
                        ...deliveries.map(
                          buildDeliveryCard,
                        ),
                      const SizedBox(
                        height: 30,
                      ),
                    ],
                  ),
                ),
    );
  }
}

class RiderEarningsScreen extends StatefulWidget {
  const RiderEarningsScreen({
    super.key,
  });

  @override
  State<RiderEarningsScreen> createState() => _RiderEarningsScreenState();
}

class _RiderEarningsScreenState extends State<RiderEarningsScreen> {
  bool isLoading = true;

  double totalEarnings = 0;
  double pendingSettlement = 0;
  double settledEarnings = 0;

  int completedDeliveries = 0;

  @override
  void initState() {
    super.initState();
    loadEarnings();
  }

  Future<void> loadEarnings() async {
    if (mounted) {
      setState(() {
        isLoading = true;
      });
    }

    try {
      final Map<String, dynamic> user = await RiderApi.getProfile();

      await RiderApi.saveProfile(user);

      if (!mounted) {
        return;
      }

      setState(() {
        totalEarnings = RiderApi.number(
          user['totalRiderEarnings'],
        );

        pendingSettlement = RiderApi.number(
          user['pendingRiderSettlement'],
        );

        settledEarnings = RiderApi.number(
          user['settledRiderEarnings'],
        );

        completedDeliveries = RiderApi.integer(
          user['totalCompletedDeliveries'],
        );

        isLoading = false;
      });
    } catch (_) {
      if (!mounted) {
        return;
      }

      setState(() {
        isLoading = false;
      });
    }
  }

  String formatMoney(
    double value,
  ) {
    return '₦${value.toStringAsFixed(2)}';
  }

  Widget earningsCard({
    required String title,
    required String value,
    required IconData icon,
  }) {
    return Container(
      padding: const EdgeInsets.all(17),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(17),
        border: Border.all(
          color: const Color(0xFFE2E8F0),
        ),
      ),
      child: Row(
        children: [
          Container(
            width: 46,
            height: 46,
            decoration: BoxDecoration(
              color: const Color(0xFF159447).withValues(
                alpha: 0.10,
              ),
              borderRadius: BorderRadius.circular(13),
            ),
            child: Icon(
              icon,
              color: const Color(0xFF159447),
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: const TextStyle(
                    color: Colors.black54,
                    fontSize: 12,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  value,
                  style: const TextStyle(
                    fontSize: 18,
                    fontWeight: FontWeight.bold,
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
  Widget build(
    BuildContext context,
  ) {
    return Scaffold(
      backgroundColor: const Color(0xFFF5F7FA),
      appBar: AppBar(
        automaticallyImplyLeading: false,
        backgroundColor: Colors.white,
        surfaceTintColor: Colors.white,
        title: const Text(
          'Rider Earnings',
          style: TextStyle(
            fontWeight: FontWeight.bold,
          ),
        ),
        actions: [
          IconButton(
            tooltip: 'Refresh',
            onPressed: isLoading ? null : loadEarnings,
            icon: const Icon(
              Icons.refresh_rounded,
            ),
          ),
        ],
      ),
      body: isLoading
          ? const Center(
              child: CircularProgressIndicator(),
            )
          : RefreshIndicator(
              onRefresh: loadEarnings,
              child: ListView(
                padding: const EdgeInsets.all(16),
                children: [
                  Container(
                    padding: const EdgeInsets.all(22),
                    decoration: BoxDecoration(
                      gradient: const LinearGradient(
                        colors: [
                          Color(0xFF159447),
                          Color(0xFF0F766E),
                        ],
                      ),
                      borderRadius: BorderRadius.circular(20),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text(
                          'Total Rider Earnings',
                          style: TextStyle(
                            color: Colors.white70,
                          ),
                        ),
                        const SizedBox(height: 8),
                        Text(
                          formatMoney(
                            totalEarnings,
                          ),
                          style: const TextStyle(
                            color: Colors.white,
                            fontSize: 28,
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                        const SizedBox(height: 10),
                        Text(
                          '$completedDeliveries completed deliveries',
                          style: const TextStyle(
                            color: Colors.white70,
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 16),
                  earningsCard(
                    title: 'Pending Settlement',
                    value: formatMoney(
                      pendingSettlement,
                    ),
                    icon: Icons.hourglass_top_rounded,
                  ),
                  const SizedBox(height: 12),
                  earningsCard(
                    title: 'Settled Earnings',
                    value: formatMoney(
                      settledEarnings,
                    ),
                    icon: Icons.check_circle_outline,
                  ),
                  const SizedBox(height: 12),
                  earningsCard(
                    title: 'Completed Deliveries',
                    value: completedDeliveries.toString(),
                    icon: Icons.local_shipping_outlined,
                  ),
                  const SizedBox(height: 18),
                  SizedBox(
                    width: double.infinity,
                    height: 54,
                    child: FilledButton.icon(
                      onPressed: () async {
                        await Navigator.of(context).push<void>(
                          MaterialPageRoute(
                            builder: (_) => const RiderWithdrawalScreen(),
                          ),
                        );

                        if (!mounted) {
                          return;
                        }

                        await loadEarnings();
                      },
                      style: FilledButton.styleFrom(
                        backgroundColor: const Color(0xFF159447),
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(14),
                        ),
                      ),
                      icon: const Icon(
                        Icons.account_balance_rounded,
                      ),
                      label: const Text(
                        'Withdraw Commission',
                        style: TextStyle(
                          fontSize: 16,
                          fontWeight: FontWeight.bold,
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

class RiderProfileScreen extends StatefulWidget {
  const RiderProfileScreen({
    super.key,
  });

  @override
  State<RiderProfileScreen> createState() => _RiderProfileScreenState();
}

class _RiderProfileScreenState extends State<RiderProfileScreen> {
  String riderName = 'Delivery Rider';

  String riderId = '';
  String phone = '';
  String email = '';
  String vehicleType = '';
  String plateNumber = '';
  String riderState = '';
  String riderLga = '';

  String verificationStatus = 'PENDING';

  bool isLoading = true;

  @override
  void initState() {
    super.initState();
    loadProfile();
  }

  Future<void> loadProfile() async {
    if (mounted) {
      setState(() {
        isLoading = true;
      });
    }

    try {
      final Map<String, dynamic> user = await RiderApi.getProfile();

      await RiderApi.saveProfile(user);

      if (!mounted) {
        return;
      }

      setState(() {
        riderName = RiderApi.text(
          user['fullName'],
          fallback: 'Delivery Rider',
        );

        riderId = RiderApi.text(
          user['riderId'],
        );

        phone = RiderApi.text(
          user['phone'],
        );

        email = RiderApi.text(
          user['email'],
        );

        vehicleType = RiderApi.text(
          user['vehicleType'],
        ).replaceAll('_', ' ');

        plateNumber = RiderApi.text(
          user['plateNumber'],
        );

        riderState = RiderApi.text(
          user['riderState'] ?? user['state'],
        );

        riderLga = RiderApi.text(
          user['riderLga'] ?? user['lga'],
        );

        verificationStatus = RiderApi.text(
          user['riderVerificationStatus'],
          fallback: 'PENDING',
        ).toUpperCase();

        isLoading = false;
      });
    } catch (_) {
      final SharedPreferences prefs = await SharedPreferences.getInstance();

      if (!mounted) {
        return;
      }

      setState(() {
        riderName = prefs.getString(
              'user_name',
            ) ??
            'Delivery Rider';

        riderId = prefs.getString(
              'rider_id',
            ) ??
            '';

        phone = prefs.getString(
              'user_phone',
            ) ??
            '';

        email = prefs.getString(
              'user_email',
            ) ??
            '';

        vehicleType = (prefs.getString(
                  'rider_vehicle_type',
                ) ??
                '')
            .replaceAll('_', ' ');

        plateNumber = prefs.getString(
              'rider_plate_number',
            ) ??
            '';

        riderState = prefs.getString(
              'rider_state',
            ) ??
            '';

        riderLga = prefs.getString(
              'rider_lga',
            ) ??
            '';

        verificationStatus = (prefs.getString(
                  'rider_verification_status',
                ) ??
                'PENDING')
            .toUpperCase();

        isLoading = false;
      });
    }
  }

  Future<void> logout(
    BuildContext context,
  ) async {
    final SharedPreferences prefs = await SharedPreferences.getInstance();

    await prefs.clear();

    if (!context.mounted) {
      return;
    }

    Navigator.pushAndRemoveUntil(
      context,
      MaterialPageRoute(
        builder: (_) => const LoginScreen(),
      ),
      (
        Route<dynamic> route,
      ) =>
          false,
    );
  }

  Widget buildInfoTile({
    required IconData icon,
    required String title,
    required String value,
  }) {
    return ListTile(
      contentPadding: const EdgeInsets.symmetric(
        horizontal: 4,
      ),
      leading: CircleAvatar(
        backgroundColor: const Color(0xFFE8F5EC),
        child: Icon(
          icon,
          color: const Color(0xFF159447),
        ),
      ),
      title: Text(
        title,
        style: const TextStyle(
          color: Colors.black54,
          fontSize: 12,
        ),
      ),
      subtitle: Text(
        value.trim().isEmpty ? 'Not available' : value,
        style: const TextStyle(
          fontWeight: FontWeight.w700,
        ),
      ),
    );
  }

  @override
  Widget build(
    BuildContext context,
  ) {
    final String initial = riderName.trim().isEmpty
        ? 'R'
        : riderName.trim().substring(0, 1).toUpperCase();

    final String location = [
      riderLga,
      riderState,
    ]
        .where(
          (
            String item,
          ) =>
              item.trim().isNotEmpty,
        )
        .join(', ');

    return Scaffold(
      backgroundColor: const Color(0xFFF5F7FA),
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
        actions: [
          IconButton(
            tooltip: 'Refresh',
            onPressed: isLoading ? null : loadProfile,
            icon: const Icon(
              Icons.refresh_rounded,
            ),
          ),
        ],
      ),
      body: isLoading
          ? const Center(
              child: CircularProgressIndicator(),
            )
          : RefreshIndicator(
              onRefresh: loadProfile,
              child: ListView(
                padding: const EdgeInsets.all(16),
                children: [
                  Container(
                    padding: const EdgeInsets.all(20),
                    decoration: BoxDecoration(
                      color: Colors.white,
                      borderRadius: BorderRadius.circular(
                        18,
                      ),
                    ),
                    child: Column(
                      children: [
                        CircleAvatar(
                          radius: 38,
                          backgroundColor: const Color(
                            0xFFE6F4EA,
                          ),
                          child: Text(
                            initial,
                            style: const TextStyle(
                              fontSize: 28,
                              fontWeight: FontWeight.bold,
                              color: Color(
                                0xFF159447,
                              ),
                            ),
                          ),
                        ),
                        const SizedBox(
                          height: 12,
                        ),
                        Text(
                          riderName,
                          textAlign: TextAlign.center,
                          style: const TextStyle(
                            fontSize: 20,
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                        if (riderId.isNotEmpty) ...[
                          const SizedBox(
                            height: 4,
                          ),
                          Text(
                            'Rider ID: $riderId',
                            style: const TextStyle(
                              color: Colors.black54,
                            ),
                          ),
                        ],
                        const SizedBox(
                          height: 10,
                        ),
                        Container(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 12,
                            vertical: 6,
                          ),
                          decoration: BoxDecoration(
                            color: verificationStatus == 'VERIFIED'
                                ? Colors.green.withValues(
                                    alpha: 0.12,
                                  )
                                : Colors.orange.withValues(
                                    alpha: 0.12,
                                  ),
                            borderRadius: BorderRadius.circular(
                              20,
                            ),
                          ),
                          child: Text(
                            verificationStatus,
                            style: TextStyle(
                              color: verificationStatus == 'VERIFIED'
                                  ? Colors.green.shade800
                                  : Colors.orange.shade800,
                              fontSize: 12,
                              fontWeight: FontWeight.bold,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(
                    height: 16,
                  ),
                  Card(
                    elevation: 0,
                    color: Colors.white,
                    child: Padding(
                      padding: const EdgeInsets.all(
                        12,
                      ),
                      child: Column(
                        children: [
                          buildInfoTile(
                            icon: Icons.phone_outlined,
                            title: 'Phone number',
                            value: phone,
                          ),
                          buildInfoTile(
                            icon: Icons.email_outlined,
                            title: 'Email address',
                            value: email,
                          ),
                          buildInfoTile(
                            icon: Icons.two_wheeler_outlined,
                            title: 'Vehicle type',
                            value: vehicleType,
                          ),
                          buildInfoTile(
                            icon: Icons.confirmation_number_outlined,
                            title: 'Plate number',
                            value: plateNumber,
                          ),
                          buildInfoTile(
                            icon: Icons.location_on_outlined,
                            title: 'Location',
                            value: location,
                          ),
                        ],
                      ),
                    ),
                  ),
                  const SizedBox(
                    height: 16,
                  ),
                  Card(
                    elevation: 0,
                    color: Colors.white,
                    child: ListTile(
                      leading: const Icon(
                        Icons.logout,
                        color: Colors.red,
                      ),
                      title: const Text(
                        'Log out',
                        style: TextStyle(
                          color: Colors.red,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                      onTap: () => logout(context),
                    ),
                  ),
                  const SizedBox(
                    height: 30,
                  ),
                ],
              ),
            ),
    );
  }
}

class RiderEmptyScreen extends StatelessWidget {
  const RiderEmptyScreen({
    required this.title,
    required this.message,
    required this.icon,
    this.showAppBar = true,
    super.key,
  });

  final String title;
  final String message;
  final IconData icon;
  final bool showAppBar;

  @override
  Widget build(
    BuildContext context,
  ) {
    final Widget content = Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Container(
              width: 90,
              height: 90,
              decoration: BoxDecoration(
                color: const Color(0xFF159447).withValues(
                  alpha: 0.10,
                ),
                shape: BoxShape.circle,
              ),
              child: Icon(
                icon,
                size: 46,
                color: const Color(0xFF159447),
              ),
            ),
            const SizedBox(height: 18),
            Text(
              title,
              style: const TextStyle(
                fontSize: 22,
                fontWeight: FontWeight.bold,
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
    );

    if (!showAppBar) {
      return SizedBox(
        height: 360,
        child: content,
      );
    }

    return Scaffold(
      backgroundColor: const Color(0xFFF5F7FA),
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
      body: content,
    );
  }
}

class _RiderStatusBadge extends StatelessWidget {
  const _RiderStatusBadge({
    required this.text,
    required this.color,
  });

  final String text;
  final Color color;

  @override
  Widget build(
    BuildContext context,
  ) {
    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: 9,
        vertical: 5,
      ),
      decoration: BoxDecoration(
        color: color.withValues(
          alpha: 0.12,
        ),
        borderRadius: BorderRadius.circular(20),
      ),
      child: Text(
        text,
        style: TextStyle(
          color: color,
          fontSize: 10,
          fontWeight: FontWeight.w800,
        ),
      ),
    );
  }
}

class _DeliveryAddressLine extends StatelessWidget {
  const _DeliveryAddressLine({
    required this.icon,
    required this.label,
    required this.value,
  });

  final IconData icon;
  final String label;
  final String value;

  @override
  Widget build(
    BuildContext context,
  ) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Icon(
          icon,
          size: 18,
          color: const Color(0xFF159447),
        ),
        const SizedBox(width: 8),
        Expanded(
          child: RichText(
            text: TextSpan(
              style: const TextStyle(
                color: Colors.black87,
                fontSize: 13,
                height: 1.4,
              ),
              children: [
                TextSpan(
                  text: '$label: ',
                  style: const TextStyle(
                    fontWeight: FontWeight.bold,
                  ),
                ),
                TextSpan(
                  text: value,
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }
}

class _RiderDetailSection extends StatelessWidget {
  const _RiderDetailSection({
    required this.title,
    required this.children,
  });

  final String title;
  final List<Widget> children;

  @override
  Widget build(
    BuildContext context,
  ) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(
          color: const Color(0xFFE2E8F0),
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            title,
            style: const TextStyle(
              fontSize: 15,
              fontWeight: FontWeight.bold,
            ),
          ),
          const SizedBox(height: 12),
          ...children,
        ],
      ),
    );
  }
}

class _RiderDetailRow extends StatelessWidget {
  const _RiderDetailRow({
    required this.icon,
    required this.label,
    required this.value,
  });

  final IconData icon;
  final String label;
  final String value;

  @override
  Widget build(
    BuildContext context,
  ) {
    return Padding(
      padding: const EdgeInsets.only(
        bottom: 12,
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(
            icon,
            size: 19,
            color: const Color(0xFF159447),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  label,
                  style: const TextStyle(
                    color: Colors.black54,
                    fontSize: 11,
                  ),
                ),
                const SizedBox(height: 3),
                Text(
                  value,
                  style: const TextStyle(
                    fontWeight: FontWeight.w700,
                    height: 1.4,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

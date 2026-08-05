import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

import '../login_screen.dart';

class RiderMainNavigation extends StatefulWidget {
  const RiderMainNavigation({
    super.key,
  });

  @override
  State<RiderMainNavigation> createState() =>
      _RiderMainNavigationState();
}

class _RiderMainNavigationState
    extends State<RiderMainNavigation> {
  int currentIndex = 0;

  final List<Widget> pages = const [
    RiderDashboardScreen(),
    RiderDeliveriesScreen(),
    RiderEarningsScreen(),
    RiderProfileScreen(),
  ];

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: IndexedStack(
        index: currentIndex,
        children: pages,
      ),
      bottomNavigationBar: NavigationBar(
        selectedIndex: currentIndex,
        onDestinationSelected: (int index) {
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
    super.key,
  });

  @override
  State<RiderDashboardScreen> createState() =>
      _RiderDashboardScreenState();
}

class _RiderDashboardScreenState
    extends State<RiderDashboardScreen> {
  static const String baseUrl =
      'https://api.servicepay.ng/api';

  static const Color primaryGreen =
      Color(0xFF159447);

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

  double todayEarnings = 0;
  double totalEarnings = 0;

  @override
  void initState() {
    super.initState();
    loadRiderDetails();
  }

  Map<String, dynamic> mapFromDynamic(
    dynamic value,
  ) {
    if (value is Map) {
      return Map<String, dynamic>.from(value);
    }

    return <String, dynamic>{};
  }

  String textFromDynamic(
    dynamic value, {
    String fallback = '',
  }) {
    final String text =
        value?.toString().trim() ?? '';

    return text.isEmpty ? fallback : text;
  }

  int intFromDynamic(
    dynamic value,
  ) {
    return int.tryParse(
          value?.toString() ?? '0',
        ) ??
        0;
  }

  double doubleFromDynamic(
    dynamic value,
  ) {
    return double.tryParse(
          value?.toString() ?? '0',
        ) ??
        0;
  }

  Future<String> getToken() async {
    final SharedPreferences prefs =
        await SharedPreferences.getInstance();

    const List<String> tokenKeys = [
      'auth_token',
      'token',
      'access_token',
      'accessToken',
      'jwt_token',
      'jwt',
    ];

    for (final String key in tokenKeys) {
      String token =
          prefs.getString(key)?.trim() ?? '';

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
          backgroundColor: isError
              ? Colors.red.shade700
              : Colors.green.shade700,
        ),
      );
  }

  Future<void> saveRiderData(
    Map<String, dynamic> user,
  ) async {
    final SharedPreferences prefs =
        await SharedPreferences.getInstance();

    final String newName = textFromDynamic(
      user['fullName'],
      fallback: 'Delivery Rider',
    );

    final String newRiderId =
        textFromDynamic(
      user['riderId'],
    );

    final String newVerification =
        textFromDynamic(
      user['riderVerificationStatus'],
      fallback: 'PENDING',
    ).toUpperCase();

    final String newAvailability =
        textFromDynamic(
      user['availabilityStatus'],
      fallback: 'OFFLINE',
    ).toUpperCase();

    await prefs.setString(
      'user_name',
      newName,
    );

    await prefs.setString(
      'rider_id',
      newRiderId,
    );

    await prefs.setString(
      'rider_verification_status',
      newVerification,
    );

    await prefs.setString(
      'rider_availability_status',
      newAvailability,
    );

    await prefs.setBool(
      'rider_is_online',
      newAvailability == 'ONLINE',
    );
  }

  Future<void> loadSavedRiderDetails() async {
    final SharedPreferences prefs =
        await SharedPreferences.getInstance();

    riderName =
        prefs.getString('user_name') ??
            'Delivery Rider';

    riderId =
        prefs.getString('rider_id') ?? '';

    verificationStatus =
        (prefs.getString(
                  'rider_verification_status',
                ) ??
                'PENDING')
            .toUpperCase();

    availabilityStatus =
        (prefs.getString(
                  'rider_availability_status',
                ) ??
                'OFFLINE')
            .toUpperCase();

    isOnline =
        availabilityStatus == 'ONLINE';
  }

  Future<void> loadRiderDetails() async {
    if (mounted) {
      setState(() {
        isLoading = true;
      });
    }

    try {
      await loadSavedRiderDetails();

      final String token = await getToken();

      if (token.isEmpty) {
        throw Exception(
          'Rider login token was not found.',
        );
      }

      final http.Response response =
          await http
              .get(
                Uri.parse(
                  '$baseUrl/auth/profile',
                ),
                headers: {
                  'Accept': 'application/json',
                  'Authorization':
                      'Bearer $token',
                },
              )
              .timeout(
                const Duration(seconds: 30),
              );

      final dynamic decoded =
          response.body.trim().isEmpty
              ? <String, dynamic>{}
              : jsonDecode(response.body);

      final Map<String, dynamic> result =
          mapFromDynamic(decoded);

      if (response.statusCode < 200 ||
          response.statusCode >= 300) {
        throw Exception(
          textFromDynamic(
            result['message'],
            fallback:
                'Unable to load rider profile.',
          ),
        );
      }

      Map<String, dynamic> user =
          mapFromDynamic(
        result['user'],
      );

      if (user.isEmpty) {
        final Map<String, dynamic> data =
            mapFromDynamic(
          result['data'],
        );

        user = mapFromDynamic(
          data['user'],
        );
      }

      if (user.isEmpty) {
        throw Exception(
          'Rider profile information was not received.',
        );
      }

      final String role =
          textFromDynamic(
        user['role'],
        fallback: 'CUSTOMER',
      ).toUpperCase();

      if (role != 'DELIVERY_RIDER') {
        throw Exception(
          'This account is not a Delivery Rider account.',
        );
      }

      await saveRiderData(user);

      if (!mounted) {
        return;
      }

      setState(() {
        riderName = textFromDynamic(
          user['fullName'],
          fallback: 'Delivery Rider',
        );

        riderId = textFromDynamic(
          user['riderId'],
        );

        verificationStatus =
            textFromDynamic(
          user['riderVerificationStatus'],
          fallback: 'PENDING',
        ).toUpperCase();

        availabilityStatus =
            textFromDynamic(
          user['availabilityStatus'],
          fallback: 'OFFLINE',
        ).toUpperCase();

        isOnline =
            availabilityStatus == 'ONLINE';

        assignedDeliveries =
            intFromDynamic(
          user['totalAssignedDeliveries'],
        );

        completedDeliveries =
            intFromDynamic(
          user['totalCompletedDeliveries'],
        );

        activeDeliveries =
            assignedDeliveries -
                completedDeliveries;

        if (activeDeliveries < 0) {
          activeDeliveries = 0;
        }

        totalEarnings =
            doubleFromDynamic(
          user['totalRiderEarnings'],
        );

        todayEarnings =
            doubleFromDynamic(
          user['todayRiderEarnings'],
        );
      });
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

    if (value &&
        verificationStatus != 'VERIFIED') {
      showMessage(
        'Your rider account must be verified before going online.',
      );
      return;
    }

    setState(() {
      isUpdatingAvailability = true;
    });

    try {
      final String token = await getToken();

      if (token.isEmpty) {
        throw Exception(
          'Rider login token was not found.',
        );
      }

      final String requestedStatus =
          value ? 'ONLINE' : 'OFFLINE';

      final http.Response response =
          await http
              .patch(
                Uri.parse(
                  '$baseUrl/auth/rider/availability',
                ),
                headers: {
                  'Content-Type':
                      'application/json',
                  'Accept':
                      'application/json',
                  'Authorization':
                      'Bearer $token',
                },
                body: jsonEncode({
                  'availabilityStatus':
                      requestedStatus,
                }),
              )
              .timeout(
                const Duration(seconds: 30),
              );

      final dynamic decoded =
          response.body.trim().isEmpty
              ? <String, dynamic>{}
              : jsonDecode(response.body);

      final Map<String, dynamic> result =
          mapFromDynamic(decoded);

      if (response.statusCode < 200 ||
          response.statusCode >= 300) {
        throw Exception(
          textFromDynamic(
            result['message'],
            fallback:
                'Unable to update rider availability.',
          ),
        );
      }

      Map<String, dynamic> user =
          mapFromDynamic(
        result['user'],
      );

      if (user.isEmpty) {
        final Map<String, dynamic> data =
            mapFromDynamic(
          result['data'],
        );

        user = mapFromDynamic(
          data['user'],
        );
      }

      final String updatedStatus =
          textFromDynamic(
        user['availabilityStatus'],
        fallback: requestedStatus,
      ).toUpperCase();

      final SharedPreferences prefs =
          await SharedPreferences.getInstance();

      await prefs.setString(
        'rider_availability_status',
        updatedStatus,
      );

      await prefs.setBool(
        'rider_is_online',
        updatedStatus == 'ONLINE',
      );

      if (!mounted) {
        return;
      }

      setState(() {
        availabilityStatus =
            updatedStatus;

        isOnline =
            updatedStatus == 'ONLINE';
      });

      showMessage(
        textFromDynamic(
          result['message'],
          fallback: isOnline
              ? 'You are now online.'
              : 'You are now offline.',
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
      backgroundColor:
          const Color(0xFFF5F7FA),
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
            onPressed: loadRiderDetails,
            tooltip: 'Refresh',
            icon: const Icon(
              Icons.refresh_rounded,
            ),
          ),
          IconButton(
            onPressed: () {},
            icon: const Badge(
              child: Icon(
                Icons.notifications_outlined,
              ),
            ),
          ),
          const SizedBox(width: 8),
        ],
      ),
      body: isLoading
          ? const Center(
              child:
                  CircularProgressIndicator(),
            )
          : RefreshIndicator(
              onRefresh: loadRiderDetails,
              child: ListView(
                padding:
                    const EdgeInsets.all(16),
                children: [
                  Container(
                    padding:
                        const EdgeInsets.all(18),
                    decoration: BoxDecoration(
                      gradient:
                          const LinearGradient(
                        colors: [
                          Color(0xFF159447),
                          Color(0xFF0F766E),
                        ],
                        begin:
                            Alignment.topLeft,
                        end:
                            Alignment.bottomRight,
                      ),
                      borderRadius:
                          BorderRadius.circular(
                        22,
                      ),
                      boxShadow: [
                        BoxShadow(
                          color: primaryGreen
                              .withValues(
                            alpha: 0.22,
                          ),
                          blurRadius: 18,
                          offset:
                              const Offset(0, 8),
                        ),
                      ],
                    ),
                    child: Column(
                      crossAxisAlignment:
                          CrossAxisAlignment
                              .start,
                      children: [
                        Row(
                          children: [
                            Container(
                              width: 56,
                              height: 56,
                              decoration:
                                  BoxDecoration(
                                color: Colors.white
                                    .withValues(
                                  alpha: 0.18,
                                ),
                                shape:
                                    BoxShape.circle,
                              ),
                              child: const Icon(
                                Icons
                                    .delivery_dining_rounded,
                                color:
                                    Colors.white,
                                size: 34,
                              ),
                            ),
                            const SizedBox(
                              width: 14,
                            ),
                            Expanded(
                              child: Column(
                                crossAxisAlignment:
                                    CrossAxisAlignment
                                        .start,
                                children: [
                                  const Text(
                                    'Welcome back',
                                    style:
                                        TextStyle(
                                      color: Colors
                                          .white70,
                                      fontSize: 13,
                                    ),
                                  ),
                                  const SizedBox(
                                    height: 3,
                                  ),
                                  Text(
                                    riderName,
                                    maxLines: 1,
                                    overflow:
                                        TextOverflow
                                            .ellipsis,
                                    style:
                                        const TextStyle(
                                      color:
                                          Colors.white,
                                      fontSize: 20,
                                      fontWeight:
                                          FontWeight
                                              .bold,
                                    ),
                                  ),
                                  if (riderId
                                      .isNotEmpty)
                                    Text(
                                      'Rider ID: $riderId',
                                      style:
                                          const TextStyle(
                                        color: Colors
                                            .white70,
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
                          padding:
                              const EdgeInsets
                                  .symmetric(
                            horizontal: 14,
                            vertical: 10,
                          ),
                          decoration:
                              BoxDecoration(
                            color: Colors.white
                                .withValues(
                              alpha: 0.14,
                            ),
                            borderRadius:
                                BorderRadius
                                    .circular(14),
                          ),
                          child: Row(
                            children: [
                              Icon(
                                isOnline
                                    ? Icons
                                        .radio_button_checked
                                    : Icons
                                        .radio_button_off,
                                color:
                                    Colors.white,
                              ),
                              const SizedBox(
                                width: 10,
                              ),
                              Expanded(
                                child: Column(
                                  crossAxisAlignment:
                                      CrossAxisAlignment
                                          .start,
                                  children: [
                                    Text(
                                      isOnline
                                          ? 'You are online'
                                          : 'You are offline',
                                      style:
                                          const TextStyle(
                                        color:
                                            Colors.white,
                                        fontWeight:
                                            FontWeight
                                                .w700,
                                      ),
                                    ),
                                    Text(
                                      isOnline
                                          ? 'Available for delivery jobs'
                                          : 'Turn on when you are ready',
                                      style:
                                          const TextStyle(
                                        color: Colors
                                            .white70,
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
                                  child:
                                      CircularProgressIndicator(
                                    strokeWidth: 2,
                                    color:
                                        Colors.white,
                                  ),
                                )
                              else
                                Switch(
                                  value: isOnline,
                                  onChanged:
                                      toggleAvailability,
                                  activeThumbColor:
                                      Colors.white,
                                  activeTrackColor:
                                      Colors
                                          .greenAccent,
                                ),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 16),
                  if (verificationStatus ==
                      'VERIFIED')
                    Container(
                      padding:
                          const EdgeInsets.all(
                        14,
                      ),
                      decoration: BoxDecoration(
                        color: Colors.green
                            .withValues(
                          alpha: 0.10,
                        ),
                        borderRadius:
                            BorderRadius.circular(
                          14,
                        ),
                        border: Border.all(
                          color: Colors.green
                              .withValues(
                            alpha: 0.30,
                          ),
                        ),
                      ),
                      child: const Row(
                        children: [
                          Icon(
                            Icons
                                .verified_rounded,
                            color: Colors.green,
                          ),
                          SizedBox(width: 10),
                          Expanded(
                            child: Text(
                              'Your rider account has been verified by ServicePay Head Office.',
                              style: TextStyle(
                                height: 1.4,
                                fontWeight:
                                    FontWeight.w600,
                              ),
                            ),
                          ),
                        ],
                      ),
                    )
                  else
                    Container(
                      padding:
                          const EdgeInsets.all(
                        14,
                      ),
                      decoration: BoxDecoration(
                        color: Colors.orange
                            .withValues(
                          alpha: 0.10,
                        ),
                        borderRadius:
                            BorderRadius.circular(
                          14,
                        ),
                        border: Border.all(
                          color: Colors.orange
                              .withValues(
                            alpha: 0.30,
                          ),
                        ),
                      ),
                      child: Row(
                        crossAxisAlignment:
                            CrossAxisAlignment
                                .start,
                        children: [
                          const Icon(
                            Icons
                                .verified_user_outlined,
                            color: Colors.orange,
                          ),
                          const SizedBox(
                            width: 10,
                          ),
                          Expanded(
                            child: Text(
                              'Verification status: '
                              '$verificationStatus. '
                              'You can go online after Head Office verification.',
                              style:
                                  const TextStyle(
                                height: 1.4,
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
                      fontWeight:
                          FontWeight.bold,
                    ),
                  ),
                  const SizedBox(height: 12),
                  GridView.count(
                    crossAxisCount: 3,
                    shrinkWrap: true,
                    physics:
                        const NeverScrollableScrollPhysics(),
                    crossAxisSpacing: 10,
                    mainAxisSpacing: 10,
                    childAspectRatio: 0.92,
                    children: [
                      RiderSummaryCard(
                        title: 'Assigned',
                        value:
                            assignedDeliveries
                                .toString(),
                        icon: Icons
                            .assignment_outlined,
                      ),
                      RiderSummaryCard(
                        title: 'Active',
                        value:
                            activeDeliveries
                                .toString(),
                        icon: Icons
                            .local_shipping_outlined,
                      ),
                      RiderSummaryCard(
                        title: 'Completed',
                        value:
                            completedDeliveries
                                .toString(),
                        icon: Icons
                            .check_circle_outline,
                      ),
                    ],
                  ),
                  const SizedBox(height: 20),
                  const Text(
                    'Earnings',
                    style: TextStyle(
                      fontSize: 18,
                      fontWeight:
                          FontWeight.bold,
                    ),
                  ),
                  const SizedBox(height: 12),
                  Row(
                    children: [
                      Expanded(
                        child:
                            RiderEarningCard(
                          title:
                              'Today Earnings',
                          amount: formatMoney(
                            todayEarnings,
                          ),
                          icon: Icons
                              .today_outlined,
                        ),
                      ),
                      const SizedBox(
                        width: 12,
                      ),
                      Expanded(
                        child:
                            RiderEarningCard(
                          title:
                              'Total Earnings',
                          amount: formatMoney(
                            totalEarnings,
                          ),
                          icon: Icons
                              .account_balance_wallet_outlined,
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 20),
                  const Text(
                    'Quick Actions',
                    style: TextStyle(
                      fontSize: 18,
                      fontWeight:
                          FontWeight.bold,
                    ),
                  ),
                  const SizedBox(height: 12),
                  Row(
                    children: [
                      Expanded(
                        child:
                            RiderActionButton(
                          label:
                              'View Deliveries',
                          icon: Icons
                              .local_shipping_outlined,
                          onTap: () {
                            showMessage(
                              'Assigned delivery jobs will appear in the Deliveries tab.',
                              isError: false,
                            );
                          },
                        ),
                      ),
                      const SizedBox(
                        width: 12,
                      ),
                      Expanded(
                        child:
                            RiderActionButton(
                          label:
                              'Refresh Status',
                          icon: Icons
                              .sync_rounded,
                          onTap:
                              loadRiderDetails,
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
        borderRadius:
            BorderRadius.circular(16),
        boxShadow: const [
          BoxShadow(
            color: Colors.black12,
            blurRadius: 10,
            offset: Offset(0, 4),
          ),
        ],
      ),
      child: Column(
        mainAxisAlignment:
            MainAxisAlignment.center,
        children: [
          Container(
            width: 40,
            height: 40,
            decoration: BoxDecoration(
              color:
                  const Color(0xFF159447)
                      .withValues(
                alpha: 0.10,
              ),
              borderRadius:
                  BorderRadius.circular(12),
            ),
            child: Icon(
              icon,
              color:
                  const Color(0xFF159447),
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

class RiderEarningCard
    extends StatelessWidget {
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
        borderRadius:
            BorderRadius.circular(16),
        boxShadow: const [
          BoxShadow(
            color: Colors.black12,
            blurRadius: 10,
            offset: Offset(0, 4),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment:
            CrossAxisAlignment.start,
        children: [
          Icon(
            icon,
            color:
                const Color(0xFF159447),
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

class RiderActionButton
    extends StatelessWidget {
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
      borderRadius:
          BorderRadius.circular(16),
      child: InkWell(
        onTap: onTap,
        borderRadius:
            BorderRadius.circular(16),
        child: Container(
          padding:
              const EdgeInsets.symmetric(
            vertical: 18,
            horizontal: 12,
          ),
          decoration: BoxDecoration(
            borderRadius:
                BorderRadius.circular(16),
            border: Border.all(
              color:
                  const Color(0xFFE2E8F0),
            ),
          ),
          child: Column(
            children: [
              Icon(
                icon,
                color:
                    const Color(0xFF159447),
                size: 28,
              ),
              const SizedBox(height: 8),
              Text(
                label,
                textAlign: TextAlign.center,
                style: const TextStyle(
                  fontWeight:
                      FontWeight.w700,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
class RiderDeliveriesScreen
    extends StatelessWidget {
  const RiderDeliveriesScreen({
    super.key,
  });

  @override
  Widget build(
    BuildContext context,
  ) {
    return const RiderEmptyScreen(
      title: 'My Deliveries',
      message:
          'Assigned delivery jobs will appear here.',
      icon: Icons.local_shipping_outlined,
    );
  }
}

class RiderEarningsScreen
    extends StatelessWidget {
  const RiderEarningsScreen({
    super.key,
  });

  @override
  Widget build(
    BuildContext context,
  ) {
    return const RiderEmptyScreen(
      title: 'Rider Earnings',
      message:
          'Your completed delivery earnings and settlements will appear here.',
      icon:
          Icons.account_balance_wallet_outlined,
    );
  }
}

class RiderProfileScreen
    extends StatefulWidget {
  const RiderProfileScreen({
    super.key,
  });

  @override
  State<RiderProfileScreen> createState() =>
      _RiderProfileScreenState();
}

class _RiderProfileScreenState
    extends State<RiderProfileScreen> {
  String riderName = 'Delivery Rider';
  String riderId = '';
  String phone = '';
  String email = '';
  String vehicleType = '';
  String plateNumber = '';
  String riderState = '';
  String riderLga = '';
  String verificationStatus = 'PENDING';

  @override
  void initState() {
    super.initState();
    loadProfile();
  }

  Future<void> loadProfile() async {
    final SharedPreferences prefs =
        await SharedPreferences.getInstance();

    if (!mounted) {
      return;
    }

    setState(() {
      riderName =
          prefs.getString('user_name') ??
              'Delivery Rider';

      riderId =
          prefs.getString('rider_id') ?? '';

      phone =
          prefs.getString('user_phone') ?? '';

      email =
          prefs.getString('user_email') ?? '';

      vehicleType =
          prefs.getString(
                'rider_vehicle_type',
              ) ??
              '';

      plateNumber =
          prefs.getString(
                'rider_plate_number',
              ) ??
              '';

      riderState =
          prefs.getString(
                'rider_state',
              ) ??
              '';

      riderLga =
          prefs.getString(
                'rider_lga',
              ) ??
              '';

      verificationStatus =
          (prefs.getString(
                    'rider_verification_status',
                  ) ??
                  'PENDING')
              .toUpperCase();
    });
  }

  Future<void> logout(
    BuildContext context,
  ) async {
    final SharedPreferences prefs =
        await SharedPreferences.getInstance();

    await prefs.clear();

    if (!context.mounted) {
      return;
    }

    Navigator.pushAndRemoveUntil(
      context,
      MaterialPageRoute(
        builder: (_) =>
            const LoginScreen(),
      ),
      (Route<dynamic> route) => false,
    );
  }

  Widget buildInfoTile({
    required IconData icon,
    required String title,
    required String value,
  }) {
    return ListTile(
      contentPadding:
          const EdgeInsets.symmetric(
        horizontal: 4,
      ),
      leading: CircleAvatar(
        backgroundColor:
            const Color(0xFFE8F5EC),
        child: Icon(
          icon,
          color:
              const Color(0xFF159447),
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
        value.isEmpty
            ? 'Not available'
            : value,
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
    final String initial = riderName
            .trim()
            .isNotEmpty
        ? riderName
            .trim()
            .substring(0, 1)
            .toUpperCase()
        : 'R';

    return Scaffold(
      backgroundColor:
          const Color(0xFFF5F7FA),
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
      ),
      body: RefreshIndicator(
        onRefresh: loadProfile,
        child: ListView(
          padding:
              const EdgeInsets.all(16),
          children: [
            Container(
              padding:
                  const EdgeInsets.all(20),
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius:
                    BorderRadius.circular(
                  18,
                ),
              ),
              child: Column(
                children: [
                  CircleAvatar(
                    radius: 38,
                    backgroundColor:
                        const Color(
                      0xFFE6F4EA,
                    ),
                    child: Text(
                      initial,
                      style: const TextStyle(
                        fontSize: 28,
                        fontWeight:
                            FontWeight.bold,
                        color:
                            Color(0xFF159447),
                      ),
                    ),
                  ),
                  const SizedBox(height: 12),
                  Text(
                    riderName,
                    textAlign: TextAlign.center,
                    style: const TextStyle(
                      fontSize: 20,
                      fontWeight:
                          FontWeight.bold,
                    ),
                  ),
                  if (riderId.isNotEmpty) ...[
                    const SizedBox(height: 4),
                    Text(
                      'Rider ID: $riderId',
                      style: const TextStyle(
                        color:
                            Colors.black54,
                      ),
                    ),
                  ],
                  const SizedBox(height: 10),
                  Container(
                    padding:
                        const EdgeInsets
                            .symmetric(
                      horizontal: 12,
                      vertical: 6,
                    ),
                    decoration:
                        BoxDecoration(
                      color: verificationStatus ==
                              'VERIFIED'
                          ? Colors.green
                              .withValues(
                              alpha: 0.12,
                            )
                          : Colors.orange
                              .withValues(
                              alpha: 0.12,
                            ),
                      borderRadius:
                          BorderRadius.circular(
                        20,
                      ),
                    ),
                    child: Text(
                      verificationStatus,
                      style: TextStyle(
                        color: verificationStatus ==
                                'VERIFIED'
                            ? Colors
                                .green.shade800
                            : Colors
                                .orange.shade800,
                        fontSize: 12,
                        fontWeight:
                            FontWeight.bold,
                      ),
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 16),
            Card(
              elevation: 0,
              color: Colors.white,
              child: Padding(
                padding:
                    const EdgeInsets.all(
                  12,
                ),
                child: Column(
                  children: [
                    buildInfoTile(
                      icon:
                          Icons.phone_outlined,
                      title: 'Phone number',
                      value: phone,
                    ),
                    buildInfoTile(
                      icon:
                          Icons.email_outlined,
                      title: 'Email address',
                      value: email,
                    ),
                    buildInfoTile(
                      icon: Icons
                          .two_wheeler_outlined,
                      title: 'Vehicle type',
                      value: vehicleType
                          .replaceAll(
                        '_',
                        ' ',
                      ),
                    ),
                    buildInfoTile(
                      icon: Icons
                          .confirmation_number_outlined,
                      title: 'Plate number',
                      value: plateNumber,
                    ),
                    buildInfoTile(
                      icon: Icons
                          .location_on_outlined,
                      title: 'Location',
                      value: [
                        riderLga,
                        riderState,
                      ]
                          .where(
                            (String item) =>
                                item
                                    .trim()
                                    .isNotEmpty,
                          )
                          .join(', '),
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 16),
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
                    fontWeight:
                        FontWeight.w700,
                  ),
                ),
                onTap: () =>
                    logout(context),
              ),
            ),
            const SizedBox(height: 30),
          ],
        ),
      ),
    );
  }
}

class RiderEmptyScreen
    extends StatelessWidget {
  const RiderEmptyScreen({
    required this.title,
    required this.message,
    required this.icon,
    super.key,
  });

  final String title;
  final String message;
  final IconData icon;

  @override
  Widget build(
    BuildContext context,
  ) {
    return Scaffold(
      backgroundColor:
          const Color(0xFFF5F7FA),
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
      body: Center(
        child: Padding(
          padding:
              const EdgeInsets.all(24),
          child: Column(
            mainAxisAlignment:
                MainAxisAlignment.center,
            children: [
              Container(
                width: 90,
                height: 90,
                decoration: BoxDecoration(
                  color:
                      const Color(0xFF159447)
                          .withValues(
                    alpha: 0.10,
                  ),
                  shape: BoxShape.circle,
                ),
                child: Icon(
                  icon,
                  size: 46,
                  color:
                      const Color(0xFF159447),
                ),
              ),
              const SizedBox(height: 18),
              Text(
                title,
                style: const TextStyle(
                  fontSize: 22,
                  fontWeight:
                      FontWeight.bold,
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
      ),
    );
  }
}
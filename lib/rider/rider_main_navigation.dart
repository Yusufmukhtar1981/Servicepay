import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

import '../keke_driver_screen.dart';
import '../login_screen.dart';
import 'rider_withdrawal_screen.dart';

class RiderApi {
  static const String baseUrl =
      'https://api.servicepay.ng/api';

  static Map<String, dynamic> mapFromDynamic(
    dynamic value,
  ) {
    if (value is Map) {
      return Map<String, dynamic>.from(
        value,
      );
    }

    return <String, dynamic>{};
  }

  static List<Map<String, dynamic>>
      listFromDynamic(
    dynamic value,
  ) {
    if (value is! List) {
      return <Map<String, dynamic>>[];
    }

    return value
        .whereType<Map>()
        .map(
          (Map item) =>
              Map<String, dynamic>.from(
            item,
          ),
        )
        .toList();
  }

  static String text(
    dynamic value, {
    String fallback = '',
  }) {
    final String result =
        value?.toString().trim() ?? '';

    return result.isEmpty
        ? fallback
        : result;
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

  static Map<String, dynamic>
      decodeResponse(
    http.Response response,
  ) {
    final String body =
        response.body.trim();

    if (body.isEmpty) {
      return <String, dynamic>{};
    }

    final dynamic decoded =
        jsonDecode(
      body,
    );

    return mapFromDynamic(
      decoded,
    );
  }

  static Future<String>
      getToken() async {
    final SharedPreferences prefs =
        await SharedPreferences
            .getInstance();

    const List<String> tokenKeys =
        <String>[
      'auth_token',
      'token',
      'access_token',
      'accessToken',
      'jwt_token',
      'jwt',
    ];

    for (final String key
        in tokenKeys) {
      String token =
          prefs.getString(key)?.trim() ??
              '';

      if (token
          .toLowerCase()
          .startsWith(
            'bearer ',
          )) {
        token =
            token.substring(7).trim();
      }

      if (token.isNotEmpty) {
        return token;
      }
    }

    return '';
  }

  /*
   * =====================================================
   * RIDER PROFILE
   * =====================================================
   *
   * Uses the new rider-specific endpoint.
   *
   * GET /api/riders/me
   */
  static Future<Map<String, dynamic>>
      getProfile() async {
    final String token =
        await getToken();

    if (token.isEmpty) {
      throw Exception(
        'Rider login token was not found.',
      );
    }

    final http.Response response =
        await http
            .get(
      Uri.parse(
        '$baseUrl/riders/me',
      ),
      headers: <String, String>{
        'Accept':
            'application/json',
        'Authorization':
            'Bearer $token',
      },
    )
            .timeout(
      const Duration(
        seconds: 35,
      ),
    );

    final Map<String, dynamic> root =
        decodeResponse(
      response,
    );

    if (response.statusCode < 200 ||
        response.statusCode >= 300) {
      throw Exception(
        text(
          root['message'],
          fallback:
              'Unable to load rider profile.',
        ),
      );
    }

    Map<String, dynamic> rider =
        mapFromDynamic(
      root['rider'],
    );

    if (rider.isEmpty) {
      final Map<String, dynamic> data =
          mapFromDynamic(
        root['data'],
      );

      rider =
          mapFromDynamic(
        data['rider'],
      );
    }

    if (rider.isEmpty) {
      throw Exception(
        'Rider profile information was not received.',
      );
    }

    return rider;
  }

  /*
   * =====================================================
   * SAVE RIDER PROFILE
   * =====================================================
   */
  static Future<void> saveProfile(
    Map<String, dynamic> rider,
  ) async {
    final SharedPreferences prefs =
        await SharedPreferences
            .getInstance();

    final String riderName =
        text(
      rider['fullName'],
      fallback:
          'Delivery Rider',
    );

    final String riderId =
        text(
      rider['riderId'],
    );

    final String verificationStatus =
        text(
      rider['verificationStatus'] ??
          rider['riderVerificationStatus'],
      fallback:
          'PENDING',
    ).toUpperCase();

    final String availabilityStatus =
        text(
      rider['availabilityStatus'],
      fallback:
          'OFFLINE',
    ).toUpperCase();

    await prefs.setString(
      'user_name',
      riderName,
    );

    await prefs.setString(
      'user_phone',
      text(
        rider['phone'],
      ),
    );

    await prefs.setString(
      'user_email',
      text(
        rider['email'],
      ),
    );

    await prefs.setString(
      'user_role',
      'DELIVERY_RIDER',
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
      availabilityStatus ==
          'ONLINE',
    );

    await prefs.setString(
      'rider_vehicle_type',
      text(
        rider['vehicleType'],
      ),
    );

    await prefs.setString(
      'rider_plate_number',
      text(
        rider['plateNumber'],
      ),
    );

    await prefs.setString(
      'rider_state',
      text(
        rider['state'] ??
            rider['riderState'],
      ),
    );

    await prefs.setString(
      'rider_lga',
      text(
        rider['lga'] ??
            rider['riderLga'],
      ),
    );
  }
}

/*
 * =====================================================
 * MAIN RIDER NAVIGATION
 * =====================================================
 *
 * 1. Keke
 * 2. Deliveries
 * 3. Earnings
 * 4. Profile
 */
class RiderMainNavigation
    extends StatefulWidget {
  const RiderMainNavigation({
    super.key,
  });

  @override
  State<RiderMainNavigation>
      createState() =>
          _RiderMainNavigationState();
}

class _RiderMainNavigationState
    extends State<RiderMainNavigation> {
  int currentIndex = 0;

  late final List<Widget> pages;

  @override
  void initState() {
    super.initState();

    pages = const <Widget>[
      KekeDriverScreen(),
      RiderDeliveriesScreen(),
      RiderEarningsScreen(),
      RiderProfileScreen(),
    ];
  }

  @override
  Widget build(
    BuildContext context,
  ) {
    return Scaffold(
      body: IndexedStack(
        index:
            currentIndex,
        children:
            pages,
      ),
      bottomNavigationBar:
          NavigationBar(
        selectedIndex:
            currentIndex,
        onDestinationSelected:
            (
          int index,
        ) {
          setState(() {
            currentIndex =
                index;
          });
        },
        destinations:
            const <NavigationDestination>[
          NavigationDestination(
            icon:
                Icon(
              Icons
                  .electric_rickshaw_outlined,
            ),
            selectedIcon:
                Icon(
              Icons
                  .electric_rickshaw_rounded,
            ),
            label:
                'Keke',
          ),
          NavigationDestination(
            icon:
                Icon(
              Icons
                  .local_shipping_outlined,
            ),
            selectedIcon:
                Icon(
              Icons
                  .local_shipping_rounded,
            ),
            label:
                'Deliveries',
          ),
          NavigationDestination(
            icon:
                Icon(
              Icons
                  .account_balance_wallet_outlined,
            ),
            selectedIcon:
                Icon(
              Icons
                  .account_balance_wallet_rounded,
            ),
            label:
                'Earnings',
          ),
          NavigationDestination(
            icon:
                Icon(
              Icons
                  .person_outline,
            ),
            selectedIcon:
                Icon(
              Icons
                  .person_rounded,
            ),
            label:
                'Profile',
          ),
        ],
      ),
    );
  }
}

/*
 * =====================================================
 * NORMAL DELIVERY JOBS
 * =====================================================
 *
 * This screen keeps the existing ServicePay
 * delivery business separate from Keke rides.
 */
class RiderDeliveriesScreen
    extends StatefulWidget {
  const RiderDeliveriesScreen({
    super.key,
  });

  @override
  State<RiderDeliveriesScreen>
      createState() =>
          _RiderDeliveriesScreenState();
}

class _RiderDeliveriesScreenState
    extends State<RiderDeliveriesScreen>
    with SingleTickerProviderStateMixin {
  static const Color primaryGreen =
      Color(
    0xFF159447,
  );

  late final AnimationController
      pulseController;

  late final Animation<double>
      pulseAnimation;

  List<Map<String, dynamic>>
      deliveries =
      <Map<String, dynamic>>[];

  bool isLoading = true;
  bool isRefreshing = false;
  bool hasError = false;

  String errorMessage = '';
  String selectedStatus = 'ALL';

  @override
  void initState() {
    super.initState();

    pulseController =
        AnimationController(
      vsync:
          this,
      duration:
          const Duration(
        milliseconds: 850,
      ),
    );

    pulseAnimation =
        Tween<double>(
      begin:
          0.98,
      end:
          1.02,
    ).animate(
      CurvedAnimation(
        parent:
            pulseController,
        curve:
            Curves.easeInOut,
      ),
    );

    pulseController.repeat(
      reverse:
          true,
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
          content:
              Text(
            message,
          ),
          behavior:
              SnackBarBehavior
                  .floating,
          backgroundColor:
              isError
                  ? Colors
                      .red.shade700
                  : primaryGreen,
        ),
      );
  }

  Future<void> loadDeliveries({
    bool refresh = false,
  }) async {
    if (mounted) {
      setState(() {
        if (refresh) {
          isRefreshing =
              true;
        } else {
          isLoading =
              true;
        }

        hasError =
            false;

        errorMessage =
            '';
      });
    }

    try {
      final String token =
          await RiderApi
              .getToken();

      if (token.isEmpty) {
        throw Exception(
          'Rider login token was not found.',
        );
      }

      final Map<String, String>
          queryParameters =
          <String, String>{};

      if (selectedStatus !=
          'ALL') {
        queryParameters[
                'status'] =
            selectedStatus;
      }

      final Uri endpoint =
          Uri.parse(
        '${RiderApi.baseUrl}/rider/deliveries',
      ).replace(
        queryParameters:
            queryParameters.isEmpty
                ? null
                : queryParameters,
      );

      final http.Response response =
          await http
              .get(
        endpoint,
        headers:
            <String, String>{
          'Accept':
              'application/json',
          'Authorization':
              'Bearer $token',
        },
      )
              .timeout(
        const Duration(
          seconds: 35,
        ),
      );

      final Map<String, dynamic>
          root =
          RiderApi.decodeResponse(
        response,
      );

      if (response.statusCode < 200 ||
          response.statusCode >= 300) {
        throw Exception(
          RiderApi.text(
            root['message'],
            fallback:
                'Unable to load assigned deliveries.',
          ),
        );
      }

      final Map<String, dynamic>
          data =
          RiderApi.mapFromDynamic(
        root['data'],
      );

      final List<Map<String, dynamic>>
          loadedDeliveries =
          RiderApi.listFromDynamic(
        root['deliveries'] ??
            data['deliveries'],
      );

      if (!mounted) {
        return;
      }

      setState(() {
        deliveries =
            loadedDeliveries;

        isLoading =
            false;

        isRefreshing =
            false;

        hasError =
            false;

        errorMessage =
            '';
      });
    } on TimeoutException {
      if (!mounted) {
        return;
      }

      setState(() {
        isLoading =
            false;

        isRefreshing =
            false;

        hasError =
            true;

        errorMessage =
            'The server took too long to respond.';
      });
    } on FormatException {
      if (!mounted) {
        return;
      }

      setState(() {
        isLoading =
            false;

        isRefreshing =
            false;

        hasError =
            true;

        errorMessage =
            'The server returned an invalid response.';
      });
    } catch (error) {
      if (!mounted) {
        return;
      }

      setState(() {
        isLoading =
            false;

        isRefreshing =
            false;

        hasError =
            true;

        errorMessage =
            error
                .toString()
                .replaceFirst(
                  'Exception: ',
                  '',
                );
      });
    }
  }

  Future<bool> performAction({
    required Map<String, dynamic>
        delivery,
    required String action,
    String? status,
    String? reason,
  }) async {
    final String deliveryId =
        RiderApi.text(
      delivery['_id'],
    );

    if (deliveryId.isEmpty) {
      showMessage(
        'Invalid delivery ID.',
        isError:
            true,
      );

      return false;
    }

    try {
      final String token =
          await RiderApi
              .getToken();

      if (token.isEmpty) {
        throw Exception(
          'Rider login token was not found.',
        );
      }

      final Uri endpoint =
          action == 'STATUS'
              ? Uri.parse(
                  '${RiderApi.baseUrl}/rider/deliveries/$deliveryId/status',
                )
              : Uri.parse(
                  '${RiderApi.baseUrl}/rider/deliveries/$deliveryId/${action.toLowerCase()}',
                );

      final Map<String, dynamic>
          payload =
          <String, dynamic>{};

      if (status != null) {
        payload['status'] =
            status;
      }

      if (reason != null &&
          reason.trim().isNotEmpty) {
        payload['reason'] =
            reason.trim();
      }

      final http.Response response =
          await http
              .patch(
        endpoint,
        headers:
            <String, String>{
          'Accept':
              'application/json',
          'Content-Type':
              'application/json',
          'Authorization':
              'Bearer $token',
        },
        body:
            jsonEncode(
          payload,
        ),
      )
              .timeout(
        const Duration(
          seconds: 35,
        ),
      );

      final Map<String, dynamic>
          root =
          RiderApi.decodeResponse(
        response,
      );

      if (response.statusCode < 200 ||
          response.statusCode >= 300) {
        throw Exception(
          RiderApi.text(
            root['message'],
            fallback:
                'Unable to update delivery.',
          ),
        );
      }

      showMessage(
        RiderApi.text(
          root['message'],
          fallback:
              'Delivery updated successfully.',
        ),
      );

      await loadDeliveries(
        refresh:
            true,
      );

      return true;
    } on TimeoutException {
      showMessage(
        'The server took too long to respond.',
        isError:
            true,
      );

      return false;
    } on FormatException {
      showMessage(
        'The server returned an invalid response.',
        isError:
            true,
      );

      return false;
    } catch (error) {
      showMessage(
        error
            .toString()
            .replaceFirst(
              'Exception: ',
              '',
            ),
        isError:
            true,
      );

      return false;
    }
  }

  String formatStatus(
    String status,
  ) {
    return status
        .replaceAll(
          '_',
          ' ',
        )
        .split(' ')
        .map(
          (
            String word,
          ) =>
              word.isEmpty
                  ? word
                  : '${word[0].toUpperCase()}${word.substring(1).toLowerCase()}',
        )
        .join(' ');
  }

  String formatMoney(
    dynamic value,
  ) {
    return '₦${RiderApi.number(value).toStringAsFixed(2)}';
  }

  String customerName(
    Map<String, dynamic> delivery,
  ) {
    final Map<String, dynamic>
        customer =
        RiderApi.mapFromDynamic(
      delivery['customerId'],
    );

    return RiderApi.text(
      customer['fullName'] ??
          delivery['senderName'],
      fallback:
          'ServicePay Customer',
    );
  }

  String packageName(
    Map<String, dynamic> delivery,
  ) {
    return RiderApi.text(
      delivery['packageName'] ??
          delivery[
              'packageDescription'],
      fallback:
          'Package',
    );
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

  Widget buildDeliveryCard(
    Map<String, dynamic> delivery,
  ) {
    final String status =
        RiderApi.text(
      delivery['status'],
      fallback:
          'ASSIGNED',
    ).toUpperCase();

    final bool isNewJob =
        status == 'ASSIGNED';

    final Widget card =
        Card(
      elevation:
          isNewJob ? 6 : 1,
      margin:
          const EdgeInsets.only(
        bottom: 14,
      ),
      color:
          Colors.white,
      shape:
          RoundedRectangleBorder(
        borderRadius:
            BorderRadius.circular(
          18,
        ),
        side:
            BorderSide(
          color:
              isNewJob
                  ? Colors.orange
                  : const Color(
                      0xFFE2E8F0,
                    ),
          width:
              isNewJob ? 2 : 1,
        ),
      ),
      child:
          Padding(
        padding:
            const EdgeInsets.all(
          16,
        ),
        child:
            Column(
          crossAxisAlignment:
              CrossAxisAlignment.start,
          children:
              <Widget>[
            Row(
              children:
                  <Widget>[
                Container(
                  width:
                      48,
                  height:
                      48,
                  decoration:
                      BoxDecoration(
                    color:
                        getStatusColor(
                      status,
                    ).withValues(
                      alpha:
                          0.12,
                    ),
                    borderRadius:
                        BorderRadius.circular(
                      14,
                    ),
                  ),
                  child:
                      Icon(
                    isNewJob
                        ? Icons
                            .notifications_active_rounded
                        : Icons
                            .local_shipping_rounded,
                    color:
                        getStatusColor(
                      status,
                    ),
                  ),
                ),
                const SizedBox(
                  width:
                      12,
                ),
                Expanded(
                  child:
                      Column(
                    crossAxisAlignment:
                        CrossAxisAlignment.start,
                    children:
                        <Widget>[
                      Text(
                        RiderApi.text(
                          delivery[
                              'trackingNumber'],
                          fallback:
                              'Delivery Job',
                        ),
                        style:
                            const TextStyle(
                          fontSize:
                              16,
                          fontWeight:
                              FontWeight.bold,
                        ),
                      ),
                      const SizedBox(
                        height:
                            3,
                      ),
                      Text(
                        customerName(
                          delivery,
                        ),
                        style:
                            const TextStyle(
                          color:
                              Colors.black54,
                        ),
                      ),
                    ],
                  ),
                ),
                _RiderStatusBadge(
                  text:
                      formatStatus(
                    status,
                  ),
                  color:
                      getStatusColor(
                    status,
                  ),
                ),
              ],
            ),
            const SizedBox(
              height:
                  14,
            ),
            _DeliveryAddressLine(
              icon:
                  Icons.location_on_outlined,
              label:
                  'Pickup',
              value:
                  RiderApi.text(
                delivery[
                    'pickupAddress'],
                fallback:
                    'Not available',
              ),
            ),
            const SizedBox(
              height:
                  8,
            ),
            _DeliveryAddressLine(
              icon:
                  Icons.flag_outlined,
              label:
                  'Destination',
              value:
                  RiderApi.text(
                delivery[
                    'deliveryAddress'],
                fallback:
                    'Not available',
              ),
            ),
            const SizedBox(
              height:
                  12,
            ),
            Row(
              children:
                  <Widget>[
                Expanded(
                  child:
                      Text(
                    packageName(
                      delivery,
                    ),
                    maxLines:
                        1,
                    overflow:
                        TextOverflow.ellipsis,
                    style:
                        const TextStyle(
                      fontWeight:
                          FontWeight.w700,
                    ),
                  ),
                ),
                Text(
                  formatMoney(
                    delivery[
                        'deliveryFee'],
                  ),
                  style:
                      const TextStyle(
                    color:
                        primaryGreen,
                    fontWeight:
                        FontWeight.bold,
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );

    if (!isNewJob) {
      return card;
    }

    return ScaleTransition(
      scale:
          pulseAnimation,
      child:
          card,
    );
  }

  @override
  Widget build(
    BuildContext context,
  ) {
    return Scaffold(
      backgroundColor:
          const Color(
        0xFFF5F7FA,
      ),
      appBar:
          AppBar(
        automaticallyImplyLeading:
            false,
        backgroundColor:
            Colors.white,
        surfaceTintColor:
            Colors.white,
        title:
            const Text(
          'My Deliveries',
          style:
              TextStyle(
            fontWeight:
                FontWeight.bold,
          ),
        ),
        actions:
            <Widget>[
          IconButton(
            tooltip:
                'Refresh',
            onPressed:
                isRefreshing
                    ? null
                    : () {
                        loadDeliveries(
                          refresh:
                              true,
                        );
                      },
            icon:
                isRefreshing
                    ? const SizedBox(
                        width:
                            20,
                        height:
                            20,
                        child:
                            CircularProgressIndicator(
                          strokeWidth:
                              2,
                        ),
                      )
                    : const Icon(
                        Icons
                            .refresh_rounded,
                      ),
          ),
        ],
      ),
      body:
          isLoading
              ? const Center(
                  child:
                      CircularProgressIndicator(),
                )
              : hasError
                  ? Center(
                      child:
                          Padding(
                        padding:
                            const EdgeInsets.all(
                          24,
                        ),
                        child:
                            Column(
                          mainAxisSize:
                              MainAxisSize.min,
                          children:
                              <Widget>[
                            const Icon(
                              Icons
                                  .cloud_off_rounded,
                              size:
                                  60,
                              color:
                                  Colors.red,
                            ),
                            const SizedBox(
                              height:
                                  14,
                            ),
                            Text(
                              errorMessage,
                              textAlign:
                                  TextAlign.center,
                            ),
                            const SizedBox(
                              height:
                                  14,
                            ),
                            ElevatedButton.icon(
                              onPressed:
                                  loadDeliveries,
                              icon:
                                  const Icon(
                                Icons
                                    .refresh_rounded,
                              ),
                              label:
                                  const Text(
                                'Try Again',
                              ),
                            ),
                          ],
                        ),
                      ),
                    )
                  : RefreshIndicator(
                      onRefresh:
                          () {
                        return loadDeliveries(
                          refresh:
                              true,
                        );
                      },
                      child:
                          ListView(
                        padding:
                            const EdgeInsets.all(
                          16,
                        ),
                        children:
                            <Widget>[
                          SizedBox(
                            height:
                                42,
                            child:
                                ListView(
                              scrollDirection:
                                  Axis.horizontal,
                              children:
                                  <String>[
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
                                  final bool selected =
                                      selectedStatus == status;

                                  return Padding(
                                    padding:
                                        const EdgeInsets.only(
                                      right:
                                          8,
                                    ),
                                    child:
                                        ChoiceChip(
                                      selected:
                                          selected,
                                      label:
                                          Text(
                                        formatStatus(
                                          status,
                                        ),
                                      ),
                                      selectedColor:
                                          primaryGreen,
                                      backgroundColor:
                                          Colors.white,
                                      labelStyle:
                                          TextStyle(
                                        color:
                                            selected
                                                ? Colors.white
                                                : Colors.black54,
                                        fontWeight:
                                            FontWeight.w700,
                                      ),
                                      onSelected:
                                          (_) {
                                        setState(() {
                                          selectedStatus =
                                              status;
                                        });

                                        loadDeliveries();
                                      },
                                    ),
                                  );
                                },
                              ).toList(),
                            ),
                          ),
                          const SizedBox(
                            height:
                                16,
                          ),
                          if (deliveries.isEmpty)
                            const RiderEmptyScreen(
                              title:
                                  'No Deliveries',
                              message:
                                  'Your assigned delivery jobs will appear here.',
                              icon:
                                  Icons.local_shipping_outlined,
                              showAppBar:
                                  false,
                            )
                          else
                            ...deliveries.map(
                              buildDeliveryCard,
                            ),
                          const SizedBox(
                            height:
                                30,
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
  State<RiderEarningsScreen> createState() =>
      _RiderEarningsScreenState();
}

class _RiderEarningsScreenState
    extends State<RiderEarningsScreen> {
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
      final Map<String, dynamic> rider =
          await RiderApi.getProfile();

      await RiderApi.saveProfile(
        rider,
      );

      if (!mounted) {
        return;
      }

      setState(() {
        totalEarnings =
            RiderApi.number(
          rider['totalRiderEarnings'],
        );

        pendingSettlement =
            RiderApi.number(
          rider['pendingRiderSettlement'],
        );

        settledEarnings =
            RiderApi.number(
          rider['settledRiderEarnings'],
        );

        completedDeliveries =
            RiderApi.integer(
          rider['totalCompletedDeliveries'],
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
      padding:
          const EdgeInsets.all(
        17,
      ),
      decoration:
          BoxDecoration(
        color:
            Colors.white,
        borderRadius:
            BorderRadius.circular(
          17,
        ),
        border:
            Border.all(
          color:
              const Color(
            0xFFE2E8F0,
          ),
        ),
      ),
      child:
          Row(
        children:
            <Widget>[
          Container(
            width:
                46,
            height:
                46,
            decoration:
                BoxDecoration(
              color:
                  const Color(
                0xFF159447,
              ).withValues(
                alpha:
                    0.10,
              ),
              borderRadius:
                  BorderRadius.circular(
                13,
              ),
            ),
            child:
                Icon(
              icon,
              color:
                  const Color(
                0xFF159447,
              ),
            ),
          ),
          const SizedBox(
            width:
                12,
          ),
          Expanded(
            child:
                Column(
              crossAxisAlignment:
                  CrossAxisAlignment.start,
              children:
                  <Widget>[
                Text(
                  title,
                  style:
                      const TextStyle(
                    color:
                        Colors.black54,
                    fontSize:
                        12,
                  ),
                ),
                const SizedBox(
                  height:
                      4,
                ),
                Text(
                  value,
                  style:
                      const TextStyle(
                    fontSize:
                        18,
                    fontWeight:
                        FontWeight.bold,
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
      backgroundColor:
          const Color(
        0xFFF5F7FA,
      ),
      appBar:
          AppBar(
        automaticallyImplyLeading:
            false,
        backgroundColor:
            Colors.white,
        surfaceTintColor:
            Colors.white,
        title:
            const Text(
          'Rider Earnings',
          style:
              TextStyle(
            fontWeight:
                FontWeight.bold,
          ),
        ),
        actions:
            <Widget>[
          IconButton(
            tooltip:
                'Refresh',
            onPressed:
                isLoading
                    ? null
                    : loadEarnings,
            icon:
                const Icon(
              Icons
                  .refresh_rounded,
            ),
          ),
        ],
      ),
      body:
          isLoading
              ? const Center(
                  child:
                      CircularProgressIndicator(),
                )
              : RefreshIndicator(
                  onRefresh:
                      loadEarnings,
                  child:
                      ListView(
                    padding:
                        const EdgeInsets.all(
                      16,
                    ),
                    children:
                        <Widget>[
                      Container(
                        padding:
                            const EdgeInsets.all(
                          22,
                        ),
                        decoration:
                            BoxDecoration(
                          gradient:
                              const LinearGradient(
                            colors:
                                <Color>[
                              Color(
                                0xFF159447,
                              ),
                              Color(
                                0xFF0F766E,
                              ),
                            ],
                          ),
                          borderRadius:
                              BorderRadius.circular(
                            20,
                          ),
                        ),
                        child:
                            Column(
                          crossAxisAlignment:
                              CrossAxisAlignment.start,
                          children:
                              <Widget>[
                            const Text(
                              'Total Rider Earnings',
                              style:
                                  TextStyle(
                                color:
                                    Colors.white70,
                              ),
                            ),
                            const SizedBox(
                              height:
                                  8,
                            ),
                            Text(
                              formatMoney(
                                totalEarnings,
                              ),
                              style:
                                  const TextStyle(
                                color:
                                    Colors.white,
                                fontSize:
                                    28,
                                fontWeight:
                                    FontWeight.bold,
                              ),
                            ),
                            const SizedBox(
                              height:
                                  10,
                            ),
                            Text(
                              '$completedDeliveries completed deliveries',
                              style:
                                  const TextStyle(
                                color:
                                    Colors.white70,
                              ),
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(
                        height:
                            16,
                      ),
                      earningsCard(
                        title:
                            'Pending Settlement',
                        value:
                            formatMoney(
                          pendingSettlement,
                        ),
                        icon:
                            Icons
                                .hourglass_top_rounded,
                      ),
                      const SizedBox(
                        height:
                            12,
                      ),
                      earningsCard(
                        title:
                            'Settled Earnings',
                        value:
                            formatMoney(
                          settledEarnings,
                        ),
                        icon:
                            Icons
                                .check_circle_outline,
                      ),
                      const SizedBox(
                        height:
                            12,
                      ),
                      earningsCard(
                        title:
                            'Completed Deliveries',
                        value:
                            completedDeliveries
                                .toString(),
                        icon:
                            Icons
                                .local_shipping_outlined,
                      ),
                      const SizedBox(
                        height:
                            18,
                      ),
                      SizedBox(
                        width:
                            double.infinity,
                        height:
                            54,
                        child:
                            FilledButton.icon(
                          onPressed:
                              () async {
                            await Navigator.of(
                              context,
                            ).push<void>(
                              MaterialPageRoute<void>(
                                builder:
                                    (_) =>
                                        const RiderWithdrawalScreen(),
                              ),
                            );

                            if (!mounted) {
                              return;
                            }

                            await loadEarnings();
                          },
                          style:
                              FilledButton.styleFrom(
                            backgroundColor:
                                const Color(
                              0xFF159447,
                            ),
                            shape:
                                RoundedRectangleBorder(
                              borderRadius:
                                  BorderRadius.circular(
                                14,
                              ),
                            ),
                          ),
                          icon:
                              const Icon(
                            Icons
                                .account_balance_rounded,
                          ),
                          label:
                              const Text(
                            'Withdraw Commission',
                            style:
                                TextStyle(
                              fontSize:
                                  16,
                              fontWeight:
                                  FontWeight.bold,
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
  State<RiderProfileScreen> createState() =>
      _RiderProfileScreenState();
}

class _RiderProfileScreenState
    extends State<RiderProfileScreen> {
  String riderName =
      'Delivery Rider';

  String riderId = '';
  String phone = '';
  String email = '';
  String vehicleType = '';
  String plateNumber = '';
  String riderState = '';
  String riderLga = '';

  String verificationStatus =
      'PENDING';

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
      final Map<String, dynamic> rider =
          await RiderApi.getProfile();

      await RiderApi.saveProfile(
        rider,
      );

      if (!mounted) {
        return;
      }

      setState(() {
        riderName =
            RiderApi.text(
          rider['fullName'],
          fallback:
              'Delivery Rider',
        );

        riderId =
            RiderApi.text(
          rider['riderId'],
        );

        phone =
            RiderApi.text(
          rider['phone'],
        );

        email =
            RiderApi.text(
          rider['email'],
        );

        vehicleType =
            RiderApi.text(
          rider['vehicleType'],
        ).replaceAll(
          '_',
          ' ',
        );

        plateNumber =
            RiderApi.text(
          rider['plateNumber'],
        );

        riderState =
            RiderApi.text(
          rider['state'] ??
              rider['riderState'],
        );

        riderLga =
            RiderApi.text(
          rider['lga'] ??
              rider['riderLga'],
        );

        verificationStatus =
            RiderApi.text(
          rider['verificationStatus'] ??
              rider[
                  'riderVerificationStatus'],
          fallback:
              'PENDING',
        ).toUpperCase();

        isLoading =
            false;
      });
    } catch (_) {
      final SharedPreferences prefs =
          await SharedPreferences
              .getInstance();

      if (!mounted) {
        return;
      }

      setState(() {
        riderName =
            prefs.getString(
                  'user_name',
                ) ??
                'Delivery Rider';

        riderId =
            prefs.getString(
                  'rider_id',
                ) ??
                '';

        phone =
            prefs.getString(
                  'user_phone',
                ) ??
                '';

        email =
            prefs.getString(
                  'user_email',
                ) ??
                '';

        vehicleType =
            (prefs.getString(
                      'rider_vehicle_type',
                    ) ??
                    '')
                .replaceAll(
          '_',
          ' ',
        );

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

        isLoading =
            false;
      });
    }
  }

  Future<void> logout(
    BuildContext context,
  ) async {
    final SharedPreferences prefs =
        await SharedPreferences
            .getInstance();

    await prefs.clear();

    if (!context.mounted) {
      return;
    }

    Navigator.pushAndRemoveUntil(
      context,
      MaterialPageRoute<void>(
        builder:
            (_) =>
                const LoginScreen(),
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
      contentPadding:
          const EdgeInsets.symmetric(
        horizontal:
            4,
      ),
      leading:
          CircleAvatar(
        backgroundColor:
            const Color(
          0xFFE8F5EC,
        ),
        child:
            Icon(
          icon,
          color:
              const Color(
            0xFF159447,
          ),
        ),
      ),
      title:
          Text(
        title,
        style:
            const TextStyle(
          color:
              Colors.black54,
          fontSize:
              12,
        ),
      ),
      subtitle:
          Text(
        value.trim().isEmpty
            ? 'Not available'
            : value,
        style:
            const TextStyle(
          fontWeight:
              FontWeight.w700,
        ),
      ),
    );
  }

  @override
  Widget build(
    BuildContext context,
  ) {
    final String initial =
        riderName.trim().isEmpty
            ? 'R'
            : riderName
                .trim()
                .substring(
                  0,
                  1,
                )
                .toUpperCase();

    final String location =
        <String>[
      riderLga,
      riderState,
    ]
            .where(
              (
                String item,
              ) =>
                  item.trim().isNotEmpty,
            )
            .join(
              ', ',
            );

    return Scaffold(
      backgroundColor:
          const Color(
        0xFFF5F7FA,
      ),
      appBar:
          AppBar(
        automaticallyImplyLeading:
            false,
        backgroundColor:
            Colors.white,
        surfaceTintColor:
            Colors.white,
        title:
            const Text(
          'Rider Profile',
          style:
              TextStyle(
            fontWeight:
                FontWeight.bold,
          ),
        ),
        actions:
            <Widget>[
          IconButton(
            tooltip:
                'Refresh',
            onPressed:
                isLoading
                    ? null
                    : loadProfile,
            icon:
                const Icon(
              Icons
                  .refresh_rounded,
            ),
          ),
        ],
      ),
      body:
          isLoading
              ? const Center(
                  child:
                      CircularProgressIndicator(),
                )
              : RefreshIndicator(
                  onRefresh:
                      loadProfile,
                  child:
                      ListView(
                    padding:
                        const EdgeInsets.all(
                      16,
                    ),
                    children:
                        <Widget>[
                      Container(
                        padding:
                            const EdgeInsets.all(
                          20,
                        ),
                        decoration:
                            BoxDecoration(
                          color:
                              Colors.white,
                          borderRadius:
                              BorderRadius.circular(
                            18,
                          ),
                        ),
                        child:
                            Column(
                          children:
                              <Widget>[
                            CircleAvatar(
                              radius:
                                  38,
                              backgroundColor:
                                  const Color(
                                0xFFE6F4EA,
                              ),
                              child:
                                  Text(
                                initial,
                                style:
                                    const TextStyle(
                                  fontSize:
                                      28,
                                  fontWeight:
                                      FontWeight.bold,
                                  color:
                                      Color(
                                    0xFF159447,
                                  ),
                                ),
                              ),
                            ),
                            const SizedBox(
                              height:
                                  12,
                            ),
                            Text(
                              riderName,
                              textAlign:
                                  TextAlign.center,
                              style:
                                  const TextStyle(
                                fontSize:
                                    20,
                                fontWeight:
                                    FontWeight.bold,
                              ),
                            ),
                            if (riderId.isNotEmpty) ...<Widget>[
                              const SizedBox(
                                height:
                                    4,
                              ),
                              Text(
                                'Rider ID: $riderId',
                                style:
                                    const TextStyle(
                                  color:
                                      Colors.black54,
                                ),
                              ),
                            ],
                            const SizedBox(
                              height:
                                  10,
                            ),
                            Container(
                              padding:
                                  const EdgeInsets.symmetric(
                                horizontal:
                                    12,
                                vertical:
                                    6,
                              ),
                              decoration:
                                  BoxDecoration(
                                color:
                                    verificationStatus ==
                                            'VERIFIED'
                                        ? Colors.green.withValues(
                                            alpha:
                                                0.12,
                                          )
                                        : Colors.orange.withValues(
                                            alpha:
                                                0.12,
                                          ),
                                borderRadius:
                                    BorderRadius.circular(
                                  20,
                                ),
                              ),
                              child:
                                  Text(
                                verificationStatus,
                                style:
                                    TextStyle(
                                  color:
                                      verificationStatus ==
                                              'VERIFIED'
                                          ? Colors.green.shade800
                                          : Colors.orange.shade800,
                                  fontSize:
                                      12,
                                  fontWeight:
                                      FontWeight.bold,
                                ),
                              ),
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(
                        height:
                            16,
                      ),
                      Card(
                        elevation:
                            0,
                        color:
                            Colors.white,
                        child:
                            Padding(
                          padding:
                              const EdgeInsets.all(
                            12,
                          ),
                          child:
                              Column(
                            children:
                                <Widget>[
                              buildInfoTile(
                                icon:
                                    Icons.phone_outlined,
                                title:
                                    'Phone number',
                                value:
                                    phone,
                              ),
                              buildInfoTile(
                                icon:
                                    Icons.email_outlined,
                                title:
                                    'Email address',
                                value:
                                    email,
                              ),
                              buildInfoTile(
                                icon:
                                    Icons.electric_rickshaw_outlined,
                                title:
                                    'Vehicle type',
                                value:
                                    vehicleType,
                              ),
                              buildInfoTile(
                                icon:
                                    Icons.confirmation_number_outlined,
                                title:
                                    'Plate number',
                                value:
                                    plateNumber,
                              ),
                              buildInfoTile(
                                icon:
                                    Icons.location_on_outlined,
                                title:
                                    'Location',
                                value:
                                    location,
                              ),
                            ],
                          ),
                        ),
                      ),
                      const SizedBox(
                        height:
                            16,
                      ),
                      Card(
                        elevation:
                            0,
                        color:
                            Colors.white,
                        child:
                            ListTile(
                          leading:
                              const Icon(
                            Icons.logout,
                            color:
                                Colors.red,
                          ),
                          title:
                              const Text(
                            'Log out',
                            style:
                                TextStyle(
                              color:
                                  Colors.red,
                              fontWeight:
                                  FontWeight.w700,
                            ),
                          ),
                          onTap:
                              () =>
                                  logout(
                            context,
                          ),
                        ),
                      ),
                      const SizedBox(
                        height:
                            30,
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
    final Widget content =
        Center(
      child:
          Padding(
        padding:
            const EdgeInsets.all(
          24,
        ),
        child:
            Column(
          mainAxisAlignment:
              MainAxisAlignment.center,
          children:
              <Widget>[
            Container(
              width:
                  90,
              height:
                  90,
              decoration:
                  BoxDecoration(
                color:
                    const Color(
                  0xFF159447,
                ).withValues(
                  alpha:
                      0.10,
                ),
                shape:
                    BoxShape.circle,
              ),
              child:
                  Icon(
                icon,
                size:
                    46,
                color:
                    const Color(
                  0xFF159447,
                ),
              ),
            ),
            const SizedBox(
              height:
                  18,
            ),
            Text(
              title,
              style:
                  const TextStyle(
                fontSize:
                    22,
                fontWeight:
                    FontWeight.bold,
              ),
            ),
            const SizedBox(
              height:
                  8,
            ),
            Text(
              message,
              textAlign:
                  TextAlign.center,
              style:
                  const TextStyle(
                color:
                    Colors.black54,
                height:
                    1.5,
              ),
            ),
          ],
        ),
      ),
    );

    if (!showAppBar) {
      return SizedBox(
        height:
            360,
        child:
            content,
      );
    }

    return Scaffold(
      backgroundColor:
          const Color(
        0xFFF5F7FA,
      ),
      appBar:
          AppBar(
        automaticallyImplyLeading:
            false,
        backgroundColor:
            Colors.white,
        surfaceTintColor:
            Colors.white,
        title:
            Text(
          title,
          style:
              const TextStyle(
            fontWeight:
                FontWeight.bold,
          ),
        ),
      ),
      body:
          content,
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
      padding:
          const EdgeInsets.symmetric(
        horizontal:
            9,
        vertical:
            5,
      ),
      decoration:
          BoxDecoration(
        color:
            color.withValues(
          alpha:
              0.12,
        ),
        borderRadius:
            BorderRadius.circular(
          20,
        ),
      ),
      child:
          Text(
        text,
        style:
            TextStyle(
          color:
              color,
          fontSize:
              10,
          fontWeight:
              FontWeight.w800,
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
      crossAxisAlignment:
          CrossAxisAlignment.start,
      children:
          <Widget>[
        Icon(
          icon,
          size:
              18,
          color:
              const Color(
            0xFF159447,
          ),
        ),
        const SizedBox(
          width:
              8,
        ),
        Expanded(
          child:
              RichText(
            text:
                TextSpan(
              style:
                  const TextStyle(
                color:
                    Colors.black87,
                fontSize:
                    13,
                height:
                    1.4,
              ),
              children:
                  <InlineSpan>[
                TextSpan(
                  text:
                      '$label: ',
                  style:
                      const TextStyle(
                    fontWeight:
                        FontWeight.bold,
                  ),
                ),
                TextSpan(
                  text:
                      value,
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }
}

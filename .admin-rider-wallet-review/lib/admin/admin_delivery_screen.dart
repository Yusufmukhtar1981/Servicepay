import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

class AdminDeliveryScreen extends StatefulWidget {
  const AdminDeliveryScreen({
    super.key,
  });

  @override
  State<AdminDeliveryScreen> createState() =>
      _AdminDeliveryScreenState();
}

class _AdminDeliveryScreenState
    extends State<AdminDeliveryScreen> {
  static const String baseUrl =
      'https://api.servicepay.ng/api';

  static const Color primaryColor =
      Color(0xFF0F766E);

  final TextEditingController searchController =
      TextEditingController();

  List<Map<String, dynamic>> deliveries =
      <Map<String, dynamic>>[];

  String selectedStatus = 'ALL';

  bool isLoading = true;
  bool isRefreshing = false;
  bool hasError = false;

  String errorMessage = '';

  int totalDeliveries = 0;
  int pendingDeliveries = 0;
  int assignedDeliveries = 0;
  int acceptedDeliveries = 0;
  int pickedUpDeliveries = 0;
  int inTransitDeliveries = 0;
  int deliveredDeliveries = 0;
  int cancelledDeliveries = 0;
  int failedDeliveries = 0;

  int pendingCommissions = 0;
  int creditedCommissions = 0;
  int settledCommissions = 0;

  double totalRevenue = 0;
  double totalQuotedPrice = 0;
  double totalRiderCommission = 0;
  double servicepayProfit = 0;

  @override
  void initState() {
    super.initState();
    loadDeliveries();
  }

  @override
  void dispose() {
    searchController.dispose();
    super.dispose();
  }

  Map<String, dynamic> mapFromDynamic(
    dynamic value,
  ) {
    if (value is Map) {
      return Map<String, dynamic>.from(
        value,
      );
    }

    return <String, dynamic>{};
  }

  List<Map<String, dynamic>> listFromDynamic(
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

  int toInt(
    dynamic value,
  ) {
    if (value is int) {
      return value;
    }

    if (value is num) {
      return value.toInt();
    }

    return int.tryParse(
          value?.toString() ?? '',
        ) ??
        0;
  }

  double toDouble(
    dynamic value,
  ) {
    if (value is double) {
      return value;
    }

    if (value is num) {
      return value.toDouble();
    }

    return double.tryParse(
          value?.toString() ?? '',
        ) ??
        0;
  }

  String textFromDynamic(
    dynamic value, {
    String fallback = '',
  }) {
    final String text =
        value?.toString().trim() ?? '';

    return text.isEmpty
        ? fallback
        : text;
  }

  String cleanError(
    Object error,
  ) {
    return error
        .toString()
        .replaceFirst(
          'Exception: ',
          '',
        );
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

  Map<String, dynamic> decodeResponse(
    http.Response response,
  ) {
    final String body =
        response.body.trim();

    if (body.isEmpty) {
      return <String, dynamic>{};
    }

    final dynamic decoded =
        jsonDecode(body);

    return mapFromDynamic(decoded);
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
          behavior:
              SnackBarBehavior.floating,
          backgroundColor: isError
              ? Colors.red.shade700
              : primaryColor,
        ),
      );
  }

  Future<void> loadDeliveries({
    bool showLoading = true,
  }) async {
    if (mounted) {
      setState(() {
        if (showLoading) {
          isLoading = true;
        } else {
          isRefreshing = true;
        }

        hasError = false;
        errorMessage = '';
      });
    }

    try {
      final String token =
          await getToken();

      if (token.isEmpty) {
        throw Exception(
          'Admin session has expired. Please sign in again.',
        );
      }

      final Map<String, String> queryParameters =
          <String, String>{
        'page': '1',
        'limit': '100',
      };

      final String search =
          searchController.text.trim();

      if (search.isNotEmpty) {
        queryParameters['search'] =
            search;
      }

      if (selectedStatus != 'ALL') {
        queryParameters['status'] =
            selectedStatus;
      }

      final Uri endpoint = Uri.parse(
        '$baseUrl/admin/deliveries',
      ).replace(
        queryParameters:
            queryParameters,
      );

      final http.Response response =
          await http
              .get(
                endpoint,
                headers: {
                  'Accept':
                      'application/json',
                  'Authorization':
                      'Bearer $token',
                },
              )
              .timeout(
                const Duration(
                  seconds: 45,
                ),
              );

      final Map<String, dynamic> root =
          decodeResponse(response);

      if (response.statusCode < 200 ||
          response.statusCode >= 300) {
        throw Exception(
          textFromDynamic(
            root['message'],
            fallback:
                'Failed to load deliveries.',
          ),
        );
      }

      final Map<String, dynamic> data =
          mapFromDynamic(
        root['data'],
      );

      final List<Map<String, dynamic>>
          loadedDeliveries =
          listFromDynamic(
        data['deliveries'],
      );

      final Map<String, dynamic> summary =
          mapFromDynamic(
        data['summary'],
      );

      if (!mounted) {
        return;
      }

      setState(() {
        deliveries =
            loadedDeliveries;

        totalDeliveries = toInt(
          summary['total'],
        );

        pendingDeliveries = toInt(
          summary['pending'],
        );

        assignedDeliveries = toInt(
          summary['assigned'],
        );

        acceptedDeliveries = toInt(
          summary['accepted'],
        );

        pickedUpDeliveries = toInt(
          summary['pickedUp'],
        );

        inTransitDeliveries = toInt(
          summary['inTransit'],
        );

        deliveredDeliveries = toInt(
          summary['delivered'],
        );

        cancelledDeliveries = toInt(
          summary['cancelled'],
        );

        failedDeliveries = toInt(
          summary['failed'],
        );

        pendingCommissions = toInt(
          summary['pendingCommissions'],
        );

        creditedCommissions = toInt(
          summary['creditedCommissions'],
        );

        settledCommissions = toInt(
          summary['settledCommissions'],
        );

        totalRevenue = toDouble(
          summary['totalRevenue'],
        );

        totalQuotedPrice = toDouble(
          summary['totalQuotedPrice'],
        );

        totalRiderCommission = toDouble(
          summary['totalRiderCommission'],
        );

        servicepayProfit = toDouble(
          summary['servicepayProfit'],
        );

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
        errorMessage =
            'The server took too long to respond.';
      });
    } on FormatException {
      if (!mounted) {
        return;
      }

      setState(() {
        isLoading = false;
        isRefreshing = false;
        hasError = true;
        errorMessage =
            'The server returned an invalid response.';
      });
    } catch (error) {
      if (!mounted) {
        return;
      }

      setState(() {
        isLoading = false;
        isRefreshing = false;
        hasError = true;
        errorMessage =
            cleanError(error);
      });
    }
  }

  Future<bool> updateDeliveryStatus({
    required Map<String, dynamic> delivery,
    required String status,
  }) async {
    final String deliveryId =
        textFromDynamic(
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
      final String token =
          await getToken();

      if (token.isEmpty) {
        throw Exception(
          'Admin session has expired. Please sign in again.',
        );
      }

      final http.Response response =
          await http
              .patch(
                Uri.parse(
                  '$baseUrl/admin/deliveries/'
                  '$deliveryId/status',
                ),
                headers: {
                  'Accept':
                      'application/json',
                  'Content-Type':
                      'application/json',
                  'Authorization':
                      'Bearer $token',
                },
                body: jsonEncode({
                  'status': status,
                }),
              )
              .timeout(
                const Duration(
                  seconds: 45,
                ),
              );

      final Map<String, dynamic> result =
          decodeResponse(response);

      if (response.statusCode < 200 ||
          response.statusCode >= 300) {
        throw Exception(
          textFromDynamic(
            result['message'],
            fallback:
                'Failed to update delivery status.',
          ),
        );
      }

      showMessage(
        textFromDynamic(
          result['message'],
          fallback:
              'Delivery status updated successfully.',
        ),
      );

      await loadDeliveries(
        showLoading: false,
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
        cleanError(error),
        isError: true,
      );

      return false;
    }
  }

  Future<bool> updateDeliveryPrice({
    required Map<String, dynamic> delivery,
    required double deliveryFee,
    required String paymentStatus,
    required String riderCommissionType,
    required double riderCommissionValue,
  }) async {
    final String deliveryId =
        textFromDynamic(
      delivery['_id'],
    );

    if (deliveryId.isEmpty) {
      showMessage(
        'Invalid delivery ID.',
        isError: true,
      );

      return false;
    }

    if (deliveryFee < 0) {
      showMessage(
        'Enter a valid delivery price.',
        isError: true,
      );

      return false;
    }

    if (riderCommissionValue < 0) {
      showMessage(
        'Enter a valid Rider commission value.',
        isError: true,
      );

      return false;
    }

    if (riderCommissionType == 'PERCENTAGE' &&
        riderCommissionValue > 100) {
      showMessage(
        'Percentage commission cannot exceed 100%.',
        isError: true,
      );

      return false;
    }

    if (riderCommissionType == 'FIXED' &&
        riderCommissionValue > deliveryFee) {
      showMessage(
        'Fixed Rider commission cannot exceed the delivery price.',
        isError: true,
      );

      return false;
    }

    try {
      final String token =
          await getToken();

      if (token.isEmpty) {
        throw Exception(
          'Admin session has expired. Please sign in again.',
        );
      }

      final http.Response response =
          await http
              .patch(
                Uri.parse(
                  '$baseUrl/admin/deliveries/'
                  '$deliveryId/price',
                ),
                headers: {
                  'Accept':
                      'application/json',
                  'Content-Type':
                      'application/json',
                  'Authorization':
                      'Bearer $token',
                },
                body: jsonEncode({
                  'deliveryFee':
                      deliveryFee,
                  'paymentStatus':
                      paymentStatus,
                  'riderCommissionType':
                      riderCommissionType,
                  'riderCommissionValue':
                      riderCommissionValue,
                }),
              )
              .timeout(
                const Duration(
                  seconds: 45,
                ),
              );

      final Map<String, dynamic> result =
          decodeResponse(response);

      if (response.statusCode < 200 ||
          response.statusCode >= 300) {
        throw Exception(
          textFromDynamic(
            result['message'],
            fallback:
                'Failed to update delivery price and commission.',
          ),
        );
      }

      showMessage(
        textFromDynamic(
          result['message'],
          fallback:
              'Delivery price and Rider commission updated successfully.',
        ),
      );

      await loadDeliveries(
        showLoading: false,
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
        cleanError(error),
        isError: true,
      );

      return false;
    }
  }
  Future<List<Map<String, dynamic>>>
      loadAvailableRiders(
    Map<String, dynamic> delivery,
  ) async {
    final String deliveryId =
        textFromDynamic(
      delivery['_id'],
    );

    if (deliveryId.isEmpty) {
      throw Exception(
        'Invalid delivery ID.',
      );
    }

    final String token =
        await getToken();

    if (token.isEmpty) {
      throw Exception(
        'Admin session has expired. Please sign in again.',
      );
    }

    final http.Response response =
        await http
            .get(
              Uri.parse(
                '$baseUrl/admin/deliveries/'
                '$deliveryId/available-riders',
              ),
              headers: {
                'Accept':
                    'application/json',
                'Authorization':
                    'Bearer $token',
              },
            )
            .timeout(
              const Duration(
                seconds: 45,
              ),
            );

    final Map<String, dynamic> root =
        decodeResponse(response);

    if (response.statusCode < 200 ||
        response.statusCode >= 300) {
      throw Exception(
        textFromDynamic(
          root['message'],
          fallback:
              'Failed to load available riders.',
        ),
      );
    }

    final Map<String, dynamic> data =
        mapFromDynamic(
      root['data'],
    );

    return listFromDynamic(
      root['riders'] ??
          data['riders'],
    );
  }

  Future<bool> assignRider({
    required Map<String, dynamic> delivery,
    required Map<String, dynamic> rider,
  }) async {
    final String deliveryId =
        textFromDynamic(
      delivery['_id'],
    );

    final String riderId =
        textFromDynamic(
      rider['_id'],
    );

    if (deliveryId.isEmpty ||
        riderId.isEmpty) {
      showMessage(
        'Invalid delivery or Rider information.',
        isError: true,
      );

      return false;
    }

    try {
      final String token =
          await getToken();

      if (token.isEmpty) {
        throw Exception(
          'Admin session has expired. Please sign in again.',
        );
      }

      final http.Response response =
          await http
              .patch(
                Uri.parse(
                  '$baseUrl/admin/deliveries/'
                  '$deliveryId/assign-rider',
                ),
                headers: {
                  'Accept':
                      'application/json',
                  'Content-Type':
                      'application/json',
                  'Authorization':
                      'Bearer $token',
                },
                body: jsonEncode({
                  'riderId': riderId,
                }),
              )
              .timeout(
                const Duration(
                  seconds: 45,
                ),
              );

      final Map<String, dynamic> result =
          decodeResponse(response);

      if (response.statusCode < 200 ||
          response.statusCode >= 300) {
        throw Exception(
          textFromDynamic(
            result['message'],
            fallback:
                'Failed to assign Rider.',
          ),
        );
      }

      showMessage(
        textFromDynamic(
          result['message'],
          fallback:
              'Rider assigned successfully.',
        ),
      );

      await loadDeliveries(
        showLoading: false,
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
        cleanError(error),
        isError: true,
      );

      return false;
    }
  }

  Future<bool> removeAssignedRider(
    Map<String, dynamic> delivery,
  ) async {
    final String deliveryId =
        textFromDynamic(
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
      final String token =
          await getToken();

      if (token.isEmpty) {
        throw Exception(
          'Admin session has expired. Please sign in again.',
        );
      }

      final http.Response response =
          await http
              .patch(
                Uri.parse(
                  '$baseUrl/admin/deliveries/'
                  '$deliveryId/unassign-rider',
                ),
                headers: {
                  'Accept':
                      'application/json',
                  'Content-Type':
                      'application/json',
                  'Authorization':
                      'Bearer $token',
                },
                body: jsonEncode({
                  'adminNote':
                      'Rider removed by Head Office.',
                }),
              )
              .timeout(
                const Duration(
                  seconds: 45,
                ),
              );

      final Map<String, dynamic> result =
          decodeResponse(response);

      if (response.statusCode < 200 ||
          response.statusCode >= 300) {
        throw Exception(
          textFromDynamic(
            result['message'],
            fallback:
                'Failed to remove Rider.',
          ),
        );
      }

      showMessage(
        textFromDynamic(
          result['message'],
          fallback:
              'Rider removed successfully.',
        ),
      );

      await loadDeliveries(
        showLoading: false,
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
        cleanError(error),
        isError: true,
      );

      return false;
    }
  }

  String getCustomerName(
    Map<String, dynamic> delivery,
  ) {
    final Map<String, dynamic> customer =
        mapFromDynamic(
      delivery['customerId'],
    );

    final String fullName =
        textFromDynamic(
      customer['fullName'],
    );

    if (fullName.isNotEmpty) {
      return fullName;
    }

    final String name =
        textFromDynamic(
      customer['name'],
    );

    if (name.isNotEmpty) {
      return name;
    }

    return textFromDynamic(
      delivery['senderName'],
      fallback:
          'ServicePay Customer',
    );
  }

  String getCustomerPhone(
    Map<String, dynamic> delivery,
  ) {
    final Map<String, dynamic> customer =
        mapFromDynamic(
      delivery['customerId'],
    );

    final String phone =
        textFromDynamic(
      customer['phone'],
    );

    if (phone.isNotEmpty) {
      return phone;
    }

    return textFromDynamic(
      delivery['senderPhone'],
      fallback:
          'Not available',
    );
  }

  String getTrackingNumber(
    Map<String, dynamic> delivery,
  ) {
    return textFromDynamic(
      delivery['trackingNumber'] ??
          delivery['trackingId'],
      fallback:
          'No tracking number',
    );
  }

  String getPackageName(
    Map<String, dynamic> delivery,
  ) {
    final String packageName =
        textFromDynamic(
      delivery['packageName'],
    );

    if (packageName.isNotEmpty) {
      return packageName;
    }

    return textFromDynamic(
      delivery['packageDescription'],
      fallback:
          'Package',
    );
  }

  Map<String, dynamic> getAssignedRider(
    Map<String, dynamic> delivery,
  ) {
    return mapFromDynamic(
      delivery['assignedRiderId'],
    );
  }

  String getAssignedRiderName(
    Map<String, dynamic> delivery,
  ) {
    final Map<String, dynamic> rider =
        getAssignedRider(
      delivery,
    );

    final String fullName =
        textFromDynamic(
      rider['fullName'],
    );

    if (fullName.isNotEmpty) {
      return fullName;
    }

    return textFromDynamic(
      delivery['riderName'],
      fallback:
          'Delivery Rider',
    );
  }

  String getAssignedRiderPhone(
    Map<String, dynamic> delivery,
  ) {
    final Map<String, dynamic> rider =
        getAssignedRider(
      delivery,
    );

    final String phone =
        textFromDynamic(
      rider['phone'],
    );

    if (phone.isNotEmpty) {
      return phone;
    }

    return textFromDynamic(
      delivery['riderPhone'],
      fallback:
          'Not available',
    );
  }

  String getAssignedRiderVehicle(
    Map<String, dynamic> delivery,
  ) {
    final Map<String, dynamic> rider =
        getAssignedRider(
      delivery,
    );

    return textFromDynamic(
      rider['vehicleType'],
      fallback:
          'Not available',
    ).replaceAll(
      '_',
      ' ',
    );
  }

  String getAssignedRiderAvailability(
    Map<String, dynamic> delivery,
  ) {
    final Map<String, dynamic> rider =
        getAssignedRider(
      delivery,
    );

    return textFromDynamic(
      rider['availabilityStatus'],
      fallback: 'OFFLINE',
    ).toUpperCase();
  }

  bool hasAssignedRider(
    Map<String, dynamic> delivery,
  ) {
    final dynamic assignedRiderId =
        delivery['assignedRiderId'];

    if (assignedRiderId is Map) {
      return textFromDynamic(
        assignedRiderId['_id'],
      ).isNotEmpty;
    }

    return textFromDynamic(
      assignedRiderId,
    ).isNotEmpty;
  }

  String getCommissionType(
    Map<String, dynamic> delivery,
  ) {
    final String type =
        textFromDynamic(
      delivery['riderCommissionType'],
      fallback: 'PERCENTAGE',
    ).toUpperCase();

    if (type == 'FIXED') {
      return 'FIXED';
    }

    return 'PERCENTAGE';
  }

  double getCommissionValue(
    Map<String, dynamic> delivery,
  ) {
    final dynamic rawValue =
        delivery['riderCommissionValue'];

    if (rawValue == null) {
      return 80;
    }

    return toDouble(rawValue);
  }

  double calculateRiderCommission({
    required double deliveryFee,
    required String commissionType,
    required double commissionValue,
  }) {
    if (deliveryFee <= 0) {
      return 0;
    }

    double commission = 0;

    if (commissionType == 'FIXED') {
      commission =
          commissionValue;
    } else {
      commission =
          deliveryFee *
              (commissionValue / 100);
    }

    if (commission < 0) {
      commission = 0;
    }

    if (commission > deliveryFee) {
      commission =
          deliveryFee;
    }

    return double.parse(
      commission.toStringAsFixed(2),
    );
  }

  double calculateServicePayProfit({
    required double deliveryFee,
    required double riderCommission,
  }) {
    final double profit =
        deliveryFee -
            riderCommission;

    if (profit < 0) {
      return 0;
    }

    return double.parse(
      profit.toStringAsFixed(2),
    );
  }

  String formatDate(
    dynamic value,
  ) {
    if (value == null) {
      return 'Not available';
    }

    final DateTime? date =
        DateTime.tryParse(
      value.toString(),
    );

    if (date == null) {
      return value.toString();
    }

    final DateTime localDate =
        date.toLocal();

    final DateTime now =
        DateTime.now();

    final DateTime today =
        DateTime(
      now.year,
      now.month,
      now.day,
    );

    final DateTime deliveryDay =
        DateTime(
      localDate.year,
      localDate.month,
      localDate.day,
    );

    final int difference =
        today
            .difference(
              deliveryDay,
            )
            .inDays;

    if (difference == 0) {
      return 'Today';
    }

    if (difference == 1) {
      return 'Yesterday';
    }

    const List<String> months = [
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec',
    ];

    return '${localDate.day} '
        '${months[localDate.month - 1]} '
        '${localDate.year}';
  }

  String formatMoney(
    dynamic value,
  ) {
    final double amount =
        toDouble(value);

    return '₦${amount.toStringAsFixed(2)}';
  }

  String formatStatus(
    String status,
  ) {
    return status
        .replaceAll('_', ' ')
        .split(' ')
        .map(
          (String word) =>
              word.isEmpty
                  ? word
                  : '${word[0].toUpperCase()}'
                      '${word.substring(1).toLowerCase()}',
        )
        .join(' ');
  }

  Color getStatusColor(
    String status,
  ) {
    switch (status.toUpperCase()) {
      case 'ASSIGNED':
        return Colors.indigo;

      case 'ACCEPTED':
        return Colors.blue;

      case 'PICKED_UP':
        return Colors.deepPurple;

      case 'IN_TRANSIT':
        return Colors.orange;

      case 'DELIVERED':
        return Colors.green;

      case 'CANCELLED':
        return Colors.red;

      case 'FAILED':
        return Colors.red.shade900;

      default:
        return Colors.amber.shade800;
    }
  }

  Color getPaymentStatusColor(
    String paymentStatus,
  ) {
    switch (
        paymentStatus.toUpperCase()) {
      case 'PAID':
        return Colors.green;

      case 'REFUNDED':
        return Colors.blue;

      default:
        return Colors.orange;
    }
  }

  Color getCommissionStatusColor(
    String commissionStatus,
  ) {
    switch (
        commissionStatus.toUpperCase()) {
      case 'CREDITED':
        return Colors.blue;

      case 'SETTLED':
        return Colors.green;

      case 'CANCELLED':
        return Colors.red;

      default:
        return Colors.orange;
    }
  }

  Color getAvailabilityColor(
    String availabilityStatus,
  ) {
    switch (
        availabilityStatus.toUpperCase()) {
      case 'ONLINE':
        return Colors.green;

      case 'BUSY':
        return Colors.orange;

      default:
        return Colors.grey;
    }
  }
  Future<void> showAssignRiderDialog(
    Map<String, dynamic> delivery,
  ) async {
    List<Map<String, dynamic>> riders =
        <Map<String, dynamic>>[];

    bool isLoadingRiders = true;
    bool isAssigning = false;
    String loadError = '';

    Map<String, dynamic>? selectedRider;

    await showDialog<void>(
      context: context,
      barrierDismissible: false,
      builder: (
        BuildContext dialogContext,
      ) {
        return StatefulBuilder(
          builder: (
            BuildContext dialogContext,
            void Function(
              void Function(),
            ) setDialogState,
          ) {
            Future<void> loadRiders() async {
              setDialogState(() {
                isLoadingRiders = true;
                loadError = '';
              });

              try {
                final List<Map<String, dynamic>>
                    loadedRiders =
                    await loadAvailableRiders(
                  delivery,
                );

                if (!dialogContext.mounted) {
                  return;
                }

                setDialogState(() {
                  riders = loadedRiders;
                  isLoadingRiders = false;

                  final String currentRiderId =
                      textFromDynamic(
                    getAssignedRider(
                      delivery,
                    )['_id'],
                  );

                  if (currentRiderId.isNotEmpty) {
                    for (final Map<String, dynamic>
                        rider in riders) {
                      if (textFromDynamic(
                            rider['_id'],
                          ) ==
                          currentRiderId) {
                        selectedRider = rider;
                        break;
                      }
                    }
                  }
                });
              } catch (error) {
                if (!dialogContext.mounted) {
                  return;
                }

                setDialogState(() {
                  isLoadingRiders = false;
                  loadError =
                      cleanError(error);
                });
              }
            }

            if (isLoadingRiders &&
                riders.isEmpty &&
                loadError.isEmpty) {
              Future<void>.microtask(
                loadRiders,
              );
            }

            return AlertDialog(
              shape: RoundedRectangleBorder(
                borderRadius:
                    BorderRadius.circular(
                  20,
                ),
              ),
              title: Text(
                hasAssignedRider(
                  delivery,
                )
                    ? 'Change Delivery Rider'
                    : 'Assign Delivery Rider',
                style: const TextStyle(
                  fontWeight:
                      FontWeight.w800,
                ),
              ),
              content: SizedBox(
                width: 620,
                child: isLoadingRiders
                    ? const Padding(
                        padding:
                            EdgeInsets.symmetric(
                          vertical: 40,
                        ),
                        child: Center(
                          child:
                              CircularProgressIndicator(),
                        ),
                      )
                    : loadError.isNotEmpty
                        ? Column(
                            mainAxisSize:
                                MainAxisSize.min,
                            children: [
                              const Icon(
                                Icons
                                    .error_outline_rounded,
                                size: 48,
                                color: Colors.red,
                              ),
                              const SizedBox(
                                height: 12,
                              ),
                              Text(
                                loadError,
                                textAlign:
                                    TextAlign.center,
                              ),
                              const SizedBox(
                                height: 14,
                              ),
                              ElevatedButton.icon(
                                onPressed:
                                    loadRiders,
                                icon: const Icon(
                                  Icons
                                      .refresh_rounded,
                                ),
                                label: const Text(
                                  'Try Again',
                                ),
                              ),
                            ],
                          )
                        : riders.isEmpty
                            ? const Padding(
                                padding:
                                    EdgeInsets.symmetric(
                                  vertical: 30,
                                ),
                                child: Column(
                                  mainAxisSize:
                                      MainAxisSize.min,
                                  children: [
                                    Icon(
                                      Icons
                                          .delivery_dining_outlined,
                                      size: 58,
                                      color:
                                          Colors.grey,
                                    ),
                                    SizedBox(
                                      height: 12,
                                    ),
                                    Text(
                                      'No verified Riders available',
                                      style:
                                          TextStyle(
                                        fontSize: 17,
                                        fontWeight:
                                            FontWeight.bold,
                                      ),
                                    ),
                                    SizedBox(
                                      height: 6,
                                    ),
                                    Text(
                                      'Create and verify a Delivery Rider before assigning this order.',
                                      textAlign:
                                          TextAlign.center,
                                    ),
                                  ],
                                ),
                              )
                            : ConstrainedBox(
                                constraints:
                                    const BoxConstraints(
                                  maxHeight: 460,
                                ),
                                child: ListView.separated(
                                  shrinkWrap: true,
                                  itemCount:
                                      riders.length,
                                  separatorBuilder: (
                                    BuildContext context,
                                    int index,
                                  ) {
                                    return const SizedBox(
                                      height: 10,
                                    );
                                  },
                                  itemBuilder: (
                                    BuildContext context,
                                    int index,
                                  ) {
                                    final Map<String, dynamic>
                                        rider =
                                        riders[index];

                                    final String fullName =
                                        textFromDynamic(
                                      rider['fullName'],
                                      fallback:
                                          'Delivery Rider',
                                    );

                                    final String riderCode =
                                        textFromDynamic(
                                      rider['riderId'],
                                      fallback:
                                          'No Rider ID',
                                    );

                                    final String phone =
                                        textFromDynamic(
                                      rider['phone'],
                                      fallback:
                                          'No phone',
                                    );

                                    final String vehicle =
                                        textFromDynamic(
                                      rider['vehicleType'],
                                      fallback:
                                          'Not set',
                                    ).replaceAll(
                                      '_',
                                      ' ',
                                    );

                                    final String state =
                                        textFromDynamic(
                                      rider['riderState'],
                                      fallback:
                                          'State not set',
                                    );

                                    final String availability =
                                        textFromDynamic(
                                      rider[
                                          'availabilityStatus'],
                                      fallback:
                                          'OFFLINE',
                                    ).toUpperCase();

                                    final bool selected =
                                        selectedRider !=
                                                null &&
                                            textFromDynamic(
                                                  selectedRider![
                                                      '_id'],
                                                ) ==
                                                textFromDynamic(
                                                  rider['_id'],
                                                );

                                    return Material(
                                      color: selected
                                          ? primaryColor
                                              .withValues(
                                              alpha: 0.08,
                                            )
                                          : Colors.white,
                                      borderRadius:
                                          BorderRadius.circular(
                                        14,
                                      ),
                                      child: InkWell(
                                        borderRadius:
                                            BorderRadius.circular(
                                          14,
                                        ),
                                        onTap: isAssigning
                                            ? null
                                            : () {
                                                setDialogState(
                                                  () {
                                                    selectedRider =
                                                        rider;
                                                  },
                                                );
                                              },
                                        child: Container(
                                          padding:
                                              const EdgeInsets.all(
                                            14,
                                          ),
                                          decoration:
                                              BoxDecoration(
                                            borderRadius:
                                                BorderRadius
                                                    .circular(
                                              14,
                                            ),
                                            border: Border.all(
                                              color: selected
                                                  ? primaryColor
                                                  : const Color(
                                                      0xFFE2E8F0,
                                                    ),
                                              width: selected
                                                  ? 2
                                                  : 1,
                                            ),
                                          ),
                                          child: Row(
                                            crossAxisAlignment:
                                                CrossAxisAlignment
                                                    .start,
                                            children: [
                                              CircleAvatar(
                                                radius: 24,
                                                backgroundColor:
                                                    primaryColor
                                                        .withValues(
                                                  alpha: 0.10,
                                                ),
                                                child:
                                                    const Icon(
                                                  Icons
                                                      .delivery_dining_rounded,
                                                  color:
                                                      primaryColor,
                                                ),
                                              ),
                                              const SizedBox(
                                                width: 12,
                                              ),
                                              Expanded(
                                                child: Column(
                                                  crossAxisAlignment:
                                                      CrossAxisAlignment
                                                          .start,
                                                  children: [
                                                    Row(
                                                      children: [
                                                        Expanded(
                                                          child:
                                                              Text(
                                                            fullName,
                                                            style:
                                                                const TextStyle(
                                                              fontWeight:
                                                                  FontWeight.bold,
                                                            ),
                                                          ),
                                                        ),
                                                        _StatusBadge(
                                                          text:
                                                              availability,
                                                          color:
                                                              getAvailabilityColor(
                                                            availability,
                                                          ),
                                                        ),
                                                      ],
                                                    ),
                                                    const SizedBox(
                                                      height: 4,
                                                    ),
                                                    Text(
                                                      riderCode,
                                                      style:
                                                          const TextStyle(
                                                        color:
                                                            Colors.black54,
                                                        fontSize: 12,
                                                      ),
                                                    ),
                                                    const SizedBox(
                                                      height: 8,
                                                    ),
                                                    Wrap(
                                                      spacing: 10,
                                                      runSpacing: 6,
                                                      children: [
                                                        _MiniInfo(
                                                          icon: Icons
                                                              .phone_outlined,
                                                          text:
                                                              phone,
                                                        ),
                                                        _MiniInfo(
                                                          icon: Icons
                                                              .two_wheeler_outlined,
                                                          text:
                                                              vehicle,
                                                        ),
                                                        _MiniInfo(
                                                          icon: Icons
                                                              .location_on_outlined,
                                                          text:
                                                              state,
                                                        ),
                                                      ],
                                                    ),
                                                  ],
                                                ),
                                              ),
                                              const SizedBox(
                                                width: 8,
                                              ),
                                              Radio<String>(
                                                value:
                                                    textFromDynamic(
                                                  rider['_id'],
                                                ),
                                                groupValue:
                                                    selectedRider ==
                                                            null
                                                        ? null
                                                        : textFromDynamic(
                                                            selectedRider![
                                                                '_id'],
                                                          ),
                                                onChanged:
                                                    isAssigning
                                                        ? null
                                                        : (_) {
                                                            setDialogState(
                                                              () {
                                                                selectedRider =
                                                                    rider;
                                                              },
                                                            );
                                                          },
                                              ),
                                            ],
                                          ),
                                        ),
                                      ),
                                    );
                                  },
                                ),
                              ),
              ),
              actions: [
                TextButton(
                  onPressed: isAssigning
                      ? null
                      : () {
                          Navigator.of(
                            dialogContext,
                          ).pop();
                        },
                  child: const Text(
                    'Cancel',
                  ),
                ),
                ElevatedButton.icon(
                  onPressed: isAssigning ||
                          selectedRider == null
                      ? null
                      : () async {
                          setDialogState(() {
                            isAssigning = true;
                          });

                          final bool success =
                              await assignRider(
                            delivery: delivery,
                            rider: selectedRider!,
                          );

                          if (!dialogContext.mounted) {
                            return;
                          }

                          if (success) {
                            Navigator.of(
                              dialogContext,
                            ).pop();
                            return;
                          }

                          setDialogState(() {
                            isAssigning = false;
                          });
                        },
                  style: ElevatedButton.styleFrom(
                    backgroundColor:
                        primaryColor,
                    foregroundColor:
                        Colors.white,
                  ),
                  icon: isAssigning
                      ? const SizedBox(
                          width: 18,
                          height: 18,
                          child:
                              CircularProgressIndicator(
                            strokeWidth: 2,
                            color: Colors.white,
                          ),
                        )
                      : const Icon(
                          Icons
                              .assignment_ind_rounded,
                        ),
                  label: Text(
                    isAssigning
                        ? 'Assigning...'
                        : hasAssignedRider(
                            delivery,
                          )
                            ? 'Change Rider'
                            : 'Assign Rider',
                  ),
                ),
              ],
            );
          },
        );
      },
    );
  }

  Future<void> confirmRemoveRider(
    Map<String, dynamic> delivery,
  ) async {
    final bool confirmed =
        await showDialog<bool>(
              context: context,
              builder: (
                BuildContext dialogContext,
              ) {
                return AlertDialog(
                  title: const Text(
                    'Remove Rider',
                  ),
                  content: Text(
                    'Remove ${getAssignedRiderName(delivery)} from this delivery?',
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
                        backgroundColor:
                            Colors.red,
                        foregroundColor:
                            Colors.white,
                      ),
                      child: const Text(
                        'Remove Rider',
                      ),
                    ),
                  ],
                );
              },
            ) ??
            false;

    if (!confirmed) {
      return;
    }

    await removeAssignedRider(
      delivery,
    );
  }

  void showDeliveryDetails(
    Map<String, dynamic> delivery,
  ) {
    final String status =
        textFromDynamic(
      delivery['status'],
      fallback: 'PENDING',
    ).toUpperCase();

    final String paymentStatus =
        textFromDynamic(
      delivery['paymentStatus'],
      fallback: 'UNPAID',
    ).toUpperCase();

    final String commissionType =
        getCommissionType(
      delivery,
    );

    final double commissionValue =
        getCommissionValue(
      delivery,
    );

    final double deliveryFee =
        toDouble(
      delivery['deliveryFee'],
    );

    final double riderCommission =
        toDouble(
      delivery['riderCommissionAmount'],
    );

    final double currentRiderCommission =
        riderCommission > 0
            ? riderCommission
            : calculateRiderCommission(
                deliveryFee: deliveryFee,
                commissionType:
                    commissionType,
                commissionValue:
                    commissionValue,
              );

    final double currentServicePayProfit =
        toDouble(
              delivery['servicepayProfit'],
            ) >
                0
            ? toDouble(
                delivery['servicepayProfit'],
              )
            : calculateServicePayProfit(
                deliveryFee: deliveryFee,
                riderCommission:
                    currentRiderCommission,
              );

    final String commissionStatus =
        textFromDynamic(
      delivery['riderCommissionStatus'],
      fallback: 'PENDING',
    ).toUpperCase();

    final bool assigned =
        hasAssignedRider(
      delivery,
    );

    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor:
          Colors.transparent,
      builder: (
        BuildContext bottomSheetContext,
      ) {
        return Container(
          constraints: BoxConstraints(
            maxHeight:
                MediaQuery.sizeOf(
                      context,
                    ).height *
                    0.92,
          ),
          decoration:
              const BoxDecoration(
            color: Colors.white,
            borderRadius:
                BorderRadius.vertical(
              top:
                  Radius.circular(28),
            ),
          ),
          child: SafeArea(
            top: false,
            child:
                SingleChildScrollView(
              padding:
                  const EdgeInsets.fromLTRB(
                20,
                12,
                20,
                30,
              ),
              child: Column(
                crossAxisAlignment:
                    CrossAxisAlignment.start,
                children: [
                  Center(
                    child: Container(
                      width: 45,
                      height: 5,
                      margin:
                          const EdgeInsets.only(
                        bottom: 20,
                      ),
                      decoration:
                          BoxDecoration(
                        color:
                            Colors.grey.shade300,
                        borderRadius:
                            BorderRadius.circular(
                          10,
                        ),
                      ),
                    ),
                  ),
                  Row(
                    children: [
                      Container(
                        width: 48,
                        height: 48,
                        decoration:
                            BoxDecoration(
                          color: primaryColor
                              .withValues(
                            alpha: 0.10,
                          ),
                          borderRadius:
                              BorderRadius.circular(
                            14,
                          ),
                        ),
                        child: const Icon(
                          Icons
                              .local_shipping_rounded,
                          color:
                              primaryColor,
                        ),
                      ),
                      const SizedBox(
                        width: 12,
                      ),
                      Expanded(
                        child: Column(
                          crossAxisAlignment:
                              CrossAxisAlignment.start,
                          children: [
                            Text(
                              getTrackingNumber(
                                delivery,
                              ),
                              style:
                                  const TextStyle(
                                fontSize: 18,
                                fontWeight:
                                    FontWeight.w800,
                              ),
                            ),
                            const SizedBox(
                              height: 4,
                            ),
                            Text(
                              formatDate(
                                delivery['createdAt'],
                              ),
                              style:
                                  TextStyle(
                                color: Colors
                                    .grey.shade600,
                              ),
                            ),
                          ],
                        ),
                      ),
                      _StatusBadge(
                        text:
                            formatStatus(status),
                        color:
                            getStatusColor(status),
                      ),
                    ],
                  ),
                  const SizedBox(
                    height: 24,
                  ),
                  _DetailSection(
                    title:
                        'Customer Information',
                    children: [
                      _DetailRow(
                        icon: Icons
                            .person_outline,
                        label: 'Customer',
                        value:
                            getCustomerName(
                          delivery,
                        ),
                      ),
                      _DetailRow(
                        icon:
                            Icons.phone_outlined,
                        label: 'Phone',
                        value:
                            getCustomerPhone(
                          delivery,
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(
                    height: 16,
                  ),
                  _DetailSection(
                    title:
                        'Delivery Information',
                    children: [
                      _DetailRow(
                        icon: Icons
                            .location_on_outlined,
                        label: 'Pickup',
                        value:
                            textFromDynamic(
                          delivery[
                              'pickupAddress'],
                          fallback:
                              'Not available',
                        ),
                      ),
                      _DetailRow(
                        icon:
                            Icons.flag_outlined,
                        label:
                            'Destination',
                        value:
                            textFromDynamic(
                          delivery[
                              'deliveryAddress'],
                          fallback:
                              'Not available',
                        ),
                      ),
                      _DetailRow(
                        icon: Icons
                            .inventory_2_outlined,
                        label: 'Package',
                        value:
                            getPackageName(
                          delivery,
                        ),
                      ),
                      _DetailRow(
                        icon:
                            Icons.scale_outlined,
                        label: 'Weight',
                        value:
                            '${toDouble(delivery['packageWeight']).toStringAsFixed(2)} kg',
                      ),
                      _DetailRow(
                        icon: Icons
                            .payments_outlined,
                        label:
                            'Delivery Fee',
                        value:
                            formatMoney(
                          deliveryFee,
                        ),
                      ),
                      _DetailRow(
                        icon: Icons
                            .account_balance_wallet_outlined,
                        label:
                            'Payment Status',
                        value:
                            formatStatus(
                          paymentStatus,
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(
                    height: 16,
                  ),
                  _DetailSection(
                    title:
                        'Rider Commission',
                    children: [
                      _DetailRow(
                        icon: Icons
                            .percent_rounded,
                        label:
                            'Commission Type',
                        value:
                            formatStatus(
                          commissionType,
                        ),
                      ),
                      _DetailRow(
                        icon: Icons
                            .calculate_outlined,
                        label:
                            'Commission Value',
                        value: commissionType ==
                                'PERCENTAGE'
                            ? '${commissionValue.toStringAsFixed(2)}%'
                            : formatMoney(
                                commissionValue,
                              ),
                      ),
                      _DetailRow(
                        icon: Icons
                            .account_balance_wallet_outlined,
                        label:
                            'Rider Commission',
                        value:
                            formatMoney(
                          currentRiderCommission,
                        ),
                      ),
                      _DetailRow(
                        icon: Icons
                            .business_center_outlined,
                        label:
                            'ServicePay Profit',
                        value:
                            formatMoney(
                          currentServicePayProfit,
                        ),
                      ),
                      _DetailRow(
                        icon: Icons
                            .verified_outlined,
                        label:
                            'Commission Status',
                        value:
                            formatStatus(
                          commissionStatus,
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(
                    height: 16,
                  ),
                  _DetailSection(
                    title:
                        'Receiver Information',
                    children: [
                      _DetailRow(
                        icon: Icons
                            .person_outline,
                        label: 'Receiver',
                        value:
                            textFromDynamic(
                          delivery[
                              'receiverName'],
                          fallback:
                              'Not available',
                        ),
                      ),
                      _DetailRow(
                        icon:
                            Icons.phone_outlined,
                        label:
                            'Receiver Phone',
                        value:
                            textFromDynamic(
                          delivery[
                              'receiverPhone'],
                          fallback:
                              'Not available',
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(
                    height: 16,
                  ),
                  _DetailSection(
                    title:
                        'Assigned Rider',
                    children: assigned
                        ? [
                            _DetailRow(
                              icon: Icons
                                  .delivery_dining_rounded,
                              label: 'Rider',
                              value:
                                  getAssignedRiderName(
                                delivery,
                              ),
                            ),
                            _DetailRow(
                              icon: Icons
                                  .phone_outlined,
                              label:
                                  'Rider Phone',
                              value:
                                  getAssignedRiderPhone(
                                delivery,
                              ),
                            ),
                            _DetailRow(
                              icon: Icons
                                  .two_wheeler_outlined,
                              label:
                                  'Vehicle',
                              value:
                                  getAssignedRiderVehicle(
                                delivery,
                              ),
                            ),
                            _DetailRow(
                              icon: Icons
                                  .radio_button_checked,
                              label:
                                  'Availability',
                              value:
                                  getAssignedRiderAvailability(
                                delivery,
                              ),
                            ),
                          ]
                        : const [
                            _DetailRow(
                              icon: Icons
                                  .person_off_outlined,
                              label: 'Rider',
                              value:
                                  'No Rider has been assigned.',
                            ),
                          ],
                  ),
                  const SizedBox(
                    height: 20,
                  ),
                  SizedBox(
                    width:
                        double.infinity,
                    height: 52,
                    child:
                        ElevatedButton.icon(
                      onPressed: () {
                        Navigator.of(
                          bottomSheetContext,
                        ).pop();

                        showAssignRiderDialog(
                          delivery,
                        );
                      },
                      style:
                          ElevatedButton.styleFrom(
                        backgroundColor:
                            Colors.indigo,
                        foregroundColor:
                            Colors.white,
                        shape:
                            RoundedRectangleBorder(
                          borderRadius:
                              BorderRadius.circular(
                            14,
                          ),
                        ),
                      ),
                      icon: Icon(
                        assigned
                            ? Icons
                                .swap_horiz_rounded
                            : Icons
                                .assignment_ind_rounded,
                      ),
                      label: Text(
                        assigned
                            ? 'Change Rider'
                            : 'Assign Rider',
                        style:
                            const TextStyle(
                          fontWeight:
                              FontWeight.w700,
                        ),
                      ),
                    ),
                  ),
                  if (assigned) ...[
                    const SizedBox(
                      height: 12,
                    ),
                    SizedBox(
                      width:
                          double.infinity,
                      height: 52,
                      child:
                          OutlinedButton.icon(
                        onPressed: () {
                          Navigator.of(
                            bottomSheetContext,
                          ).pop();

                          confirmRemoveRider(
                            delivery,
                          );
                        },
                        style:
                            OutlinedButton.styleFrom(
                          foregroundColor:
                              Colors.red,
                          side:
                              const BorderSide(
                            color:
                                Colors.red,
                          ),
                          shape:
                              RoundedRectangleBorder(
                            borderRadius:
                                BorderRadius.circular(
                              14,
                            ),
                          ),
                        ),
                        icon: const Icon(
                          Icons
                              .person_remove_outlined,
                        ),
                        label:
                            const Text(
                          'Remove Rider',
                          style:
                              TextStyle(
                            fontWeight:
                                FontWeight.w700,
                          ),
                        ),
                      ),
                    ),
                  ],
                  const SizedBox(
                    height: 12,
                  ),
                  SizedBox(
                    width:
                        double.infinity,
                    height: 52,
                    child:
                        ElevatedButton.icon(
                      onPressed: () {
                        Navigator.of(
                          bottomSheetContext,
                        ).pop();

                        showPriceDialog(
                          delivery,
                        );
                      },
                      style:
                          ElevatedButton.styleFrom(
                        backgroundColor:
                            const Color(
                          0xFFB45309,
                        ),
                        foregroundColor:
                            Colors.white,
                        shape:
                            RoundedRectangleBorder(
                          borderRadius:
                              BorderRadius.circular(
                            14,
                          ),
                        ),
                      ),
                      icon: const Icon(
                        Icons
                            .price_change_rounded,
                      ),
                      label: Text(
                        deliveryFee > 0
                            ? 'Update Price & Commission'
                            : 'Set Price & Commission',
                        style:
                            const TextStyle(
                          fontWeight:
                              FontWeight.w700,
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(
                    height: 12,
                  ),
                  SizedBox(
                    width:
                        double.infinity,
                    height: 52,
                    child:
                        ElevatedButton.icon(
                      onPressed: () {
                        Navigator.of(
                          bottomSheetContext,
                        ).pop();

                        showStatusDialog(
                          delivery,
                        );
                      },
                      style:
                          ElevatedButton.styleFrom(
                        backgroundColor:
                            primaryColor,
                        foregroundColor:
                            Colors.white,
                        shape:
                            RoundedRectangleBorder(
                          borderRadius:
                              BorderRadius.circular(
                            14,
                          ),
                        ),
                      ),
                      icon: const Icon(
                        Icons.edit_rounded,
                      ),
                      label: const Text(
                        'Update Delivery Status',
                        style:
                            TextStyle(
                          fontWeight:
                              FontWeight.w700,
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
        );
      },
    );
  }
  void showPriceDialog(
    Map<String, dynamic> delivery,
  ) {
    final double currentFee =
        toDouble(
      delivery['deliveryFee'],
    );

    final TextEditingController
        priceController =
        TextEditingController(
      text: currentFee > 0
          ? currentFee.toStringAsFixed(2)
          : '',
    );

    String paymentStatus =
        textFromDynamic(
      delivery['paymentStatus'],
      fallback: 'UNPAID',
    ).toUpperCase();

    String commissionType =
        getCommissionType(
      delivery,
    );

    final TextEditingController
        commissionController =
        TextEditingController(
      text: getCommissionValue(
        delivery,
      ).toStringAsFixed(2),
    );

    const List<String> paymentStatuses = [
      'UNPAID',
      'PAID',
      'REFUNDED',
    ];

    const List<String> commissionTypes = [
      'PERCENTAGE',
      'FIXED',
    ];

    if (!paymentStatuses.contains(
      paymentStatus,
    )) {
      paymentStatus = 'UNPAID';
    }

    if (!commissionTypes.contains(
      commissionType,
    )) {
      commissionType =
          'PERCENTAGE';
    }

    bool isSaving = false;

    showDialog<void>(
      context: context,
      barrierDismissible: false,
      builder: (
        BuildContext dialogContext,
      ) {
        return StatefulBuilder(
          builder: (
            BuildContext dialogContext,
            void Function(
              void Function(),
            ) setDialogState,
          ) {
            final double enteredPrice =
                double.tryParse(
                      priceController.text
                          .trim()
                          .replaceAll(',', ''),
                    ) ??
                    0;

            final double enteredCommission =
                double.tryParse(
                      commissionController.text
                          .trim()
                          .replaceAll(',', ''),
                    ) ??
                    0;

            final double calculatedRiderCommission =
                calculateRiderCommission(
              deliveryFee:
                  enteredPrice,
              commissionType:
                  commissionType,
              commissionValue:
                  enteredCommission,
            );

            final double calculatedProfit =
                calculateServicePayProfit(
              deliveryFee:
                  enteredPrice,
              riderCommission:
                  calculatedRiderCommission,
            );

            return AlertDialog(
              shape:
                  RoundedRectangleBorder(
                borderRadius:
                    BorderRadius.circular(
                  20,
                ),
              ),
              title: const Text(
                'Set Price & Rider Commission',
                style: TextStyle(
                  fontWeight:
                      FontWeight.w800,
                ),
              ),
              content:
                  SingleChildScrollView(
                child: SizedBox(
                  width: 520,
                  child: Column(
                    mainAxisSize:
                        MainAxisSize.min,
                    crossAxisAlignment:
                        CrossAxisAlignment.start,
                    children: [
                      Text(
                        getTrackingNumber(
                          delivery,
                        ),
                        style: TextStyle(
                          color: Colors
                              .grey.shade600,
                          fontWeight:
                              FontWeight.w600,
                        ),
                      ),
                      const SizedBox(
                        height: 18,
                      ),
                      TextField(
                        controller:
                            priceController,
                        enabled:
                            !isSaving,
                        keyboardType:
                            const TextInputType
                                .numberWithOptions(
                          decimal: true,
                        ),
                        inputFormatters: [
                          FilteringTextInputFormatter
                              .allow(
                            RegExp(
                              r'^\d*\.?\d{0,2}',
                            ),
                          ),
                        ],
                        onChanged: (_) {
                          setDialogState(
                            () {},
                          );
                        },
                        decoration:
                            InputDecoration(
                          labelText:
                              'Delivery Price',
                          hintText:
                              'Example: 2500',
                          prefixText:
                              '₦ ',
                          prefixIcon:
                              const Icon(
                            Icons
                                .payments_outlined,
                          ),
                          border:
                              OutlineInputBorder(
                            borderRadius:
                                BorderRadius
                                    .circular(
                              12,
                            ),
                          ),
                        ),
                      ),
                      const SizedBox(
                        height: 16,
                      ),
                      DropdownButtonFormField<
                          String>(
                        value:
                            commissionType,
                        decoration:
                            InputDecoration(
                          labelText:
                              'Rider Commission Type',
                          prefixIcon:
                              const Icon(
                            Icons
                                .calculate_outlined,
                          ),
                          border:
                              OutlineInputBorder(
                            borderRadius:
                                BorderRadius
                                    .circular(
                              12,
                            ),
                          ),
                        ),
                        items: const [
                          DropdownMenuItem<
                              String>(
                            value:
                                'PERCENTAGE',
                            child: Text(
                              'Percentage',
                            ),
                          ),
                          DropdownMenuItem<
                              String>(
                            value:
                                'FIXED',
                            child: Text(
                              'Fixed Amount',
                            ),
                          ),
                        ],
                        onChanged:
                            isSaving
                                ? null
                                : (
                                    String?
                                        value,
                                  ) {
                                    if (value ==
                                        null) {
                                      return;
                                    }

                                    setDialogState(
                                      () {
                                        commissionType =
                                            value;

                                        if (value ==
                                                'PERCENTAGE' &&
                                            commissionController
                                                .text
                                                .trim()
                                                .isEmpty) {
                                          commissionController
                                                  .text =
                                              '80.00';
                                        }
                                      },
                                    );
                                  },
                      ),
                      const SizedBox(
                        height: 16,
                      ),
                      TextField(
                        controller:
                            commissionController,
                        enabled:
                            !isSaving,
                        keyboardType:
                            const TextInputType
                                .numberWithOptions(
                          decimal: true,
                        ),
                        inputFormatters: [
                          FilteringTextInputFormatter
                              .allow(
                            RegExp(
                              r'^\d*\.?\d{0,2}',
                            ),
                          ),
                        ],
                        onChanged: (_) {
                          setDialogState(
                            () {},
                          );
                        },
                        decoration:
                            InputDecoration(
                          labelText:
                              commissionType ==
                                      'PERCENTAGE'
                                  ? 'Rider Commission Percentage'
                                  : 'Fixed Rider Commission',
                          hintText:
                              commissionType ==
                                      'PERCENTAGE'
                                  ? 'Example: 80'
                                  : 'Example: 1500',
                          prefixText:
                              commissionType ==
                                      'FIXED'
                                  ? '₦ '
                                  : null,
                          suffixText:
                              commissionType ==
                                      'PERCENTAGE'
                                  ? '%'
                                  : null,
                          prefixIcon:
                              const Icon(
                            Icons
                                .account_balance_wallet_outlined,
                          ),
                          border:
                              OutlineInputBorder(
                            borderRadius:
                                BorderRadius
                                    .circular(
                              12,
                            ),
                          ),
                        ),
                      ),
                      const SizedBox(
                        height: 16,
                      ),
                      DropdownButtonFormField<
                          String>(
                        value:
                            paymentStatus,
                        decoration:
                            InputDecoration(
                          labelText:
                              'Payment Status',
                          prefixIcon:
                              const Icon(
                            Icons
                                .verified_user_outlined,
                          ),
                          border:
                              OutlineInputBorder(
                            borderRadius:
                                BorderRadius
                                    .circular(
                              12,
                            ),
                          ),
                        ),
                        items: paymentStatuses
                            .map(
                          (
                            String status,
                          ) {
                            return DropdownMenuItem<
                                String>(
                              value:
                                  status,
                              child:
                                  Text(
                                formatStatus(
                                  status,
                                ),
                              ),
                            );
                          },
                        ).toList(),
                        onChanged:
                            isSaving
                                ? null
                                : (
                                    String?
                                        value,
                                  ) {
                                    if (value ==
                                        null) {
                                      return;
                                    }

                                    setDialogState(
                                      () {
                                        paymentStatus =
                                            value;
                                      },
                                    );
                                  },
                      ),
                      const SizedBox(
                        height: 18,
                      ),
                      Container(
                        width:
                            double.infinity,
                        padding:
                            const EdgeInsets
                                .all(
                          14,
                        ),
                        decoration:
                            BoxDecoration(
                          color:
                              const Color(
                            0xFFF1F5F9,
                          ),
                          borderRadius:
                              BorderRadius
                                  .circular(
                            14,
                          ),
                        ),
                        child: Column(
                          crossAxisAlignment:
                              CrossAxisAlignment
                                  .start,
                          children: [
                            const Text(
                              'Commission Preview',
                              style:
                                  TextStyle(
                                fontWeight:
                                    FontWeight
                                        .bold,
                              ),
                            ),
                            const SizedBox(
                              height: 12,
                            ),
                            Row(
                              children: [
                                const Expanded(
                                  child:
                                      Text(
                                    'Delivery Fee',
                                  ),
                                ),
                                Text(
                                  formatMoney(
                                    enteredPrice,
                                  ),
                                  style:
                                      const TextStyle(
                                    fontWeight:
                                        FontWeight
                                            .bold,
                                  ),
                                ),
                              ],
                            ),
                            const SizedBox(
                              height: 8,
                            ),
                            Row(
                              children: [
                                const Expanded(
                                  child:
                                      Text(
                                    'Rider Commission',
                                  ),
                                ),
                                Text(
                                  formatMoney(
                                    calculatedRiderCommission,
                                  ),
                                  style:
                                      const TextStyle(
                                    color:
                                        primaryColor,
                                    fontWeight:
                                        FontWeight
                                            .bold,
                                  ),
                                ),
                              ],
                            ),
                            const SizedBox(
                              height: 8,
                            ),
                            Row(
                              children: [
                                const Expanded(
                                  child:
                                      Text(
                                    'ServicePay Profit',
                                  ),
                                ),
                                Text(
                                  formatMoney(
                                    calculatedProfit,
                                  ),
                                  style:
                                      const TextStyle(
                                    color:
                                        Colors.blue,
                                    fontWeight:
                                        FontWeight
                                            .bold,
                                  ),
                                ),
                              ],
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(
                        height: 12,
                      ),
                      Container(
                        width:
                            double.infinity,
                        padding:
                            const EdgeInsets
                                .all(
                          12,
                        ),
                        decoration:
                            BoxDecoration(
                          color: Colors
                              .orange
                              .withValues(
                            alpha: 0.08,
                          ),
                          borderRadius:
                              BorderRadius
                                  .circular(
                            12,
                          ),
                        ),
                        child: const Text(
                          'Rider commission will enter the Rider pending settlement automatically only after the delivery is marked Delivered and payment status is Paid.',
                          style:
                              TextStyle(
                            fontSize: 12,
                            height: 1.5,
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
              actions: [
                TextButton(
                  onPressed:
                      isSaving
                          ? null
                          : () {
                              Navigator.of(
                                dialogContext,
                              ).pop();
                            },
                  child:
                      const Text(
                    'Cancel',
                  ),
                ),
                ElevatedButton.icon(
                  onPressed:
                      isSaving
                          ? null
                          : () async {
                              final double?
                                  price =
                                  double.tryParse(
                                priceController
                                    .text
                                    .trim()
                                    .replaceAll(
                                      ',',
                                      '',
                                    ),
                              );

                              final double?
                                  commissionValue =
                                  double.tryParse(
                                commissionController
                                    .text
                                    .trim()
                                    .replaceAll(
                                      ',',
                                      '',
                                    ),
                              );

                              if (price ==
                                      null ||
                                  price <
                                      0) {
                                showMessage(
                                  'Enter a valid delivery price.',
                                  isError:
                                      true,
                                );
                                return;
                              }

                              if (commissionValue ==
                                      null ||
                                  commissionValue <
                                      0) {
                                showMessage(
                                  'Enter a valid Rider commission value.',
                                  isError:
                                      true,
                                );
                                return;
                              }

                              if (commissionType ==
                                      'PERCENTAGE' &&
                                  commissionValue >
                                      100) {
                                showMessage(
                                  'Percentage commission cannot exceed 100%.',
                                  isError:
                                      true,
                                );
                                return;
                              }

                              if (commissionType ==
                                      'FIXED' &&
                                  commissionValue >
                                      price) {
                                showMessage(
                                  'Fixed Rider commission cannot exceed the delivery price.',
                                  isError:
                                      true,
                                );
                                return;
                              }

                              setDialogState(
                                () {
                                  isSaving =
                                      true;
                                },
                              );

                              final bool
                                  success =
                                  await updateDeliveryPrice(
                                delivery:
                                    delivery,
                                deliveryFee:
                                    price,
                                paymentStatus:
                                    paymentStatus,
                                riderCommissionType:
                                    commissionType,
                                riderCommissionValue:
                                    commissionValue,
                              );

                              if (!dialogContext
                                  .mounted) {
                                return;
                              }

                              if (success) {
                                Navigator.of(
                                  dialogContext,
                                ).pop();
                                return;
                              }

                              setDialogState(
                                () {
                                  isSaving =
                                      false;
                                },
                              );
                            },
                  style:
                      ElevatedButton
                          .styleFrom(
                    backgroundColor:
                        const Color(
                      0xFFB45309,
                    ),
                    foregroundColor:
                        Colors.white,
                  ),
                  icon: isSaving
                      ? const SizedBox(
                          width: 18,
                          height: 18,
                          child:
                              CircularProgressIndicator(
                            strokeWidth:
                                2,
                            color:
                                Colors.white,
                          ),
                        )
                      : const Icon(
                          Icons
                              .save_rounded,
                        ),
                  label: Text(
                    isSaving
                        ? 'Saving...'
                        : 'Save Price & Commission',
                  ),
                ),
              ],
            );
          },
        );
      },
    ).whenComplete(
      () {
        priceController.dispose();
        commissionController.dispose();
      },
    );
  }

  void showStatusDialog(
    Map<String, dynamic> delivery,
  ) {
    String newStatus =
        textFromDynamic(
      delivery['status'],
      fallback: 'PENDING',
    ).toUpperCase();

    const List<String> statuses = [
      'PENDING',
      'ASSIGNED',
      'ACCEPTED',
      'PICKED_UP',
      'IN_TRANSIT',
      'DELIVERED',
      'CANCELLED',
      'FAILED',
    ];

    if (!statuses.contains(
      newStatus,
    )) {
      newStatus =
          'PENDING';
    }

    bool isUpdating = false;

    showDialog<void>(
      context: context,
      barrierDismissible: false,
      builder: (
        BuildContext dialogContext,
      ) {
        return StatefulBuilder(
          builder: (
            BuildContext dialogContext,
            void Function(
              void Function(),
            ) setDialogState,
          ) {
            return AlertDialog(
              shape:
                  RoundedRectangleBorder(
                borderRadius:
                    BorderRadius.circular(
                  20,
                ),
              ),
              title: const Text(
                'Update Delivery Status',
                style: TextStyle(
                  fontWeight:
                      FontWeight.w800,
                ),
              ),
              content:
                  DropdownButtonFormField<
                      String>(
                value:
                    newStatus,
                decoration:
                    InputDecoration(
                  labelText:
                      'Delivery Status',
                  border:
                      OutlineInputBorder(
                    borderRadius:
                        BorderRadius
                            .circular(
                      12,
                    ),
                  ),
                ),
                items: statuses.map(
                  (
                    String status,
                  ) {
                    return DropdownMenuItem<
                        String>(
                      value:
                          status,
                      child:
                          Text(
                        formatStatus(
                          status,
                        ),
                      ),
                    );
                  },
                ).toList(),
                onChanged:
                    isUpdating
                        ? null
                        : (
                            String?
                                value,
                          ) {
                            if (value ==
                                null) {
                              return;
                            }

                            setDialogState(
                              () {
                                newStatus =
                                    value;
                              },
                            );
                          },
              ),
              actions: [
                TextButton(
                  onPressed:
                      isUpdating
                          ? null
                          : () {
                              Navigator.of(
                                dialogContext,
                              ).pop();
                            },
                  child:
                      const Text(
                    'Cancel',
                  ),
                ),
                ElevatedButton(
                  onPressed:
                      isUpdating
                          ? null
                          : () async {
                              if (newStatus ==
                                      'ASSIGNED' &&
                                  !hasAssignedRider(
                                    delivery,
                                  )) {
                                showMessage(
                                  'Assign a Rider before selecting Assigned status.',
                                  isError:
                                      true,
                                );
                                return;
                              }

                              setDialogState(
                                () {
                                  isUpdating =
                                      true;
                                },
                              );

                              final bool
                                  success =
                                  await updateDeliveryStatus(
                                delivery:
                                    delivery,
                                status:
                                    newStatus,
                              );

                              if (!dialogContext
                                  .mounted) {
                                return;
                              }

                              if (success) {
                                Navigator.of(
                                  dialogContext,
                                ).pop();
                                return;
                              }

                              setDialogState(
                                () {
                                  isUpdating =
                                      false;
                                },
                              );
                            },
                  style:
                      ElevatedButton
                          .styleFrom(
                    backgroundColor:
                        primaryColor,
                    foregroundColor:
                        Colors.white,
                  ),
                  child: isUpdating
                      ? const SizedBox(
                          width: 20,
                          height: 20,
                          child:
                              CircularProgressIndicator(
                            strokeWidth:
                                2,
                            color:
                                Colors.white,
                          ),
                        )
                      : const Text(
                          'Update',
                        ),
                ),
              ],
            );
          },
        );
      },
    );
  }

  Widget buildSummaryCard({
    required String title,
    required String value,
    required IconData icon,
    Color? color,
  }) {
    final Color cardColor =
        color ?? primaryColor;

    return Container(
      padding:
          const EdgeInsets.all(
        15,
      ),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius:
            BorderRadius.circular(
          18,
        ),
        border: Border.all(
          color:
              Colors.grey.shade200,
        ),
        boxShadow: [
          BoxShadow(
            color:
                Colors.black.withValues(
              alpha: 0.04,
            ),
            blurRadius: 12,
            offset:
                const Offset(0, 5),
          ),
        ],
      ),
      child: Row(
        children: [
          Container(
            width: 44,
            height: 44,
            decoration:
                BoxDecoration(
              color: cardColor
                  .withValues(
                alpha: 0.10,
              ),
              borderRadius:
                  BorderRadius
                      .circular(
                13,
              ),
            ),
            child: Icon(
              icon,
              color:
                  cardColor,
              size: 22,
            ),
          ),
          const SizedBox(
            width: 11,
          ),
          Expanded(
            child: Column(
              crossAxisAlignment:
                  CrossAxisAlignment
                      .start,
              children: [
                Text(
                  value,
                  maxLines: 1,
                  overflow:
                      TextOverflow
                          .ellipsis,
                  style:
                      const TextStyle(
                    fontSize: 18,
                    fontWeight:
                        FontWeight
                            .w800,
                  ),
                ),
                const SizedBox(
                  height: 2,
                ),
                Text(
                  title,
                  maxLines: 1,
                  overflow:
                      TextOverflow
                          .ellipsis,
                  style:
                      TextStyle(
                    fontSize: 11,
                    color: Colors
                        .grey.shade600,
                    fontWeight:
                        FontWeight
                            .w600,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget buildLoadingState() {
    return const Center(
      child:
          CircularProgressIndicator(
        color: primaryColor,
      ),
    );
  }

  Widget buildErrorState() {
    return Center(
      child: Padding(
        padding:
            const EdgeInsets.all(
          24,
        ),
        child: Column(
          mainAxisSize:
              MainAxisSize.min,
          children: [
            Icon(
              Icons
                  .cloud_off_rounded,
              size: 70,
              color:
                  Colors.red.shade300,
            ),
            const SizedBox(
              height: 16,
            ),
            const Text(
              'Unable to load deliveries',
              textAlign:
                  TextAlign.center,
              style:
                  TextStyle(
                fontSize: 20,
                fontWeight:
                    FontWeight.w800,
              ),
            ),
            const SizedBox(
              height: 8,
            ),
            Text(
              errorMessage,
              textAlign:
                  TextAlign.center,
              style:
                  TextStyle(
                color: Colors
                    .grey.shade600,
              ),
            ),
            const SizedBox(
              height: 20,
            ),
            ElevatedButton.icon(
              onPressed:
                  loadDeliveries,
              style:
                  ElevatedButton
                      .styleFrom(
                backgroundColor:
                    primaryColor,
                foregroundColor:
                    Colors.white,
              ),
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
    );
  }
  Widget buildDeliveryContent() {
    final double screenWidth =
        MediaQuery.sizeOf(context).width;

    final int summaryColumns =
        screenWidth > 1100
            ? 4
            : screenWidth > 700
                ? 3
                : 2;

    return RefreshIndicator(
      onRefresh: () {
        return loadDeliveries(
          showLoading: false,
        );
      },
      child: ListView(
        padding:
            const EdgeInsets.all(
          16,
        ),
        children: [
          GridView.count(
            crossAxisCount:
                summaryColumns,
            crossAxisSpacing: 12,
            mainAxisSpacing: 12,
            childAspectRatio:
                screenWidth > 700
                    ? 2.05
                    : 1.55,
            shrinkWrap: true,
            physics:
                const NeverScrollableScrollPhysics(),
            children: [
              buildSummaryCard(
                title:
                    'Total Deliveries',
                value:
                    totalDeliveries.toString(),
                icon: Icons
                    .local_shipping_outlined,
              ),
              buildSummaryCard(
                title: 'Pending',
                value:
                    pendingDeliveries.toString(),
                icon:
                    Icons.schedule_rounded,
                color:
                    Colors.orange,
              ),
              buildSummaryCard(
                title: 'Assigned',
                value:
                    assignedDeliveries.toString(),
                icon: Icons
                    .assignment_ind_outlined,
                color:
                    Colors.indigo,
              ),
              buildSummaryCard(
                title: 'Delivered',
                value:
                    deliveredDeliveries.toString(),
                icon: Icons
                    .check_circle_outline_rounded,
                color:
                    Colors.green,
              ),
              buildSummaryCard(
                title:
                    'Paid Revenue',
                value:
                    formatMoney(
                  totalRevenue,
                ),
                icon:
                    Icons.payments_outlined,
                color:
                    Colors.green,
              ),
              buildSummaryCard(
                title:
                    'Quoted Delivery Value',
                value:
                    formatMoney(
                  totalQuotedPrice,
                ),
                icon:
                    Icons.receipt_long_outlined,
                color:
                    Colors.blueGrey,
              ),
              buildSummaryCard(
                title:
                    'Rider Commission',
                value:
                    formatMoney(
                  totalRiderCommission,
                ),
                icon: Icons
                    .delivery_dining_outlined,
                color:
                    Colors.deepPurple,
              ),
              buildSummaryCard(
                title:
                    'ServicePay Profit',
                value:
                    formatMoney(
                  servicepayProfit,
                ),
                icon: Icons
                    .business_center_outlined,
                color:
                    primaryColor,
              ),
            ],
          ),
          const SizedBox(
            height: 16,
          ),
          Container(
            width:
                double.infinity,
            padding:
                const EdgeInsets.all(
              14,
            ),
            decoration:
                BoxDecoration(
              color: Colors.white,
              borderRadius:
                  BorderRadius.circular(
                16,
              ),
              border: Border.all(
                color: Colors
                    .grey.shade200,
              ),
            ),
            child: Wrap(
              spacing: 10,
              runSpacing: 10,
              children: [
                _CommissionSummaryChip(
                  label:
                      'Pending',
                  value:
                      pendingCommissions,
                  color:
                      Colors.orange,
                ),
                _CommissionSummaryChip(
                  label:
                      'Credited',
                  value:
                      creditedCommissions,
                  color:
                      Colors.blue,
                ),
                _CommissionSummaryChip(
                  label:
                      'Settled',
                  value:
                      settledCommissions,
                  color:
                      Colors.green,
                ),
              ],
            ),
          ),
          const SizedBox(
            height: 20,
          ),
          TextField(
            controller:
                searchController,
            textInputAction:
                TextInputAction.search,
            onChanged: (_) {
              setState(() {});
            },
            onSubmitted: (_) {
              loadDeliveries();
            },
            decoration:
                InputDecoration(
              hintText:
                  'Search tracking ID, customer, Rider or phone',
              prefixIcon:
                  const Icon(
                Icons.search_rounded,
              ),
              suffixIcon:
                  searchController
                          .text
                          .isNotEmpty
                      ? IconButton(
                          onPressed:
                              () {
                            searchController
                                .clear();

                            setState(
                              () {},
                            );

                            loadDeliveries();
                          },
                          icon:
                              const Icon(
                            Icons
                                .close_rounded,
                          ),
                        )
                      : null,
              filled: true,
              fillColor:
                  Colors.white,
              border:
                  OutlineInputBorder(
                borderRadius:
                    BorderRadius
                        .circular(
                  15,
                ),
                borderSide:
                    BorderSide.none,
              ),
              enabledBorder:
                  OutlineInputBorder(
                borderRadius:
                    BorderRadius
                        .circular(
                  15,
                ),
                borderSide:
                    BorderSide(
                  color: Colors
                      .grey.shade200,
                ),
              ),
            ),
          ),
          const SizedBox(
            height: 14,
          ),
          SizedBox(
            height: 42,
            child: ListView(
              scrollDirection:
                  Axis.horizontal,
              children: [
                'ALL',
                'PENDING',
                'ASSIGNED',
                'ACCEPTED',
                'PICKED_UP',
                'IN_TRANSIT',
                'DELIVERED',
                'CANCELLED',
                'FAILED',
              ].map(
                (
                  String status,
                ) {
                  final bool selected =
                      selectedStatus ==
                          status;

                  return Padding(
                    padding:
                        const EdgeInsets
                            .only(
                      right: 8,
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
                          primaryColor,
                      backgroundColor:
                          Colors.white,
                      labelStyle:
                          TextStyle(
                        color: selected
                            ? Colors
                                .white
                            : Colors
                                .grey
                                .shade700,
                        fontWeight:
                            FontWeight
                                .w700,
                        fontSize:
                            12,
                      ),
                      side:
                          BorderSide(
                        color: selected
                            ? primaryColor
                            : Colors
                                .grey
                                .shade300,
                      ),
                      onSelected:
                          (_) {
                        setState(
                          () {
                            selectedStatus =
                                status;
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
            height: 18,
          ),
          Row(
            children: [
              const Expanded(
                child: Text(
                  'Recent Deliveries',
                  style:
                      TextStyle(
                    fontSize:
                        18,
                    fontWeight:
                        FontWeight
                            .w800,
                  ),
                ),
              ),
              Text(
                '${deliveries.length} records',
                style:
                    TextStyle(
                  color: Colors
                      .grey.shade600,
                  fontWeight:
                      FontWeight
                          .w600,
                ),
              ),
            ],
          ),
          const SizedBox(
            height: 12,
          ),
          if (deliveries.isEmpty)
            Container(
              padding:
                  const EdgeInsets
                      .symmetric(
                vertical: 50,
                horizontal: 20,
              ),
              decoration:
                  BoxDecoration(
                color: Colors.white,
                borderRadius:
                    BorderRadius
                        .circular(
                  18,
                ),
              ),
              child: Column(
                children: [
                  Icon(
                    Icons
                        .local_shipping_outlined,
                    size: 60,
                    color: Colors
                        .grey.shade400,
                  ),
                  const SizedBox(
                    height: 14,
                  ),
                  const Text(
                    'No deliveries found',
                    style:
                        TextStyle(
                      fontSize:
                          17,
                      fontWeight:
                          FontWeight
                              .w800,
                    ),
                  ),
                  const SizedBox(
                    height: 6,
                  ),
                  Text(
                    'New customer delivery requests will appear here.',
                    textAlign:
                        TextAlign.center,
                    style:
                        TextStyle(
                      color: Colors
                          .grey.shade600,
                    ),
                  ),
                ],
              ),
            )
          else
            ...deliveries.map(
              (
                Map<String, dynamic>
                    delivery,
              ) {
                final String status =
                    textFromDynamic(
                  delivery['status'],
                  fallback:
                      'PENDING',
                ).toUpperCase();

                final String
                    paymentStatus =
                    textFromDynamic(
                  delivery[
                      'paymentStatus'],
                  fallback:
                      'UNPAID',
                ).toUpperCase();

                final String
                    commissionStatus =
                    textFromDynamic(
                  delivery[
                      'riderCommissionStatus'],
                  fallback:
                      'PENDING',
                ).toUpperCase();

                final double
                    deliveryFee =
                    toDouble(
                  delivery[
                      'deliveryFee'],
                );

                final String
                    commissionType =
                    getCommissionType(
                  delivery,
                );

                final double
                    commissionValue =
                    getCommissionValue(
                  delivery,
                );

                final double
                    savedRiderCommission =
                    toDouble(
                  delivery[
                      'riderCommissionAmount'],
                );

                final double
                    riderCommission =
                    savedRiderCommission >
                            0
                        ? savedRiderCommission
                        : calculateRiderCommission(
                            deliveryFee:
                                deliveryFee,
                            commissionType:
                                commissionType,
                            commissionValue:
                                commissionValue,
                          );

                final double
                    savedProfit =
                    toDouble(
                  delivery[
                      'servicepayProfit'],
                );

                final double profit =
                    savedProfit > 0
                        ? savedProfit
                        : calculateServicePayProfit(
                            deliveryFee:
                                deliveryFee,
                            riderCommission:
                                riderCommission,
                          );

                final bool assigned =
                    hasAssignedRider(
                  delivery,
                );

                return Container(
                  margin:
                      const EdgeInsets
                          .only(
                    bottom: 12,
                  ),
                  decoration:
                      BoxDecoration(
                    color:
                        Colors.white,
                    borderRadius:
                        BorderRadius
                            .circular(
                      18,
                    ),
                    border:
                        Border.all(
                      color: Colors
                          .grey.shade200,
                    ),
                  ),
                  child: InkWell(
                    borderRadius:
                        BorderRadius
                            .circular(
                      18,
                    ),
                    onTap: () {
                      showDeliveryDetails(
                        delivery,
                      );
                    },
                    child: Padding(
                      padding:
                          const EdgeInsets
                              .all(
                        15,
                      ),
                      child: Row(
                        crossAxisAlignment:
                            CrossAxisAlignment
                                .start,
                        children: [
                          Container(
                            width: 48,
                            height: 48,
                            decoration:
                                BoxDecoration(
                              color:
                                  primaryColor
                                      .withValues(
                                alpha:
                                    0.10,
                              ),
                              borderRadius:
                                  BorderRadius
                                      .circular(
                                14,
                              ),
                            ),
                            child:
                                const Icon(
                              Icons
                                  .local_shipping_rounded,
                              color:
                                  primaryColor,
                            ),
                          ),
                          const SizedBox(
                            width: 12,
                          ),
                          Expanded(
                            child:
                                Column(
                              crossAxisAlignment:
                                  CrossAxisAlignment
                                      .start,
                              children: [
                                Row(
                                  children: [
                                    Expanded(
                                      child:
                                          Text(
                                        getTrackingNumber(
                                          delivery,
                                        ),
                                        style:
                                            const TextStyle(
                                          fontSize:
                                              15,
                                          fontWeight:
                                              FontWeight.w800,
                                        ),
                                      ),
                                    ),
                                    _StatusBadge(
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
                                  height: 7,
                                ),
                                Text(
                                  getCustomerName(
                                    delivery,
                                  ),
                                  style:
                                      const TextStyle(
                                    fontWeight:
                                        FontWeight.w700,
                                  ),
                                ),
                                const SizedBox(
                                  height: 6,
                                ),
                                Row(
                                  children: [
                                    Icon(
                                      Icons
                                          .location_on_outlined,
                                      size:
                                          16,
                                      color:
                                          Colors.grey.shade500,
                                    ),
                                    const SizedBox(
                                      width:
                                          5,
                                    ),
                                    Expanded(
                                      child:
                                          Text(
                                        textFromDynamic(
                                          delivery[
                                              'deliveryAddress'],
                                          fallback:
                                              'Not available',
                                        ),
                                        maxLines:
                                            1,
                                        overflow:
                                            TextOverflow.ellipsis,
                                        style:
                                            TextStyle(
                                          color:
                                              Colors.grey.shade600,
                                          fontSize:
                                              12,
                                        ),
                                      ),
                                    ),
                                  ],
                                ),
                                if (assigned) ...[
                                  const SizedBox(
                                    height:
                                        8,
                                  ),
                                  Container(
                                    padding:
                                        const EdgeInsets
                                            .symmetric(
                                      horizontal:
                                          10,
                                      vertical:
                                          7,
                                    ),
                                    decoration:
                                        BoxDecoration(
                                      color:
                                          Colors.indigo.withValues(
                                        alpha:
                                            0.08,
                                      ),
                                      borderRadius:
                                          BorderRadius.circular(
                                        10,
                                      ),
                                    ),
                                    child:
                                        Row(
                                      children: [
                                        const Icon(
                                          Icons
                                              .delivery_dining_rounded,
                                          size:
                                              17,
                                          color:
                                              Colors.indigo,
                                        ),
                                        const SizedBox(
                                          width:
                                              7,
                                        ),
                                        Expanded(
                                          child:
                                              Text(
                                            getAssignedRiderName(
                                              delivery,
                                            ),
                                            maxLines:
                                                1,
                                            overflow:
                                                TextOverflow.ellipsis,
                                            style:
                                                const TextStyle(
                                              color:
                                                  Colors.indigo,
                                              fontSize:
                                                  12,
                                              fontWeight:
                                                  FontWeight.w700,
                                            ),
                                          ),
                                        ),
                                        _StatusBadge(
                                          text:
                                              getAssignedRiderAvailability(
                                            delivery,
                                          ),
                                          color:
                                              getAvailabilityColor(
                                            getAssignedRiderAvailability(
                                              delivery,
                                            ),
                                          ),
                                        ),
                                      ],
                                    ),
                                  ),
                                ],
                                const SizedBox(
                                  height: 10,
                                ),
                                Wrap(
                                  spacing: 8,
                                  runSpacing:
                                      7,
                                  crossAxisAlignment:
                                      WrapCrossAlignment
                                          .center,
                                  children: [
                                    Text(
                                      formatMoney(
                                        deliveryFee,
                                      ),
                                      style:
                                          TextStyle(
                                        color: deliveryFee >
                                                0
                                            ? primaryColor
                                            : Colors
                                                .red.shade700,
                                        fontWeight:
                                            FontWeight.w800,
                                      ),
                                    ),
                                    _StatusBadge(
                                      text:
                                          formatStatus(
                                        paymentStatus,
                                      ),
                                      color:
                                          getPaymentStatusColor(
                                        paymentStatus,
                                      ),
                                    ),
                                    _StatusBadge(
                                      text:
                                          'Commission ${formatStatus(commissionStatus)}',
                                      color:
                                          getCommissionStatusColor(
                                        commissionStatus,
                                      ),
                                    ),
                                  ],
                                ),
                                const SizedBox(
                                  height: 10,
                                ),
                                Container(
                                  width:
                                      double.infinity,
                                  padding:
                                      const EdgeInsets
                                          .all(
                                    10,
                                  ),
                                  decoration:
                                      BoxDecoration(
                                    color:
                                        const Color(
                                      0xFFF8FAFC,
                                    ),
                                    borderRadius:
                                        BorderRadius
                                            .circular(
                                      11,
                                    ),
                                  ),
                                  child:
                                      Wrap(
                                    spacing:
                                        14,
                                    runSpacing:
                                        8,
                                    children: [
                                      _MiniInfo(
                                        icon:
                                            Icons.delivery_dining_outlined,
                                        text:
                                            'Rider ${formatMoney(riderCommission)}',
                                      ),
                                      _MiniInfo(
                                        icon:
                                            Icons.business_center_outlined,
                                        text:
                                            'Profit ${formatMoney(profit)}',
                                      ),
                                      _MiniInfo(
                                        icon: commissionType ==
                                                'PERCENTAGE'
                                            ? Icons.percent_rounded
                                            : Icons.payments_outlined,
                                        text: commissionType ==
                                                'PERCENTAGE'
                                            ? '${commissionValue.toStringAsFixed(2)}%'
                                            : 'Fixed ${formatMoney(commissionValue)}',
                                      ),
                                    ],
                                  ),
                                ),
                                const SizedBox(
                                  height: 8,
                                ),
                                Row(
                                  children: [
                                    TextButton.icon(
                                      onPressed:
                                          () {
                                        showAssignRiderDialog(
                                          delivery,
                                        );
                                      },
                                      style:
                                          TextButton.styleFrom(
                                        padding:
                                            EdgeInsets.zero,
                                        foregroundColor:
                                            Colors.indigo,
                                      ),
                                      icon:
                                          Icon(
                                        assigned
                                            ? Icons.swap_horiz_rounded
                                            : Icons.assignment_ind_rounded,
                                        size:
                                            17,
                                      ),
                                      label:
                                          Text(
                                        assigned
                                            ? 'Change Rider'
                                            : 'Assign Rider',
                                        style:
                                            const TextStyle(
                                          fontWeight:
                                              FontWeight.w800,
                                        ),
                                      ),
                                    ),
                                    const SizedBox(
                                      width:
                                          12,
                                    ),
                                    TextButton.icon(
                                      onPressed:
                                          () {
                                        showPriceDialog(
                                          delivery,
                                        );
                                      },
                                      style:
                                          TextButton.styleFrom(
                                        padding:
                                            EdgeInsets.zero,
                                        foregroundColor:
                                            const Color(
                                          0xFFB45309,
                                        ),
                                      ),
                                      icon:
                                          const Icon(
                                        Icons
                                            .price_change_rounded,
                                        size:
                                            17,
                                      ),
                                      label:
                                          Text(
                                        deliveryFee >
                                                0
                                            ? 'Price & Commission'
                                            : 'Set Price',
                                        style:
                                            const TextStyle(
                                          fontWeight:
                                              FontWeight.w800,
                                        ),
                                      ),
                                    ),
                                    const Spacer(),
                                    Text(
                                      formatDate(
                                        delivery[
                                            'createdAt'],
                                      ),
                                      style:
                                          TextStyle(
                                        color:
                                            Colors.grey.shade500,
                                        fontSize:
                                            11,
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
                  ),
                );
              },
            ),
          const SizedBox(
            height: 40,
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
        0xFFF7F9FC,
      ),
      appBar: AppBar(
        backgroundColor:
            primaryColor,
        foregroundColor:
            Colors.white,
        elevation: 0,
        title: const Text(
          'Delivery Management',
          style:
              TextStyle(
            fontWeight:
                FontWeight.w800,
          ),
        ),
        actions: [
          IconButton(
            tooltip:
                'Refresh',
            onPressed:
                isRefreshing
                    ? null
                    : () {
                        loadDeliveries(
                          showLoading:
                              false,
                        );
                      },
            icon: isRefreshing
                ? const SizedBox(
                    width: 20,
                    height: 20,
                    child:
                        CircularProgressIndicator(
                      strokeWidth:
                          2,
                      color:
                          Colors.white,
                    ),
                  )
                : const Icon(
                    Icons
                        .refresh_rounded,
                  ),
          ),
        ],
      ),
      body: isLoading
          ? buildLoadingState()
          : hasError
              ? buildErrorState()
              : buildDeliveryContent(),
    );
  }
}

class _StatusBadge
    extends StatelessWidget {
  const _StatusBadge({
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
        horizontal: 9,
        vertical: 5,
      ),
      decoration:
          BoxDecoration(
        color:
            color.withValues(
          alpha: 0.12,
        ),
        borderRadius:
            BorderRadius.circular(
          20,
        ),
      ),
      child: Text(
        text,
        style:
            TextStyle(
          color: color,
          fontSize: 10,
          fontWeight:
              FontWeight.w800,
        ),
      ),
    );
  }
}

class _CommissionSummaryChip
    extends StatelessWidget {
  const _CommissionSummaryChip({
    required this.label,
    required this.value,
    required this.color,
  });

  final String label;
  final int value;
  final Color color;

  @override
  Widget build(
    BuildContext context,
  ) {
    return Container(
      padding:
          const EdgeInsets.symmetric(
        horizontal: 12,
        vertical: 8,
      ),
      decoration:
          BoxDecoration(
        color:
            color.withValues(
          alpha: 0.10,
        ),
        borderRadius:
            BorderRadius.circular(
          20,
        ),
      ),
      child: Row(
        mainAxisSize:
            MainAxisSize.min,
        children: [
          Container(
            width: 8,
            height: 8,
            decoration:
                BoxDecoration(
              color: color,
              shape:
                  BoxShape.circle,
            ),
          ),
          const SizedBox(
            width: 7,
          ),
          Text(
            '$label: $value',
            style:
                TextStyle(
              color: color,
              fontSize: 12,
              fontWeight:
                  FontWeight.w800,
            ),
          ),
        ],
      ),
    );
  }
}

class _MiniInfo
    extends StatelessWidget {
  const _MiniInfo({
    required this.icon,
    required this.text,
  });

  final IconData icon;
  final String text;

  @override
  Widget build(
    BuildContext context,
  ) {
    return Container(
      padding:
          const EdgeInsets.symmetric(
        horizontal: 8,
        vertical: 5,
      ),
      decoration:
          BoxDecoration(
        color:
            const Color(
          0xFFF1F5F9,
        ),
        borderRadius:
            BorderRadius.circular(
          20,
        ),
      ),
      child: Row(
        mainAxisSize:
            MainAxisSize.min,
        children: [
          Icon(
            icon,
            size: 14,
            color:
                Colors.black54,
          ),
          const SizedBox(
            width: 5,
          ),
          Text(
            text,
            style:
                const TextStyle(
              fontSize: 11,
              color:
                  Colors.black54,
            ),
          ),
        ],
      ),
    );
  }
}

class _DetailSection
    extends StatelessWidget {
  const _DetailSection({
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
      width:
          double.infinity,
      padding:
          const EdgeInsets.all(
        16,
      ),
      decoration:
          BoxDecoration(
        color:
            const Color(
          0xFFF8FAFC,
        ),
        borderRadius:
            BorderRadius.circular(
          16,
        ),
      ),
      child: Column(
        crossAxisAlignment:
            CrossAxisAlignment.start,
        children: [
          Text(
            title,
            style:
                const TextStyle(
              fontSize: 15,
              fontWeight:
                  FontWeight.w800,
            ),
          ),
          const SizedBox(
            height: 12,
          ),
          ...children,
        ],
      ),
    );
  }
}

class _DetailRow
    extends StatelessWidget {
  const _DetailRow({
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
      padding:
          const EdgeInsets.only(
        bottom: 12,
      ),
      child: Row(
        crossAxisAlignment:
            CrossAxisAlignment.start,
        children: [
          Icon(
            icon,
            size: 19,
            color:
                const Color(
              0xFF0F766E,
            ),
          ),
          const SizedBox(
            width: 10,
          ),
          Expanded(
            child:
                Column(
              crossAxisAlignment:
                  CrossAxisAlignment.start,
              children: [
                Text(
                  label,
                  style:
                      TextStyle(
                    color: Colors
                        .grey.shade600,
                    fontSize:
                        11,
                    fontWeight:
                        FontWeight.w600,
                  ),
                ),
                const SizedBox(
                  height: 3,
                ),
                Text(
                  value,
                  style:
                      const TextStyle(
                    fontWeight:
                        FontWeight.w700,
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
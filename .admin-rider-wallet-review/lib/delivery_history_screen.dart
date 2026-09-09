import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

class DeliveryHistoryScreen extends StatefulWidget {
  const DeliveryHistoryScreen({super.key});

  @override
  State<DeliveryHistoryScreen> createState() =>
      _DeliveryHistoryScreenState();
}

class _DeliveryHistoryScreenState
    extends State<DeliveryHistoryScreen> {
  static const String baseUrl =
      'https://api.servicepay.ng/api';

  bool isLoading = true;
  String? errorMessage;

  List<Map<String, dynamic>> deliveries = [];

  @override
  void initState() {
    super.initState();
    loadDeliveries();
  }

  Future<void> loadDeliveries() async {
    if (mounted) {
      setState(() {
        isLoading = true;
        errorMessage = null;
      });
    }

    try {
      final preferences =
          await SharedPreferences.getInstance();

      final token =
          preferences.getString('auth_token') ?? '';

      if (token.isEmpty) {
        if (!mounted) {
          return;
        }

        setState(() {
          isLoading = false;
          errorMessage =
              'Your login session has expired. Please log in again.';
        });

        return;
      }

      final response = await http
          .get(
            Uri.parse('$baseUrl/delivery/my'),
            headers: {
              'Content-Type': 'application/json',
              'Authorization': 'Bearer $token',
            },
          )
          .timeout(
            const Duration(seconds: 30),
          );

      final decodedBody = jsonDecode(response.body);

      if (response.statusCode == 200 &&
          decodedBody is Map<String, dynamic>) {
        final result = decodedBody['deliveries'];

        final parsedDeliveries =
            result is List
                ? result
                    .whereType<Map>()
                    .map(
                      (item) =>
                          Map<String, dynamic>.from(item),
                    )
                    .toList()
                : <Map<String, dynamic>>[];

        if (!mounted) {
          return;
        }

        setState(() {
          deliveries = parsedDeliveries;
          isLoading = false;
        });
      } else {
        final message =
            decodedBody is Map<String, dynamic>
                ? decodedBody['message']?.toString()
                : null;

        if (!mounted) {
          return;
        }

        setState(() {
          isLoading = false;
          errorMessage =
              message ??
              'Unable to load delivery history.';
        });
      }
    } catch (_) {
      if (!mounted) {
        return;
      }

      setState(() {
        isLoading = false;
        errorMessage =
            'Unable to connect to the Servicepay server.';
      });
    }
  }

  Future<void> cancelDelivery(
    Map<String, dynamic> delivery,
  ) async {
    final id = delivery['_id']?.toString() ?? '';

    if (id.isEmpty) {
      return;
    }

    final shouldCancel = await showDialog<bool>(
      context: context,
      builder: (dialogContext) {
        return AlertDialog(
          icon: const Icon(
            Icons.warning_amber_rounded,
            color: Colors.orange,
            size: 48,
          ),
          title: const Text(
            'Cancel Delivery?',
          ),
          content: const Text(
            'Are you sure you want to cancel this delivery request?',
          ),
          actions: [
            TextButton(
              onPressed: () {
                Navigator.pop(dialogContext, false);
              },
              child: const Text('No'),
            ),
            FilledButton(
              onPressed: () {
                Navigator.pop(dialogContext, true);
              },
              style: FilledButton.styleFrom(
                backgroundColor: Colors.red,
              ),
              child: const Text('Yes, Cancel'),
            ),
          ],
        );
      },
    );

    if (shouldCancel != true) {
      return;
    }

    try {
      final preferences =
          await SharedPreferences.getInstance();

      final token =
          preferences.getString('auth_token') ?? '';

      if (token.isEmpty) {
        showMessage(
          'Your login session has expired. Please log in again.',
        );
        return;
      }

      final response = await http
          .put(
            Uri.parse(
              '$baseUrl/delivery/cancel/$id',
            ),
            headers: {
              'Content-Type': 'application/json',
              'Authorization': 'Bearer $token',
            },
          )
          .timeout(
            const Duration(seconds: 30),
          );

      final decodedBody = jsonDecode(response.body);

      if (response.statusCode == 200) {
        showMessage(
          decodedBody['message']?.toString() ??
              'Delivery cancelled successfully.',
          isError: false,
        );

        await loadDeliveries();
      } else {
        showMessage(
          decodedBody['message']?.toString() ??
              'Unable to cancel delivery.',
        );
      }
    } catch (_) {
      showMessage(
        'Unable to connect to the Servicepay server.',
      );
    }
  }

  void showMessage(
    String message, {
    bool isError = true,
  }) {
    if (!mounted) {
      return;
    }

    ScaffoldMessenger.of(context).hideCurrentSnackBar();

    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(message),
        backgroundColor:
            isError ? Colors.red : Colors.green,
      ),
    );
  }

  String formatStatus(String value) {
    return value
        .replaceAll('_', ' ')
        .split(' ')
        .map(
          (word) => word.isEmpty
              ? word
              : '${word[0]}${word.substring(1).toLowerCase()}',
        )
        .join(' ');
  }

  Color getStatusColor(String status) {
    switch (status) {
      case 'DELIVERED':
        return Colors.green;
      case 'IN_TRANSIT':
      case 'PICKED_UP':
        return Colors.blue;
      case 'ACCEPTED':
        return Colors.orange;
      case 'CANCELLED':
        return Colors.red;
      default:
        return Colors.grey;
    }
  }

  IconData getStatusIcon(String status) {
    switch (status) {
      case 'DELIVERED':
        return Icons.check_circle;
      case 'IN_TRANSIT':
        return Icons.local_shipping;
      case 'PICKED_UP':
        return Icons.inventory_2;
      case 'ACCEPTED':
        return Icons.assignment_turned_in;
      case 'CANCELLED':
        return Icons.cancel;
      default:
        return Icons.schedule;
    }
  }

  String formatDate(dynamic value) {
    if (value == null) {
      return '-';
    }

    final parsedDate =
        DateTime.tryParse(value.toString());

    if (parsedDate == null) {
      return '-';
    }

    final localDate = parsedDate.toLocal();

    final day =
        localDate.day.toString().padLeft(2, '0');
    final month =
        localDate.month.toString().padLeft(2, '0');
    final year = localDate.year;

    final hour =
        localDate.hour.toString().padLeft(2, '0');
    final minute =
        localDate.minute.toString().padLeft(2, '0');

    return '$day/$month/$year $hour:$minute';
  }

  double parseAmount(dynamic value) {
    if (value is num) {
      return value.toDouble();
    }

    return double.tryParse(
          value?.toString() ?? '',
        ) ??
        0;
  }

  Widget buildDeliveryCard(
    Map<String, dynamic> delivery,
  ) {
    final status =
        delivery['status']
                ?.toString()
                .toUpperCase() ??
            'PENDING';

    final paymentStatus =
        delivery['paymentStatus']
                ?.toString()
                .toUpperCase() ??
            'UNPAID';

    final fee =
        parseAmount(delivery['deliveryFee']);

    final canCancel = [
      'PENDING',
      'ACCEPTED',
    ].contains(status);

    final statusColor = getStatusColor(status);

    return Container(
      margin: const EdgeInsets.only(bottom: 14),
      padding: const EdgeInsets.all(17),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(
          color: const Color(0xFFE5E7EB),
        ),
        boxShadow: [
          BoxShadow(
            color:
                Colors.black.withValues(alpha: 0.03),
            blurRadius: 12,
            offset: const Offset(0, 5),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment:
            CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              CircleAvatar(
                radius: 24,
                backgroundColor:
                    statusColor.withValues(alpha: 0.12),
                child: Icon(
                  getStatusIcon(status),
                  color: statusColor,
                ),
              ),
              const SizedBox(width: 13),
              Expanded(
                child: Column(
                  crossAxisAlignment:
                      CrossAxisAlignment.start,
                  children: [
                    Text(
                      delivery['packageName']
                              ?.toString() ??
                          'Package',
                      style: const TextStyle(
                        fontSize: 16,
                        fontWeight: FontWeight.w800,
                        color: Color(0xFF111827),
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      delivery['trackingNumber']
                              ?.toString() ??
                          '-',
                      style: const TextStyle(
                        fontSize: 12,
                        color: Color(0xFF6B7280),
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ],
                ),
              ),
              Container(
                padding: const EdgeInsets.symmetric(
                  horizontal: 10,
                  vertical: 6,
                ),
                decoration: BoxDecoration(
                  color:
                      statusColor.withValues(alpha: 0.12),
                  borderRadius:
                      BorderRadius.circular(20),
                ),
                child: Text(
                  formatStatus(status),
                  style: TextStyle(
                    color: statusColor,
                    fontSize: 11,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 17),
          const Divider(height: 1),
          const SizedBox(height: 16),
          buildSmallRow(
            icon: Icons.location_on_outlined,
            label: 'Pickup',
            value:
                delivery['pickupAddress']
                        ?.toString() ??
                    '-',
          ),
          buildSmallRow(
            icon: Icons.flag_outlined,
            label: 'Destination',
            value:
                delivery['deliveryAddress']
                        ?.toString() ??
                    '-',
          ),
          buildSmallRow(
            icon: Icons.person_outline,
            label: 'Receiver',
            value:
                delivery['receiverName']
                        ?.toString() ??
                    '-',
          ),
          buildSmallRow(
            icon: Icons.payments_outlined,
            label: 'Delivery Fee',
            value: fee > 0
                ? '₦${fee.toStringAsFixed(2)}'
                : 'Not yet provided',
          ),
          buildSmallRow(
            icon:
                Icons.account_balance_wallet_outlined,
            label: 'Payment',
            value: formatStatus(paymentStatus),
          ),
          buildSmallRow(
            icon: Icons.calendar_today_outlined,
            label: 'Created',
            value: formatDate(
              delivery['createdAt'],
            ),
          ),
          if (canCancel) ...[
            const SizedBox(height: 8),
            SizedBox(
              width: double.infinity,
              child: OutlinedButton.icon(
                onPressed: () {
                  cancelDelivery(delivery);
                },
                icon: const Icon(
                  Icons.cancel_outlined,
                ),
                label: const Text(
                  'Cancel Delivery',
                ),
                style: OutlinedButton.styleFrom(
                  foregroundColor: Colors.red,
                  side: const BorderSide(
                    color: Colors.red,
                  ),
                  shape: RoundedRectangleBorder(
                    borderRadius:
                        BorderRadius.circular(12),
                  ),
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }

  Widget buildSmallRow({
    required IconData icon,
    required String label,
    required String value,
  }) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 11),
      child: Row(
        crossAxisAlignment:
            CrossAxisAlignment.start,
        children: [
          Icon(
            icon,
            size: 19,
            color: const Color(0xFF1565C0),
          ),
          const SizedBox(width: 10),
          SizedBox(
            width: 88,
            child: Text(
              label,
              style: const TextStyle(
                fontSize: 12,
                color: Color(0xFF6B7280),
              ),
            ),
          ),
          Expanded(
            child: Text(
              value,
              style: const TextStyle(
                fontSize: 13,
                color: Color(0xFF111827),
                fontWeight: FontWeight.w600,
                height: 1.35,
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget buildEmptyState() {
    return Center(
      child: Padding(
        padding: const EdgeInsets.symmetric(
          horizontal: 24,
          vertical: 70,
        ),
        child: Column(
          children: [
            Container(
              width: 92,
              height: 92,
              decoration: const BoxDecoration(
                color: Color(0xFFEAF3FF),
                shape: BoxShape.circle,
              ),
              child: const Icon(
                Icons.local_shipping_outlined,
                size: 46,
                color: Color(0xFF1565C0),
              ),
            ),
            const SizedBox(height: 20),
            const Text(
              'No Deliveries Yet',
              style: TextStyle(
                fontSize: 19,
                fontWeight: FontWeight.w800,
                color: Color(0xFF111827),
              ),
            ),
            const SizedBox(height: 8),
            const Text(
              'Your delivery requests will appear here after you create one.',
              textAlign: TextAlign.center,
              style: TextStyle(
                color: Color(0xFF6B7280),
                height: 1.5,
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget buildErrorState() {
    return Center(
      child: Padding(
        padding: const EdgeInsets.symmetric(
          horizontal: 24,
          vertical: 70,
        ),
        child: Column(
          children: [
            const Icon(
              Icons.error_outline,
              color: Colors.red,
              size: 58,
            ),
            const SizedBox(height: 15),
            Text(
              errorMessage ??
                  'Unable to load delivery history.',
              textAlign: TextAlign.center,
              style: const TextStyle(
                color: Color(0xFF6B7280),
                height: 1.5,
              ),
            ),
            const SizedBox(height: 18),
            FilledButton.icon(
              onPressed: loadDeliveries,
              icon: const Icon(Icons.refresh),
              label: const Text('Try Again'),
            ),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor:
          const Color(0xFFF5F7FB),
      appBar: AppBar(
        title: const Text(
          'Delivery History',
          style: TextStyle(
            fontWeight: FontWeight.w700,
          ),
        ),
        centerTitle: true,
        backgroundColor: Colors.white,
        foregroundColor:
            const Color(0xFF111827),
        elevation: 0,
      ),
      body: SafeArea(
        child: RefreshIndicator(
          onRefresh: loadDeliveries,
          child: isLoading
              ? const Center(
                  child: CircularProgressIndicator(),
                )
              : errorMessage != null
                  ? ListView(
                      physics:
                          const AlwaysScrollableScrollPhysics(),
                      children: [
                        buildErrorState(),
                      ],
                    )
                  : deliveries.isEmpty
                      ? ListView(
                          physics:
                              const AlwaysScrollableScrollPhysics(),
                          children: [
                            buildEmptyState(),
                          ],
                        )
                      : ListView.builder(
                          physics:
                              const AlwaysScrollableScrollPhysics(),
                          padding:
                              const EdgeInsets.all(18),
                          itemCount:
                              deliveries.length,
                          itemBuilder:
                              (context, index) {
                            return buildDeliveryCard(
                              deliveries[index],
                            );
                          },
                        ),
        ),
      ),
    );
  }
}
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;

class TrackDeliveryScreen extends StatefulWidget {
  const TrackDeliveryScreen({super.key});

  @override
  State<TrackDeliveryScreen> createState() =>
      _TrackDeliveryScreenState();
}

class _TrackDeliveryScreenState
    extends State<TrackDeliveryScreen> {
  static const String baseUrl =
      'https://api.servicepay.ng/api';

  final trackingController = TextEditingController();

  bool isLoading = false;
  Map<String, dynamic>? delivery;

  @override
  void dispose() {
    trackingController.dispose();
    super.dispose();
  }

  void showMessage(String message) {
    if (!mounted) {
      return;
    }

    ScaffoldMessenger.of(context).hideCurrentSnackBar();

    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(message),
        backgroundColor: Colors.red,
      ),
    );
  }

  Future<void> trackDelivery() async {
    FocusScope.of(context).unfocus();

    final trackingNumber =
        trackingController.text.trim().toUpperCase();

    if (trackingNumber.isEmpty) {
      showMessage('Please enter a tracking number.');
      return;
    }

    setState(() {
      isLoading = true;
      delivery = null;
    });

    try {
      final encodedTrackingNumber =
          Uri.encodeComponent(trackingNumber);

      final response = await http
          .get(
            Uri.parse(
              '$baseUrl/delivery/track/$encodedTrackingNumber',
            ),
            headers: {
              'Content-Type': 'application/json',
            },
          )
          .timeout(
            const Duration(seconds: 30),
          );

      final decodedBody = jsonDecode(response.body);

      if (response.statusCode == 200 &&
          decodedBody is Map<String, dynamic>) {
        final result = decodedBody['delivery'];

        if (result is Map<String, dynamic>) {
          if (!mounted) {
            return;
          }

          setState(() {
            delivery = result;
          });
        } else {
          showMessage(
            'Unable to load delivery information.',
          );
        }
      } else {
        final message =
            decodedBody is Map<String, dynamic>
                ? decodedBody['message']?.toString()
                : null;

        showMessage(
          message ?? 'Invalid tracking number.',
        );
      }
    } catch (_) {
      showMessage(
        'Unable to connect to the Servicepay server.',
      );
    } finally {
      if (mounted) {
        setState(() {
          isLoading = false;
        });
      }
    }
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
        return Icons.inventory;
      case 'ACCEPTED':
        return Icons.assignment_turned_in;
      case 'CANCELLED':
        return Icons.cancel;
      default:
        return Icons.schedule;
    }
  }

  Widget buildInformationRow({
    required IconData icon,
    required String title,
    required String value,
  }) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 15),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 42,
            height: 42,
            decoration: BoxDecoration(
              color: const Color(0xFFEAF3FF),
              borderRadius: BorderRadius.circular(12),
            ),
            child: Icon(
              icon,
              color: const Color(0xFF1565C0),
              size: 21,
            ),
          ),
          const SizedBox(width: 13),
          Expanded(
            child: Column(
              crossAxisAlignment:
                  CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: const TextStyle(
                    color: Color(0xFF6B7280),
                    fontSize: 12,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  value.isEmpty ? '-' : value,
                  style: const TextStyle(
                    color: Color(0xFF111827),
                    fontSize: 14,
                    fontWeight: FontWeight.w600,
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

  Widget buildDeliveryResult() {
    final result = delivery;

    if (result == null) {
      return const SizedBox.shrink();
    }

    final status =
        result['status']?.toString().toUpperCase() ??
            'PENDING';

    final paymentStatus =
        result['paymentStatus']
                ?.toString()
                .toUpperCase() ??
            'UNPAID';

    final deliveryFeeValue = result['deliveryFee'];

    final deliveryFee =
        deliveryFeeValue is num
            ? deliveryFeeValue.toDouble()
            : double.tryParse(
                  deliveryFeeValue?.toString() ?? '',
                ) ??
                0;

    final statusColor = getStatusColor(status);

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(
          color: const Color(0xFFE5E7EB),
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              CircleAvatar(
                radius: 26,
                backgroundColor:
                    statusColor.withValues(alpha: 0.12),
                child: Icon(
                  getStatusIcon(status),
                  color: statusColor,
                  size: 29,
                ),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment:
                      CrossAxisAlignment.start,
                  children: [
                    const Text(
                      'Delivery Status',
                      style: TextStyle(
                        fontSize: 12,
                        color: Color(0xFF6B7280),
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      formatStatus(status),
                      style: TextStyle(
                        fontSize: 18,
                        fontWeight: FontWeight.w800,
                        color: statusColor,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 22),
          const Divider(),
          const SizedBox(height: 18),
          buildInformationRow(
            icon: Icons.qr_code_2,
            title: 'Tracking Number',
            value:
                result['trackingNumber']?.toString() ??
                    '',
          ),
          buildInformationRow(
            icon: Icons.inventory_2_outlined,
            title: 'Package',
            value:
                result['packageName']?.toString() ?? '',
          ),
          buildInformationRow(
            icon: Icons.location_on_outlined,
            title: 'Pickup Address',
            value:
                result['pickupAddress']?.toString() ??
                    '',
          ),
          buildInformationRow(
            icon: Icons.flag_outlined,
            title: 'Delivery Address',
            value:
                result['deliveryAddress']?.toString() ??
                    '',
          ),
          buildInformationRow(
            icon: Icons.payments_outlined,
            title: 'Delivery Fee',
            value: deliveryFee > 0
                ? '₦${deliveryFee.toStringAsFixed(2)}'
                : 'Not yet provided',
          ),
          buildInformationRow(
            icon: Icons.account_balance_wallet_outlined,
            title: 'Payment Status',
            value: formatStatus(paymentStatus),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF5F7FB),
      appBar: AppBar(
        title: const Text(
          'Track Delivery',
          style: TextStyle(
            fontWeight: FontWeight.w700,
          ),
        ),
        centerTitle: true,
        backgroundColor: Colors.white,
        foregroundColor: const Color(0xFF111827),
        elevation: 0,
      ),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(18),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(20),
                decoration: BoxDecoration(
                  gradient: const LinearGradient(
                    colors: [
                      Color(0xFF1565C0),
                      Color(0xFF0D47A1),
                    ],
                  ),
                  borderRadius: BorderRadius.circular(20),
                ),
                child: const Column(
                  children: [
                    Icon(
                      Icons.location_searching,
                      color: Colors.white,
                      size: 42,
                    ),
                    SizedBox(height: 12),
                    Text(
                      'Track Your Package',
                      style: TextStyle(
                        color: Colors.white,
                        fontSize: 19,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                    SizedBox(height: 6),
                    Text(
                      'Enter the tracking number given after creating your delivery request.',
                      textAlign: TextAlign.center,
                      style: TextStyle(
                        color: Colors.white70,
                        height: 1.4,
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 22),
              TextField(
                controller: trackingController,
                textCapitalization:
                    TextCapitalization.characters,
                onSubmitted: (_) => trackDelivery(),
                decoration: InputDecoration(
                  labelText: 'Tracking Number',
                  hintText: 'Example: SP-123456789-ABCD1234',
                  prefixIcon:
                      const Icon(Icons.qr_code_scanner),
                  filled: true,
                  fillColor: Colors.white,
                  border: OutlineInputBorder(
                    borderRadius:
                        BorderRadius.circular(14),
                  ),
                  enabledBorder: OutlineInputBorder(
                    borderRadius:
                        BorderRadius.circular(14),
                    borderSide: const BorderSide(
                      color: Color(0xFFE5E7EB),
                    ),
                  ),
                  focusedBorder: OutlineInputBorder(
                    borderRadius:
                        BorderRadius.circular(14),
                    borderSide: const BorderSide(
                      color: Color(0xFF1565C0),
                      width: 1.5,
                    ),
                  ),
                ),
              ),
              const SizedBox(height: 14),
              SizedBox(
                width: double.infinity,
                height: 52,
                child: FilledButton.icon(
                  onPressed:
                      isLoading ? null : trackDelivery,
                  icon: isLoading
                      ? const SizedBox(
                          width: 21,
                          height: 21,
                          child:
                              CircularProgressIndicator(
                            strokeWidth: 2.4,
                            color: Colors.white,
                          ),
                        )
                      : const Icon(
                          Icons.search_rounded,
                        ),
                  label: Text(
                    isLoading
                        ? 'Tracking...'
                        : 'Track Delivery',
                    style: const TextStyle(
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  style: FilledButton.styleFrom(
                    backgroundColor:
                        const Color(0xFF1565C0),
                    shape: RoundedRectangleBorder(
                      borderRadius:
                          BorderRadius.circular(14),
                    ),
                  ),
                ),
              ),
              const SizedBox(height: 24),
              buildDeliveryResult(),
            ],
          ),
        ),
      ),
    );
  }
}
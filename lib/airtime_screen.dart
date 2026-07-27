import 'package:flutter/material.dart';

import 'services/api_service.dart';

class AirtimeScreen extends StatefulWidget {
  const AirtimeScreen({super.key});

  @override
  State<AirtimeScreen> createState() => _AirtimeScreenState();
}

class _AirtimeScreenState extends State<AirtimeScreen> {
  final TextEditingController phoneController =
      TextEditingController();

  final TextEditingController amountController =
      TextEditingController();

  final List<String> networks = [
    'MTN',
    'Airtel',
    'Glo',
    '9mobile',
  ];

  String selectedNetwork = 'MTN';
  bool isLoading = false;

  @override
  void dispose() {
    phoneController.dispose();
    amountController.dispose();
    super.dispose();
  }

  void showMessage(String message) {
    if (!mounted) return;

    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(
        SnackBar(
          content: Text(message),
          behavior: SnackBarBehavior.floating,
        ),
      );
  }

  Future<void> buyAirtime() async {
    final String phone =
        phoneController.text.trim();

    final String amountText =
        amountController.text.trim();

    final double? amount =
        double.tryParse(amountText);

    if (phone.isEmpty || amountText.isEmpty) {
      showMessage(
        'Please enter the phone number and amount.',
      );
      return;
    }

    if (!RegExp(r'^[0-9]{11}$').hasMatch(phone) ||
        !phone.startsWith('0')) {
      showMessage(
        'Please enter a valid 11-digit phone number.',
      );
      return;
    }

    if (amount == null || amount < 50) {
      showMessage(
        'The minimum airtime amount is ₦50.',
      );
      return;
    }

    final bool? confirmed =
        await showDialog<bool>(
      context: context,
      builder: (BuildContext dialogContext) {
        return AlertDialog(
          title: const Text(
            'Confirm airtime purchase',
          ),
          content: Text(
            'Purchase ₦${amount.toStringAsFixed(0)} '
            '$selectedNetwork airtime for $phone?',
          ),
          actions: [
            TextButton(
              onPressed: () {
                Navigator.pop(
                  dialogContext,
                  false,
                );
              },
              child: const Text('Cancel'),
            ),
            ElevatedButton(
              onPressed: () {
                Navigator.pop(
                  dialogContext,
                  true,
                );
              },
              style: ElevatedButton.styleFrom(
                backgroundColor: Colors.green,
                foregroundColor: Colors.white,
              ),
              child: const Text('Confirm'),
            ),
          ],
        );
      },
    );

    if (confirmed != true) return;

    setState(() {
      isLoading = true;
    });

    try {
      final Map<String, dynamic> result =
          await ApiService.buyAirtime(
        network: selectedNetwork,
        phone: phone,
        amount: amountText,
      );

      if (!mounted) return;

      final bool success =
          result['success'] == true;

      final String message =
          result['message']?.toString() ??
              result['response_description']
                  ?.toString() ??
              result['description']?.toString() ??
              result['error']?.toString() ??
              (success
                  ? 'Airtime purchase was successful.'
                  : 'Airtime purchase failed.');

      if (success) {
        showMessage(message);

        phoneController.clear();
        amountController.clear();
      } else {
        final String? reference =
            result['reference']?.toString();

        final String? status =
            result['status']?.toString();

        String finalMessage = message;

        if (status == 'REFUNDED') {
          finalMessage =
              '$message Your wallet has been refunded.';
        }

        if (reference != null &&
            reference.isNotEmpty) {
          finalMessage =
              '$finalMessage Reference: $reference';
        }

        showMessage(finalMessage);
      }
    } catch (error) {
      final String message = error
          .toString()
          .replaceFirst('Exception: ', '');

      showMessage(message);
    } finally {
      if (mounted) {
        setState(() {
          isLoading = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor:
          const Color(0xFFF5F7FA),
      appBar: AppBar(
        backgroundColor: Colors.green,
        foregroundColor: Colors.white,
        title: const Text(
          'Buy Airtime',
          style: TextStyle(
            fontWeight: FontWeight.bold,
          ),
        ),
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(20),
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(
              maxWidth: 600,
            ),
            child: Column(
              crossAxisAlignment:
                  CrossAxisAlignment.start,
              children: [
                const Text(
                  'Select Network',
                  style: TextStyle(
                    fontSize: 16,
                    fontWeight: FontWeight.bold,
                  ),
                ),
                const SizedBox(height: 10),
                DropdownButtonFormField<String>(
                  initialValue: selectedNetwork,
                  decoration: InputDecoration(
                    prefixIcon: const Icon(
                      Icons.sim_card_outlined,
                    ),
                    filled: true,
                    fillColor: Colors.white,
                    border: OutlineInputBorder(
                      borderRadius:
                          BorderRadius.circular(12),
                    ),
                  ),
                  items: networks
                      .map(
                        (String network) =>
                            DropdownMenuItem<String>(
                          value: network,
                          child: Text(network),
                        ),
                      )
                      .toList(),
                  onChanged: isLoading
                      ? null
                      : (String? value) {
                          if (value == null) return;

                          setState(() {
                            selectedNetwork = value;
                          });
                        },
                ),
                const SizedBox(height: 22),
                const Text(
                  'Phone Number',
                  style: TextStyle(
                    fontSize: 16,
                    fontWeight: FontWeight.bold,
                  ),
                ),
                const SizedBox(height: 10),
                TextField(
                  controller: phoneController,
                  enabled: !isLoading,
                  keyboardType:
                      TextInputType.phone,
                  maxLength: 11,
                  decoration: InputDecoration(
                    hintText: '08012345678',
                    counterText: '',
                    prefixIcon: const Icon(
                      Icons.phone_outlined,
                    ),
                    filled: true,
                    fillColor: Colors.white,
                    border: OutlineInputBorder(
                      borderRadius:
                          BorderRadius.circular(12),
                    ),
                  ),
                ),
                const SizedBox(height: 22),
                const Text(
                  'Amount',
                  style: TextStyle(
                    fontSize: 16,
                    fontWeight: FontWeight.bold,
                  ),
                ),
                const SizedBox(height: 10),
                TextField(
                  controller: amountController,
                  enabled: !isLoading,
                  keyboardType:
                      const TextInputType
                          .numberWithOptions(
                    decimal: true,
                  ),
                  decoration: InputDecoration(
                    hintText: 'Enter amount',
                    prefixText: '₦ ',
                    prefixIcon: const Icon(
                      Icons.payments_outlined,
                    ),
                    filled: true,
                    fillColor: Colors.white,
                    border: OutlineInputBorder(
                      borderRadius:
                          BorderRadius.circular(12),
                    ),
                  ),
                ),
                const SizedBox(height: 28),
                SizedBox(
                  width: double.infinity,
                  height: 52,
                  child: ElevatedButton(
                    onPressed:
                        isLoading ? null : buyAirtime,
                    style:
                        ElevatedButton.styleFrom(
                      backgroundColor:
                          Colors.green,
                      foregroundColor:
                          Colors.white,
                      shape: RoundedRectangleBorder(
                        borderRadius:
                            BorderRadius.circular(12),
                      ),
                    ),
                    child: isLoading
                        ? const SizedBox(
                            width: 24,
                            height: 24,
                            child:
                                CircularProgressIndicator(
                              strokeWidth: 2.5,
                              color: Colors.white,
                            ),
                          )
                        : const Text(
                            'Buy Airtime',
                            style: TextStyle(
                              fontSize: 17,
                              fontWeight:
                                  FontWeight.bold,
                            ),
                          ),
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
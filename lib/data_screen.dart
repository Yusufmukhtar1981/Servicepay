import 'package:flutter/material.dart';

import 'services/api_service.dart';

class DataScreen extends StatefulWidget {
  const DataScreen({super.key});

  @override
  State<DataScreen> createState() => _DataScreenState();
}

class _DataScreenState extends State<DataScreen> {
  final TextEditingController phoneController =
      TextEditingController();

  bool isLoading = false;

  String selectedNetwork = 'MTN';
  String selectedPlanCode = 'MTN_1GB';

  /*
   * MUHIMMI:
   * Dole a maye gurbin "code" da ainihin DataPlan codes
   * daga ClubKonnect Developer API dashboard.
   *
   * Kada a canza "price" sai an tabbatar da farashin provider.
   */
  final Map<String, List<Map<String, dynamic>>> dataPlans = {
    'MTN': [
      {
        'code': 'MTN_500MB',
        'name': '500MB',
        'price': 250.0,
      },
      {
        'code': 'MTN_1GB',
        'name': '1GB',
        'price': 500.0,
      },
      {
        'code': 'MTN_2GB',
        'name': '2GB',
        'price': 1000.0,
      },
      {
        'code': 'MTN_5GB',
        'name': '5GB',
        'price': 2500.0,
      },
    ],
    'Airtel': [
      {
        'code': 'AIRTEL_500MB',
        'name': '500MB',
        'price': 300.0,
      },
      {
        'code': 'AIRTEL_1GB',
        'name': '1GB',
        'price': 600.0,
      },
      {
        'code': 'AIRTEL_2GB',
        'name': '2GB',
        'price': 1200.0,
      },
      {
        'code': 'AIRTEL_5GB',
        'name': '5GB',
        'price': 2800.0,
      },
    ],
    'Glo': [
      {
        'code': 'GLO_1GB',
        'name': '1GB',
        'price': 450.0,
      },
      {
        'code': 'GLO_2GB',
        'name': '2GB',
        'price': 900.0,
      },
      {
        'code': 'GLO_5GB',
        'name': '5GB',
        'price': 2200.0,
      },
    ],
    '9mobile': [
      {
        'code': '9MOBILE_500MB',
        'name': '500MB',
        'price': 300.0,
      },
      {
        'code': '9MOBILE_1GB',
        'name': '1GB',
        'price': 600.0,
      },
      {
        'code': '9MOBILE_2GB',
        'name': '2GB',
        'price': 1150.0,
      },
    ],
  };

  @override
  void dispose() {
    phoneController.dispose();
    super.dispose();
  }

  List<Map<String, dynamic>> get currentPlans {
    return dataPlans[selectedNetwork] ?? [];
  }

  Map<String, dynamic> get selectedPlan {
    final List<Map<String, dynamic>> plans =
        currentPlans;

    if (plans.isEmpty) {
      return <String, dynamic>{
        'code': '',
        'name': 'No plan',
        'price': 0.0,
      };
    }

    return plans.firstWhere(
      (Map<String, dynamic> plan) {
        return plan['code']?.toString() ==
            selectedPlanCode;
      },
      orElse: () => plans.first,
    );
  }

  String formatAmount(dynamic amount) {
    final double value =
        double.tryParse(amount.toString()) ?? 0;

    return value.toStringAsFixed(0);
  }

  bool isValidPhone(String phone) {
    return RegExp(r'^0\d{10}$').hasMatch(phone);
  }

  void showMessage(
    String message, {
    bool isError = false,
  }) {
    if (!mounted) return;

    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(
        SnackBar(
          content: Text(message),
          behavior: SnackBarBehavior.floating,
          backgroundColor:
              isError ? Colors.red : Colors.green,
        ),
      );
  }

  Future<bool> confirmPurchase({
    required String phone,
    required String planName,
    required double price,
  }) async {
    final bool? confirmed =
        await showDialog<bool>(
      context: context,
      builder: (BuildContext dialogContext) {
        return AlertDialog(
          title: const Text(
            'Confirm data purchase',
          ),
          content: Text(
            'Purchase $planName $selectedNetwork data '
            'for ₦${price.toStringAsFixed(0)} '
            'on $phone?',
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

    return confirmed == true;
  }

  Future<void> buyData() async {
    if (isLoading) return;

    final String phone =
        phoneController.text.trim();

    final Map<String, dynamic> plan =
        selectedPlan;

    final String planCode =
        plan['code']?.toString().trim() ?? '';

    final String planName =
        plan['name']?.toString() ?? 'Data plan';

    final double price =
        double.tryParse(
          plan['price']?.toString() ?? '',
        ) ??
        0;

    if (!isValidPhone(phone)) {
      showMessage(
        'Please enter a valid 11-digit phone number.',
        isError: true,
      );
      return;
    }

    if (planCode.isEmpty || price <= 0) {
      showMessage(
        'Please select a valid data plan.',
        isError: true,
      );
      return;
    }

    final bool confirmed =
        await confirmPurchase(
      phone: phone,
      planName: planName,
      price: price,
    );

    if (!confirmed) return;

    setState(() {
      isLoading = true;
    });

    try {
      final Map<String, dynamic> result =
          await ApiService.buyData(
        network: selectedNetwork,
        phone: phone,
        planCode: planCode,
        amount: price,
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
                  ? 'Data purchase was successful.'
                  : 'Data purchase failed.');

      final String reference =
          result['reference']?.toString() ?? '';

      final String status =
          result['status']
                  ?.toString()
                  .toUpperCase() ??
              '';

      if (success) {
        String finalMessage = message;

        if (reference.isNotEmpty) {
          finalMessage =
              '$finalMessage Reference: $reference';
        }

        showMessage(finalMessage);

        phoneController.clear();
      } else {
        String finalMessage = message;

        if (status == 'REFUNDED') {
          finalMessage =
              '$finalMessage Your wallet has been refunded.';
        }

        if (reference.isNotEmpty) {
          finalMessage =
              '$finalMessage Reference: $reference';
        }

        showMessage(
          finalMessage,
          isError: true,
        );
      }
    } catch (error) {
      final String message = error
          .toString()
          .replaceFirst('Exception: ', '');

      showMessage(
        message,
        isError: true,
      );
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
    final List<Map<String, dynamic>> plans =
        currentPlans;

    return Scaffold(
      backgroundColor:
          const Color(0xFFF5F7FA),
      appBar: AppBar(
        backgroundColor: Colors.green,
        foregroundColor: Colors.white,
        title: const Text(
          'Buy Data',
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
                  CrossAxisAlignment.stretch,
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
                  items: dataPlans.keys.map(
                    (String network) {
                      return DropdownMenuItem<String>(
                        value: network,
                        child: Text(network),
                      );
                    },
                  ).toList(),
                  onChanged: isLoading
                      ? null
                      : (String? value) {
                          if (value == null) return;

                          final plansForNetwork =
                              dataPlans[value] ?? [];

                          setState(() {
                            selectedNetwork = value;

                            selectedPlanCode =
                                plansForNetwork.isEmpty
                                    ? ''
                                    : plansForNetwork
                                        .first['code']
                                        .toString();
                          });
                        },
                ),
                const SizedBox(height: 22),
                const Text(
                  'Select Data Plan',
                  style: TextStyle(
                    fontSize: 16,
                    fontWeight: FontWeight.bold,
                  ),
                ),
                const SizedBox(height: 10),
                DropdownButtonFormField<String>(
                  key: ValueKey<String>(
                    '$selectedNetwork-$selectedPlanCode',
                  ),
                  initialValue:
                      selectedPlanCode.isEmpty
                          ? null
                          : selectedPlanCode,
                  decoration: InputDecoration(
                    prefixIcon: const Icon(
                      Icons.data_usage_outlined,
                    ),
                    filled: true,
                    fillColor: Colors.white,
                    border: OutlineInputBorder(
                      borderRadius:
                          BorderRadius.circular(12),
                    ),
                  ),
                  items: plans.map(
                    (Map<String, dynamic> plan) {
                      return DropdownMenuItem<String>(
                        value:
                            plan['code'].toString(),
                        child: Text(
                          '${plan['name']} - '
                          '₦${formatAmount(plan['price'])}',
                        ),
                      );
                    },
                  ).toList(),
                  onChanged: isLoading
                      ? null
                      : (String? value) {
                          if (value == null) return;

                          setState(() {
                            selectedPlanCode = value;
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
                  maxLength: 11,
                  keyboardType:
                      TextInputType.phone,
                  decoration: InputDecoration(
                    hintText: '08012345678',
                    prefixIcon: const Icon(
                      Icons.phone_outlined,
                    ),
                    counterText: '',
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
                  height: 52,
                  child: ElevatedButton(
                    onPressed:
                        isLoading ? null : buyData,
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
                        : Text(
                            'Buy ${selectedPlan['name']} - '
                            '₦${formatAmount(selectedPlan['price'])}',
                            style: const TextStyle(
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
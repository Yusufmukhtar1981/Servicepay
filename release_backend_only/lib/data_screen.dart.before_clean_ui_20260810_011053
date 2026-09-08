import 'package:flutter/material.dart';

import 'services/api_service.dart';

class DataScreen extends StatefulWidget {
  const DataScreen({super.key});

  @override
  State<DataScreen> createState() => _DataScreenState();
}

class _DataScreenState extends State<DataScreen> {
  final TextEditingController phoneController = TextEditingController();

  final List<String> networks = const [
    'MTN',
    'Glo',
    '9mobile',
    'Airtel',
  ];

  String selectedNetwork = 'MTN';
  String selectedPlanCode = '';

  List<Map<String, dynamic>> dataPlans = [];

  bool isLoadingPlans = true;
  bool isBuyingData = false;

  String plansError = '';

  @override
  void initState() {
    super.initState();
    loadDataPlans();
  }

  @override
  void dispose() {
    phoneController.dispose();
    super.dispose();
  }

  bool get isBusy {
    return isLoadingPlans || isBuyingData;
  }

  Map<String, dynamic>? get selectedPlan {
    if (dataPlans.isEmpty || selectedPlanCode.isEmpty) {
      return null;
    }

    for (final Map<String, dynamic> plan in dataPlans) {
      final String code =
          plan['code']?.toString() ?? plan['id']?.toString() ?? '';

      if (code == selectedPlanCode) {
        return plan;
      }
    }

    return dataPlans.first;
  }

  double parseAmount(dynamic amount) {
    final String value =
        amount.toString().replaceAll('₦', '').replaceAll(',', '').trim();

    return double.tryParse(value) ?? 0;
  }

  String formatAmount(dynamic amount) {
    final double value = parseAmount(amount);

    if (value == value.roundToDouble()) {
      return value.toStringAsFixed(0);
    }

    return value.toStringAsFixed(2);
  }

  String getPlanCode(Map<String, dynamic> plan) {
    return plan['code']?.toString().trim() ??
        plan['id']?.toString().trim() ??
        '';
  }

  String getPlanName(Map<String, dynamic> plan) {
    return plan['name']?.toString().trim() ??
        plan['description']?.toString().trim() ??
        'Data Plan';
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
          backgroundColor: isError ? Colors.red : Colors.green,
        ),
      );
  }

  Future<void> loadDataPlans() async {
    if (!mounted) return;

    setState(() {
      isLoadingPlans = true;
      plansError = '';
      dataPlans = [];
      selectedPlanCode = '';
    });

    try {
      final Map<String, dynamic> result = await ApiService.getDataPlans(
        network: selectedNetwork,
      );

      if (!mounted) return;

      if (result['success'] != true) {
        setState(() {
          plansError =
              result['message']?.toString() ?? 'Unable to load data plans.';
          dataPlans = [];
          selectedPlanCode = '';
        });

        return;
      }

      final dynamic rawPlans = result['plans'];

      final List<Map<String, dynamic>> plans = [];

      if (rawPlans is List) {
        for (final dynamic item in rawPlans) {
          if (item is Map<String, dynamic>) {
            plans.add(
              Map<String, dynamic>.from(item),
            );
          } else if (item is Map) {
            plans.add(
              Map<String, dynamic>.from(item),
            );
          }
        }
      }

      plans.removeWhere((Map<String, dynamic> plan) {
        final String code = getPlanCode(plan);
        final double price = parseAmount(plan['price']);

        return code.isEmpty || price <= 0;
      });

      if (plans.isEmpty) {
        setState(() {
          plansError = 'No active data plans were returned for '
              '$selectedNetwork.';
          dataPlans = [];
          selectedPlanCode = '';
        });

        return;
      }

      plans.sort(
        (
          Map<String, dynamic> first,
          Map<String, dynamic> second,
        ) {
          return parseAmount(first['price']).compareTo(
            parseAmount(second['price']),
          );
        },
      );

      setState(() {
        dataPlans = plans;
        selectedPlanCode = getPlanCode(plans.first);
        plansError = '';
      });
    } catch (error) {
      if (!mounted) return;

      setState(() {
        plansError = error.toString().replaceFirst('Exception: ', '');
        dataPlans = [];
        selectedPlanCode = '';
      });
    } finally {
      if (mounted) {
        setState(() {
          isLoadingPlans = false;
        });
      }
    }
  }

  Future<bool> confirmPurchase({
    required String phone,
    required String planName,
    required double price,
  }) async {
    final bool? confirmed = await showDialog<bool>(
      context: context,
      builder: (BuildContext dialogContext) {
        return AlertDialog(
          title: const Text(
            'Confirm data purchase',
          ),
          content: Text(
            'Purchase $planName $selectedNetwork data '
            'for ₦${formatAmount(price)} on $phone?',
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
    if (isBusy) return;

    final String phone = phoneController.text.trim();

    final Map<String, dynamic>? plan = selectedPlan;

    if (!isValidPhone(phone)) {
      showMessage(
        'Please enter a valid 11-digit phone number.',
        isError: true,
      );
      return;
    }

    if (plan == null) {
      showMessage(
        'Please select a valid data plan.',
        isError: true,
      );
      return;
    }

    final String planCode = getPlanCode(plan);

    final String planName = getPlanName(plan);

    final double price = parseAmount(plan['price']);

    if (planCode.isEmpty || price <= 0) {
      showMessage(
        'The selected data plan is invalid.',
        isError: true,
      );
      return;
    }

    final bool confirmed = await confirmPurchase(
      phone: phone,
      planName: planName,
      price: price,
    );

    if (!confirmed || !mounted) return;

    setState(() {
      isBuyingData = true;
    });

    try {
      final Map<String, dynamic> result = await ApiService.buyData(
        network: selectedNetwork,
        phone: phone,
        planCode: planCode,
        amount: price,
      );

      if (!mounted) return;

      final bool success = result['success'] == true;

      final String message = result['message']?.toString() ??
          result['response_description']?.toString() ??
          result['description']?.toString() ??
          result['error']?.toString() ??
          (success ? 'Data purchase was successful.' : 'Data purchase failed.');

      final String reference = result['reference']?.toString() ?? '';

      final String status = result['status']?.toString().toUpperCase() ?? '';

      String finalMessage = message;

      if (!success && status == 'REFUNDED') {
        finalMessage = '$finalMessage Your wallet has been refunded.';
      }

      if (reference.isNotEmpty) {
        finalMessage = '$finalMessage Reference: $reference';
      }

      showMessage(
        finalMessage,
        isError: !success,
      );

      if (success) {
        phoneController.clear();
      }
    } catch (error) {
      if (!mounted) return;

      showMessage(
        error.toString().replaceFirst('Exception: ', ''),
        isError: true,
      );
    } finally {
      if (mounted) {
        setState(() {
          isBuyingData = false;
        });
      }
    }
  }

  Widget buildPlansSection() {
    if (isLoadingPlans) {
      return Container(
        height: 58,
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(
            color: Colors.grey.shade400,
          ),
        ),
        child: const Center(
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              SizedBox(
                width: 22,
                height: 22,
                child: CircularProgressIndicator(
                  strokeWidth: 2.5,
                ),
              ),
              SizedBox(width: 12),
              Text('Loading live data plans...'),
            ],
          ),
        ),
      );
    }

    if (plansError.isNotEmpty) {
      return Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: Colors.red.shade50,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(
            color: Colors.red.shade200,
          ),
        ),
        child: Column(
          children: [
            const Icon(
              Icons.error_outline,
              color: Colors.red,
              size: 32,
            ),
            const SizedBox(height: 8),
            Text(
              plansError,
              textAlign: TextAlign.center,
              style: const TextStyle(
                color: Colors.red,
              ),
            ),
            const SizedBox(height: 12),
            OutlinedButton.icon(
              onPressed: loadDataPlans,
              icon: const Icon(Icons.refresh),
              label: const Text('Try Again'),
            ),
          ],
        ),
      );
    }

    return DropdownButtonFormField<String>(
      key: ValueKey<String>(
        '$selectedNetwork-$selectedPlanCode',
      ),
      initialValue: selectedPlanCode.isEmpty ? null : selectedPlanCode,
      isExpanded: true,
      decoration: InputDecoration(
        prefixIcon: const Icon(
          Icons.data_usage_outlined,
        ),
        filled: true,
        fillColor: Colors.white,
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
        ),
      ),
      items: dataPlans.map(
        (Map<String, dynamic> plan) {
          final String code = getPlanCode(plan);

          final String name = getPlanName(plan);

          final String price = formatAmount(plan['price']);

          return DropdownMenuItem<String>(
            value: code,
            child: Text(
              '$name - ₦$price',
              overflow: TextOverflow.ellipsis,
            ),
          );
        },
      ).toList(),
      onChanged: isBuyingData
          ? null
          : (String? value) {
              if (value == null) return;

              setState(() {
                selectedPlanCode = value;
              });
            },
    );
  }

  @override
  Widget build(BuildContext context) {
    final Map<String, dynamic>? plan = selectedPlan;

    final String buttonText;

    if (isLoadingPlans) {
      buttonText = 'Loading Plans...';
    } else if (plan == null) {
      buttonText = 'Select Data Plan';
    } else {
      buttonText = 'Buy ${getPlanName(plan)} - '
          '₦${formatAmount(plan['price'])}';
    }

    return Scaffold(
      backgroundColor: const Color(0xFFF5F7FA),
      appBar: AppBar(
        backgroundColor: Colors.green,
        foregroundColor: Colors.white,
        title: const Text(
          'Buy Data',
          style: TextStyle(
            fontWeight: FontWeight.bold,
          ),
        ),
        actions: [
          IconButton(
            onPressed: isBusy ? null : loadDataPlans,
            tooltip: 'Refresh plans',
            icon: const Icon(Icons.refresh),
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: loadDataPlans,
        child: SingleChildScrollView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.all(20),
          child: Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(
                maxWidth: 600,
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
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
                        borderRadius: BorderRadius.circular(12),
                      ),
                    ),
                    items: networks.map(
                      (String network) {
                        return DropdownMenuItem<String>(
                          value: network,
                          child: Text(network),
                        );
                      },
                    ).toList(),
                    onChanged: isBusy
                        ? null
                        : (String? value) async {
                            if (value == null || value == selectedNetwork) {
                              return;
                            }

                            setState(() {
                              selectedNetwork = value;
                            });

                            await loadDataPlans();
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
                  buildPlansSection(),
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
                    enabled: !isBusy,
                    maxLength: 11,
                    keyboardType: TextInputType.phone,
                    decoration: InputDecoration(
                      hintText: '08012345678',
                      prefixIcon: const Icon(
                        Icons.phone_outlined,
                      ),
                      counterText: '',
                      filled: true,
                      fillColor: Colors.white,
                      border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(12),
                      ),
                    ),
                  ),
                  const SizedBox(height: 28),
                  SizedBox(
                    height: 52,
                    child: ElevatedButton(
                      onPressed: isBusy || plan == null || plansError.isNotEmpty
                          ? null
                          : buyData,
                      style: ElevatedButton.styleFrom(
                        backgroundColor: Colors.green,
                        foregroundColor: Colors.white,
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(12),
                        ),
                      ),
                      child: isBuyingData
                          ? const SizedBox(
                              width: 24,
                              height: 24,
                              child: CircularProgressIndicator(
                                strokeWidth: 2.5,
                                color: Colors.white,
                              ),
                            )
                          : Text(
                              buttonText,
                              textAlign: TextAlign.center,
                              style: const TextStyle(
                                fontSize: 16,
                                fontWeight: FontWeight.bold,
                              ),
                            ),
                    ),
                  ),
                  const SizedBox(height: 16),
                  const Text(
                    'Data plans and prices are loaded live '
                    'from the service provider.',
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      color: Colors.grey,
                      fontSize: 13,
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

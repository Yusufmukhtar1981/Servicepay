import 'package:flutter/material.dart';

import 'services/api_service.dart';

class DataScreen extends StatefulWidget {
  const DataScreen({super.key});

  @override
  State<DataScreen> createState() => _DataScreenState();
}

class _DataScreenState extends State<DataScreen> {
  static const Color primaryGreen = Color(0xFF08783E);

  static const Color softGreen = Color(0xFFEAF7F0);

  final TextEditingController phoneController = TextEditingController();

  final List<String> networks = const <String>[
    'MTN',
    'Airtel',
    'Glo',
    '9mobile',
  ];

  String selectedNetwork = 'MTN';
  String selectedCategory = 'All';

  List<Map<String, dynamic>> dataPlans = <Map<String, dynamic>>[];

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

  bool get isBusy => isLoadingPlans || isBuyingData;

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

  String getPlanCode(
    Map<String, dynamic> plan,
  ) {
    return plan['code']?.toString().trim() ??
        plan['id']?.toString().trim() ??
        '';
  }

  String getPlanName(
    Map<String, dynamic> plan,
  ) {
    return plan['name']?.toString().trim() ??
        plan['description']?.toString().trim() ??
        'Data Plan';
  }

  String getCategory(
    Map<String, dynamic> plan,
  ) {
    final String name = getPlanName(plan).toUpperCase();

    if (name.contains('SME')) {
      return 'SME';
    }

    if (name.contains('AWOOF')) {
      return 'Awoof';
    }

    if (name.contains('DIRECT')) {
      return 'Direct';
    }

    return 'Other';
  }

  String getBundleSize(
    Map<String, dynamic> plan,
  ) {
    final String name = getPlanName(plan);

    final RegExp pattern = RegExp(
      r'(\d+(?:\.\d+)?)\s*(MB|GB|TB)',
      caseSensitive: false,
    );

    final RegExpMatch? match = pattern.firstMatch(name);

    if (match == null) {
      return name;
    }

    final String number = match.group(1) ?? '';

    final String unit = (match.group(2) ?? '').toUpperCase();

    return '$number $unit';
  }

  String getValidity(
    Map<String, dynamic> plan,
  ) {
    final String name = getPlanName(plan);

    final RegExp dayPattern = RegExp(
      r'(\d+)\s*day',
      caseSensitive: false,
    );

    final RegExpMatch? dayMatch = dayPattern.firstMatch(name);

    if (dayMatch != null) {
      final String days = dayMatch.group(1) ?? '';

      return '$days Day${days == '1' ? '' : 's'}';
    }

    if (name.toUpperCase().contains('WEEKLY')) {
      return 'Weekly';
    }

    if (name.toUpperCase().contains('MONTHLY')) {
      return 'Monthly';
    }

    if (name.toUpperCase().contains('DAILY')) {
      return 'Daily';
    }

    return '';
  }

  bool isValidPhone(String phone) {
    return RegExp(
      r'^0\d{10}$',
    ).hasMatch(phone);
  }

  List<String> get categories {
    final Set<String> found = dataPlans.map(getCategory).toSet();

    final List<String> result = <String>['All'];

    for (final String item in const <String>[
      'SME',
      'Awoof',
      'Direct',
      'Other',
    ]) {
      if (found.contains(item)) {
        result.add(item);
      }
    }

    return result;
  }

  List<Map<String, dynamic>> get visiblePlans {
    final List<Map<String, dynamic>> result = selectedCategory == 'All'
        ? List<Map<String, dynamic>>.from(
            dataPlans,
          )
        : dataPlans
            .where(
              (Map<String, dynamic> plan) =>
                  getCategory(plan) == selectedCategory,
            )
            .toList();

    result.sort(
      (
        Map<String, dynamic> a,
        Map<String, dynamic> b,
      ) =>
          parseAmount(a['price']).compareTo(
        parseAmount(b['price']),
      ),
    );

    return result;
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
          backgroundColor: isError ? Colors.red.shade700 : primaryGreen,
        ),
      );
  }

  Future<void> loadDataPlans() async {
    if (!mounted) return;

    setState(() {
      isLoadingPlans = true;
      plansError = '';
      dataPlans = <Map<String, dynamic>>[];
      selectedCategory = 'All';
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
        });
        return;
      }

      final dynamic rawPlans = result['plans'];

      final List<Map<String, dynamic>> plans = <Map<String, dynamic>>[];

      if (rawPlans is List) {
        for (final dynamic item in rawPlans) {
          if (item is Map) {
            final Map<String, dynamic> plan = Map<String, dynamic>.from(item);

            if (getPlanCode(plan).isNotEmpty &&
                parseAmount(plan['price']) > 0) {
              plans.add(plan);
            }
          }
        }
      }

      plans.sort(
        (
          Map<String, dynamic> a,
          Map<String, dynamic> b,
        ) =>
            parseAmount(a['price']).compareTo(
          parseAmount(b['price']),
        ),
      );

      if (!mounted) return;

      setState(() {
        dataPlans = plans;

        if (plans.isEmpty) {
          plansError =
              'No active data plans were returned for $selectedNetwork.';
        }
      });
    } catch (error) {
      if (!mounted) return;

      setState(() {
        plansError = error.toString().replaceFirst(
              'Exception: ',
              '',
            );
      });
    } finally {
      if (mounted) {
        setState(() {
          isLoadingPlans = false;
        });
      }
    }
  }

  Future<void> buyPlan(
    Map<String, dynamic> plan,
  ) async {
    if (isBusy) return;

    final String phone = phoneController.text.trim();

    if (!isValidPhone(phone)) {
      showMessage(
        'Please enter a valid 11-digit phone number.',
        isError: true,
      );
      return;
    }

    final String code = getPlanCode(plan);

    final String name = getPlanName(plan);

    final double price = parseAmount(plan['price']);

    if (code.isEmpty || price <= 0) {
      showMessage(
        'This data plan is invalid.',
        isError: true,
      );
      return;
    }

    final bool? confirmed = await showDialog<bool>(
      context: context,
      builder: (BuildContext dialogContext) {
        return AlertDialog(
          title: const Text(
            'Confirm Data Purchase',
          ),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Text(
                getBundleSize(plan),
                style: const TextStyle(
                  fontSize: 20,
                  fontWeight: FontWeight.w800,
                ),
              ),
              const SizedBox(height: 6),
              Text(name),
              const SizedBox(height: 14),
              Text(
                'Network: $selectedNetwork',
              ),
              Text(
                'Phone: $phone',
              ),
              const SizedBox(height: 10),
              Text(
                '₦${formatAmount(price)}',
                style: const TextStyle(
                  color: primaryGreen,
                  fontSize: 22,
                  fontWeight: FontWeight.w900,
                ),
              ),
            ],
          ),
          actions: <Widget>[
            TextButton(
              onPressed: () => Navigator.pop(
                dialogContext,
                false,
              ),
              child: const Text('Cancel'),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(
                dialogContext,
                true,
              ),
              child: const Text('Buy Data'),
            ),
          ],
        );
      },
    );

    if (confirmed != true || !mounted) {
      return;
    }

    setState(() {
      isBuyingData = true;
    });

    try {
      final Map<String, dynamic> result = await ApiService.buyData(
        network: selectedNetwork,
        phone: phone,
        planCode: code,

        // Backward compatibility only.
        // Backend now determines real selling price.
        amount: price,
      );

      if (!mounted) return;

      final bool success = result['success'] == true;

      String message = result['message']?.toString() ??
          result['response_description']?.toString() ??
          result['description']?.toString() ??
          result['error']?.toString() ??
          (success ? 'Data purchase successful.' : 'Data purchase failed.');

      final String reference = result['reference']?.toString() ?? '';

      final String status = result['status']?.toString().toUpperCase() ?? '';

      if (!success && status == 'REFUNDED') {
        message = '$message Your wallet has been refunded.';
      }

      if (reference.isNotEmpty) {
        message = '$message Reference: $reference';
      }

      showMessage(
        message,
        isError: !success,
      );

      if (success) {
        phoneController.clear();
      }
    } catch (error) {
      showMessage(
        error.toString().replaceFirst(
              'Exception: ',
              '',
            ),
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

  Widget buildNetworkSelector() {
    return SizedBox(
      height: 46,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        itemCount: networks.length,
        separatorBuilder: (_, __) => const SizedBox(width: 8),
        itemBuilder: (
          BuildContext context,
          int index,
        ) {
          final String network = networks[index];

          final bool selected = selectedNetwork == network;

          return ChoiceChip(
            label: Text(network),
            selected: selected,
            selectedColor: primaryGreen,
            backgroundColor: Colors.white,
            side: BorderSide(
              color: selected ? primaryGreen : Colors.grey.shade300,
            ),
            labelStyle: TextStyle(
              color: selected ? Colors.white : Colors.black87,
              fontWeight: FontWeight.w700,
            ),
            onSelected: isBusy
                ? null
                : (_) async {
                    if (selected) return;

                    setState(() {
                      selectedNetwork = network;
                    });

                    await loadDataPlans();
                  },
          );
        },
      ),
    );
  }

  Widget buildCategorySelector() {
    return SizedBox(
      height: 42,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        itemCount: categories.length,
        separatorBuilder: (_, __) => const SizedBox(width: 7),
        itemBuilder: (
          BuildContext context,
          int index,
        ) {
          final String category = categories[index];

          return FilterChip(
            label: Text(category),
            selected: selectedCategory == category,
            selectedColor: softGreen,
            checkmarkColor: primaryGreen,
            onSelected: (_) {
              setState(() {
                selectedCategory = category;
              });
            },
          );
        },
      ),
    );
  }

  Widget buildPlanCard(
    Map<String, dynamic> plan,
  ) {
    final String name = getPlanName(plan);

    final String bundle = getBundleSize(plan);

    final String category = getCategory(plan);

    final String validity = getValidity(plan);

    return Card(
      elevation: 0,
      color: Colors.white,
      margin: const EdgeInsets.only(
        bottom: 12,
      ),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(18),
        side: BorderSide(
          color: Colors.grey.shade200,
        ),
      ),
      child: InkWell(
        borderRadius: BorderRadius.circular(18),
        onTap: isBuyingData ? null : () => buyPlan(plan),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Row(
            children: <Widget>[
              Container(
                width: 52,
                height: 52,
                decoration: BoxDecoration(
                  color: softGreen,
                  borderRadius: BorderRadius.circular(
                    15,
                  ),
                ),
                child: const Icon(
                  Icons.signal_cellular_alt_rounded,
                  color: primaryGreen,
                ),
              ),
              const SizedBox(width: 13),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    Text(
                      bundle,
                      style: const TextStyle(
                        fontSize: 17,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                    const SizedBox(
                      height: 3,
                    ),
                    Text(
                      [
                        category,
                        validity,
                      ]
                          .where(
                            (String value) => value.isNotEmpty,
                          )
                          .join(' • '),
                      style: TextStyle(
                        color: Colors.grey.shade600,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    const SizedBox(
                      height: 4,
                    ),
                    Text(
                      name,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        color: Colors.grey.shade700,
                        fontSize: 12,
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 10),
              Column(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: <Widget>[
                  Text(
                    '₦${formatAmount(plan['price'])}',
                    style: const TextStyle(
                      color: primaryGreen,
                      fontSize: 18,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                  const SizedBox(
                    height: 8,
                  ),
                  FilledButton(
                    onPressed: isBuyingData ? null : () => buyPlan(plan),
                    style: FilledButton.styleFrom(
                      backgroundColor: primaryGreen,
                      padding: const EdgeInsets.symmetric(
                        horizontal: 16,
                      ),
                    ),
                    child: const Text('Buy'),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final List<Map<String, dynamic>> displayed = visiblePlans;

    return Scaffold(
      backgroundColor: const Color(0xFFF6F8FA),
      appBar: AppBar(
        backgroundColor: primaryGreen,
        foregroundColor: Colors.white,
        title: const Text(
          'Buy Data',
          style: TextStyle(
            fontWeight: FontWeight.w800,
          ),
        ),
        actions: <Widget>[
          IconButton(
            tooltip: 'Refresh',
            onPressed: isBusy ? null : loadDataPlans,
            icon: const Icon(
              Icons.refresh_rounded,
            ),
          ),
        ],
      ),
      body: Column(
        children: <Widget>[
          Container(
            width: double.infinity,
            color: Colors.white,
            padding: const EdgeInsets.fromLTRB(
              16,
              16,
              16,
              14,
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                TextField(
                  controller: phoneController,
                  enabled: !isBuyingData,
                  maxLength: 11,
                  keyboardType: TextInputType.phone,
                  decoration: InputDecoration(
                    labelText: 'Beneficiary Phone Number',
                    hintText: '08012345678',
                    counterText: '',
                    prefixIcon: const Icon(
                      Icons.phone_android_rounded,
                    ),
                    filled: true,
                    fillColor: const Color(
                      0xFFF8FAFC,
                    ),
                    border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(
                        14,
                      ),
                    ),
                  ),
                ),
                const SizedBox(
                  height: 14,
                ),
                const Text(
                  'Network',
                  style: TextStyle(
                    fontWeight: FontWeight.w800,
                  ),
                ),
                const SizedBox(
                  height: 8,
                ),
                buildNetworkSelector(),
                if (!isLoadingPlans && dataPlans.isNotEmpty) ...[
                  const SizedBox(
                    height: 14,
                  ),
                  const Text(
                    'Data Type',
                    style: TextStyle(
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                  const SizedBox(
                    height: 8,
                  ),
                  buildCategorySelector(),
                ],
              ],
            ),
          ),
          Expanded(
            child: isLoadingPlans
                ? const Center(
                    child: CircularProgressIndicator(),
                  )
                : plansError.isNotEmpty
                    ? Center(
                        child: Padding(
                          padding: const EdgeInsets.all(
                            24,
                          ),
                          child: Column(
                            mainAxisSize: MainAxisSize.min,
                            children: <Widget>[
                              const Icon(
                                Icons.error_outline_rounded,
                                size: 46,
                                color: Colors.red,
                              ),
                              const SizedBox(
                                height: 12,
                              ),
                              Text(
                                plansError,
                                textAlign: TextAlign.center,
                              ),
                              const SizedBox(
                                height: 14,
                              ),
                              FilledButton.icon(
                                onPressed: loadDataPlans,
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
                    : displayed.isEmpty
                        ? const Center(
                            child: Text(
                              'No plans found in this category.',
                            ),
                          )
                        : RefreshIndicator(
                            onRefresh: loadDataPlans,
                            child: ListView.builder(
                              padding: const EdgeInsets.all(
                                16,
                              ),
                              itemCount: displayed.length,
                              itemBuilder: (
                                BuildContext context,
                                int index,
                              ) =>
                                  buildPlanCard(
                                displayed[index],
                              ),
                            ),
                          ),
          ),
        ],
      ),
    );
  }
}

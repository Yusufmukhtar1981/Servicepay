import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

class AdminDataPricingScreen extends StatefulWidget {
  const AdminDataPricingScreen({super.key});

  @override
  State<AdminDataPricingScreen> createState() => _AdminDataPricingScreenState();
}

class _AdminDataPricingScreenState extends State<AdminDataPricingScreen> {
  static const String baseUrl = 'https://api.servicepay.ng/api';

  static const Color primaryGreen = Color(0xFF08783E);

  final List<String> networks = const <String>[
    'MTN',
    'Airtel',
    'Glo',
    '9mobile',
  ];

  String selectedNetwork = 'MTN';

  bool loading = true;
  String errorMessage = '';

  List<Map<String, dynamic>> plans = <Map<String, dynamic>>[];

  final Map<String, TextEditingController> controllers =
      <String, TextEditingController>{};

  final Set<String> saving = <String>{};

  @override
  void initState() {
    super.initState();
    loadPricing();
  }

  @override
  void dispose() {
    for (final TextEditingController controller in controllers.values) {
      controller.dispose();
    }

    super.dispose();
  }

  Future<String?> getToken() async {
    final SharedPreferences prefs = await SharedPreferences.getInstance();

    const List<String> keys = <String>[
      'auth_token',
      'token',
      'access_token',
      'accessToken',
      'jwt_token',
      'jwt',
    ];

    for (final String key in keys) {
      final String value = (prefs.getString(key) ?? '').trim();

      if (value.isNotEmpty) {
        return value.startsWith('Bearer ') ? value.substring(7) : value;
      }
    }

    return null;
  }

  dynamic decode(String body) {
    try {
      return jsonDecode(body);
    } catch (_) {
      return <String, dynamic>{};
    }
  }

  String money(dynamic value) {
    final double amount = double.tryParse(
          value.toString().replaceAll('₦', '').replaceAll(',', '').trim(),
        ) ??
        0;

    if (amount == amount.roundToDouble()) {
      return amount.toStringAsFixed(0);
    }

    return amount.toStringAsFixed(2);
  }

  double number(dynamic value) {
    return double.tryParse(
          value.toString().replaceAll('₦', '').replaceAll(',', '').trim(),
        ) ??
        0;
  }

  String planCategory(String name) {
    final String upper = name.toUpperCase();

    if (upper.contains('SME')) {
      return 'SME';
    }

    if (upper.contains('AWOOF')) {
      return 'Awoof';
    }

    if (upper.contains('DIRECT')) {
      return 'Direct';
    }

    return 'Other';
  }

  void showMessage(
    String message, {
    bool error = false,
  }) {
    if (!mounted) return;

    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(
        SnackBar(
          content: Text(message),
          backgroundColor: error ? Colors.red.shade700 : primaryGreen,
        ),
      );
  }

  Future<void> loadPricing() async {
    setState(() {
      loading = true;
      errorMessage = '';
    });

    try {
      final String? token = await getToken();

      if (token == null) {
        throw Exception(
          'Admin session not found.',
        );
      }

      final http.Response response = await http.get(
        Uri.parse(
          '$baseUrl/clubkonnect/admin/data-pricing/$selectedNetwork',
        ),
        headers: <String, String>{
          'Accept': 'application/json',
          'Authorization': 'Bearer $token',
        },
      );

      final dynamic decoded = decode(response.body);

      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw Exception(
          decoded is Map
              ? (decoded['message'] ?? 'Unable to load Data pricing.')
                  .toString()
              : 'Unable to load Data pricing.',
        );
      }

      final dynamic rawPlans = decoded is Map ? decoded['plans'] : null;

      final List<Map<String, dynamic>> next = <Map<String, dynamic>>[];

      if (rawPlans is List) {
        for (final dynamic item in rawPlans) {
          if (item is Map) {
            next.add(
              Map<String, dynamic>.from(item),
            );
          }
        }
      }

      next.sort(
        (
          Map<String, dynamic> a,
          Map<String, dynamic> b,
        ) =>
            number(
          a['providerPrice'],
        ).compareTo(
          number(
            b['providerPrice'],
          ),
        ),
      );

      for (final TextEditingController controller in controllers.values) {
        controller.dispose();
      }

      controllers.clear();

      for (final Map<String, dynamic> plan in next) {
        final String code = (plan['code'] ?? '').toString();

        controllers[code] = TextEditingController(
          text: money(
            plan['sellingPrice'],
          ),
        );
      }

      if (!mounted) return;

      setState(() {
        plans = next;
      });
    } catch (error) {
      if (!mounted) return;

      setState(() {
        errorMessage = error.toString().replaceFirst(
              'Exception: ',
              '',
            );
      });
    } finally {
      if (mounted) {
        setState(() {
          loading = false;
        });
      }
    }
  }

  Future<void> savePrice(
    Map<String, dynamic> plan,
  ) async {
    final String code = (plan['code'] ?? '').toString();

    final TextEditingController? controller = controllers[code];

    final double? sellingPrice = double.tryParse(
      controller?.text.trim() ?? '',
    );

    if (sellingPrice == null || sellingPrice <= 0) {
      showMessage(
        'Enter a valid selling price.',
        error: true,
      );
      return;
    }

    setState(() {
      saving.add(code);
    });

    try {
      final String? token = await getToken();

      if (token == null) {
        throw Exception(
          'Admin session not found.',
        );
      }

      final http.Response response = await http.put(
        Uri.parse(
          '$baseUrl/clubkonnect/admin/data-pricing/$selectedNetwork/$code',
        ),
        headers: <String, String>{
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          'Authorization': 'Bearer $token',
        },
        body: jsonEncode(
          <String, dynamic>{
            'sellingPrice': sellingPrice,
          },
        ),
      );

      final dynamic decoded = decode(response.body);

      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw Exception(
          decoded is Map
              ? (decoded['message'] ?? 'Unable to save selling price.')
                  .toString()
              : 'Unable to save selling price.',
        );
      }

      showMessage(
        'Selling price saved successfully.',
      );

      await loadPricing();
    } catch (error) {
      showMessage(
        error.toString().replaceFirst(
              'Exception: ',
              '',
            ),
        error: true,
      );
    } finally {
      if (mounted) {
        setState(() {
          saving.remove(code);
        });
      }
    }
  }

  Widget networkTabs() {
    return SizedBox(
      height: 48,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        itemCount: networks.length,
        separatorBuilder: (_, __) => const SizedBox(width: 8),
        itemBuilder: (
          BuildContext context,
          int index,
        ) {
          final String network = networks[index];

          final bool selected = network == selectedNetwork;

          return ChoiceChip(
            label: Text(network),
            selected: selected,
            selectedColor: primaryGreen,
            labelStyle: TextStyle(
              color: selected ? Colors.white : Colors.black87,
              fontWeight: FontWeight.w700,
            ),
            onSelected: (_) {
              if (network == selectedNetwork) {
                return;
              }

              setState(() {
                selectedNetwork = network;
              });

              loadPricing();
            },
          );
        },
      ),
    );
  }

  Widget pricingCard(
    Map<String, dynamic> plan,
  ) {
    final String code = (plan['code'] ?? '').toString();

    final String name = (plan['name'] ?? 'Data Plan').toString();

    final double providerPrice = number(
      plan['providerPrice'],
    );

    final TextEditingController controller =
        controllers[code] ?? TextEditingController();

    final double sellingPrice = double.tryParse(
          controller.text.trim(),
        ) ??
        providerPrice;

    final double margin = sellingPrice - providerPrice;

    return Card(
      margin: const EdgeInsets.only(
        bottom: 14,
      ),
      elevation: 0,
      color: Colors.white,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(18),
        side: BorderSide(
          color: Colors.grey.shade200,
        ),
      ),
      child: Padding(
        padding: const EdgeInsets.all(18),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Row(
              children: <Widget>[
                Container(
                  width: 46,
                  height: 46,
                  decoration: BoxDecoration(
                    color: const Color(
                      0xFFEAF7F0,
                    ),
                    borderRadius: BorderRadius.circular(
                      13,
                    ),
                  ),
                  child: const Icon(
                    Icons.signal_cellular_alt_rounded,
                    color: primaryGreen,
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: <Widget>[
                      Text(
                        name,
                        style: const TextStyle(
                          fontSize: 16,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                      const SizedBox(
                        height: 4,
                      ),
                      Text(
                        planCategory(name),
                        style: TextStyle(
                          color: Colors.grey.shade600,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
            const SizedBox(height: 18),
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(
                color: const Color(
                  0xFFF8FAFC,
                ),
                borderRadius: BorderRadius.circular(
                  14,
                ),
              ),
              child: Row(
                children: <Widget>[
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: <Widget>[
                        const Text(
                          'Provider Price',
                          style: TextStyle(
                            color: Colors.black54,
                            fontSize: 12,
                          ),
                        ),
                        const SizedBox(
                          height: 3,
                        ),
                        Text(
                          '₦${money(providerPrice)}',
                          style: const TextStyle(
                            fontWeight: FontWeight.w800,
                            fontSize: 17,
                          ),
                        ),
                      ],
                    ),
                  ),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.end,
                      children: <Widget>[
                        const Text(
                          'Current Margin',
                          style: TextStyle(
                            color: Colors.black54,
                            fontSize: 12,
                          ),
                        ),
                        const SizedBox(
                          height: 3,
                        ),
                        Text(
                          '${margin >= 0 ? '+' : ''}₦${money(margin)}',
                          style: TextStyle(
                            fontWeight: FontWeight.w800,
                            fontSize: 17,
                            color: margin >= 0 ? primaryGreen : Colors.red,
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 14),
            Row(
              children: <Widget>[
                Expanded(
                  child: TextField(
                    controller: controller,
                    keyboardType: const TextInputType.numberWithOptions(
                      decimal: true,
                    ),
                    onChanged: (_) {
                      setState(() {});
                    },
                    decoration: const InputDecoration(
                      labelText: 'ServicePay Selling Price',
                      prefixText: '₦ ',
                      border: OutlineInputBorder(),
                    ),
                  ),
                ),
                const SizedBox(width: 10),
                FilledButton.icon(
                  onPressed:
                      saving.contains(code) ? null : () => savePrice(plan),
                  icon: saving.contains(code)
                      ? const SizedBox(
                          width: 17,
                          height: 17,
                          child: CircularProgressIndicator(
                            strokeWidth: 2,
                          ),
                        )
                      : const Icon(
                          Icons.save_rounded,
                        ),
                  label: const Text(
                    'Save',
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(
    BuildContext context,
  ) {
    return Scaffold(
      backgroundColor: const Color(
        0xFFF7F9FC,
      ),
      appBar: AppBar(
        title: const Text(
          'Data Pricing',
          style: TextStyle(
            fontWeight: FontWeight.w800,
          ),
        ),
        backgroundColor: Colors.white,
        surfaceTintColor: Colors.white,
        actions: <Widget>[
          IconButton(
            tooltip: 'Refresh Prices',
            onPressed: loadPricing,
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
              12,
              16,
              14,
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                const Text(
                  'Set ServicePay Selling Price',
                  style: TextStyle(
                    fontSize: 17,
                    fontWeight: FontWeight.w800,
                  ),
                ),
                const SizedBox(
                  height: 5,
                ),
                const Text(
                  'Provider price is shown for Head Office only. Customers will see your Selling Price.',
                  style: TextStyle(
                    color: Colors.black54,
                  ),
                ),
                const SizedBox(
                  height: 14,
                ),
                networkTabs(),
              ],
            ),
          ),
          Expanded(
            child: loading
                ? const Center(
                    child: CircularProgressIndicator(),
                  )
                : errorMessage.isNotEmpty
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
                                size: 44,
                                color: Colors.red,
                              ),
                              const SizedBox(
                                height: 10,
                              ),
                              Text(
                                errorMessage,
                                textAlign: TextAlign.center,
                              ),
                              const SizedBox(
                                height: 14,
                              ),
                              FilledButton(
                                onPressed: loadPricing,
                                child: const Text(
                                  'Retry',
                                ),
                              ),
                            ],
                          ),
                        ),
                      )
                    : ListView.builder(
                        padding: const EdgeInsets.all(
                          16,
                        ),
                        itemCount: plans.length,
                        itemBuilder: (
                          BuildContext context,
                          int index,
                        ) =>
                            pricingCard(
                          plans[index],
                        ),
                      ),
          ),
        ],
      ),
    );
  }
}

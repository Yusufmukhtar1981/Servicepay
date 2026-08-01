import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

class AdminProductCommissionScreen extends StatefulWidget {
  const AdminProductCommissionScreen({super.key});

  @override
  State<AdminProductCommissionScreen> createState() =>
      _AdminProductCommissionScreenState();
}

class _AdminProductCommissionScreenState
    extends State<AdminProductCommissionScreen> {
  static const String baseUrl = 'https://api.servicepay.ng/api';

  final TextEditingController searchController = TextEditingController();

  bool isLoading = true;
  bool isRefreshing = false;
  bool hasError = false;

  String errorMessage = '';

  List<Map<String, dynamic>> products = [];

  @override
  void initState() {
    super.initState();
    loadProducts();
  }

  @override
  void dispose() {
    searchController.dispose();
    super.dispose();
  }

  Future<String?> getSavedAuthToken() async {
    final SharedPreferences preferences = await SharedPreferences.getInstance();

    const List<String> tokenKeys = [
      'auth_token',
      'token',
      'access_token',
      'admin_token',
    ];

    for (final String key in tokenKeys) {
      final String? value = preferences.getString(key);

      if (value != null && value.trim().isNotEmpty) {
        return value.trim();
      }
    }

    return null;
  }

  Future<void> loadProducts({
    bool refreshing = false,
  }) async {
    if (refreshing) {
      setState(() {
        isRefreshing = true;
      });
    } else {
      setState(() {
        isLoading = true;
      });
    }

    try {
      final String? token = await getSavedAuthToken();

      if (token == null) {
        throw Exception(
          'Admin authentication token was not found. Please sign in again.',
        );
      }

      final String search = searchController.text.trim();

      final Uri uri = Uri.parse(
        '$baseUrl/admin/product-commissions',
      ).replace(
        queryParameters: search.isEmpty
            ? null
            : {
                'search': search,
              },
      );

      final http.Response response = await http.get(
        uri,
        headers: {
          'Accept': 'application/json',
          'Authorization': 'Bearer $token',
        },
      ).timeout(
        const Duration(seconds: 30),
      );

      final dynamic decoded = jsonDecode(response.body);

      if (response.statusCode == 200 &&
          decoded is Map<String, dynamic> &&
          decoded['success'] == true) {
        final dynamic rawProducts = decoded['products'];

        final List<Map<String, dynamic>> loadedProducts = rawProducts is List
            ? rawProducts
                .whereType<Map>()
                .map(
                  (Map item) => Map<String, dynamic>.from(
                    item,
                  ),
                )
                .toList()
            : [];

        if (!mounted) {
          return;
        }

        setState(() {
          products = loadedProducts;
          hasError = false;
          errorMessage = '';
        });
      } else {
        final String message = decoded is Map<String, dynamic>
            ? decoded['message']?.toString() ??
                'Unable to load product commissions.'
            : 'Unable to load product commissions.';

        throw Exception(message);
      }
    } catch (error) {
      if (!mounted) {
        return;
      }

      setState(() {
        hasError = true;
        errorMessage = error.toString().replaceFirst('Exception: ', '');
      });
    } finally {
      if (mounted) {
        setState(() {
          isLoading = false;
          isRefreshing = false;
        });
      }
    }
  }

  Future<void> saveProduct({
    Map<String, dynamic>? product,
  }) async {
    final bool? saved = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      backgroundColor: Colors.transparent,
      builder: (
        BuildContext context,
      ) {
        return ProductCommissionFormSheet(
          product: product,
          baseUrl: baseUrl,
          getSavedAuthToken: getSavedAuthToken,
        );
      },
    );

    if (saved == true) {
      await loadProducts(
        refreshing: true,
      );
    }
  }

  Future<void> updateProductStatus(
    Map<String, dynamic> product,
    bool isActive,
  ) async {
    final String? id = product['_id']?.toString();

    if (id == null || id.isEmpty) {
      showMessage(
        'Product ID was not found.',
        isError: true,
      );
      return;
    }

    try {
      final String? token = await getSavedAuthToken();

      if (token == null) {
        throw Exception(
          'Admin authentication token was not found.',
        );
      }

      final http.Response response = await http
          .patch(
            Uri.parse(
              '$baseUrl/admin/product-commissions/$id/status',
            ),
            headers: {
              'Content-Type': 'application/json',
              'Accept': 'application/json',
              'Authorization': 'Bearer $token',
            },
            body: jsonEncode({
              'isActive': isActive,
            }),
          )
          .timeout(
            const Duration(seconds: 30),
          );

      final dynamic decoded = jsonDecode(response.body);

      if (response.statusCode == 200 &&
          decoded is Map<String, dynamic> &&
          decoded['success'] == true) {
        showMessage(
          isActive
              ? 'Product commission activated.'
              : 'Product commission disabled.',
        );

        await loadProducts(
          refreshing: true,
        );
      } else {
        final String message = decoded is Map<String, dynamic>
            ? decoded['message']?.toString() ??
                'Unable to update product status.'
            : 'Unable to update product status.';

        throw Exception(message);
      }
    } catch (error) {
      showMessage(
        error.toString().replaceFirst('Exception: ', ''),
        isError: true,
      );
    }
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
          backgroundColor:
              isError ? Colors.red.shade700 : Colors.green.shade700,
        ),
      );
  }

  double toAmount(dynamic value) {
    if (value is num) {
      return value.toDouble();
    }

    return double.tryParse(
          value?.toString() ?? '',
        ) ??
        0;
  }

  String formatMoney(dynamic value) {
    final double amount = toAmount(value);

    return '₦${amount.toStringAsFixed(2)}';
  }

  Widget buildSummaryCard() {
    double agentTotal = 0;
    double stateTotal = 0;
    double zonalTotal = 0;

    int activeProducts = 0;

    for (final Map<String, dynamic> product in products) {
      agentTotal += toAmount(
        product['aggregatorCommission'],
      );

      stateTotal += toAmount(
        product['stateCommission'],
      );

      zonalTotal += toAmount(
        product['zonalCommission'],
      );

      if (product['isActive'] == true) {
        activeProducts++;
      }
    }

    return Card(
      elevation: 0,
      color: Theme.of(context)
          .colorScheme
          .primaryContainer
          .withValues(alpha: 0.55),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          children: [
            Row(
              children: [
                Expanded(
                  child: SummaryItem(
                    title: 'Products',
                    value: products.length.toString(),
                    icon: Icons.inventory_2_outlined,
                  ),
                ),
                Expanded(
                  child: SummaryItem(
                    title: 'Active',
                    value: activeProducts.toString(),
                    icon: Icons.check_circle_outline,
                  ),
                ),
              ],
            ),
            const Divider(height: 28),
            Row(
              children: [
                Expanded(
                  child: SummaryItem(
                    title: 'Aggregator',
                    value: formatMoney(agentTotal),
                    icon: Icons.person_outline,
                  ),
                ),
                Expanded(
                  child: SummaryItem(
                    title: 'State',
                    value: formatMoney(stateTotal),
                    icon: Icons.location_city_outlined,
                  ),
                ),
                Expanded(
                  child: SummaryItem(
                    title: 'Zone',
                    value: formatMoney(zonalTotal),
                    icon: Icons.map_outlined,
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget buildProductCard(
    Map<String, dynamic> product,
  ) {
    final bool isActive = product['isActive'] == true;

    final String productName =
        product['productName']?.toString() ?? 'Unnamed Product';

    final String serviceType = product['serviceType']?.toString() ?? '';

    final String productCode = product['productCode']?.toString() ?? '';

    return Card(
      elevation: 0,
      margin: const EdgeInsets.only(bottom: 12),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: BorderSide(
          color: Theme.of(context).dividerColor.withValues(alpha: 0.6),
        ),
      ),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Container(
                  width: 46,
                  height: 46,
                  decoration: BoxDecoration(
                    color: Theme.of(context).colorScheme.primaryContainer,
                    borderRadius: BorderRadius.circular(14),
                  ),
                  child: Icon(
                    Icons.payments_outlined,
                    color: Theme.of(context).colorScheme.primary,
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        productName,
                        style: const TextStyle(
                          fontSize: 16,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        '$serviceType • $productCode',
                        style: TextStyle(
                          color: Theme.of(context).colorScheme.onSurfaceVariant,
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
                    color: isActive
                        ? Colors.green.withValues(
                            alpha: 0.12,
                          )
                        : Colors.grey.withValues(
                            alpha: 0.15,
                          ),
                    borderRadius: BorderRadius.circular(30),
                  ),
                  child: Text(
                    isActive ? 'ACTIVE' : 'DISABLED',
                    style: TextStyle(
                      color: isActive
                          ? Colors.green.shade700
                          : Colors.grey.shade700,
                      fontSize: 11,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 18),
            Row(
              children: [
                Expanded(
                  child: CommissionAmountBox(
                    title: 'Aggregator',
                    amount: formatMoney(
                      product['aggregatorCommission'],
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: CommissionAmountBox(
                    title: 'State',
                    amount: formatMoney(
                      product['stateCommission'],
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: CommissionAmountBox(
                    title: 'Zone',
                    amount: formatMoney(
                      product['zonalCommission'],
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 14),
            Row(
              children: [
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: () {
                      saveProduct(
                        product: product,
                      );
                    },
                    icon: const Icon(
                      Icons.edit_outlined,
                    ),
                    label: const Text('Edit'),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: FilledButton.tonalIcon(
                    onPressed: () {
                      updateProductStatus(
                        product,
                        !isActive,
                      );
                    },
                    icon: Icon(
                      isActive
                          ? Icons.block_outlined
                          : Icons.check_circle_outline,
                    ),
                    label: Text(
                      isActive ? 'Disable' : 'Activate',
                    ),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget buildBody() {
    if (isLoading) {
      return const Center(
        child: CircularProgressIndicator(),
      );
    }

    if (hasError && products.isEmpty) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(
                Icons.error_outline,
                size: 56,
                color: Colors.red.shade400,
              ),
              const SizedBox(height: 14),
              Text(
                errorMessage,
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 16),
              FilledButton.icon(
                onPressed: loadProducts,
                icon: const Icon(
                  Icons.refresh,
                ),
                label: const Text('Try Again'),
              ),
            ],
          ),
        ),
      );
    }

    return RefreshIndicator(
      onRefresh: () {
        return loadProducts(
          refreshing: true,
        );
      },
      child: ListView(
        padding: const EdgeInsets.fromLTRB(
          16,
          16,
          16,
          100,
        ),
        children: [
          buildSummaryCard(),
          const SizedBox(height: 16),
          TextField(
            controller: searchController,
            textInputAction: TextInputAction.search,
            decoration: InputDecoration(
              hintText: 'Search product, service or code',
              prefixIcon: const Icon(Icons.search),
              suffixIcon: searchController.text.isNotEmpty
                  ? IconButton(
                      onPressed: () {
                        searchController.clear();

                        setState(() {});

                        loadProducts();
                      },
                      icon: const Icon(
                        Icons.close,
                      ),
                    )
                  : null,
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(
                  14,
                ),
              ),
            ),
            onChanged: (_) {
              setState(() {});
            },
            onSubmitted: (_) {
              loadProducts();
            },
          ),
          const SizedBox(height: 18),
          Row(
            children: [
              const Expanded(
                child: Text(
                  'Product Commissions',
                  style: TextStyle(
                    fontSize: 18,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
              Text(
                '${products.length} products',
                style: TextStyle(
                  color: Theme.of(context).colorScheme.onSurfaceVariant,
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          if (products.isEmpty)
            Padding(
              padding: const EdgeInsets.symmetric(
                vertical: 50,
              ),
              child: Column(
                children: [
                  Icon(
                    Icons.inventory_2_outlined,
                    size: 64,
                    color: Theme.of(context).colorScheme.outline,
                  ),
                  const SizedBox(height: 14),
                  const Text(
                    'No product commission has been added.',
                    textAlign: TextAlign.center,
                  ),
                  const SizedBox(height: 16),
                  FilledButton.icon(
                    onPressed: saveProduct,
                    icon: const Icon(
                      Icons.add,
                    ),
                    label: const Text(
                      'Add First Product',
                    ),
                  ),
                ],
              ),
            )
          else
            ...products.map(
              buildProductCard,
            ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Product Commissions'),
        actions: [
          IconButton(
            tooltip: 'Refresh',
            onPressed: isRefreshing
                ? null
                : () {
                    loadProducts(
                      refreshing: true,
                    );
                  },
            icon: isRefreshing
                ? const SizedBox(
                    width: 20,
                    height: 20,
                    child: CircularProgressIndicator(
                      strokeWidth: 2,
                    ),
                  )
                : const Icon(
                    Icons.refresh,
                  ),
          ),
        ],
      ),
      body: buildBody(),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: saveProduct,
        icon: const Icon(Icons.add),
        label: const Text('Add Product'),
      ),
    );
  }
}

class ProductCommissionFormSheet extends StatefulWidget {
  final Map<String, dynamic>? product;
  final String baseUrl;
  final Future<String?> Function() getSavedAuthToken;

  const ProductCommissionFormSheet({
    super.key,
    required this.product,
    required this.baseUrl,
    required this.getSavedAuthToken,
  });

  @override
  State<ProductCommissionFormSheet> createState() =>
      _ProductCommissionFormSheetState();
}

class _ProductCommissionFormSheetState
    extends State<ProductCommissionFormSheet> {
  final GlobalKey<FormState> formKey = GlobalKey<FormState>();

  late final TextEditingController productNameController;

  late final TextEditingController productCodeController;

  late final TextEditingController agentCommissionController;

  late final TextEditingController stateCommissionController;

  late final TextEditingController zonalCommissionController;

  String selectedServiceType = 'AIRTIME';

  bool isActive = true;
  bool isSaving = false;

  final List<String> serviceTypes = [
    'AIRTIME',
    'DATA',
    'NIN',
    'BVN',
    'CABLE',
    'ELECTRICITY',
    'EXAM_PIN',
    'DELIVERY',
    'TRANSFER',
  ];

  @override
  void initState() {
    super.initState();

    final Map<String, dynamic>? product = widget.product;

    productNameController = TextEditingController(
      text: product?['productName']?.toString() ?? '',
    );

    productCodeController = TextEditingController(
      text: product?['productCode']?.toString() ?? '',
    );

    agentCommissionController = TextEditingController(
      text: amountText(
        product?['aggregatorCommission'],
      ),
    );

    stateCommissionController = TextEditingController(
      text: amountText(
        product?['stateCommission'],
      ),
    );

    zonalCommissionController = TextEditingController(
      text: amountText(
        product?['zonalCommission'],
      ),
    );

    final String serviceType =
        product?['serviceType']?.toString().toUpperCase() ?? 'AIRTIME';

    if (serviceTypes.contains(serviceType)) {
      selectedServiceType = serviceType;
    }

    isActive = product?['isActive'] != false;
  }

  String amountText(dynamic value) {
    if (value == null) {
      return '0';
    }

    final double? amount = double.tryParse(value.toString());

    if (amount == null) {
      return '0';
    }

    if (amount == amount.roundToDouble()) {
      return amount.toInt().toString();
    }

    return amount.toStringAsFixed(2);
  }

  @override
  void dispose() {
    productNameController.dispose();
    productCodeController.dispose();
    agentCommissionController.dispose();
    stateCommissionController.dispose();
    zonalCommissionController.dispose();
    super.dispose();
  }

  double parseAmount(
    TextEditingController controller,
  ) {
    return double.tryParse(
          controller.text.trim(),
        ) ??
        0;
  }

  Future<void> submit() async {
    if (!(formKey.currentState?.validate() ?? false)) {
      return;
    }

    setState(() {
      isSaving = true;
    });

    try {
      final String? token = await widget.getSavedAuthToken();

      if (token == null) {
        throw Exception(
          'Admin authentication token was not found.',
        );
      }

      final http.Response response = await http
          .post(
            Uri.parse(
              '${widget.baseUrl}/admin/product-commissions',
            ),
            headers: {
              'Content-Type': 'application/json',
              'Accept': 'application/json',
              'Authorization': 'Bearer $token',
            },
            body: jsonEncode({
              'serviceType': selectedServiceType,
              'productCode': productCodeController.text.trim().toUpperCase(),
              'productName': productNameController.text.trim(),
              'aggregatorCommission': parseAmount(
                agentCommissionController,
              ),
              'stateCommission': parseAmount(
                stateCommissionController,
              ),
              'zonalCommission': parseAmount(
                zonalCommissionController,
              ),
              'isActive': isActive,
            }),
          )
          .timeout(
            const Duration(seconds: 30),
          );

      final dynamic decoded = jsonDecode(response.body);

      if (response.statusCode == 200 &&
          decoded is Map<String, dynamic> &&
          decoded['success'] == true) {
        if (!mounted) {
          return;
        }

        Navigator.of(context).pop(true);
      } else {
        final String message = decoded is Map<String, dynamic>
            ? decoded['message']?.toString() ??
                'Unable to save product commission.'
            : 'Unable to save product commission.';

        throw Exception(message);
      }
    } catch (error) {
      if (!mounted) {
        return;
      }

      ScaffoldMessenger.of(context)
        ..hideCurrentSnackBar()
        ..showSnackBar(
          SnackBar(
            content: Text(
              error.toString().replaceFirst(
                    'Exception: ',
                    '',
                  ),
            ),
            backgroundColor: Colors.red.shade700,
          ),
        );
    } finally {
      if (mounted) {
        setState(() {
          isSaving = false;
        });
      }
    }
  }

  String? validateRequired(
    String? value,
  ) {
    if (value == null || value.trim().isEmpty) {
      return 'This field is required.';
    }

    return null;
  }

  String? validateAmount(
    String? value,
  ) {
    final double? amount = double.tryParse(
      value?.trim() ?? '',
    );

    if (amount == null) {
      return 'Enter a valid amount.';
    }

    if (amount < 0) {
      return 'Amount cannot be negative.';
    }

    return null;
  }

  @override
  Widget build(BuildContext context) {
    final bool editing = widget.product != null;

    return Container(
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.surface,
        borderRadius: const BorderRadius.vertical(
          top: Radius.circular(24),
        ),
      ),
      child: SingleChildScrollView(
        padding: EdgeInsets.fromLTRB(
          20,
          16,
          20,
          MediaQuery.of(context).viewInsets.bottom + 24,
        ),
        child: Form(
          key: formKey,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Center(
                child: Container(
                  width: 44,
                  height: 5,
                  decoration: BoxDecoration(
                    color: Theme.of(context).colorScheme.outlineVariant,
                    borderRadius: BorderRadius.circular(
                      10,
                    ),
                  ),
                ),
              ),
              const SizedBox(height: 20),
              Text(
                editing ? 'Edit Product Commission' : 'Add Product Commission',
                style: const TextStyle(
                  fontSize: 21,
                  fontWeight: FontWeight.w700,
                ),
              ),
              const SizedBox(height: 6),
              Text(
                'Set the fixed amount for Aggregator, State Manager and Zonal Manager.',
                style: TextStyle(
                  color: Theme.of(context).colorScheme.onSurfaceVariant,
                ),
              ),
              const SizedBox(height: 22),
              DropdownButtonFormField<String>(
                initialValue: selectedServiceType,
                decoration: const InputDecoration(
                  labelText: 'Service Type',
                  border: OutlineInputBorder(),
                ),
                items: serviceTypes
                    .map(
                      (String value) => DropdownMenuItem<String>(
                        value: value,
                        child: Text(value),
                      ),
                    )
                    .toList(),
                onChanged: (
                  String? value,
                ) {
                  if (value != null) {
                    setState(() {
                      selectedServiceType = value;
                    });
                  }
                },
              ),
              const SizedBox(height: 14),
              TextFormField(
                controller: productNameController,
                validator: validateRequired,
                textCapitalization: TextCapitalization.words,
                decoration: const InputDecoration(
                  labelText: 'Product Name',
                  hintText: 'Example: MTN Airtime',
                  border: OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: 14),
              TextFormField(
                controller: productCodeController,
                validator: validateRequired,
                textCapitalization: TextCapitalization.characters,
                decoration: const InputDecoration(
                  labelText: 'Product Code',
                  hintText: 'Example: MTN_AIRTIME',
                  border: OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: 18),
              const Text(
                'Commission Amounts',
                style: TextStyle(
                  fontWeight: FontWeight.w700,
                ),
              ),
              const SizedBox(height: 12),
              TextFormField(
                controller: agentCommissionController,
                validator: validateAmount,
                keyboardType: const TextInputType.numberWithOptions(
                  decimal: true,
                ),
                decoration: const InputDecoration(
                  labelText: 'Aggregator Commission',
                  prefixText: '₦ ',
                  border: OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: 14),
              TextFormField(
                controller: stateCommissionController,
                validator: validateAmount,
                keyboardType: const TextInputType.numberWithOptions(
                  decimal: true,
                ),
                decoration: const InputDecoration(
                  labelText: 'State Commission',
                  prefixText: '₦ ',
                  border: OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: 14),
              TextFormField(
                controller: zonalCommissionController,
                validator: validateAmount,
                keyboardType: const TextInputType.numberWithOptions(
                  decimal: true,
                ),
                decoration: const InputDecoration(
                  labelText: 'Zonal Commission',
                  prefixText: '₦ ',
                  border: OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: 10),
              SwitchListTile.adaptive(
                value: isActive,
                contentPadding: EdgeInsets.zero,
                title: const Text(
                  'Product Active',
                ),
                subtitle: Text(
                  isActive
                      ? 'Commission will be available for this product.'
                      : 'Commission is currently disabled.',
                ),
                onChanged: (bool value) {
                  setState(() {
                    isActive = value;
                  });
                },
              ),
              const SizedBox(height: 16),
              SizedBox(
                width: double.infinity,
                height: 52,
                child: FilledButton.icon(
                  onPressed: isSaving ? null : submit,
                  icon: isSaving
                      ? const SizedBox(
                          width: 20,
                          height: 20,
                          child: CircularProgressIndicator(
                            strokeWidth: 2,
                          ),
                        )
                      : const Icon(
                          Icons.save_outlined,
                        ),
                  label: Text(
                    isSaving ? 'Saving...' : 'Save Commission',
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class SummaryItem extends StatelessWidget {
  final String title;
  final String value;
  final IconData icon;

  const SummaryItem({
    super.key,
    required this.title,
    required this.value,
    required this.icon,
  });

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Icon(
          icon,
          color: Theme.of(context).colorScheme.primary,
        ),
        const SizedBox(height: 6),
        Text(
          value,
          textAlign: TextAlign.center,
          style: const TextStyle(
            fontWeight: FontWeight.w700,
            fontSize: 15,
          ),
        ),
        const SizedBox(height: 3),
        Text(
          title,
          textAlign: TextAlign.center,
          style: TextStyle(
            fontSize: 12,
            color: Theme.of(context).colorScheme.onSurfaceVariant,
          ),
        ),
      ],
    );
  }
}

class CommissionAmountBox extends StatelessWidget {
  final String title;
  final String amount;

  const CommissionAmountBox({
    super.key,
    required this.title,
    required this.amount,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: 10,
        vertical: 12,
      ),
      decoration: BoxDecoration(
        color: Theme.of(context)
            .colorScheme
            .surfaceContainerHighest
            .withValues(alpha: 0.55),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Column(
        children: [
          Text(
            title,
            style: TextStyle(
              fontSize: 12,
              color: Theme.of(context).colorScheme.onSurfaceVariant,
            ),
          ),
          const SizedBox(height: 5),
          Text(
            amount,
            textAlign: TextAlign.center,
            style: const TextStyle(
              fontWeight: FontWeight.w700,
              fontSize: 14,
            ),
          ),
        ],
      ),
    );
  }
}

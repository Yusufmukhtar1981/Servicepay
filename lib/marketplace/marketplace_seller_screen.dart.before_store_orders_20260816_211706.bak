import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

class MarketplaceSellerScreen extends StatefulWidget {
  const MarketplaceSellerScreen({super.key});

  @override
  State<MarketplaceSellerScreen> createState() =>
      _MarketplaceSellerScreenState();
}

class _MarketplaceSellerScreenState extends State<MarketplaceSellerScreen> {
  static const String baseUrl = 'https://api.servicepay.ng/api/marketplace';

  final storeNameController = TextEditingController();
  final businessNameController = TextEditingController();
  final phoneController = TextEditingController();
  final emailController = TextEditingController();
  final stateController = TextEditingController();
  final lgaController = TextEditingController();
  final addressController = TextEditingController();
  final descriptionController = TextEditingController();

  final productTitleController = TextEditingController();
  final productDescriptionController = TextEditingController();
  final productCategoryController = TextEditingController();
  final productPriceController = TextEditingController();
  final productStockController = TextEditingController();
  final productImageController = TextEditingController();

  bool loading = true;
  bool savingMerchant = false;
  bool addingProduct = false;

  Map<String, dynamic>? merchant;
  List<Map<String, dynamic>> products = [];

  @override
  void initState() {
    super.initState();
    loadSellerData();
  }

  Future<String> token() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getString('auth_token') ?? '';
  }

  Map<String, String> headers(String authToken) => {
        'Content-Type': 'application/json',
        if (authToken.isNotEmpty) 'Authorization': 'Bearer $authToken',
      };

  Future<void> loadSellerData() async {
    if (mounted) {
      setState(() => loading = true);
    }

    try {
      final authToken = await token();

      final responses = await Future.wait([
        http.get(
          Uri.parse('$baseUrl/merchant/me'),
          headers: headers(authToken),
        ),
        http.get(
          Uri.parse('$baseUrl/products/mine'),
          headers: headers(authToken),
        ),
      ]);

      final merchantBody =
          jsonDecode(responses[0].body) as Map<String, dynamic>;
      final productsBody =
          jsonDecode(responses[1].body) as Map<String, dynamic>;

      final loadedMerchant = merchantBody['merchant'];

      if (loadedMerchant is Map<String, dynamic>) {
        merchant = loadedMerchant;

        storeNameController.text = '${loadedMerchant['storeName'] ?? ''}';
        businessNameController.text = '${loadedMerchant['businessName'] ?? ''}';
        phoneController.text = '${loadedMerchant['phone'] ?? ''}';
        emailController.text = '${loadedMerchant['email'] ?? ''}';
        stateController.text = '${loadedMerchant['state'] ?? ''}';
        lgaController.text = '${loadedMerchant['lga'] ?? ''}';
        addressController.text = '${loadedMerchant['address'] ?? ''}';
        descriptionController.text = '${loadedMerchant['description'] ?? ''}';
      }

      final rawProducts = productsBody['products'];

      if (rawProducts is List) {
        products = rawProducts
            .whereType<Map>()
            .map(
              (item) => Map<String, dynamic>.from(item),
            )
            .toList();
      }
    } catch (_) {
      if (mounted) {
        showMessage('Unable to load seller account.');
      }
    } finally {
      if (mounted) {
        setState(() => loading = false);
      }
    }
  }

  Future<void> saveMerchant() async {
    if (storeNameController.text.trim().isEmpty) {
      showMessage('Enter your store name.');
      return;
    }

    setState(() => savingMerchant = true);

    try {
      final authToken = await token();

      final response = await http.post(
        Uri.parse('$baseUrl/merchant/register'),
        headers: headers(authToken),
        body: jsonEncode({
          'storeName': storeNameController.text.trim(),
          'businessName': businessNameController.text.trim(),
          'phone': phoneController.text.trim(),
          'email': emailController.text.trim(),
          'state': stateController.text.trim(),
          'lga': lgaController.text.trim(),
          'address': addressController.text.trim(),
          'description': descriptionController.text.trim(),
        }),
      );

      final body = jsonDecode(response.body) as Map<String, dynamic>;

      if (response.statusCode >= 200 &&
          response.statusCode < 300 &&
          body['success'] == true) {
        merchant = Map<String, dynamic>.from(body['merchant'] as Map);

        if (mounted) {
          setState(() {});
          showMessage('Seller account saved successfully.');
        }
      } else {
        showMessage(
          '${body['message'] ?? 'Unable to save seller account.'}',
        );
      }
    } catch (_) {
      showMessage('Unable to save seller account.');
    } finally {
      if (mounted) {
        setState(() => savingMerchant = false);
      }
    }
  }

  Future<void> addProduct() async {
    if (merchant == null) {
      showMessage('Create your seller account first.');
      return;
    }

    final title = productTitleController.text.trim();
    final price = double.tryParse(productPriceController.text.trim());

    if (title.isEmpty || price == null || price <= 0) {
      showMessage('Enter a valid product name and price.');
      return;
    }

    setState(() => addingProduct = true);

    try {
      final authToken = await token();

      final response = await http.post(
        Uri.parse('$baseUrl/products'),
        headers: headers(authToken),
        body: jsonEncode({
          'title': title,
          'description': productDescriptionController.text.trim(),
          'category': productCategoryController.text.trim(),
          'price': price,
          'stock': int.tryParse(
                productStockController.text.trim(),
              ) ??
              0,
          'imageUrl': productImageController.text.trim(),
        }),
      );

      final body = jsonDecode(response.body) as Map<String, dynamic>;

      if (response.statusCode >= 200 &&
          response.statusCode < 300 &&
          body['success'] == true) {
        productTitleController.clear();
        productDescriptionController.clear();
        productCategoryController.clear();
        productPriceController.clear();
        productStockController.clear();
        productImageController.clear();

        showMessage('Product added successfully.');
        await loadSellerData();
      } else {
        showMessage(
          '${body['message'] ?? 'Unable to add product.'}',
        );
      }
    } catch (_) {
      showMessage('Unable to add product.');
    } finally {
      if (mounted) {
        setState(() => addingProduct = false);
      }
    }
  }

  void showMessage(String message) {
    if (!mounted) return;

    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(message)),
    );
  }

  InputDecoration decoration(String label) {
    return InputDecoration(
      labelText: label,
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(14),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF7F9F8),
      appBar: AppBar(
        title: const Text('Marketplace Seller'),
        backgroundColor: Colors.white,
        foregroundColor: const Color(0xFF15201B),
        elevation: 0,
        actions: [
          IconButton(
            onPressed: loadSellerData,
            icon: const Icon(Icons.refresh_rounded),
          ),
        ],
      ),
      body: loading
          ? const Center(
              child: CircularProgressIndicator(),
            )
          : RefreshIndicator(
              onRefresh: loadSellerData,
              child: ListView(
                padding: const EdgeInsets.all(16),
                children: [
                  Container(
                    padding: const EdgeInsets.all(18),
                    decoration: BoxDecoration(
                      color: const Color(0xFF08783E),
                      borderRadius: BorderRadius.circular(22),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Icon(
                          Icons.storefront_rounded,
                          color: Colors.white,
                          size: 34,
                        ),
                        const SizedBox(height: 12),
                        Text(
                          merchant == null
                              ? 'Become a Seller'
                              : '${merchant!['storeName'] ?? 'My Store'}',
                          style: const TextStyle(
                            color: Colors.white,
                            fontSize: 22,
                            fontWeight: FontWeight.w800,
                          ),
                        ),
                        const SizedBox(height: 6),
                        Text(
                          merchant == null
                              ? 'Create your ServicePay Marketplace store and start listing products.'
                              : 'Manage your store and Marketplace products.',
                          style: const TextStyle(
                            color: Colors.white70,
                            height: 1.4,
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 20),
                  const Text(
                    'Seller Profile',
                    style: TextStyle(
                      fontSize: 18,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                  const SizedBox(height: 12),
                  TextField(
                    controller: storeNameController,
                    decoration: decoration('Store Name *'),
                  ),
                  const SizedBox(height: 12),
                  TextField(
                    controller: businessNameController,
                    decoration: decoration('Business Name'),
                  ),
                  const SizedBox(height: 12),
                  TextField(
                    controller: phoneController,
                    decoration: decoration('Phone'),
                  ),
                  const SizedBox(height: 12),
                  TextField(
                    controller: emailController,
                    decoration: decoration('Email'),
                  ),
                  const SizedBox(height: 12),
                  Row(
                    children: [
                      Expanded(
                        child: TextField(
                          controller: stateController,
                          decoration: decoration('State'),
                        ),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: TextField(
                          controller: lgaController,
                          decoration: decoration('LGA'),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 12),
                  TextField(
                    controller: addressController,
                    decoration: decoration('Business Address'),
                  ),
                  const SizedBox(height: 12),
                  TextField(
                    controller: descriptionController,
                    minLines: 2,
                    maxLines: 4,
                    decoration: decoration('Store Description'),
                  ),
                  const SizedBox(height: 14),
                  SizedBox(
                    height: 52,
                    child: FilledButton.icon(
                      onPressed: savingMerchant ? null : saveMerchant,
                      icon: savingMerchant
                          ? const SizedBox(
                              width: 18,
                              height: 18,
                              child: CircularProgressIndicator(
                                strokeWidth: 2,
                              ),
                            )
                          : const Icon(Icons.store_rounded),
                      label: Text(
                        merchant == null
                            ? 'Create Seller Account'
                            : 'Save Seller Profile',
                      ),
                    ),
                  ),
                  if (merchant != null) ...[
                    const SizedBox(height: 28),
                    const Text(
                      'Add Product',
                      style: TextStyle(
                        fontSize: 18,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                    const SizedBox(height: 12),
                    TextField(
                      controller: productTitleController,
                      decoration: decoration('Product Name *'),
                    ),
                    const SizedBox(height: 12),
                    TextField(
                      controller: productDescriptionController,
                      minLines: 2,
                      maxLines: 4,
                      decoration: decoration('Product Description'),
                    ),
                    const SizedBox(height: 12),
                    TextField(
                      controller: productCategoryController,
                      decoration: decoration('Category'),
                    ),
                    const SizedBox(height: 12),
                    Row(
                      children: [
                        Expanded(
                          child: TextField(
                            controller: productPriceController,
                            keyboardType: TextInputType.number,
                            decoration: decoration('Price (₦) *'),
                          ),
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: TextField(
                            controller: productStockController,
                            keyboardType: TextInputType.number,
                            decoration: decoration('Stock'),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 12),
                    TextField(
                      controller: productImageController,
                      decoration: decoration('Product Image URL'),
                    ),
                    const SizedBox(height: 14),
                    SizedBox(
                      height: 52,
                      child: FilledButton.icon(
                        onPressed: addingProduct ? null : addProduct,
                        icon: const Icon(
                          Icons.add_box_rounded,
                        ),
                        label: Text(
                          addingProduct ? 'Adding...' : 'Add Product',
                        ),
                      ),
                    ),
                    const SizedBox(height: 28),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        const Text(
                          'My Products',
                          style: TextStyle(
                            fontSize: 18,
                            fontWeight: FontWeight.w800,
                          ),
                        ),
                        Text(
                          '${products.length} products',
                          style: const TextStyle(
                            color: Colors.black54,
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 12),
                    if (products.isEmpty)
                      Container(
                        padding: const EdgeInsets.all(24),
                        alignment: Alignment.center,
                        child: const Text(
                          'You have not added any products yet.',
                        ),
                      )
                    else
                      ...products.map(
                        (product) => Card(
                          margin: const EdgeInsets.only(bottom: 10),
                          child: ListTile(
                            leading: const CircleAvatar(
                              child: Icon(
                                Icons.inventory_2_outlined,
                              ),
                            ),
                            title: Text(
                              '${product['title'] ?? 'Product'}',
                              style: const TextStyle(
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                            subtitle: Text(
                              '₦${product['price'] ?? 0} • Stock ${product['stock'] ?? 0}',
                            ),
                            trailing: Text(
                              '${product['status'] ?? 'ACTIVE'}',
                              style: const TextStyle(
                                fontSize: 11,
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                          ),
                        ),
                      ),
                  ],
                  const SizedBox(height: 30),
                ],
              ),
            ),
    );
  }
}

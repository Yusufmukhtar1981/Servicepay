import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:http_parser/http_parser.dart';
import 'package:image_picker/image_picker.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'marketplace_seller_orders_screen.dart';

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
  final ImagePicker productImagePicker = ImagePicker();

  bool loading = true;
  bool savingMerchant = false;
  bool addingProduct = false;
  bool uploadingProductImage = false;
  Uint8List? productImageBytes;
  String productImageFilename = '';

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
    if (addingProduct || uploadingProductImage) return;

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

    if (productImageBytes == null &&
        productImageController.text.trim().isEmpty) {
      showMessage('Choose a product photo before saving.');
      return;
    }

    setState(() => addingProduct = true);

    try {
      final authToken = await token();
      if (authToken.isEmpty) {
        showMessage('Your login session has expired. Please sign in again.');
        return;
      }

      if (productImageController.text.trim().isEmpty) {
        setState(() => uploadingProductImage = true);
        productImageController.text = await uploadProductImage(authToken);
      }

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
        if (mounted) {
          setState(() {
            productImageBytes = null;
            productImageFilename = '';
          });
        }

        showMessage('Product added successfully.');
        await loadSellerData();
      } else {
        showMessage(
          '${body['message'] ?? 'Unable to add product.'}',
        );
      }
    } catch (error) {
      final message = error.toString().replaceFirst('Exception: ', '');
      showMessage(
        message.startsWith('FormatException')
            ? 'Unable to add product.'
            : message,
      );
    } finally {
      if (mounted) {
        setState(() {
          addingProduct = false;
          uploadingProductImage = false;
        });
      }
    }
  }

  MediaType productImageContentType(String filename) {
    final extension = filename.split('.').last.toLowerCase();

    if (extension == 'png') {
      return MediaType('image', 'png');
    }

    if (extension == 'webp') {
      return MediaType('image', 'webp');
    }

    return MediaType('image', 'jpeg');
  }

  Future<String> uploadProductImage(String authToken) async {
    final bytes = productImageBytes;
    if (bytes == null || bytes.isEmpty) {
      throw Exception('Choose a product photo before saving.');
    }

    final request = http.MultipartRequest(
      'POST',
      Uri.parse('$baseUrl/products/image'),
    );
    request.headers['Authorization'] = 'Bearer $authToken';
    request.files.add(
      http.MultipartFile.fromBytes(
        'image',
        bytes,
        filename: productImageFilename,
        contentType: productImageContentType(productImageFilename),
      ),
    );

    final streamed = await request.send().timeout(
          const Duration(seconds: 60),
        );
    final response = await http.Response.fromStream(streamed);
    dynamic decoded;

    try {
      decoded = response.body.isNotEmpty ? jsonDecode(response.body) : {};
    } catch (_) {
      decoded = {};
    }

    if (response.statusCode < 200 ||
        response.statusCode >= 300 ||
        decoded is! Map ||
        decoded['success'] != true) {
      final message = decoded is Map
          ? '${decoded['message'] ?? 'Unable to upload the product photo.'}'
          : 'Unable to upload the product photo.';
      throw Exception(message);
    }

    final imageUrl = '${decoded['imageUrl'] ?? ''}'.trim();
    if (imageUrl.isEmpty) {
      throw Exception(
        'Product image storage did not return a secure image URL.',
      );
    }

    return imageUrl;
  }

  Future<void> chooseProductImage() async {
    if (addingProduct || uploadingProductImage) return;

    try {
      final selected = await productImagePicker.pickImage(
        source: ImageSource.gallery,
        imageQuality: 88,
        maxWidth: 2000,
        maxHeight: 2000,
      );

      if (selected == null) return;

      final bytes = await selected.readAsBytes();
      final filename = selected.name.trim().isEmpty
          ? 'marketplace-product.jpg'
          : selected.name.trim();

      if (bytes.isEmpty) {
        showMessage('The selected photo is empty. Choose another photo.');
        return;
      }

      if (bytes.length > 5 * 1024 * 1024) {
        showMessage('Marketplace product photos must be 5 MB or smaller.');
        return;
      }

      if (mounted) {
        setState(() {
          productImageBytes = bytes;
          productImageFilename = filename;
          productImageController.clear();
        });
      }
    } catch (error) {
      showMessage(
        error.toString().replaceFirst('Exception: ', ''),
      );
    }
  }

  Future<void> deactivateProduct(Map<String, dynamic> product) async {
    final id = '${product['_id'] ?? product['id'] ?? ''}'.trim();
    if (id.isEmpty) return;

    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Deactivate product?'),
        content: const Text(
          'This product will be removed from Marketplace browsing. It can only return after review.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: const Text('Keep active'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(dialogContext).pop(true),
            child: const Text('Deactivate'),
          ),
        ],
      ),
    );

    if (confirmed != true) return;

    try {
      final authToken = await token();
      final response = await http.delete(
        Uri.parse('$baseUrl/products/$id'),
        headers: headers(authToken),
      );
      final body = jsonDecode(response.body);
      if (response.statusCode < 200 ||
          response.statusCode >= 300 ||
          body is! Map ||
          body['success'] != true) {
        showMessage(
          body is Map
              ? '${body['message'] ?? 'Unable to deactivate product.'}'
              : 'Unable to deactivate product.',
        );
        return;
      }
      showMessage('Product deactivated.');
      await loadSellerData();
    } catch (_) {
      showMessage('Unable to deactivate product.');
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
      floatingActionButton: FloatingActionButton.extended(
        heroTag: 'marketplace_my_store_orders',
        onPressed: () {
          Navigator.of(context).push(
            MaterialPageRoute(
              builder: (_) => const MarketplaceSellerOrdersScreen(),
            ),
          );
        },
        icon: const Icon(Icons.receipt_long_rounded),
        label: const Text(
          'My Store Orders',
          style: TextStyle(fontWeight: FontWeight.w700),
        ),
      ),
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
                      readOnly: true,
                      decoration: decoration('Product Photo *').copyWith(
                        hintText: productImageBytes == null
                            ? 'Choose a photo from this device'
                            : 'Photo ready: $productImageFilename',
                        suffixIcon: uploadingProductImage
                            ? const Padding(
                                padding: EdgeInsets.all(12),
                                child: SizedBox(
                                  width: 18,
                                  height: 18,
                                  child: CircularProgressIndicator(
                                    strokeWidth: 2,
                                  ),
                                ),
                              )
                            : IconButton(
                                tooltip: 'Choose product photo',
                                onPressed: chooseProductImage,
                                icon: const Icon(Icons.add_photo_alternate_outlined),
                              ),
                      ),
                    ),
                    if (productImageBytes != null) ...[
                      const SizedBox(height: 12),
                      ClipRRect(
                        borderRadius: BorderRadius.circular(16),
                        child: Image.memory(
                          productImageBytes!,
                          width: double.infinity,
                          height: 190,
                          fit: BoxFit.cover,
                          errorBuilder: (_, __, ___) => const SizedBox(
                            height: 190,
                            child: Center(
                              child: Text('Unable to preview this photo.'),
                            ),
                          ),
                        ),
                      ),
                    ],
                    const SizedBox(height: 10),
                    OutlinedButton.icon(
                      onPressed: addingProduct || uploadingProductImage
                          ? null
                          : chooseProductImage,
                      icon: const Icon(Icons.photo_library_outlined),
                      label: Text(
                        productImageBytes == null
                            ? 'Choose product photo'
                            : 'Replace product photo',
                      ),
                    ),
                    const SizedBox(height: 14),
                    SizedBox(
                      height: 52,
                      child: FilledButton.icon(
                        onPressed: addingProduct || uploadingProductImage
                            ? null
                            : addProduct,
                        icon: const Icon(
                          Icons.add_box_rounded,
                        ),
                        label: Text(
                          uploadingProductImage
                              ? 'Uploading photo...'
                              : addingProduct
                                  ? 'Adding...'
                                  : 'Add Product',
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
                        (product) {
                          final imageUrl =
                              '${product['imageUrl'] ?? ''}'.trim();

                          return Card(
                            margin: const EdgeInsets.only(bottom: 10),
                            child: ListTile(
                              leading: SizedBox(
                                width: 56,
                                height: 56,
                                child: ClipRRect(
                                  borderRadius: BorderRadius.circular(12),
                                  child: imageUrl.isNotEmpty
                                      ? Image.network(
                                          imageUrl,
                                          fit: BoxFit.cover,
                                          errorBuilder: (_, __, ___) =>
                                              const ColoredBox(
                                            color: Color(0xFFE8F5F1),
                                            child: Icon(
                                              Icons.inventory_2_outlined,
                                            ),
                                          ),
                                        )
                                      : const ColoredBox(
                                          color: Color(0xFFE8F5F1),
                                          child: Icon(
                                            Icons.inventory_2_outlined,
                                          ),
                                        ),
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
                              trailing: PopupMenuButton<String>(
                                tooltip: 'Product options',
                                onSelected: (value) {
                                  if (value == 'deactivate') {
                                    deactivateProduct(product);
                                  }
                                },
                                itemBuilder: (_) => [
                                  PopupMenuItem<String>(
                                    enabled: false,
                                    value: 'status',
                                    child: Text(
                                      '${product['status'] ?? 'ACTIVE'}',
                                      style: const TextStyle(
                                        fontWeight: FontWeight.w700,
                                      ),
                                    ),
                                  ),
                                  if ('${product['status']}'.toUpperCase() !=
                                      'SUSPENDED')
                                    const PopupMenuItem<String>(
                                      value: 'deactivate',
                                      child: Text('Deactivate product'),
                                    ),
                                ],
                              ),
                            ),
                          );
                        },
                      ),
                  ],
                  const SizedBox(height: 30),
                ],
              ),
            ),
    );
  }
}

import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:http/http.dart' as http;
import 'package:share_plus/share_plus.dart';
import 'package:shared_preferences/shared_preferences.dart';

class ExamPinScreen extends StatefulWidget {
  const ExamPinScreen({super.key});

  @override
  State<ExamPinScreen> createState() => _ExamPinScreenState();
}

class _ExamPinScreenState extends State<ExamPinScreen> {
  static const String baseUrl = 'https://api.servicepay.ng/api';
  static const Color primaryGreen = Color(0xFF149B8F);

  final GlobalKey<FormState> formKey = GlobalKey<FormState>();

  final TextEditingController phoneController = TextEditingController();
  final TextEditingController quantityController =
      TextEditingController(text: '1');

  bool isLoadingProducts = true;
  bool isLoadingHistory = true;
  bool isBuying = false;

  String errorMessage = '';
  String? selectedProductCode;

  List<Map<String, dynamic>> products = [];
  List<Map<String, dynamic>> history = [];

  @override
  void initState() {
    super.initState();
    loadInitialData();
  }

  @override
  void dispose() {
    phoneController.dispose();
    quantityController.dispose();
    super.dispose();
  }

  Future<void> loadInitialData() async {
    await Future.wait([
      loadProducts(),
      loadHistory(),
    ]);
  }

  Future<String?> getSavedAuthToken(
    SharedPreferences preferences,
  ) async {
    const List<String> tokenKeys = [
      'auth_token',
      'token',
      'access_token',
      'accessToken',
      'jwt_token',
      'jwt',
    ];

    for (final String key in tokenKeys) {
      final String? saved = preferences.getString(key);

      if (saved == null || saved.trim().isEmpty) {
        continue;
      }

      String token = saved.trim();

      if (token.toLowerCase().startsWith('bearer ')) {
        token = token.substring(7).trim();
      }

      if (token.isEmpty) {
        continue;
      }

      await preferences.setString('auth_token', token);

      return token;
    }

    return null;
  }

  Map<String, dynamic> decodeResponse(
    http.Response response,
  ) {
    final String body = response.body.trim();

    if (body.isEmpty) {
      return {
        'success': false,
        'message': 'The server returned an empty response.',
      };
    }

    try {
      final dynamic decoded = jsonDecode(body);

      if (decoded is Map) {
        return Map<String, dynamic>.from(decoded);
      }

      return {
        'success': false,
        'message': 'Invalid response received from the server.',
      };
    } catch (_) {
      return {
        'success': false,
        'message': 'The server returned an invalid response.',
      };
    }
  }

  String responseMessage(
    Map<String, dynamic> data, {
    required String fallback,
  }) {
    final dynamic value = data['message'] ?? data['error'] ?? data['detail'];

    final String message = value?.toString().trim() ?? '';

    return message.isEmpty ? fallback : message;
  }

  Future<void> loadProducts() async {
    if (mounted) {
      setState(() {
        isLoadingProducts = true;
        errorMessage = '';
      });
    }

    try {
      final SharedPreferences preferences =
          await SharedPreferences.getInstance();

      final String? token = await getSavedAuthToken(preferences);

      if (token == null || token.isEmpty) {
        throw Exception(
          'Your login session has expired. Please log in again.',
        );
      }

      final http.Response response = await http.get(
        Uri.parse('$baseUrl/exam-pin/products'),
        headers: {
          'Accept': 'application/json',
          'Authorization': 'Bearer $token',
        },
      ).timeout(
        const Duration(seconds: 50),
      );

      final Map<String, dynamic> data = decodeResponse(response);

      if (response.statusCode == 401) {
        await preferences.remove('auth_token');

        throw Exception(
          responseMessage(
            data,
            fallback: 'Your login session is invalid. Please log in again.',
          ),
        );
      }

      if (response.statusCode < 200 ||
          response.statusCode >= 300 ||
          data['success'] != true) {
        throw Exception(
          responseMessage(
            data,
            fallback: 'Unable to load Exam PIN products.',
          ),
        );
      }

      final dynamic rawProducts = data['products'];

      final List<Map<String, dynamic>> loadedProducts = rawProducts is List
          ? rawProducts
              .whereType<Map>()
              .map(
                (item) => Map<String, dynamic>.from(item),
              )
              .where(
                (item) => item['productCode'] != null && item['price'] != null,
              )
              .toList()
          : [];

      if (!mounted) {
        return;
      }

      setState(() {
        products = loadedProducts;

        if (products.isNotEmpty) {
          final bool selectedStillExists = products.any(
            (item) => item['productCode']?.toString() == selectedProductCode,
          );

          if (!selectedStillExists) {
            selectedProductCode = products.first['productCode']?.toString();
          }
        }
      });
    } on TimeoutException {
      if (mounted) {
        setState(() {
          errorMessage = 'The request timed out. Pull down to try again.';
        });
      }
    } catch (error) {
      if (mounted) {
        setState(() {
          errorMessage = error.toString().replaceFirst('Exception: ', '');
        });
      }
    } finally {
      if (mounted) {
        setState(() {
          isLoadingProducts = false;
        });
      }
    }
  }

  Future<void> loadHistory() async {
    if (mounted) {
      setState(() {
        isLoadingHistory = true;
      });
    }

    try {
      final SharedPreferences preferences =
          await SharedPreferences.getInstance();

      final String? token = await getSavedAuthToken(preferences);

      if (token == null || token.isEmpty) {
        return;
      }

      final http.Response response = await http.get(
        Uri.parse('$baseUrl/exam-pin/history'),
        headers: {
          'Accept': 'application/json',
          'Authorization': 'Bearer $token',
        },
      ).timeout(
        const Duration(seconds: 45),
      );

      final Map<String, dynamic> data = decodeResponse(response);

      if (!mounted) {
        return;
      }

      if (response.statusCode >= 200 &&
          response.statusCode < 300 &&
          data['success'] == true) {
        final dynamic rawRecords = data['records'];

        if (rawRecords is List) {
          setState(() {
            history = rawRecords
                .whereType<Map>()
                .map(
                  (item) => Map<String, dynamic>.from(item),
                )
                .toList();
          });
        }
      }
    } catch (_) {
      // History failure must not stop Exam PIN purchase.
    } finally {
      if (mounted) {
        setState(() {
          isLoadingHistory = false;
        });
      }
    }
  }

  Map<String, dynamic>? get selectedProduct {
    if (selectedProductCode == null) {
      return null;
    }

    for (final Map<String, dynamic> item in products) {
      if (item['productCode']?.toString() == selectedProductCode) {
        return item;
      }
    }

    return null;
  }

  double get selectedUnitPrice {
    final dynamic value = selectedProduct?['price'];

    return double.tryParse(value?.toString() ?? '') ?? 0;
  }

  int get selectedQuantity {
    return int.tryParse(quantityController.text.trim()) ?? 1;
  }

  double get totalAmount {
    return selectedUnitPrice * selectedQuantity;
  }

  String normalizePhone(String value) {
    String phone = value.replaceAll(RegExp(r'\D'), '');

    if (phone.startsWith('234') && phone.length == 13) {
      phone = '0${phone.substring(3)}';
    }

    return phone;
  }

  String? validatePhone(String? value) {
    final String phone = normalizePhone(value ?? '');

    if (phone.isEmpty) {
      return 'Enter the recipient phone number';
    }

    if (phone.length != 11 || !phone.startsWith('0')) {
      return 'Enter a valid 11-digit Nigerian phone number';
    }

    return null;
  }

  String? validateQuantity(String? value) {
    final int? quantity = int.tryParse(value?.trim() ?? '');

    if (quantity == null) {
      return 'Enter a valid quantity';
    }

    if (quantity < 1 || quantity > 5) {
      return 'Quantity must be between 1 and 5';
    }

    return null;
  }

  Future<void> buyExamPin() async {
    FocusScope.of(context).unfocus();

    final bool valid = formKey.currentState?.validate() ?? false;

    if (!valid || isBuying) {
      return;
    }

    final Map<String, dynamic>? product = selectedProduct;

    if (product == null) {
      showMessage(
        'Select a valid Exam PIN product.',
        isError: true,
      );
      return;
    }

    final int quantity = selectedQuantity;
    final String phone = normalizePhone(phoneController.text);
    final double amount = selectedUnitPrice * quantity;

    final bool confirmed = await showPurchaseConfirmation(
      product: product,
      phone: phone,
      quantity: quantity,
      amount: amount,
    );

    if (!confirmed || !mounted) {
      return;
    }

    setState(() {
      isBuying = true;
    });

    try {
      final SharedPreferences preferences =
          await SharedPreferences.getInstance();

      final String? token = await getSavedAuthToken(preferences);

      if (!mounted) {
        return;
      }

      if (token == null || token.isEmpty) {
        showMessage(
          'Your login session has expired. Please log in again.',
          isError: true,
        );
        return;
      }

      final http.Response response = await http
          .post(
            Uri.parse('$baseUrl/exam-pin/buy'),
            headers: {
              'Accept': 'application/json',
              'Content-Type': 'application/json',
              'Authorization': 'Bearer $token',
            },
            body: jsonEncode({
              'productCode': product['productCode']?.toString() ?? '',
              'phone': phone,
              'quantity': quantity,
            }),
          )
          .timeout(
            const Duration(seconds: 180),
          );

      final Map<String, dynamic> data = decodeResponse(response);

      if (!mounted) {
        return;
      }

      if (response.statusCode == 401) {
        await preferences.remove('auth_token');

        showMessage(
          responseMessage(
            data,
            fallback: 'Your login session is invalid. Please log in again.',
          ),
          isError: true,
        );
        return;
      }

      if (data['walletBalance'] != null) {
        final double? walletBalance = double.tryParse(
          data['walletBalance'].toString(),
        );

        if (walletBalance != null) {
          await preferences.setDouble(
            'wallet_balance',
            walletBalance,
          );
        }
      }

      final bool successful = response.statusCode >= 200 &&
          response.statusCode < 300 &&
          data['success'] == true;

      if (!successful) {
        showMessage(
          responseMessage(
            data,
            fallback: 'Exam PIN purchase failed.',
          ),
          isError: true,
        );

        await loadHistory();
        return;
      }

      final List<Map<String, dynamic>> pins = data['pins'] is List
          ? (data['pins'] as List)
              .whereType<Map>()
              .map(
                (item) => Map<String, dynamic>.from(item),
              )
              .toList()
          : [];

      await showPurchaseResult(
        responseData: data,
        pins: pins,
      );

      phoneController.clear();
      quantityController.text = '1';

      await loadHistory();
    } on TimeoutException {
      showMessage(
        'The purchase is taking longer than expected. Check your history before trying again.',
        isError: true,
      );

      await loadHistory();
    } on http.ClientException {
      showMessage(
        'Unable to connect to the Exam PIN server.',
        isError: true,
      );
    } catch (_) {
      showMessage(
        'Unable to complete the Exam PIN purchase.',
        isError: true,
      );
    } finally {
      if (mounted) {
        setState(() {
          isBuying = false;
        });
      }
    }
  }

  Future<bool> showPurchaseConfirmation({
    required Map<String, dynamic> product,
    required String phone,
    required int quantity,
    required double amount,
  }) async {
    final bool? result = await showDialog<bool>(
      context: context,
      builder: (BuildContext dialogContext) {
        return AlertDialog(
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(22),
          ),
          title: const Text(
            'Confirm Purchase',
            style: TextStyle(
              fontWeight: FontWeight.w900,
            ),
          ),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              confirmationRow(
                'Product',
                product['productName']?.toString() ?? 'WAEC PIN',
              ),
              confirmationRow(
                'Phone',
                phone,
              ),
              confirmationRow(
                'Quantity',
                quantity.toString(),
              ),
              confirmationRow(
                'Unit Price',
                formatMoney(selectedUnitPrice),
              ),
              confirmationRow(
                'Total',
                formatMoney(amount),
                important: true,
              ),
              const SizedBox(height: 10),
              const Text(
                'The amount will be deducted from your ServicePay wallet.',
                style: TextStyle(
                  color: Color(0xFF6B7280),
                  height: 1.4,
                ),
              ),
            ],
          ),
          actions: [
            TextButton(
              onPressed: () {
                Navigator.pop(dialogContext, false);
              },
              child: const Text('Cancel'),
            ),
            FilledButton(
              onPressed: () {
                Navigator.pop(dialogContext, true);
              },
              style: FilledButton.styleFrom(
                backgroundColor: primaryGreen,
              ),
              child: const Text('Buy PIN'),
            ),
          ],
        );
      },
    );

    return result ?? false;
  }

  Widget confirmationRow(
    String label,
    String value, {
    bool important = false,
  }) {
    return Padding(
      padding: const EdgeInsets.symmetric(
        vertical: 7,
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 90,
            child: Text(
              label,
              style: const TextStyle(
                color: Color(0xFF6B7280),
              ),
            ),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              value,
              textAlign: TextAlign.right,
              style: TextStyle(
                color: important ? primaryGreen : const Color(0xFF17211A),
                fontWeight: important ? FontWeight.w900 : FontWeight.w700,
              ),
            ),
          ),
        ],
      ),
    );
  }

  Future<void> showPurchaseResult({
    required Map<String, dynamic> responseData,
    required List<Map<String, dynamic>> pins,
  }) async {
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (BuildContext sheetContext) {
        return DraggableScrollableSheet(
          initialChildSize: 0.82,
          minChildSize: 0.55,
          maxChildSize: 0.95,
          builder: (
            BuildContext context,
            ScrollController scrollController,
          ) {
            return Container(
              decoration: const BoxDecoration(
                color: Color(0xFFF7F8FA),
                borderRadius: BorderRadius.vertical(
                  top: Radius.circular(28),
                ),
              ),
              child: ListView(
                controller: scrollController,
                padding: const EdgeInsets.all(20),
                children: [
                  Center(
                    child: Container(
                      width: 50,
                      height: 5,
                      decoration: BoxDecoration(
                        color: const Color(0xFFD1D5DB),
                        borderRadius: BorderRadius.circular(10),
                      ),
                    ),
                  ),
                  const SizedBox(height: 18),
                  const Icon(
                    Icons.verified_rounded,
                    color: primaryGreen,
                    size: 62,
                  ),
                  const SizedBox(height: 8),
                  const Text(
                    'Purchase Successful',
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      fontSize: 23,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                  const SizedBox(height: 5),
                  Text(
                    responseData['message']?.toString() ??
                        'Your Exam PIN is ready.',
                    textAlign: TextAlign.center,
                    style: const TextStyle(
                      color: Color(0xFF6B7280),
                    ),
                  ),
                  const SizedBox(height: 20),
                  ...pins.asMap().entries.map(
                    (entry) {
                      final int index = entry.key;
                      final Map<String, dynamic> pin = entry.value;

                      return buildPinCard(
                        pin: pin,
                        index: index + 1,
                      );
                    },
                  ),
                  if (pins.isEmpty)
                    Container(
                      padding: const EdgeInsets.all(18),
                      decoration: BoxDecoration(
                        color: Colors.white,
                        borderRadius: BorderRadius.circular(18),
                      ),
                      child: const Text(
                        'No PIN details were returned. Check your purchase history.',
                        textAlign: TextAlign.center,
                      ),
                    ),
                  const SizedBox(height: 12),
                  buildSummaryCard(responseData),
                  const SizedBox(height: 20),
                  FilledButton(
                    onPressed: () {
                      Navigator.pop(sheetContext);
                    },
                    style: FilledButton.styleFrom(
                      backgroundColor: primaryGreen,
                      minimumSize: const Size(
                        double.infinity,
                        54,
                      ),
                    ),
                    child: const Text(
                      'Done',
                      style: TextStyle(
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                  ),
                ],
              ),
            );
          },
        );
      },
    );
  }

  Widget buildPinCard({
    required Map<String, dynamic> pin,
    required int index,
  }) {
    final String pinNumber = pin['pin']?.toString().trim() ?? '';

    final String serialNumber = pin['serialNumber']?.toString().trim() ?? '';

    final String cardDetails = pin['cardDetails']?.toString().trim() ?? '';

    final String shareText = [
      'ServicePay Exam PIN',
      if (pinNumber.isNotEmpty) 'PIN: $pinNumber',
      if (serialNumber.isNotEmpty) 'Serial Number: $serialNumber',
      if (cardDetails.isNotEmpty && pinNumber.isEmpty && serialNumber.isEmpty)
        cardDetails,
    ].join('\n');

    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(17),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(
          color: const Color(0xFFD6EDE7),
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              CircleAvatar(
                backgroundColor: primaryGreen.withValues(alpha: 0.12),
                child: Text(
                  '$index',
                  style: const TextStyle(
                    color: primaryGreen,
                    fontWeight: FontWeight.w900,
                  ),
                ),
              ),
              const SizedBox(width: 10),
              const Expanded(
                child: Text(
                  'Exam PIN Details',
                  style: TextStyle(
                    fontSize: 17,
                    fontWeight: FontWeight.w900,
                  ),
                ),
              ),
              IconButton(
                tooltip: 'Share',
                onPressed: () {
                  SharePlus.instance.share(
                    ShareParams(
                      text: shareText,
                    ),
                  );
                },
                icon: const Icon(
                  Icons.share_rounded,
                  color: primaryGreen,
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          if (pinNumber.isNotEmpty)
            pinValueBox(
              label: 'PIN',
              value: pinNumber,
            ),
          if (serialNumber.isNotEmpty)
            pinValueBox(
              label: 'Serial Number',
              value: serialNumber,
            ),
          if (cardDetails.isNotEmpty &&
              pinNumber.isEmpty &&
              serialNumber.isEmpty)
            pinValueBox(
              label: 'Card Details',
              value: cardDetails,
            ),
        ],
      ),
    );
  }

  Widget pinValueBox({
    required String label,
    required String value,
  }) {
    return Container(
      margin: const EdgeInsets.only(bottom: 9),
      padding: const EdgeInsets.all(13),
      decoration: BoxDecoration(
        color: const Color(0xFFF0FAF7),
        borderRadius: BorderRadius.circular(14),
      ),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  label.toUpperCase(),
                  style: const TextStyle(
                    color: Color(0xFF6B7280),
                    fontSize: 11,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                const SizedBox(height: 3),
                SelectableText(
                  value,
                  style: const TextStyle(
                    color: Color(0xFF17211A),
                    fontSize: 17,
                    fontWeight: FontWeight.w900,
                    letterSpacing: 0.8,
                  ),
                ),
              ],
            ),
          ),
          IconButton(
            tooltip: 'Copy',
            onPressed: () async {
              await Clipboard.setData(
                ClipboardData(text: value),
              );

              showMessage(
                '$label copied.',
                isError: false,
              );
            },
            icon: const Icon(
              Icons.copy_rounded,
              color: primaryGreen,
            ),
          ),
        ],
      ),
    );
  }

  Widget buildSummaryCard(
    Map<String, dynamic> data,
  ) {
    return Container(
      padding: const EdgeInsets.all(17),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(18),
      ),
      child: Column(
        children: [
          summaryRow(
            'Reference',
            data['reference']?.toString() ?? '',
          ),
          summaryRow(
            'Successful Quantity',
            data['successfulQuantity']?.toString() ?? '0',
          ),
          summaryRow(
            'Amount Charged',
            formatMoney(
              double.tryParse(
                    data['amountCharged']?.toString() ?? '',
                  ) ??
                  0,
            ),
          ),
          summaryRow(
            'Refunded',
            formatMoney(
              double.tryParse(
                    data['refundedAmount']?.toString() ?? '',
                  ) ??
                  0,
            ),
          ),
          summaryRow(
            'Wallet Balance',
            formatMoney(
              double.tryParse(
                    data['walletBalance']?.toString() ?? '',
                  ) ??
                  0,
            ),
            showDivider: false,
          ),
        ],
      ),
    );
  }

  Widget summaryRow(
    String label,
    String value, {
    bool showDivider = true,
  }) {
    return Container(
      padding: const EdgeInsets.symmetric(
        vertical: 11,
      ),
      decoration: BoxDecoration(
        border: showDivider
            ? const Border(
                bottom: BorderSide(
                  color: Color(0xFFE5E7EB),
                ),
              )
            : null,
      ),
      child: Row(
        children: [
          Expanded(
            child: Text(
              label,
              style: const TextStyle(
                color: Color(0xFF6B7280),
              ),
            ),
          ),
          const SizedBox(width: 10),
          Flexible(
            child: SelectableText(
              value,
              textAlign: TextAlign.right,
              style: const TextStyle(
                fontWeight: FontWeight.w800,
              ),
            ),
          ),
        ],
      ),
    );
  }

  void openHistoryRecord(
    Map<String, dynamic> record,
  ) {
    final List<Map<String, dynamic>> pins = record['pins'] is List
        ? (record['pins'] as List)
            .whereType<Map>()
            .map(
              (item) => Map<String, dynamic>.from(item),
            )
            .where(
              (item) => item['status']?.toString() == 'SUCCESSFUL',
            )
            .toList()
        : [];

    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (BuildContext sheetContext) {
        return DraggableScrollableSheet(
          initialChildSize: 0.80,
          minChildSize: 0.50,
          maxChildSize: 0.95,
          builder: (
            BuildContext context,
            ScrollController scrollController,
          ) {
            return Container(
              decoration: const BoxDecoration(
                color: Color(0xFFF7F8FA),
                borderRadius: BorderRadius.vertical(
                  top: Radius.circular(28),
                ),
              ),
              child: ListView(
                controller: scrollController,
                padding: const EdgeInsets.all(20),
                children: [
                  Center(
                    child: Container(
                      width: 50,
                      height: 5,
                      decoration: BoxDecoration(
                        color: const Color(0xFFD1D5DB),
                        borderRadius: BorderRadius.circular(10),
                      ),
                    ),
                  ),
                  const SizedBox(height: 18),
                  Text(
                    record['productName']?.toString() ?? 'Exam PIN Purchase',
                    textAlign: TextAlign.center,
                    style: const TextStyle(
                      fontSize: 21,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                  const SizedBox(height: 5),
                  Text(
                    formatDate(
                      record['createdAt']?.toString() ?? '',
                    ),
                    textAlign: TextAlign.center,
                    style: const TextStyle(
                      color: Color(0xFF6B7280),
                    ),
                  ),
                  const SizedBox(height: 18),
                  ...pins.asMap().entries.map(
                        (entry) => buildPinCard(
                          pin: entry.value,
                          index: entry.key + 1,
                        ),
                      ),
                  if (pins.isEmpty)
                    Container(
                      padding: const EdgeInsets.all(18),
                      decoration: BoxDecoration(
                        color: Colors.white,
                        borderRadius: BorderRadius.circular(18),
                      ),
                      child: const Text(
                        'No successful PIN details were found in this record.',
                        textAlign: TextAlign.center,
                      ),
                    ),
                  const SizedBox(height: 12),
                  Container(
                    padding: const EdgeInsets.all(17),
                    decoration: BoxDecoration(
                      color: Colors.white,
                      borderRadius: BorderRadius.circular(18),
                    ),
                    child: Column(
                      children: [
                        summaryRow(
                          'Reference',
                          record['reference']?.toString() ?? '',
                        ),
                        summaryRow(
                          'Phone',
                          record['phone']?.toString() ?? '',
                        ),
                        summaryRow(
                          'Quantity',
                          record['quantity']?.toString() ?? '0',
                        ),
                        summaryRow(
                          'Total Amount',
                          formatMoney(
                            double.tryParse(
                                  record['totalAmount']?.toString() ?? '',
                                ) ??
                                0,
                          ),
                        ),
                        summaryRow(
                          'Status',
                          record['status']?.toString() ?? '',
                          showDivider: false,
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            );
          },
        );
      },
    );
  }

  Widget buildProductSelector() {
    if (isLoadingProducts) {
      return const Center(
        child: Padding(
          padding: EdgeInsets.all(30),
          child: CircularProgressIndicator(),
        ),
      );
    }

    if (errorMessage.isNotEmpty) {
      return Container(
        padding: const EdgeInsets.all(18),
        decoration: BoxDecoration(
          color: const Color(0xFFFFF7ED),
          borderRadius: BorderRadius.circular(18),
          border: Border.all(
            color: const Color(0xFFFED7AA),
          ),
        ),
        child: Column(
          children: [
            const Icon(
              Icons.error_outline_rounded,
              color: Color(0xFFEA580C),
              size: 38,
            ),
            const SizedBox(height: 8),
            Text(
              errorMessage,
              textAlign: TextAlign.center,
              style: const TextStyle(
                color: Color(0xFF7C2D12),
              ),
            ),
            const SizedBox(height: 12),
            FilledButton.icon(
              onPressed: loadProducts,
              style: FilledButton.styleFrom(
                backgroundColor: primaryGreen,
              ),
              icon: const Icon(Icons.refresh_rounded),
              label: const Text('Try Again'),
            ),
          ],
        ),
      );
    }

    if (products.isEmpty) {
      return const Center(
        child: Text(
          'No Exam PIN product is currently available.',
        ),
      );
    }

    return Column(
      children: products.map(
        (Map<String, dynamic> product) {
          final String productCode = product['productCode']?.toString() ?? '';

          final String productName =
              product['productName']?.toString() ?? 'WAEC PIN';

          final double price = double.tryParse(
                product['price']?.toString() ?? '',
              ) ??
              0;

          final bool selected = selectedProductCode == productCode;

          return Padding(
            padding: const EdgeInsets.only(bottom: 10),
            child: InkWell(
              onTap: isBuying
                  ? null
                  : () {
                      setState(() {
                        selectedProductCode = productCode;
                      });
                    },
              borderRadius: BorderRadius.circular(18),
              child: AnimatedContainer(
                duration: const Duration(milliseconds: 200),
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  color: selected ? const Color(0xFFEAF9F4) : Colors.white,
                  borderRadius: BorderRadius.circular(18),
                  border: Border.all(
                    color: selected ? primaryGreen : const Color(0xFFE5E7EB),
                    width: selected ? 2 : 1,
                  ),
                ),
                child: Row(
                  children: [
                    CircleAvatar(
                      radius: 25,
                      backgroundColor:
                          selected ? primaryGreen : const Color(0xFFEFF3F2),
                      child: Icon(
                        Icons.confirmation_number_rounded,
                        color: selected ? Colors.white : primaryGreen,
                      ),
                    ),
                    const SizedBox(width: 13),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            productName,
                            style: const TextStyle(
                              fontSize: 16,
                              fontWeight: FontWeight.w900,
                            ),
                          ),
                          const SizedBox(height: 4),
                          const Text(
                            'Delivered instantly after successful purchase',
                            style: TextStyle(
                              color: Color(0xFF6B7280),
                              fontSize: 12,
                            ),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(width: 8),
                    Text(
                      formatMoney(price),
                      style: const TextStyle(
                        color: primaryGreen,
                        fontSize: 16,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                  ],
                ),
              ),
            ),
          );
        },
      ).toList(),
    );
  }

  Widget buildHistorySection() {
    if (isLoadingHistory) {
      return const Center(
        child: Padding(
          padding: EdgeInsets.all(25),
          child: CircularProgressIndicator(),
        ),
      );
    }

    if (history.isEmpty) {
      return Container(
        padding: const EdgeInsets.all(22),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(18),
        ),
        child: const Column(
          children: [
            Icon(
              Icons.history_rounded,
              size: 42,
              color: Colors.grey,
            ),
            SizedBox(height: 8),
            Text(
              'No Exam PIN purchase yet',
              style: TextStyle(
                fontWeight: FontWeight.w700,
              ),
            ),
          ],
        ),
      );
    }

    return Column(
      children: history.take(10).map(
        (Map<String, dynamic> record) {
          final String productName =
              record['productName']?.toString() ?? 'Exam PIN';

          final String status = record['status']?.toString() ?? '';

          final String date = formatDate(
            record['createdAt']?.toString() ?? '',
          );

          final double totalAmount = double.tryParse(
                record['totalAmount']?.toString() ?? '',
              ) ??
              0;

          return Card(
            margin: const EdgeInsets.only(bottom: 10),
            elevation: 0,
            color: Colors.white,
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(16),
              side: const BorderSide(
                color: Color(0xFFE5E7EB),
              ),
            ),
            child: ListTile(
              onTap: () {
                openHistoryRecord(record);
              },
              leading: const CircleAvatar(
                backgroundColor: Color(0xFFE6F7F4),
                child: Icon(
                  Icons.confirmation_number_outlined,
                  color: primaryGreen,
                ),
              ),
              title: Text(
                productName,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  fontWeight: FontWeight.w800,
                ),
              ),
              subtitle: Text(
                [
                  if (date.isNotEmpty) date,
                  status,
                  formatMoney(totalAmount),
                ].join(' • '),
              ),
              trailing: const Icon(
                Icons.chevron_right_rounded,
              ),
            ),
          );
        },
      ).toList(),
    );
  }

  String formatMoney(double amount) {
    final String digits = amount.toStringAsFixed(2);
    final List<String> parts = digits.split('.');
    final String whole = parts.first;
    final String decimal = parts.length > 1 ? parts.last : '00';

    final StringBuffer formatted = StringBuffer();

    for (int index = 0; index < whole.length; index++) {
      final int remaining = whole.length - index;

      formatted.write(whole[index]);

      if (remaining > 1 && remaining % 3 == 1) {
        formatted.write(',');
      }
    }

    return '₦$formatted.$decimal';
  }

  String formatDate(String value) {
    try {
      final DateTime parsed = DateTime.parse(value).toLocal();

      return '${parsed.day.toString().padLeft(2, '0')}/'
          '${parsed.month.toString().padLeft(2, '0')}/'
          '${parsed.year}';
    } catch (_) {
      return value;
    }
  }

  void showMessage(
    String message, {
    required bool isError,
  }) {
    if (!mounted) {
      return;
    }

    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(
        SnackBar(
          content: Text(message),
          behavior: SnackBarBehavior.floating,
          backgroundColor: isError ? const Color(0xFFDC2626) : primaryGreen,
        ),
      );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF7F8FA),
      appBar: AppBar(
        title: const Text(
          'Exam PIN',
          style: TextStyle(
            fontWeight: FontWeight.w900,
          ),
        ),
        actions: [
          IconButton(
            tooltip: 'Refresh',
            onPressed: isBuying ? null : loadInitialData,
            icon: const Icon(
              Icons.refresh_rounded,
            ),
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: loadInitialData,
        child: Form(
          key: formKey,
          child: ListView(
            padding: const EdgeInsets.all(18),
            children: [
              Container(
                padding: const EdgeInsets.all(20),
                decoration: BoxDecoration(
                  gradient: const LinearGradient(
                    begin: Alignment.topLeft,
                    end: Alignment.bottomRight,
                    colors: [
                      Color(0xFF149B8F),
                      Color(0xFF0D756C),
                    ],
                  ),
                  borderRadius: BorderRadius.circular(24),
                ),
                child: const Row(
                  children: [
                    CircleAvatar(
                      radius: 31,
                      backgroundColor: Colors.white24,
                      child: Icon(
                        Icons.school_rounded,
                        color: Colors.white,
                        size: 35,
                      ),
                    ),
                    SizedBox(width: 15),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'Buy Exam PIN Instantly',
                            style: TextStyle(
                              color: Colors.white,
                              fontSize: 20,
                              fontWeight: FontWeight.w900,
                            ),
                          ),
                          SizedBox(height: 5),
                          Text(
                            'Purchase WAEC Result Checker and Registration PIN securely from your wallet.',
                            style: TextStyle(
                              color: Colors.white,
                              height: 1.4,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 24),
              const Text(
                'Select Product',
                style: TextStyle(
                  fontSize: 19,
                  fontWeight: FontWeight.w900,
                ),
              ),
              const SizedBox(height: 5),
              const Text(
                'Prices are retrieved directly from the provider.',
                style: TextStyle(
                  color: Color(0xFF6B7280),
                ),
              ),
              const SizedBox(height: 14),
              buildProductSelector(),
              const SizedBox(height: 22),
              TextFormField(
                controller: phoneController,
                enabled: !isBuying,
                keyboardType: TextInputType.phone,
                validator: validatePhone,
                inputFormatters: [
                  FilteringTextInputFormatter.digitsOnly,
                  LengthLimitingTextInputFormatter(13),
                ],
                decoration: InputDecoration(
                  labelText: 'Recipient Phone Number',
                  hintText: '08012345678',
                  prefixIcon: const Icon(
                    Icons.phone_android_rounded,
                  ),
                  filled: true,
                  fillColor: Colors.white,
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(16),
                  ),
                ),
              ),
              const SizedBox(height: 14),
              TextFormField(
                controller: quantityController,
                enabled: !isBuying,
                keyboardType: TextInputType.number,
                validator: validateQuantity,
                inputFormatters: [
                  FilteringTextInputFormatter.digitsOnly,
                  LengthLimitingTextInputFormatter(1),
                ],
                onChanged: (_) {
                  setState(() {});
                },
                decoration: InputDecoration(
                  labelText: 'Quantity',
                  hintText: '1 to 5',
                  prefixIcon: const Icon(
                    Icons.numbers_rounded,
                  ),
                  helperText: 'You can purchase up to 5 PINs at once.',
                  filled: true,
                  fillColor: Colors.white,
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(16),
                  ),
                ),
              ),
              const SizedBox(height: 18),
              Container(
                padding: const EdgeInsets.all(17),
                decoration: BoxDecoration(
                  color: const Color(0xFFEAF9F4),
                  borderRadius: BorderRadius.circular(18),
                  border: Border.all(
                    color: const Color(0xFFBCE5D9),
                  ),
                ),
                child: Row(
                  children: [
                    const Expanded(
                      child: Text(
                        'Total Amount',
                        style: TextStyle(
                          color: Color(0xFF4B635A),
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ),
                    Text(
                      formatMoney(totalAmount),
                      style: const TextStyle(
                        color: primaryGreen,
                        fontSize: 21,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 18),
              SizedBox(
                height: 58,
                child: FilledButton.icon(
                  onPressed: isBuying || isLoadingProducts || products.isEmpty
                      ? null
                      : buyExamPin,
                  style: FilledButton.styleFrom(
                    backgroundColor: primaryGreen,
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(17),
                    ),
                  ),
                  icon: isBuying
                      ? const SizedBox(
                          width: 22,
                          height: 22,
                          child: CircularProgressIndicator(
                            strokeWidth: 2.5,
                            color: Colors.white,
                          ),
                        )
                      : const Icon(
                          Icons.shopping_cart_checkout_rounded,
                        ),
                  label: Text(
                    isBuying ? 'Processing...' : 'Buy Exam PIN',
                    style: const TextStyle(
                      fontSize: 17,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                ),
              ),
              const SizedBox(height: 28),
              const Text(
                'Recent Purchases',
                style: TextStyle(
                  fontSize: 19,
                  fontWeight: FontWeight.w900,
                ),
              ),
              const SizedBox(height: 5),
              const Text(
                'Tap a purchase to view, copy or share the PIN.',
                style: TextStyle(
                  color: Color(0xFF6B7280),
                ),
              ),
              const SizedBox(height: 14),
              buildHistorySection(),
            ],
          ),
        ),
      ),
    );
  }
}

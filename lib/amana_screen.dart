import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

class AmanaScreen extends StatefulWidget {
  const AmanaScreen({super.key});

  @override
  State<AmanaScreen> createState() => _AmanaScreenState();
}

class _AmanaScreenState extends State<AmanaScreen> {
  static const String baseUrl = 'https://api.servicepay.ng/api';

  static const Color primaryGreen = Color(0xFF149B8F);

  static const Color darkGreen = Color(0xFF08766D);

  static const Color backgroundColor = Color(0xFFF5F8F8);

  final GlobalKey<FormState> _formKey = GlobalKey<FormState>();

  final TextEditingController _titleController = TextEditingController();

  final TextEditingController _descriptionController = TextEditingController();

  final TextEditingController _amountController = TextEditingController();

  final TextEditingController _beneficiaryNameController =
      TextEditingController();

  final TextEditingController _beneficiaryPhoneController =
      TextEditingController();

  final TextEditingController _relationshipController = TextEditingController();

  final TextEditingController _stateController = TextEditingController();

  final TextEditingController _lgaController = TextEditingController();

  final TextEditingController _addressController = TextEditingController();

  final TextEditingController _landmarkController = TextEditingController();

  final TextEditingController _providerNameController = TextEditingController();

  final TextEditingController _providerPhoneController =
      TextEditingController();

  final TextEditingController _additionalInfoController =
      TextEditingController();

  bool _isLoading = true;
  bool _isSubmitting = false;
  bool _showOrderForm = false;

  String _selectedCategory = 'FOOD_PACKAGE';

  List<Map<String, dynamic>> _orders = [];

  final List<Map<String, dynamic>> _categories = [
    {
      'value': 'FOOD_PACKAGE',
      'title': 'Food Package',
      'subtitle': 'Send verified food support to your family.',
      'icon': Icons.shopping_basket_rounded,
    },
    {
      'value': 'SCHOOL_FEES',
      'title': 'School Fees',
      'subtitle': 'Pay school fees directly and receive proof.',
      'icon': Icons.school_rounded,
    },
    {
      'value': 'MEDICAL_SUPPORT',
      'title': 'Medical Support',
      'subtitle': 'Pay hospital or pharmacy bills securely.',
      'icon': Icons.local_hospital_rounded,
    },
  ];

  @override
  void initState() {
    super.initState();
    _loadMyOrders();
  }

  @override
  void dispose() {
    _titleController.dispose();
    _descriptionController.dispose();
    _amountController.dispose();
    _beneficiaryNameController.dispose();
    _beneficiaryPhoneController.dispose();
    _relationshipController.dispose();
    _stateController.dispose();
    _lgaController.dispose();
    _addressController.dispose();
    _landmarkController.dispose();
    _providerNameController.dispose();
    _providerPhoneController.dispose();
    _additionalInfoController.dispose();

    super.dispose();
  }

  Future<String?> _getToken() async {
    final SharedPreferences prefs = await SharedPreferences.getInstance();

    const List<String> tokenKeys = [
      'auth_token',
      'token',
      'access_token',
      'accessToken',
      'jwt_token',
      'jwt',
    ];

    for (final String key in tokenKeys) {
      final String? token = prefs.getString(key);

      if (token != null && token.trim().isNotEmpty) {
        if (key != 'auth_token') {
          await prefs.setString(
            'auth_token',
            token.trim(),
          );
        }

        return token.trim();
      }
    }

    return null;
  }

  Map<String, String> _headers(
    String token,
  ) {
    return {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Authorization': 'Bearer $token',
    };
  }

  Future<void> _handleUnauthorized() async {
    final SharedPreferences prefs = await SharedPreferences.getInstance();

    await prefs.remove('auth_token');
    await prefs.remove('token');
    await prefs.remove('access_token');
    await prefs.remove('accessToken');
    await prefs.remove('jwt_token');
    await prefs.remove('jwt');
  }

  String _extractMessage(
    dynamic decoded, {
    String fallback = 'Something went wrong. Please try again.',
  }) {
    if (decoded is Map) {
      final dynamic message = decoded['message'];

      if (message != null && message.toString().trim().isNotEmpty) {
        return message.toString().trim();
      }

      final dynamic error = decoded['error'];

      if (error != null && error.toString().trim().isNotEmpty) {
        return error.toString().trim();
      }
    }

    return fallback;
  }

  List<Map<String, dynamic>> _extractOrders(dynamic decoded) {
    dynamic rawOrders;

    if (decoded is Map) {
      final dynamic data = decoded['data'];

      if (data is Map) {
        rawOrders = data['orders'];
      }

      rawOrders ??= decoded['orders'];
    }

    if (rawOrders is! List) {
      return [];
    }

    return rawOrders
        .whereType<Map>()
        .map(
          (Map item) => Map<String, dynamic>.from(
            item,
          ),
        )
        .toList();
  }

  Future<void> _loadMyOrders({
    bool showLoader = true,
  }) async {
    if (showLoader && mounted) {
      setState(() {
        _isLoading = true;
      });
    }

    try {
      final String? token = await _getToken();

      if (token == null) {
        if (!mounted) {
          return;
        }

        setState(() {
          _orders = [];
          _isLoading = false;
        });

        _showMessage(
          'Your login session has expired. Please log in again.',
          isError: true,
        );

        return;
      }

      final http.Response response = await http
          .get(
            Uri.parse(
              '$baseUrl/amana?page=1&limit=30',
            ),
            headers: _headers(token),
          )
          .timeout(
            const Duration(
              seconds: 45,
            ),
          );

      dynamic decoded;

      try {
        decoded = jsonDecode(response.body);
      } catch (_) {
        decoded = {};
      }

      if (response.statusCode == 401) {
        await _handleUnauthorized();

        if (!mounted) {
          return;
        }

        setState(() {
          _orders = [];
          _isLoading = false;
        });

        _showMessage(
          'Your login session has expired. Please log in again.',
          isError: true,
        );

        return;
      }

      if (response.statusCode >= 200 && response.statusCode < 300) {
        final List<Map<String, dynamic>> loadedOrders = _extractOrders(decoded);

        if (!mounted) {
          return;
        }

        setState(() {
          _orders = loadedOrders;
          _isLoading = false;
        });

        return;
      }

      if (!mounted) {
        return;
      }

      setState(() {
        _isLoading = false;
      });

      _showMessage(
        _extractMessage(
          decoded,
          fallback: 'Unable to load your Amana orders.',
        ),
        isError: true,
      );
    } catch (error) {
      if (!mounted) {
        return;
      }

      setState(() {
        _isLoading = false;
      });

      _showMessage(
        'Unable to connect to ServicePay. Please check your internet connection.',
        isError: true,
      );
    }
  }

  void _selectCategory(
    String category,
  ) {
    final Map<String, dynamic> selected = _categories.firstWhere(
      (Map<String, dynamic> item) => item['value'] == category,
    );

    setState(() {
      _selectedCategory = category;
      _showOrderForm = true;

      _titleController.text = selected['title'].toString();
    });
  }

  void _clearForm() {
    _formKey.currentState?.reset();

    _titleController.clear();
    _descriptionController.clear();
    _amountController.clear();
    _beneficiaryNameController.clear();
    _beneficiaryPhoneController.clear();
    _relationshipController.clear();
    _stateController.clear();
    _lgaController.clear();
    _addressController.clear();
    _landmarkController.clear();
    _providerNameController.clear();
    _providerPhoneController.clear();
    _additionalInfoController.clear();

    setState(() {
      _selectedCategory = 'FOOD_PACKAGE';
      _showOrderForm = false;
    });
  }

  String _cleanPhone(String value) {
    String phone = value.trim().replaceAll(' ', '').replaceAll('-', '');

    if (phone.startsWith('+234')) {
      phone = '0${phone.substring(4)}';
    } else if (phone.startsWith('234') && phone.length == 13) {
      phone = '0${phone.substring(3)}';
    }

    return phone;
  }

  double? _parseAmount(
    String value,
  ) {
    final String cleaned = value.replaceAll(',', '').replaceAll('₦', '').trim();

    return double.tryParse(cleaned);
  }

  String? _requiredValidator(
    String? value,
    String fieldName,
  ) {
    if (value == null || value.trim().isEmpty) {
      return '$fieldName is required.';
    }

    return null;
  }

  String? _phoneValidator(
    String? value,
  ) {
    final String phone = _cleanPhone(value ?? '');

    if (phone.isEmpty) {
      return 'Phone number is required.';
    }

    if (!RegExp(
      r'^0[789][01]\d{8}$',
    ).hasMatch(phone)) {
      return 'Enter a valid Nigerian phone number.';
    }

    return null;
  }

  String? _amountValidator(
    String? value,
  ) {
    final double? amount = _parseAmount(value ?? '');

    if (amount == null) {
      return 'Enter a valid amount.';
    }

    if (amount < 100) {
      return 'Minimum amount is ₦100.';
    }

    return null;
  }

  void _showMessage(
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
          backgroundColor: isError ? Colors.red.shade700 : primaryGreen,
          behavior: SnackBarBehavior.floating,
        ),
      );
  }

  Future<void> _submitOrder() async {
    if (_isSubmitting) {
      return;
    }

    final FormState? form = _formKey.currentState;

    if (form == null || !form.validate()) {
      return;
    }

    final double? amount = _parseAmount(
      _amountController.text,
    );

    if (amount == null) {
      _showMessage(
        'Please enter a valid amount.',
        isError: true,
      );

      return;
    }

    FocusScope.of(context).unfocus();

    setState(() {
      _isSubmitting = true;
    });

    try {
      final String? token = await _getToken();

      if (token == null) {
        if (!mounted) {
          return;
        }

        setState(() {
          _isSubmitting = false;
        });

        _showMessage(
          'Your login session has expired. Please log in again.',
          isError: true,
        );

        return;
      }

      final Map<String, dynamic> requestBody = {
        'category': _selectedCategory,
        'title': _titleController.text.trim(),
        'description': _descriptionController.text.trim(),
        'amount': amount,
        'beneficiary': {
          'fullName': _beneficiaryNameController.text.trim(),
          'phone': _cleanPhone(
            _beneficiaryPhoneController.text,
          ),
          'relationship': _relationshipController.text.trim(),
          'state': _stateController.text.trim(),
          'lga': _lgaController.text.trim(),
          'address': _addressController.text.trim(),
          'landmark': _landmarkController.text.trim(),
        },
        'providerDetails': {
          'name': _providerNameController.text.trim(),
          'phone': _cleanPhone(
            _providerPhoneController.text,
          ),
          'additionalInformation': _additionalInfoController.text.trim(),
        },
      };

      final http.Response response = await http
          .post(
            Uri.parse(
              '$baseUrl/amana',
            ),
            headers: _headers(token),
            body: jsonEncode(
              requestBody,
            ),
          )
          .timeout(
            const Duration(
              seconds: 60,
            ),
          );

      dynamic decoded;

      try {
        decoded = jsonDecode(response.body);
      } catch (_) {
        decoded = {};
      }

      if (response.statusCode == 401) {
        await _handleUnauthorized();

        if (!mounted) {
          return;
        }

        setState(() {
          _isSubmitting = false;
        });

        _showMessage(
          'Your login session has expired. Please log in again.',
          isError: true,
        );

        return;
      }

      if (response.statusCode >= 200 && response.statusCode < 300) {
        Map<String, dynamic>? createdOrder;

        if (decoded is Map) {
          final dynamic data = decoded['data'];

          if (data is Map && data['order'] is Map) {
            createdOrder = Map<String, dynamic>.from(
              data['order'],
            );
          }
        }

        if (!mounted) {
          return;
        }

        setState(() {
          _isSubmitting = false;
        });

        _showMessage(
          _extractMessage(
            decoded,
            fallback: 'ServicePay Amana request created successfully.',
          ),
        );

        _clearForm();

        await _loadMyOrders(
          showLoader: false,
        );

        if (createdOrder != null && mounted) {
          await _showPaymentDialog(
            createdOrder,
          );
        }

        return;
      }

      if (!mounted) {
        return;
      }

      setState(() {
        _isSubmitting = false;
      });

      _showMessage(
        _extractMessage(
          decoded,
          fallback: 'Unable to create the ServicePay Amana request.',
        ),
        isError: true,
      );
    } catch (error) {
      if (!mounted) {
        return;
      }

      setState(() {
        _isSubmitting = false;
      });

      _showMessage(
        'Unable to connect to ServicePay. Please check your internet connection.',
        isError: true,
      );
    }
  }

  Future<void> _showPaymentDialog(
    Map<String, dynamic> order,
  ) async {
    final String orderId = order['_id']?.toString() ?? '';

    if (orderId.isEmpty) {
      return;
    }

    final TextEditingController pinController = TextEditingController();

    bool isPaying = false;

    await showDialog<void>(
      context: context,
      barrierDismissible: false,
      builder: (
        BuildContext dialogContext,
      ) {
        return StatefulBuilder(
          builder: (
            BuildContext context,
            StateSetter setDialogState,
          ) {
            final double amount = _toDouble(
              order['totalAmount'] ?? order['amount'],
            );

            return AlertDialog(
              title: const Text(
                'Pay with ServicePay Wallet',
              ),
              content: SingleChildScrollView(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Text(
                      'Amount: ${_formatCurrency(amount)}',
                      style: const TextStyle(
                        fontSize: 18,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    const SizedBox(
                      height: 8,
                    ),
                    Text(
                      order['reference']?.toString() ?? '',
                      style: TextStyle(
                        color: Colors.grey.shade700,
                      ),
                    ),
                    const SizedBox(
                      height: 18,
                    ),
                    TextField(
                      controller: pinController,
                      keyboardType: TextInputType.number,
                      obscureText: true,
                      maxLength: 4,
                      enabled: !isPaying,
                      decoration: const InputDecoration(
                        labelText: 'Transaction PIN',
                        hintText: 'Enter 4-digit PIN',
                        border: OutlineInputBorder(),
                        counterText: '',
                        prefixIcon: Icon(
                          Icons.lock_rounded,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
              actions: [
                TextButton(
                  onPressed: isPaying
                      ? null
                      : () {
                          Navigator.of(
                            dialogContext,
                          ).pop();
                        },
                  child: const Text(
                    'Pay Later',
                  ),
                ),
                FilledButton(
                  onPressed: isPaying
                      ? null
                      : () async {
                          final String pin = pinController.text.trim();

                          if (!RegExp(
                            r'^\d{4}$',
                          ).hasMatch(pin)) {
                            _showMessage(
                              'Please enter your 4-digit transaction PIN.',
                              isError: true,
                            );

                            return;
                          }

                          setDialogState(() {
                            isPaying = true;
                          });

                          final bool paid = await _payOrder(
                            orderId,
                            pin,
                          );

                          if (!dialogContext.mounted) {
                            return;
                          }

                          if (paid) {
                            Navigator.of(
                              dialogContext,
                            ).pop();
                          } else {
                            setDialogState(() {
                              isPaying = false;
                            });
                          }
                        },
                  child: isPaying
                      ? const SizedBox(
                          width: 20,
                          height: 20,
                          child: CircularProgressIndicator(
                            strokeWidth: 2,
                          ),
                        )
                      : const Text(
                          'Pay Now',
                        ),
                ),
              ],
            );
          },
        );
      },
    );

    pinController.dispose();
  }

  Future<bool> _payOrder(
    String orderId,
    String transactionPin,
  ) async {
    try {
      final String? token = await _getToken();

      if (token == null) {
        _showMessage(
          'Your login session has expired. Please log in again.',
          isError: true,
        );

        return false;
      }

      final http.Response response = await http
          .post(
            Uri.parse(
              '$baseUrl/amana/$orderId/pay',
            ),
            headers: _headers(token),
            body: jsonEncode({
              'transactionPin': transactionPin,
            }),
          )
          .timeout(
            const Duration(
              seconds: 60,
            ),
          );

      dynamic decoded;

      try {
        decoded = jsonDecode(response.body);
      } catch (_) {
        decoded = {};
      }

      if (response.statusCode == 401) {
        await _handleUnauthorized();

        _showMessage(
          'Your login session has expired. Please log in again.',
          isError: true,
        );

        return false;
      }

      if (response.statusCode >= 200 && response.statusCode < 300) {
        _showMessage(
          _extractMessage(
            decoded,
            fallback: 'ServicePay Amana payment completed successfully.',
          ),
        );

        await _loadMyOrders(
          showLoader: false,
        );

        return true;
      }

      _showMessage(
        _extractMessage(
          decoded,
          fallback: 'Unable to complete the Amana payment.',
        ),
        isError: true,
      );

      return false;
    } catch (error) {
      _showMessage(
        'Unable to connect to ServicePay. Please check your internet connection.',
        isError: true,
      );

      return false;
    }
  }

  Future<void> _cancelOrder(
    Map<String, dynamic> order,
  ) async {
    final String orderId = order['_id']?.toString() ?? '';

    if (orderId.isEmpty) {
      return;
    }

    final TextEditingController reasonController = TextEditingController();

    final bool? confirmed = await showDialog<bool>(
      context: context,
      builder: (
        BuildContext dialogContext,
      ) {
        return AlertDialog(
          title: const Text(
            'Cancel Amana Request',
          ),
          content: TextField(
            controller: reasonController,
            minLines: 2,
            maxLines: 4,
            decoration: const InputDecoration(
              labelText: 'Cancellation reason',
              hintText: 'Tell us why you want to cancel this request.',
              border: OutlineInputBorder(),
            ),
          ),
          actions: [
            TextButton(
              onPressed: () {
                Navigator.of(
                  dialogContext,
                ).pop(false);
              },
              child: const Text(
                'Keep Request',
              ),
            ),
            FilledButton(
              onPressed: () {
                if (reasonController.text.trim().length < 3) {
                  _showMessage(
                    'Please provide a cancellation reason.',
                    isError: true,
                  );

                  return;
                }

                Navigator.of(
                  dialogContext,
                ).pop(true);
              },
              child: const Text(
                'Cancel Request',
              ),
            ),
          ],
        );
      },
    );

    if (confirmed != true) {
      reasonController.dispose();
      return;
    }

    final String reason = reasonController.text.trim();

    reasonController.dispose();

    try {
      final String? token = await _getToken();

      if (token == null) {
        _showMessage(
          'Your login session has expired. Please log in again.',
          isError: true,
        );

        return;
      }

      final http.Response response = await http
          .patch(
            Uri.parse(
              '$baseUrl/amana/$orderId/cancel',
            ),
            headers: _headers(token),
            body: jsonEncode({
              'cancellationReason': reason,
            }),
          )
          .timeout(
            const Duration(
              seconds: 45,
            ),
          );

      dynamic decoded;

      try {
        decoded = jsonDecode(response.body);
      } catch (_) {
        decoded = {};
      }

      if (response.statusCode == 401) {
        await _handleUnauthorized();

        _showMessage(
          'Your login session has expired. Please log in again.',
          isError: true,
        );

        return;
      }

      if (response.statusCode >= 200 && response.statusCode < 300) {
        _showMessage(
          _extractMessage(
            decoded,
            fallback: 'Amana request cancelled successfully.',
          ),
        );

        await _loadMyOrders(
          showLoader: false,
        );

        return;
      }

      _showMessage(
        _extractMessage(
          decoded,
          fallback: 'Unable to cancel the Amana request.',
        ),
        isError: true,
      );
    } catch (error) {
      _showMessage(
        'Unable to connect to ServicePay. Please check your internet connection.',
        isError: true,
      );
    }
  }

  double _toDouble(dynamic value) {
    if (value is num) {
      return value.toDouble();
    }

    return double.tryParse(
          value?.toString() ?? '',
        ) ??
        0;
  }

  String _formatCurrency(
    double amount,
  ) {
    final String value = amount.toStringAsFixed(2);

    final List<String> parts = value.split('.');

    final String whole = parts[0];
    final String decimal = parts.length > 1 ? parts[1] : '00';

    final String formattedWhole = whole.replaceAllMapped(
      RegExp(
        r'\B(?=(\d{3})+(?!\d))',
      ),
      (Match match) => ',',
    );

    return '₦$formattedWhole.$decimal';
  }

  String _formatDate(dynamic value) {
    if (value == null) {
      return '';
    }

    final DateTime? date = DateTime.tryParse(
      value.toString(),
    )?.toLocal();

    if (date == null) {
      return '';
    }

    const List<String> months = [
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec',
    ];

    return '${date.day} ${months[date.month - 1]} ${date.year}';
  }

  String _categoryTitle(
    String category,
  ) {
    for (final Map<String, dynamic> item in _categories) {
      if (item['value'] == category) {
        return item['title'].toString();
      }
    }

    return category
        .replaceAll('_', ' ')
        .toLowerCase()
        .split(' ')
        .map(
          (String word) => word.isEmpty
              ? word
              : '${word[0].toUpperCase()}${word.substring(1)}',
        )
        .join(' ');
  }

  IconData _categoryIcon(
    String category,
  ) {
    for (final Map<String, dynamic> item in _categories) {
      if (item['value'] == category) {
        return item['icon'] as IconData;
      }
    }

    return Icons.volunteer_activism_rounded;
  }

  Color _statusColor(
    String status,
  ) {
    switch (status) {
      case 'PAID':
      case 'COMPLETED':
      case 'FULFILLED':
        return Colors.green.shade700;

      case 'PROCESSING':
      case 'ASSIGNED':
        return Colors.blue.shade700;

      case 'CANCELLED':
      case 'REFUNDED':
        return Colors.red.shade700;

      case 'PENDING_PAYMENT':
      default:
        return Colors.orange.shade800;
    }
  }

  String _statusTitle(
    String status,
  ) {
    return status
        .replaceAll('_', ' ')
        .toLowerCase()
        .split(' ')
        .map(
          (String word) => word.isEmpty
              ? word
              : '${word[0].toUpperCase()}${word.substring(1)}',
        )
        .join(' ');
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: backgroundColor,
      appBar: AppBar(
        title: const Text(
          'ServicePay Amana',
        ),
        backgroundColor: Colors.white,
        foregroundColor: Colors.black87,
        elevation: 0,
        actions: [
          IconButton(
            onPressed: _isLoading
                ? null
                : () {
                    _loadMyOrders();
                  },
            tooltip: 'Refresh',
            icon: const Icon(
              Icons.refresh_rounded,
            ),
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: () {
          return _loadMyOrders(
            showLoader: false,
          );
        },
        child: ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.fromLTRB(
            16,
            12,
            16,
            32,
          ),
          children: [
            _buildHeroCard(),
            const SizedBox(
              height: 24,
            ),
            _buildSectionHeader(
              title: 'Choose a Service',
              subtitle: 'Select how you want to support your family.',
            ),
            const SizedBox(
              height: 12,
            ),
            _buildCategoryGrid(),
            if (_showOrderForm) ...[
              const SizedBox(
                height: 24,
              ),
              _buildOrderForm(),
            ],
            const SizedBox(
              height: 28,
            ),
            _buildSectionHeader(
              title: 'My Amana Requests',
              subtitle: 'Track your support requests and payments.',
            ),
            const SizedBox(
              height: 12,
            ),
            _buildOrdersSection(),
          ],
        ),
      ),
    );
  }

  Widget _buildHeroCard() {
    return Container(
      padding: const EdgeInsets.all(
        20,
      ),
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          colors: [
            primaryGreen,
            darkGreen,
          ],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        borderRadius: BorderRadius.circular(24),
        boxShadow: [
          BoxShadow(
            color: primaryGreen.withValues(
              alpha: 0.20,
            ),
            blurRadius: 20,
            offset: const Offset(
              0,
              10,
            ),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 52,
            height: 52,
            decoration: BoxDecoration(
              color: Colors.white.withValues(
                alpha: 0.18,
              ),
              borderRadius: BorderRadius.circular(16),
            ),
            child: const Icon(
              Icons.volunteer_activism_rounded,
              color: Colors.white,
              size: 30,
            ),
          ),
          const SizedBox(
            height: 18,
          ),
          const Text(
            'Support with Confidence',
            style: TextStyle(
              color: Colors.white,
              fontSize: 23,
              fontWeight: FontWeight.w800,
            ),
          ),
          const SizedBox(
            height: 8,
          ),
          Text(
            'Pay for food, school fees or medical needs and receive verified proof of fulfilment.',
            style: TextStyle(
              color: Colors.white.withValues(
                alpha: 0.88,
              ),
              fontSize: 14,
              height: 1.5,
            ),
          ),
          const SizedBox(
            height: 18,
          ),
          Container(
            padding: const EdgeInsets.symmetric(
              horizontal: 12,
              vertical: 9,
            ),
            decoration: BoxDecoration(
              color: Colors.white.withValues(
                alpha: 0.14,
              ),
              borderRadius: BorderRadius.circular(12),
            ),
            child: const Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(
                  Icons.verified_user_rounded,
                  color: Colors.white,
                  size: 18,
                ),
                SizedBox(
                  width: 8,
                ),
                Text(
                  'Verified • Secure • Transparent',
                  style: TextStyle(
                    color: Colors.white,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildSectionHeader({
    required String title,
    required String subtitle,
  }) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          title,
          style: const TextStyle(
            fontSize: 19,
            fontWeight: FontWeight.w800,
            color: Color(0xFF162828),
          ),
        ),
        const SizedBox(
          height: 4,
        ),
        Text(
          subtitle,
          style: TextStyle(
            color: Colors.grey.shade700,
            height: 1.4,
          ),
        ),
      ],
    );
  }

  Widget _buildCategoryGrid() {
    return LayoutBuilder(
      builder: (
        BuildContext context,
        BoxConstraints constraints,
      ) {
        final bool compact = constraints.maxWidth < 500;

        if (compact) {
          return Column(
            children: _categories.map(
              (
                Map<String, dynamic> category,
              ) {
                return Padding(
                  padding: const EdgeInsets.only(
                    bottom: 12,
                  ),
                  child: _buildCategoryCard(
                    category,
                  ),
                );
              },
            ).toList(),
          );
        }

        return GridView.builder(
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          itemCount: _categories.length,
          gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
            crossAxisCount: 3,
            crossAxisSpacing: 14,
            mainAxisSpacing: 14,
            childAspectRatio: 1.12,
          ),
          itemBuilder: (
            BuildContext context,
            int index,
          ) {
            return _buildCategoryCard(
              _categories[index],
            );
          },
        );
      },
    );
  }

  Widget _buildCategoryCard(
    Map<String, dynamic> category,
  ) {
    final String value = category['value'].toString();

    final bool selected = _selectedCategory == value && _showOrderForm;

    return InkWell(
      onTap: () {
        _selectCategory(value);
      },
      borderRadius: BorderRadius.circular(18),
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 220),
        padding: const EdgeInsets.all(
          16,
        ),
        decoration: BoxDecoration(
          color: selected
              ? primaryGreen.withValues(
                  alpha: 0.08,
                )
              : Colors.white,
          borderRadius: BorderRadius.circular(18),
          border: Border.all(
            color: selected ? primaryGreen : const Color(0xFFE4ECEB),
            width: selected ? 1.5 : 1,
          ),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withValues(
                alpha: 0.035,
              ),
              blurRadius: 12,
              offset: const Offset(
                0,
                5,
              ),
            ),
          ],
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              width: 48,
              height: 48,
              decoration: BoxDecoration(
                color: primaryGreen.withValues(
                  alpha: 0.11,
                ),
                borderRadius: BorderRadius.circular(14),
              ),
              child: Icon(
                category['icon'] as IconData,
                color: primaryGreen,
              ),
            ),
            const SizedBox(
              width: 14,
            ),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    category['title'].toString(),
                    style: const TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                  const SizedBox(
                    height: 5,
                  ),
                  Text(
                    category['subtitle'].toString(),
                    style: TextStyle(
                      color: Colors.grey.shade700,
                      fontSize: 13,
                      height: 1.35,
                    ),
                  ),
                ],
              ),
            ),
            if (selected)
              const Icon(
                Icons.check_circle_rounded,
                color: primaryGreen,
              ),
          ],
        ),
      ),
    );
  }

  Widget _buildOrderForm() {
    return Container(
      padding: const EdgeInsets.all(
        18,
      ),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(22),
        border: Border.all(
          color: const Color(0xFFE2EBEA),
        ),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(
              alpha: 0.04,
            ),
            blurRadius: 16,
            offset: const Offset(
              0,
              7,
            ),
          ),
        ],
      ),
      child: Form(
        key: _formKey,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Container(
                  width: 44,
                  height: 44,
                  decoration: BoxDecoration(
                    color: primaryGreen.withValues(
                      alpha: 0.10,
                    ),
                    borderRadius: BorderRadius.circular(
                      13,
                    ),
                  ),
                  child: Icon(
                    _categoryIcon(
                      _selectedCategory,
                    ),
                    color: primaryGreen,
                  ),
                ),
                const SizedBox(
                  width: 12,
                ),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text(
                        'Create Amana Request',
                        style: TextStyle(
                          fontSize: 18,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                      Text(
                        _categoryTitle(
                          _selectedCategory,
                        ),
                        style: const TextStyle(
                          color: primaryGreen,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ],
                  ),
                ),
                IconButton(
                  onPressed: _isSubmitting ? null : _clearForm,
                  tooltip: 'Close form',
                  icon: const Icon(
                    Icons.close_rounded,
                  ),
                ),
              ],
            ),
            const SizedBox(
              height: 20,
            ),
            _buildSubheading(
              'Request Information',
            ),
            const SizedBox(
              height: 12,
            ),
            TextFormField(
              controller: _titleController,
              enabled: !_isSubmitting,
              validator: (String? value) {
                final String? error = _requiredValidator(
                  value,
                  'Request title',
                );

                if (error != null) {
                  return error;
                }

                if (value!.trim().length < 3) {
                  return 'Request title is too short.';
                }

                return null;
              },
              decoration: _inputDecoration(
                label: 'Request Title',
                hint: 'Example: Monthly family food package',
                icon: Icons.title_rounded,
              ),
            ),
            const SizedBox(
              height: 14,
            ),
            TextFormField(
              controller: _descriptionController,
              enabled: !_isSubmitting,
              minLines: 3,
              maxLines: 6,
              validator: (String? value) {
                final String? error = _requiredValidator(
                  value,
                  'Description',
                );

                if (error != null) {
                  return error;
                }

                if (value!.trim().length < 10) {
                  return 'Please provide more information about the request.';
                }

                return null;
              },
              decoration: _inputDecoration(
                label: 'Description',
                hint: 'Describe exactly what should be paid for or delivered.',
                icon: Icons.description_rounded,
              ),
            ),
            const SizedBox(
              height: 14,
            ),
            TextFormField(
              controller: _amountController,
              enabled: !_isSubmitting,
              keyboardType: const TextInputType.numberWithOptions(
                decimal: true,
              ),
              validator: _amountValidator,
              decoration: _inputDecoration(
                label: 'Amount',
                hint: 'Example: 50000',
                icon: Icons.payments_rounded,
                prefixText: '₦ ',
              ),
            ),
            const SizedBox(
              height: 22,
            ),
            _buildSubheading(
              'Beneficiary Information',
            ),
            const SizedBox(
              height: 12,
            ),
            TextFormField(
              controller: _beneficiaryNameController,
              enabled: !_isSubmitting,
              textCapitalization: TextCapitalization.words,
              validator: (String? value) {
                final String? error = _requiredValidator(
                  value,
                  'Beneficiary name',
                );

                if (error != null) {
                  return error;
                }

                if (value!.trim().length < 3) {
                  return 'Enter the beneficiary full name.';
                }

                return null;
              },
              decoration: _inputDecoration(
                label: 'Beneficiary Full Name',
                hint: 'Name of the person receiving support',
                icon: Icons.person_rounded,
              ),
            ),
            const SizedBox(
              height: 14,
            ),
            TextFormField(
              controller: _beneficiaryPhoneController,
              enabled: !_isSubmitting,
              keyboardType: TextInputType.phone,
              validator: _phoneValidator,
              decoration: _inputDecoration(
                label: 'Beneficiary Phone',
                hint: '08012345678',
                icon: Icons.phone_rounded,
              ),
            ),
            const SizedBox(
              height: 14,
            ),
            TextFormField(
              controller: _relationshipController,
              enabled: !_isSubmitting,
              textCapitalization: TextCapitalization.words,
              decoration: _inputDecoration(
                label: 'Relationship (Optional)',
                hint: 'Example: Mother, Father or Sister',
                icon: Icons.family_restroom_rounded,
              ),
            ),
            const SizedBox(
              height: 14,
            ),
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: TextFormField(
                    controller: _stateController,
                    enabled: !_isSubmitting,
                    textCapitalization: TextCapitalization.words,
                    validator: (String? value) {
                      return _requiredValidator(
                        value,
                        'State',
                      );
                    },
                    decoration: _inputDecoration(
                      label: 'State',
                      hint: 'Kano',
                      icon: Icons.map_rounded,
                    ),
                  ),
                ),
                const SizedBox(
                  width: 12,
                ),
                Expanded(
                  child: TextFormField(
                    controller: _lgaController,
                    enabled: !_isSubmitting,
                    textCapitalization: TextCapitalization.words,
                    validator: (String? value) {
                      return _requiredValidator(
                        value,
                        'LGA',
                      );
                    },
                    decoration: _inputDecoration(
                      label: 'LGA',
                      hint: 'Nassarawa',
                      icon: Icons.location_city_rounded,
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(
              height: 14,
            ),
            TextFormField(
              controller: _addressController,
              enabled: !_isSubmitting,
              textCapitalization: TextCapitalization.sentences,
              minLines: 2,
              maxLines: 4,
              validator: (String? value) {
                final String? error = _requiredValidator(
                  value,
                  'Address',
                );

                if (error != null) {
                  return error;
                }

                if (value!.trim().length < 5) {
                  return 'Enter a complete beneficiary address.';
                }

                return null;
              },
              decoration: _inputDecoration(
                label: 'Beneficiary Address',
                hint: 'House number, street and area',
                icon: Icons.home_rounded,
              ),
            ),
            const SizedBox(
              height: 14,
            ),
            TextFormField(
              controller: _landmarkController,
              enabled: !_isSubmitting,
              textCapitalization: TextCapitalization.sentences,
              decoration: _inputDecoration(
                label: 'Landmark (Optional)',
                hint: 'A nearby known location',
                icon: Icons.place_rounded,
              ),
            ),
            const SizedBox(
              height: 22,
            ),
            _buildSubheading(
              'Provider Information',
            ),
            const SizedBox(
              height: 5,
            ),
            Text(
              'For school fees, enter the school. For medical support, enter the hospital or pharmacy. Food package provider can be left empty.',
              style: TextStyle(
                color: Colors.grey.shade700,
                fontSize: 13,
                height: 1.4,
              ),
            ),
            const SizedBox(
              height: 12,
            ),
            TextFormField(
              controller: _providerNameController,
              enabled: !_isSubmitting,
              textCapitalization: TextCapitalization.words,
              decoration: _inputDecoration(
                label: 'Provider Name (Optional)',
                hint: 'School, hospital, pharmacy or vendor',
                icon: Icons.business_rounded,
              ),
            ),
            const SizedBox(
              height: 14,
            ),
            TextFormField(
              controller: _providerPhoneController,
              enabled: !_isSubmitting,
              keyboardType: TextInputType.phone,
              decoration: _inputDecoration(
                label: 'Provider Phone (Optional)',
                hint: '08012345678',
                icon: Icons.call_rounded,
              ),
            ),
            const SizedBox(
              height: 14,
            ),
            TextFormField(
              controller: _additionalInfoController,
              enabled: !_isSubmitting,
              minLines: 2,
              maxLines: 5,
              decoration: _inputDecoration(
                label: 'Additional Information (Optional)',
                hint:
                    'Student ID, hospital card number or special instructions',
                icon: Icons.info_outline_rounded,
              ),
            ),
            const SizedBox(
              height: 22,
            ),
            SizedBox(
              width: double.infinity,
              height: 52,
              child: FilledButton.icon(
                onPressed: _isSubmitting ? null : _submitOrder,
                style: FilledButton.styleFrom(
                  backgroundColor: primaryGreen,
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(
                      14,
                    ),
                  ),
                ),
                icon: _isSubmitting
                    ? const SizedBox(
                        width: 20,
                        height: 20,
                        child: CircularProgressIndicator(
                          strokeWidth: 2,
                          color: Colors.white,
                        ),
                      )
                    : const Icon(
                        Icons.check_circle_rounded,
                      ),
                label: Text(
                  _isSubmitting
                      ? 'Creating Request...'
                      : 'Create Amana Request',
                  style: const TextStyle(
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildSubheading(
    String title,
  ) {
    return Text(
      title,
      style: const TextStyle(
        fontSize: 15,
        fontWeight: FontWeight.w800,
        color: Color(0xFF263B3A),
      ),
    );
  }

  InputDecoration _inputDecoration({
    required String label,
    required String hint,
    required IconData icon,
    String? prefixText,
  }) {
    return InputDecoration(
      labelText: label,
      hintText: hint,
      prefixText: prefixText,
      prefixIcon: Icon(
        icon,
        color: primaryGreen,
      ),
      filled: true,
      fillColor: const Color(0xFFF8FBFA),
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(14),
        borderSide: const BorderSide(
          color: Color(0xFFDCE7E5),
        ),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(14),
        borderSide: const BorderSide(
          color: Color(0xFFDCE7E5),
        ),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(14),
        borderSide: const BorderSide(
          color: primaryGreen,
          width: 1.5,
        ),
      ),
    );
  }

  Widget _buildOrdersSection() {
    if (_isLoading) {
      return const Padding(
        padding: EdgeInsets.symmetric(
          vertical: 40,
        ),
        child: Center(
          child: CircularProgressIndicator(
            color: primaryGreen,
          ),
        ),
      );
    }

    if (_orders.isEmpty) {
      return Container(
        padding: const EdgeInsets.all(
          28,
        ),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(20),
          border: Border.all(
            color: const Color(0xFFE3ECEB),
          ),
        ),
        child: Column(
          children: [
            Container(
              width: 64,
              height: 64,
              decoration: BoxDecoration(
                color: primaryGreen.withValues(
                  alpha: 0.09,
                ),
                shape: BoxShape.circle,
              ),
              child: const Icon(
                Icons.receipt_long_rounded,
                color: primaryGreen,
                size: 32,
              ),
            ),
            const SizedBox(
              height: 14,
            ),
            const Text(
              'No Amana requests yet',
              style: TextStyle(
                fontSize: 17,
                fontWeight: FontWeight.w800,
              ),
            ),
            const SizedBox(
              height: 6,
            ),
            Text(
              'Select a service above to create your first request.',
              textAlign: TextAlign.center,
              style: TextStyle(
                color: Colors.grey.shade700,
              ),
            ),
          ],
        ),
      );
    }

    return Column(
      children: _orders.map(
        (
          Map<String, dynamic> order,
        ) {
          return Padding(
            padding: const EdgeInsets.only(
              bottom: 12,
            ),
            child: _buildOrderCard(order),
          );
        },
      ).toList(),
    );
  }

  Widget _buildOrderCard(
    Map<String, dynamic> order,
  ) {
    final String status =
        order['status']?.toString().toUpperCase() ?? 'PENDING_PAYMENT';

    final String category = order['category']?.toString() ?? '';

    final double amount = _toDouble(
      order['totalAmount'] ?? order['amount'],
    );

    final dynamic beneficiaryRaw = order['beneficiary'];

    final Map<String, dynamic> beneficiary = beneficiaryRaw is Map
        ? Map<String, dynamic>.from(
            beneficiaryRaw,
          )
        : {};

    final bool canPay = status == 'PENDING_PAYMENT' &&
        order['paymentStatus']?.toString().toUpperCase() != 'PAID';

    final bool canCancel = canPay;

    return Container(
      padding: const EdgeInsets.all(
        16,
      ),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(
          color: const Color(0xFFE2EBEA),
        ),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(
              alpha: 0.035,
            ),
            blurRadius: 12,
            offset: const Offset(
              0,
              5,
            ),
          ),
        ],
      ),
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
                  color: primaryGreen.withValues(
                    alpha: 0.10,
                  ),
                  borderRadius: BorderRadius.circular(
                    14,
                  ),
                ),
                child: Icon(
                  _categoryIcon(category),
                  color: primaryGreen,
                ),
              ),
              const SizedBox(
                width: 12,
              ),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      order['title']?.toString() ??
                          _categoryTitle(
                            category,
                          ),
                      style: const TextStyle(
                        fontSize: 16,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                    const SizedBox(
                      height: 4,
                    ),
                    Text(
                      order['reference']?.toString() ?? '',
                      style: TextStyle(
                        color: Colors.grey.shade600,
                        fontSize: 12,
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
                  color: _statusColor(
                    status,
                  ).withValues(
                    alpha: 0.11,
                  ),
                  borderRadius: BorderRadius.circular(
                    20,
                  ),
                ),
                child: Text(
                  _statusTitle(status),
                  style: TextStyle(
                    color: _statusColor(status),
                    fontSize: 11,
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(
            height: 16,
          ),
          Row(
            children: [
              Expanded(
                child: _buildOrderDetail(
                  icon: Icons.person_rounded,
                  label: 'Beneficiary',
                  value: beneficiary['fullName']?.toString() ?? 'Not available',
                ),
              ),
              const SizedBox(
                width: 12,
              ),
              Expanded(
                child: _buildOrderDetail(
                  icon: Icons.payments_rounded,
                  label: 'Amount',
                  value: _formatCurrency(amount),
                ),
              ),
            ],
          ),
          const SizedBox(
            height: 12,
          ),
          Row(
            children: [
              Expanded(
                child: _buildOrderDetail(
                  icon: Icons.category_rounded,
                  label: 'Service',
                  value: _categoryTitle(
                    category,
                  ),
                ),
              ),
              const SizedBox(
                width: 12,
              ),
              Expanded(
                child: _buildOrderDetail(
                  icon: Icons.calendar_month_rounded,
                  label: 'Created',
                  value: _formatDate(
                    order['createdAt'],
                  ),
                ),
              ),
            ],
          ),
          if (canPay || canCancel) ...[
            const SizedBox(
              height: 16,
            ),
            const Divider(),
            const SizedBox(
              height: 8,
            ),
            Row(
              children: [
                if (canCancel)
                  Expanded(
                    child: OutlinedButton.icon(
                      onPressed: () {
                        _cancelOrder(
                          order,
                        );
                      },
                      icon: const Icon(
                        Icons.close_rounded,
                      ),
                      label: const Text(
                        'Cancel',
                      ),
                      style: OutlinedButton.styleFrom(
                        foregroundColor: Colors.red.shade700,
                        side: BorderSide(
                          color: Colors.red.shade200,
                        ),
                      ),
                    ),
                  ),
                if (canCancel && canPay)
                  const SizedBox(
                    width: 12,
                  ),
                if (canPay)
                  Expanded(
                    child: FilledButton.icon(
                      onPressed: () {
                        _showPaymentDialog(
                          order,
                        );
                      },
                      icon: const Icon(
                        Icons.account_balance_wallet_rounded,
                      ),
                      label: const Text(
                        'Pay Now',
                      ),
                      style: FilledButton.styleFrom(
                        backgroundColor: primaryGreen,
                      ),
                    ),
                  ),
              ],
            ),
          ],
        ],
      ),
    );
  }

  Widget _buildOrderDetail({
    required IconData icon,
    required String label,
    required String value,
  }) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Icon(
          icon,
          size: 18,
          color: primaryGreen,
        ),
        const SizedBox(
          width: 7,
        ),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                label,
                style: TextStyle(
                  color: Colors.grey.shade600,
                  fontSize: 11,
                ),
              ),
              const SizedBox(
                height: 2,
              ),
              Text(
                value,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  fontSize: 13,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

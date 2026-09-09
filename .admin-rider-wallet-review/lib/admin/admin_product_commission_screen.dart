import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
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
  static const String baseUrl =
      'https://api.servicepay.ng/api';

  static const Color primaryGreen =
      Color(0xFF168A3A);

  bool isLoading = true;
  bool isSaving = false;
  String errorMessage = '';

  List<Map<String, dynamic>> commissions = [];

  final List<Map<String, String>> products = const [
    {
      'code': 'AIRTIME',
      'name': 'Airtime',
    },
    {
      'code': 'DATA',
      'name': 'Data',
    },
    {
      'code': 'CABLE',
      'name': 'Cable TV',
    },
    {
      'code': 'ELECTRICITY',
      'name': 'Electricity',
    },
    {
      'code': 'EXAM_PIN',
      'name': 'Exam PIN',
    },
    {
      'code': 'NIN_VERIFICATION',
      'name': 'NIN Verification',
    },
    {
      'code': 'BVN_VERIFICATION',
      'name': 'BVN Verification',
    },
    {
      'code': 'DELIVERY',
      'name': 'Delivery',
    },
    {
      'code': 'SERVICEPAY_TRANSFER',
      'name': 'ServicePay Transfer',
    },
  ];

  @override
  void initState() {
    super.initState();
    loadCommissions();
  }

  Future<String?> getAuthToken() async {
    final SharedPreferences preferences =
        await SharedPreferences.getInstance();

    const List<String> tokenKeys = [
      'auth_token',
      'admin_token',
      'token',
      'access_token',
      'accessToken',
      'jwt_token',
      'jwt',
    ];

    for (final String key in tokenKeys) {
      final String? value =
          preferences.getString(key);

      if (value == null || value.trim().isEmpty) {
        continue;
      }

      String token = value.trim();

      if (token.toLowerCase().startsWith(
            'bearer ',
          )) {
        token = token.substring(7).trim();
      }

      if (token.isNotEmpty) {
        await preferences.setString(
          'auth_token',
          token,
        );

        return token;
      }
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
        'message': 'Invalid server response.',
      };
    } catch (_) {
      return {
        'success': false,
        'message': 'The server returned invalid data.',
      };
    }
  }

  String responseMessage(
    Map<String, dynamic> data, {
    required String fallback,
  }) {
    final dynamic value =
        data['message'] ??
        data['error'] ??
        data['detail'];

    final String message =
        value?.toString().trim() ?? '';

    return message.isEmpty ? fallback : message;
  }

  List<Map<String, dynamic>> extractList(
    Map<String, dynamic> responseData,
  ) {
    dynamic raw =
        responseData['products'] ??
        responseData['data'] ??
        responseData['commissions'] ??
        responseData['items'] ??
        responseData['results'];

    if (raw is Map) {
      raw =
          raw['products'] ??
          raw['commissions'] ??
          raw['items'] ??
          raw['results'] ??
          raw['data'];
    }

    if (raw is! List) {
      return [];
    }

    return raw
        .whereType<Map>()
        .map(
          (item) =>
              Map<String, dynamic>.from(item),
        )
        .toList();
  }

  Future<void> loadCommissions() async {
    if (mounted) {
      setState(() {
        isLoading = true;
        errorMessage = '';
      });
    }

    try {
      final String? token = await getAuthToken();

      if (!mounted) {
        return;
      }

      if (token == null || token.isEmpty) {
        setState(() {
          isLoading = false;
          errorMessage =
              'Admin login session has expired. Please log in again.';
        });
        return;
      }

      final http.Response response = await http
          .get(
            Uri.parse(
              '$baseUrl/admin/product-commissions',
            ),
            headers: {
              'Accept': 'application/json',
              'Authorization': 'Bearer $token',
            },
          )
          .timeout(
            const Duration(seconds: 45),
          );

      final Map<String, dynamic> responseData =
          decodeResponse(response);

      if (!mounted) {
        return;
      }

      if (response.statusCode >= 200 &&
          response.statusCode < 300 &&
          responseData['success'] != false) {
        setState(() {
          commissions = extractList(responseData);
          errorMessage = '';
        });
      } else {
        setState(() {
          errorMessage = responseMessage(
            responseData,
            fallback:
                'Unable to load product commissions.',
          );
        });
      }
    } on TimeoutException {
      if (mounted) {
        setState(() {
          errorMessage =
              'The request timed out. Please try again.';
        });
      }
    } on http.ClientException {
      if (mounted) {
        setState(() {
          errorMessage =
              'Unable to connect to the ServicePay server.';
        });
      }
    } catch (error) {
      if (mounted) {
        setState(() {
          errorMessage =
              'Unable to load commissions: $error';
        });
      }
    } finally {
      if (mounted) {
        setState(() {
          isLoading = false;
        });
      }
    }
  }

  String firstText(
    Map<String, dynamic> data,
    List<String> keys, {
    String fallback = '',
  }) {
    for (final String key in keys) {
      final dynamic value = data[key];

      if (value == null) {
        continue;
      }

      final String text = value.toString().trim();

      if (text.isNotEmpty &&
          text.toLowerCase() != 'null') {
        return text;
      }
    }

    return fallback;
  }

  double firstAmount(
    Map<String, dynamic> data,
    List<String> keys,
  ) {
    for (final String key in keys) {
      final dynamic value = data[key];

      if (value == null) {
        continue;
      }

      final double? amount =
          double.tryParse(value.toString());

      if (amount != null) {
        return amount;
      }
    }

    return 0;
  }

  bool firstBoolean(
    Map<String, dynamic> data,
    List<String> keys, {
    bool fallback = true,
  }) {
    for (final String key in keys) {
      final dynamic value = data[key];

      if (value is bool) {
        return value;
      }

      final String text =
          value?.toString().toLowerCase() ?? '';

      if (text == 'true' ||
          text == 'active' ||
          text == 'enabled' ||
          text == '1') {
        return true;
      }

      if (text == 'false' ||
          text == 'inactive' ||
          text == 'disabled' ||
          text == '0') {
        return false;
      }
    }

    return fallback;
  }

  Future<void> openCommissionForm({
    Map<String, dynamic>? existing,
  }) async {
    String selectedProductCode = firstText(
      existing ?? {},
      const [
        'productCode',
        'serviceType',
        'code',
        'product',
      ],
      fallback: 'AIRTIME',
    ).toUpperCase();

    final bool knownProduct = products.any(
      (product) =>
          product['code'] == selectedProductCode,
    );

    if (!knownProduct) {
      selectedProductCode = 'AIRTIME';
    }

    final TextEditingController productNameController =
        TextEditingController(
          text: firstText(
            existing ?? {},
            const [
              'productName',
              'name',
              'title',
            ],
            fallback: products.firstWhere(
              (product) =>
                  product['code'] ==
                  selectedProductCode,
            )['name']!,
          ),
        );

    final TextEditingController companyController =
        TextEditingController(
          text: firstAmount(
            existing ?? {},
            const [
              'companyAmount',
              'companyProfit',
              'headOfficeAmount',
              'headOfficeProfit',
              'adminAmount',
            ],
          ).toStringAsFixed(0),
        );

    final TextEditingController zonalController =
        TextEditingController(
          text: firstAmount(
            existing ?? {},
            const [
              'zonalAmount',
              'zonalManagerAmount',
              'zonalCommission',
            ],
          ).toStringAsFixed(0),
        );

    final TextEditingController stateController =
        TextEditingController(
          text: firstAmount(
            existing ?? {},
            const [
              'stateAmount',
              'stateManagerAmount',
              'stateCommission',
            ],
          ).toStringAsFixed(0),
        );

    final TextEditingController agentController =
        TextEditingController(
          text: firstAmount(
            existing ?? {},
            const [
              'agentAmount',
              'agentCommission',
            ],
          ).toStringAsFixed(0),
        );

    bool isActive = firstBoolean(
      existing ?? {},
      const [
        'isActive',
        'active',
        'enabled',
        'status',
      ],
    );

    final GlobalKey<FormState> dialogFormKey =
        GlobalKey<FormState>();

    await showDialog<void>(
      context: context,
      barrierDismissible: !isSaving,
      builder: (BuildContext dialogContext) {
        return StatefulBuilder(
          builder: (
            BuildContext context,
            StateSetter setDialogState,
          ) {
            return AlertDialog(
              insetPadding:
                  const EdgeInsets.symmetric(
                horizontal: 18,
                vertical: 24,
              ),
              shape: RoundedRectangleBorder(
                borderRadius:
                    BorderRadius.circular(22),
              ),
              title: Text(
                existing == null
                    ? 'Add Product Commission'
                    : 'Edit Product Commission',
                style: const TextStyle(
                  fontWeight: FontWeight.w900,
                ),
              ),
              content: SizedBox(
                width: 520,
                child: Form(
                  key: dialogFormKey,
                  child: SingleChildScrollView(
                    child: Column(
                      mainAxisSize:
                          MainAxisSize.min,
                      children: [
                        DropdownButtonFormField<String>(
                          value:
                              selectedProductCode,
                          decoration:
                              const InputDecoration(
                            labelText: 'Product',
                            prefixIcon: Icon(
                              Icons.apps_rounded,
                            ),
                            border:
                                OutlineInputBorder(),
                          ),
                          items: products
                              .map(
                                (product) =>
                                    DropdownMenuItem<
                                        String>(
                                  value:
                                      product['code'],
                                  child: Text(
                                    product['name']!,
                                  ),
                                ),
                              )
                              .toList(),
                          onChanged: isSaving
                              ? null
                              : (String? value) {
                                  if (value == null) {
                                    return;
                                  }

                                  setDialogState(() {
                                    selectedProductCode =
                                        value;

                                    final Map<
                                            String,
                                            String>
                                        product =
                                        products.firstWhere(
                                      (item) =>
                                          item['code'] ==
                                          value,
                                    );

                                    productNameController
                                            .text =
                                        product['name']!;
                                  });
                                },
                        ),
                        const SizedBox(height: 14),
                        TextFormField(
                          controller:
                              productNameController,
                          enabled: !isSaving,
                          decoration:
                              const InputDecoration(
                            labelText: 'Product Name',
                            prefixIcon: Icon(
                              Icons
                                  .inventory_2_outlined,
                            ),
                            border:
                                OutlineInputBorder(),
                          ),
                          validator: (String? value) {
                            if (value == null ||
                                value.trim().isEmpty) {
                              return 'Enter product name';
                            }

                            return null;
                          },
                        ),
                        const SizedBox(height: 18),
                        const Align(
                          alignment:
                              Alignment.centerLeft,
                          child: Text(
                            'COMMISSION AMOUNTS',
                            style: TextStyle(
                              color:
                                  Color(0xFF6B7280),
                              fontWeight:
                                  FontWeight.w800,
                              letterSpacing: 1,
                            ),
                          ),
                        ),
                        const SizedBox(height: 12),
                        _AmountField(
                          controller:
                              companyController,
                          label:
                              'Head Office Amount',
                          icon: Icons
                              .account_balance_outlined,
                        ),
                        const SizedBox(height: 12),
                        _AmountField(
                          controller:
                              zonalController,
                          label:
                              'Zonal Manager Amount',
                          icon:
                              Icons.public_outlined,
                        ),
                        const SizedBox(height: 12),
                        _AmountField(
                          controller:
                              stateController,
                          label:
                              'State Manager Amount',
                          icon: Icons
                              .location_city_outlined,
                        ),
                        const SizedBox(height: 12),
                        _AmountField(
                          controller:
                              agentController,
                          label: 'Agent Amount',
                          icon: Icons
                              .support_agent_outlined,
                        ),
                        const SizedBox(height: 8),
                        SwitchListTile(
                          contentPadding:
                              EdgeInsets.zero,
                          value: isActive,
                          activeTrackColor:
                              primaryGreen,
                          title: const Text(
                            'Commission Active',
                            style: TextStyle(
                              fontWeight:
                                  FontWeight.w800,
                            ),
                          ),
                          subtitle: const Text(
                            'Disable this product without deleting its settings.',
                          ),
                          onChanged: isSaving
                              ? null
                              : (bool value) {
                                  setDialogState(() {
                                    isActive = value;
                                  });
                                },
                        ),
                      ],
                    ),
                  ),
                ),
              ),
              actions: [
                TextButton(
                  onPressed: isSaving
                      ? null
                      : () {
                          Navigator.pop(
                            dialogContext,
                          );
                        },
                  child: const Text('Cancel'),
                ),
                FilledButton.icon(
                  onPressed: isSaving
                      ? null
                      : () async {
                          final bool valid =
                              dialogFormKey
                                      .currentState
                                      ?.validate() ??
                                  false;

                          if (!valid) {
                            return;
                          }

                          final bool saved =
                              await saveCommission(
                            existing: existing,
                            productCode:
                                selectedProductCode,
                            productName:
                                productNameController
                                    .text
                                    .trim(),
                            companyAmount:
                                double.tryParse(
                                      companyController
                                          .text,
                                    ) ??
                                    0,
                            zonalAmount:
                                double.tryParse(
                                      zonalController
                                          .text,
                                    ) ??
                                    0,
                            stateAmount:
                                double.tryParse(
                                      stateController
                                          .text,
                                    ) ??
                                    0,
                            agentAmount:
                                double.tryParse(
                                      agentController
                                          .text,
                                    ) ??
                                    0,
                            isActive: isActive,
                          );

                          if (!dialogContext.mounted) {
                            return;
                          }

                          if (saved) {
                            Navigator.pop(
                              dialogContext,
                            );
                          }
                        },
                  style: FilledButton.styleFrom(
                    backgroundColor: primaryGreen,
                  ),
                  icon: isSaving
                      ? const SizedBox(
                          width: 18,
                          height: 18,
                          child:
                              CircularProgressIndicator(
                            strokeWidth: 2,
                            color: Colors.white,
                          ),
                        )
                      : const Icon(
                          Icons.save_outlined,
                        ),
                  label: Text(
                    isSaving
                        ? 'Saving...'
                        : 'Save Commission',
                  ),
                ),
              ],
            );
          },
        );
      },
    );

    productNameController.dispose();
    companyController.dispose();
    zonalController.dispose();
    stateController.dispose();
    agentController.dispose();
  }

  Future<bool> saveCommission({
    required Map<String, dynamic>? existing,
    required String productCode,
    required String productName,
    required double companyAmount,
    required double zonalAmount,
    required double stateAmount,
    required double agentAmount,
    required bool isActive,
  }) async {
    if (isSaving) {
      return false;
    }

    setState(() {
      isSaving = true;
    });

    try {
      final String? token = await getAuthToken();

      if (!mounted) {
        return false;
      }

      if (token == null || token.isEmpty) {
        showMessage(
          'Admin login session has expired.',
          isError: true,
        );
        return false;
      }

      final Map<String, dynamic> payload = {
        'productCode': productCode,
        'serviceType': productCode,
        'productName': productName,

        'companyAmount': companyAmount,
        'companyProfit': companyAmount,
        'headOfficeAmount': companyAmount,
        'headOfficeCommission': companyAmount,

        'zonalAmount': zonalAmount,
        'zonalManagerAmount': zonalAmount,
        'zonalCommission': zonalAmount,

        'stateAmount': stateAmount,
        'stateManagerAmount': stateAmount,
        'stateCommission': stateAmount,

        'agentAmount': agentAmount,
        'agentCommission': agentAmount,

        'isActive': isActive,
        'active': isActive,
      };

      final String id = firstText(
        existing ?? {},
        const [
          '_id',
          'id',
          'commissionId',
        ],
      );

      http.Response response;

      if (id.isEmpty) {
        response = await http
            .post(
              Uri.parse(
                '$baseUrl/admin/product-commissions',
              ),
              headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json',
                'Authorization':
                    'Bearer $token',
              },
              body: jsonEncode(payload),
            )
            .timeout(
              const Duration(seconds: 45),
            );
      } else {
        response = await http
            .put(
              Uri.parse(
                '$baseUrl/admin/product-commissions/$id',
              ),
              headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json',
                'Authorization':
                    'Bearer $token',
              },
              body: jsonEncode(payload),
            )
            .timeout(
              const Duration(seconds: 45),
            );

        if (response.statusCode == 404 ||
            response.statusCode == 405) {
          response = await http
              .patch(
                Uri.parse(
                  '$baseUrl/admin/product-commissions/$id',
                ),
                headers: {
                  'Accept':
                      'application/json',
                  'Content-Type':
                      'application/json',
                  'Authorization':
                      'Bearer $token',
                },
                body: jsonEncode(payload),
              )
              .timeout(
                const Duration(seconds: 45),
              );
        }
      }

      final Map<String, dynamic> responseData =
          decodeResponse(response);

      if (!mounted) {
        return false;
      }

      final bool successful =
          response.statusCode >= 200 &&
          response.statusCode < 300 &&
          responseData['success'] != false;

      if (!successful) {
        showMessage(
          responseMessage(
            responseData,
            fallback:
                'Unable to save commission. Status: ${response.statusCode}.',
          ),
          isError: true,
        );
        return false;
      }

      showMessage(
        existing == null
            ? 'Product commission added successfully.'
            : 'Product commission updated successfully.',
        isError: false,
      );

      await loadCommissions();

      return true;
    } on TimeoutException {
      showMessage(
        'The request timed out. Please try again.',
        isError: true,
      );
      return false;
    } catch (error) {
      showMessage(
        'Unable to save commission: $error',
        isError: true,
      );
      return false;
    } finally {
      if (mounted) {
        setState(() {
          isSaving = false;
        });
      }
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
          backgroundColor: isError
              ? const Color(0xFFDC2626)
              : primaryGreen,
        ),
      );
  }

  Widget buildCommissionCard(
    Map<String, dynamic> commission,
  ) {
    final String productName = firstText(
      commission,
      const [
        'productName',
        'name',
        'title',
      ],
      fallback: 'ServicePay Product',
    );

    final String productCode = firstText(
      commission,
      const [
        'productCode',
        'serviceType',
        'code',
        'product',
      ],
    );

    final double companyAmount = firstAmount(
      commission,
      const [
        'companyAmount',
        'companyProfit',
        'headOfficeAmount',
        'headOfficeProfit',
        'adminAmount',
      ],
    );

    final double zonalAmount = firstAmount(
      commission,
      const [
        'zonalAmount',
        'zonalManagerAmount',
        'zonalCommission',
      ],
    );

    final double stateAmount = firstAmount(
      commission,
      const [
        'stateAmount',
        'stateManagerAmount',
        'stateCommission',
      ],
    );

    final double agentAmount = firstAmount(
      commission,
      const [
        'agentAmount',
        'agentCommission',
      ],
    );

    final bool active = firstBoolean(
      commission,
      const [
        'isActive',
        'active',
        'enabled',
        'status',
      ],
    );

    final double totalAmount =
        companyAmount +
        zonalAmount +
        stateAmount +
        agentAmount;

    return Card(
      margin: const EdgeInsets.only(bottom: 14),
      elevation: 0,
      color: Colors.white,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(20),
        side: const BorderSide(
          color: Color(0xFFE5E7EB),
        ),
      ),
      child: Padding(
        padding: const EdgeInsets.all(17),
        child: Column(
          children: [
            Row(
              children: [
                Container(
                  width: 48,
                  height: 48,
                  decoration: BoxDecoration(
                    color:
                        const Color(0xFFE8F5EB),
                    borderRadius:
                        BorderRadius.circular(14),
                  ),
                  child: const Icon(
                    Icons.percent_rounded,
                    color: primaryGreen,
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment:
                        CrossAxisAlignment.start,
                    children: [
                      Text(
                        productName,
                        style: const TextStyle(
                          fontSize: 17,
                          fontWeight:
                              FontWeight.w900,
                        ),
                      ),
                      if (productCode.isNotEmpty)
                        Text(
                          productCode,
                          style: const TextStyle(
                            color:
                                Color(0xFF6B7280),
                            fontWeight:
                                FontWeight.w600,
                          ),
                        ),
                    ],
                  ),
                ),
                Container(
                  padding:
                      const EdgeInsets.symmetric(
                    horizontal: 10,
                    vertical: 6,
                  ),
                  decoration: BoxDecoration(
                    color: active
                        ? const Color(0xFFDCFCE7)
                        : const Color(0xFFFEE2E2),
                    borderRadius:
                        BorderRadius.circular(20),
                  ),
                  child: Text(
                    active ? 'ACTIVE' : 'INACTIVE',
                    style: TextStyle(
                      color: active
                          ? const Color(0xFF166534)
                          : const Color(0xFF991B1B),
                      fontSize: 11,
                      fontWeight:
                          FontWeight.w900,
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 17),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                _CommissionAmount(
                  label: 'Head Office',
                  amount: companyAmount,
                ),
                _CommissionAmount(
                  label: 'Zonal',
                  amount: zonalAmount,
                ),
                _CommissionAmount(
                  label: 'State',
                  amount: stateAmount,
                ),
                _CommissionAmount(
                  label: 'Agent',
                  amount: agentAmount,
                ),
              ],
            ),
            const SizedBox(height: 15),
            const Divider(height: 1),
            const SizedBox(height: 12),
            Row(
              children: [
                Expanded(
                  child: Text(
                    'Total distributed: ₦${totalAmount.toStringAsFixed(2)}',
                    style: const TextStyle(
                      color: Color(0xFF374151),
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                ),
                OutlinedButton.icon(
                  onPressed: isSaving
                      ? null
                      : () {
                          openCommissionForm(
                            existing: commission,
                          );
                        },
                  icon: const Icon(
                    Icons.edit_outlined,
                    size: 18,
                  ),
                  label: const Text('Edit'),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor:
          const Color(0xFFF7F8FA),
      appBar: AppBar(
        title: const Text(
          'Product Commissions',
          style: TextStyle(
            fontWeight: FontWeight.w900,
          ),
        ),
        backgroundColor: primaryGreen,
        foregroundColor: Colors.white,
        actions: [
          IconButton(
            tooltip: 'Refresh',
            onPressed:
                isLoading ? null : loadCommissions,
            icon: const Icon(
              Icons.refresh_rounded,
            ),
          ),
        ],
      ),
      floatingActionButton:
          FloatingActionButton.extended(
        onPressed: isSaving
            ? null
            : () {
                openCommissionForm();
              },
        backgroundColor: primaryGreen,
        foregroundColor: Colors.white,
        icon: const Icon(Icons.add_rounded),
        label: const Text(
          'Add Product',
          style: TextStyle(
            fontWeight: FontWeight.w800,
          ),
        ),
      ),
      body: RefreshIndicator(
        onRefresh: loadCommissions,
        child: ListView(
          padding: const EdgeInsets.fromLTRB(
            18,
            18,
            18,
            100,
          ),
          children: [
            Container(
              padding: const EdgeInsets.all(18),
              decoration: BoxDecoration(
                gradient: const LinearGradient(
                  colors: [
                    Color(0xFF126C31),
                    Color(0xFF1FA34A),
                  ],
                ),
                borderRadius:
                    BorderRadius.circular(22),
              ),
              child: const Row(
                crossAxisAlignment:
                    CrossAxisAlignment.start,
                children: [
                  Icon(
                    Icons
                        .account_balance_wallet_outlined,
                    color: Colors.white,
                    size: 38,
                  ),
                  SizedBox(width: 13),
                  Expanded(
                    child: Column(
                      crossAxisAlignment:
                          CrossAxisAlignment.start,
                      children: [
                        Text(
                          'Commission Management',
                          style: TextStyle(
                            color: Colors.white,
                            fontSize: 21,
                            fontWeight:
                                FontWeight.w900,
                          ),
                        ),
                        SizedBox(height: 5),
                        Text(
                          'Set fixed amounts for Head Office, Zonal Manager, State Manager and Agent for each successful transaction.',
                          style: TextStyle(
                            color:
                                Color(0xFFE8F5EB),
                            height: 1.4,
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 20),
            if (isLoading)
              const Padding(
                padding: EdgeInsets.all(45),
                child: Center(
                  child: CircularProgressIndicator(
                    color: primaryGreen,
                  ),
                ),
              )
            else if (errorMessage.isNotEmpty)
              Container(
                padding: const EdgeInsets.all(22),
                decoration: BoxDecoration(
                  color: Colors.white,
                  borderRadius:
                      BorderRadius.circular(18),
                  border: Border.all(
                    color:
                        const Color(0xFFFECACA),
                  ),
                ),
                child: Column(
                  children: [
                    const Icon(
                      Icons
                          .error_outline_rounded,
                      color: Color(0xFFDC2626),
                      size: 43,
                    ),
                    const SizedBox(height: 10),
                    Text(
                      errorMessage,
                      textAlign: TextAlign.center,
                      style: const TextStyle(
                        color:
                            Color(0xFF7F1D1D),
                        fontWeight:
                            FontWeight.w700,
                      ),
                    ),
                    const SizedBox(height: 15),
                    FilledButton.icon(
                      onPressed: loadCommissions,
                      style:
                          FilledButton.styleFrom(
                        backgroundColor:
                            primaryGreen,
                      ),
                      icon: const Icon(
                        Icons.refresh,
                      ),
                      label: const Text(
                        'Try Again',
                      ),
                    ),
                  ],
                ),
              )
            else if (commissions.isEmpty)
              Container(
                padding: const EdgeInsets.all(30),
                decoration: BoxDecoration(
                  color: Colors.white,
                  borderRadius:
                      BorderRadius.circular(20),
                  border: Border.all(
                    color:
                        const Color(0xFFE5E7EB),
                  ),
                ),
                child: Column(
                  children: [
                    const Icon(
                      Icons.percent_rounded,
                      color: primaryGreen,
                      size: 55,
                    ),
                    const SizedBox(height: 13),
                    const Text(
                      'No commission product yet',
                      style: TextStyle(
                        fontSize: 18,
                        fontWeight:
                            FontWeight.w900,
                      ),
                    ),
                    const SizedBox(height: 6),
                    const Text(
                      'Add your first product and specify the amount each management level should receive.',
                      textAlign: TextAlign.center,
                      style: TextStyle(
                        color:
                            Color(0xFF6B7280),
                        height: 1.4,
                      ),
                    ),
                    const SizedBox(height: 17),
                    FilledButton.icon(
                      onPressed: () {
                        openCommissionForm();
                      },
                      style:
                          FilledButton.styleFrom(
                        backgroundColor:
                            primaryGreen,
                      ),
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
            else ...[
              Row(
                children: [
                  const Expanded(
                    child: Text(
                      'Configured Products',
                      style: TextStyle(
                        fontSize: 19,
                        fontWeight:
                            FontWeight.w900,
                      ),
                    ),
                  ),
                  Text(
                    '${commissions.length} products',
                    style: const TextStyle(
                      color: Color(0xFF6B7280),
                      fontWeight:
                          FontWeight.w700,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 13),
              ...commissions.map(
                buildCommissionCard,
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _AmountField extends StatelessWidget {
  final TextEditingController controller;
  final String label;
  final IconData icon;

  const _AmountField({
    required this.controller,
    required this.label,
    required this.icon,
  });

  @override
  Widget build(BuildContext context) {
    return TextFormField(
      controller: controller,
      keyboardType:
          const TextInputType.numberWithOptions(
        decimal: true,
      ),
      inputFormatters: [
        FilteringTextInputFormatter.allow(
          RegExp(r'^\d*\.?\d{0,2}'),
        ),
      ],
      decoration: InputDecoration(
        labelText: label,
        prefixText: '₦ ',
        prefixIcon: Icon(icon),
        border: const OutlineInputBorder(),
      ),
      validator: (String? value) {
        final double? amount =
            double.tryParse(value?.trim() ?? '');

        if (amount == null || amount < 0) {
          return 'Enter a valid amount';
        }

        return null;
      },
    );
  }
}

class _CommissionAmount extends StatelessWidget {
  final String label;
  final double amount;

  const _CommissionAmount({
    required this.label,
    required this.amount,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      constraints:
          const BoxConstraints(minWidth: 130),
      padding: const EdgeInsets.symmetric(
        horizontal: 12,
        vertical: 10,
      ),
      decoration: BoxDecoration(
        color: const Color(0xFFF3F4F6),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Column(
        crossAxisAlignment:
            CrossAxisAlignment.start,
        children: [
          Text(
            label,
            style: const TextStyle(
              color: Color(0xFF6B7280),
              fontSize: 11,
              fontWeight: FontWeight.w700,
            ),
          ),
          const SizedBox(height: 3),
          Text(
            '₦${amount.toStringAsFixed(2)}',
            style: const TextStyle(
              color: Color(0xFF111827),
              fontWeight: FontWeight.w900,
            ),
          ),
        ],
      ),
    );
  }
}

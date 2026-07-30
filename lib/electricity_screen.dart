import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

class ElectricityScreen extends StatefulWidget {
  const ElectricityScreen({super.key});

  @override
  State<ElectricityScreen> createState() => _ElectricityScreenState();
}

class _ElectricityScreenState extends State<ElectricityScreen> {
  static const String baseUrl = 'https://api.servicepay.ng/api';

  static const Color primaryGreen = Color(0xFF2E7D32);

  final GlobalKey<FormState> formKey = GlobalKey<FormState>();

  final TextEditingController meterController = TextEditingController();

  final TextEditingController phoneController = TextEditingController();

  final TextEditingController amountController = TextEditingController();

  String selectedDiscoCode = '04';
  String selectedMeterTypeCode = '01';

  bool isVerifyingMeter = false;
  bool isPaying = false;

  String verifiedCustomerName = '';
  String verifiedMeterNumber = '';
  String verifiedDiscoCode = '';
  String verifiedMeterTypeCode = '';

  final List<Map<String, String>> discos = const [
    {
      'code': '01',
      'shortName': 'EKEDC',
      'name': 'Eko Electric',
    },
    {
      'code': '02',
      'shortName': 'IKEDC',
      'name': 'Ikeja Electric',
    },
    {
      'code': '03',
      'shortName': 'AEDC',
      'name': 'Abuja Electric',
    },
    {
      'code': '04',
      'shortName': 'KEDC',
      'name': 'Kano Electric',
    },
    {
      'code': '05',
      'shortName': 'PHEDC',
      'name': 'Port Harcourt Electric',
    },
    {
      'code': '06',
      'shortName': 'JEDC',
      'name': 'Jos Electric',
    },
    {
      'code': '07',
      'shortName': 'IBEDC',
      'name': 'Ibadan Electric',
    },
    {
      'code': '08',
      'shortName': 'KAEDC',
      'name': 'Kaduna Electric',
    },
    {
      'code': '09',
      'shortName': 'EEDC',
      'name': 'Enugu Electric',
    },
    {
      'code': '10',
      'shortName': 'BEDC',
      'name': 'Benin Electric',
    },
    {
      'code': '11',
      'shortName': 'YEDC',
      'name': 'Yola Electric',
    },
    {
      'code': '12',
      'shortName': 'APLE',
      'name': 'Aba Electric',
    },
  ];

  final List<Map<String, String>> meterTypes = const [
    {
      'code': '01',
      'name': 'Prepaid',
    },
    {
      'code': '02',
      'name': 'Postpaid',
    },
  ];

  bool get isBusy {
    return isVerifyingMeter || isPaying;
  }

  Map<String, String> get selectedDisco {
    return discos.firstWhere(
      (item) => item['code'] == selectedDiscoCode,
      orElse: () => discos.first,
    );
  }

  Map<String, String> get selectedMeterType {
    return meterTypes.firstWhere(
      (item) => item['code'] == selectedMeterTypeCode,
      orElse: () => meterTypes.first,
    );
  }

  bool get meterIsVerified {
    return verifiedCustomerName.isNotEmpty &&
        verifiedMeterNumber == meterController.text.trim() &&
        verifiedDiscoCode == selectedDiscoCode &&
        verifiedMeterTypeCode == selectedMeterTypeCode;
  }

  @override
  void dispose() {
    meterController.dispose();
    phoneController.dispose();
    amountController.dispose();
    super.dispose();
  }

  void clearMeterVerification() {
    if (!mounted) {
      return;
    }

    setState(() {
      verifiedCustomerName = '';
      verifiedMeterNumber = '';
      verifiedDiscoCode = '';
      verifiedMeterTypeCode = '';
    });
  }

  void showMessage(
    String message, {
    bool isError = true,
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

  Map<String, dynamic> decodeResponse(
    String body,
  ) {
    if (body.trim().isEmpty) {
      return {};
    }

    try {
      final dynamic decoded = jsonDecode(body);

      if (decoded is Map) {
        return Map<String, dynamic>.from(decoded);
      }
    } catch (_) {
      return {};
    }

    return {};
  }

  String responseMessage(
    Map<String, dynamic> responseData, {
    required String fallback,
  }) {
    final dynamic value = responseData['message'] ??
        responseData['error'] ??
        responseData['detail'];

    final String message = value?.toString().trim() ?? '';

    return message.isEmpty ? fallback : message;
  }

  Future<String?> getAuthToken() async {
    final SharedPreferences preferences = await SharedPreferences.getInstance();

    final String token = preferences.getString('auth_token') ?? '';

    if (token.trim().isEmpty) {
      return null;
    }

    return token.trim();
  }

  String? validateMeterNumber(
    String? value,
  ) {
    final String meterNumber = value?.trim() ?? '';

    if (meterNumber.isEmpty) {
      return 'Enter the meter number';
    }

    if (!RegExp(r'^[A-Za-z0-9]+$').hasMatch(meterNumber)) {
      return 'Meter number must contain letters or numbers only';
    }

    if (meterNumber.length < 5) {
      return 'Enter a valid meter number';
    }

    return null;
  }

  String? validatePhone(
    String? value,
  ) {
    final String phone = value?.trim() ?? '';

    if (phone.isEmpty) {
      return 'Enter a phone number';
    }

    if (!RegExp(r'^0\d{10}$').hasMatch(phone)) {
      return 'Enter a valid 11-digit phone number';
    }

    return null;
  }

  String? validateAmount(
    String? value,
  ) {
    final String amountText = value?.trim() ?? '';

    if (amountText.isEmpty) {
      return 'Enter the electricity amount';
    }

    final double? amount = double.tryParse(amountText);

    if (amount == null) {
      return 'Enter a valid amount';
    }

    if (amount < 1000) {
      return 'Minimum electricity amount is ₦1,000';
    }

    if (amount > 200000) {
      return 'Maximum electricity amount is ₦200,000';
    }

    return null;
  }

  Future<void> verifyMeter() async {
    FocusScope.of(context).unfocus();

    final String? validationError = validateMeterNumber(meterController.text);

    if (validationError != null) {
      showMessage(validationError);
      return;
    }

    if (isBusy) {
      return;
    }

    setState(() {
      isVerifyingMeter = true;
      verifiedCustomerName = '';
      verifiedMeterNumber = '';
      verifiedDiscoCode = '';
      verifiedMeterTypeCode = '';
    });

    try {
      final String? token = await getAuthToken();

      if (token == null) {
        showMessage(
          'Your login session has expired. Please log out and log in again.',
        );
        return;
      }

      final http.Response response = await http
          .post(
            Uri.parse(
              '$baseUrl/electricity/verify-meter',
            ),
            headers: {
              'Accept': 'application/json',
              'Content-Type': 'application/json',
              'Authorization': 'Bearer $token',
            },
            body: jsonEncode({
              'electricCompany': selectedDiscoCode,
              'meterType': selectedMeterTypeCode,
              'meterNumber': meterController.text.trim(),
            }),
          )
          .timeout(
            const Duration(seconds: 50),
          );

      final Map<String, dynamic> responseData = decodeResponse(response.body);

      if (!mounted) {
        return;
      }

      final bool successful = response.statusCode >= 200 &&
          response.statusCode < 300 &&
          responseData['success'] == true;

      if (!successful) {
        showMessage(
          responseMessage(
            responseData,
            fallback: 'Unable to verify the meter number.',
          ),
        );
        return;
      }

      final dynamic customerValue = responseData['customer'];

      if (customerValue is! Map) {
        showMessage(
          'The server returned incomplete meter information.',
        );
        return;
      }

      final Map<String, dynamic> customer =
          Map<String, dynamic>.from(customerValue);

      final String customerName = customer['name']?.toString().trim() ?? '';

      final String meterNumber = customer['meterNumber']?.toString().trim() ??
          meterController.text.trim();

      if (customerName.isEmpty) {
        showMessage(
          'Customer name was not returned for this meter.',
        );
        return;
      }

      setState(() {
        verifiedCustomerName = customerName;
        verifiedMeterNumber = meterNumber;
        verifiedDiscoCode = selectedDiscoCode;
        verifiedMeterTypeCode = selectedMeterTypeCode;
      });

      showMessage(
        'Meter verified successfully.',
        isError: false,
      );
    } on TimeoutException {
      showMessage(
        'Meter verification timed out. Please try again.',
      );
    } on http.ClientException {
      showMessage(
        'Unable to connect to the electricity provider.',
      );
    } catch (_) {
      showMessage(
        'Unable to verify the meter number.',
      );
    } finally {
      if (mounted) {
        setState(() {
          isVerifyingMeter = false;
        });
      }
    }
  }

  Future<String?> requestTransactionPin({
    required double amount,
  }) async {
    final TextEditingController pinController = TextEditingController();

    bool hidePin = true;
    String errorMessage = '';

    final String? pin = await showDialog<String>(
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
            void submitPin() {
              final String enteredPin = pinController.text.trim();

              if (!RegExp(r'^\d{4}$').hasMatch(enteredPin)) {
                setDialogState(() {
                  errorMessage = 'Enter your valid 4-digit transaction PIN.';
                });
                return;
              }

              Navigator.pop(
                dialogContext,
                enteredPin,
              );
            }

            return AlertDialog(
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(22),
              ),
              title: const Text(
                'Confirm Electricity Payment',
                style: TextStyle(
                  fontWeight: FontWeight.w800,
                ),
              ),
              content: SingleChildScrollView(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Container(
                      width: double.infinity,
                      padding: const EdgeInsets.all(16),
                      decoration: BoxDecoration(
                        color: const Color(0xFFF0FDF4),
                        borderRadius: BorderRadius.circular(15),
                        border: Border.all(
                          color: const Color(0xFFBBF7D0),
                        ),
                      ),
                      child: Column(
                        children: [
                          const Icon(
                            Icons.electric_bolt_rounded,
                            color: primaryGreen,
                            size: 42,
                          ),
                          const SizedBox(height: 8),
                          Text(
                            verifiedCustomerName,
                            textAlign: TextAlign.center,
                            style: const TextStyle(
                              fontSize: 18,
                              fontWeight: FontWeight.w900,
                            ),
                          ),
                          const SizedBox(height: 4),
                          Text(
                            '${selectedDisco['shortName']} • '
                            '${selectedMeterType['name']}',
                            textAlign: TextAlign.center,
                            style: const TextStyle(
                              color: Color(0xFF6B7280),
                            ),
                          ),
                          const SizedBox(height: 4),
                          Text(
                            meterController.text.trim(),
                            style: const TextStyle(
                              color: Color(0xFF6B7280),
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                          const Padding(
                            padding: EdgeInsets.symmetric(
                              vertical: 12,
                            ),
                            child: Divider(),
                          ),
                          const Text(
                            'Amount',
                            style: TextStyle(
                              color: Color(0xFF6B7280),
                            ),
                          ),
                          const SizedBox(height: 3),
                          Text(
                            '₦${amount.toStringAsFixed(2)}',
                            style: const TextStyle(
                              color: primaryGreen,
                              fontSize: 27,
                              fontWeight: FontWeight.w900,
                            ),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: 18),
                    TextField(
                      controller: pinController,
                      autofocus: true,
                      obscureText: hidePin,
                      keyboardType: TextInputType.number,
                      textInputAction: TextInputAction.done,
                      maxLength: 4,
                      inputFormatters: [
                        FilteringTextInputFormatter.digitsOnly,
                        LengthLimitingTextInputFormatter(4),
                      ],
                      onChanged: (_) {
                        if (errorMessage.isNotEmpty) {
                          setDialogState(() {
                            errorMessage = '';
                          });
                        }
                      },
                      onSubmitted: (_) {
                        submitPin();
                      },
                      decoration: InputDecoration(
                        labelText: 'Transaction PIN',
                        hintText: 'Enter 4-digit PIN',
                        counterText: '',
                        prefixIcon: const Icon(
                          Icons.pin_outlined,
                          color: primaryGreen,
                        ),
                        suffixIcon: IconButton(
                          onPressed: () {
                            setDialogState(() {
                              hidePin = !hidePin;
                            });
                          },
                          icon: Icon(
                            hidePin
                                ? Icons.visibility_outlined
                                : Icons.visibility_off_outlined,
                          ),
                        ),
                        errorText: errorMessage.isEmpty ? null : errorMessage,
                        filled: true,
                        fillColor: const Color(0xFFF8FAFC),
                        border: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(14),
                        ),
                      ),
                    ),
                    const SizedBox(height: 8),
                    const Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Icon(
                          Icons.lock_outline_rounded,
                          size: 18,
                          color: Color(0xFF6B7280),
                        ),
                        SizedBox(width: 7),
                        Expanded(
                          child: Text(
                            'Confirm the customer name and meter number before entering your PIN.',
                            style: TextStyle(
                              color: Color(0xFF6B7280),
                              fontSize: 12,
                              height: 1.4,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
              actions: [
                TextButton(
                  onPressed: () {
                    Navigator.pop(dialogContext);
                  },
                  child: const Text('Cancel'),
                ),
                FilledButton(
                  onPressed: submitPin,
                  style: FilledButton.styleFrom(
                    backgroundColor: primaryGreen,
                  ),
                  child: const Text('Pay Now'),
                ),
              ],
            );
          },
        );
      },
    );

    pinController.dispose();

    return pin;
  }

  Future<void> payElectricity() async {
    FocusScope.of(context).unfocus();

    if (!(formKey.currentState?.validate() ?? false)) {
      return;
    }

    if (!meterIsVerified) {
      showMessage(
        'Verify the meter number before making payment.',
      );
      return;
    }

    if (isBusy) {
      return;
    }

    final double amount = double.parse(
      amountController.text.trim(),
    );

    final String? pin = await requestTransactionPin(
      amount: amount,
    );

    if (pin == null || !mounted) {
      return;
    }

    setState(() {
      isPaying = true;
    });

    try {
      final String? token = await getAuthToken();

      if (token == null) {
        showMessage(
          'Your login session has expired. Please log out and log in again.',
        );
        return;
      }

      final http.Response response = await http
          .post(
            Uri.parse(
              '$baseUrl/electricity/pay',
            ),
            headers: {
              'Accept': 'application/json',
              'Content-Type': 'application/json',
              'Authorization': 'Bearer $token',
            },
            body: jsonEncode({
              'electricCompany': selectedDiscoCode,
              'meterType': selectedMeterTypeCode,
              'meterNumber': meterController.text.trim(),
              'phoneNumber': phoneController.text.trim(),
              'amount': amount,
              'pin': pin,
            }),
          )
          .timeout(
            const Duration(seconds: 75),
          );

      final Map<String, dynamic> responseData = decodeResponse(response.body);

      if (!mounted) {
        return;
      }

      final bool successful = response.statusCode >= 200 &&
          response.statusCode < 300 &&
          responseData['success'] == true;

      if (!successful) {
        final dynamic data = responseData['data'];

        if (data is Map && data['walletBalance'] != null) {
          await saveWalletBalance(
            data['walletBalance'],
          );
        }

        showMessage(
          responseMessage(
            responseData,
            fallback: 'Electricity payment failed. Please try again.',
          ),
        );
        return;
      }

      final dynamic dataValue = responseData['data'];

      final Map<String, dynamic> paymentData = dataValue is Map
          ? Map<String, dynamic>.from(dataValue)
          : <String, dynamic>{};

      await saveWalletBalance(
        paymentData['walletBalance'],
      );

      if (!mounted) {
        return;
      }

      await showPaymentResult(
        responseData: responseData,
        paymentData: paymentData,
        amount: amount,
      );

      if (!mounted) {
        return;
      }

      final String status =
          paymentData['status']?.toString().toUpperCase() ?? '';

      if (status == 'SUCCESSFUL' || status == 'PENDING') {
        meterController.clear();
        phoneController.clear();
        amountController.clear();

        setState(() {
          verifiedCustomerName = '';
          verifiedMeterNumber = '';
          verifiedDiscoCode = '';
          verifiedMeterTypeCode = '';
        });
      }
    } on TimeoutException {
      showMessage(
        'The electricity payment is taking longer than expected. Check Transactions before trying again.',
      );
    } on http.ClientException {
      showMessage(
        'Unable to connect to the electricity payment server.',
      );
    } catch (_) {
      showMessage(
        'Unable to complete the electricity payment.',
      );
    } finally {
      if (mounted) {
        setState(() {
          isPaying = false;
        });
      }
    }
  }

  Future<void> saveWalletBalance(
    dynamic value,
  ) async {
    if (value == null) {
      return;
    }

    final double? walletBalance = double.tryParse(
      value.toString(),
    );

    if (walletBalance == null) {
      return;
    }

    final SharedPreferences preferences = await SharedPreferences.getInstance();

    await preferences.setDouble(
      'wallet_balance',
      walletBalance,
    );
  }

  Future<void> showPaymentResult({
    required Map<String, dynamic> responseData,
    required Map<String, dynamic> paymentData,
    required double amount,
  }) async {
    final String status =
        paymentData['status']?.toString().trim().toUpperCase() ?? 'PENDING';

    final String customerName =
        paymentData['customerName']?.toString().trim() ?? verifiedCustomerName;

    final String meterNumber = paymentData['meterNumber']?.toString().trim() ??
        meterController.text.trim();

    final String companyName =
        paymentData['electricityCompany']?.toString().trim() ??
            selectedDisco['name'] ??
            '';

    final String companyShortName =
        paymentData['electricityCompanyShortName']?.toString().trim() ??
            selectedDisco['shortName'] ??
            '';

    final String meterType = paymentData['meterType']?.toString().trim() ??
        selectedMeterType['name'] ??
        '';

    final String reference = paymentData['reference']?.toString().trim() ?? '';

    final String orderId = paymentData['orderId']?.toString().trim() ?? '';

    final String meterToken =
        paymentData['meterToken']?.toString().trim() ?? '';

    final String units = paymentData['units']?.toString().trim() ?? '';

    final bool pending = responseData['pending'] == true || status == 'PENDING';

    final bool successful = status == 'SUCCESSFUL';

    final Color statusColor = successful
        ? primaryGreen
        : pending
            ? const Color(0xFFF59E0B)
            : const Color(0xFFDC2626);

    final IconData statusIcon = successful
        ? Icons.check_circle_rounded
        : pending
            ? Icons.hourglass_top_rounded
            : Icons.error_rounded;

    if (!mounted) {
      return;
    }

    await showDialog<void>(
      context: context,
      barrierDismissible: false,
      builder: (
        BuildContext dialogContext,
      ) {
        return AlertDialog(
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(22),
          ),
          icon: Icon(
            statusIcon,
            color: statusColor,
            size: 62,
          ),
          title: Text(
            successful
                ? 'Electricity Payment Successful'
                : pending
                    ? 'Payment Processing'
                    : 'Payment Status',
            textAlign: TextAlign.center,
            style: const TextStyle(
              fontWeight: FontWeight.w800,
            ),
          ),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  responseMessage(
                    responseData,
                    fallback: pending
                        ? 'The electricity request is awaiting confirmation.'
                        : 'Electricity payment completed.',
                  ),
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: 18),
                _ReceiptRow(
                  label: 'Status',
                  value: status,
                  valueColor: statusColor,
                ),
                _ReceiptRow(
                  label: 'Amount',
                  value: '₦${amount.toStringAsFixed(2)}',
                ),
                _ReceiptRow(
                  label: 'Customer',
                  value: customerName,
                ),
                _ReceiptRow(
                  label: 'Meter Number',
                  value: meterNumber,
                ),
                _ReceiptRow(
                  label: 'Company',
                  value: companyShortName.isEmpty
                      ? companyName
                      : '$companyName ($companyShortName)',
                ),
                _ReceiptRow(
                  label: 'Meter Type',
                  value: meterType,
                ),
                if (meterToken.isNotEmpty)
                  _ReceiptRow(
                    label: 'Meter Token',
                    value: meterToken,
                    valueColor: primaryGreen,
                  ),
                if (units.isNotEmpty)
                  _ReceiptRow(
                    label: 'Units',
                    value: units,
                  ),
                if (reference.isNotEmpty)
                  _ReceiptRow(
                    label: 'Reference',
                    value: reference,
                  ),
                if (orderId.isNotEmpty)
                  _ReceiptRow(
                    label: 'Order ID',
                    value: orderId,
                    showDivider: false,
                  ),
                if (pending) ...[
                  const SizedBox(height: 14),
                  Container(
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: const Color(0xFFFFFBEB),
                      borderRadius: BorderRadius.circular(12),
                      border: Border.all(
                        color: const Color(0xFFFDE68A),
                      ),
                    ),
                    child: const Text(
                      'Do not make another payment for this meter until you check the Transactions page.',
                      textAlign: TextAlign.center,
                      style: TextStyle(
                        color: Color(0xFF92400E),
                        height: 1.4,
                      ),
                    ),
                  ),
                ],
              ],
            ),
          ),
          actions: [
            SizedBox(
              width: double.infinity,
              child: FilledButton(
                onPressed: () {
                  Navigator.pop(dialogContext);
                },
                style: FilledButton.styleFrom(
                  backgroundColor: statusColor,
                ),
                child: const Text('Done'),
              ),
            ),
          ],
        );
      },
    );
  }

  InputDecoration inputDecoration({
    required String label,
    required String hint,
    required IconData icon,
    Widget? suffixIcon,
    String? prefixText,
  }) {
    return InputDecoration(
      labelText: label,
      hintText: hint,
      prefixIcon: Icon(
        icon,
        color: primaryGreen,
      ),
      suffixIcon: suffixIcon,
      prefixText: prefixText,
      filled: true,
      fillColor: Colors.white,
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(14),
        borderSide: const BorderSide(
          color: Color(0xFFE5E7EB),
        ),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(14),
        borderSide: const BorderSide(
          color: primaryGreen,
          width: 1.4,
        ),
      ),
      errorBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(14),
        borderSide: const BorderSide(
          color: Color(0xFFDC2626),
        ),
      ),
      focusedErrorBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(14),
        borderSide: const BorderSide(
          color: Color(0xFFDC2626),
          width: 1.4,
        ),
      ),
    );
  }

  @override
  Widget build(
    BuildContext context,
  ) {
    return Scaffold(
      backgroundColor: const Color(0xFFF8FAFC),
      appBar: AppBar(
        backgroundColor: primaryGreen,
        foregroundColor: Colors.white,
        title: const Text(
          'Electricity Bill',
          style: TextStyle(
            fontWeight: FontWeight.w800,
          ),
        ),
      ),
      body: SafeArea(
        child: Form(
          key: formKey,
          child: ListView(
            padding: const EdgeInsets.fromLTRB(
              18,
              18,
              18,
              32,
            ),
            children: [
              Container(
                padding: const EdgeInsets.all(19),
                decoration: BoxDecoration(
                  gradient: const LinearGradient(
                    colors: [
                      Color(0xFF2E7D32),
                      Color(0xFF43A047),
                    ],
                  ),
                  borderRadius: BorderRadius.circular(20),
                ),
                child: const Row(
                  children: [
                    CircleAvatar(
                      radius: 29,
                      backgroundColor: Colors.white24,
                      child: Icon(
                        Icons.electric_bolt_rounded,
                        color: Colors.white,
                        size: 34,
                      ),
                    ),
                    SizedBox(width: 15),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'Pay Electricity Bill',
                            style: TextStyle(
                              color: Colors.white,
                              fontSize: 21,
                              fontWeight: FontWeight.bold,
                            ),
                          ),
                          SizedBox(height: 5),
                          Text(
                            'Verify the meter owner before completing payment.',
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
                'Electricity Company',
                style: TextStyle(
                  fontWeight: FontWeight.w700,
                ),
              ),
              const SizedBox(height: 8),
              DropdownButtonFormField<String>(
                initialValue: selectedDiscoCode,
                isExpanded: true,
                decoration: inputDecoration(
                  label: 'Electricity Company',
                  hint: 'Select electricity company',
                  icon: Icons.apartment_rounded,
                ),
                items: discos.map((disco) {
                  return DropdownMenuItem<String>(
                    value: disco['code'],
                    child: Text(
                      '${disco['name']} (${disco['shortName']})',
                      overflow: TextOverflow.ellipsis,
                    ),
                  );
                }).toList(),
                onChanged: isBusy
                    ? null
                    : (String? value) {
                        if (value == null) {
                          return;
                        }

                        setState(() {
                          selectedDiscoCode = value;
                          verifiedCustomerName = '';
                          verifiedMeterNumber = '';
                          verifiedDiscoCode = '';
                          verifiedMeterTypeCode = '';
                        });
                      },
              ),
              const SizedBox(height: 18),
              const Text(
                'Meter Type',
                style: TextStyle(
                  fontWeight: FontWeight.w700,
                ),
              ),
              const SizedBox(height: 8),
              DropdownButtonFormField<String>(
                initialValue: selectedMeterTypeCode,
                decoration: inputDecoration(
                  label: 'Meter Type',
                  hint: 'Select meter type',
                  icon: Icons.speed_rounded,
                ),
                items: meterTypes.map((meterType) {
                  return DropdownMenuItem<String>(
                    value: meterType['code'],
                    child: Text(
                      meterType['name'] ?? '',
                    ),
                  );
                }).toList(),
                onChanged: isBusy
                    ? null
                    : (String? value) {
                        if (value == null) {
                          return;
                        }

                        setState(() {
                          selectedMeterTypeCode = value;
                          verifiedCustomerName = '';
                          verifiedMeterNumber = '';
                          verifiedDiscoCode = '';
                          verifiedMeterTypeCode = '';
                        });
                      },
              ),
              const SizedBox(height: 18),
              const Text(
                'Meter Number',
                style: TextStyle(
                  fontWeight: FontWeight.w700,
                ),
              ),
              const SizedBox(height: 8),
              TextFormField(
                controller: meterController,
                enabled: !isBusy,
                keyboardType: TextInputType.number,
                inputFormatters: [
                  FilteringTextInputFormatter.allow(
                    RegExp(r'[A-Za-z0-9]'),
                  ),
                  LengthLimitingTextInputFormatter(20),
                ],
                validator: validateMeterNumber,
                onChanged: (_) {
                  if (verifiedCustomerName.isNotEmpty) {
                    clearMeterVerification();
                  }
                },
                decoration: inputDecoration(
                  label: 'Meter Number',
                  hint: 'Enter meter number',
                  icon: Icons.numbers_rounded,
                  suffixIcon: TextButton(
                    onPressed: isBusy ? null : verifyMeter,
                    child: isVerifyingMeter
                        ? const SizedBox(
                            width: 19,
                            height: 19,
                            child: CircularProgressIndicator(
                              strokeWidth: 2,
                              color: primaryGreen,
                            ),
                          )
                        : const Text(
                            'Verify',
                            style: TextStyle(
                              color: primaryGreen,
                              fontWeight: FontWeight.w800,
                            ),
                          ),
                  ),
                ),
              ),
              if (meterIsVerified) ...[
                const SizedBox(height: 13),
                Container(
                  padding: const EdgeInsets.all(15),
                  decoration: BoxDecoration(
                    color: const Color(0xFFF0FDF4),
                    borderRadius: BorderRadius.circular(15),
                    border: Border.all(
                      color: const Color(0xFFBBF7D0),
                    ),
                  ),
                  child: Row(
                    children: [
                      const CircleAvatar(
                        backgroundColor: Color(0xFFDCFCE7),
                        child: Icon(
                          Icons.person_rounded,
                          color: primaryGreen,
                        ),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            const Text(
                              'Meter Customer',
                              style: TextStyle(
                                color: Color(0xFF6B7280),
                                fontSize: 12,
                              ),
                            ),
                            const SizedBox(height: 3),
                            Text(
                              verifiedCustomerName,
                              style: const TextStyle(
                                fontSize: 16,
                                fontWeight: FontWeight.w900,
                              ),
                            ),
                            const SizedBox(height: 2),
                            Text(
                              '${selectedDisco['shortName']} • '
                              '${selectedMeterType['name']}',
                              style: const TextStyle(
                                color: Color(0xFF6B7280),
                              ),
                            ),
                          ],
                        ),
                      ),
                      const Icon(
                        Icons.verified_rounded,
                        color: primaryGreen,
                      ),
                    ],
                  ),
                ),
              ],
              const SizedBox(height: 18),
              const Text(
                'Phone Number',
                style: TextStyle(
                  fontWeight: FontWeight.w700,
                ),
              ),
              const SizedBox(height: 8),
              TextFormField(
                controller: phoneController,
                enabled: !isBusy,
                keyboardType: TextInputType.phone,
                maxLength: 11,
                inputFormatters: [
                  FilteringTextInputFormatter.digitsOnly,
                  LengthLimitingTextInputFormatter(11),
                ],
                validator: validatePhone,
                decoration: inputDecoration(
                  label: 'Phone Number',
                  hint: 'Enter 11-digit phone number',
                  icon: Icons.phone_outlined,
                ).copyWith(
                  counterText: '',
                ),
              ),
              const SizedBox(height: 18),
              const Text(
                'Amount',
                style: TextStyle(
                  fontWeight: FontWeight.w700,
                ),
              ),
              const SizedBox(height: 8),
              TextFormField(
                controller: amountController,
                enabled: !isBusy,
                keyboardType: const TextInputType.numberWithOptions(
                  decimal: true,
                ),
                inputFormatters: [
                  FilteringTextInputFormatter.allow(
                    RegExp(r'^\d*\.?\d{0,2}'),
                  ),
                ],
                validator: validateAmount,
                decoration: inputDecoration(
                  label: 'Electricity Amount',
                  hint: '₦1,000 — ₦200,000',
                  icon: Icons.payments_outlined,
                  prefixText: '₦ ',
                ),
              ),
              const SizedBox(height: 16),
              Container(
                padding: const EdgeInsets.all(14),
                decoration: BoxDecoration(
                  color: const Color(0xFFFFFBEB),
                  borderRadius: BorderRadius.circular(14),
                  border: Border.all(
                    color: const Color(0xFFFDE68A),
                  ),
                ),
                child: const Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Icon(
                      Icons.info_outline_rounded,
                      color: Color(0xFFD97706),
                    ),
                    SizedBox(width: 9),
                    Expanded(
                      child: Text(
                        'Minimum payment is ₦1,000. Verify the meter customer name before continuing.',
                        style: TextStyle(
                          color: Color(0xFF92400E),
                          height: 1.4,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 23),
              SizedBox(
                height: 55,
                child: FilledButton.icon(
                  onPressed: isBusy ? null : payElectricity,
                  style: FilledButton.styleFrom(
                    backgroundColor: primaryGreen,
                  ),
                  icon: isPaying
                      ? const SizedBox(
                          width: 22,
                          height: 22,
                          child: CircularProgressIndicator(
                            strokeWidth: 2.4,
                            color: Colors.white,
                          ),
                        )
                      : const Icon(
                          Icons.electric_bolt_rounded,
                        ),
                  label: Text(
                    isPaying
                        ? 'Processing Payment...'
                        : meterIsVerified
                            ? 'Pay Electricity Bill'
                            : 'Verify Meter First',
                    style: const TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                ),
              ),
              const SizedBox(height: 18),
              const Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Icon(
                    Icons.lock_outline_rounded,
                    color: Color(0xFF6B7280),
                    size: 19,
                  ),
                  SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      'Electricity payments are protected with meter verification and your transaction PIN.',
                      style: TextStyle(
                        color: Color(0xFF6B7280),
                        height: 1.4,
                      ),
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _ReceiptRow extends StatelessWidget {
  final String label;
  final String value;
  final Color? valueColor;
  final bool showDivider;

  const _ReceiptRow({
    required this.label,
    required this.value,
    this.valueColor,
    this.showDivider = true,
  });

  @override
  Widget build(
    BuildContext context,
  ) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(
        vertical: 10,
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
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 105,
            child: Text(
              label,
              style: const TextStyle(
                color: Color(0xFF6B7280),
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: SelectableText(
              value,
              textAlign: TextAlign.right,
              style: TextStyle(
                color: valueColor ?? const Color(0xFF171A18),
                fontWeight: FontWeight.w800,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

class TransferScreen extends StatefulWidget {
  const TransferScreen({super.key});

  @override
  State<TransferScreen> createState() => _TransferScreenState();
}

class _TransferScreenState extends State<TransferScreen> {
  static const String baseUrl = 'https://api.servicepay.ng/api';

  static const Color primaryGreen = Color(0xFF2E7D32);

  final GlobalKey<FormState> formKey = GlobalKey<FormState>();

  final TextEditingController phoneController = TextEditingController();

  final TextEditingController amountController = TextEditingController();

  bool isLoading = false;

  @override
  void dispose() {
    phoneController.dispose();
    amountController.dispose();
    super.dispose();
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

  String? validatePhone(
    String? value,
  ) {
    final String phone = value?.trim() ?? '';

    if (phone.isEmpty) {
      return "Enter recipient's phone number";
    }

    if (!RegExp(r'^\d+$').hasMatch(phone)) {
      return 'Phone number must contain numbers only';
    }

    if (phone.length != 11) {
      return 'Phone number must be exactly 11 digits';
    }

    return null;
  }

  String? validateAmount(
    String? value,
  ) {
    final String amountText = value?.trim() ?? '';

    if (amountText.isEmpty) {
      return 'Enter transfer amount';
    }

    final double? amount = double.tryParse(amountText);

    if (amount == null) {
      return 'Enter a valid amount';
    }

    if (amount < 100) {
      return 'Minimum transfer amount is ₦100';
    }

    return null;
  }

  Map<String, dynamic> decodeResponse(
    String responseBody,
  ) {
    if (responseBody.trim().isEmpty) {
      return {};
    }

    try {
      final dynamic decoded = jsonDecode(responseBody);

      if (decoded is Map) {
        return Map<String, dynamic>.from(
          decoded,
        );
      }
    } catch (_) {
      return {};
    }

    return {};
  }

  double? extractWalletBalance(
    Map<String, dynamic> responseData,
  ) {
    final dynamic data = responseData['data'];

    if (data is Map) {
      final dynamic sender = data['sender'];

      if (sender is Map) {
        final dynamic balance = sender['walletBalance'];

        if (balance != null) {
          return double.tryParse(
            balance.toString(),
          );
        }
      }

      final dynamic dataBalance = data['walletBalance'];

      if (dataBalance != null) {
        return double.tryParse(
          dataBalance.toString(),
        );
      }
    }

    final dynamic directBalance = responseData['walletBalance'] ??
        responseData['balance'] ??
        responseData['senderBalance'];

    if (directBalance != null) {
      return double.tryParse(
        directBalance.toString(),
      );
    }

    return null;
  }

  Future<Map<String, dynamic>?> lookupBeneficiary({
    required String phone,
    required String token,
  }) async {
    try {
      final http.Response response = await http.get(
        Uri.parse(
          '$baseUrl/transfer/beneficiary/$phone',
        ),
        headers: {
          'Accept': 'application/json',
          'Authorization': 'Bearer $token',
        },
      ).timeout(
        const Duration(
          seconds: 30,
        ),
      );

      final Map<String, dynamic> responseData = decodeResponse(response.body);

      final bool successful = response.statusCode >= 200 &&
          response.statusCode < 300 &&
          responseData['success'] == true;

      if (!successful) {
        showMessage(
          responseData['message']?.toString() ??
              'Unable to verify beneficiary.',
        );

        return null;
      }

      final dynamic data = responseData['data'];

      if (data is! Map) {
        showMessage(
          'Invalid beneficiary information received.',
        );

        return null;
      }

      final dynamic beneficiary = data['beneficiary'];

      if (beneficiary is! Map) {
        showMessage(
          'Beneficiary account was not found.',
        );

        return null;
      }

      final Map<String, dynamic> beneficiaryData = Map<String, dynamic>.from(
        beneficiary,
      );

      final String fullName =
          beneficiaryData['fullName']?.toString().trim() ?? '';

      final String beneficiaryPhone =
          beneficiaryData['phone']?.toString().trim() ?? '';

      if (fullName.isEmpty || beneficiaryPhone.isEmpty) {
        showMessage(
          'Beneficiary information is incomplete.',
        );

        return null;
      }

      return beneficiaryData;
    } catch (_) {
      showMessage(
        'Unable to verify beneficiary. Check your internet connection.',
      );

      return null;
    }
  }

  Future<String?> requestTransactionPin({
    required String beneficiaryName,
    required String receiverPhone,
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
                borderRadius: BorderRadius.circular(
                  22,
                ),
              ),
              title: const Text(
                'Confirm Transfer',
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
                      padding: const EdgeInsets.all(
                        16,
                      ),
                      decoration: BoxDecoration(
                        color: const Color(
                          0xFFF0FDF4,
                        ),
                        borderRadius: BorderRadius.circular(
                          16,
                        ),
                        border: Border.all(
                          color: const Color(
                            0xFFBBF7D0,
                          ),
                        ),
                      ),
                      child: Column(
                        children: [
                          Container(
                            width: 54,
                            height: 54,
                            decoration: const BoxDecoration(
                              color: Color(
                                0xFFDCFCE7,
                              ),
                              shape: BoxShape.circle,
                            ),
                            child: const Icon(
                              Icons.person_rounded,
                              color: primaryGreen,
                              size: 30,
                            ),
                          ),
                          const SizedBox(
                            height: 10,
                          ),
                          const Text(
                            'Beneficiary',
                            style: TextStyle(
                              color: Color(
                                0xFF6B7280,
                              ),
                              fontSize: 12,
                            ),
                          ),
                          const SizedBox(
                            height: 4,
                          ),
                          Text(
                            beneficiaryName,
                            textAlign: TextAlign.center,
                            style: const TextStyle(
                              fontSize: 18,
                              fontWeight: FontWeight.w900,
                              color: Color(
                                0xFF111827,
                              ),
                            ),
                          ),
                          const SizedBox(
                            height: 3,
                          ),
                          Text(
                            receiverPhone,
                            style: const TextStyle(
                              color: Color(
                                0xFF6B7280,
                              ),
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                          const Padding(
                            padding: EdgeInsets.symmetric(
                              vertical: 13,
                            ),
                            child: Divider(),
                          ),
                          const Text(
                            'Amount',
                            style: TextStyle(
                              color: Color(
                                0xFF6B7280,
                              ),
                              fontSize: 12,
                            ),
                          ),
                          const SizedBox(
                            height: 4,
                          ),
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
                    const SizedBox(
                      height: 20,
                    ),
                    TextField(
                      controller: pinController,
                      autofocus: true,
                      obscureText: hidePin,
                      keyboardType: TextInputType.number,
                      textInputAction: TextInputAction.done,
                      maxLength: 4,
                      inputFormatters: [
                        FilteringTextInputFormatter.digitsOnly,
                        LengthLimitingTextInputFormatter(
                          4,
                        ),
                      ],
                      onChanged: (_) {
                        if (errorMessage.isNotEmpty) {
                          setDialogState(
                            () {
                              errorMessage = '';
                            },
                          );
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
                            setDialogState(
                              () {
                                hidePin = !hidePin;
                              },
                            );
                          },
                          icon: Icon(
                            hidePin
                                ? Icons.visibility_outlined
                                : Icons.visibility_off_outlined,
                          ),
                        ),
                        errorText: errorMessage.isEmpty ? null : errorMessage,
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
                      height: 8,
                    ),
                    const Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Icon(
                          Icons.lock_outline_rounded,
                          size: 18,
                          color: Color(
                            0xFF6B7280,
                          ),
                        ),
                        SizedBox(
                          width: 7,
                        ),
                        Expanded(
                          child: Text(
                            'Confirm that the beneficiary name is correct before entering your PIN.',
                            style: TextStyle(
                              color: Color(
                                0xFF6B7280,
                              ),
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
                    Navigator.pop(
                      dialogContext,
                    );
                  },
                  child: const Text(
                    'Cancel',
                  ),
                ),
                FilledButton(
                  onPressed: submitPin,
                  style: FilledButton.styleFrom(
                    backgroundColor: primaryGreen,
                  ),
                  child: const Text(
                    'Confirm Transfer',
                  ),
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

  Future<void> transferMoney() async {
    FocusScope.of(context).unfocus();

    if (!(formKey.currentState?.validate() ?? false)) {
      return;
    }

    final String receiverPhone = phoneController.text.trim();

    final double amount = double.parse(
      amountController.text.trim(),
    );

    setState(() {
      isLoading = true;
    });

    try {
      final SharedPreferences preferences =
          await SharedPreferences.getInstance();

      final String token = preferences.getString(
            'auth_token',
          ) ??
          '';

      if (token.trim().isEmpty) {
        showMessage(
          'Your login session has expired. Please log in again.',
        );

        return;
      }

      /*
       * Verify beneficiary before asking
       * the customer for a transaction PIN.
       */
      final Map<String, dynamic>? beneficiary = await lookupBeneficiary(
        phone: receiverPhone,
        token: token,
      );

      if (beneficiary == null) {
        return;
      }

      final String beneficiaryName =
          beneficiary['fullName']?.toString().trim() ?? '';

      if (beneficiaryName.isEmpty) {
        showMessage(
          'Beneficiary name could not be verified.',
        );

        return;
      }

      if (!mounted) {
        return;
      }

      setState(() {
        isLoading = false;
      });

      final String? pin = await requestTransactionPin(
        beneficiaryName: beneficiaryName,
        receiverPhone: receiverPhone,
        amount: amount,
      );

      if (pin == null) {
        return;
      }

      if (!mounted) {
        return;
      }

      setState(() {
        isLoading = true;
      });

      final http.Response response = await http
          .post(
            Uri.parse(
              '$baseUrl/transfer/servicepay',
            ),
            headers: {
              'Accept': 'application/json',
              'Content-Type': 'application/json',
              'Authorization': 'Bearer $token',
            },
            body: jsonEncode({
              'receiverPhone': receiverPhone,
              'amount': amount,
              'pin': pin,
            }),
          )
          .timeout(
            const Duration(
              seconds: 45,
            ),
          );

      final Map<String, dynamic> responseData = decodeResponse(response.body);

      if (!mounted) {
        return;
      }

      final bool requestSuccessful = response.statusCode >= 200 &&
          response.statusCode < 300 &&
          responseData['success'] == true;

      if (!requestSuccessful) {
        showMessage(
          responseData['message']?.toString() ??
              'Transfer failed. Please try again.',
        );

        return;
      }

      final double? newBalance = extractWalletBalance(
        responseData,
      );

      if (newBalance != null) {
        await preferences.setDouble(
          'wallet_balance',
          newBalance,
        );
      }

      final dynamic data = responseData['data'];

      String reference = '';
      String confirmedReceiverName = beneficiaryName;

      if (data is Map) {
        reference = data['reference']?.toString() ?? '';

        final dynamic receiver = data['receiver'];

        if (receiver is Map) {
          final String returnedName =
              receiver['fullName']?.toString().trim() ?? '';

          if (returnedName.isNotEmpty) {
            confirmedReceiverName = returnedName;
          }
        }
      }

      phoneController.clear();
      amountController.clear();

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
              borderRadius: BorderRadius.circular(
                22,
              ),
            ),
            icon: const Icon(
              Icons.check_circle_rounded,
              color: primaryGreen,
              size: 64,
            ),
            title: const Text(
              'Transfer Successful',
              textAlign: TextAlign.center,
              style: TextStyle(
                fontWeight: FontWeight.w800,
              ),
            ),
            content: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  '₦${amount.toStringAsFixed(2)} was transferred successfully to $confirmedReceiverName.',
                  textAlign: TextAlign.center,
                ),
                const SizedBox(
                  height: 6,
                ),
                Text(
                  receiverPhone,
                  style: const TextStyle(
                    color: Color(
                      0xFF6B7280,
                    ),
                  ),
                ),
                if (reference.isNotEmpty) ...[
                  const SizedBox(
                    height: 14,
                  ),
                  Text(
                    'Reference: $reference',
                    textAlign: TextAlign.center,
                    style: const TextStyle(
                      fontSize: 12,
                      color: Color(
                        0xFF6B7280,
                      ),
                    ),
                  ),
                ],
              ],
            ),
            actions: [
              SizedBox(
                width: double.infinity,
                child: FilledButton(
                  onPressed: () {
                    Navigator.pop(
                      dialogContext,
                    );
                  },
                  style: FilledButton.styleFrom(
                    backgroundColor: primaryGreen,
                  ),
                  child: const Text(
                    'Done',
                  ),
                ),
              ),
            ],
          );
        },
      );

      if (mounted) {
        Navigator.pop(
          context,
          true,
        );
      }
    } catch (_) {
      if (!mounted) {
        return;
      }

      showMessage(
        'Unable to connect to the server. Please try again.',
      );
    } finally {
      if (mounted) {
        setState(() {
          isLoading = false;
        });
      }
    }
  }

  @override
  Widget build(
    BuildContext context,
  ) {
    return Scaffold(
      backgroundColor: const Color(0xFFF8FAFC),
      appBar: AppBar(
        title: const Text(
          'ServicePay Transfer',
        ),
        backgroundColor: primaryGreen,
        foregroundColor: Colors.white,
      ),
      body: SafeArea(
        child: Form(
          key: formKey,
          child: ListView(
            padding: const EdgeInsets.all(
              18,
            ),
            children: [
              Container(
                padding: const EdgeInsets.all(
                  20,
                ),
                decoration: BoxDecoration(
                  gradient: const LinearGradient(
                    colors: [
                      Color(
                        0xFF2E7D32,
                      ),
                      Color(
                        0xFF43A047,
                      ),
                    ],
                  ),
                  borderRadius: BorderRadius.circular(
                    20,
                  ),
                ),
                child: const Row(
                  children: [
                    CircleAvatar(
                      radius: 29,
                      backgroundColor: Colors.white24,
                      child: Icon(
                        Icons.swap_horiz,
                        color: Colors.white,
                        size: 34,
                      ),
                    ),
                    SizedBox(
                      width: 15,
                    ),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'Send Money',
                            style: TextStyle(
                              color: Colors.white,
                              fontSize: 21,
                              fontWeight: FontWeight.bold,
                            ),
                          ),
                          SizedBox(
                            height: 5,
                          ),
                          Text(
                            'Transfer money instantly to another ServicePay user.',
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
              const SizedBox(
                height: 28,
              ),
              const Text(
                'Recipient Phone Number',
                style: TextStyle(
                  fontSize: 16,
                  fontWeight: FontWeight.w600,
                ),
              ),
              const SizedBox(
                height: 9,
              ),
              TextFormField(
                controller: phoneController,
                enabled: !isLoading,
                keyboardType: TextInputType.phone,
                maxLength: 11,
                inputFormatters: [
                  FilteringTextInputFormatter.digitsOnly,
                  LengthLimitingTextInputFormatter(
                    11,
                  ),
                ],
                validator: validatePhone,
                decoration: InputDecoration(
                  labelText: 'Phone Number',
                  hintText: "Enter recipient's phone number",
                  counterText: '',
                  prefixIcon: const Icon(
                    Icons.phone_outlined,
                    color: primaryGreen,
                  ),
                  filled: true,
                  fillColor: Colors.white,
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(
                      14,
                    ),
                  ),
                ),
              ),
              const SizedBox(
                height: 20,
              ),
              const Text(
                'Amount',
                style: TextStyle(
                  fontSize: 16,
                  fontWeight: FontWeight.w600,
                ),
              ),
              const SizedBox(
                height: 9,
              ),
              TextFormField(
                controller: amountController,
                enabled: !isLoading,
                keyboardType: const TextInputType.numberWithOptions(
                  decimal: true,
                ),
                inputFormatters: [
                  FilteringTextInputFormatter.allow(
                    RegExp(
                      r'^\d*\.?\d{0,2}',
                    ),
                  ),
                ],
                validator: validateAmount,
                decoration: InputDecoration(
                  labelText: 'Transfer Amount',
                  hintText: 'Enter amount',
                  prefixText: '₦ ',
                  prefixIcon: const Icon(
                    Icons.payments_outlined,
                    color: primaryGreen,
                  ),
                  filled: true,
                  fillColor: Colors.white,
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(
                      14,
                    ),
                  ),
                ),
              ),
              const SizedBox(
                height: 18,
              ),
              Container(
                padding: const EdgeInsets.all(
                  15,
                ),
                decoration: BoxDecoration(
                  color: const Color(
                    0xFFF0FDF4,
                  ),
                  borderRadius: BorderRadius.circular(
                    14,
                  ),
                  border: Border.all(
                    color: const Color(
                      0xFFBBF7D0,
                    ),
                  ),
                ),
                child: const Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Icon(
                      Icons.verified_user_outlined,
                      color: primaryGreen,
                    ),
                    SizedBox(
                      width: 10,
                    ),
                    Expanded(
                      child: Text(
                        'The beneficiary name will be verified and displayed before you enter your transaction PIN.',
                        style: TextStyle(
                          height: 1.4,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(
                height: 25,
              ),
              SizedBox(
                height: 55,
                child: FilledButton.icon(
                  onPressed: isLoading ? null : transferMoney,
                  style: FilledButton.styleFrom(
                    backgroundColor: primaryGreen,
                  ),
                  icon: isLoading
                      ? const SizedBox(
                          width: 22,
                          height: 22,
                          child: CircularProgressIndicator(
                            strokeWidth: 2.5,
                            color: Colors.white,
                          ),
                        )
                      : const Icon(
                          Icons.send_outlined,
                        ),
                  label: Text(
                    isLoading ? 'Verifying...' : 'Transfer Money',
                    style: const TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                ),
              ),
              const SizedBox(
                height: 20,
              ),
              const Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Icon(
                    Icons.lock_outline,
                    color: Color(
                      0xFF6B7280,
                    ),
                    size: 20,
                  ),
                  SizedBox(
                    width: 8,
                  ),
                  Expanded(
                    child: Text(
                      'ServicePay-to-ServicePay transfers are protected with beneficiary verification and your transaction PIN.',
                      style: TextStyle(
                        color: Color(
                          0xFF6B7280,
                        ),
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

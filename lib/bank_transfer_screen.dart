import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

class BankTransferScreen extends StatefulWidget {
  const BankTransferScreen({super.key});

  @override
  State<BankTransferScreen> createState() => _BankTransferScreenState();
}

class _BankTransferScreenState extends State<BankTransferScreen> {
  static const String baseUrl = 'https://api.servicepay.ng/api';
  static const Color primaryGreen = Color(0xFF149B8F);

  final GlobalKey<FormState> formKey = GlobalKey<FormState>();

  final TextEditingController accountNumberController = TextEditingController();

  final TextEditingController amountController = TextEditingController();

  final TextEditingController narrationController = TextEditingController(
    text: 'ServicePay bank transfer',
  );

  bool isLoadingBanks = true;
  bool isResolvingAccount = false;
  bool isTransferring = false;

  String errorMessage = '';

  String? selectedBankCode;
  String selectedBankName = '';

  String verifiedAccountName = '';
  String verifiedAccountNumber = '';
  String verifiedBankCode = '';

  List<Map<String, dynamic>> banks = [];

  @override
  void initState() {
    super.initState();
    loadBanks();
  }

  @override
  void dispose() {
    accountNumberController.dispose();
    amountController.dispose();
    narrationController.dispose();
    super.dispose();
  }

  Future<String?> getSavedAuthToken() async {
    final SharedPreferences preferences = await SharedPreferences.getInstance();

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

      await preferences.setString(
        'auth_token',
        token,
      );

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
    } catch (_) {
      // Return the standard error below.
    }

    return {
      'success': false,
      'message': 'The server returned an invalid response.',
    };
  }

  String getResponseMessage(
    Map<String, dynamic> data, {
    required String fallback,
  }) {
    final dynamic value = data['message'] ?? data['error'] ?? data['detail'];

    final String message = value?.toString().trim() ?? '';

    return message.isEmpty ? fallback : message;
  }

  List<Map<String, dynamic>> extractBanks(
    Map<String, dynamic> responseData,
  ) {
    dynamic rawBanks = responseData['banks'] ??
        responseData['records'] ??
        responseData['items'];

    final dynamic nestedData = responseData['data'];

    if (rawBanks == null && nestedData is Map) {
      final Map<String, dynamic> nested = Map<String, dynamic>.from(nestedData);

      rawBanks = nested['banks'] ?? nested['records'] ?? nested['items'];
    }

    if (rawBanks == null && nestedData is List) {
      rawBanks = nestedData;
    }

    if (rawBanks is! List) {
      return [];
    }

    final List<Map<String, dynamic>> result = [];

    for (final dynamic item in rawBanks) {
      if (item is! Map) {
        continue;
      }

      final Map<String, dynamic> bank = Map<String, dynamic>.from(item);

      final String code = (bank['code'] ??
              bank['bankCode'] ??
              bank['bank_code'] ??
              bank['nipCode'] ??
              '')
          .toString()
          .trim();

      final String name = (bank['name'] ??
              bank['bankName'] ??
              bank['bank_name'] ??
              bank['description'] ??
              '')
          .toString()
          .trim();

      if (code.isEmpty || name.isEmpty) {
        continue;
      }

      result.add({
        'code': code,
        'name': name,
      });
    }

    result.sort(
      (first, second) =>
          first['name'].toString().compareTo(second['name'].toString()),
    );

    return result;
  }

  Future<void> loadBanks() async {
    if (mounted) {
      setState(() {
        isLoadingBanks = true;
        errorMessage = '';
      });
    }

    try {
      final String? token = await getSavedAuthToken();

      if (token == null || token.isEmpty) {
        throw Exception(
          'Your login session has expired. Please log in again.',
        );
      }

      final http.Response response = await http.get(
        Uri.parse('$baseUrl/transfer/banks'),
        headers: {
          'Accept': 'application/json',
          'Authorization': 'Bearer $token',
        },
      ).timeout(
        const Duration(seconds: 45),
      );

      final Map<String, dynamic> responseData = decodeResponse(response);

      final bool successful = response.statusCode >= 200 &&
          response.statusCode < 300 &&
          responseData['success'] == true;

      if (!successful) {
        throw Exception(
          getResponseMessage(
            responseData,
            fallback: 'Unable to retrieve Nigerian banks.',
          ),
        );
      }

      final List<Map<String, dynamic>> loadedBanks = extractBanks(responseData);

      if (loadedBanks.isEmpty) {
        throw Exception(
          'No supported banks were returned by the server.',
        );
      }

      if (!mounted) {
        return;
      }

      setState(() {
        banks = loadedBanks;

        selectedBankCode = loadedBanks.first['code']?.toString();

        selectedBankName = loadedBanks.first['name']?.toString() ?? '';
      });
    } on TimeoutException {
      if (mounted) {
        setState(() {
          errorMessage = 'The bank-list request timed out. Please try again.';
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
          isLoadingBanks = false;
        });
      }
    }
  }

  String? validateAccountNumber(String? value) {
    final String accountNumber = value?.trim() ?? '';

    if (accountNumber.isEmpty) {
      return 'Enter the beneficiary account number';
    }

    if (!RegExp(r'^\d{10}$').hasMatch(accountNumber)) {
      return 'Account number must contain exactly 10 digits';
    }

    return null;
  }

  String? validateAmount(String? value) {
    final String amountText = value?.trim() ?? '';

    if (amountText.isEmpty) {
      return 'Enter transfer amount';
    }

    final double? amount = double.tryParse(amountText);

    if (amount == null) {
      return 'Enter a valid amount';
    }

    if (amount < 100) {
      return 'Minimum bank transfer amount is ₦100';
    }

    if (amount > 50000) {
      return 'Maximum transfer amount is currently ₦50,000';
    }

    return null;
  }

  void clearVerifiedAccount() {
    verifiedAccountName = '';
    verifiedAccountNumber = '';
    verifiedBankCode = '';
  }

  Future<void> resolveAccount() async {
    FocusScope.of(context).unfocus();

    final String? accountError =
        validateAccountNumber(accountNumberController.text);

    if (accountError != null) {
      showMessage(accountError);
      return;
    }

    if (selectedBankCode == null || selectedBankCode!.trim().isEmpty) {
      showMessage('Select the beneficiary bank.');
      return;
    }

    if (isResolvingAccount || isTransferring) {
      return;
    }

    setState(() {
      isResolvingAccount = true;
      clearVerifiedAccount();
    });

    try {
      final String? token = await getSavedAuthToken();

      if (token == null || token.isEmpty) {
        showMessage(
          'Your login session has expired. Please log in again.',
        );
        return;
      }

      final String accountNumber = accountNumberController.text.trim();

      final http.Response response = await http
          .post(
            Uri.parse(
              '$baseUrl/transfer/bank/resolve-account',
            ),
            headers: {
              'Accept': 'application/json',
              'Content-Type': 'application/json',
              'Authorization': 'Bearer $token',
            },
            body: jsonEncode({
              'bankCode': selectedBankCode,
              'bank_code': selectedBankCode,
              'bankName': selectedBankName,
              'accountNumber': accountNumber,
              'account_number': accountNumber,
            }),
          )
          .timeout(
            const Duration(seconds: 50),
          );

      final Map<String, dynamic> responseData = decodeResponse(response);

      final bool successful = response.statusCode >= 200 &&
          response.statusCode < 300 &&
          responseData['success'] == true;

      if (!successful) {
        showMessage(
          getResponseMessage(
            responseData,
            fallback: 'Unable to verify the beneficiary account.',
          ),
        );
        return;
      }

      dynamic rawAccountName =
          responseData['accountName'] ?? responseData['account_name'];

      dynamic rawAccountNumber =
          responseData['accountNumber'] ?? responseData['account_number'];

      final dynamic nestedData = responseData['data'];

      if (nestedData is Map) {
        final Map<String, dynamic> nested =
            Map<String, dynamic>.from(nestedData);

        rawAccountName ??= nested['accountName'] ?? nested['account_name'];

        rawAccountNumber ??=
            nested['accountNumber'] ?? nested['account_number'];
      }

      final String accountName = rawAccountName?.toString().trim() ?? '';

      final String returnedAccountNumber =
          rawAccountNumber?.toString().trim() ?? accountNumber;

      if (accountName.isEmpty) {
        showMessage(
          'The provider did not return an account name.',
        );
        return;
      }

      if (!mounted) {
        return;
      }

      setState(() {
        verifiedAccountName = accountName;
        verifiedAccountNumber = returnedAccountNumber;
        verifiedBankCode = selectedBankCode ?? '';
      });

      showMessage(
        'Account verified successfully.',
        isError: false,
      );
    } on TimeoutException {
      showMessage(
        'Account verification timed out. Please try again.',
      );
    } catch (_) {
      showMessage(
        'Unable to connect to the account verification service.',
      );
    } finally {
      if (mounted) {
        setState(() {
          isResolvingAccount = false;
        });
      }
    }
  }

  Future<String?> requestTransactionPin({
    required double amount,
  }) async {
    final TextEditingController pinController = TextEditingController();

    bool hidePin = true;
    String errorText = '';

    final String? result = await showDialog<String>(
      context: context,
      barrierDismissible: false,
      builder: (BuildContext dialogContext) {
        return StatefulBuilder(
          builder: (
            BuildContext context,
            StateSetter setDialogState,
          ) {
            void submitPin() {
              final String pin = pinController.text.trim();

              if (!RegExp(r'^\d{4}$').hasMatch(pin)) {
                setDialogState(() {
                  errorText = 'Enter your valid 4-digit transaction PIN.';
                });
                return;
              }

              Navigator.pop(dialogContext, pin);
            }

            return AlertDialog(
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(22),
              ),
              title: const Text(
                'Confirm Bank Transfer',
                style: TextStyle(
                  fontWeight: FontWeight.w900,
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
                        color: const Color(0xFFEAF9F4),
                        borderRadius: BorderRadius.circular(16),
                      ),
                      child: Column(
                        children: [
                          const Text(
                            'Beneficiary',
                            style: TextStyle(
                              color: Color(0xFF6B7280),
                            ),
                          ),
                          const SizedBox(height: 5),
                          Text(
                            verifiedAccountName,
                            textAlign: TextAlign.center,
                            style: const TextStyle(
                              fontSize: 18,
                              fontWeight: FontWeight.w900,
                            ),
                          ),
                          const SizedBox(height: 4),
                          Text(
                            '$selectedBankName • '
                            '$verifiedAccountNumber',
                            textAlign: TextAlign.center,
                            style: const TextStyle(
                              color: Color(0xFF6B7280),
                            ),
                          ),
                          const Divider(height: 28),
                          const Text(
                            'Amount',
                            style: TextStyle(
                              color: Color(0xFF6B7280),
                            ),
                          ),
                          const SizedBox(height: 4),
                          Text(
                            formatMoney(amount),
                            style: const TextStyle(
                              color: primaryGreen,
                              fontSize: 25,
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
                      maxLength: 4,
                      inputFormatters: [
                        FilteringTextInputFormatter.digitsOnly,
                        LengthLimitingTextInputFormatter(4),
                      ],
                      onChanged: (_) {
                        if (errorText.isNotEmpty) {
                          setDialogState(() {
                            errorText = '';
                          });
                        }
                      },
                      onSubmitted: (_) {
                        submitPin();
                      },
                      decoration: InputDecoration(
                        labelText: 'Transaction PIN',
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
                        errorText: errorText.isEmpty ? null : errorText,
                        border: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(14),
                        ),
                      ),
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
                  child: const Text('Transfer'),
                ),
              ],
            );
          },
        );
      },
    );

    pinController.dispose();

    return result;
  }

  Future<void> initiateTransfer() async {
    FocusScope.of(context).unfocus();

    final bool valid = formKey.currentState?.validate() ?? false;

    if (!valid) {
      return;
    }

    if (verifiedAccountName.isEmpty ||
        verifiedAccountNumber != accountNumberController.text.trim() ||
        verifiedBankCode != selectedBankCode) {
      showMessage(
        'Verify the beneficiary account before continuing.',
      );
      return;
    }

    if (isTransferring || isResolvingAccount) {
      return;
    }

    final double amount = double.parse(amountController.text.trim());

    final String? pin = await requestTransactionPin(
      amount: amount,
    );

    if (pin == null || !mounted) {
      return;
    }

    setState(() {
      isTransferring = true;
    });

    try {
      final String? token = await getSavedAuthToken();

      if (token == null || token.isEmpty) {
        showMessage(
          'Your login session has expired. Please log in again.',
        );
        return;
      }

      final http.Response response = await http
          .post(
            Uri.parse('$baseUrl/transfer/bank'),
            headers: {
              'Accept': 'application/json',
              'Content-Type': 'application/json',
              'Authorization': 'Bearer $token',
            },
            body: jsonEncode({
              'bankCode': selectedBankCode,
              'bankName': selectedBankName,
              'accountNumber': verifiedAccountNumber,
              'accountName': verifiedAccountName,
              'amount': amount,
              'narration': narrationController.text.trim(),
              'pin': pin,
            }),
          )
          .timeout(
            const Duration(seconds: 90),
          );

      final Map<String, dynamic> responseData = decodeResponse(response);

      final dynamic balanceValue =
          responseData['walletBalance'] ?? responseData['balance'];

      final double? newBalance = double.tryParse(
        balanceValue?.toString() ?? '',
      );

      if (newBalance != null) {
        final SharedPreferences preferences =
            await SharedPreferences.getInstance();

        await preferences.setDouble(
          'wallet_balance',
          newBalance,
        );
      }

      final bool successful = response.statusCode >= 200 &&
          response.statusCode < 300 &&
          responseData['success'] == true;

      if (!successful) {
        showMessage(
          getResponseMessage(
            responseData,
            fallback: 'Bank transfer could not be completed.',
          ),
        );
        return;
      }

      if (!mounted) {
        return;
      }

      showMessage(
        getResponseMessage(
          responseData,
          fallback: 'Bank transfer submitted successfully.',
        ),
        isError: false,
      );

      accountNumberController.clear();
      amountController.clear();
      narrationController.text = 'ServicePay bank transfer';

      setState(() {
        clearVerifiedAccount();
      });
    } on TimeoutException {
      showMessage(
        'The transfer is taking longer than expected. '
        'Check your transaction history before trying again.',
      );
    } catch (_) {
      showMessage(
        'Unable to connect to the bank-transfer service.',
      );
    } finally {
      if (mounted) {
        setState(() {
          isTransferring = false;
        });
      }
    }
  }

  String formatMoney(double amount) {
    final String value = amount.toStringAsFixed(2);

    final List<String> parts = value.split('.');

    final String whole = parts.first;

    final StringBuffer formatted = StringBuffer();

    for (int index = 0; index < whole.length; index++) {
      final int remaining = whole.length - index;

      formatted.write(whole[index]);

      if (remaining > 1 && remaining % 3 == 1) {
        formatted.write(',');
      }
    }

    return '₦${formatted.toString()}.${parts.last}';
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

  Widget buildBankSelector() {
    if (isLoadingBanks) {
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
              onPressed: loadBanks,
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

    if (banks.isEmpty) {
      return const Text(
        'No supported bank is currently available.',
        textAlign: TextAlign.center,
      );
    }

    return DropdownButtonFormField<String>(
      initialValue: selectedBankCode,
      isExpanded: true,
      decoration: InputDecoration(
        labelText: 'Select Bank',
        prefixIcon: const Icon(
          Icons.account_balance_outlined,
          color: primaryGreen,
        ),
        filled: true,
        fillColor: Colors.white,
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(15),
        ),
      ),
      items: banks.map(
        (Map<String, dynamic> bank) {
          return DropdownMenuItem<String>(
            value: bank['code'].toString(),
            child: Text(
              bank['name'].toString(),
              overflow: TextOverflow.ellipsis,
            ),
          );
        },
      ).toList(),
      onChanged: isTransferring || isResolvingAccount
          ? null
          : (String? value) {
              String bankName = '';

              for (final Map<String, dynamic> bank in banks) {
                if (bank['code'].toString() == value) {
                  bankName = bank['name'].toString();
                  break;
                }
              }

              setState(() {
                selectedBankCode = value;
                selectedBankName = bankName;
                clearVerifiedAccount();
              });
            },
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF7F8FA),
      appBar: AppBar(
        title: const Text(
          'Bank Transfer',
          style: TextStyle(
            fontWeight: FontWeight.w900,
          ),
        ),
        actions: [
          IconButton(
            tooltip: 'Refresh Banks',
            onPressed: isTransferring ? null : loadBanks,
            icon: const Icon(Icons.refresh_rounded),
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: loadBanks,
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
                        Icons.account_balance_rounded,
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
                            'Transfer to Any Bank',
                            style: TextStyle(
                              color: Colors.white,
                              fontSize: 20,
                              fontWeight: FontWeight.w900,
                            ),
                          ),
                          SizedBox(height: 5),
                          Text(
                            'Verify the beneficiary name before confirming your transfer.',
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
              buildBankSelector(),
              const SizedBox(height: 14),
              TextFormField(
                controller: accountNumberController,
                enabled: !isTransferring && !isResolvingAccount,
                keyboardType: TextInputType.number,
                maxLength: 10,
                inputFormatters: [
                  FilteringTextInputFormatter.digitsOnly,
                  LengthLimitingTextInputFormatter(10),
                ],
                validator: validateAccountNumber,
                onChanged: (_) {
                  setState(() {
                    clearVerifiedAccount();
                  });
                },
                decoration: InputDecoration(
                  labelText: 'Account Number',
                  counterText: '',
                  prefixIcon: const Icon(
                    Icons.credit_card_outlined,
                    color: primaryGreen,
                  ),
                  filled: true,
                  fillColor: Colors.white,
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(15),
                  ),
                ),
              ),
              const SizedBox(height: 12),
              SizedBox(
                height: 52,
                child: OutlinedButton.icon(
                  onPressed:
                      isTransferring || isResolvingAccount || isLoadingBanks
                          ? null
                          : resolveAccount,
                  style: OutlinedButton.styleFrom(
                    foregroundColor: primaryGreen,
                    side: const BorderSide(
                      color: primaryGreen,
                    ),
                  ),
                  icon: isResolvingAccount
                      ? const SizedBox(
                          width: 20,
                          height: 20,
                          child: CircularProgressIndicator(
                            strokeWidth: 2.3,
                          ),
                        )
                      : const Icon(
                          Icons.person_search_rounded,
                        ),
                  label: Text(
                    isResolvingAccount ? 'Verifying...' : 'Verify Account Name',
                  ),
                ),
              ),
              if (verifiedAccountName.isNotEmpty) ...[
                const SizedBox(height: 14),
                Container(
                  padding: const EdgeInsets.all(16),
                  decoration: BoxDecoration(
                    color: const Color(0xFFEAF9F4),
                    borderRadius: BorderRadius.circular(16),
                    border: Border.all(
                      color: const Color(0xFFBCE5D9),
                    ),
                  ),
                  child: Row(
                    children: [
                      const Icon(
                        Icons.verified_rounded,
                        color: primaryGreen,
                        size: 32,
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            const Text(
                              'VERIFIED ACCOUNT NAME',
                              style: TextStyle(
                                color: Color(0xFF6B7280),
                                fontSize: 10,
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                            const SizedBox(height: 4),
                            Text(
                              verifiedAccountName,
                              style: const TextStyle(
                                fontSize: 17,
                                fontWeight: FontWeight.w900,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
              ],
              const SizedBox(height: 18),
              TextFormField(
                controller: amountController,
                enabled: !isTransferring,
                keyboardType: const TextInputType.numberWithOptions(
                  decimal: true,
                ),
                inputFormatters: [
                  FilteringTextInputFormatter.allow(
                    RegExp(r'^\d*\.?\d{0,2}'),
                  ),
                ],
                validator: validateAmount,
                decoration: InputDecoration(
                  labelText: 'Transfer Amount',
                  prefixText: '₦ ',
                  prefixIcon: const Icon(
                    Icons.payments_outlined,
                    color: primaryGreen,
                  ),
                  filled: true,
                  fillColor: Colors.white,
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(15),
                  ),
                ),
              ),
              const SizedBox(height: 14),
              TextFormField(
                controller: narrationController,
                enabled: !isTransferring,
                maxLength: 100,
                decoration: InputDecoration(
                  labelText: 'Narration',
                  counterText: '',
                  prefixIcon: const Icon(
                    Icons.notes_rounded,
                    color: primaryGreen,
                  ),
                  filled: true,
                  fillColor: Colors.white,
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(15),
                  ),
                ),
              ),
              const SizedBox(height: 20),
              SizedBox(
                height: 58,
                child: FilledButton.icon(
                  onPressed: isTransferring || verifiedAccountName.isEmpty
                      ? null
                      : initiateTransfer,
                  style: FilledButton.styleFrom(
                    backgroundColor: primaryGreen,
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(17),
                    ),
                  ),
                  icon: isTransferring
                      ? const SizedBox(
                          width: 22,
                          height: 22,
                          child: CircularProgressIndicator(
                            strokeWidth: 2.5,
                            color: Colors.white,
                          ),
                        )
                      : const Icon(Icons.send_rounded),
                  label: Text(
                    isTransferring ? 'Processing...' : 'Transfer Money',
                    style: const TextStyle(
                      fontSize: 17,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                ),
              ),
              const SizedBox(height: 18),
              Container(
                padding: const EdgeInsets.all(14),
                decoration: BoxDecoration(
                  color: const Color(0xFFFFF7ED),
                  borderRadius: BorderRadius.circular(14),
                  border: Border.all(
                    color: const Color(0xFFFED7AA),
                  ),
                ),
                child: const Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Icon(
                      Icons.info_outline,
                      color: Color(0xFFEA580C),
                    ),
                    SizedBox(width: 9),
                    Expanded(
                      child: Text(
                        'Confirm the account name carefully. '
                        'Live transfers remain disabled until '
                        'ServicePay completes final security testing.',
                        style: TextStyle(
                          color: Color(0xFF7C2D12),
                          height: 1.4,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

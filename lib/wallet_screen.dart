import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';
import 'package:url_launcher/url_launcher.dart';

import 'transfer_screen.dart';

class WalletScreen extends StatefulWidget {
  const WalletScreen({super.key});

  @override
  State<WalletScreen> createState() => _WalletScreenState();
}

class _WalletScreenState extends State<WalletScreen> {
  static const String baseUrl =
      'https://api.servicepay.ng/api';

  bool isLoading = true;
  bool isRefreshing = false;
  bool isFunding = false;
  bool hideBalance = false;

  double walletBalance = 0.0;

  String userName = 'Servicepay Customer';
  String userPhone = '';

  @override
  void initState() {
    super.initState();
    _loadWallet();
  }

  Future<void> _loadWallet() async {
    try {
      final SharedPreferences prefs =
          await SharedPreferences.getInstance();

      final double savedBalance =
          prefs.getDouble('wallet_balance') ?? 0.0;

      final String savedName =
          prefs.getString('user_name') ?? '';

      final String savedPhone =
          prefs.getString('user_phone') ?? '';

      if (!mounted) return;

      setState(() {
        walletBalance = savedBalance;

        userName = savedName.trim().isEmpty
            ? 'Servicepay Customer'
            : savedName.trim();

        userPhone = savedPhone.trim();

        isLoading = false;
      });

      await _refreshWallet(
        showMessage: false,
      );
    } catch (error) {
      debugPrint('Load wallet error: $error');

      if (!mounted) return;

      setState(() {
        isLoading = false;
      });
    }
  }

  Future<String?> _getToken() async {
    final SharedPreferences prefs =
        await SharedPreferences.getInstance();

    final String? token =
        prefs.getString('auth_token');

    if (token == null ||
        token.trim().isEmpty) {
      return null;
    }

    return token.trim();
  }

  Map<String, dynamic>? _decodeResponse(
    http.Response response,
  ) {
    if (response.body.trim().isEmpty) {
      return null;
    }

    try {
      final dynamic decoded =
          jsonDecode(response.body);

      if (decoded is Map<String, dynamic>) {
        return decoded;
      }

      if (decoded is Map) {
        return Map<String, dynamic>.from(
          decoded,
        );
      }
    } catch (error) {
      debugPrint(
        'Response decode error: $error',
      );
    }

    return null;
  }

  Future<void> _refreshWallet({
    bool showMessage = true,
  }) async {
    if (isRefreshing) return;

    if (mounted) {
      setState(() {
        isRefreshing = true;
      });
    }

    try {
      final String? token =
          await _getToken();

      if (token == null) {
        if (showMessage) {
          _showMessage(
            'Your login session has expired. Please log in again.',
            isError: true,
          );
        }

        return;
      }

      final Map<String, dynamic>? result =
          await _requestWalletBalance(
        token,
      );

      if (result == null) {
        if (showMessage) {
          _showMessage(
            'Unable to refresh wallet balance.',
            isError: true,
          );
        }

        return;
      }

      final double? newBalance =
          _extractWalletBalance(
        result,
      );

      if (newBalance == null) {
        final String message =
            result['message']?.toString() ??
                'Wallet balance was not found.';

        if (showMessage) {
          _showMessage(
            message,
            isError: true,
          );
        }

        return;
      }

      final SharedPreferences prefs =
          await SharedPreferences.getInstance();

      await prefs.setDouble(
        'wallet_balance',
        newBalance,
      );

      final dynamic userData =
          result['user'] ??
              result['data']?['user'];

      if (userData is Map) {
        final String? name =
            userData['fullName']?.toString() ??
                userData['name']?.toString();

        final String? phone =
            userData['phone']?.toString();

        if (name != null &&
            name.trim().isNotEmpty) {
          await prefs.setString(
            'user_name',
            name.trim(),
          );

          userName = name.trim();
        }

        if (phone != null &&
            phone.trim().isNotEmpty) {
          await prefs.setString(
            'user_phone',
            phone.trim(),
          );

          userPhone = phone.trim();
        }
      }

      if (!mounted) return;

      setState(() {
        walletBalance = newBalance;
      });

      if (showMessage) {
        _showMessage(
          'Wallet balance refreshed successfully.',
        );
      }
    } catch (error) {
      debugPrint(
        'Refresh wallet error: $error',
      );

      if (showMessage) {
        _showMessage(
          'Unable to connect to the Servicepay server.',
          isError: true,
        );
      }
    } finally {
      if (mounted) {
        setState(() {
          isRefreshing = false;
          isLoading = false;
        });
      }
    }
  }

  Future<Map<String, dynamic>?>
      _requestWalletBalance(
    String token,
  ) async {
    final List<String> endpoints = [
      '$baseUrl/wallet/balance',
      '$baseUrl/auth/me',
      '$baseUrl/users/me',
      '$baseUrl/profile',
    ];

    for (final String endpoint
        in endpoints) {
      try {
        final http.Response response =
            await http
                .get(
                  Uri.parse(endpoint),
                  headers: {
                    'Accept':
                        'application/json',
                    'Content-Type':
                        'application/json',
                    'Authorization':
                        'Bearer $token',
                  },
                )
                .timeout(
                  const Duration(
                    seconds: 20,
                  ),
                );

        final Map<String, dynamic>? body =
            _decodeResponse(response);

        if (response.statusCode >= 200 &&
            response.statusCode < 300 &&
            body != null) {
          return body;
        }

        if (response.statusCode == 401 ||
            response.statusCode == 403) {
          return body ??
              {
                'success': false,
                'message':
                    'Your login session has expired. Please log in again.',
              };
        }
      } catch (error) {
        debugPrint(
          'Wallet endpoint failed: '
          '$endpoint, $error',
        );
      }
    }

    return null;
  }

  double? _extractWalletBalance(
    Map<String, dynamic> result,
  ) {
    final dynamic data = result['data'];
    final dynamic user = result['user'];

    final List<dynamic> possibleValues = [
      result['walletBalance'],
      result['wallet_balance'],
      result['balance'],
      data is Map
          ? data['walletBalance']
          : null,
      data is Map
          ? data['wallet_balance']
          : null,
      data is Map
          ? data['balance']
          : null,
      user is Map
          ? user['walletBalance']
          : null,
      user is Map
          ? user['wallet_balance']
          : null,
      user is Map
          ? user['balance']
          : null,
    ];

    for (final dynamic value
        in possibleValues) {
      if (value is num) {
        return value.toDouble();
      }

      if (value is String) {
        final double? parsed =
            double.tryParse(
          value
              .replaceAll(',', '')
              .trim(),
        );

        if (parsed != null) {
          return parsed;
        }
      }
    }

    return null;
  }

  Future<void> _showFundingSheet() async {
    if (isFunding) return;

    final TextEditingController
        amountController =
        TextEditingController();

    final double? amount =
        await showModalBottomSheet<double>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (
        BuildContext sheetContext,
      ) {
        return Padding(
          padding: EdgeInsets.only(
            bottom: MediaQuery.of(
              sheetContext,
            ).viewInsets.bottom,
          ),
          child: Container(
            padding: const EdgeInsets.fromLTRB(
              20,
              14,
              20,
              28,
            ),
            decoration: const BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.vertical(
                top: Radius.circular(26),
              ),
            ),
            child: StatefulBuilder(
              builder: (
                BuildContext context,
                void Function(
                  void Function(),
                ) setSheetState,
              ) {
                String? amountError;

                return Column(
                  mainAxisSize:
                      MainAxisSize.min,
                  crossAxisAlignment:
                      CrossAxisAlignment.start,
                  children: [
                    Center(
                      child: Container(
                        width: 45,
                        height: 5,
                        decoration: BoxDecoration(
                          color:
                              Colors.grey.shade300,
                          borderRadius:
                              BorderRadius.circular(
                            10,
                          ),
                        ),
                      ),
                    ),
                    const SizedBox(height: 22),
                    const Text(
                      'Fund Wallet',
                      style: TextStyle(
                        fontSize: 22,
                        fontWeight:
                            FontWeight.bold,
                        color:
                            Color(0xFF17202A),
                      ),
                    ),
                    const SizedBox(height: 7),
                    const Text(
                      'Enter the amount you want to add to your Servicepay wallet.',
                      style: TextStyle(
                        fontSize: 14,
                        height: 1.45,
                        color: Colors.black54,
                      ),
                    ),
                    const SizedBox(height: 22),
                    TextField(
                      controller:
                          amountController,
                      keyboardType:
                          const TextInputType
                              .numberWithOptions(
                        decimal: true,
                      ),
                      autofocus: true,
                      decoration:
                          InputDecoration(
                        labelText: 'Amount',
                        hintText: 'Minimum ₦100',
                        prefixText: '₦ ',
                        errorText: amountError,
                        prefixIcon: const Icon(
                          Icons
                              .account_balance_wallet_outlined,
                        ),
                        border:
                            OutlineInputBorder(
                          borderRadius:
                              BorderRadius.circular(
                            15,
                          ),
                        ),
                        focusedBorder:
                            OutlineInputBorder(
                          borderRadius:
                              BorderRadius.circular(
                            15,
                          ),
                          borderSide:
                              const BorderSide(
                            color:
                                Color(0xFF075E54),
                            width: 2,
                          ),
                        ),
                      ),
                    ),
                    const SizedBox(height: 12),
                    const Row(
                      children: [
                        Icon(
                          Icons
                              .verified_user_outlined,
                          color:
                              Color(0xFF075E54),
                          size: 18,
                        ),
                        SizedBox(width: 7),
                        Expanded(
                          child: Text(
                            'Secure payment powered by Paystack.',
                            style: TextStyle(
                              fontSize: 12.5,
                              color:
                                  Colors.black54,
                            ),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 22),
                    SizedBox(
                      width: double.infinity,
                      height: 54,
                      child: FilledButton(
                        onPressed: () {
                          final String rawAmount =
                              amountController
                                  .text
                                  .replaceAll(
                                    ',',
                                    '',
                                  )
                                  .trim();

                          final double? value =
                              double.tryParse(
                            rawAmount,
                          );

                          if (value == null) {
                            setSheetState(() {
                              amountError =
                                  'Enter a valid amount.';
                            });

                            return;
                          }

                          if (value < 100) {
                            setSheetState(() {
                              amountError =
                                  'The minimum funding amount is ₦100.';
                            });

                            return;
                          }

                          Navigator.pop(
                            sheetContext,
                            value,
                          );
                        },
                        style:
                            FilledButton.styleFrom(
                          backgroundColor:
                              const Color(
                            0xFF075E54,
                          ),
                          shape:
                              RoundedRectangleBorder(
                            borderRadius:
                                BorderRadius
                                    .circular(
                              15,
                            ),
                          ),
                        ),
                        child: const Text(
                          'Continue to Payment',
                          style: TextStyle(
                            fontSize: 16,
                            fontWeight:
                                FontWeight.bold,
                          ),
                        ),
                      ),
                    ),
                  ],
                );
              },
            ),
          ),
        );
      },
    );

    amountController.dispose();

    if (amount == null || !mounted) {
      return;
    }

    await _initializeFunding(amount);
  }

  Future<void> _initializeFunding(
    double amount,
  ) async {
    if (isFunding) return;

    setState(() {
      isFunding = true;
    });

    try {
      final String? token =
          await _getToken();

      if (token == null) {
        _showMessage(
          'Your login session has expired. Please log in again.',
          isError: true,
        );

        return;
      }

      final http.Response response =
          await http
              .post(
                Uri.parse(
                  '$baseUrl/paystack/initialize',
                ),
                headers: {
                  'Accept':
                      'application/json',
                  'Content-Type':
                      'application/json',
                  'Authorization':
                      'Bearer $token',
                },
                body: jsonEncode({
                  'amount': amount,
                }),
              )
              .timeout(
                const Duration(
                  seconds: 30,
                ),
              );

      final Map<String, dynamic>? body =
          _decodeResponse(response);

      if (response.statusCode < 200 ||
          response.statusCode >= 300 ||
          body?['success'] != true) {
        _showMessage(
          body?['message']?.toString() ??
              'Unable to initialize payment.',
          isError: true,
        );

        return;
      }

      final String authorizationUrl =
          body?['authorizationUrl']
                  ?.toString() ??
              body?['authorization_url']
                  ?.toString() ??
              '';

      final String reference =
          body?['reference']?.toString() ??
              '';

      if (authorizationUrl.isEmpty ||
          reference.isEmpty) {
        _showMessage(
          'Invalid payment information was received.',
          isError: true,
        );

        return;
      }

      final Uri paymentUri =
          Uri.parse(authorizationUrl);

      final bool opened =
          await launchUrl(
        paymentUri,
        mode: LaunchMode.externalApplication,
      );

      if (!opened) {
        _showMessage(
          'Unable to open the Paystack payment page.',
          isError: true,
        );

        return;
      }

      if (!mounted) return;

      await _showPaymentConfirmationDialog(
        reference: reference,
        amount: amount,
      );
    } catch (error) {
      debugPrint(
        'Initialize funding error: $error',
      );

      _showMessage(
        'Unable to connect to the payment server.',
        isError: true,
      );
    } finally {
      if (mounted) {
        setState(() {
          isFunding = false;
        });
      }
    }
  }

  Future<void>
      _showPaymentConfirmationDialog({
    required String reference,
    required double amount,
  }) async {
    if (!mounted) return;

    final bool? shouldVerify =
        await showDialog<bool>(
      context: context,
      barrierDismissible: false,
      builder: (
        BuildContext dialogContext,
      ) {
        return AlertDialog(
          shape: RoundedRectangleBorder(
            borderRadius:
                BorderRadius.circular(20),
          ),
          icon: const CircleAvatar(
            radius: 28,
            backgroundColor:
                Color(0xFFE7F5F1),
            child: Icon(
              Icons.open_in_browser_rounded,
              color: Color(0xFF075E54),
              size: 29,
            ),
          ),
          title: const Text(
            'Complete Your Payment',
            textAlign: TextAlign.center,
          ),
          content: Text(
            'Paystack has opened in your browser.\n\n'
            'After paying ₦${_formatAmount(amount)}, return here and tap Verify Payment.',
            textAlign: TextAlign.center,
            style: const TextStyle(
              height: 1.5,
            ),
          ),
          actionsAlignment:
              MainAxisAlignment.center,
          actions: [
            TextButton(
              onPressed: () {
                Navigator.pop(
                  dialogContext,
                  false,
                );
              },
              child: const Text(
                'Cancel',
              ),
            ),
            FilledButton.icon(
              onPressed: () {
                Navigator.pop(
                  dialogContext,
                  true,
                );
              },
              style:
                  FilledButton.styleFrom(
                backgroundColor:
                    const Color(
                  0xFF075E54,
                ),
              ),
              icon: const Icon(
                Icons
                    .verified_rounded,
              ),
              label: const Text(
                'Verify Payment',
              ),
            ),
          ],
        );
      },
    );

    if (shouldVerify == true) {
      await _verifyFunding(
        reference,
      );
    }
  }

  Future<void> _verifyFunding(
    String reference,
  ) async {
    if (!mounted) return;

    setState(() {
      isFunding = true;
    });

    _showLoadingDialog(
      'Verifying your payment...',
    );

    try {
      final String? token =
          await _getToken();

      if (token == null) {
        if (mounted) {
          Navigator.of(
            context,
            rootNavigator: true,
          ).pop();
        }

        _showMessage(
          'Your login session has expired. Please log in again.',
          isError: true,
        );

        return;
      }

      final http.Response response =
          await http
              .post(
                Uri.parse(
                  '$baseUrl/paystack/verify',
                ),
                headers: {
                  'Accept':
                      'application/json',
                  'Content-Type':
                      'application/json',
                  'Authorization':
                      'Bearer $token',
                },
                body: jsonEncode({
                  'reference': reference,
                }),
              )
              .timeout(
                const Duration(
                  seconds: 35,
                ),
              );

      final Map<String, dynamic>? body =
          _decodeResponse(response);

      if (mounted) {
        Navigator.of(
          context,
          rootNavigator: true,
        ).pop();
      }

      if (response.statusCode < 200 ||
          response.statusCode >= 300 ||
          body?['success'] != true) {
        _showMessage(
          body?['message']?.toString() ??
              'Payment verification failed.',
          isError: true,
        );

        return;
      }

      final double? newBalance =
          _toDouble(
        body?['walletBalance'],
      );

      final double? fundedAmount =
          _toDouble(
        body?['amount'],
      );

      if (newBalance != null) {
        final SharedPreferences prefs =
            await SharedPreferences
                .getInstance();

        await prefs.setDouble(
          'wallet_balance',
          newBalance,
        );

        if (mounted) {
          setState(() {
            walletBalance = newBalance;
          });
        }
      } else {
        await _refreshWallet(
          showMessage: false,
        );
      }

      if (!mounted) return;

      await _showFundingSuccessDialog(
        fundedAmount: fundedAmount,
        reference: reference,
        alreadyProcessed:
            body?['alreadyProcessed'] ==
                true,
      );
    } catch (error) {
      debugPrint(
        'Verify funding error: $error',
      );

      if (mounted) {
        Navigator.of(
          context,
          rootNavigator: true,
        ).pop();
      }

      _showMessage(
        'Unable to verify the payment. Please refresh your wallet and try again.',
        isError: true,
      );
    } finally {
      if (mounted) {
        setState(() {
          isFunding = false;
        });
      }
    }
  }

  void _showLoadingDialog(
    String message,
  ) {
    showDialog<void>(
      context: context,
      barrierDismissible: false,
      builder: (
        BuildContext dialogContext,
      ) {
        return PopScope(
          canPop: false,
          child: AlertDialog(
            shape: RoundedRectangleBorder(
              borderRadius:
                  BorderRadius.circular(18),
            ),
            content: Row(
              children: [
                const SizedBox(
                  width: 28,
                  height: 28,
                  child:
                      CircularProgressIndicator(
                    strokeWidth: 3,
                    color:
                        Color(0xFF075E54),
                  ),
                ),
                const SizedBox(width: 18),
                Expanded(
                  child: Text(
                    message,
                    style: const TextStyle(
                      fontSize: 15,
                    ),
                  ),
                ),
              ],
            ),
          ),
        );
      },
    );
  }

  Future<void>
      _showFundingSuccessDialog({
    required double? fundedAmount,
    required String reference,
    required bool alreadyProcessed,
  }) async {
    if (!mounted) return;

    await showDialog<void>(
      context: context,
      builder: (
        BuildContext dialogContext,
      ) {
        return AlertDialog(
          shape: RoundedRectangleBorder(
            borderRadius:
                BorderRadius.circular(22),
          ),
          icon: const CircleAvatar(
            radius: 33,
            backgroundColor:
                Color(0xFFE7F5F1),
            child: Icon(
              Icons.check_circle_rounded,
              size: 43,
              color: Color(0xFF128C7E),
            ),
          ),
          title: Text(
            alreadyProcessed
                ? 'Payment Already Verified'
                : 'Wallet Funded Successfully',
            textAlign: TextAlign.center,
          ),
          content: Column(
            mainAxisSize:
                MainAxisSize.min,
            children: [
              if (fundedAmount != null)
                Text(
                  '₦${_formatAmount(fundedAmount)}',
                  style: const TextStyle(
                    fontSize: 27,
                    fontWeight:
                        FontWeight.bold,
                    color:
                        Color(0xFF075E54),
                  ),
                ),
              const SizedBox(height: 10),
              Text(
                alreadyProcessed
                    ? 'This payment was already added to your wallet.'
                    : 'The payment has been added to your Servicepay wallet.',
                textAlign: TextAlign.center,
                style: const TextStyle(
                  height: 1.45,
                  color: Colors.black54,
                ),
              ),
              const SizedBox(height: 13),
              Text(
                'Reference: $reference',
                textAlign: TextAlign.center,
                style: const TextStyle(
                  fontSize: 11.5,
                  color: Colors.black45,
                ),
              ),
            ],
          ),
          actionsAlignment:
              MainAxisAlignment.center,
          actions: [
            FilledButton(
              onPressed: () {
                Navigator.pop(
                  dialogContext,
                );
              },
              style:
                  FilledButton.styleFrom(
                backgroundColor:
                    const Color(
                  0xFF075E54,
                ),
              ),
              child: const Text(
                'Done',
              ),
            ),
          ],
        );
      },
    );
  }

  double? _toDouble(
    dynamic value,
  ) {
    if (value is num) {
      return value.toDouble();
    }

    if (value is String) {
      return double.tryParse(
        value
            .replaceAll(',', '')
            .trim(),
      );
    }

    return null;
  }

  Future<void>
      _openTransferScreen() async {
    final bool? transferCompleted =
        await Navigator.push<bool>(
      context,
      MaterialPageRoute(
        builder: (_) =>
            const TransferScreen(),
      ),
    );

    if (!mounted) return;

    if (transferCompleted == true) {
      final SharedPreferences prefs =
          await SharedPreferences
              .getInstance();

      final double savedBalance =
          prefs.getDouble(
                'wallet_balance',
              ) ??
              0.0;

      setState(() {
        walletBalance = savedBalance;
      });

      await _refreshWallet(
        showMessage: false,
      );
    }
  }

  String _formatAmount(
    double amount,
  ) {
    final String amountText =
        amount.toStringAsFixed(2);

    final List<String> parts =
        amountText.split('.');

    final String wholeNumber =
        parts[0];

    final String decimalPart =
        parts.length > 1
            ? parts[1]
            : '00';

    final StringBuffer buffer =
        StringBuffer();

    for (
      int index = 0;
      index < wholeNumber.length;
      index++
    ) {
      if (index > 0 &&
          (wholeNumber.length -
                      index) %
                  3 ==
              0) {
        buffer.write(',');
      }

      buffer.write(
        wholeNumber[index],
      );
    }

    return '${buffer.toString()}.$decimalPart';
  }

  void _showMessage(
    String message, {
    bool isError = false,
  }) {
    if (!mounted) return;

    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(
        SnackBar(
          content: Text(message),
          backgroundColor:
              isError
                  ? Colors.red.shade700
                  : Colors.green.shade700,
          behavior:
              SnackBarBehavior.floating,
        ),
      );
  }

  Widget _buildBalanceCard() {
    return Container(
      width: double.infinity,
      padding:
          const EdgeInsets.all(22),
      decoration: BoxDecoration(
        gradient:
            const LinearGradient(
          colors: [
            Color(0xFF075E54),
            Color(0xFF128C7E),
          ],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        borderRadius:
            BorderRadius.circular(22),
        boxShadow: [
          BoxShadow(
            color:
                Colors.black.withValues(
              alpha: 0.12,
            ),
            blurRadius: 15,
            offset:
                const Offset(0, 8),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment:
            CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Expanded(
                child: Text(
                  'Available Balance',
                  style: TextStyle(
                    color:
                        Colors.white70,
                    fontSize: 15,
                    fontWeight:
                        FontWeight.w500,
                  ),
                ),
              ),
              IconButton(
                onPressed: () {
                  setState(() {
                    hideBalance =
                        !hideBalance;
                  });
                },
                tooltip: hideBalance
                    ? 'Show balance'
                    : 'Hide balance',
                icon: Icon(
                  hideBalance
                      ? Icons
                          .visibility_off_outlined
                      : Icons
                          .visibility_outlined,
                  color: Colors.white,
                ),
              ),
              IconButton(
                onPressed: isRefreshing
                    ? null
                    : () {
                        _refreshWallet();
                      },
                tooltip:
                    'Refresh balance',
                icon: isRefreshing
                    ? const SizedBox(
                        width: 20,
                        height: 20,
                        child:
                            CircularProgressIndicator(
                          strokeWidth:
                              2.2,
                          color:
                              Colors.white,
                        ),
                      )
                    : const Icon(
                        Icons
                            .refresh_rounded,
                        color:
                            Colors.white,
                      ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          AnimatedSwitcher(
            duration:
                const Duration(
              milliseconds: 220,
            ),
            child: Text(
              hideBalance
                  ? '₦ ••••••'
                  : '₦${_formatAmount(walletBalance)}',
              key: ValueKey(
                hideBalance,
              ),
              style: const TextStyle(
                color: Colors.white,
                fontSize: 33,
                fontWeight:
                    FontWeight.bold,
                letterSpacing: 0.3,
              ),
            ),
          ),
          const SizedBox(height: 22),
          Row(
            children: [
              const Icon(
                Icons
                    .account_circle_outlined,
                color: Colors.white70,
                size: 19,
              ),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  userPhone.isEmpty
                      ? userName
                      : '$userName • $userPhone',
                  maxLines: 1,
                  overflow:
                      TextOverflow.ellipsis,
                  style:
                      const TextStyle(
                    color:
                        Colors.white70,
                    fontSize: 13,
                  ),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildWalletActions() {
    return Row(
      children: [
        Expanded(
          child: _buildActionButton(
            title: 'Fund Wallet',
            icon:
                Icons.add_card_rounded,
            onTap: isFunding
                ? null
                : _showFundingSheet,
            isPrimary: true,
          ),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: _buildActionButton(
            title: 'Transfer',
            icon:
                Icons.send_rounded,
            onTap: isFunding
                ? null
                : _openTransferScreen,
            isPrimary: false,
          ),
        ),
      ],
    );
  }

  Widget _buildActionButton({
    required String title,
    required IconData icon,
    required VoidCallback? onTap,
    required bool isPrimary,
  }) {
    return SizedBox(
      height: 58,
      child: isPrimary
          ? FilledButton.icon(
              onPressed: onTap,
              style:
                  FilledButton.styleFrom(
                backgroundColor:
                    const Color(
                  0xFF075E54,
                ),
                shape:
                    RoundedRectangleBorder(
                  borderRadius:
                      BorderRadius.circular(
                    15,
                  ),
                ),
              ),
              icon: isFunding
                  ? const SizedBox(
                      width: 19,
                      height: 19,
                      child:
                          CircularProgressIndicator(
                        strokeWidth: 2,
                        color:
                            Colors.white,
                      ),
                    )
                  : Icon(icon),
              label: Text(
                isFunding
                    ? 'Please wait'
                    : title,
                style: const TextStyle(
                  fontWeight:
                      FontWeight.bold,
                ),
              ),
            )
          : OutlinedButton.icon(
              onPressed: onTap,
              style:
                  OutlinedButton.styleFrom(
                foregroundColor:
                    const Color(
                  0xFF075E54,
                ),
                side:
                    const BorderSide(
                  color:
                      Color(0xFF075E54),
                ),
                shape:
                    RoundedRectangleBorder(
                  borderRadius:
                      BorderRadius.circular(
                    15,
                  ),
                ),
              ),
              icon: Icon(icon),
              label: Text(
                title,
                style: const TextStyle(
                  fontWeight:
                      FontWeight.bold,
                ),
              ),
            ),
    );
  }

  Widget _buildTransferCard() {
    return Material(
      color: Colors.white,
      borderRadius:
          BorderRadius.circular(18),
      elevation: 1.5,
      child: InkWell(
        borderRadius:
            BorderRadius.circular(18),
        onTap: isFunding
            ? null
            : _openTransferScreen,
        child: Padding(
          padding:
              const EdgeInsets.all(18),
          child: Row(
            children: [
              Container(
                width: 54,
                height: 54,
                decoration: BoxDecoration(
                  color:
                      const Color(
                    0xFF128C7E,
                  ).withValues(
                    alpha: 0.12,
                  ),
                  borderRadius:
                      BorderRadius.circular(
                    16,
                  ),
                ),
                child: const Icon(
                  Icons
                      .swap_horiz_rounded,
                  color:
                      Color(0xFF075E54),
                  size: 30,
                ),
              ),
              const SizedBox(width: 15),
              const Expanded(
                child: Column(
                  crossAxisAlignment:
                      CrossAxisAlignment
                          .start,
                  children: [
                    Text(
                      'Servicepay Transfer',
                      style: TextStyle(
                        fontSize: 17,
                        fontWeight:
                            FontWeight.bold,
                        color:
                            Color(0xFF222222),
                      ),
                    ),
                    SizedBox(height: 5),
                    Text(
                      'Send money instantly to another Servicepay customer.',
                      style: TextStyle(
                        fontSize: 13,
                        height: 1.4,
                        color:
                            Colors.black54,
                      ),
                    ),
                  ],
                ),
              ),
              const Icon(
                Icons
                    .arrow_forward_ios_rounded,
                size: 18,
                color: Colors.black38,
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildInformationCard() {
    return Container(
      width: double.infinity,
      padding:
          const EdgeInsets.all(17),
      decoration: BoxDecoration(
        color: Colors.blue.shade50,
        borderRadius:
            BorderRadius.circular(16),
        border: Border.all(
          color:
              Colors.blue.shade100,
        ),
      ),
      child: Row(
        crossAxisAlignment:
            CrossAxisAlignment.start,
        children: [
          Icon(
            Icons
                .security_rounded,
            color:
                Colors.blue.shade700,
          ),
          const SizedBox(width: 12),
          const Expanded(
            child: Text(
              'Wallet funding is processed securely through Paystack. '
              'Always confirm that your payment is successful before verifying it.',
              style: TextStyle(
                fontSize: 13,
                height: 1.5,
                color:
                    Color(0xFF334155),
              ),
            ),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(
    BuildContext context,
  ) {
    return Scaffold(
      backgroundColor:
          const Color(0xFFF5F7F9),
      appBar: AppBar(
        title: const Text(
          'My Wallet',
          style: TextStyle(
            fontWeight:
                FontWeight.bold,
          ),
        ),
        centerTitle: false,
        elevation: 0,
        backgroundColor:
            Colors.white,
        foregroundColor:
            const Color(0xFF222222),
        actions: [
          IconButton(
            onPressed: isRefreshing
                ? null
                : () {
                    _refreshWallet();
                  },
            tooltip:
                'Refresh wallet',
            icon: const Icon(
              Icons.refresh_rounded,
            ),
          ),
        ],
      ),
      body: isLoading
          ? const Center(
              child:
                  CircularProgressIndicator(
                color:
                    Color(0xFF075E54),
              ),
            )
          : RefreshIndicator(
              color:
                  const Color(
                0xFF075E54,
              ),
              onRefresh: () {
                return _refreshWallet(
                  showMessage: false,
                );
              },
              child: ListView(
                physics:
                    const AlwaysScrollableScrollPhysics(),
                padding:
                    const EdgeInsets.fromLTRB(
                  16,
                  18,
                  16,
                  30,
                ),
                children: [
                  _buildBalanceCard(),
                  const SizedBox(
                    height: 17,
                  ),
                  _buildWalletActions(),
                  const SizedBox(
                    height: 24,
                  ),
                  const Text(
                    'Wallet Services',
                    style: TextStyle(
                      fontSize: 17,
                      fontWeight:
                          FontWeight.bold,
                      color:
                          Color(0xFF222222),
                    ),
                  ),
                  const SizedBox(
                    height: 12,
                  ),
                  _buildTransferCard(),
                  const SizedBox(
                    height: 18,
                  ),
                  _buildInformationCard(),
                ],
              ),
            ),
    );
  }
}
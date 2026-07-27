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
  static const String baseUrl = 'https://api.servicepay.ng/api';

  bool isLoading = true;
  bool isRefreshing = false;
  bool isFunding = false;
  bool hideBalance = false;

  double walletBalance = 0.0;

  String userName = 'Servicepay Customer';
  String userPhone = '';

  List<dynamic> transactions = [];

  @override
  void initState() {
    super.initState();
    _loadWallet();
  }

  Future<void> _loadWallet({
    bool showRefreshLoader = false,
  }) async {
    if (showRefreshLoader) {
      setState(() {
        isRefreshing = true;
      });
    } else {
      setState(() {
        isLoading = true;
      });
    }

    try {
      final SharedPreferences prefs =
          await SharedPreferences.getInstance();

      final String? token = prefs.getString('auth_token');

      final String savedName =
          prefs.getString('user_name') ??
          prefs.getString('full_name') ??
          prefs.getString('name') ??
          'Servicepay Customer';

      final String savedPhone =
          prefs.getString('user_phone') ??
          prefs.getString('phone') ??
          '';

      final double savedBalance =
          prefs.getDouble('wallet_balance') ?? 0.0;

      if (mounted) {
        setState(() {
          userName = savedName;
          userPhone = savedPhone;
          walletBalance = savedBalance;
        });
      }

      if (token == null || token.trim().isEmpty) {
        _showMessage(
          'Your login session has expired. Please sign in again.',
          isError: true,
        );
        return;
      }

      final http.Response response = await http.get(
        Uri.parse('$baseUrl/wallet'),
        headers: {
          'Accept': 'application/json',
          'Authorization': 'Bearer $token',
        },
      ).timeout(
        const Duration(seconds: 30),
      );

      final dynamic decoded = _decodeResponse(response.body);

      if (response.statusCode >= 200 &&
          response.statusCode < 300) {
        final double newBalance =
            _extractBalance(decoded) ?? savedBalance;

        final List<dynamic> newTransactions =
            _extractTransactions(decoded);

        await prefs.setDouble(
          'wallet_balance',
          newBalance,
        );

        if (!mounted) return;

        setState(() {
          walletBalance = newBalance;
          transactions = newTransactions;
        });
      } else {
        final String message = _extractMessage(
          decoded,
          fallback: 'Unable to load wallet.',
        );

        _showMessage(
          message,
          isError: true,
        );
      }
    } catch (error) {
      _showMessage(
        'Unable to connect to Servicepay. Please check your internet connection.',
        isError: true,
      );
    } finally {
      if (!mounted) return;

      setState(() {
        isLoading = false;
        isRefreshing = false;
      });
    }
  }

  dynamic _decodeResponse(String body) {
    if (body.trim().isEmpty) {
      return null;
    }

    try {
      return jsonDecode(body);
    } catch (_) {
      return null;
    }
  }

  double? _extractBalance(dynamic data) {
    if (data is! Map) {
      return null;
    }

    final List<dynamic> possibleValues = [
      data['walletBalance'],
      data['wallet_balance'],
      data['balance'],
      data['availableBalance'],
      data['available_balance'],
      data['data'] is Map
          ? data['data']['walletBalance']
          : null,
      data['data'] is Map
          ? data['data']['wallet_balance']
          : null,
      data['data'] is Map
          ? data['data']['balance']
          : null,
      data['wallet'] is Map
          ? data['wallet']['balance']
          : null,
      data['user'] is Map
          ? data['user']['walletBalance']
          : null,
      data['user'] is Map
          ? data['user']['balance']
          : null,
    ];

    for (final dynamic value in possibleValues) {
      final double? parsed = _toDouble(value);

      if (parsed != null) {
        return parsed;
      }
    }

    return null;
  }

  List<dynamic> _extractTransactions(dynamic data) {
    if (data is! Map) {
      return [];
    }

    final dynamic directTransactions =
        data['transactions'];

    if (directTransactions is List) {
      return directTransactions;
    }

    final dynamic responseData = data['data'];

    if (responseData is Map) {
      final dynamic nestedTransactions =
          responseData['transactions'];

      if (nestedTransactions is List) {
        return nestedTransactions;
      }
    }

    if (responseData is List) {
      return responseData;
    }

    return [];
  }

  double? _toDouble(dynamic value) {
    if (value == null) {
      return null;
    }

    if (value is num) {
      return value.toDouble();
    }

    return double.tryParse(
      value.toString().replaceAll(',', '').trim(),
    );
  }

  String _extractMessage(
    dynamic data, {
    required String fallback,
  }) {
    if (data is Map) {
      final dynamic message =
          data['message'] ??
          data['error'] ??
          data['detail'];

      if (message != null &&
          message.toString().trim().isNotEmpty) {
        return message.toString();
      }
    }

    return fallback;
  }

  Future<void> _fundWallet() async {
    if (isFunding) return;

    setState(() {
      isFunding = true;
    });

    try {
      final SharedPreferences prefs =
          await SharedPreferences.getInstance();

      final String? token = prefs.getString('auth_token');

      if (token == null || token.trim().isEmpty) {
        _showMessage(
          'Your login session has expired. Please sign in again.',
          isError: true,
        );
        return;
      }

      final double? amount = await _showAmountDialog();

      if (amount == null) {
        return;
      }

      if (amount < 100) {
        _showMessage(
          'Minimum wallet funding amount is ₦100.',
          isError: true,
        );
        return;
      }

      final http.Response response = await http.post(
        Uri.parse('$baseUrl/paystack/initialize'),
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Authorization': 'Bearer $token',
        },
        body: jsonEncode({
          'amount': amount,
        }),
      ).timeout(
        const Duration(seconds: 30),
      );

      final dynamic decoded = _decodeResponse(response.body);

      if (response.statusCode >= 200 &&
          response.statusCode < 300) {
        final String? paymentUrl =
            _extractPaymentUrl(decoded);

        if (paymentUrl == null ||
            paymentUrl.trim().isEmpty) {
          _showMessage(
            'Payment link was not returned by the server.',
            isError: true,
          );
          return;
        }

        final Uri paymentUri = Uri.parse(paymentUrl);

        final bool opened = await launchUrl(
          paymentUri,
          mode: LaunchMode.externalApplication,
        );

        if (!opened) {
          _showMessage(
            'Unable to open the payment page.',
            isError: true,
          );
          return;
        }

        _showMessage(
          'Complete your payment, then return and refresh your wallet.',
          isError: false,
        );
      } else {
        final String message = _extractMessage(
          decoded,
          fallback:
              'Unable to initialize wallet funding.',
        );

        _showMessage(
          message,
          isError: true,
        );
      }
    } catch (error) {
      _showMessage(
        'Unable to start wallet funding. Please try again.',
        isError: true,
      );
    } finally {
      if (!mounted) return;

      setState(() {
        isFunding = false;
      });
    }
  }

  String? _extractPaymentUrl(dynamic data) {
    if (data is! Map) {
      return null;
    }

    final List<dynamic> possibleUrls = [
      data['authorization_url'],
      data['authorizationUrl'],
      data['paymentUrl'],
      data['payment_url'],
      data['url'],
      data['data'] is Map
          ? data['data']['authorization_url']
          : null,
      data['data'] is Map
          ? data['data']['authorizationUrl']
          : null,
      data['data'] is Map
          ? data['data']['paymentUrl']
          : null,
      data['data'] is Map
          ? data['data']['url']
          : null,
    ];

    for (final dynamic value in possibleUrls) {
      if (value != null &&
          value.toString().trim().isNotEmpty) {
        return value.toString();
      }
    }

    return null;
  }

  Future<double?> _showAmountDialog() async {
    final TextEditingController amountController =
        TextEditingController();

    final double? result = await showDialog<double>(
      context: context,
      barrierDismissible: false,
      builder: (BuildContext dialogContext) {
        return AlertDialog(
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(20),
          ),
          title: const Text(
            'Fund Wallet',
            style: TextStyle(
              fontWeight: FontWeight.w800,
            ),
          ),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment:
                CrossAxisAlignment.start,
            children: [
              const Text(
                'Enter the amount you want to add to your Servicepay wallet.',
                style: TextStyle(
                  color: Color(0xFF64748B),
                  height: 1.4,
                ),
              ),
              const SizedBox(height: 18),
              TextField(
                controller: amountController,
                keyboardType:
                    const TextInputType.numberWithOptions(
                  decimal: true,
                ),
                autofocus: true,
                decoration: InputDecoration(
                  labelText: 'Amount',
                  hintText: 'Minimum ₦100',
                  prefixText: '₦ ',
                  border: OutlineInputBorder(
                    borderRadius:
                        BorderRadius.circular(14),
                  ),
                  enabledBorder: OutlineInputBorder(
                    borderRadius:
                        BorderRadius.circular(14),
                    borderSide: const BorderSide(
                      color: Color(0xFFE2E8F0),
                    ),
                  ),
                  focusedBorder: OutlineInputBorder(
                    borderRadius:
                        BorderRadius.circular(14),
                    borderSide: const BorderSide(
                      color: Color(0xFF0F766E),
                      width: 2,
                    ),
                  ),
                ),
              ),
            ],
          ),
          actions: [
            TextButton(
              onPressed: () {
                Navigator.pop(dialogContext);
              },
              child: const Text('Cancel'),
            ),
            FilledButton(
              onPressed: () {
                final String cleanedAmount =
                    amountController.text
                        .replaceAll(',', '')
                        .replaceAll('₦', '')
                        .trim();

                final double? amount =
                    double.tryParse(cleanedAmount);

                if (amount == null || amount <= 0) {
                  ScaffoldMessenger.of(context)
                    ..hideCurrentSnackBar()
                    ..showSnackBar(
                      const SnackBar(
                        content: Text(
                          'Enter a valid amount.',
                        ),
                        backgroundColor:
                            Color(0xFFDC2626),
                      ),
                    );
                  return;
                }

                Navigator.pop(
                  dialogContext,
                  amount,
                );
              },
              style: FilledButton.styleFrom(
                backgroundColor:
                    const Color(0xFF0F766E),
              ),
              child: const Text('Continue'),
            ),
          ],
        );
      },
    );

    amountController.dispose();

    return result;
  }

  Future<void> _openTransferScreen() async {
    await Navigator.push(
      context,
      MaterialPageRoute(
        builder: (_) => const TransferScreen(),
      ),
    );

    await _loadWallet(
      showRefreshLoader: true,
    );
  }

  void _showMessage(
    String message, {
    required bool isError,
  }) {
    if (!mounted) return;

    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(
        SnackBar(
          content: Text(message),
          backgroundColor: isError
              ? const Color(0xFFDC2626)
              : const Color(0xFF059669),
          behavior: SnackBarBehavior.floating,
        ),
      );
  }

  String _formatMoney(double amount) {
    final String fixed =
        amount.toStringAsFixed(2);

    final List<String> parts = fixed.split('.');
    final String whole = parts.first;
    final String decimal = parts.last;

    final StringBuffer formatted =
        StringBuffer();

    for (int index = 0;
        index < whole.length;
        index++) {
      formatted.write(whole[index]);

      final int remaining =
          whole.length - index - 1;

      if (remaining > 0 &&
          remaining % 3 == 0) {
        formatted.write(',');
      }
    }

    return '${formatted.toString()}.$decimal';
  }

  String _formatDate(dynamic value) {
    if (value == null) {
      return 'Recently';
    }

    try {
      final DateTime date =
          DateTime.parse(value.toString()).toLocal();

      final String day =
          date.day.toString().padLeft(2, '0');

      final String month =
          date.month.toString().padLeft(2, '0');

      final String year =
          date.year.toString();

      final String hour =
          date.hour.toString().padLeft(2, '0');

      final String minute =
          date.minute.toString().padLeft(2, '0');

      return '$day/$month/$year, $hour:$minute';
    } catch (_) {
      return value.toString();
    }
  }

  String _transactionTitle(dynamic transaction) {
    if (transaction is! Map) {
      return 'Wallet Transaction';
    }

    final dynamic title =
        transaction['title'] ??
        transaction['description'] ??
        transaction['serviceType'] ??
        transaction['type'];

    if (title == null ||
        title.toString().trim().isEmpty) {
      return 'Wallet Transaction';
    }

    return title
        .toString()
        .replaceAll('_', ' ')
        .toLowerCase()
        .split(' ')
        .map(
          (word) => word.isEmpty
              ? ''
              : '${word[0].toUpperCase()}${word.substring(1)}',
        )
        .join(' ');
  }

  double _transactionAmount(dynamic transaction) {
    if (transaction is! Map) {
      return 0.0;
    }

    return _toDouble(
          transaction['amount'] ??
              transaction['value'],
        ) ??
        0.0;
  }

  bool _isCreditTransaction(dynamic transaction) {
    if (transaction is! Map) {
      return false;
    }

    final String type = (
      transaction['transactionType'] ??
      transaction['type'] ??
      transaction['direction'] ??
      ''
    ).toString().toUpperCase();

    final String serviceType = (
      transaction['serviceType'] ??
      ''
    ).toString().toUpperCase();

    return type.contains('CREDIT') ||
        type.contains('INCOMING') ||
        type.contains('RECEIVED') ||
        serviceType.contains('FUNDING') ||
        serviceType.contains('DEPOSIT');
  }

  String _transactionStatus(dynamic transaction) {
    if (transaction is! Map) {
      return '';
    }

    return (
      transaction['status'] ??
      ''
    ).toString().toUpperCase();
  }

  IconData _transactionIcon(
    dynamic transaction,
  ) {
    if (_isCreditTransaction(transaction)) {
      return Icons.south_west_rounded;
    }

    return Icons.north_east_rounded;
  }

  Color _statusColor(String status) {
    switch (status) {
      case 'SUCCESS':
      case 'SUCCESSFUL':
      case 'COMPLETED':
        return const Color(0xFF059669);

      case 'FAILED':
      case 'CANCELLED':
      case 'REVERSED':
        return const Color(0xFFDC2626);

      case 'PENDING':
      case 'PROCESSING':
        return const Color(0xFFD97706);

      default:
        return const Color(0xFF64748B);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor:
          const Color(0xFFF5F7FA),
      appBar: AppBar(
        backgroundColor:
            const Color(0xFFF5F7FA),
        surfaceTintColor:
            Colors.transparent,
        elevation: 0,
        titleSpacing: 20,
        title: const Text(
          'Wallet',
          style: TextStyle(
            color: Color(0xFF0F172A),
            fontSize: 24,
            fontWeight: FontWeight.w800,
          ),
        ),
        actions: [
          IconButton(
            tooltip: 'Refresh wallet',
            onPressed: isRefreshing
                ? null
                : () {
                    _loadWallet(
                      showRefreshLoader: true,
                    );
                  },
            icon: isRefreshing
                ? const SizedBox(
                    width: 22,
                    height: 22,
                    child:
                        CircularProgressIndicator(
                      strokeWidth: 2.4,
                    ),
                  )
                : const Icon(
                    Icons.refresh_rounded,
                    color: Color(0xFF0F172A),
                  ),
          ),
          const SizedBox(width: 8),
        ],
      ),
      body: isLoading
          ? const Center(
              child: CircularProgressIndicator(
                color: Color(0xFF0F766E),
              ),
            )
          : RefreshIndicator(
              color: const Color(0xFF0F766E),
              onRefresh: () => _loadWallet(
                showRefreshLoader: true,
              ),
              child: LayoutBuilder(
                builder: (
                  BuildContext context,
                  BoxConstraints constraints,
                ) {
                  final double horizontalPadding =
                      constraints.maxWidth >= 700
                          ? 32
                          : 16;

                  final double contentWidth =
                      constraints.maxWidth >= 900
                          ? 850
                          : constraints.maxWidth;

                  return SingleChildScrollView(
                    physics:
                        const AlwaysScrollableScrollPhysics(),
                    padding: EdgeInsets.fromLTRB(
                      horizontalPadding,
                      8,
                      horizontalPadding,
                      30,
                    ),
                    child: Center(
                      child: ConstrainedBox(
                        constraints: BoxConstraints(
                          maxWidth: contentWidth,
                        ),
                        child: Column(
                          crossAxisAlignment:
                              CrossAxisAlignment.start,
                          children: [
                            _buildWalletCard(),
                            const SizedBox(height: 18),
                            _buildQuickActions(),
                            const SizedBox(height: 26),
                            _buildTransactionsSection(),
                          ],
                        ),
                      ),
                    ),
                  );
                },
              ),
            ),
    );
  }

  Widget _buildWalletCard() {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(22),
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          colors: [
            Color(0xFF0F766E),
            Color(0xFF115E59),
            Color(0xFF134E4A),
          ],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        borderRadius:
            BorderRadius.circular(26),
        boxShadow: [
          BoxShadow(
            color: const Color(0xFF0F766E)
                .withValues(alpha: 0.25),
            blurRadius: 24,
            offset: const Offset(0, 12),
          ),
        ],
      ),
      child: Stack(
        children: [
          Positioned(
            right: -35,
            top: -55,
            child: Container(
              width: 150,
              height: 150,
              decoration: BoxDecoration(
                color: Colors.white
                    .withValues(alpha: 0.06),
                shape: BoxShape.circle,
              ),
            ),
          ),
          Positioned(
            left: -45,
            bottom: -80,
            child: Container(
              width: 170,
              height: 170,
              decoration: BoxDecoration(
                color: Colors.white
                    .withValues(alpha: 0.04),
                shape: BoxShape.circle,
              ),
            ),
          ),
          Column(
            crossAxisAlignment:
                CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Container(
                    width: 46,
                    height: 46,
                    decoration: BoxDecoration(
                      color: Colors.white
                          .withValues(alpha: 0.15),
                      borderRadius:
                          BorderRadius.circular(15),
                    ),
                    child: const Icon(
                      Icons.account_balance_wallet_rounded,
                      color: Colors.white,
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment:
                          CrossAxisAlignment.start,
                      children: [
                        Text(
                          userName,
                          maxLines: 1,
                          overflow:
                              TextOverflow.ellipsis,
                          style: const TextStyle(
                            color: Colors.white,
                            fontSize: 16,
                            fontWeight:
                                FontWeight.w700,
                          ),
                        ),
                        if (userPhone.isNotEmpty)
                          Text(
                            userPhone,
                            style: TextStyle(
                              color: Colors.white
                                  .withValues(alpha: 0.72),
                              fontSize: 12,
                            ),
                          ),
                      ],
                    ),
                  ),
                  IconButton(
                    tooltip: hideBalance
                        ? 'Show balance'
                        : 'Hide balance',
                    onPressed: () {
                      setState(() {
                        hideBalance =
                            !hideBalance;
                      });
                    },
                    icon: Icon(
                      hideBalance
                          ? Icons.visibility_off_rounded
                          : Icons.visibility_rounded,
                      color: Colors.white,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 28),
              Text(
                'Available Balance',
                style: TextStyle(
                  color:
                      Colors.white.withValues(alpha: 0.75),
                  fontSize: 13,
                  fontWeight: FontWeight.w500,
                ),
              ),
              const SizedBox(height: 5),
              AnimatedSwitcher(
                duration:
                    const Duration(milliseconds: 250),
                child: Text(
                  hideBalance
                      ? '₦ ••••••••'
                      : '₦${_formatMoney(walletBalance)}',
                  key: ValueKey(hideBalance),
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 31,
                    fontWeight: FontWeight.w900,
                    letterSpacing: -0.6,
                  ),
                ),
              ),
              const SizedBox(height: 24),
              Row(
                children: [
                  Expanded(
                    child: _walletButton(
                      icon: Icons.add_rounded,
                      label: isFunding
                          ? 'Please wait'
                          : 'Fund Wallet',
                      onTap:
                          isFunding ? null : _fundWallet,
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: _walletButton(
                      icon:
                          Icons.swap_horiz_rounded,
                      label: 'Transfer',
                      onTap: _openTransferScreen,
                    ),
                  ),
                ],
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _walletButton({
    required IconData icon,
    required String label,
    required VoidCallback? onTap,
  }) {
    return Material(
      color: Colors.white.withValues(alpha: 0.14),
      borderRadius:
          BorderRadius.circular(14),
      child: InkWell(
        onTap: onTap,
        borderRadius:
            BorderRadius.circular(14),
        child: Container(
          height: 48,
          alignment: Alignment.center,
          child: Row(
            mainAxisAlignment:
                MainAxisAlignment.center,
            children: [
              if (isFunding &&
                  label == 'Please wait')
                const SizedBox(
                  width: 17,
                  height: 17,
                  child:
                      CircularProgressIndicator(
                    strokeWidth: 2,
                    color: Colors.white,
                  ),
                )
              else
                Icon(
                  icon,
                  color: Colors.white,
                  size: 21,
                ),
              const SizedBox(width: 8),
              Flexible(
                child: Text(
                  label,
                  overflow:
                      TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 13,
                    fontWeight:
                        FontWeight.w700,
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildQuickActions() {
    return Container(
      padding: const EdgeInsets.symmetric(
        vertical: 18,
        horizontal: 14,
      ),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius:
            BorderRadius.circular(22),
        border: Border.all(
          color: const Color(0xFFE8EDF3),
        ),
        boxShadow: [
          BoxShadow(
            color: Colors.black
                .withValues(alpha: 0.035),
            blurRadius: 14,
            offset: const Offset(0, 5),
          ),
        ],
      ),
      child: Row(
        children: [
          Expanded(
            child: _quickActionItem(
              icon:
                  Icons.account_balance_wallet_outlined,
              label: 'Add Money',
              background:
                  const Color(0xFFDCFCE7),
              iconColor:
                  const Color(0xFF15803D),
              onTap: _fundWallet,
            ),
          ),
          Expanded(
            child: _quickActionItem(
              icon: Icons.send_rounded,
              label: 'Send Money',
              background:
                  const Color(0xFFDBEAFE),
              iconColor:
                  const Color(0xFF1D4ED8),
              onTap: _openTransferScreen,
            ),
          ),
          Expanded(
            child: _quickActionItem(
              icon:
                  Icons.refresh_rounded,
              label: 'Refresh',
              background:
                  const Color(0xFFFEF3C7),
              iconColor:
                  const Color(0xFFB45309),
              onTap: () {
                _loadWallet(
                  showRefreshLoader: true,
                );
              },
            ),
          ),
        ],
      ),
    );
  }

  Widget _quickActionItem({
    required IconData icon,
    required String label,
    required Color background,
    required Color iconColor,
    required VoidCallback onTap,
  }) {
    return InkWell(
      onTap: onTap,
      borderRadius:
          BorderRadius.circular(16),
      child: Padding(
        padding: const EdgeInsets.symmetric(
          vertical: 5,
        ),
        child: Column(
          children: [
            Container(
              width: 47,
              height: 47,
              decoration: BoxDecoration(
                color: background,
                borderRadius:
                    BorderRadius.circular(15),
              ),
              child: Icon(
                icon,
                color: iconColor,
                size: 23,
              ),
            ),
            const SizedBox(height: 8),
            Text(
              label,
              maxLines: 1,
              overflow:
                  TextOverflow.ellipsis,
              textAlign: TextAlign.center,
              style: const TextStyle(
                color: Color(0xFF334155),
                fontSize: 12,
                fontWeight: FontWeight.w700,
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildTransactionsSection() {
    return Column(
      crossAxisAlignment:
          CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            const Expanded(
              child: Text(
                'Recent Transactions',
                style: TextStyle(
                  color: Color(0xFF0F172A),
                  fontSize: 19,
                  fontWeight: FontWeight.w800,
                ),
              ),
            ),
            TextButton(
              onPressed: () {
                _loadWallet(
                  showRefreshLoader: true,
                );
              },
              child: const Text(
                'Refresh',
                style: TextStyle(
                  color: Color(0xFF0F766E),
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
          ],
        ),
        const SizedBox(height: 10),
        if (transactions.isEmpty)
          _buildEmptyTransactions()
        else
          Container(
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius:
                  BorderRadius.circular(22),
              border: Border.all(
                color:
                    const Color(0xFFE8EDF3),
              ),
            ),
            child: ListView.separated(
              itemCount: transactions.length > 10
                  ? 10
                  : transactions.length,
              shrinkWrap: true,
              physics:
                  const NeverScrollableScrollPhysics(),
              separatorBuilder: (_, __) =>
                  const Divider(
                height: 1,
                indent: 76,
                color: Color(0xFFEEF2F6),
              ),
              itemBuilder: (
                BuildContext context,
                int index,
              ) {
                return _buildTransactionTile(
                  transactions[index],
                );
              },
            ),
          ),
      ],
    );
  }

  Widget _buildEmptyTransactions() {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(
        horizontal: 24,
        vertical: 40,
      ),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius:
            BorderRadius.circular(22),
        border: Border.all(
          color: const Color(0xFFE8EDF3),
        ),
      ),
      child: Column(
        children: [
          Container(
            width: 68,
            height: 68,
            decoration: BoxDecoration(
              color:
                  const Color(0xFFE6FFFB),
              borderRadius:
                  BorderRadius.circular(22),
            ),
            child: const Icon(
              Icons.receipt_long_rounded,
              color: Color(0xFF0F766E),
              size: 32,
            ),
          ),
          const SizedBox(height: 15),
          const Text(
            'No transactions yet',
            style: TextStyle(
              color: Color(0xFF0F172A),
              fontSize: 16,
              fontWeight: FontWeight.w800,
            ),
          ),
          const SizedBox(height: 6),
          const Text(
            'Your wallet transactions will appear here.',
            textAlign: TextAlign.center,
            style: TextStyle(
              color: Color(0xFF64748B),
              fontSize: 13,
              height: 1.4,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildTransactionTile(
    dynamic transaction,
  ) {
    final bool isCredit =
        _isCreditTransaction(transaction);

    final double amount =
        _transactionAmount(transaction);

    final String status =
        _transactionStatus(transaction);

    final dynamic dateValue =
        transaction is Map
            ? transaction['createdAt'] ??
                transaction['date'] ??
                transaction['updatedAt']
            : null;

    final Color transactionColor = isCredit
        ? const Color(0xFF059669)
        : const Color(0xFFDC2626);

    return ListTile(
      contentPadding:
          const EdgeInsets.symmetric(
        horizontal: 16,
        vertical: 9,
      ),
      leading: Container(
        width: 46,
        height: 46,
        decoration: BoxDecoration(
          color: transactionColor
              .withValues(alpha: 0.10),
          borderRadius:
              BorderRadius.circular(15),
        ),
        child: Icon(
          _transactionIcon(transaction),
          color: transactionColor,
          size: 22,
        ),
      ),
      title: Text(
        _transactionTitle(transaction),
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
        style: const TextStyle(
          color: Color(0xFF0F172A),
          fontSize: 14,
          fontWeight: FontWeight.w700,
        ),
      ),
      subtitle: Padding(
        padding:
            const EdgeInsets.only(top: 5),
        child: Row(
          children: [
            Flexible(
              child: Text(
                _formatDate(dateValue),
                overflow:
                    TextOverflow.ellipsis,
                style: const TextStyle(
                  color: Color(0xFF94A3B8),
                  fontSize: 11,
                ),
              ),
            ),
            if (status.isNotEmpty) ...[
              const SizedBox(width: 8),
              Container(
                padding:
                    const EdgeInsets.symmetric(
                  horizontal: 7,
                  vertical: 3,
                ),
                decoration: BoxDecoration(
                  color: _statusColor(status)
                      .withValues(alpha: 0.10),
                  borderRadius:
                      BorderRadius.circular(20),
                ),
                child: Text(
                  status,
                  style: TextStyle(
                    color:
                        _statusColor(status),
                    fontSize: 9,
                    fontWeight:
                        FontWeight.w800,
                  ),
                ),
              ),
            ],
          ],
        ),
      ),
      trailing: Text(
        '${isCredit ? '+' : '-'}₦${_formatMoney(amount)}',
        style: TextStyle(
          color: transactionColor,
          fontSize: 13,
          fontWeight: FontWeight.w800,
        ),
      ),
    );
  }
}
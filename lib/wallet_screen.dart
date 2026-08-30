import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

import 'manual_funding_screen.dart';
import 'qr_pay_screen.dart';
import 'transfer_screen.dart';
import 'transactions_screen.dart';
import 'withdrawal_screen.dart';

class WalletScreen extends StatefulWidget {
  const WalletScreen({super.key});

  @override
  State<WalletScreen> createState() => _WalletScreenState();
}

class _WalletScreenState extends State<WalletScreen> {
  static const String baseUrl = 'https://api.servicepay.ng/api';

  bool isLoading = true;
  bool isRefreshing = false;
  bool hideBalance = false;
  bool isUsingSavedBalance = false;

  String walletNotice = '';

  bool isVirtualAccountLoading = false;
  bool isCreatingVirtualAccount = false;

  double walletBalance = 0.0;

  String userName = 'Servicepay Customer';
  String userPhone = '';

  String virtualAccountProvider = '';
  String virtualAccountNumber = '';
  String virtualAccountName = '';
  String virtualAccountBank = '';
  String virtualAccountStatus = 'NOT_CREATED';
  String virtualAccountFailureReason = '';

  List<dynamic> transactions = [];

  bool get hasVirtualAccount {
    return virtualAccountStatus == 'ACTIVE' &&
        virtualAccountNumber.trim().isNotEmpty;
  }

  @override
  void initState() {
    super.initState();
    _loadWallet();
  }

  Future<void> _loadWallet({
    bool showRefreshLoader = false,
  }) async {
    if (!mounted) return;

    setState(() {
      if (showRefreshLoader) {
        isRefreshing = true;
      } else {
        isLoading = true;
      }
    });

    try {
      final SharedPreferences prefs = await SharedPreferences.getInstance();

      final String? token = prefs.getString('auth_token');

      final String savedName = prefs.getString('user_name') ??
          prefs.getString('full_name') ??
          prefs.getString('name') ??
          'Servicepay Customer';

      final String savedPhone =
          prefs.getString('user_phone') ?? prefs.getString('phone') ?? '';

      final double savedBalance = prefs.getDouble('wallet_balance') ?? 0.0;

      if (mounted) {
        setState(() {
          userName = savedName;
          userPhone = savedPhone;
          walletBalance = savedBalance;
          isUsingSavedBalance = true;
        });
      }

      if (token == null || token.trim().isEmpty) {
        _showMessage(
          'Your login session is unavailable. Please sign in again.',
          isError: true,
        );
        if (mounted) {
          setState(() {
            walletNotice =
                'Wallet balance could not be refreshed because your session is unavailable.';
          });
        }
        return;
      }

      await Future.wait([
        _fetchWallet(
          token: token,
          prefs: prefs,
          savedBalance: savedBalance,
        ),
        _fetchVirtualAccount(
          token: token,
          showMessageOnFailure: false,
        ),
      ]);
    } on TimeoutException {
      if (mounted) {
        setState(() {
          walletNotice =
              'Wallet refresh timed out. Showing the last balance saved on this device.';
        });
      }
      _showMessage(
        'Wallet refresh timed out. Please try again.',
        isError: true,
      );
    } catch (_) {
      if (mounted) {
        setState(() {
          walletNotice =
              'Unable to connect. Showing the last balance saved on this device.';
        });
      }
      _showMessage(
        'Unable to connect to Servicepay. Your saved wallet information is still available.',
        isError: true,
      );
    } finally {
      if (mounted) {
        setState(() {
          isLoading = false;
          isRefreshing = false;
        });
      }
    }
  }

  Future<void> _fetchWallet({
    required String token,
    required SharedPreferences prefs,
    required double savedBalance,
  }) async {
    try {
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

      if (response.statusCode >= 200 && response.statusCode < 300) {
        final double newBalance = _extractBalance(decoded) ?? savedBalance;

        final List<dynamic> newTransactions = _extractTransactions(decoded);

        await prefs.setDouble(
          'wallet_balance',
          newBalance,
        );

        if (!mounted) return;

        setState(() {
          walletBalance = newBalance;
          transactions = newTransactions;
          isUsingSavedBalance = false;
          walletNotice = '';
        });
      } else {
        final String message = _extractMessage(
          decoded,
          fallback: 'Unable to refresh wallet right now.',
        );

        _showMessage(
          message,
          isError: true,
        );
        if (mounted) {
          setState(() {
            isUsingSavedBalance = true;
            walletNotice =
                '$message Showing the last balance saved on this device.';
          });
        }
      }
    } on TimeoutException {
      if (!mounted) return;
      setState(() {
        isUsingSavedBalance = true;
        walletNotice =
            'Wallet refresh timed out. Showing the last balance saved on this device.';
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        isUsingSavedBalance = true;
        walletNotice =
            'Unable to connect. Showing the last balance saved on this device.';
      });
    }
  }

  Future<void> _fetchVirtualAccount({
    required String token,
    bool showMessageOnFailure = true,
  }) async {
    if (!mounted) return;

    setState(() {
      isVirtualAccountLoading = true;
    });

    try {
      final http.Response response = await http.get(
        Uri.parse(
          '$baseUrl/securewave/virtual-account',
        ),
        headers: {
          'Accept': 'application/json',
          'Authorization': 'Bearer $token',
        },
      ).timeout(
        const Duration(seconds: 30),
      );

      final dynamic decoded = _decodeResponse(response.body);

      if (response.statusCode >= 200 && response.statusCode < 300) {
        _applyVirtualAccountResponse(decoded);
      } else {
        final String message = _extractMessage(
          decoded,
          fallback: 'Unable to retrieve your virtual account.',
        );

        if (showMessageOnFailure) {
          _showMessage(
            message,
            isError: true,
          );
        }
      }
    } catch (_) {
      if (showMessageOnFailure) {
        _showMessage(
          'Unable to connect to the virtual account service.',
          isError: true,
        );
      }
    } finally {
      if (mounted) {
        setState(() {
          isVirtualAccountLoading = false;
        });
      }
    }
  }

  void _applyVirtualAccountResponse(
    dynamic decoded,
  ) {
    if (decoded is! Map) {
      return;
    }

    final dynamic responseData = decoded['data'];

    if (responseData is! Map) {
      return;
    }

    final dynamic accountData = responseData['virtualAccount'] ??
        responseData['virtual_account'] ??
        responseData;

    if (accountData is! Map) {
      return;
    }

    if (!mounted) return;

    setState(() {
      virtualAccountProvider = _stringValue(
        accountData['provider'],
      );

      virtualAccountNumber = _stringValue(
        accountData['accountNumber'] ?? accountData['account_number'],
      );

      virtualAccountName = _stringValue(
        accountData['accountName'] ?? accountData['account_name'],
      );

      virtualAccountBank = _stringValue(
        accountData['bankName'] ??
            accountData['bank_name'] ??
            accountData['bank'],
      );

      virtualAccountStatus = _stringValue(
        accountData['status'],
        fallback: 'NOT_CREATED',
      ).toUpperCase();

      virtualAccountFailureReason = _stringValue(
        accountData['failureReason'] ?? accountData['failure_reason'],
      );
    });
  }

  Future<void> _createVirtualAccount() async {
    if (isCreatingVirtualAccount) return;

    setState(() {
      isCreatingVirtualAccount = true;
    });

    try {
      final SharedPreferences prefs = await SharedPreferences.getInstance();

      final String token = prefs.getString('auth_token') ?? '';

      if (token.trim().isEmpty) {
        _showMessage(
          'Your login session has expired. Please sign in again.',
          isError: true,
        );
        return;
      }

      final http.Response response = await http.post(
        Uri.parse(
          '$baseUrl/securewave/virtual-account',
        ),
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          'Authorization': 'Bearer $token',
        },
      ).timeout(
        const Duration(seconds: 45),
      );

      final dynamic decoded = _decodeResponse(response.body);

      if (response.statusCode >= 200 && response.statusCode < 300) {
        final dynamic responseData = decoded is Map ? decoded['data'] : null;

        if (responseData is Map) {
          _applyDirectVirtualAccount(
            responseData,
          );
        } else {
          await _fetchVirtualAccount(
            token: token,
            showMessageOnFailure: false,
          );
        }

        _showMessage(
          _extractMessage(
            decoded,
            fallback: 'Virtual account created successfully.',
          ),
          isError: false,
        );
      } else {
        final String message = _extractMessage(
          decoded,
          fallback: 'Unable to create your virtual account.',
        );

        await _fetchVirtualAccount(
          token: token,
          showMessageOnFailure: false,
        );

        _showMessage(
          message,
          isError: true,
        );
      }
    } catch (_) {
      _showMessage(
        'Unable to connect to SecureWaveNG right now.',
        isError: true,
      );
    } finally {
      if (mounted) {
        setState(() {
          isCreatingVirtualAccount = false;
        });
      }
    }
  }

  void _applyDirectVirtualAccount(
    Map<dynamic, dynamic> accountData,
  ) {
    if (!mounted) return;

    setState(() {
      virtualAccountProvider = _stringValue(
        accountData['provider'],
      );

      virtualAccountNumber = _stringValue(
        accountData['accountNumber'] ?? accountData['account_number'],
      );

      virtualAccountName = _stringValue(
        accountData['accountName'] ?? accountData['account_name'],
      );

      virtualAccountBank = _stringValue(
        accountData['bankName'] ?? accountData['bank_name'],
      );

      virtualAccountStatus = _stringValue(
        accountData['status'],
        fallback: 'ACTIVE',
      ).toUpperCase();

      virtualAccountFailureReason = _stringValue(
        accountData['failureReason'] ?? accountData['failure_reason'],
      );
    });
  }

  Future<void> _copyAccountNumber() async {
    if (virtualAccountNumber.isEmpty) return;

    await Clipboard.setData(
      ClipboardData(
        text: virtualAccountNumber,
      ),
    );

    _showMessage(
      'Account number copied.',
      isError: false,
    );
  }

  Future<void> _fundWallet() async {
    await Navigator.push(
      context,
      MaterialPageRoute(
        builder: (_) => const ManualFundingScreen(),
      ),
    );

    if (!mounted) return;

    await _loadWallet(
      showRefreshLoader: true,
    );
  }

  Future<void> _openTransferScreen() async {
    await Navigator.push(
      context,
      MaterialPageRoute(
        builder: (_) => const TransferScreen(),
      ),
    );

    if (!mounted) return;

    await _loadWallet(
      showRefreshLoader: true,
    );
  }

  Future<void> _openWithdrawalScreen() async {
    await _openWalletDestination(const WithdrawalScreen());
  }

  Future<void> _openQrPayScreen() async {
    await _openWalletDestination(const QrPayScreen());
  }

  Future<void> _openTransactionsScreen() async {
    await _openWalletDestination(const TransactionsScreen());
  }

  Future<void> _openWalletDestination(Widget screen) async {
    await Navigator.push(
      context,
      MaterialPageRoute<void>(builder: (_) => screen),
    );

    if (!mounted) return;
    await _loadWallet(showRefreshLoader: true);
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

  String _stringValue(
    dynamic value, {
    String fallback = '',
  }) {
    if (value == null) {
      return fallback;
    }

    final String result = value.toString().trim();

    return result.isEmpty ? fallback : result;
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
      data['data'] is Map ? data['data']['walletBalance'] : null,
      data['data'] is Map ? data['data']['wallet_balance'] : null,
      data['data'] is Map ? data['data']['balance'] : null,
      data['wallet'] is Map ? data['wallet']['balance'] : null,
      data['user'] is Map ? data['user']['walletBalance'] : null,
      data['user'] is Map ? data['user']['balance'] : null,
    ];

    for (final dynamic value in possibleValues) {
      final double? parsed = _toDouble(value);

      if (parsed != null) {
        return parsed;
      }
    }

    return null;
  }

  List<dynamic> _extractTransactions(
    dynamic data,
  ) {
    if (data is! Map) {
      return [];
    }

    final dynamic directTransactions = data['transactions'];

    if (directTransactions is List) {
      return directTransactions;
    }

    final dynamic responseData = data['data'];

    if (responseData is Map) {
      final dynamic nestedTransactions = responseData['transactions'];

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
          data['message'] ?? data['error'] ?? data['detail'];

      if (message != null && message.toString().trim().isNotEmpty) {
        return message.toString();
      }
    }

    return fallback;
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
          backgroundColor:
              isError ? const Color(0xFFDC2626) : const Color(0xFF059669),
          behavior: SnackBarBehavior.floating,
        ),
      );
  }

  String _formatMoney(double amount) {
    final String fixed = amount.toStringAsFixed(2);

    final List<String> parts = fixed.split('.');

    final String whole = parts.first;
    final String decimal = parts.last;

    final StringBuffer formatted = StringBuffer();

    for (int index = 0; index < whole.length; index++) {
      formatted.write(whole[index]);

      final int remaining = whole.length - index - 1;

      if (remaining > 0 && remaining % 3 == 0) {
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
      final DateTime date = DateTime.parse(
        value.toString(),
      ).toLocal();

      final String day = date.day.toString().padLeft(2, '0');

      final String month = date.month.toString().padLeft(2, '0');

      final String hour = date.hour.toString().padLeft(2, '0');

      final String minute = date.minute.toString().padLeft(2, '0');

      return '$day/$month/${date.year}, $hour:$minute';
    } catch (_) {
      return value.toString();
    }
  }

  String _transactionTitle(
    dynamic transaction,
  ) {
    if (transaction is! Map) {
      return 'Wallet Transaction';
    }

    final dynamic title = transaction['title'] ??
        transaction['description'] ??
        transaction['serviceType'] ??
        transaction['type'];

    if (title == null || title.toString().trim().isEmpty) {
      return 'Wallet Transaction';
    }

    return title
        .toString()
        .replaceAll('_', ' ')
        .toLowerCase()
        .split(' ')
        .map(
          (String word) => word.isEmpty
              ? ''
              : '${word[0].toUpperCase()}${word.substring(1)}',
        )
        .join(' ');
  }

  double _transactionAmount(
    dynamic transaction,
  ) {
    if (transaction is! Map) {
      return 0.0;
    }

    return _toDouble(
          transaction['amount'] ?? transaction['value'],
        ) ??
        0.0;
  }

  bool _isCreditTransaction(
    dynamic transaction,
  ) {
    if (transaction is! Map) {
      return false;
    }

    final String type = (transaction['transactionType'] ??
            transaction['type'] ??
            transaction['direction'] ??
            '')
        .toString()
        .toUpperCase();

    final String serviceType =
        (transaction['serviceType'] ?? '').toString().toUpperCase();

    return type.contains('CREDIT') ||
        type.contains('INCOMING') ||
        type.contains('RECEIVED') ||
        serviceType.contains('FUNDING') ||
        serviceType.contains('DEPOSIT');
  }

  String _transactionStatus(
    dynamic transaction,
  ) {
    if (transaction is! Map) {
      return '';
    }

    return (transaction['status'] ?? '').toString().toUpperCase();
  }

  Color _statusColor(String status) {
    switch (status.toUpperCase()) {
      case 'ACTIVE':
      case 'SUCCESS':
      case 'SUCCESSFUL':
      case 'COMPLETED':
      case 'APPROVED':
        return const Color(0xFF059669);

      case 'FAILED':
      case 'CANCELLED':
      case 'REVERSED':
      case 'REJECTED':
        return const Color(0xFFDC2626);

      case 'PENDING':
      case 'PROCESSING':
        return const Color(0xFFD97706);

      default:
        return const Color(0xFF64748B);
    }
  }

  String _virtualAccountMessage() {
    switch (virtualAccountStatus) {
      case 'PENDING':
        return 'Your virtual account is being prepared. Please refresh shortly.';

      case 'FAILED':
        return virtualAccountFailureReason.isNotEmpty
            ? virtualAccountFailureReason
            : 'Virtual account creation was unsuccessful. Tap Retry to try again.';

      case 'DISABLED':
        return 'This virtual account is currently unavailable.';

      default:
        return 'Create a dedicated bank account for funding your ServicePay wallet.';
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF5F7FA),
      appBar: AppBar(
        backgroundColor: const Color(0xFFF5F7FA),
        surfaceTintColor: Colors.transparent,
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
                    child: CircularProgressIndicator(
                      strokeWidth: 2.4,
                      color: Color(0xFF0F766E),
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
                      constraints.maxWidth >= 700 ? 32 : 16;

                  final double contentWidth =
                      constraints.maxWidth >= 900 ? 850 : constraints.maxWidth;

                  return SingleChildScrollView(
                    physics: const AlwaysScrollableScrollPhysics(),
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
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            _buildWalletCard(),
                            if (walletNotice.isNotEmpty) ...[
                              const SizedBox(height: 12),
                              _buildWalletNotice(),
                            ],
                            const SizedBox(height: 18),
                            _buildVirtualAccountCard(),
                            const SizedBox(height: 18),
                            _buildQuickActions(),
                            const SizedBox(height: 18),
                            _buildAccountStatementEntry(),
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
        borderRadius: BorderRadius.circular(26),
        boxShadow: [
          BoxShadow(
            color: const Color(0xFF0F766E).withValues(alpha: 0.25),
            blurRadius: 24,
            offset: const Offset(0, 12),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 46,
                height: 46,
                decoration: BoxDecoration(
                  color: Colors.white.withValues(alpha: 0.15),
                  borderRadius: BorderRadius.circular(15),
                ),
                child: const Icon(
                  Icons.account_balance_wallet_rounded,
                  color: Colors.white,
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      userName,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: Colors.white,
                        fontSize: 16,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    if (userPhone.isNotEmpty)
                      Text(
                        userPhone,
                        style: TextStyle(
                          color: Colors.white.withValues(
                            alpha: 0.72,
                          ),
                          fontSize: 12,
                        ),
                      ),
                  ],
                ),
              ),
              IconButton(
                tooltip: hideBalance ? 'Show balance' : 'Hide balance',
                onPressed: () {
                  setState(() {
                    hideBalance = !hideBalance;
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
            isUsingSavedBalance ? 'Last Saved Balance' : 'Available Balance',
            style: TextStyle(
              color: Colors.white.withValues(
                alpha: 0.75,
              ),
              fontSize: 13,
            ),
          ),
          const SizedBox(height: 5),
          AnimatedSwitcher(
            duration: const Duration(
              milliseconds: 250,
            ),
            child: Text(
              hideBalance ? '₦ ••••••••' : '₦${_formatMoney(walletBalance)}',
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
                  label: 'Fund Wallet',
                  onTap: _fundWallet,
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: _walletButton(
                  icon: Icons.swap_horiz_rounded,
                  label: 'Transfer',
                  onTap: _openTransferScreen,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildWalletNotice() {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: const Color(0xFFFFF7ED),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: const Color(0xFFFED7AA)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Icon(
            Icons.info_outline_rounded,
            color: Color(0xFFC2410C),
            size: 20,
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              walletNotice,
              style: const TextStyle(
                color: Color(0xFF9A3412),
                fontSize: 12,
                height: 1.4,
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildVirtualAccountCard() {
    if (isVirtualAccountLoading) {
      return Container(
        width: double.infinity,
        padding: const EdgeInsets.all(22),
        decoration: _whiteCardDecoration(),
        child: const Row(
          children: [
            CircularProgressIndicator(
              strokeWidth: 2.5,
              color: Color(0xFF0F766E),
            ),
            SizedBox(width: 14),
            Expanded(
              child: Text(
                'Loading your virtual account...',
                style: TextStyle(
                  color: Color(0xFF475569),
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),
          ],
        ),
      );
    }

    if (hasVirtualAccount) {
      return Container(
        width: double.infinity,
        padding: const EdgeInsets.all(20),
        decoration: _whiteCardDecoration(),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Container(
                  width: 46,
                  height: 46,
                  decoration: BoxDecoration(
                    color: const Color(0xFFE6FFFB),
                    borderRadius: BorderRadius.circular(15),
                  ),
                  child: const Icon(
                    Icons.account_balance_rounded,
                    color: Color(0xFF0F766E),
                  ),
                ),
                const SizedBox(width: 12),
                const Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Virtual Account',
                        style: TextStyle(
                          color: Color(0xFF0F172A),
                          fontSize: 17,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                      SizedBox(height: 2),
                      Text(
                        'Transfer money here to fund your wallet.',
                        style: TextStyle(
                          color: Color(0xFF64748B),
                          fontSize: 12,
                        ),
                      ),
                    ],
                  ),
                ),
                _statusBadge(
                  virtualAccountStatus,
                ),
              ],
            ),
            const SizedBox(height: 20),
            Text(
              virtualAccountBank.isEmpty
                  ? 'SecureWaveNG Virtual Account'
                  : virtualAccountBank,
              style: const TextStyle(
                color: Color(0xFF475569),
                fontSize: 13,
                fontWeight: FontWeight.w600,
              ),
            ),
            const SizedBox(height: 7),
            Row(
              children: [
                Expanded(
                  child: Text(
                    virtualAccountNumber,
                    style: const TextStyle(
                      color: Color(0xFF0F172A),
                      fontSize: 27,
                      letterSpacing: 1.2,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                ),
                IconButton(
                  tooltip: 'Copy account number',
                  onPressed: _copyAccountNumber,
                  icon: const Icon(
                    Icons.copy_rounded,
                    color: Color(0xFF0F766E),
                  ),
                ),
              ],
            ),
            const Divider(height: 28),
            const Text(
              'Account Name',
              style: TextStyle(
                color: Color(0xFF94A3B8),
                fontSize: 11,
                fontWeight: FontWeight.w600,
              ),
            ),
            const SizedBox(height: 4),
            Text(
              virtualAccountName.isEmpty ? userName : virtualAccountName,
              style: const TextStyle(
                color: Color(0xFF334155),
                fontSize: 14,
                fontWeight: FontWeight.w700,
              ),
            ),
            const SizedBox(height: 13),
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: const Color(0xFFF0FDFA),
                borderRadius: BorderRadius.circular(13),
              ),
              child: const Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Icon(
                    Icons.info_outline_rounded,
                    size: 18,
                    color: Color(0xFF0F766E),
                  ),
                  SizedBox(width: 9),
                  Expanded(
                    child: Text(
                      'Money sent to this account will be credited to your ServicePay wallet automatically after confirmation.',
                      style: TextStyle(
                        color: Color(0xFF115E59),
                        fontSize: 12,
                        height: 1.4,
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      );
    }

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(20),
      decoration: _whiteCardDecoration(),
      child: Column(
        children: [
          Container(
            width: 62,
            height: 62,
            decoration: BoxDecoration(
              color: const Color(0xFFE6FFFB),
              borderRadius: BorderRadius.circular(20),
            ),
            child: const Icon(
              Icons.account_balance_rounded,
              color: Color(0xFF0F766E),
              size: 30,
            ),
          ),
          const SizedBox(height: 14),
          const Text(
            'Dedicated Virtual Account',
            textAlign: TextAlign.center,
            style: TextStyle(
              color: Color(0xFF0F172A),
              fontSize: 17,
              fontWeight: FontWeight.w800,
            ),
          ),
          const SizedBox(height: 7),
          Text(
            _virtualAccountMessage(),
            textAlign: TextAlign.center,
            style: const TextStyle(
              color: Color(0xFF64748B),
              fontSize: 13,
              height: 1.45,
            ),
          ),
          const SizedBox(height: 18),
          if (virtualAccountStatus != 'PENDING')
            SizedBox(
              width: double.infinity,
              child: FilledButton.icon(
                onPressed:
                    isCreatingVirtualAccount ? null : _createVirtualAccount,
                style: FilledButton.styleFrom(
                  backgroundColor: const Color(0xFF0F766E),
                  foregroundColor: Colors.white,
                  minimumSize: const Size.fromHeight(50),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(14),
                  ),
                ),
                icon: isCreatingVirtualAccount
                    ? const SizedBox(
                        width: 19,
                        height: 19,
                        child: CircularProgressIndicator(
                          strokeWidth: 2.2,
                          color: Colors.white,
                        ),
                      )
                    : const Icon(
                        Icons.add_card_rounded,
                      ),
                label: Text(
                  isCreatingVirtualAccount
                      ? 'Creating Account...'
                      : virtualAccountStatus == 'FAILED'
                          ? 'Retry Virtual Account'
                          : 'Create Virtual Account',
                  style: const TextStyle(
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }

  BoxDecoration _whiteCardDecoration() {
    return BoxDecoration(
      color: Colors.white,
      borderRadius: BorderRadius.circular(22),
      border: Border.all(
        color: const Color(0xFFE8EDF3),
      ),
      boxShadow: [
        BoxShadow(
          color: Colors.black.withValues(
            alpha: 0.035,
          ),
          blurRadius: 14,
          offset: const Offset(0, 5),
        ),
      ],
    );
  }

  Widget _statusBadge(String status) {
    final Color color = _statusColor(status);

    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: 9,
        vertical: 5,
      ),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.10),
        borderRadius: BorderRadius.circular(20),
      ),
      child: Text(
        status,
        style: TextStyle(
          color: color,
          fontSize: 9,
          fontWeight: FontWeight.w800,
        ),
      ),
    );
  }

  Widget _walletButton({
    required IconData icon,
    required String label,
    required VoidCallback? onTap,
  }) {
    return Material(
      color: Colors.white.withValues(
        alpha: 0.14,
      ),
      borderRadius: BorderRadius.circular(14),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(14),
        child: Container(
          height: 48,
          alignment: Alignment.center,
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(
                icon,
                color: Colors.white,
                size: 21,
              ),
              const SizedBox(width: 8),
              Flexible(
                child: Text(
                  label,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 13,
                    fontWeight: FontWeight.w700,
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
        vertical: 16,
        horizontal: 14,
      ),
      decoration: _whiteCardDecoration(),
      child: LayoutBuilder(
        builder: (context, constraints) {
          final double itemWidth = (constraints.maxWidth - 12) / 2;

          return Wrap(
            spacing: 12,
            runSpacing: 14,
            children: [
              SizedBox(
                width: itemWidth,
                child: _quickActionItem(
                  icon: Icons.account_balance_wallet_outlined,
                  label: 'Fund Wallet',
                  background: const Color(0xFFDCFCE7),
                  iconColor: const Color(0xFF15803D),
                  onTap: _fundWallet,
                ),
              ),
              SizedBox(
                width: itemWidth,
                child: _quickActionItem(
                  icon: Icons.send_rounded,
                  label: 'Transfer',
                  background: const Color(0xFFDBEAFE),
                  iconColor: const Color(0xFF1D4ED8),
                  onTap: _openTransferScreen,
                ),
              ),
              SizedBox(
                width: itemWidth,
                child: _quickActionItem(
                  icon: Icons.account_balance_outlined,
                  label: 'Withdraw',
                  background: const Color(0xFFFFF1E8),
                  iconColor: const Color(0xFFC2410C),
                  onTap: _openWithdrawalScreen,
                ),
              ),
              SizedBox(
                width: itemWidth,
                child: _quickActionItem(
                  icon: Icons.qr_code_scanner_rounded,
                  label: 'QR Pay',
                  background: const Color(0xFFF3E8FF),
                  iconColor: const Color(0xFF7E22CE),
                  onTap: _openQrPayScreen,
                ),
              ),
            ],
          );
        },
      ),
    );
  }

  Widget _buildAccountStatementEntry() {
    return Material(
      color: Colors.white,
      borderRadius: BorderRadius.circular(20),
      child: InkWell(
        onTap: _openTransactionsScreen,
        borderRadius: BorderRadius.circular(20),
        child: Container(
          padding: const EdgeInsets.all(16),
          decoration: _whiteCardDecoration(),
          child: const Row(
            children: [
              CircleAvatar(
                radius: 23,
                backgroundColor: Color(0xFFE6FFFB),
                child: Icon(
                  Icons.description_outlined,
                  color: Color(0xFF0F766E),
                ),
              ),
              SizedBox(width: 13),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Account statement',
                      style: TextStyle(
                        color: Color(0xFF0F172A),
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                    SizedBox(height: 3),
                    Text(
                      'Review your complete wallet activity',
                      style: TextStyle(
                        color: Color(0xFF64748B),
                        fontSize: 12,
                      ),
                    ),
                  ],
                ),
              ),
              Icon(
                Icons.chevron_right_rounded,
                color: Color(0xFF64748B),
              ),
            ],
          ),
        ),
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
      borderRadius: BorderRadius.circular(16),
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
                borderRadius: BorderRadius.circular(15),
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
              overflow: TextOverflow.ellipsis,
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
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text(
          'Recent Transactions',
          style: TextStyle(
            color: Color(0xFF0F172A),
            fontSize: 19,
            fontWeight: FontWeight.w800,
          ),
        ),
        Align(
          alignment: Alignment.centerRight,
          child: TextButton.icon(
            onPressed: _openTransactionsScreen,
            icon: const Icon(
              Icons.arrow_forward_rounded,
              size: 17,
            ),
            label: const Text(
              'See All Transactions',
              style: TextStyle(
                color: Color(0xFF0F766E),
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
        ),
        const SizedBox(height: 2),
        if (transactions.isEmpty)
          _buildEmptyTransactions()
        else
          Container(
            decoration: _whiteCardDecoration(),
            child: ListView.separated(
              itemCount: transactions.length > 10 ? 10 : transactions.length,
              shrinkWrap: true,
              physics: const NeverScrollableScrollPhysics(),
              separatorBuilder: (_, __) => const Divider(
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
      decoration: _whiteCardDecoration(),
      child: const Column(
        children: [
          Icon(
            Icons.receipt_long_rounded,
            color: Color(0xFF0F766E),
            size: 42,
          ),
          SizedBox(height: 15),
          Text(
            'No transactions yet',
            style: TextStyle(
              color: Color(0xFF0F172A),
              fontSize: 16,
              fontWeight: FontWeight.w800,
            ),
          ),
          SizedBox(height: 6),
          Text(
            'Your wallet transactions will appear here.',
            textAlign: TextAlign.center,
            style: TextStyle(
              color: Color(0xFF64748B),
              fontSize: 13,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildTransactionTile(
    dynamic transaction,
  ) {
    final bool isCredit = _isCreditTransaction(transaction);

    final double amount = _transactionAmount(transaction);

    final String status = _transactionStatus(transaction);

    final dynamic dateValue = transaction is Map
        ? transaction['createdAt'] ??
            transaction['date'] ??
            transaction['updatedAt']
        : null;

    final Color transactionColor =
        isCredit ? const Color(0xFF059669) : const Color(0xFFDC2626);

    return ListTile(
      contentPadding: const EdgeInsets.symmetric(
        horizontal: 16,
        vertical: 9,
      ),
      leading: Container(
        width: 46,
        height: 46,
        decoration: BoxDecoration(
          color: transactionColor.withValues(alpha: 0.10),
          borderRadius: BorderRadius.circular(15),
        ),
        child: Icon(
          isCredit ? Icons.south_west_rounded : Icons.north_east_rounded,
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
        padding: const EdgeInsets.only(top: 5),
        child: Row(
          children: [
            Flexible(
              child: Text(
                _formatDate(dateValue),
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  color: Color(0xFF94A3B8),
                  fontSize: 11,
                ),
              ),
            ),
            if (status.isNotEmpty) ...[
              const SizedBox(width: 8),
              _statusBadge(status),
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

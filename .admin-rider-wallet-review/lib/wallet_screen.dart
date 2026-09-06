import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

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
            : savedName;
        userPhone = savedPhone;
        isLoading = false;
      });

      await _refreshWallet(showMessage: false);
    } catch (error) {
      debugPrint('Load wallet error: $error');

      if (!mounted) return;

      setState(() {
        isLoading = false;
      });
    }
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
      final SharedPreferences prefs =
          await SharedPreferences.getInstance();

      final String? token =
          prefs.getString('auth_token');

      if (token == null || token.trim().isEmpty) {
        if (showMessage) {
          _showMessage(
            'Your login session has expired. Please log in again.',
            isError: true,
          );
        }
        return;
      }

      final Map<String, dynamic>? result =
          await _requestWalletBalance(token);

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
          _extractWalletBalance(result);

      if (newBalance == null) {
        final String? message =
            result['message']?.toString();

        if (showMessage) {
          _showMessage(
            message == null || message.trim().isEmpty
                ? 'Wallet balance was not found.'
                : message,
            isError: true,
          );
        }
        return;
      }

      await prefs.setDouble(
        'wallet_balance',
        newBalance,
      );

      final dynamic userData = result['user'];

      if (userData is Map) {
        final String? name =
            userData['fullName']?.toString() ??
                userData['name']?.toString();

        final String? phone =
            userData['phone']?.toString();

        if (name != null && name.trim().isNotEmpty) {
          await prefs.setString(
            'user_name',
            name,
          );

          userName = name;
        }

        if (phone != null &&
            phone.trim().isNotEmpty) {
          await prefs.setString(
            'user_phone',
            phone,
          );

          userPhone = phone;
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
      debugPrint('Refresh wallet error: $error');

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

  Future<Map<String, dynamic>?> _requestWalletBalance(
    String token,
  ) async {
    final List<String> endpoints = [
      '$baseUrl/wallet/balance',
      '$baseUrl/auth/me',
      '$baseUrl/users/me',
      '$baseUrl/profile',
    ];

    for (final String endpoint in endpoints) {
      try {
        final http.Response response = await http
            .get(
              Uri.parse(endpoint),
              headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json',
                'Authorization': 'Bearer $token',
              },
            )
            .timeout(
              const Duration(seconds: 20),
            );

        if (response.body.trim().isEmpty) {
          continue;
        }

        Map<String, dynamic>? body;

        try {
          final dynamic decoded =
              jsonDecode(response.body);

          if (decoded is Map<String, dynamic>) {
            body = decoded;
          } else if (decoded is Map) {
            body =
                Map<String, dynamic>.from(decoded);
          }
        } catch (_) {
          body = null;
        }

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
          'Wallet endpoint failed: $endpoint, $error',
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
      data is Map ? data['walletBalance'] : null,
      data is Map ? data['wallet_balance'] : null,
      data is Map ? data['balance'] : null,
      user is Map ? user['walletBalance'] : null,
      user is Map ? user['wallet_balance'] : null,
      user is Map ? user['balance'] : null,
    ];

    for (final dynamic value in possibleValues) {
      if (value is num) {
        return value.toDouble();
      }

      if (value is String) {
        final double? parsed = double.tryParse(
          value.replaceAll(',', '').trim(),
        );

        if (parsed != null) {
          return parsed;
        }
      }
    }

    return null;
  }

  Future<void> _openTransferScreen() async {
    final bool? transferCompleted =
        await Navigator.push<bool>(
      context,
      MaterialPageRoute(
        builder: (_) => const TransferScreen(),
      ),
    );

    if (!mounted) return;

    if (transferCompleted == true) {
      final SharedPreferences prefs =
          await SharedPreferences.getInstance();

      final double savedBalance =
          prefs.getDouble('wallet_balance') ?? 0.0;

      setState(() {
        walletBalance = savedBalance;
      });

      await _refreshWallet(
        showMessage: false,
      );
    }
  }

  String _formatAmount(double amount) {
    final String amountText =
        amount.toStringAsFixed(2);

    final List<String> parts =
        amountText.split('.');

    final String wholeNumber = parts[0];
    final String decimalPart =
        parts.length > 1 ? parts[1] : '00';

    final StringBuffer buffer =
        StringBuffer();

    for (int index = 0;
        index < wholeNumber.length;
        index++) {
      if (index > 0 &&
          (wholeNumber.length - index) % 3 == 0) {
        buffer.write(',');
      }

      buffer.write(wholeNumber[index]);
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
          backgroundColor: isError
              ? Colors.red.shade700
              : Colors.green.shade700,
          behavior: SnackBarBehavior.floating,
        ),
      );
  }

  Widget _buildBalanceCard() {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(24),
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          colors: [
            Color(0xFF075E54),
            Color(0xFF128C7E),
          ],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        borderRadius: BorderRadius.circular(22),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(
              alpha: 0.12,
            ),
            blurRadius: 15,
            offset: const Offset(0, 8),
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
                    color: Colors.white70,
                    fontSize: 15,
                    fontWeight: FontWeight.w500,
                  ),
                ),
              ),
              IconButton(
                onPressed: isRefreshing
                    ? null
                    : () {
                        _refreshWallet();
                      },
                tooltip: 'Refresh balance',
                icon: isRefreshing
                    ? const SizedBox(
                        width: 21,
                        height: 21,
                        child:
                            CircularProgressIndicator(
                          strokeWidth: 2.3,
                          color: Colors.white,
                        ),
                      )
                    : const Icon(
                        Icons.refresh_rounded,
                        color: Colors.white,
                      ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          Text(
            '₦${_formatAmount(walletBalance)}',
            style: const TextStyle(
              color: Colors.white,
              fontSize: 34,
              fontWeight: FontWeight.bold,
              letterSpacing: 0.3,
            ),
          ),
          const SizedBox(height: 20),
          Row(
            children: [
              const Icon(
                Icons.account_circle_outlined,
                color: Colors.white70,
                size: 19,
              ),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  userPhone.trim().isEmpty
                      ? userName
                      : '$userName • $userPhone',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: Colors.white70,
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

  Widget _buildTransferCard() {
    return Material(
      color: Colors.white,
      borderRadius: BorderRadius.circular(18),
      elevation: 1.5,
      child: InkWell(
        borderRadius: BorderRadius.circular(18),
        onTap: _openTransferScreen,
        child: Padding(
          padding: const EdgeInsets.all(18),
          child: Row(
            children: [
              Container(
                width: 54,
                height: 54,
                decoration: BoxDecoration(
                  color: const Color(0xFF128C7E)
                      .withValues(
                    alpha: 0.12,
                  ),
                  borderRadius:
                      BorderRadius.circular(16),
                ),
                child: const Icon(
                  Icons.swap_horiz_rounded,
                  color: Color(0xFF075E54),
                  size: 30,
                ),
              ),
              const SizedBox(width: 15),
              const Expanded(
                child: Column(
                  crossAxisAlignment:
                      CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Servicepay Transfer',
                      style: TextStyle(
                        fontSize: 17,
                        fontWeight: FontWeight.bold,
                        color: Color(0xFF222222),
                      ),
                    ),
                    SizedBox(height: 5),
                    Text(
                      'Send money to another Servicepay customer.',
                      style: TextStyle(
                        fontSize: 13,
                        height: 1.4,
                        color: Colors.black54,
                      ),
                    ),
                  ],
                ),
              ),
              const Icon(
                Icons.arrow_forward_ios_rounded,
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
      padding: const EdgeInsets.all(17),
      decoration: BoxDecoration(
        color: Colors.blue.shade50,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(
          color: Colors.blue.shade100,
        ),
      ),
      child: Row(
        crossAxisAlignment:
            CrossAxisAlignment.start,
        children: [
          Icon(
            Icons.info_outline_rounded,
            color: Colors.blue.shade700,
          ),
          const SizedBox(width: 12),
          const Expanded(
            child: Text(
              'Bank transfer and card funding are temporarily unavailable. '
              'Servicepay-to-Servicepay transfer remains active.',
              style: TextStyle(
                fontSize: 13,
                height: 1.5,
                color: Color(0xFF334155),
              ),
            ),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor:
          const Color(0xFFF5F7F9),
      appBar: AppBar(
        title: const Text(
          'My Wallet',
          style: TextStyle(
            fontWeight: FontWeight.bold,
          ),
        ),
        centerTitle: false,
        elevation: 0,
        backgroundColor: Colors.white,
        foregroundColor:
            const Color(0xFF222222),
        actions: [
          IconButton(
            onPressed: isRefreshing
                ? null
                : () {
                    _refreshWallet();
                  },
            tooltip: 'Refresh wallet',
            icon: const Icon(
              Icons.refresh_rounded,
            ),
          ),
        ],
      ),
      body: isLoading
          ? const Center(
              child: CircularProgressIndicator(
                color: Color(0xFF075E54),
              ),
            )
          : RefreshIndicator(
              color: const Color(0xFF075E54),
              onRefresh: () {
                return _refreshWallet(
                  showMessage: false,
                );
              },
              child: ListView(
                physics:
                    const AlwaysScrollableScrollPhysics(),
                padding: const EdgeInsets.fromLTRB(
                  16,
                  18,
                  16,
                  30,
                ),
                children: [
                  _buildBalanceCard(),
                  const SizedBox(height: 22),
                  const Text(
                    'Wallet Services',
                    style: TextStyle(
                      fontSize: 17,
                      fontWeight: FontWeight.bold,
                      color: Color(0xFF222222),
                    ),
                  ),
                  const SizedBox(height: 12),
                  _buildTransferCard(),
                  const SizedBox(height: 18),
                  _buildInformationCard(),
                ],
              ),
            ),
    );
  }
}
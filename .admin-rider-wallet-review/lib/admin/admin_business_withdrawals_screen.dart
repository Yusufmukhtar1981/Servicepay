import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

class AdminBusinessWithdrawalsScreen extends StatefulWidget {
  const AdminBusinessWithdrawalsScreen({
    super.key,
  });

  @override
  State<AdminBusinessWithdrawalsScreen> createState() =>
      _AdminBusinessWithdrawalsScreenState();
}

class _AdminBusinessWithdrawalsScreenState
    extends State<AdminBusinessWithdrawalsScreen> {
  static const String baseUrl = 'https://api.servicepay.ng/api';

  static const Color primaryGreen = Color(0xFF08783E);

  bool isLoading = true;
  bool isActionLoading = false;

  String selectedStatus = 'PENDING';

  List<Map<String, dynamic>> withdrawals = <Map<String, dynamic>>[];

  final List<String> statuses = <String>[
    'PENDING',
    'APPROVED',
    'PAID',
    'REJECTED',
  ];

  @override
  void initState() {
    super.initState();
    loadWithdrawals();
  }

  Future<String> getToken() async {
    final prefs = await SharedPreferences.getInstance();

    const keys = <String>[
      'auth_token',
      'token',
      'access_token',
      'accessToken',
      'jwt_token',
      'jwt',
      'admin_token',
    ];

    for (final key in keys) {
      final value = prefs.getString(key)?.trim() ?? '';

      if (value.isNotEmpty) {
        return value
            .replaceFirst(
              RegExp(
                r'^Bearer\s+',
                caseSensitive: false,
              ),
              '',
            )
            .trim();
      }
    }

    return '';
  }

  String money(dynamic value) {
    final amount = double.tryParse(
          value?.toString() ?? '',
        ) ??
        0;

    return '₦${amount.toStringAsFixed(2)}';
  }

  void showMessage(
    String message, {
    bool error = false,
  }) {
    if (!mounted) return;

    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(message),
        backgroundColor: error ? Colors.red.shade700 : null,
      ),
    );
  }

  Future<void> loadWithdrawals() async {
    try {
      if (mounted) {
        setState(() {
          isLoading = true;
        });
      }

      final token = await getToken();

      if (token.isEmpty) {
        throw Exception(
          'Admin session expired.',
        );
      }

      final uri = Uri.parse(
        '$baseUrl/business-wallet/admin/withdrawals'
        '?status=$selectedStatus',
      );

      final response = await http.get(
        uri,
        headers: <String, String>{
          'Authorization': 'Bearer $token',
          'Accept': 'application/json',
        },
      ).timeout(
        const Duration(seconds: 40),
      );

      Map<String, dynamic> data = <String, dynamic>{};

      try {
        final decoded = jsonDecode(response.body);

        if (decoded is Map) {
          data = Map<String, dynamic>.from(
            decoded,
          );
        }
      } catch (_) {}

      if (response.statusCode < 200 ||
          response.statusCode >= 300 ||
          data['success'] != true) {
        throw Exception(
          data['message']?.toString() ?? 'Unable to load withdrawals.',
        );
      }

      final raw = data['withdrawals'];

      if (!mounted) return;

      setState(() {
        withdrawals = raw is List
            ? raw
                .whereType<Map>()
                .map(
                  (item) => Map<String, dynamic>.from(
                    item,
                  ),
                )
                .toList()
            : <Map<String, dynamic>>[];

        isLoading = false;
      });
    } catch (error) {
      if (!mounted) return;

      setState(() {
        isLoading = false;
      });

      showMessage(
        error.toString().replaceFirst(
              'Exception: ',
              '',
            ),
        error: true,
      );
    }
  }

  Future<bool> confirmAction({
    required String title,
    required String message,
    required String confirmText,
  }) async {
    final result = await showDialog<bool>(
      context: context,
      builder: (dialogContext) {
        return AlertDialog(
          title: Text(title),
          content: Text(message),
          actions: <Widget>[
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
            FilledButton(
              style: FilledButton.styleFrom(
                backgroundColor: primaryGreen,
              ),
              onPressed: () {
                Navigator.pop(
                  dialogContext,
                  true,
                );
              },
              child: Text(
                confirmText,
              ),
            ),
          ],
        );
      },
    );

    return result == true;
  }

  Future<void> runAction({
    required String id,
    required String action,
  }) async {
    if (isActionLoading) return;

    String title;
    String message;
    String confirmText;

    switch (action) {
      case 'approve':
        title = 'Approve Withdrawal';
        message =
            'Approve this request? The funds will remain locked until you mark the withdrawal as paid.';
        confirmText = 'Approve';
        break;

      case 'reject':
        title = 'Reject Withdrawal';
        message =
            'Reject this withdrawal? The locked funds will be returned to the customer’s available Business Wallet balance.';
        confirmText = 'Reject';
        break;

      case 'paid':
        title = 'Mark Withdrawal Paid';
        message =
            'Only continue if the bank payout has actually been completed. The amount will then be permanently deducted from the Business Wallet.';
        confirmText = 'Mark Paid';
        break;

      default:
        return;
    }

    final confirmed = await confirmAction(
      title: title,
      message: message,
      confirmText: confirmText,
    );

    if (!confirmed) return;

    try {
      setState(() {
        isActionLoading = true;
      });

      final token = await getToken();

      final response = await http
          .patch(
            Uri.parse(
              '$baseUrl/business-wallet/'
              'admin/withdrawals/$id/$action',
            ),
            headers: <String, String>{
              'Authorization': 'Bearer $token',
              'Content-Type': 'application/json',
              'Accept': 'application/json',
            },
            body: jsonEncode(
              <String, dynamic>{},
            ),
          )
          .timeout(
            const Duration(seconds: 40),
          );

      Map<String, dynamic> data = <String, dynamic>{};

      try {
        final decoded = jsonDecode(response.body);

        if (decoded is Map) {
          data = Map<String, dynamic>.from(
            decoded,
          );
        }
      } catch (_) {}

      if (response.statusCode < 200 ||
          response.statusCode >= 300 ||
          data['success'] != true) {
        throw Exception(
          data['message']?.toString() ?? 'Action failed.',
        );
      }

      showMessage(
        data['message']?.toString() ?? 'Action completed.',
      );

      await loadWithdrawals();
    } catch (error) {
      showMessage(
        error.toString().replaceFirst(
              'Exception: ',
              '',
            ),
        error: true,
      );
    } finally {
      if (mounted) {
        setState(() {
          isActionLoading = false;
        });
      }
    }
  }

  Color statusColor(
    String status,
  ) {
    switch (status) {
      case 'PAID':
        return const Color(
          0xFF08783E,
        );

      case 'APPROVED':
        return const Color(
          0xFFB7791F,
        );

      case 'REJECTED':
        return Colors.red.shade700;

      default:
        return const Color(
          0xFF65756D,
        );
    }
  }

  Widget buildWithdrawalCard(
    Map<String, dynamic> withdrawal,
  ) {
    final id = withdrawal['_id']?.toString() ?? '';

    final status = withdrawal['status']?.toString().toUpperCase() ?? 'PENDING';

    final user = Map<String, dynamic>.from(
      withdrawal['user'] is Map ? withdrawal['user'] : <String, dynamic>{},
    );

    final customerName = user['businessName']?.toString().trim() ?? '';

    final fallbackName = user['fullName']?.toString().trim() ?? '';

    final businessId = user['businessWalletId']?.toString().trim() ?? '';

    final phone = user['phone']?.toString().trim() ?? '';

    final bankName = withdrawal['bankName']?.toString().trim() ?? '';

    final accountNumber = withdrawal['accountNumber']?.toString().trim() ?? '';

    final accountName = withdrawal['accountName']?.toString().trim() ?? '';

    final reference = withdrawal['reference']?.toString().trim() ?? '';

    final displayName = customerName.isNotEmpty
        ? customerName
        : fallbackName.isNotEmpty
            ? fallbackName
            : 'ServicePay Business';

    return Container(
      margin: const EdgeInsets.only(
        bottom: 14,
      ),
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(
          color: const Color(0xFFE7ECE9),
        ),
        boxShadow: const <BoxShadow>[
          BoxShadow(
            color: Color(0x0A101828),
            blurRadius: 14,
            offset: Offset(0, 5),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Row(
            children: <Widget>[
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    Text(
                      displayName,
                      style: const TextStyle(
                        fontSize: 17,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                    const SizedBox(
                      height: 3,
                    ),
                    if (businessId.isNotEmpty)
                      Text(
                        businessId,
                        style: const TextStyle(
                          fontSize: 11,
                          color: Color(
                            0xFF718078,
                          ),
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
                  color: statusColor(
                    status,
                  ).withValues(
                    alpha: 0.10,
                  ),
                  borderRadius: BorderRadius.circular(
                    100,
                  ),
                ),
                child: Text(
                  status,
                  style: TextStyle(
                    color: statusColor(
                      status,
                    ),
                    fontSize: 10.5,
                    fontWeight: FontWeight.w900,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 16),
          Text(
            money(
              withdrawal['amount'],
            ),
            style: const TextStyle(
              fontSize: 28,
              fontWeight: FontWeight.w900,
              color: Color(0xFF08783E),
            ),
          ),
          const SizedBox(height: 15),
          _InfoRow(
            label: 'Bank',
            value: bankName,
          ),
          _InfoRow(
            label: 'Account Number',
            value: accountNumber,
          ),
          _InfoRow(
            label: 'Account Name',
            value: accountName,
          ),
          if (phone.isNotEmpty)
            _InfoRow(
              label: 'Customer Phone',
              value: phone,
            ),
          _InfoRow(
            label: 'Reference',
            value: reference,
          ),
          if (status == 'PENDING') ...[
            const SizedBox(height: 17),
            Row(
              children: <Widget>[
                Expanded(
                  child: OutlinedButton(
                    onPressed: isActionLoading
                        ? null
                        : () => runAction(
                              id: id,
                              action: 'reject',
                            ),
                    child: const Text(
                      'Reject',
                    ),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: FilledButton(
                    style: FilledButton.styleFrom(
                      backgroundColor: primaryGreen,
                    ),
                    onPressed: isActionLoading
                        ? null
                        : () => runAction(
                              id: id,
                              action: 'approve',
                            ),
                    child: const Text(
                      'Approve',
                    ),
                  ),
                ),
              ],
            ),
          ],
          if (status == 'APPROVED') ...[
            const SizedBox(height: 17),
            Row(
              children: <Widget>[
                Expanded(
                  child: OutlinedButton(
                    onPressed: isActionLoading
                        ? null
                        : () => runAction(
                              id: id,
                              action: 'reject',
                            ),
                    child: const Text(
                      'Reject',
                    ),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: FilledButton.icon(
                    style: FilledButton.styleFrom(
                      backgroundColor: primaryGreen,
                    ),
                    onPressed: isActionLoading
                        ? null
                        : () => runAction(
                              id: id,
                              action: 'paid',
                            ),
                    icon: const Icon(
                      Icons.check_circle_outline_rounded,
                    ),
                    label: const Text(
                      'Mark Paid',
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

  @override
  Widget build(
    BuildContext context,
  ) {
    return Scaffold(
      backgroundColor: const Color(0xFFF7F9F8),
      appBar: AppBar(
        title: const Text(
          'Business Withdrawals',
          style: TextStyle(
            fontWeight: FontWeight.w900,
          ),
        ),
        backgroundColor: const Color(0xFFF7F9F8),
        surfaceTintColor: Colors.transparent,
        actions: <Widget>[
          IconButton(
            tooltip: 'Refresh',
            onPressed: loadWithdrawals,
            icon: const Icon(
              Icons.refresh_rounded,
            ),
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: loadWithdrawals,
        child: ListView(
          padding: const EdgeInsets.fromLTRB(
            18,
            8,
            18,
            30,
          ),
          children: <Widget>[
            const Text(
              'Business Wallet Payout Requests',
              style: TextStyle(
                fontSize: 23,
                fontWeight: FontWeight.w900,
              ),
            ),
            const SizedBox(height: 5),
            const Text(
              'Review requests carefully. Mark Paid only after the bank payout has actually been completed.',
              style: TextStyle(
                color: Color(0xFF718078),
                height: 1.4,
              ),
            ),
            const SizedBox(height: 18),
            SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              child: Row(
                children: statuses.map(
                  (status) {
                    final active = selectedStatus == status;

                    return Padding(
                      padding: const EdgeInsets.only(
                        right: 8,
                      ),
                      child: ChoiceChip(
                        label: Text(status),
                        selected: active,
                        onSelected: (_) {
                          setState(() {
                            selectedStatus = status;
                          });

                          loadWithdrawals();
                        },
                      ),
                    );
                  },
                ).toList(),
              ),
            ),
            const SizedBox(height: 18),
            if (isLoading)
              const Padding(
                padding: EdgeInsets.only(
                  top: 80,
                ),
                child: Center(
                  child: CircularProgressIndicator(),
                ),
              )
            else if (withdrawals.isEmpty)
              Container(
                padding: const EdgeInsets.all(
                  32,
                ),
                decoration: BoxDecoration(
                  color: Colors.white,
                  borderRadius: BorderRadius.circular(
                    20,
                  ),
                ),
                child: Column(
                  children: <Widget>[
                    const Icon(
                      Icons.account_balance_wallet_outlined,
                      size: 42,
                      color: Color(
                        0xFF718078,
                      ),
                    ),
                    const SizedBox(
                      height: 10,
                    ),
                    Text(
                      'No $selectedStatus withdrawal requests.',
                      textAlign: TextAlign.center,
                    ),
                  ],
                ),
              )
            else
              ...withdrawals.map(
                buildWithdrawalCard,
              ),
          ],
        ),
      ),
    );
  }
}

class _InfoRow extends StatelessWidget {
  final String label;
  final String value;

  const _InfoRow({
    required this.label,
    required this.value,
  });

  @override
  Widget build(
    BuildContext context,
  ) {
    return Padding(
      padding: const EdgeInsets.only(
        bottom: 8,
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          SizedBox(
            width: 122,
            child: Text(
              label,
              style: const TextStyle(
                fontSize: 11.5,
                color: Color(
                  0xFF718078,
                ),
              ),
            ),
          ),
          Expanded(
            child: SelectableText(
              value.isEmpty ? '-' : value,
              style: const TextStyle(
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

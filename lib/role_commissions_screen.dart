import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

class RoleCommissionsScreen extends StatefulWidget {
  const RoleCommissionsScreen({super.key});

  @override
  State<RoleCommissionsScreen> createState() => _RoleCommissionsScreenState();
}

class _RoleCommissionsScreenState extends State<RoleCommissionsScreen> {
  static const String baseUrl = 'https://api.servicepay.ng/api';

  bool isLoading = true;
  bool isRefreshing = false;
  bool hasError = false;

  String errorMessage = '';

  double totalEarnings = 0;
  double availableCommission = 0;
  double pendingCommission = 0;
  double withdrawnCommission = 0;

  int totalCommissions = 0;

  List<Map<String, dynamic>> commissions = [];

  @override
  void initState() {
    super.initState();
    loadCommissions();
  }

  Future<String?> getSavedAuthToken() async {
    final SharedPreferences preferences = await SharedPreferences.getInstance();

    const List<String> tokenKeys = [
      'auth_token',
      'token',
      'access_token',
      'admin_token',
    ];

    for (final String key in tokenKeys) {
      final String? value = preferences.getString(key);

      if (value != null && value.trim().isNotEmpty) {
        return value.trim();
      }
    }

    return null;
  }

  Future<void> loadCommissions({
    bool refreshing = false,
  }) async {
    if (refreshing) {
      setState(() {
        isRefreshing = true;
      });
    } else {
      setState(() {
        isLoading = true;
      });
    }

    try {
      final String? token = await getSavedAuthToken();

      if (token == null) {
        throw Exception(
          'Authentication token was not found. Please sign in again.',
        );
      }

      final Uri uri = Uri.parse(
        '$baseUrl/management/role-commissions',
      );

      final http.Response response = await http.get(
        uri,
        headers: {
          'Accept': 'application/json',
          'Authorization': 'Bearer $token',
        },
      ).timeout(const Duration(seconds: 65));

      Map<String, dynamic> body = {};

      if (response.body.trim().isNotEmpty) {
        final dynamic decoded = jsonDecode(response.body);

        if (decoded is Map<String, dynamic>) {
          body = decoded;
        } else if (decoded is Map) {
          body = Map<String, dynamic>.from(decoded);
        }
      }

      if (response.statusCode == 401) {
        throw Exception(
          body['message']?.toString() ??
              'Your session has expired. Please sign in again.',
        );
      }

      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw Exception(
          body['message']?.toString() ?? 'Unable to load commissions.',
        );
      }

      final dynamic rawData = body['data'] ?? body['result'] ?? body;

      final Map<String, dynamic> data = rawData is Map<String, dynamic>
          ? rawData
          : rawData is Map
              ? Map<String, dynamic>.from(rawData)
              : <String, dynamic>{};

      final dynamic rawSummary =
          data['summary'] ?? body['summary'] ?? <String, dynamic>{};

      final Map<String, dynamic> summary = rawSummary is Map<String, dynamic>
          ? rawSummary
          : rawSummary is Map
              ? Map<String, dynamic>.from(rawSummary)
              : <String, dynamic>{};

      final dynamic rawCommissions = data['commissions'] ??
          data['items'] ??
          data['records'] ??
          body['commissions'] ??
          body['items'] ??
          <dynamic>[];

      final List<Map<String, dynamic>> parsedCommissions =
          rawCommissions is List
              ? rawCommissions
                  .whereType<Map>()
                  .map(
                    (Map item) => Map<String, dynamic>.from(item),
                  )
                  .toList()
              : <Map<String, dynamic>>[];

      double calculateTotalByStatus(String status) {
        return parsedCommissions
            .where(
              (Map<String, dynamic> item) =>
                  _text(item['status']).toUpperCase() == status,
            )
            .fold<double>(
              0,
              (
                double sum,
                Map<String, dynamic> item,
              ) =>
                  sum +
                  _number(
                    item['commissionAmount'] ?? item['amount'],
                  ),
            );
      }

      final double parsedTotalEarnings = _number(
        summary['totalEarnings'] ??
            summary['totalCommission'] ??
            summary['totalAmount'] ??
            data['totalEarnings'],
      );

      final double parsedAvailable = _number(
        summary['availableCommission'] ??
            summary['available'] ??
            data['availableCommission'],
      );

      final double parsedPending = _number(
        summary['pendingCommission'] ??
            summary['pending'] ??
            data['pendingCommission'],
      );

      final double parsedWithdrawn = _number(
        summary['withdrawnCommission'] ??
            summary['withdrawn'] ??
            data['withdrawnCommission'],
      );

      final double listTotal = parsedCommissions.fold<double>(
        0,
        (
          double sum,
          Map<String, dynamic> item,
        ) =>
            sum +
            _number(
              item['commissionAmount'] ?? item['amount'],
            ),
      );

      if (!mounted) {
        return;
      }

      setState(() {
        commissions = parsedCommissions;

        totalEarnings =
            parsedTotalEarnings > 0 ? parsedTotalEarnings : listTotal;

        availableCommission = parsedAvailable > 0
            ? parsedAvailable
            : calculateTotalByStatus('AVAILABLE');

        pendingCommission = parsedPending > 0
            ? parsedPending
            : calculateTotalByStatus('PENDING');

        withdrawnCommission = parsedWithdrawn > 0
            ? parsedWithdrawn
            : calculateTotalByStatus('WITHDRAWN');

        totalCommissions = _integer(
          summary['totalCommissions'] ??
              summary['total'] ??
              data['totalCommissions'] ??
              parsedCommissions.length,
        );

        hasError = false;
        errorMessage = '';
      });
    } catch (error) {
      if (!mounted) {
        return;
      }

      setState(() {
        hasError = true;
        errorMessage = error.toString().replaceFirst('Exception: ', '');
      });
    } finally {
      if (mounted) {
        setState(() {
          isLoading = false;
          isRefreshing = false;
        });
      }
    }
  }

  double _number(dynamic value) {
    if (value is num) {
      return value.toDouble();
    }

    final String cleaned =
        value.toString().replaceAll(',', '').replaceAll('₦', '').trim();

    return double.tryParse(cleaned) ?? 0;
  }

  int _integer(dynamic value) {
    if (value is int) {
      return value;
    }

    if (value is num) {
      return value.toInt();
    }

    return int.tryParse(value.toString()) ?? 0;
  }

  String _text(dynamic value) {
    if (value == null) {
      return '';
    }

    return value.toString().trim();
  }

  String _money(double amount) {
    final String fixed = amount.toStringAsFixed(2);
    final List<String> parts = fixed.split('.');
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

  Color _statusColor(String status) {
    switch (status.toUpperCase()) {
      case 'AVAILABLE':
        return Colors.green;
      case 'PENDING':
        return Colors.orange;
      case 'WITHDRAWN':
        return Colors.blue;
      case 'REVERSED':
        return Colors.red;
      default:
        return Colors.grey;
    }
  }

  IconData _serviceIcon(String serviceType) {
    switch (serviceType.toUpperCase()) {
      case 'AIRTIME':
        return Icons.phone_android_rounded;
      case 'DATA':
        return Icons.signal_cellular_alt_rounded;
      case 'ELECTRICITY':
        return Icons.electric_bolt_rounded;
      case 'CABLE':
        return Icons.tv_rounded;
      case 'ID_VERIFICATION':
        return Icons.badge_rounded;
      default:
        return Icons.account_balance_wallet_rounded;
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF7F8FA),
      appBar: AppBar(
        title: const Text('Commission'),
        centerTitle: true,
        backgroundColor: Colors.white,
        foregroundColor: const Color(0xFF15241B),
        elevation: 0,
        actions: [
          IconButton(
            onPressed: isRefreshing
                ? null
                : () {
                    loadCommissions(refreshing: true);
                  },
            icon: isRefreshing
                ? const SizedBox(
                    width: 20,
                    height: 20,
                    child: CircularProgressIndicator(
                      strokeWidth: 2,
                    ),
                  )
                : const Icon(Icons.refresh_rounded),
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: () => loadCommissions(refreshing: true),
        child: isLoading
            ? const Center(
                child: CircularProgressIndicator(),
              )
            : hasError && commissions.isEmpty
                ? _buildError()
                : _buildContent(),
      ),
    );
  }

  Widget _buildError() {
    return ListView(
      physics: const AlwaysScrollableScrollPhysics(),
      padding: const EdgeInsets.all(24),
      children: [
        const SizedBox(height: 120),
        Icon(
          Icons.error_outline_rounded,
          size: 64,
          color: Colors.red.shade400,
        ),
        const SizedBox(height: 16),
        Text(
          errorMessage.isEmpty ? 'Unable to load commissions.' : errorMessage,
          textAlign: TextAlign.center,
          style: const TextStyle(
            fontSize: 16,
            color: Color(0xFF5C665F),
          ),
        ),
        const SizedBox(height: 20),
        Center(
          child: FilledButton.icon(
            onPressed: loadCommissions,
            icon: const Icon(Icons.refresh_rounded),
            label: const Text('Try Again'),
          ),
        ),
      ],
    );
  }

  Widget _buildContent() {
    return ListView(
      physics: const AlwaysScrollableScrollPhysics(),
      padding: const EdgeInsets.fromLTRB(
        16,
        16,
        16,
        32,
      ),
      children: [
        _buildMainCard(),
        const SizedBox(height: 16),
        GridView.count(
          crossAxisCount: 2,
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          crossAxisSpacing: 12,
          mainAxisSpacing: 12,
          childAspectRatio: 1.55,
          children: [
            _summaryCard(
              title: 'Available',
              value: _money(availableCommission),
              icon: Icons.check_circle_outline_rounded,
              color: Colors.green,
            ),
            _summaryCard(
              title: 'Pending',
              value: _money(pendingCommission),
              icon: Icons.hourglass_top_rounded,
              color: Colors.orange,
            ),
            _summaryCard(
              title: 'Withdrawn',
              value: _money(withdrawnCommission),
              icon: Icons.payments_outlined,
              color: Colors.blue,
            ),
            _summaryCard(
              title: 'Records',
              value: totalCommissions.toString(),
              icon: Icons.receipt_long_rounded,
              color: Colors.teal,
            ),
          ],
        ),
        const SizedBox(height: 22),
        const Text(
          'Commission History',
          style: TextStyle(
            fontSize: 19,
            fontWeight: FontWeight.w700,
            color: Color(0xFF17251C),
          ),
        ),
        const SizedBox(height: 12),
        if (commissions.isEmpty)
          _buildEmpty()
        else
          ...commissions.map(_commissionCard),
      ],
    );
  }

  Widget _buildMainCard() {
    return Container(
      padding: const EdgeInsets.all(22),
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          colors: [
            Color(0xFF087A3E),
            Color(0xFF19A65B),
          ],
        ),
        borderRadius: BorderRadius.circular(24),
        boxShadow: [
          BoxShadow(
            color: Colors.green.withValues(alpha: 0.16),
            blurRadius: 22,
            offset: const Offset(0, 10),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Row(
            children: [
              Icon(
                Icons.account_balance_wallet_rounded,
                color: Colors.white,
              ),
              SizedBox(width: 8),
              Text(
                'Total Earnings',
                style: TextStyle(
                  color: Colors.white,
                  fontSize: 16,
                ),
              ),
            ],
          ),
          const SizedBox(height: 16),
          Text(
            _money(totalEarnings),
            style: const TextStyle(
              color: Colors.white,
              fontSize: 33,
              fontWeight: FontWeight.w800,
            ),
          ),
          const SizedBox(height: 10),
          const Text(
            'Commission earned from successful customer transactions.',
            style: TextStyle(
              color: Colors.white70,
              height: 1.4,
            ),
          ),
        ],
      ),
    );
  }

  Widget _summaryCard({
    required String title,
    required String value,
    required IconData icon,
    required Color color,
  }) {
    return Container(
      padding: const EdgeInsets.all(15),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(
          color: const Color(0xFFE8ECE9),
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Icon(
            icon,
            color: color,
            size: 23,
          ),
          Text(
            value,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(
              fontWeight: FontWeight.w800,
              fontSize: 16,
              color: Color(0xFF17251C),
            ),
          ),
          Text(
            title,
            style: const TextStyle(
              fontSize: 12,
              color: Color(0xFF6D766F),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildEmpty() {
    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: 24,
        vertical: 42,
      ),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(18),
      ),
      child: const Column(
        children: [
          Icon(
            Icons.account_balance_wallet_outlined,
            size: 52,
            color: Color(0xFF9AA39D),
          ),
          SizedBox(height: 14),
          Text(
            'No commission record yet.',
            style: TextStyle(
              fontWeight: FontWeight.w700,
              fontSize: 16,
            ),
          ),
          SizedBox(height: 6),
          Text(
            'New commissions will appear after successful eligible transactions.',
            textAlign: TextAlign.center,
            style: TextStyle(
              color: Color(0xFF717A74),
              height: 1.4,
            ),
          ),
        ],
      ),
    );
  }

  Widget _commissionCard(
    Map<String, dynamic> commission,
  ) {
    final String serviceType = _text(
      commission['serviceType'] ?? commission['productName'] ?? 'Commission',
    );

    final String description = _text(
      commission['description'] ?? commission['productName'] ?? serviceType,
    );

    final String status = _text(
      commission['status'] ?? 'AVAILABLE',
    ).toUpperCase();

    final String reference = _text(
      commission['reference'] ??
          commission['transactionReference'] ??
          commission['transactionId'],
    );

    final double amount = _number(
      commission['commissionAmount'] ?? commission['amount'],
    );

    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(
          color: const Color(0xFFE8ECE9),
        ),
      ),
      child: Row(
        children: [
          Container(
            width: 45,
            height: 45,
            decoration: BoxDecoration(
              color: const Color(0xFFEAF6EF),
              borderRadius: BorderRadius.circular(13),
            ),
            child: Icon(
              _serviceIcon(serviceType),
              color: const Color(0xFF087A3E),
            ),
          ),
          const SizedBox(width: 13),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  description.isEmpty ? serviceType : description,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    fontWeight: FontWeight.w700,
                    fontSize: 15,
                  ),
                ),
                const SizedBox(height: 5),
                Text(
                  reference.isEmpty ? serviceType : reference,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: Color(0xFF747D77),
                    fontSize: 12,
                  ),
                ),
                const SizedBox(height: 7),
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 9,
                    vertical: 4,
                  ),
                  decoration: BoxDecoration(
                    color: _statusColor(
                      status,
                    ).withValues(alpha: 0.12),
                    borderRadius: BorderRadius.circular(20),
                  ),
                  child: Text(
                    status,
                    style: TextStyle(
                      color: _statusColor(status),
                      fontSize: 10,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(width: 10),
          Text(
            _money(amount),
            style: const TextStyle(
              fontWeight: FontWeight.w800,
              fontSize: 15,
              color: Color(0xFF087A3E),
            ),
          ),
        ],
      ),
    );
  }
}

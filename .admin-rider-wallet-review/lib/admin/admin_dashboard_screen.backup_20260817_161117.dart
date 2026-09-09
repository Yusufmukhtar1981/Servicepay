import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

import 'admin_notifications_screen.dart';
import 'admin_transactions_screen.dart';
import 'admin_product_commission_screen.dart';
import 'users_screen.dart';

class AdminDashboardScreen extends StatefulWidget {
  const AdminDashboardScreen({
    super.key,
  });

  @override
  State<AdminDashboardScreen> createState() =>
      _AdminDashboardScreenState();
}

class _AdminDashboardScreenState
    extends State<AdminDashboardScreen> {
  static const String baseUrl =
      'https://api.servicepay.ng/api';

  String adminName = 'Admin';
  String adminRole = 'HEAD_OFFICE';

  bool isLoading = true;
  bool hasError = false;
  String errorMessage = '';

  int totalUsers = 0;
  int activeUsers = 0;
  int totalCustomers = 0;
  int totalAgents = 0;
  int pendingVerifications = 0;

  int totalTransactions = 0;
  int successfulTransactions = 0;
  int pendingTransactions = 0;
  int failedTransactions = 0;

  double totalTransactionValue = 0;
  double totalWalletBalance = 0;
  double servicepayProfit = 0;

  List<dynamic> recentUsers = [];
  List<dynamic> recentTransactions = [];

  @override
  void initState() {
    super.initState();
    loadDashboard();
  }

  Map<String, dynamic> toMap(
    dynamic value,
  ) {
    if (value is Map<String, dynamic>) {
      return value;
    }

    if (value is Map) {
      return Map<String, dynamic>.from(
        value,
      );
    }

    return <String, dynamic>{};
  }

  int toInt(
    dynamic value,
  ) {
    if (value is int) {
      return value;
    }

    if (value is num) {
      return value.toInt();
    }

    return int.tryParse(
          value?.toString() ?? '',
        ) ??
        0;
  }

  double toDouble(
    dynamic value,
  ) {
    if (value is double) {
      return value;
    }

    if (value is num) {
      return value.toDouble();
    }

    return double.tryParse(
          value?.toString() ?? '',
        ) ??
        0;
  }

  String cleanError(
    Object error,
  ) {
    return error
        .toString()
        .replaceFirst(
          'Exception: ',
          '',
        )
        .trim();
  }

  Future<void> loadDashboard() async {
    if (mounted) {
      setState(() {
        isLoading = true;
        hasError = false;
        errorMessage = '';
      });
    }

    try {
      final SharedPreferences prefs =
          await SharedPreferences.getInstance();

      final String? savedName =
          prefs.getString('user_name') ??
              prefs.getString('full_name') ??
              prefs.getString('name');

      final String savedRole =
          prefs.getString('user_role') ??
              prefs.getString('role') ??
              'HEAD_OFFICE';

      final String? token =
          prefs.getString('auth_token') ??
              prefs.getString('token') ??
              prefs.getString('admin_token');

      if (token == null ||
          token.trim().isEmpty) {
        throw Exception(
          'Admin login token was not found. Please log in again.',
        );
      }

      final Uri uri = Uri.parse(
        '$baseUrl/admin/dashboard',
      );

      final http.Response response =
          await http
              .get(
                uri,
                headers: {
                  'Accept': 'application/json',
                  'Authorization':
                      'Bearer ${token.trim()}',
                },
              )
              .timeout(
                const Duration(
                  seconds: 30,
                ),
              );

      final String rawBody =
          response.body.trim();

      final String contentType =
          response.headers['content-type']
                  ?.toLowerCase() ??
              '';

      if (rawBody.isEmpty) {
        throw Exception(
          'The server returned an empty response.',
        );
      }

      final String lowerBody =
          rawBody.toLowerCase();

      if (lowerBody.startsWith(
            '<!doctype html',
          ) ||
          lowerBody.startsWith('<html') ||
          contentType.contains(
            'text/html',
          )) {
        throw Exception(
          'The admin dashboard API returned an invalid web page.',
        );
      }

      dynamic decodedBody;

      try {
        decodedBody = jsonDecode(
          rawBody,
        );
      } on FormatException {
        throw Exception(
          'The server returned an invalid response instead of JSON.',
        );
      }

      final Map<String, dynamic> body =
          toMap(decodedBody);

      if (response.statusCode == 401) {
        throw Exception(
          body['message']?.toString() ??
              'Your login session has expired. Please log in again.',
        );
      }

      if (response.statusCode == 403) {
        throw Exception(
          body['message']?.toString() ??
              'You are not allowed to access the admin dashboard.',
        );
      }

      if (response.statusCode < 200 ||
          response.statusCode >= 300) {
        throw Exception(
          body['message']?.toString() ??
              'Unable to load dashboard. Server error ${response.statusCode}.',
        );
      }

      if (body['success'] != true) {
        throw Exception(
          body['message']?.toString() ??
              'Unable to load admin dashboard.',
        );
      }

      final Map<String, dynamic> data =
          toMap(body['data']);

      final Map<String, dynamic> users =
          toMap(data['users']);

      final Map<String, dynamic> kyc =
          toMap(data['kyc']);

      final Map<String, dynamic> wallets =
          toMap(data['wallets']);

      final Map<String, dynamic>
          transactions =
          toMap(data['transactions']);

      final Map<String, dynamic> servicepay =
          toMap(data['servicepay']);

      if (!mounted) {
        return;
      }

      setState(() {
        adminName =
            savedName?.trim().isNotEmpty ==
                    true
                ? savedName!.trim()
                : 'Admin';

        adminRole =
            savedRole.trim().isNotEmpty
                ? savedRole
                    .trim()
                    .toUpperCase()
                : 'HEAD_OFFICE';

        totalUsers =
            toInt(users['total']);

        activeUsers =
            toInt(users['active']);

        totalCustomers =
            toInt(users['customers']);

        totalAgents =
            toInt(users['agents']);

        pendingVerifications =
            toInt(kyc['pending']);

        totalWalletBalance =
            toDouble(
          wallets[
                  'totalWalletBalance'] ??
              wallets['totalBalance'],
        );

        totalTransactions =
            toInt(
          transactions['total'],
        );

        totalTransactionValue =
            toDouble(
          transactions['totalVolume'] ??
              transactions['totalValue'],
        );

        successfulTransactions =
            toInt(
          transactions['successful'],
        );

        pendingTransactions =
            toInt(
          transactions['pending'],
        );

        failedTransactions =
            toInt(
          transactions['failed'],
        );

        servicepayProfit =
            toDouble(
          servicepay['totalProfit'] ??
              transactions[
                  'servicepayProfit'],
        );

        recentUsers =
            data['recentUsers'] is List
                ? List<dynamic>.from(
                    data['recentUsers'],
                  )
                : <dynamic>[];

        recentTransactions =
            data['recentTransactions']
                    is List
                ? List<dynamic>.from(
                    data[
                        'recentTransactions'],
                  )
                : <dynamic>[];

        isLoading = false;
        hasError = false;
        errorMessage = '';
      });
    } on TimeoutException {
      if (!mounted) {
        return;
      }

      setState(() {
        isLoading = false;
        hasError = true;
        errorMessage =
            'The request timed out. Check your internet connection and try again.';
      });
    } catch (error) {
      if (!mounted) {
        return;
      }

      setState(() {
        isLoading = false;
        hasError = true;
        errorMessage =
            cleanError(error);
      });
    }
  }

  Future<void> refreshDashboard() async {
    await loadDashboard();
  }

  String formatMoney(
    double amount,
  ) {
    final String rounded =
        amount.toStringAsFixed(2);

    final List<String> parts =
        rounded.split('.');

    final String formattedWhole =
        parts[0].replaceAllMapped(
      RegExp(
        r'\B(?=(\d{3})+(?!\d))',
      ),
      (Match match) => ',',
    );

    return '₦$formattedWhole.${parts[1]}';
  }

  String formatDate(
    dynamic value,
  ) {
    final DateTime? date =
        DateTime.tryParse(
      value?.toString() ?? '',
    );

    if (date == null) {
      return 'Unknown date';
    }

    final DateTime localDate =
        date.toLocal();

    return '${localDate.day}/${localDate.month}/${localDate.year}';
  }

  Color transactionStatusColor(
    String status,
  ) {
    switch (status.toUpperCase()) {
      case 'SUCCESSFUL':
      case 'SUCCESS':
        return Colors.green;

      case 'FAILED':
        return Colors.red;

      case 'REFUNDED':
        return Colors.blue;

      default:
        return Colors.orange;
    }
  }

  Future<void> openUsers() async {
    await Navigator.push(
      context,
      MaterialPageRoute(
        builder: (_) =>
            const AdminUsersScreen(),
      ),
    );

    if (mounted) {
      await refreshDashboard();
    }
  }

  Future<void> openTransactions() async {
    await Navigator.push(
      context,
      MaterialPageRoute(
        builder: (_) =>
            const AdminTransactionsScreen(),
      ),
    );

    if (mounted) {
      await refreshDashboard();
    }
  }

  Future<void> openNotifications() async {
    await Navigator.push(
      context,
      MaterialPageRoute(
        builder: (_) =>
            const AdminNotificationsScreen(),
      ),
    );

    if (mounted) {
      await refreshDashboard();
    }
  }

  Future<void> openModule({
    required String title,
    required String description,
    required IconData icon,
  }) async {
    await Navigator.push(
      context,
      MaterialPageRoute(
        builder: (_) =>
            AdminModuleScreen(
          title: title,
          description: description,
          icon: icon,
        ),
      ),
    );

    if (mounted) {
      await refreshDashboard();
    }
  }

  Widget buildStatCard({
    required String title,
    required String value,
    required IconData icon,
    required Color color,
  }) {
    return Container(
      padding: const EdgeInsets.all(
        14,
      ),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius:
            BorderRadius.circular(
          18,
        ),
        border: Border.all(
          color:
              Colors.grey.shade200,
        ),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(
              alpha: 0.04,
            ),
            blurRadius: 12,
            offset:
                const Offset(0, 5),
          ),
        ],
      ),
      child: Row(
        children: [
          Container(
            width: 45,
            height: 45,
            decoration: BoxDecoration(
              color: color.withValues(
                alpha: 0.12,
              ),
              borderRadius:
                  BorderRadius.circular(
                13,
              ),
            ),
            child: Icon(
              icon,
              color: color,
            ),
          ),
          const SizedBox(
            width: 10,
          ),
          Expanded(
            child: Column(
              mainAxisAlignment:
                  MainAxisAlignment.center,
              crossAxisAlignment:
                  CrossAxisAlignment.start,
              children: [
                Text(
                  value,
                  maxLines: 1,
                  overflow:
                      TextOverflow.ellipsis,
                  style:
                      const TextStyle(
                    fontSize: 18,
                    fontWeight:
                        FontWeight.w900,
                  ),
                ),
                const SizedBox(
                  height: 3,
                ),
                Text(
                  title,
                  maxLines: 2,
                  overflow:
                      TextOverflow.ellipsis,
                  style: TextStyle(
                    fontSize: 11,
                    color:
                        Colors.grey.shade600,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget buildErrorState() {
    return RefreshIndicator(
      onRefresh: refreshDashboard,
      child: ListView(
        physics:
            const AlwaysScrollableScrollPhysics(),
        padding:
            const EdgeInsets.all(24),
        children: [
          const SizedBox(
            height: 80,
          ),
          Icon(
            Icons.cloud_off_rounded,
            size: 72,
            color: Colors.red.shade300,
          ),
          const SizedBox(
            height: 20,
          ),
          const Text(
            'Unable to load dashboard',
            textAlign: TextAlign.center,
            style: TextStyle(
              fontSize: 21,
              fontWeight:
                  FontWeight.w900,
            ),
          ),
          const SizedBox(
            height: 10,
          ),
          Text(
            errorMessage,
            textAlign:
                TextAlign.center,
            style: TextStyle(
              color:
                  Colors.grey.shade700,
              height: 1.5,
            ),
          ),
          const SizedBox(
            height: 24,
          ),
          Center(
            child: FilledButton.icon(
              onPressed: loadDashboard,
              icon: const Icon(
                Icons.refresh,
              ),
              label: const Text(
                'Try Again',
              ),
              style:
                  FilledButton.styleFrom(
                backgroundColor:
                    Colors.green,
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget buildSectionCard({
    required String title,
    required int count,
    required String emptyText,
    required List<Widget> children,
  }) {
    return Container(
      padding: const EdgeInsets.all(
        17,
      ),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius:
            BorderRadius.circular(
          18,
        ),
        border: Border.all(
          color:
              Colors.grey.shade200,
        ),
      ),
      child: Column(
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  title,
                  style:
                      const TextStyle(
                    fontSize: 18,
                    fontWeight:
                        FontWeight.w900,
                  ),
                ),
              ),
              Text(
                '$count shown',
                style: TextStyle(
                  color:
                      Colors.grey.shade600,
                  fontSize: 12,
                ),
              ),
            ],
          ),
          const SizedBox(
            height: 12,
          ),
          if (children.isEmpty)
            Padding(
              padding:
                  const EdgeInsets.symmetric(
                vertical: 20,
              ),
              child: Text(
                emptyText,
              ),
            )
          else
            ...children,
        ],
      ),
    );
  }

  Widget buildRecentUsersSection() {
    final List<Widget> userWidgets =
        recentUsers.map(
      (dynamic rawUser) {
        final Map<String, dynamic> user =
            toMap(rawUser);

        final String name =
            user['fullName']?.toString() ??
                'Unknown User';

        final String role =
            user['role']?.toString() ??
                'CUSTOMER';

        final String status =
            user['status']?.toString() ??
                'UNKNOWN';

        return ListTile(
          contentPadding:
              EdgeInsets.zero,
          leading: CircleAvatar(
            backgroundColor:
                Colors.green.shade50,
            child: Text(
              name.isNotEmpty
                  ? name[0].toUpperCase()
                  : 'U',
              style:
                  const TextStyle(
                color: Colors.green,
                fontWeight:
                    FontWeight.w900,
              ),
            ),
          ),
          title: Text(
            name,
            style:
                const TextStyle(
              fontWeight:
                  FontWeight.w800,
            ),
          ),
          subtitle: Text(
            '${role.replaceAll('_', ' ')} • '
            '${formatDate(user['createdAt'])}',
          ),
          trailing: Text(
            status,
            style: TextStyle(
              color:
                  status == 'ACTIVE'
                      ? Colors.green
                      : Colors.orange,
              fontSize: 10,
              fontWeight:
                  FontWeight.w800,
            ),
          ),
        );
      },
    ).toList();

    return buildSectionCard(
      title: 'Recent Users',
      count: recentUsers.length,
      emptyText:
          'No users found.',
      children: userWidgets,
    );
  }

  Widget buildRecentTransactionsSection() {
    final List<Widget>
        transactionWidgets =
        recentTransactions.map(
      (dynamic rawTransaction) {
        final Map<String, dynamic>
            transaction =
            toMap(rawTransaction);

        final Map<String, dynamic>
            customer =
            toMap(
          transaction['customerId'],
        );

        final String serviceType =
            transaction['serviceType']
                    ?.toString() ??
                'TRANSACTION';

        final String status =
            transaction['status']
                    ?.toString() ??
                'UNKNOWN';

        final double amount =
            toDouble(
          transaction['amount'],
        );

        return ListTile(
          contentPadding:
              EdgeInsets.zero,
          leading: Container(
            width: 44,
            height: 44,
            decoration: BoxDecoration(
              color:
                  Colors.purple.shade50,
              borderRadius:
                  BorderRadius.circular(
                13,
              ),
            ),
            child: const Icon(
              Icons.receipt_long_outlined,
              color: Colors.purple,
            ),
          ),
          title: Text(
            serviceType.replaceAll(
              '_',
              ' ',
            ),
            style:
                const TextStyle(
              fontWeight:
                  FontWeight.w800,
            ),
          ),
          subtitle: Text(
            '${customer['fullName'] ?? 'Unknown User'} • '
            '${formatDate(transaction['createdAt'])}',
          ),
          trailing: Column(
            mainAxisAlignment:
                MainAxisAlignment.center,
            crossAxisAlignment:
                CrossAxisAlignment.end,
            children: [
              Text(
                formatMoney(amount),
                style:
                    const TextStyle(
                  fontWeight:
                      FontWeight.w900,
                ),
              ),
              const SizedBox(
                height: 3,
              ),
              Text(
                status,
                style: TextStyle(
                  color:
                      transactionStatusColor(
                    status,
                  ),
                  fontSize: 10,
                  fontWeight:
                      FontWeight.w800,
                ),
              ),
            ],
          ),
        );
      },
    ).toList();

    return buildSectionCard(
      title: 'Recent Transactions',
      count:
          recentTransactions.length,
      emptyText:
          'No transactions found.',
      children:
          transactionWidgets,
    );
  }

  Widget buildAdminTool({
    required String title,
    required String subtitle,
    required IconData icon,
    required VoidCallback onTap,
  }) {
    return Card(
      margin:
          const EdgeInsets.only(
        bottom: 12,
      ),
      elevation: 0,
      color: Colors.white,
      shape: RoundedRectangleBorder(
        borderRadius:
            BorderRadius.circular(
          16,
        ),
        side: BorderSide(
          color:
              Colors.grey.shade200,
        ),
      ),
      child: ListTile(
        contentPadding:
            const EdgeInsets.symmetric(
          horizontal: 16,
          vertical: 8,
        ),
        leading: Container(
          width: 48,
          height: 48,
          decoration: BoxDecoration(
            color:
                Colors.green.withValues(
              alpha: 0.10,
            ),
            borderRadius:
                BorderRadius.circular(
              14,
            ),
          ),
          child: Icon(
            icon,
            color: Colors.green,
          ),
        ),
        title: Text(
          title,
          style:
              const TextStyle(
            fontWeight:
                FontWeight.bold,
          ),
        ),
        subtitle: Padding(
          padding:
              const EdgeInsets.only(
            top: 4,
          ),
          child: Text(
            subtitle,
          ),
        ),
        trailing: const Icon(
          Icons.arrow_forward_ios,
          size: 17,
        ),
        onTap: onTap,
      ),
    );
  }

  Widget buildHeader() {
    return Container(
      width: double.infinity,
      padding:
          const EdgeInsets.all(
        22,
      ),
      decoration: BoxDecoration(
        gradient:
            const LinearGradient(
          colors: [
            Color(0xFF1D7D32),
            Color(0xFF48A84F),
          ],
          begin:
              Alignment.topLeft,
          end:
              Alignment.bottomRight,
        ),
        borderRadius:
            BorderRadius.circular(
          22,
        ),
        boxShadow: [
          BoxShadow(
            color:
                Colors.green.withValues(
              alpha: 0.24,
            ),
            blurRadius: 18,
            offset:
                const Offset(0, 8),
          ),
        ],
      ),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment:
                  CrossAxisAlignment.start,
              children: [
                const Text(
                  'Welcome Back',
                  style:
                      TextStyle(
                    color:
                        Colors.white70,
                    fontSize: 15,
                  ),
                ),
                const SizedBox(
                  height: 6,
                ),
                Text(
                  adminName,
                  style:
                      const TextStyle(
                    color:
                        Colors.white,
                    fontSize: 26,
                    fontWeight:
                        FontWeight.bold,
                  ),
                ),
                const SizedBox(
                  height: 8,
                ),
                Container(
                  padding:
                      const EdgeInsets.symmetric(
                    horizontal: 12,
                    vertical: 6,
                  ),
                  decoration:
                      BoxDecoration(
                    color: Colors.white
                        .withValues(
                      alpha: 0.18,
                    ),
                    borderRadius:
                        BorderRadius.circular(
                      20,
                    ),
                  ),
                  child: Text(
                    adminRole.replaceAll(
                      '_',
                      ' ',
                    ),
                    style:
                        const TextStyle(
                      color:
                          Colors.white,
                      fontSize: 12,
                      fontWeight:
                          FontWeight.w600,
                    ),
                  ),
                ),
              ],
            ),
          ),

          /*
           * Clickable account-management icon.
           *
           * HEAD OFFICE:
           * Opens all managed users.
           *
           * ZONAL MANAGER:
           * Opens users in the zone and allows
           * creation of State Managers.
           *
           * STATE MANAGER:
           * Opens users in the state and allows
           * creation of Agents.
           */
          Material(
            color: Colors.transparent,
            child: InkWell(
              onTap: openUsers,
              borderRadius:
                  BorderRadius.circular(
                40,
              ),
              child: Container(
                width: 72,
                height: 72,
                decoration:
                    BoxDecoration(
                  color: Colors.white
                      .withValues(
                    alpha: 0.18,
                  ),
                  shape: BoxShape.circle,
                  border: Border.all(
                    color: Colors.white
                        .withValues(
                      alpha: 0.25,
                    ),
                  ),
                ),
                child: const Icon(
                  Icons
                      .manage_accounts_rounded,
                  color: Colors.white,
                  size: 43,
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget buildOverviewGrid(
    BoxConstraints constraints,
  ) {
    final int crossAxisCount =
        constraints.maxWidth >= 900
            ? 4
            : constraints.maxWidth >=
                    600
                ? 3
                : 2;

    return GridView.count(
      crossAxisCount:
          crossAxisCount,
      shrinkWrap: true,
      physics:
          const NeverScrollableScrollPhysics(),
      mainAxisSpacing: 14,
      crossAxisSpacing: 14,
      childAspectRatio:
          constraints.maxWidth < 600
              ? 1.32
              : 1.5,
      children: [
        buildStatCard(
          title: 'Total Users',
          value:
              totalUsers.toString(),
          icon:
              Icons.groups_outlined,
          color: Colors.blue,
        ),
        buildStatCard(
          title: 'Active Users',
          value:
              activeUsers.toString(),
          icon: Icons
              .verified_user_outlined,
          color: Colors.green,
        ),
        buildStatCard(
          title: 'Customers',
          value:
              totalCustomers.toString(),
          icon:
              Icons.person_outline,
          color: Colors.indigo,
        ),
        buildStatCard(
          title: 'Agents',
          value:
              totalAgents.toString(),
          icon: Icons
              .support_agent_outlined,
          color: Colors.teal,
        ),
        buildStatCard(
          title: 'Transactions',
          value:
              totalTransactions.toString(),
          icon: Icons
              .receipt_long_outlined,
          color: Colors.purple,
        ),
        buildStatCard(
          title:
              'Transaction Value',
          value: formatMoney(
            totalTransactionValue,
          ),
          icon:
              Icons.payments_outlined,
          color:
              Colors.deepPurple,
        ),
        buildStatCard(
          title: 'Wallet Balance',
          value: formatMoney(
            totalWalletBalance,
          ),
          icon: Icons
              .account_balance_wallet_outlined,
          color: Colors.orange,
        ),
        buildStatCard(
          title: 'Pending KYC',
          value:
              pendingVerifications
                  .toString(),
          icon:
              Icons.badge_outlined,
          color:
              Colors.deepOrange,
        ),
        buildStatCard(
          title: 'Successful',
          value:
              successfulTransactions
                  .toString(),
          icon: Icons
              .check_circle_outline,
          color: Colors.green,
        ),
        buildStatCard(
          title:
              'Pending Transactions',
          value:
              pendingTransactions
                  .toString(),
          icon:
              Icons.schedule_outlined,
          color: Colors.orange,
        ),
        buildStatCard(
          title:
              'Failed Transactions',
          value:
              failedTransactions
                  .toString(),
          icon:
              Icons.error_outline,
          color: Colors.red,
        ),
        buildStatCard(
          title:
              'Servicepay Profit',
          value: formatMoney(
            servicepayProfit,
          ),
          icon: Icons
              .trending_up_outlined,
          color: Colors.green,
        ),
      ],
    );
  }

  Widget buildAdminTools() {
    return Column(
      children: [
        buildAdminTool(
          title: 'Manage Users',
          subtitle:
              'View, create, activate, suspend and manage ServicePay users.',
          icon: Icons
              .manage_accounts_outlined,
          onTap: openUsers,
        ),
        buildAdminTool(
          title: 'Transactions',
          subtitle:
              'Monitor all customer transactions.',
          icon: Icons
              .receipt_long_outlined,
          onTap: openTransactions,
        ),
        buildAdminTool(
          title:
              'Delivery Management',
          subtitle:
              'Set delivery fees and update delivery status.',
          icon: Icons
              .local_shipping_outlined,
          onTap: () {
            openModule(
              title:
                  'Delivery Management',
              description:
                  'Manage delivery requests, fees, assigned riders and delivery status.',
              icon: Icons
                  .local_shipping_outlined,
            );
          },
        ),
        buildAdminTool(
          title: 'ID Verification',
          subtitle:
              'Review and approve customer verification requests.',
          icon: Icons
              .verified_user_outlined,
          onTap: () {
            openModule(
              title:
                  'ID Verification',
              description:
                  'Review NIN, BVN and other customer verification requests.',
              icon: Icons
                  .verified_user_outlined,
            );
          },
        ),
        buildAdminTool(
          title:
              'Send Notifications',
          subtitle:
              'Send direct or broadcast notifications to users.',
          icon: Icons
              .notifications_active_outlined,
          onTap: openNotifications,
        ),
        buildAdminTool(
          title: 'Commission Management',
          subtitle:
              'Manage agent and manager commissions.',
          icon: Icons.percent_outlined,
          onTap: () {
            Navigator.of(context).push(
              MaterialPageRoute<void>(
                builder: (_) =>
                    const AdminProductCommissionScreen(),
              ),
            );
          },
        ),
      ],
    );
  }

  @override
  Widget build(
    BuildContext context,
  ) {
    return Scaffold(
      backgroundColor:
          const Color(0xFFF5F7FA),
      appBar: AppBar(
        backgroundColor:
            Colors.green,
        foregroundColor:
            Colors.white,
        elevation: 0,
        title: const Text(
          'Admin Dashboard',
          style: TextStyle(
            fontWeight:
                FontWeight.bold,
          ),
        ),
        actions: [
          IconButton(
            tooltip: 'Refresh',
            onPressed:
                isLoading
                    ? null
                    : refreshDashboard,
            icon: const Icon(
              Icons.refresh,
            ),
          ),
          IconButton(
            tooltip:
                'Send Notifications',
            onPressed:
                openNotifications,
            icon: const Icon(
              Icons
                  .notifications_active_outlined,
            ),
          ),
        ],
      ),
      body: isLoading
          ? const Center(
              child:
                  CircularProgressIndicator(
                color:
                    Colors.green,
              ),
            )
          : hasError
              ? buildErrorState()
              : RefreshIndicator(
                  onRefresh:
                      refreshDashboard,
                  child: LayoutBuilder(
                    builder: (
                      BuildContext context,
                      BoxConstraints
                          constraints,
                    ) {
                      final double
                          contentWidth =
                          constraints
                                      .maxWidth >
                                  1100
                              ? 1050
                              : double
                                  .infinity;

                      return ListView(
                        physics:
                            const AlwaysScrollableScrollPhysics(),
                        padding:
                            const EdgeInsets.all(
                          18,
                        ),
                        children: [
                          Align(
                            alignment:
                                Alignment
                                    .topCenter,
                            child: SizedBox(
                              width:
                                  contentWidth,
                              child: Column(
                                crossAxisAlignment:
                                    CrossAxisAlignment
                                        .start,
                                children: [
                                  buildHeader(),
                                  const SizedBox(
                                    height:
                                        26,
                                  ),
                                  const Text(
                                    'Overview',
                                    style:
                                        TextStyle(
                                      fontSize:
                                          20,
                                      fontWeight:
                                          FontWeight
                                              .bold,
                                    ),
                                  ),
                                  const SizedBox(
                                    height:
                                        15,
                                  ),
                                  buildOverviewGrid(
                                    constraints,
                                  ),
                                  const SizedBox(
                                    height:
                                        26,
                                  ),
                                  buildRecentUsersSection(),
                                  const SizedBox(
                                    height:
                                        18,
                                  ),
                                  buildRecentTransactionsSection(),
                                  const SizedBox(
                                    height:
                                        28,
                                  ),
                                  const Text(
                                    'Admin Tools',
                                    style:
                                        TextStyle(
                                      fontSize:
                                          20,
                                      fontWeight:
                                          FontWeight
                                              .bold,
                                    ),
                                  ),
                                  const SizedBox(
                                    height:
                                        14,
                                  ),
                                  buildAdminTools(),
                                ],
                              ),
                            ),
                          ),
                        ],
                      );
                    },
                  ),
                ),
    );
  }
}

class AdminModuleScreen
    extends StatelessWidget {
  const AdminModuleScreen({
    super.key,
    required this.title,
    required this.description,
    required this.icon,
  });

  final String title;
  final String description;
  final IconData icon;

  @override
  Widget build(
    BuildContext context,
  ) {
    return Scaffold(
      backgroundColor:
          const Color(0xFFF5F7FA),
      appBar: AppBar(
        title: Text(
          title,
          style: const TextStyle(
            fontWeight:
                FontWeight.bold,
          ),
        ),
        backgroundColor:
            Colors.green,
        foregroundColor:
            Colors.white,
      ),
      body: Center(
        child: SingleChildScrollView(
          padding:
              const EdgeInsets.all(
            24,
          ),
          child: Container(
            width: 520,
            padding:
                const EdgeInsets.all(
              28,
            ),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius:
                  BorderRadius.circular(
                22,
              ),
              border: Border.all(
                color:
                    Colors.grey.shade200,
              ),
            ),
            child: Column(
              mainAxisSize:
                  MainAxisSize.min,
              children: [
                Container(
                  width: 82,
                  height: 82,
                  decoration:
                      BoxDecoration(
                    color: Colors.green
                        .withValues(
                      alpha: 0.12,
                    ),
                    borderRadius:
                        BorderRadius.circular(
                      24,
                    ),
                  ),
                  child: Icon(
                    icon,
                    color:
                        Colors.green,
                    size: 42,
                  ),
                ),
                const SizedBox(
                  height: 22,
                ),
                Text(
                  title,
                  textAlign:
                      TextAlign.center,
                  style:
                      const TextStyle(
                    fontSize: 24,
                    fontWeight:
                        FontWeight.w900,
                  ),
                ),
                const SizedBox(
                  height: 12,
                ),
                Text(
                  description,
                  textAlign:
                      TextAlign.center,
                  style: TextStyle(
                    color:
                        Colors.grey.shade700,
                    fontSize: 15,
                    height: 1.5,
                  ),
                ),
                const SizedBox(
                  height: 24,
                ),
                FilledButton.icon(
                  onPressed: () {
                    Navigator.pop(
                      context,
                    );
                  },
                  icon: const Icon(
                    Icons.arrow_back,
                  ),
                  label: const Text(
                    'Back to Dashboard',
                  ),
                  style:
                      FilledButton.styleFrom(
                    backgroundColor:
                        Colors.green,
                    padding:
                        const EdgeInsets.symmetric(
                      horizontal: 22,
                      vertical: 14,
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

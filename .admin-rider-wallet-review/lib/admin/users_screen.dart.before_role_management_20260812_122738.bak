import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

import 'create_admin_user_dialog.dart';

class AdminUsersScreen extends StatefulWidget {
  const AdminUsersScreen({
    super.key,
  });

  @override
  State<AdminUsersScreen> createState() =>
      _AdminUsersScreenState();
}

class _AdminUsersScreenState extends State<AdminUsersScreen> {
  static const String baseUrl =
      'https://api.servicepay.ng/api';

  static const Color primaryGreen =
      Color(0xFF159447);

  final TextEditingController searchController =
      TextEditingController();

  List<Map<String, dynamic>> users =
      <Map<String, dynamic>>[];

  bool isLoading = true;
  bool isUpdating = false;

  String? errorMessage;

  String selectedRole = 'ALL';
  String selectedStatus = 'ALL';

  String adminRole = 'HEAD_OFFICE';

  @override
  void initState() {
    super.initState();
    loadAdminRole();
    loadUsers();
  }

  @override
  void dispose() {
    searchController.dispose();
    super.dispose();
  }

  Future<void> loadAdminRole() async {
    final SharedPreferences prefs =
        await SharedPreferences.getInstance();

    final String role =
        prefs.getString('user_role') ??
            prefs.getString('admin_role') ??
            prefs.getString('role') ??
            'HEAD_OFFICE';

    if (!mounted) {
      return;
    }

    setState(() {
      adminRole = normalizeRole(role);
    });
  }

  String normalizeRole(
    String? value,
  ) {
    return (value ?? '')
        .trim()
        .toUpperCase()
        .replaceAll(
          RegExp(r'[\s-]+'),
          '_',
        );
  }

  bool get isHeadOffice {
    return adminRole == 'HEAD_OFFICE';
  }

  Future<String?> getToken() async {
    final SharedPreferences prefs =
        await SharedPreferences.getInstance();

    final String? rawToken =
        prefs.getString('auth_token') ??
            prefs.getString('token') ??
            prefs.getString('admin_token');

    if (rawToken == null ||
        rawToken.trim().isEmpty) {
      return null;
    }

    String token = rawToken.trim();

    if (token.toLowerCase().startsWith(
          'bearer ',
        )) {
      token = token.substring(7).trim();
    }

    return token.isEmpty ? null : token;
  }

  Map<String, dynamic> decodeResponse(
    http.Response response,
  ) {
    final String body = response.body.trim();

    if (body.isEmpty) {
      return <String, dynamic>{
        'success': false,
        'message':
            'The server returned an empty response.',
      };
    }

    try {
      final dynamic decoded = jsonDecode(body);

      if (decoded is Map) {
        return Map<String, dynamic>.from(
          decoded,
        );
      }
    } catch (_) {
      // Return standard error below.
    }

    return <String, dynamic>{
      'success': false,
      'message':
          'The server returned an invalid response.',
    };
  }

  String responseMessage(
    Map<String, dynamic> body, {
    required String fallback,
  }) {
    final String message =
        (body['message'] ??
                body['error'] ??
                body['detail'] ??
                '')
            .toString()
            .trim();

    return message.isEmpty
        ? fallback
        : message;
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

  List<Map<String, dynamic>> extractList(
    Map<String, dynamic> body,
    List<String> possibleKeys,
  ) {
    for (final String key in possibleKeys) {
      final dynamic value = body[key];

      if (value is List) {
        return value
            .whereType<Map>()
            .map(
              (Map item) =>
                  Map<String, dynamic>.from(
                item,
              ),
            )
            .toList();
      }
    }

    final Map<String, dynamic> data =
        toMap(body['data']);

    for (final String key in possibleKeys) {
      final dynamic value = data[key];

      if (value is List) {
        return value
            .whereType<Map>()
            .map(
              (Map item) =>
                  Map<String, dynamic>.from(
                item,
              ),
            )
            .toList();
      }
    }

    return <Map<String, dynamic>>[];
  }

  Future<void> loadUsers() async {
    if (!mounted) {
      return;
    }

    setState(() {
      isLoading = true;
      errorMessage = null;
    });

    try {
      final String? token = await getToken();

      if (token == null) {
        throw Exception(
          'Admin authentication token was not found.',
        );
      }

      final Map<String, String> queryParameters =
          <String, String>{
        'limit': '100',
      };

      final String search =
          searchController.text.trim();

      if (search.isNotEmpty) {
        queryParameters['search'] = search;
      }

      if (selectedRole != 'ALL') {
        queryParameters['role'] =
            selectedRole;
      }

      if (selectedStatus != 'ALL') {
        queryParameters['status'] =
            selectedStatus;
      }

      final Uri uri = Uri.parse(
        '$baseUrl/admin/users',
      ).replace(
        queryParameters: queryParameters,
      );

      final http.Response response =
          await http
              .get(
                uri,
                headers: <String, String>{
                  'Accept':
                      'application/json',
                  'Authorization':
                      'Bearer $token',
                },
              )
              .timeout(
                const Duration(
                  seconds: 45,
                ),
              );

      final Map<String, dynamic> body =
          decodeResponse(response);

      final bool successful =
          response.statusCode >= 200 &&
          response.statusCode < 300 &&
          body['success'] == true;

      if (!successful) {
        throw Exception(
          responseMessage(
            body,
            fallback:
                'Failed to load users.',
          ),
        );
      }

      final List<Map<String, dynamic>>
          loadedUsers = extractList(
        body,
        const <String>[
          'users',
          'records',
          'items',
        ],
      );

      if (!mounted) {
        return;
      }

      setState(() {
        users = loadedUsers;
      });
    } on TimeoutException {
      if (!mounted) {
        return;
      }

      setState(() {
        errorMessage =
            'The request timed out. Please try again.';
      });
    } catch (error) {
      if (!mounted) {
        return;
      }

      setState(() {
        errorMessage = error
            .toString()
            .replaceFirst(
              'Exception: ',
              '',
            );
      });
    } finally {
      if (mounted) {
        setState(() {
          isLoading = false;
        });
      }
    }
  }

  Future<Map<String, dynamic>?>
      loadUserDetails(
    String userId,
  ) async {
    try {
      final String? token = await getToken();

      if (token == null) {
        throw Exception(
          'Admin authentication token was not found.',
        );
      }

      final http.Response response =
          await http
              .get(
                Uri.parse(
                  '$baseUrl/admin/users/$userId',
                ),
                headers: <String, String>{
                  'Accept':
                      'application/json',
                  'Authorization':
                      'Bearer $token',
                },
              )
              .timeout(
                const Duration(
                  seconds: 45,
                ),
              );

      final Map<String, dynamic> body =
          decodeResponse(response);

      final bool successful =
          response.statusCode >= 200 &&
          response.statusCode < 300 &&
          body['success'] == true;

      if (!successful) {
        throw Exception(
          responseMessage(
            body,
            fallback:
                'Unable to load user details.',
          ),
        );
      }

      final Map<String, dynamic> data =
          toMap(body['data']);

      final Map<String, dynamic> user =
          toMap(
        data['user'] ?? body['user'],
      );

      if (user.isEmpty) {
        throw Exception(
          'The server returned incomplete user information.',
        );
      }

      return <String, dynamic>{
        ...data,
        'user': user,
      };
    } catch (error) {
      showMessage(
        error
            .toString()
            .replaceFirst(
              'Exception: ',
              '',
            ),
        isError: true,
      );

      return null;
    }
  }

  Future<void> openUserDetails(
    Map<String, dynamic> listedUser,
  ) async {
    final String userId =
        listedUser['_id']?.toString() ??
            listedUser['id']?.toString() ??
            '';

    if (userId.isEmpty) {
      showMessage(
        'User ID was not found.',
        isError: true,
      );
      return;
    }

    showDialog<void>(
      context: context,
      barrierDismissible: false,
      builder: (
        BuildContext dialogContext,
      ) {
        return const Center(
          child: CircularProgressIndicator(),
        );
      },
    );

    final Map<String, dynamic>? details =
        await loadUserDetails(userId);

    if (mounted &&
        Navigator.canPop(context)) {
      Navigator.pop(context);
    }

    if (details == null || !mounted) {
      return;
    }

    final Map<String, dynamic> user =
        toMap(details['user']);

    final Map<String, dynamic>
        transactionSummary = toMap(
      details['transactionSummary'],
    );

    final List<Map<String, dynamic>>
        recentTransactions =
        details['recentTransactions'] is List
            ? List<Map<String, dynamic>>.from(
                (details['recentTransactions']
                        as List)
                    .whereType<Map>()
                    .map(
                      (Map item) =>
                          Map<String, dynamic>.from(
                        item,
                      ),
                    ),
              )
            : <Map<String, dynamic>>[];

    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      backgroundColor:
          const Color(0xFFF8FAFC),
      builder: (
        BuildContext bottomSheetContext,
      ) {
        return DraggableScrollableSheet(
          expand: false,
          initialChildSize: 0.90,
          minChildSize: 0.55,
          maxChildSize: 0.96,
          builder: (
            BuildContext context,
            ScrollController scrollController,
          ) {
            return ListView(
              controller: scrollController,
              padding:
                  const EdgeInsets.fromLTRB(
                18,
                4,
                18,
                30,
              ),
              children: <Widget>[
                buildUserHeader(user),
                const SizedBox(height: 16),
                buildAccountInformation(user),
                const SizedBox(height: 16),
                buildFinancialSummary(
                  user,
                  transactionSummary,
                ),
                const SizedBox(height: 16),
                buildCustomerActions(
                  user,
                  bottomSheetContext,
                ),
                const SizedBox(height: 18),
                buildRecentTransactions(
                  recentTransactions,
                ),
              ],
            );
          },
        );
      },
    );
  }

  Widget buildUserHeader(
    Map<String, dynamic> user,
  ) {
    final String fullName =
        user['fullName']?.toString() ??
            'Unknown User';

    final String role =
        normalizeRole(
      user['role']?.toString(),
    );

    final String status =
        normalizeRole(
      user['status']?.toString(),
    );

    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          colors: <Color>[
            Color(0xFF166534),
            Color(0xFF22A447),
          ],
        ),
        borderRadius:
            BorderRadius.circular(22),
      ),
      child: Row(
        children: <Widget>[
          CircleAvatar(
            radius: 31,
            backgroundColor:
                Colors.white.withValues(
              alpha: 0.18,
            ),
            child: Text(
              fullName.isEmpty
                  ? 'U'
                  : fullName[0].toUpperCase(),
              style: const TextStyle(
                color: Colors.white,
                fontSize: 25,
                fontWeight:
                    FontWeight.w900,
              ),
            ),
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment:
                  CrossAxisAlignment.start,
              children: <Widget>[
                Text(
                  fullName,
                  maxLines: 2,
                  overflow:
                      TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 21,
                    fontWeight:
                        FontWeight.w900,
                  ),
                ),
                const SizedBox(height: 7),
                Wrap(
                  spacing: 8,
                  runSpacing: 7,
                  children: <Widget>[
                    headerBadge(
                      displayRole(role),
                    ),
                    headerBadge(status),
                  ],
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget headerBadge(
    String label,
  ) {
    return Container(
      padding:
          const EdgeInsets.symmetric(
        horizontal: 10,
        vertical: 6,
      ),
      decoration: BoxDecoration(
        color: Colors.white.withValues(
          alpha: 0.17,
        ),
        borderRadius:
            BorderRadius.circular(20),
      ),
      child: Text(
        label,
        style: const TextStyle(
          color: Colors.white,
          fontSize: 11,
          fontWeight: FontWeight.w800,
        ),
      ),
    );
  }

  Widget buildAccountInformation(
    Map<String, dynamic> user,
  ) {
    return sectionCard(
      title: 'Account Information',
      child: Column(
        children: <Widget>[
          detailRow(
            'Phone',
            user['phone']?.toString() ??
                'Not provided',
          ),
          detailRow(
            'Email',
            user['email']?.toString() ??
                'Not provided',
          ),
          detailRow(
            'Zone',
            user['zone']?.toString() ??
                'Not provided',
          ),
          detailRow(
            'State',
            user['state']?.toString() ??
                'Not provided',
          ),
          detailRow(
            'LGA',
            user['lga']?.toString() ??
                'Not provided',
          ),
          detailRow(
            'KYC Verified',
            user['kycVerified'] == true
                ? 'Yes'
                : 'No',
          ),
          detailRow(
            'Transaction PIN',
            user['transactionPinSet'] ==
                    true
                ? 'Created'
                : 'Not created',
            valueColor:
                user['transactionPinSet'] ==
                        true
                    ? Colors.green
                    : Colors.orange,
          ),
          detailRow(
            'Referral Code',
            user['referralCode']
                    ?.toString() ??
                'Not available',
            showDivider: false,
          ),
        ],
      ),
    );
  }

  Widget buildFinancialSummary(
    Map<String, dynamic> user,
    Map<String, dynamic> summary,
  ) {
    return sectionCard(
      title: 'Wallet & Transactions',
      child: Column(
        children: <Widget>[
          detailRow(
            'Wallet Balance',
            formatMoney(
              user['walletBalance'],
            ),
          ),
          detailRow(
            'Commission Balance',
            formatMoney(
              user['commissionBalance'],
            ),
          ),
          detailRow(
            'Total Earnings',
            formatMoney(
              user['totalEarnings'],
            ),
          ),
          detailRow(
            'Transactions',
            (summary['total'] ??
                    user[
                        'totalTransactions'] ??
                    0)
                .toString(),
          ),
          detailRow(
            'Successful',
            (summary['successful'] ?? 0)
                .toString(),
            valueColor: Colors.green,
          ),
          detailRow(
            'Pending',
            (summary['pending'] ?? 0)
                .toString(),
            valueColor: Colors.orange,
          ),
          detailRow(
            'Failed',
            (summary['failed'] ?? 0)
                .toString(),
            valueColor: Colors.red,
            showDivider: false,
          ),
        ],
      ),
    );
  }

  Widget buildCustomerActions(
    Map<String, dynamic> user,
    BuildContext bottomSheetContext,
  ) {
    final String role =
        normalizeRole(
      user['role']?.toString(),
    );

    return sectionCard(
      title: 'Account Actions',
      child: Column(
        children: <Widget>[
          actionTile(
            icon: Icons.edit_outlined,
            title: 'Edit Customer Details',
            subtitle:
                'Change name, phone, email and location.',
            enabled: isHeadOffice,
            onTap: () async {
              Navigator.pop(
                bottomSheetContext,
              );

              await showEditUserDialog(
                user,
              );
            },
          ),
          actionTile(
            icon: Icons.pin_outlined,
            title:
                'Reset Transaction PIN',
            subtitle:
                'Customer will create a new 4-digit PIN.',
            enabled:
                isHeadOffice &&
                    role != 'HEAD_OFFICE',
            onTap: () async {
              Navigator.pop(
                bottomSheetContext,
              );

              await resetTransactionPin(
                user,
              );
            },
          ),
          actionTile(
            icon:
                Icons.lock_reset_rounded,
            title:
                'Send Password Reset Email',
            subtitle:
                'A secure reset link will be emailed to the customer.',
            enabled:
                isHeadOffice &&
                    role != 'HEAD_OFFICE',
            onTap: () async {
              Navigator.pop(
                bottomSheetContext,
              );

              await sendPasswordResetEmail(
                user,
              );
            },
          ),
          actionTile(
            icon:
                Icons.receipt_long_outlined,
            title: 'View Transactions',
            subtitle:
                'Open the customer transaction history.',
            enabled: true,
            onTap: () async {
              Navigator.pop(
                bottomSheetContext,
              );

              await showUserTransactions(
                user,
              );
            },
          ),
          actionTile(
            icon:
                Icons.history_rounded,
            title: 'View Audit Logs',
            subtitle:
                'Review administrative actions on this account.',
            enabled: isHeadOffice,
            onTap: () async {
              Navigator.pop(
                bottomSheetContext,
              );

              await showAuditLogs(
                user,
              );
            },
          ),
          const Divider(height: 26),
          Wrap(
            spacing: 10,
            runSpacing: 10,
            children: <Widget>[
              FilledButton.icon(
                onPressed: isUpdating
                    ? null
                    : () {
                        Navigator.pop(
                          bottomSheetContext,
                        );

                        updateUserStatus(
                          user,
                          'ACTIVE',
                        );
                      },
                icon: const Icon(
                  Icons
                      .check_circle_outline,
                ),
                label:
                    const Text('Activate'),
                style:
                    FilledButton.styleFrom(
                  backgroundColor:
                      Colors.green,
                ),
              ),
              OutlinedButton.icon(
                onPressed: isUpdating
                    ? null
                    : () {
                        Navigator.pop(
                          bottomSheetContext,
                        );

                        updateUserStatus(
                          user,
                          'SUSPENDED',
                        );
                      },
                icon: const Icon(
                  Icons
                      .pause_circle_outline,
                ),
                label:
                    const Text('Suspend'),
              ),
              OutlinedButton.icon(
                onPressed: isUpdating
                    ? null
                    : () {
                        Navigator.pop(
                          bottomSheetContext,
                        );

                        updateUserStatus(
                          user,
                          'BLOCKED',
                        );
                      },
                icon:
                    const Icon(Icons.block),
                label:
                    const Text('Block'),
                style:
                    OutlinedButton.styleFrom(
                  foregroundColor:
                      Colors.red,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget actionTile({
    required IconData icon,
    required String title,
    required String subtitle,
    required bool enabled,
    required VoidCallback onTap,
  }) {
    return ListTile(
      enabled: enabled,
      contentPadding: EdgeInsets.zero,
      leading: Container(
        width: 45,
        height: 45,
        decoration: BoxDecoration(
          color: enabled
              ? const Color(0xFFE8F5EC)
              : Colors.grey.shade200,
          borderRadius:
              BorderRadius.circular(13),
        ),
        child: Icon(
          icon,
          color: enabled
              ? primaryGreen
              : Colors.grey,
        ),
      ),
      title: Text(
        title,
        style: const TextStyle(
          fontWeight: FontWeight.w800,
        ),
      ),
      subtitle: Text(subtitle),
      trailing: const Icon(
        Icons.chevron_right_rounded,
      ),
      onTap: enabled ? onTap : null,
    );
  }

  Widget buildRecentTransactions(
    List<Map<String, dynamic>>
        transactions,
  ) {
    return sectionCard(
      title: 'Recent Transactions',
      child: transactions.isEmpty
          ? const Padding(
              padding: EdgeInsets.symmetric(
                vertical: 15,
              ),
              child: Text(
                'No transactions found.',
              ),
            )
          : Column(
              children: transactions.map(
                (
                  Map<String, dynamic>
                      transaction,
                ) {
                  final String status =
                      normalizeRole(
                    transaction['status']
                        ?.toString(),
                  );

                  return ListTile(
                    contentPadding:
                        EdgeInsets.zero,
                    leading: CircleAvatar(
                      backgroundColor:
                          const Color(
                        0xFFE8F5EC,
                      ),
                      child: const Icon(
                        Icons
                            .receipt_long_outlined,
                        color: primaryGreen,
                      ),
                    ),
                    title: Text(
                      (transaction[
                                  'serviceType'] ??
                              'TRANSACTION')
                          .toString()
                          .replaceAll(
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
                      transaction['reference']
                              ?.toString() ??
                          'No reference',
                    ),
                    trailing: Column(
                      mainAxisAlignment:
                          MainAxisAlignment
                              .center,
                      crossAxisAlignment:
                          CrossAxisAlignment
                              .end,
                      children: <Widget>[
                        Text(
                          formatMoney(
                            transaction[
                                'amount'],
                          ),
                          style:
                              const TextStyle(
                            fontWeight:
                                FontWeight.w900,
                          ),
                        ),
                        Text(
                          status,
                          style: TextStyle(
                            fontSize: 10,
                            color:
                                statusColor(
                              status,
                            ),
                            fontWeight:
                                FontWeight.w800,
                          ),
                        ),
                      ],
                    ),
                  );
                },
              ).toList(),
            ),
    );
  }

  Widget sectionCard({
    required String title,
    required Widget child,
  }) {
    return Container(
      padding: const EdgeInsets.all(17),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius:
            BorderRadius.circular(18),
        border: Border.all(
          color: Colors.grey.shade200,
        ),
      ),
      child: Column(
        crossAxisAlignment:
            CrossAxisAlignment.start,
        children: <Widget>[
          Text(
            title,
            style: const TextStyle(
              fontSize: 17,
              fontWeight: FontWeight.w900,
            ),
          ),
          const SizedBox(height: 12),
          child,
        ],
      ),
    );
  }

  Widget detailRow(
    String label,
    String value, {
    Color? valueColor,
    bool showDivider = true,
  }) {
    return Container(
      padding:
          const EdgeInsets.symmetric(
        vertical: 11,
      ),
      decoration: BoxDecoration(
        border: showDivider
            ? const Border(
                bottom: BorderSide(
                  color:
                      Color(0xFFE5E7EB),
                ),
              )
            : null,
      ),
      child: Row(
        crossAxisAlignment:
            CrossAxisAlignment.start,
        children: <Widget>[
          SizedBox(
            width: 135,
            child: Text(
              label,
              style: TextStyle(
                color:
                    Colors.grey.shade700,
                fontWeight:
                    FontWeight.w600,
              ),
            ),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: SelectableText(
              value,
              textAlign: TextAlign.right,
              style: TextStyle(
                color: valueColor,
                fontWeight:
                    FontWeight.w800,
              ),
            ),
          ),
        ],
      ),
    );
  }

  Future<String?> requestReason({
    required String title,
    required String description,
  }) async {
    final TextEditingController controller =
        TextEditingController();

    String errorText = '';

    final String? reason =
        await showDialog<String>(
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
            void submit() {
              final String value =
                  controller.text.trim();

              if (value.length < 5) {
                setDialogState(() {
                  errorText =
                      'Enter a clear reason containing at least 5 characters.';
                });
                return;
              }

              Navigator.pop(
                dialogContext,
                value,
              );
            }

            return AlertDialog(
              title: Text(title),
              content: Column(
                mainAxisSize:
                    MainAxisSize.min,
                crossAxisAlignment:
                    CrossAxisAlignment.start,
                children: <Widget>[
                  Text(description),
                  const SizedBox(height: 14),
                  TextField(
                    controller: controller,
                    autofocus: true,
                    maxLength: 500,
                    minLines: 3,
                    maxLines: 5,
                    decoration:
                        InputDecoration(
                      labelText:
                          'Administrative Reason',
                      errorText:
                          errorText.isEmpty
                              ? null
                              : errorText,
                      border:
                          const OutlineInputBorder(),
                    ),
                  ),
                ],
              ),
              actions: <Widget>[
                TextButton(
                  onPressed: () {
                    Navigator.pop(
                      dialogContext,
                    );
                  },
                  child:
                      const Text('Cancel'),
                ),
                FilledButton(
                  onPressed: submit,
                  style:
                      FilledButton.styleFrom(
                    backgroundColor:
                        primaryGreen,
                  ),
                  child:
                      const Text('Continue'),
                ),
              ],
            );
          },
        );
      },
    );

    controller.dispose();

    return reason;
  }

  Future<void> showEditUserDialog(
    Map<String, dynamic> user,
  ) async {
    final String userId =
        user['_id']?.toString() ??
            user['id']?.toString() ??
            '';

    if (userId.isEmpty) {
      showMessage(
        'User ID was not found.',
        isError: true,
      );
      return;
    }

    final TextEditingController
        fullNameController =
        TextEditingController(
      text: user['fullName']?.toString() ??
          '',
    );

    final TextEditingController
        phoneController =
        TextEditingController(
      text: user['phone']?.toString() ?? '',
    );

    final TextEditingController
        emailController =
        TextEditingController(
      text: user['email']?.toString() ?? '',
    );

    final TextEditingController
        zoneController =
        TextEditingController(
      text: user['zone']?.toString() ?? '',
    );

    final TextEditingController
        stateController =
        TextEditingController(
      text: user['state']?.toString() ?? '',
    );

    final TextEditingController lgaController =
        TextEditingController(
      text: user['lga']?.toString() ?? '',
    );

    final GlobalKey<FormState> editFormKey =
        GlobalKey<FormState>();

    final bool? save =
        await showDialog<bool>(
      context: context,
      barrierDismissible: false,
      builder: (
        BuildContext dialogContext,
      ) {
        return AlertDialog(
          title: const Text(
            'Edit Customer Details',
            style: TextStyle(
              fontWeight: FontWeight.w900,
            ),
          ),
          content: SizedBox(
            width: 500,
            child: Form(
              key: editFormKey,
              child: SingleChildScrollView(
                child: Column(
                  mainAxisSize:
                      MainAxisSize.min,
                  children: <Widget>[
                    TextFormField(
                      controller:
                          fullNameController,
                      decoration:
                          const InputDecoration(
                        labelText: 'Full Name',
                        prefixIcon: Icon(
                          Icons.person_outline,
                        ),
                      ),
                      validator: (
                        String? value,
                      ) {
                        if ((value ?? '')
                            .trim()
                            .isEmpty) {
                          return 'Full name is required';
                        }

                        return null;
                      },
                    ),
                    const SizedBox(height: 12),
                    TextFormField(
                      controller:
                          phoneController,
                      keyboardType:
                          TextInputType.phone,
                      inputFormatters:
                          <TextInputFormatter>[
                        FilteringTextInputFormatter
                            .digitsOnly,
                        LengthLimitingTextInputFormatter(
                          15,
                        ),
                      ],
                      decoration:
                          const InputDecoration(
                        labelText: 'Phone',
                        prefixIcon: Icon(
                          Icons.phone_outlined,
                        ),
                      ),
                      validator: (
                        String? value,
                      ) {
                        final String phone =
                            (value ?? '')
                                .trim();

                        if (!RegExp(
                          r'^\d{10,15}$',
                        ).hasMatch(phone)) {
                          return 'Enter a valid phone number';
                        }

                        return null;
                      },
                    ),
                    const SizedBox(height: 12),
                    TextFormField(
                      controller:
                          emailController,
                      keyboardType:
                          TextInputType
                              .emailAddress,
                      decoration:
                          const InputDecoration(
                        labelText: 'Email',
                        prefixIcon: Icon(
                          Icons.email_outlined,
                        ),
                      ),
                    ),
                    const SizedBox(height: 12),
                    TextFormField(
                      controller:
                          zoneController,
                      decoration:
                          const InputDecoration(
                        labelText: 'Zone',
                        prefixIcon: Icon(
                          Icons.public_outlined,
                        ),
                      ),
                    ),
                    const SizedBox(height: 12),
                    TextFormField(
                      controller:
                          stateController,
                      decoration:
                          const InputDecoration(
                        labelText: 'State',
                        prefixIcon: Icon(
                          Icons
                              .location_city_outlined,
                        ),
                      ),
                    ),
                    const SizedBox(height: 12),
                    TextFormField(
                      controller:
                          lgaController,
                      decoration:
                          const InputDecoration(
                        labelText: 'LGA',
                        prefixIcon: Icon(
                          Icons
                              .location_on_outlined,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
          actions: <Widget>[
            TextButton(
              onPressed: () {
                Navigator.pop(
                  dialogContext,
                  false,
                );
              },
              child:
                  const Text('Cancel'),
            ),
            FilledButton(
              onPressed: () {
                final bool valid =
                    editFormKey.currentState
                            ?.validate() ??
                        false;

                if (!valid) {
                  return;
                }

                Navigator.pop(
                  dialogContext,
                  true,
                );
              },
              style: FilledButton.styleFrom(
                backgroundColor:
                    primaryGreen,
              ),
              child:
                  const Text('Continue'),
            ),
          ],
        );
      },
    );

    if (save != true) {
      fullNameController.dispose();
      phoneController.dispose();
      emailController.dispose();
      zoneController.dispose();
      stateController.dispose();
      lgaController.dispose();
      return;
    }

    final String? reason =
        await requestReason(
      title: 'Reason for Profile Update',
      description:
          'Explain why the customer information is being changed.',
    );

    if (reason == null) {
      fullNameController.dispose();
      phoneController.dispose();
      emailController.dispose();
      zoneController.dispose();
      stateController.dispose();
      lgaController.dispose();
      return;
    }

    await performUserAction(
      method: 'PATCH',
      endpoint:
          '/admin/users/$userId/profile',
      requestBody: <String, dynamic>{
        'fullName':
            fullNameController.text.trim(),
        'phone':
            phoneController.text.trim(),
        'email':
            emailController.text.trim(),
        'zone':
            zoneController.text.trim(),
        'state':
            stateController.text.trim(),
        'lga':
            lgaController.text.trim(),
        'reason': reason,
      },
      fallbackSuccessMessage:
          'Customer profile updated successfully.',
    );

    fullNameController.dispose();
    phoneController.dispose();
    emailController.dispose();
    zoneController.dispose();
    stateController.dispose();
    lgaController.dispose();
  }

  Future<void> resetTransactionPin(
    Map<String, dynamic> user,
  ) async {
    final String userId =
        user['_id']?.toString() ??
            user['id']?.toString() ??
            '';

    final String? reason =
        await requestReason(
      title: 'Reset Transaction PIN',
      description:
          'The customer will be required to create a new transaction PIN.',
    );

    if (reason == null) {
      return;
    }

    await performUserAction(
      method: 'POST',
      endpoint:
          '/admin/users/$userId/reset-transaction-pin',
      requestBody: <String, dynamic>{
        'reason': reason,
      },
      fallbackSuccessMessage:
          'Transaction PIN reset successfully.',
    );
  }

  Future<void> sendPasswordResetEmail(
    Map<String, dynamic> user,
  ) async {
    final String userId =
        user['_id']?.toString() ??
            user['id']?.toString() ??
            '';

    final String email =
        user['email']?.toString() ?? '';

    if (email.trim().isEmpty) {
      showMessage(
        'This customer has no email address.',
        isError: true,
      );
      return;
    }

    final String? reason =
        await requestReason(
      title: 'Send Password Reset Email',
      description:
          'A secure reset link will be sent to $email.',
    );

    if (reason == null) {
      return;
    }

    await performUserAction(
      method: 'POST',
      endpoint:
          '/admin/users/$userId/password-reset',
      requestBody: <String, dynamic>{
        'reason': reason,
      },
      fallbackSuccessMessage:
          'Password reset email sent successfully.',
    );
  }

  Future<void> performUserAction({
    required String method,
    required String endpoint,
    required Map<String, dynamic>
        requestBody,
    required String fallbackSuccessMessage,
  }) async {
    if (isUpdating) {
      return;
    }

    setState(() {
      isUpdating = true;
    });

    try {
      final String? token = await getToken();

      if (token == null) {
        throw Exception(
          'Admin authentication token was not found.',
        );
      }

      final Uri uri = Uri.parse(
        '$baseUrl$endpoint',
      );

      late http.Response response;

      final Map<String, String> headers =
          <String, String>{
        'Accept': 'application/json',
        'Content-Type':
            'application/json',
        'Authorization':
            'Bearer $token',
      };

      if (method == 'PATCH') {
        response = await http
            .patch(
              uri,
              headers: headers,
              body: jsonEncode(
                requestBody,
              ),
            )
            .timeout(
              const Duration(
                seconds: 45,
              ),
            );
      } else {
        response = await http
            .post(
              uri,
              headers: headers,
              body: jsonEncode(
                requestBody,
              ),
            )
            .timeout(
              const Duration(
                seconds: 45,
              ),
            );
      }

      final Map<String, dynamic> body =
          decodeResponse(response);

      final bool successful =
          response.statusCode >= 200 &&
          response.statusCode < 300 &&
          body['success'] == true;

      if (!successful) {
        throw Exception(
          responseMessage(
            body,
            fallback:
                'Unable to complete the action.',
          ),
        );
      }

      showMessage(
        responseMessage(
          body,
          fallback:
              fallbackSuccessMessage,
        ),
        isError: false,
      );

      await loadUsers();
    } catch (error) {
      showMessage(
        error
            .toString()
            .replaceFirst(
              'Exception: ',
              '',
            ),
        isError: true,
      );
    } finally {
      if (mounted) {
        setState(() {
          isUpdating = false;
        });
      }
    }
  }

  Future<void> updateUserStatus(
    Map<String, dynamic> user,
    String newStatus,
  ) async {
    final String userId =
        user['_id']?.toString() ??
            user['id']?.toString() ??
            '';

    if (userId.isEmpty) {
      showMessage(
        'User ID was not found.',
        isError: true,
      );
      return;
    }

    final bool? confirmed =
        await showDialog<bool>(
      context: context,
      builder: (
        BuildContext dialogContext,
      ) {
        return AlertDialog(
          title:
              const Text('Confirm Action'),
          content: Text(
            'Change ${user['fullName'] ?? 'this user'} status to $newStatus?',
          ),
          actions: <Widget>[
            TextButton(
              onPressed: () {
                Navigator.pop(
                  dialogContext,
                  false,
                );
              },
              child:
                  const Text('Cancel'),
            ),
            FilledButton(
              onPressed: () {
                Navigator.pop(
                  dialogContext,
                  true,
                );
              },
              child:
                  const Text('Confirm'),
            ),
          ],
        );
      },
    );

    if (confirmed != true) {
      return;
    }

    await performUserAction(
      method: 'PATCH',
      endpoint:
          '/admin/users/$userId/status',
      requestBody: <String, dynamic>{
        'status': newStatus,
      },
      fallbackSuccessMessage:
          'User status updated successfully.',
    );
  }

  Future<void> showUserTransactions(
    Map<String, dynamic> user,
  ) async {
    final String userId =
        user['_id']?.toString() ??
            user['id']?.toString() ??
            '';

    await showServerListDialog(
      title:
          '${user['fullName'] ?? 'Customer'} Transactions',
      endpoint:
          '/admin/users/$userId/transactions?limit=100',
      possibleKeys: const <String>[
        'transactions',
        'records',
        'items',
      ],
      itemBuilder: (
        Map<String, dynamic> item,
      ) {
        final String status =
            normalizeRole(
          item['status']?.toString(),
        );

        return ListTile(
          leading: CircleAvatar(
            backgroundColor:
                const Color(0xFFE8F5EC),
            child: const Icon(
              Icons.receipt_long_outlined,
              color: primaryGreen,
            ),
          ),
          title: Text(
            (item['serviceType'] ??
                    'TRANSACTION')
                .toString()
                .replaceAll(
                  '_',
                  ' ',
                ),
            style: const TextStyle(
              fontWeight: FontWeight.w800,
            ),
          ),
          subtitle: Text(
            item['reference']?.toString() ??
                'No reference',
          ),
          trailing: Column(
            mainAxisAlignment:
                MainAxisAlignment.center,
            crossAxisAlignment:
                CrossAxisAlignment.end,
            children: <Widget>[
              Text(
                formatMoney(
                  item['amount'],
                ),
                style: const TextStyle(
                  fontWeight:
                      FontWeight.w900,
                ),
              ),
              Text(
                status,
                style: TextStyle(
                  color:
                      statusColor(status),
                  fontSize: 10,
                  fontWeight:
                      FontWeight.w800,
                ),
              ),
            ],
          ),
        );
      },
    );
  }

  Future<void> showAuditLogs(
    Map<String, dynamic> user,
  ) async {
    final String userId =
        user['_id']?.toString() ??
            user['id']?.toString() ??
            '';

    await showServerListDialog(
      title:
          '${user['fullName'] ?? 'Customer'} Audit Logs',
      endpoint:
          '/admin/users/$userId/audit-logs?limit=100',
      possibleKeys: const <String>[
        'logs',
        'records',
        'items',
      ],
      itemBuilder: (
        Map<String, dynamic> item,
      ) {
        return ListTile(
          leading: CircleAvatar(
            backgroundColor:
                const Color(0xFFFFF7ED),
            child: const Icon(
              Icons.history_rounded,
              color: Colors.orange,
            ),
          ),
          title: Text(
            (item['action'] ?? 'ACTION')
                .toString()
                .replaceAll(
                  '_',
                  ' ',
                ),
            style: const TextStyle(
              fontWeight: FontWeight.w800,
            ),
          ),
          subtitle: Text(
            '${item['reason'] ?? 'No reason'}\n'
            'By: ${item['actorName'] ?? 'Admin'}',
          ),
          isThreeLine: true,
          trailing: Text(
            formatDate(
              item['createdAt'],
            ),
            style: const TextStyle(
              fontSize: 10,
            ),
          ),
        );
      },
    );
  }

  Future<void> showServerListDialog({
    required String title,
    required String endpoint,
    required List<String> possibleKeys,
    required Widget Function(
      Map<String, dynamic> item,
    ) itemBuilder,
  }) async {
    showDialog<void>(
      context: context,
      barrierDismissible: false,
      builder: (
        BuildContext context,
      ) {
        return const Center(
          child: CircularProgressIndicator(),
        );
      },
    );

    List<Map<String, dynamic>> records =
        <Map<String, dynamic>>[];

    String? listError;

    try {
      final String? token = await getToken();

      if (token == null) {
        throw Exception(
          'Admin authentication token was not found.',
        );
      }

      final http.Response response =
          await http
              .get(
                Uri.parse(
                  '$baseUrl$endpoint',
                ),
                headers: <String, String>{
                  'Accept':
                      'application/json',
                  'Authorization':
                      'Bearer $token',
                },
              )
              .timeout(
                const Duration(
                  seconds: 45,
                ),
              );

      final Map<String, dynamic> body =
          decodeResponse(response);

      final bool successful =
          response.statusCode >= 200 &&
          response.statusCode < 300 &&
          body['success'] == true;

      if (!successful) {
        throw Exception(
          responseMessage(
            body,
            fallback:
                'Unable to load records.',
          ),
        );
      }

      records = extractList(
        body,
        possibleKeys,
      );
    } catch (error) {
      listError = error
          .toString()
          .replaceFirst(
            'Exception: ',
            '',
          );
    }

    if (mounted &&
        Navigator.canPop(context)) {
      Navigator.pop(context);
    }

    if (!mounted) {
      return;
    }

    await showDialog<void>(
      context: context,
      builder: (
        BuildContext dialogContext,
      ) {
        return AlertDialog(
          title: Text(title),
          content: SizedBox(
            width: 620,
            height: 500,
            child: listError != null
                ? Center(
                    child: Text(
                      listError!,
                      textAlign:
                          TextAlign.center,
                    ),
                  )
                : records.isEmpty
                    ? const Center(
                        child: Text(
                          'No records found.',
                        ),
                      )
                    : ListView.separated(
                        itemCount:
                            records.length,
                        separatorBuilder:
                            (
                          BuildContext context,
                          int index,
                        ) =>
                                const Divider(),
                        itemBuilder:
                            (
                          BuildContext context,
                          int index,
                        ) {
                          return itemBuilder(
                            records[index],
                          );
                        },
                      ),
          ),
          actions: <Widget>[
            FilledButton(
              onPressed: () {
                Navigator.pop(
                  dialogContext,
                );
              },
              style:
                  FilledButton.styleFrom(
                backgroundColor:
                    primaryGreen,
              ),
              child:
                  const Text('Close'),
            ),
          ],
        );
      },
    );
  }

  String formatMoney(
    dynamic value,
  ) {
    final double amount = value is num
        ? value.toDouble()
        : double.tryParse(
              value?.toString() ?? '',
            ) ??
            0;

    final String rounded =
        amount.toStringAsFixed(2);

    final List<String> parts =
        rounded.split('.');

    final String whole =
        parts.first.replaceAllMapped(
      RegExp(
        r'\B(?=(\d{3})+(?!\d))',
      ),
      (Match match) => ',',
    );

    return '₦$whole.${parts.last}';
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

    final DateTime local =
        date.toLocal();

    return '${local.day.toString().padLeft(2, '0')}/'
        '${local.month.toString().padLeft(2, '0')}/'
        '${local.year}';
  }

  String displayRole(
    String role,
  ) {
    if (role == 'AGENT') {
      return 'AGGREGATOR';
    }

    return role.replaceAll(
      '_',
      ' ',
    );
  }

  Color statusColor(
    String status,
  ) {
    switch (status.toUpperCase()) {
      case 'ACTIVE':
      case 'SUCCESS':
      case 'SUCCESSFUL':
      case 'COMPLETED':
        return Colors.green;

      case 'SUSPENDED':
      case 'PENDING':
      case 'PROCESSING':
        return Colors.orange;

      case 'BLOCKED':
      case 'FAILED':
      case 'CANCELLED':
        return Colors.red;

      case 'REFUNDED':
      case 'REVERSED':
        return Colors.blue;

      default:
        return Colors.grey;
    }
  }

  IconData roleIcon(
    String role,
  ) {
    switch (role) {
      case 'HEAD_OFFICE':
        return Icons
            .admin_panel_settings;
      case 'ZONAL_MANAGER':
        return Icons.public;
      case 'STATE_MANAGER':
        return Icons.location_city;
      case 'AGENT':
        return Icons.support_agent;
      default:
        return Icons.person;
    }
  }

  void showMessage(
    String message, {
    required bool isError,
  }) {
    if (!mounted) {
      return;
    }

    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(
        SnackBar(
          content: Text(message),
          behavior:
              SnackBarBehavior.floating,
          backgroundColor: isError
              ? Colors.red
              : primaryGreen,
        ),
      );
  }

  Widget buildFilterDropdown({
    required String value,
    required List<String> items,
    required ValueChanged<String?>
        onChanged,
  }) {
    return Expanded(
      child:
          DropdownButtonFormField<String>(
        initialValue: value,
        isExpanded: true,
        decoration: InputDecoration(
          filled: true,
          fillColor: Colors.white,
          contentPadding:
              const EdgeInsets.symmetric(
            horizontal: 12,
            vertical: 12,
          ),
          border: OutlineInputBorder(
            borderRadius:
                BorderRadius.circular(14),
            borderSide: BorderSide.none,
          ),
        ),
        items: items.map(
          (String item) {
            return DropdownMenuItem<String>(
              value: item,
              child: Text(
                displayRole(item),
                overflow:
                    TextOverflow.ellipsis,
              ),
            );
          },
        ).toList(),
        onChanged: onChanged,
      ),
    );
  }

  Widget smallBadge(
    String label,
    Color color,
  ) {
    return Container(
      padding:
          const EdgeInsets.symmetric(
        horizontal: 9,
        vertical: 5,
      ),
      decoration: BoxDecoration(
        color: color.withValues(
          alpha: 0.12,
        ),
        borderRadius:
            BorderRadius.circular(20),
      ),
      child: Text(
        label,
        style: TextStyle(
          color: color,
          fontSize: 11,
          fontWeight: FontWeight.w700,
        ),
      ),
    );
  }

  Widget buildErrorState() {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(28),
        child: Column(
          mainAxisAlignment:
              MainAxisAlignment.center,
          children: <Widget>[
            const Icon(
              Icons.cloud_off,
              size: 70,
              color: Colors.redAccent,
            ),
            const SizedBox(height: 18),
            const Text(
              'Unable to load users',
              style: TextStyle(
                fontSize: 22,
                fontWeight:
                    FontWeight.bold,
              ),
            ),
            const SizedBox(height: 10),
            Text(
              errorMessage ??
                  'Something went wrong.',
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 20),
            FilledButton.icon(
              onPressed: loadUsers,
              icon: const Icon(
                Icons.refresh,
              ),
              label:
                  const Text('Try Again'),
            ),
          ],
        ),
      ),
    );
  }

  Widget buildEmptyState() {
    return const Center(
      child: Padding(
        padding: EdgeInsets.all(28),
        child: Column(
          mainAxisAlignment:
              MainAxisAlignment.center,
          children: <Widget>[
            Icon(
              Icons.people_outline,
              size: 72,
              color: Colors.grey,
            ),
            SizedBox(height: 18),
            Text(
              'No users found',
              style: TextStyle(
                fontSize: 22,
                fontWeight:
                    FontWeight.bold,
              ),
            ),
            SizedBox(height: 8),
            Text(
              'Try changing the search or filters.',
            ),
          ],
        ),
      ),
    );
  }

  Future<void> openCreateUserDialog() async {
    final bool? created =
        await showCreateAdminUserDialog(
      context,
      users,
    );

    if (created == true) {
      await loadUsers();
    }
  }

  @override
  Widget build(
    BuildContext context,
  ) {
    return Scaffold(
      backgroundColor:
          const Color(0xFFF5F7F5),
      appBar: AppBar(
        title: const Text(
          'Manage Users',
          style: TextStyle(
            fontWeight: FontWeight.bold,
          ),
        ),
        backgroundColor:
            primaryGreen,
        foregroundColor: Colors.white,
        actions: <Widget>[
          IconButton(
            tooltip:
                'Create Managed Account',
            onPressed:
                openCreateUserDialog,
            icon: const Icon(
              Icons.person_add_alt_1,
            ),
          ),
          IconButton(
            tooltip: 'Refresh',
            onPressed:
                isLoading ? null : loadUsers,
            icon:
                const Icon(Icons.refresh),
          ),
        ],
      ),
      floatingActionButton:
          FloatingActionButton.extended(
        onPressed: openCreateUserDialog,
        backgroundColor: primaryGreen,
        foregroundColor: Colors.white,
        icon: const Icon(
          Icons.person_add_alt_1,
        ),
        label:
            const Text('Create Account'),
      ),
      body: Column(
        children: <Widget>[
          Container(
            padding:
                const EdgeInsets.fromLTRB(
              16,
              16,
              16,
              14,
            ),
            color: primaryGreen,
            child: Column(
              children: <Widget>[
                TextField(
                  controller:
                      searchController,
                  textInputAction:
                      TextInputAction.search,
                  onSubmitted: (
                    String value,
                  ) {
                    loadUsers();
                  },
                  onChanged: (
                    String value,
                  ) {
                    setState(() {});
                  },
                  decoration:
                      InputDecoration(
                    hintText:
                        'Search name, phone or email',
                    prefixIcon:
                        const Icon(
                      Icons.search,
                    ),
                    suffixIcon:
                        searchController
                                .text
                                .isEmpty
                            ? null
                            : IconButton(
                                onPressed:
                                    () {
                                  searchController
                                      .clear();
                                  loadUsers();
                                },
                                icon:
                                    const Icon(
                                  Icons.close,
                                ),
                              ),
                    filled: true,
                    fillColor: Colors.white,
                    border:
                        OutlineInputBorder(
                      borderRadius:
                          BorderRadius
                              .circular(
                        16,
                      ),
                      borderSide:
                          BorderSide.none,
                    ),
                  ),
                ),
                const SizedBox(height: 12),
                Row(
                  children: <Widget>[
                    buildFilterDropdown(
                      value: selectedRole,
                      items: const <String>[
                        'ALL',
                        'HEAD_OFFICE',
                        'ZONAL_MANAGER',
                        'STATE_MANAGER',
                        'AGENT',
                        'CUSTOMER',
                      ],
                      onChanged: (
                        String? value,
                      ) {
                        if (value == null) {
                          return;
                        }

                        setState(() {
                          selectedRole = value;
                        });

                        loadUsers();
                      },
                    ),
                    const SizedBox(width: 10),
                    buildFilterDropdown(
                      value:
                          selectedStatus,
                      items: const <String>[
                        'ALL',
                        'ACTIVE',
                        'SUSPENDED',
                        'BLOCKED',
                      ],
                      onChanged: (
                        String? value,
                      ) {
                        if (value == null) {
                          return;
                        }

                        setState(() {
                          selectedStatus =
                              value;
                        });

                        loadUsers();
                      },
                    ),
                  ],
                ),
              ],
            ),
          ),
          Expanded(
            child: isLoading
                ? const Center(
                    child:
                        CircularProgressIndicator(),
                  )
                : errorMessage != null
                    ? buildErrorState()
                    : users.isEmpty
                        ? buildEmptyState()
                        : RefreshIndicator(
                            onRefresh:
                                loadUsers,
                            child:
                                ListView.separated(
                              physics:
                                  const AlwaysScrollableScrollPhysics(),
                              padding:
                                  const EdgeInsets.all(
                                16,
                              ),
                              itemCount:
                                  users.length,
                              separatorBuilder:
                                  (
                                BuildContext
                                    context,
                                int index,
                              ) =>
                                      const SizedBox(
                                height: 12,
                              ),
                              itemBuilder:
                                  (
                                BuildContext
                                    context,
                                int index,
                              ) {
                                final Map<String,
                                        dynamic>
                                    user =
                                    users[index];

                                final String role =
                                    normalizeRole(
                                  user['role']
                                      ?.toString(),
                                );

                                final String status =
                                    normalizeRole(
                                  user['status']
                                      ?.toString(),
                                );

                                final String name =
                                    user['fullName']
                                            ?.toString() ??
                                        'Unknown User';

                                return Material(
                                  color:
                                      Colors.white,
                                  borderRadius:
                                      BorderRadius
                                          .circular(
                                    18,
                                  ),
                                  child: InkWell(
                                    borderRadius:
                                        BorderRadius
                                            .circular(
                                      18,
                                    ),
                                    onTap: () {
                                      openUserDetails(
                                        user,
                                      );
                                    },
                                    child: Padding(
                                      padding:
                                          const EdgeInsets
                                              .all(
                                        14,
                                      ),
                                      child: Row(
                                        children:
                                            <Widget>[
                                          CircleAvatar(
                                            radius: 25,
                                            backgroundColor:
                                                primaryGreen
                                                    .withValues(
                                              alpha:
                                                  0.12,
                                            ),
                                            child: Icon(
                                              roleIcon(
                                                role,
                                              ),
                                              color:
                                                  primaryGreen,
                                            ),
                                          ),
                                          const SizedBox(
                                            width: 13,
                                          ),
                                          Expanded(
                                            child:
                                                Column(
                                              crossAxisAlignment:
                                                  CrossAxisAlignment
                                                      .start,
                                              children:
                                                  <Widget>[
                                                Text(
                                                  name,
                                                  maxLines:
                                                      1,
                                                  overflow:
                                                      TextOverflow
                                                          .ellipsis,
                                                  style:
                                                      const TextStyle(
                                                    fontSize:
                                                        16,
                                                    fontWeight:
                                                        FontWeight.bold,
                                                  ),
                                                ),
                                                const SizedBox(
                                                  height:
                                                      4,
                                                ),
                                                Text(
                                                  user['phone']
                                                          ?.toString() ??
                                                      user['email']
                                                          ?.toString() ??
                                                      'No contact information',
                                                  maxLines:
                                                      1,
                                                  overflow:
                                                      TextOverflow
                                                          .ellipsis,
                                                ),
                                                const SizedBox(
                                                  height:
                                                      7,
                                                ),
                                                Wrap(
                                                  spacing:
                                                      8,
                                                  runSpacing:
                                                      6,
                                                  children:
                                                      <Widget>[
                                                    smallBadge(
                                                      displayRole(
                                                        role,
                                                      ),
                                                      Colors.blueGrey,
                                                    ),
                                                    smallBadge(
                                                      status,
                                                      statusColor(
                                                        status,
                                                      ),
                                                    ),
                                                  ],
                                                ),
                                              ],
                                            ),
                                          ),
                                          const Icon(
                                            Icons
                                                .chevron_right,
                                            color:
                                                Colors.grey,
                                          ),
                                        ],
                                      ),
                                    ),
                                  ),
                                );
                              },
                            ),
                          ),
          ),
          if (isUpdating)
            const LinearProgressIndicator(
              minHeight: 3,
            ),
        ],
      ),
    );
  }
}
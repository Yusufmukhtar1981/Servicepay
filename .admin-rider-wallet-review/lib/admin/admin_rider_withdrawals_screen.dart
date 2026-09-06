import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

bool riderWithdrawalCanBeReversed(String status) {
  return const <String>{'PENDING', 'APPROVED', 'PROCESSING'}
      .contains(status.trim().toUpperCase());
}

class AdminRiderWithdrawalsScreen extends StatefulWidget {
  const AdminRiderWithdrawalsScreen({
    super.key,
  });

  @override
  State<AdminRiderWithdrawalsScreen> createState() =>
      _AdminRiderWithdrawalsScreenState();
}

class _AdminRiderWithdrawalsScreenState
    extends State<AdminRiderWithdrawalsScreen> {
  static const String baseUrl = 'https://api.servicepay.ng/api';

  static const Color primaryColor = Color(0xFF0F766E);

  final TextEditingController searchController = TextEditingController();

  List<Map<String, dynamic>> withdrawals = <Map<String, dynamic>>[];

  Map<String, dynamic> summary = <String, dynamic>{};

  bool isLoading = true;
  bool isRefreshing = false;
  bool isProcessingAction = false;
  bool isLoadingWithdrawalControl = true;
  bool isSavingWithdrawalControl = false;
  Map<String, dynamic> withdrawalControl = <String, dynamic>{};

  String selectedStatus = 'ALL';
  String errorMessage = '';

  final List<String> statuses = const [
    'ALL',
    'PENDING',
    'APPROVED',
    'PROCESSING',
    'PAID',
    'REJECTED',
    'FAILED',
    'CANCELLED',
    'REVERSED',
  ];

  @override
  void initState() {
    super.initState();
    loadWithdrawals();
    loadWithdrawalControl();
  }

  @override
  void dispose() {
    searchController.dispose();
    super.dispose();
  }

  Map<String, dynamic> mapFromDynamic(
    dynamic value,
  ) {
    if (value is Map) {
      return Map<String, dynamic>.from(
        value,
      );
    }

    return <String, dynamic>{};
  }

  List<Map<String, dynamic>> listFromDynamic(
    dynamic value,
  ) {
    if (value is! List) {
      return <Map<String, dynamic>>[];
    }

    return value
        .whereType<Map>()
        .map(
          (Map item) => Map<String, dynamic>.from(
            item,
          ),
        )
        .toList();
  }

  String text(
    dynamic value, {
    String fallback = '',
  }) {
    final String result = value?.toString().trim() ?? '';

    return result.isEmpty ? fallback : result;
  }

  double number(
    dynamic value,
  ) {
    return double.tryParse(
          value?.toString() ?? '0',
        ) ??
        0;
  }

  Map<String, dynamic> decodeResponse(
    http.Response response,
  ) {
    final String body = response.body.trim();

    if (body.isEmpty) {
      return <String, dynamic>{};
    }

    final dynamic decoded = jsonDecode(body);

    return mapFromDynamic(decoded);
  }

  Future<String> getToken() async {
    final SharedPreferences prefs = await SharedPreferences.getInstance();

    const List<String> tokenKeys = [
      'auth_token',
      'token',
      'access_token',
      'accessToken',
      'jwt_token',
      'jwt',
    ];

    for (final String key in tokenKeys) {
      String token = prefs.getString(key)?.trim() ?? '';

      if (token.toLowerCase().startsWith(
            'bearer ',
          )) {
        token = token.substring(7).trim();
      }

      if (token.isNotEmpty) {
        return token;
      }
    }

    return '';
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
          backgroundColor: isError ? Colors.red.shade700 : primaryColor,
        ),
      );
  }

  Future<void> loadWithdrawals({
    bool refresh = false,
  }) async {
    if (mounted) {
      setState(() {
        if (refresh) {
          isRefreshing = true;
        } else {
          isLoading = true;
        }

        errorMessage = '';
      });
    }

    try {
      final String token = await getToken();

      if (token.isEmpty) {
        throw Exception(
          'Admin login token was not found.',
        );
      }

      final Map<String, String> queryParameters = <String, String>{
        'limit': '100',
      };

      if (selectedStatus != 'ALL') {
        queryParameters['status'] = selectedStatus;
      }

      final String search = searchController.text.trim();

      if (search.isNotEmpty) {
        queryParameters['search'] = search;
      }

      final Uri endpoint = Uri.parse(
        '$baseUrl/rider/admin/withdrawals',
      ).replace(
        queryParameters: queryParameters,
      );

      final http.Response response = await http.get(
        endpoint,
        headers: {
          'Accept': 'application/json',
          'Authorization': 'Bearer $token',
        },
      ).timeout(
        const Duration(
          seconds: 40,
        ),
      );

      final Map<String, dynamic> root = decodeResponse(response);

      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw Exception(
          text(
            root['message'],
            fallback: 'Unable to load Rider withdrawals.',
          ),
        );
      }

      final Map<String, dynamic> data = mapFromDynamic(
        root['data'],
      );

      final List<Map<String, dynamic>> loadedWithdrawals = listFromDynamic(
        data['withdrawals'] ?? root['withdrawals'],
      );

      final Map<String, dynamic> loadedSummary = mapFromDynamic(
        data['summary'],
      );

      if (!mounted) {
        return;
      }

      setState(() {
        withdrawals = loadedWithdrawals;

        summary = loadedSummary;

        isLoading = false;
        isRefreshing = false;
      });
    } on TimeoutException {
      if (!mounted) {
        return;
      }

      setState(() {
        isLoading = false;
        isRefreshing = false;
        errorMessage = 'The server took too long to respond.';
      });
    } on FormatException {
      if (!mounted) {
        return;
      }

      setState(() {
        isLoading = false;
        isRefreshing = false;
        errorMessage = 'The server returned an invalid response.';
      });
    } catch (error) {
      if (!mounted) {
        return;
      }

      setState(() {
        isLoading = false;
        isRefreshing = false;
        errorMessage = error.toString().replaceFirst(
              'Exception: ',
              '',
            );
      });
    }
  }

  bool get withdrawalEnabled {
    final dynamic value = withdrawalControl['enabled'];
    return value == true || value?.toString().toLowerCase() == 'true';
  }

  Future<void> loadWithdrawalControl() async {
    if (mounted) setState(() => isLoadingWithdrawalControl = true);
    try {
      final String token = await getToken();
      if (token.isEmpty) throw Exception('Admin login token was not found.');
      final http.Response response = await http.get(
        Uri.parse('$baseUrl/admin/rider-withdrawal-control'),
        headers: <String, String>{
          'Accept': 'application/json',
          'Authorization': 'Bearer $token',
        },
      ).timeout(const Duration(seconds: 30));
      final Map<String, dynamic> root = decodeResponse(response);
      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw Exception(
          text(root['message'],
              fallback: 'Unable to load Rider withdrawal control.'),
        );
      }
      if (!mounted) return;
      final Map<String, dynamic> data = mapFromDynamic(root['data']);
      setState(() => withdrawalControl = data.isEmpty ? root : data);
    } catch (error) {
      showMessage(error.toString().replaceFirst('Exception: ', ''));
    } finally {
      if (mounted) setState(() => isLoadingWithdrawalControl = false);
    }
  }

  Future<void> updateWithdrawalControl(bool enabled) async {
    if (isSavingWithdrawalControl) return;
    final bool confirmed = await confirmAction(
      title: enabled ? 'Enable Rider Withdrawals' : 'Disable Rider Withdrawals',
      message: enabled
          ? 'Allow riders to submit new withdrawal requests?'
          : 'Prevent new requests? Existing withdrawal records are unchanged.',
      color: enabled ? Colors.green : Colors.red,
    );
    if (!confirmed) return;
    setState(() => isSavingWithdrawalControl = true);
    try {
      final String token = await getToken();
      if (token.isEmpty) throw Exception('Admin login token was not found.');
      final http.Response response = await http
          .patch(
            Uri.parse('$baseUrl/admin/rider-withdrawal-control'),
            headers: <String, String>{
              'Accept': 'application/json',
              'Content-Type': 'application/json',
              'Authorization': 'Bearer $token',
            },
            body: jsonEncode(<String, dynamic>{'enabled': enabled}),
          )
          .timeout(const Duration(seconds: 30));
      final Map<String, dynamic> root = decodeResponse(response);
      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw Exception(
          text(root['message'],
              fallback: 'Unable to update Rider withdrawal control.'),
        );
      }
      if (!mounted) return;
      final Map<String, dynamic> data = mapFromDynamic(root['data']);
      setState(() => withdrawalControl = data.isEmpty ? root : data);
      showMessage(
        enabled ? 'Rider withdrawals enabled.' : 'Rider withdrawals disabled.',
        isError: false,
      );
    } catch (error) {
      showMessage(error.toString().replaceFirst('Exception: ', ''));
    } finally {
      if (mounted) setState(() => isSavingWithdrawalControl = false);
    }
  }

  String formatMoney(
    dynamic value,
  ) {
    return '₦${number(value).toStringAsFixed(2)}';
  }

  String formatStatus(
    String status,
  ) {
    return status
        .replaceAll('_', ' ')
        .split(' ')
        .map(
          (String word) => word.isEmpty
              ? word
              : '${word[0].toUpperCase()}'
                  '${word.substring(1).toLowerCase()}',
        )
        .join(' ');
  }

  String formatDate(
    dynamic value,
  ) {
    final DateTime? parsed = DateTime.tryParse(
      value?.toString() ?? '',
    );

    if (parsed == null) {
      return 'Not available';
    }

    final DateTime local = parsed.toLocal();

    return '${local.day.toString().padLeft(2, '0')}/'
        '${local.month.toString().padLeft(2, '0')}/'
        '${local.year} '
        '${local.hour.toString().padLeft(2, '0')}:'
        '${local.minute.toString().padLeft(2, '0')}';
  }

  Widget buildWithdrawalControlCard() {
    final String actor = text(
      withdrawalControl['updatedByName'] ?? withdrawalControl['updatedBy'],
      fallback: 'Not available',
    );
    final dynamic changedAt = withdrawalControl['updatedAt'];
    return Container(
      key: const Key('rider-withdrawal-control'),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: const Color(0xFFE2E8F0)),
      ),
      child: Row(
        children: <Widget>[
          Icon(
            Icons.payments_outlined,
            color: withdrawalEnabled ? Colors.green : Colors.red,
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                const Text(
                  'Rider Withdrawal',
                  style: TextStyle(fontWeight: FontWeight.bold),
                ),
                Text(
                  isLoadingWithdrawalControl
                      ? 'Loading current control…'
                      : withdrawalEnabled
                          ? 'ENABLED'
                          : 'DISABLED',
                  style: TextStyle(
                    color: withdrawalEnabled ? Colors.green : Colors.red,
                    fontWeight: FontWeight.bold,
                    fontSize: 12,
                  ),
                ),
                if (!isLoadingWithdrawalControl)
                  Text(
                    'Last changed by $actor • ${formatDate(changedAt)}',
                    style: const TextStyle(
                      color: Colors.black54,
                      fontSize: 11,
                    ),
                  ),
              ],
            ),
          ),
          Switch(
            key: const Key('rider-withdrawal-toggle'),
            value: withdrawalEnabled,
            onChanged: isLoadingWithdrawalControl || isSavingWithdrawalControl
                ? null
                : updateWithdrawalControl,
          ),
        ],
      ),
    );
  }

  Color statusColor(
    String status,
  ) {
    switch (status.toUpperCase()) {
      case 'PAID':
        return Colors.green;

      case 'APPROVED':
        return Colors.blue;

      case 'PROCESSING':
        return Colors.deepPurple;

      case 'REJECTED':
      case 'FAILED':
      case 'CANCELLED':
      case 'REVERSED':
        return Colors.red;

      default:
        return Colors.orange;
    }
  }

  Map<String, dynamic> riderData(
    Map<String, dynamic> withdrawal,
  ) {
    return mapFromDynamic(
      withdrawal['riderId'],
    );
  }

  String riderName(
    Map<String, dynamic> withdrawal,
  ) {
    final Map<String, dynamic> rider = riderData(withdrawal);

    return text(
      rider['fullName'],
      fallback: 'Delivery Rider',
    );
  }

  String riderCode(
    Map<String, dynamic> withdrawal,
  ) {
    final Map<String, dynamic> rider = riderData(withdrawal);

    return text(
      rider['riderId'],
      fallback: 'No Rider ID',
    );
  }

  String riderPhone(
    Map<String, dynamic> withdrawal,
  ) {
    final Map<String, dynamic> rider = riderData(withdrawal);

    return text(
      rider['phone'],
      fallback: 'Not available',
    );
  }

  Map<String, dynamic> statusSummary(
    String status,
  ) {
    return mapFromDynamic(
      summary[status],
    );
  }

  Widget buildSummaryCard({
    required String title,
    required String status,
    required IconData icon,
  }) {
    final Map<String, dynamic> data = statusSummary(status);

    return Container(
      width: 165,
      padding: const EdgeInsets.all(15),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(17),
        border: Border.all(
          color: const Color(0xFFE2E8F0),
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(
            icon,
            color: statusColor(status),
          ),
          const SizedBox(height: 10),
          Text(
            title,
            style: const TextStyle(
              color: Colors.black54,
              fontSize: 12,
            ),
          ),
          const SizedBox(height: 5),
          Text(
            '${data['count'] ?? 0}',
            style: const TextStyle(
              fontSize: 21,
              fontWeight: FontWeight.bold,
            ),
          ),
          const SizedBox(height: 3),
          FittedBox(
            fit: BoxFit.scaleDown,
            alignment: Alignment.centerLeft,
            child: Text(
              formatMoney(
                data['amount'],
              ),
              style: TextStyle(
                color: statusColor(status),
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
        ],
      ),
    );
  }

  Future<String?> requestReason({
    required String title,
    required String hint,
  }) async {
    final TextEditingController controller = TextEditingController();

    final String? result = await showDialog<String>(
      context: context,
      builder: (
        BuildContext dialogContext,
      ) {
        return AlertDialog(
          title: Text(title),
          content: TextField(
            controller: controller,
            maxLines: 4,
            decoration: InputDecoration(
              labelText: 'Reason',
              hintText: hint,
              border: const OutlineInputBorder(),
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
              onPressed: () {
                Navigator.pop(
                  dialogContext,
                  controller.text.trim(),
                );
              },
              style: FilledButton.styleFrom(
                backgroundColor: primaryColor,
              ),
              child: const Text(
                'Continue',
              ),
            ),
          ],
        );
      },
    );

    controller.dispose();

    return result;
  }

  Future<Map<String, String>?> requestPaymentDetails() async {
    final TextEditingController referenceController = TextEditingController();

    final TextEditingController noteController = TextEditingController();

    final Map<String, String>? result = await showDialog<Map<String, String>>(
      context: context,
      builder: (
        BuildContext dialogContext,
      ) {
        return AlertDialog(
          title: const Text(
            'Payment Details',
          ),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                TextField(
                  controller: referenceController,
                  decoration: const InputDecoration(
                    labelText: 'Payment reference',
                    hintText: 'Bank or provider reference',
                    border: OutlineInputBorder(),
                  ),
                ),
                const SizedBox(
                  height: 14,
                ),
                TextField(
                  controller: noteController,
                  maxLines: 3,
                  decoration: const InputDecoration(
                    labelText: 'Admin note',
                    border: OutlineInputBorder(),
                  ),
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
              onPressed: () {
                Navigator.pop(
                  dialogContext,
                  <String, String>{
                    'reference': referenceController.text.trim(),
                    'note': noteController.text.trim(),
                  },
                );
              },
              style: FilledButton.styleFrom(
                backgroundColor: primaryColor,
              ),
              child: const Text(
                'Continue',
              ),
            ),
          ],
        );
      },
    );

    referenceController.dispose();
    noteController.dispose();

    return result;
  }

  Future<bool> confirmAction({
    required String title,
    required String message,
    Color color = primaryColor,
  }) async {
    return await showDialog<bool>(
          context: context,
          builder: (
            BuildContext dialogContext,
          ) {
            return AlertDialog(
              title: Text(title),
              content: Text(message),
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
                FilledButton(
                  onPressed: () {
                    Navigator.pop(
                      dialogContext,
                      true,
                    );
                  },
                  style: FilledButton.styleFrom(
                    backgroundColor: color,
                  ),
                  child: const Text(
                    'Confirm',
                  ),
                ),
              ],
            );
          },
        ) ??
        false;
  }

  Future<void> performAction({
    required Map<String, dynamic> withdrawal,
    required String action,
    Map<String, dynamic>? payload,
  }) async {
    if (isProcessingAction) {
      return;
    }

    final String withdrawalId = text(
      withdrawal['_id'] ?? withdrawal['id'],
    );

    if (withdrawalId.isEmpty) {
      showMessage(
        'Invalid withdrawal ID.',
      );
      return;
    }

    setState(() {
      isProcessingAction = true;
    });

    try {
      final String token = await getToken();

      if (token.isEmpty) {
        throw Exception(
          'Admin login token was not found.',
        );
      }

      final http.Response response = await http
          .patch(
            Uri.parse(
              '$baseUrl/rider/admin/withdrawals/'
              '$withdrawalId/$action',
            ),
            headers: {
              'Accept': 'application/json',
              'Content-Type': 'application/json',
              'Authorization': 'Bearer $token',
            },
            body: jsonEncode(
              payload ?? <String, dynamic>{},
            ),
          )
          .timeout(
            const Duration(
              seconds: 45,
            ),
          );

      final Map<String, dynamic> root = decodeResponse(response);

      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw Exception(
          text(
            root['message'],
            fallback: 'Unable to update withdrawal.',
          ),
        );
      }

      showMessage(
        text(
          root['message'],
          fallback: 'Withdrawal updated successfully.',
        ),
        isError: false,
      );

      await loadWithdrawals(
        refresh: true,
      );
    } on TimeoutException {
      showMessage(
        'The server took too long to respond.',
      );
    } on FormatException {
      showMessage(
        'The server returned an invalid response.',
      );
    } catch (error) {
      showMessage(
        error.toString().replaceFirst(
              'Exception: ',
              '',
            ),
      );
    } finally {
      if (mounted) {
        setState(() {
          isProcessingAction = false;
        });
      }
    }
  }

  Future<void> approve(
    Map<String, dynamic> withdrawal,
  ) async {
    final bool confirmed = await confirmAction(
      title: 'Approve Withdrawal',
      message:
          'Approve ${formatMoney(withdrawal['amount'])} for ${riderName(withdrawal)}?',
    );

    if (!confirmed) {
      return;
    }

    await performAction(
      withdrawal: withdrawal,
      action: 'approve',
    );
  }

  Future<void> reject(
    Map<String, dynamic> withdrawal,
  ) async {
    final String? reason = await requestReason(
      title: 'Reject Withdrawal',
      hint: 'Explain why this withdrawal is rejected.',
    );

    if (reason == null || reason.length < 3) {
      return;
    }
    final bool confirmed = await confirmAction(
      title: 'Confirm Withdrawal Rejection',
      message:
          'Reject ${formatMoney(withdrawal['amount'])} for ${riderName(withdrawal)}? Reserved funds are restored only by the server accounting flow.',
      color: Colors.red,
    );
    if (!confirmed) return;

    await performAction(
      withdrawal: withdrawal,
      action: 'reject',
      payload: {
        'reason': reason,
      },
    );
  }

  Future<void> markProcessing(
    Map<String, dynamic> withdrawal,
  ) async {
    final Map<String, String>? details = await requestPaymentDetails();

    if (details == null) {
      return;
    }
    final bool confirmed = await confirmAction(
      title: 'Mark Withdrawal Processing',
      message:
          'Mark ${formatMoney(withdrawal['amount'])} for ${riderName(withdrawal)} as processing?',
    );
    if (!confirmed) return;

    await performAction(
      withdrawal: withdrawal,
      action: 'processing',
      payload: {
        'provider': 'MANUAL',
        'providerReference': details['reference'],
        'adminNote': details['note'],
      },
    );
  }

  Future<void> markPaid(
    Map<String, dynamic> withdrawal,
  ) async {
    final Map<String, String>? details = await requestPaymentDetails();

    if (details == null) {
      return;
    }

    final bool confirmed = await confirmAction(
      title: 'Confirm Rider Payment',
      message:
          'Confirm that ${formatMoney(withdrawal['amount'])} has been paid to ${riderName(withdrawal)}.',
      color: Colors.green,
    );

    if (!confirmed) {
      return;
    }

    await performAction(
      withdrawal: withdrawal,
      action: 'paid',
      payload: {
        'provider': 'MANUAL',
        'providerReference': details['reference'],
        'adminNote': details['note'],
      },
    );
  }

  Future<void> markFailed(
    Map<String, dynamic> withdrawal,
  ) async {
    final String? reason = await requestReason(
      title: 'Payment Failed',
      hint: 'Enter the payment failure reason.',
    );

    if (reason == null || reason.length < 3) {
      return;
    }
    final bool confirmed = await confirmAction(
      title: 'Confirm Payment Failure',
      message:
          'Mark this withdrawal as failed? Any locked-fund return is handled exactly once by the server.',
      color: Colors.red,
    );
    if (!confirmed) return;

    await performAction(
      withdrawal: withdrawal,
      action: 'failed',
      payload: {
        'reason': reason,
      },
    );
  }

  Future<void> reverse(
    Map<String, dynamic> withdrawal,
  ) async {
    final String? reason = await requestReason(
      title: 'Reverse Reserved Withdrawal',
      hint: 'Enter the verified reason for this reversal.',
    );
    if (reason == null || reason.length < 3) return;
    final bool confirmed = await confirmAction(
      title: 'Confirm Withdrawal Reversal',
      message:
          'Reverse ${formatMoney(withdrawal['amount'])} for ${riderName(withdrawal)}? This is allowed only while funds are locked.',
      color: Colors.red,
    );
    if (!confirmed) return;
    await performAction(
      withdrawal: withdrawal,
      action: 'reverse',
      payload: <String, dynamic>{'reason': reason},
    );
  }

  Widget buildActionButtons(
    Map<String, dynamic> withdrawal,
  ) {
    final String status = text(
      withdrawal['status'],
      fallback: 'PENDING',
    ).toUpperCase();

    final Widget reverseButton = OutlinedButton.icon(
      key: ValueKey<String>('reverse-withdrawal-$status'),
      onPressed: isProcessingAction ? null : () => reverse(withdrawal),
      style: OutlinedButton.styleFrom(
        foregroundColor: Colors.red,
        side: const BorderSide(color: Colors.red),
      ),
      icon: const Icon(Icons.undo_rounded),
      label: const Text('Reverse Reserved Withdrawal'),
    );

    if (status == 'PENDING') {
      return Column(
        children: <Widget>[
          Row(
            children: [
              Expanded(
                child: OutlinedButton.icon(
                  onPressed: isProcessingAction
                      ? null
                      : () {
                          reject(
                            withdrawal,
                          );
                        },
                  style: OutlinedButton.styleFrom(
                    foregroundColor: Colors.red,
                    side: const BorderSide(
                      color: Colors.red,
                    ),
                  ),
                  icon: const Icon(
                    Icons.close_rounded,
                  ),
                  label: const Text(
                    'Reject',
                  ),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: FilledButton.icon(
                  onPressed: isProcessingAction
                      ? null
                      : () {
                          approve(
                            withdrawal,
                          );
                        },
                  style: FilledButton.styleFrom(
                    backgroundColor: primaryColor,
                  ),
                  icon: const Icon(
                    Icons.check_rounded,
                  ),
                  label: const Text(
                    'Approve',
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          SizedBox(width: double.infinity, child: reverseButton),
        ],
      );
    }

    if (status == 'APPROVED') {
      return Column(
        children: <Widget>[
          Row(
            children: [
              Expanded(
                child: OutlinedButton.icon(
                  onPressed: isProcessingAction
                      ? null
                      : () {
                          reject(
                            withdrawal,
                          );
                        },
                  style: OutlinedButton.styleFrom(
                    foregroundColor: Colors.red,
                  ),
                  icon: const Icon(
                    Icons.close_rounded,
                  ),
                  label: const Text(
                    'Reject',
                  ),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: FilledButton.icon(
                  onPressed: isProcessingAction
                      ? null
                      : () {
                          markProcessing(
                            withdrawal,
                          );
                        },
                  style: FilledButton.styleFrom(
                    backgroundColor: Colors.deepPurple,
                  ),
                  icon: const Icon(
                    Icons.sync_rounded,
                  ),
                  label: const Text(
                    'Processing',
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          SizedBox(width: double.infinity, child: reverseButton),
        ],
      );
    }

    if (status == 'PROCESSING') {
      return Column(
        children: <Widget>[
          Row(
            children: [
              Expanded(
                child: OutlinedButton.icon(
                  onPressed: isProcessingAction
                      ? null
                      : () {
                          markFailed(
                            withdrawal,
                          );
                        },
                  style: OutlinedButton.styleFrom(
                    foregroundColor: Colors.red,
                  ),
                  icon: const Icon(
                    Icons.error_outline,
                  ),
                  label: const Text(
                    'Failed',
                  ),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: FilledButton.icon(
                  onPressed: isProcessingAction
                      ? null
                      : () {
                          markPaid(
                            withdrawal,
                          );
                        },
                  style: FilledButton.styleFrom(
                    backgroundColor: Colors.green,
                  ),
                  icon: const Icon(
                    Icons.check_circle_outline,
                  ),
                  label: const Text(
                    'Mark Paid',
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          SizedBox(width: double.infinity, child: reverseButton),
        ],
      );
    }

    return const SizedBox.shrink();
  }

  Widget buildWithdrawalCard(
    Map<String, dynamic> withdrawal,
  ) {
    final String status = text(
      withdrawal['status'],
      fallback: 'PENDING',
    ).toUpperCase();

    final String bankName = text(
      withdrawal['bankName'],
      fallback: 'Bank',
    );

    final String accountNumber = text(
      withdrawal['accountNumber'],
    );

    final String accountName = text(
      withdrawal['accountName'],
    );

    final String reference = text(
      withdrawal['reference'],
    );

    final String reason = text(
      withdrawal['rejectionReason'] ?? withdrawal['failureReason'],
    );

    return Card(
      margin: const EdgeInsets.only(
        bottom: 14,
      ),
      elevation: 0,
      color: Colors.white,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(18),
        side: const BorderSide(
          color: Color(0xFFE2E8F0),
        ),
      ),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                CircleAvatar(
                  backgroundColor: statusColor(status).withValues(
                    alpha: 0.12,
                  ),
                  child: Icon(
                    Icons.payments_outlined,
                    color: statusColor(status),
                  ),
                ),
                const SizedBox(
                  width: 11,
                ),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        formatMoney(
                          withdrawal['amount'],
                        ),
                        style: const TextStyle(
                          fontSize: 18,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                      Text(
                        riderName(
                          withdrawal,
                        ),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ],
                  ),
                ),
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 9,
                    vertical: 5,
                  ),
                  decoration: BoxDecoration(
                    color: statusColor(status).withValues(
                      alpha: 0.12,
                    ),
                    borderRadius: BorderRadius.circular(
                      20,
                    ),
                  ),
                  child: Text(
                    formatStatus(status),
                    style: TextStyle(
                      color: statusColor(status),
                      fontSize: 10,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(
              height: 14,
            ),
            _WithdrawalDetailRow(
              label: 'Rider ID',
              value: riderCode(withdrawal),
            ),
            _WithdrawalDetailRow(
              label: 'Phone',
              value: riderPhone(withdrawal),
            ),
            _WithdrawalDetailRow(
              label: 'Bank',
              value: bankName,
            ),
            _WithdrawalDetailRow(
              label: 'Account Number',
              value: accountNumber,
            ),
            _WithdrawalDetailRow(
              label: 'Account Name',
              value: accountName,
            ),
            _WithdrawalDetailRow(
              label: 'Requested',
              value: formatDate(
                withdrawal['requestedAt'] ?? withdrawal['createdAt'],
              ),
            ),
            _WithdrawalDetailRow(
              label: 'Available Balance',
              value: formatMoney(
                withdrawal['availableBalance'] ??
                    withdrawal['walletAvailableBalance'] ??
                    riderData(withdrawal)['availableBalance'],
              ),
            ),
            if (reference.isNotEmpty)
              _WithdrawalDetailRow(
                label: 'Reference',
                value: reference,
              ),
            if (reason.isNotEmpty) ...[
              const SizedBox(
                height: 8,
              ),
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(
                  11,
                ),
                decoration: BoxDecoration(
                  color: Colors.red.withValues(
                    alpha: 0.07,
                  ),
                  borderRadius: BorderRadius.circular(
                    11,
                  ),
                ),
                child: Text(
                  reason,
                  style: const TextStyle(
                    color: Colors.red,
                  ),
                ),
              ),
            ],
            if (riderWithdrawalCanBeReversed(status)) ...[
              const SizedBox(
                height: 15,
              ),
              buildActionButtons(
                withdrawal,
              ),
            ],
          ],
        ),
      ),
    );
  }

  @override
  Widget build(
    BuildContext context,
  ) {
    return Scaffold(
      backgroundColor: const Color(0xFFF5F7FA),
      body: SafeArea(
        child: isLoading
            ? const Center(
                child: CircularProgressIndicator(),
              )
            : RefreshIndicator(
                onRefresh: () {
                  return loadWithdrawals(
                    refresh: true,
                  );
                },
                child: ListView(
                  padding: const EdgeInsets.all(
                    16,
                  ),
                  children: [
                    Row(
                      children: [
                        const Expanded(
                          child: Text(
                            'Rider Withdrawals',
                            style: TextStyle(
                              fontSize: 23,
                              fontWeight: FontWeight.bold,
                            ),
                          ),
                        ),
                        IconButton(
                          tooltip: 'Refresh',
                          onPressed: isRefreshing
                              ? null
                              : () {
                                  loadWithdrawals(
                                    refresh: true,
                                  );
                                },
                          icon: isRefreshing
                              ? const SizedBox(
                                  width: 20,
                                  height: 20,
                                  child: CircularProgressIndicator(
                                    strokeWidth: 2,
                                  ),
                                )
                              : const Icon(
                                  Icons.refresh_rounded,
                                ),
                        ),
                      ],
                    ),
                    const SizedBox(
                      height: 15,
                    ),
                    buildWithdrawalControlCard(),
                    const SizedBox(
                      height: 15,
                    ),
                    SizedBox(
                      height: 142,
                      child: ListView(
                        scrollDirection: Axis.horizontal,
                        children: [
                          buildSummaryCard(
                            title: 'Pending',
                            status: 'PENDING',
                            icon: Icons.hourglass_top_rounded,
                          ),
                          const SizedBox(
                            width: 10,
                          ),
                          buildSummaryCard(
                            title: 'Processing',
                            status: 'PROCESSING',
                            icon: Icons.sync_rounded,
                          ),
                          const SizedBox(
                            width: 10,
                          ),
                          buildSummaryCard(
                            title: 'Paid',
                            status: 'PAID',
                            icon: Icons.check_circle_outline,
                          ),
                          const SizedBox(
                            width: 10,
                          ),
                          buildSummaryCard(
                            title: 'Rejected',
                            status: 'REJECTED',
                            icon: Icons.cancel_outlined,
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(
                      height: 18,
                    ),
                    TextField(
                      controller: searchController,
                      textInputAction: TextInputAction.search,
                      onSubmitted: (_) {
                        loadWithdrawals();
                      },
                      decoration: InputDecoration(
                        hintText: 'Search reference, account or bank',
                        prefixIcon: const Icon(
                          Icons.search_rounded,
                        ),
                        suffixIcon: IconButton(
                          onPressed: () {
                            searchController.clear();

                            loadWithdrawals();
                          },
                          icon: const Icon(
                            Icons.close_rounded,
                          ),
                        ),
                        filled: true,
                        fillColor: Colors.white,
                        border: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(
                            15,
                          ),
                        ),
                      ),
                    ),
                    const SizedBox(
                      height: 13,
                    ),
                    SizedBox(
                      height: 42,
                      child: ListView(
                        scrollDirection: Axis.horizontal,
                        children: statuses.map(
                          (
                            String status,
                          ) {
                            final bool selected = selectedStatus == status;

                            return Padding(
                              padding: const EdgeInsets.only(
                                right: 8,
                              ),
                              child: ChoiceChip(
                                selected: selected,
                                label: Text(
                                  formatStatus(
                                    status,
                                  ),
                                ),
                                selectedColor: primaryColor,
                                labelStyle: TextStyle(
                                  color:
                                      selected ? Colors.white : Colors.black54,
                                  fontWeight: FontWeight.w700,
                                ),
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
                    const SizedBox(
                      height: 16,
                    ),
                    if (errorMessage.isNotEmpty)
                      Container(
                        padding: const EdgeInsets.all(
                          16,
                        ),
                        decoration: BoxDecoration(
                          color: Colors.red.withValues(
                            alpha: 0.08,
                          ),
                          borderRadius: BorderRadius.circular(
                            14,
                          ),
                        ),
                        child: Column(
                          children: [
                            Text(
                              errorMessage,
                              textAlign: TextAlign.center,
                              style: const TextStyle(
                                color: Colors.red,
                              ),
                            ),
                            const SizedBox(
                              height: 10,
                            ),
                            FilledButton(
                              onPressed: loadWithdrawals,
                              child: const Text(
                                'Try Again',
                              ),
                            ),
                          ],
                        ),
                      )
                    else if (withdrawals.isEmpty)
                      Container(
                        padding: const EdgeInsets.all(
                          30,
                        ),
                        decoration: BoxDecoration(
                          color: Colors.white,
                          borderRadius: BorderRadius.circular(
                            18,
                          ),
                        ),
                        child: const Column(
                          children: [
                            Icon(
                              Icons.payments_outlined,
                              size: 50,
                              color: Colors.grey,
                            ),
                            SizedBox(
                              height: 10,
                            ),
                            Text(
                              'No Rider withdrawal request found.',
                              textAlign: TextAlign.center,
                              style: TextStyle(
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                          ],
                        ),
                      )
                    else
                      ...withdrawals.map(
                        buildWithdrawalCard,
                      ),
                    const SizedBox(
                      height: 40,
                    ),
                  ],
                ),
              ),
      ),
    );
  }
}

class _WithdrawalDetailRow extends StatelessWidget {
  const _WithdrawalDetailRow({
    required this.label,
    required this.value,
  });

  final String label;
  final String value;

  @override
  Widget build(
    BuildContext context,
  ) {
    return Padding(
      padding: const EdgeInsets.only(
        bottom: 7,
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 125,
            child: Text(
              label,
              style: const TextStyle(
                color: Colors.black54,
                fontSize: 12,
              ),
            ),
          ),
          const SizedBox(width: 8),
          Expanded(
            child: SelectableText(
              value.trim().isEmpty ? 'Not available' : value,
              textAlign: TextAlign.right,
              style: const TextStyle(
                fontWeight: FontWeight.w700,
                fontSize: 12,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

class AdminManualFundingScreen extends StatefulWidget {
  const AdminManualFundingScreen({super.key});

  @override
  State<AdminManualFundingScreen> createState() =>
      _AdminManualFundingScreenState();
}

class _AdminManualFundingScreenState extends State<AdminManualFundingScreen> {
  static const String baseUrl = 'https://api.servicepay.ng/api';

  bool isLoading = true;
  bool isRefreshing = false;
  bool isProcessing = false;

  String selectedStatus = 'PENDING';
  String processingRequestId = '';

  List<dynamic> allRequests = [];

  final List<String> statuses = [
    'PENDING',
    'APPROVED',
    'REJECTED',
    'ALL',
  ];

  @override
  void initState() {
    super.initState();
    _loadRequests();
  }

  Future<String?> _getToken() async {
    final SharedPreferences prefs = await SharedPreferences.getInstance();

    return prefs.getString('auth_token');
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

  Future<void> _loadRequests({
    bool refresh = false,
  }) async {
    if (!mounted) return;

    setState(() {
      if (refresh) {
        isRefreshing = true;
      } else {
        isLoading = true;
      }
    });

    try {
      final String? token = await _getToken();

      if (token == null || token.trim().isEmpty) {
        _showMessage(
          'Admin login token is unavailable. Please sign in again.',
          isError: true,
        );
        return;
      }

      final Uri uri = selectedStatus == 'ALL'
          ? Uri.parse(
              '$baseUrl/manual-funding/admin/requests',
            )
          : Uri.parse(
              '$baseUrl/manual-funding/admin/requests'
              '?status=$selectedStatus',
            );

      final http.Response response = await http.get(
        uri,
        headers: {
          'Accept': 'application/json',
          'Authorization': 'Bearer $token',
        },
      ).timeout(
        const Duration(seconds: 30),
      );

      final dynamic decoded = _decodeResponse(response.body);

      if (response.statusCode >= 200 && response.statusCode < 300) {
        final dynamic requests = decoded is Map ? decoded['requests'] : null;

        if (!mounted) return;

        setState(() {
          allRequests = requests is List ? requests : [];
        });
      } else {
        _showMessage(
          _extractMessage(
            decoded,
            fallback: 'Unable to load manual funding requests.',
          ),
          isError: true,
        );
      }
    } catch (_) {
      _showMessage(
        'Unable to connect to Servicepay backend.',
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

  Future<void> _approveRequest(
    dynamic request,
  ) async {
    final String requestId = _requestId(request);

    if (requestId.isEmpty) {
      _showMessage(
        'Invalid funding request.',
        isError: true,
      );
      return;
    }

    final String? adminNote = await _showReviewDialog(
      title: 'Approve Funding',
      message:
          'Confirm that the payment has entered the company bank account before approving.',
      buttonText: 'Approve Request',
      approve: true,
    );

    if (adminNote == null) {
      return;
    }

    await _reviewRequest(
      requestId: requestId,
      action: 'approve',
      adminNote: adminNote,
    );
  }

  Future<void> _rejectRequest(
    dynamic request,
  ) async {
    final String requestId = _requestId(request);

    if (requestId.isEmpty) {
      _showMessage(
        'Invalid funding request.',
        isError: true,
      );
      return;
    }

    final String? adminNote = await _showReviewDialog(
      title: 'Reject Funding',
      message: 'Enter the reason for rejecting this funding request.',
      buttonText: 'Reject Request',
      approve: false,
    );

    if (adminNote == null) {
      return;
    }

    if (adminNote.trim().isEmpty) {
      _showMessage(
        'A rejection reason is required.',
        isError: true,
      );
      return;
    }

    await _reviewRequest(
      requestId: requestId,
      action: 'reject',
      adminNote: adminNote,
    );
  }

  Future<void> _reviewRequest({
    required String requestId,
    required String action,
    required String adminNote,
  }) async {
    if (isProcessing) return;

    setState(() {
      isProcessing = true;
      processingRequestId = requestId;
    });

    try {
      final String? token = await _getToken();

      if (token == null || token.trim().isEmpty) {
        _showMessage(
          'Admin login token is unavailable.',
          isError: true,
        );
        return;
      }

      final http.Response response = await http
          .patch(
            Uri.parse(
              '$baseUrl/manual-funding/admin/requests/'
              '$requestId/$action',
            ),
            headers: {
              'Accept': 'application/json',
              'Content-Type': 'application/json',
              'Authorization': 'Bearer $token',
            },
            body: jsonEncode({
              'adminNote': adminNote.trim(),
            }),
          )
          .timeout(
            const Duration(seconds: 30),
          );

      final dynamic decoded = _decodeResponse(response.body);

      if (response.statusCode >= 200 && response.statusCode < 300) {
        _showMessage(
          action == 'approve'
              ? 'Funding request approved. Customer wallet has been credited.'
              : 'Funding request rejected.',
          isError: false,
        );

        await _loadRequests(
          refresh: true,
        );
      } else {
        _showMessage(
          _extractMessage(
            decoded,
            fallback: action == 'approve'
                ? 'Unable to approve funding request.'
                : 'Unable to reject funding request.',
          ),
          isError: true,
        );
      }
    } catch (_) {
      _showMessage(
        'Unable to process funding request.',
        isError: true,
      );
    } finally {
      if (!mounted) return;

      setState(() {
        isProcessing = false;
        processingRequestId = '';
      });
    }
  }

  Future<void> _showServiceControlDialog() async {
    final String? token = await _getToken();

    if (token == null || token.trim().isEmpty) {
      _showMessage(
        'Admin login token is unavailable.',
        isError: true,
      );
      return;
    }

    try {
      final http.Response response = await http.get(
        Uri.parse(
          '$baseUrl/app-settings/admin',
        ),
        headers: {
          'Accept': 'application/json',
          'Authorization': 'Bearer $token',
        },
      );

      final dynamic decoded = _decodeResponse(
        response.body,
      );

      if (response.statusCode < 200 || response.statusCode >= 300) {
        _showMessage(
          _extractMessage(
            decoded,
            fallback: 'Unable to load service settings.',
          ),
          isError: true,
        );
        return;
      }

      dynamic settings = decoded is Map ? decoded['settings'] : null;

      settings ??= decoded is Map && decoded['data'] is Map
          ? decoded['data']['settings']
          : null;

      final Map<dynamic, dynamic> rawServices =
          settings is Map && settings['services'] is Map
              ? settings['services'] as Map
              : <dynamic, dynamic>{};

      final Map<String, String> labels = <String, String>{
        'kekeNapep': 'Keke Napep',
        'amana': 'ServicePay Amana',
        'airtime': 'Airtime',
        'data': 'Data',
        'electricity': 'Electricity',
        'cableTv': 'Cable TV',
        'examPin': 'Exam PIN',
        'ninVerification': 'NIN Verification',
        'delivery': 'Delivery',
        'walletFunding': 'Wallet Funding',
        'servicepayTransfer': 'ServicePay Transfer',
        'bankTransfer': 'Bank Transfer',
        'flightBooking': 'Flight Booking',
        'notifications': 'Notifications',
      };

      final Map<String, bool> values = <String, bool>{
        for (final String key in labels.keys) key: rawServices[key] != false,
      };

      if (!mounted) return;

      final Map<String, bool>? result = await showDialog<Map<String, bool>>(
        context: context,
        builder: (
          BuildContext dialogContext,
        ) {
          return StatefulBuilder(
            builder: (
              BuildContext context,
              void Function(
                void Function(),
              ) setLocalState,
            ) {
              return AlertDialog(
                title: const Text(
                  'Service Control',
                ),
                content: SizedBox(
                  width: 500,
                  child: ListView(
                    shrinkWrap: true,
                    children: labels.entries.map(
                      (entry) {
                        return SwitchListTile(
                          title: Text(
                            entry.value,
                          ),
                          subtitle: Text(
                            values[entry.key] == true
                                ? 'Customers can see this service'
                                : 'Hidden from customer dashboard',
                          ),
                          value: values[entry.key] == true,
                          onChanged: (bool value) {
                            setLocalState(
                              () {
                                values[entry.key] = value;
                              },
                            );
                          },
                        );
                      },
                    ).toList(),
                  ),
                ),
                actions: [
                  TextButton(
                    onPressed: () => Navigator.pop(
                      dialogContext,
                    ),
                    child: const Text(
                      'Cancel',
                    ),
                  ),
                  FilledButton(
                    onPressed: () => Navigator.pop(
                      dialogContext,
                      Map<String, bool>.from(
                        values,
                      ),
                    ),
                    child: const Text(
                      'Save',
                    ),
                  ),
                ],
              );
            },
          );
        },
      );

      if (result == null) {
        return;
      }

      final http.Response saveResponse = await http.put(
        Uri.parse(
          '$baseUrl/app-settings/admin',
        ),
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          'Authorization': 'Bearer $token',
        },
        body: jsonEncode({
          'reason': 'Head Office service visibility update',
          'services': result,
        }),
      );

      final dynamic saveDecoded = _decodeResponse(
        saveResponse.body,
      );

      if (saveResponse.statusCode >= 200 && saveResponse.statusCode < 300) {
        _showMessage(
          'Service availability updated successfully.',
          isError: false,
        );
      } else {
        _showMessage(
          _extractMessage(
            saveDecoded,
            fallback: 'Unable to update service availability.',
          ),
          isError: true,
        );
      }
    } catch (_) {
      _showMessage(
        'Unable to update service settings.',
        isError: true,
      );
    }
  }

  Future<void> _showWalletAdjustmentDialog() async {
    final TextEditingController customerController = TextEditingController();

    final TextEditingController amountController = TextEditingController();

    final TextEditingController reasonController = TextEditingController();

    String action = 'CREDIT';

    final Map<String, String>? result = await showDialog<Map<String, String>>(
      context: context,
      barrierDismissible: false,
      builder: (
        BuildContext dialogContext,
      ) {
        return StatefulBuilder(
          builder: (
            BuildContext context,
            void Function(
              void Function(),
            ) setLocalState,
          ) {
            return AlertDialog(
              title: const Text(
                'Adjust Customer Wallet',
              ),
              content: SizedBox(
                width: 460,
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    TextField(
                      controller: customerController,
                      decoration: const InputDecoration(
                        labelText: 'Customer phone, email or ID',
                      ),
                    ),
                    const SizedBox(
                      height: 14,
                    ),
                    DropdownButtonFormField<String>(
                      value: action,
                      decoration: const InputDecoration(
                        labelText: 'Action',
                      ),
                      items: const [
                        DropdownMenuItem(
                          value: 'CREDIT',
                          child: Text(
                            'Credit Wallet',
                          ),
                        ),
                        DropdownMenuItem(
                          value: 'DEBIT',
                          child: Text(
                            'Debit Wallet',
                          ),
                        ),
                      ],
                      onChanged: (String? value) {
                        if (value == null) {
                          return;
                        }

                        setLocalState(
                          () {
                            action = value;
                          },
                        );
                      },
                    ),
                    const SizedBox(
                      height: 14,
                    ),
                    TextField(
                      controller: amountController,
                      keyboardType: const TextInputType.numberWithOptions(
                        decimal: true,
                      ),
                      decoration: const InputDecoration(
                        labelText: 'Amount',
                        prefixText: '₦ ',
                      ),
                    ),
                    const SizedBox(
                      height: 14,
                    ),
                    TextField(
                      controller: reasonController,
                      maxLines: 2,
                      decoration: const InputDecoration(
                        labelText: 'Reason',
                        hintText: 'Example: Correction of customer wallet',
                      ),
                    ),
                  ],
                ),
              ),
              actions: [
                TextButton(
                  onPressed: () => Navigator.pop(
                    dialogContext,
                  ),
                  child: const Text(
                    'Cancel',
                  ),
                ),
                FilledButton(
                  onPressed: () {
                    Navigator.pop(
                      dialogContext,
                      {
                        'identifier': customerController.text.trim(),
                        'amount': amountController.text.trim(),
                        'reason': reasonController.text.trim(),
                        'action': action,
                      },
                    );
                  },
                  child: Text(
                    action == 'CREDIT' ? 'Credit' : 'Debit',
                  ),
                ),
              ],
            );
          },
        );
      },
    );

    customerController.dispose();
    amountController.dispose();
    reasonController.dispose();

    if (result == null) {
      return;
    }

    final double? amount = double.tryParse(
      result['amount'] ?? '',
    );

    if ((result['identifier'] ?? '').isEmpty ||
        amount == null ||
        amount <= 0 ||
        (result['reason'] ?? '').length < 5) {
      _showMessage(
        'Enter customer, valid amount and a clear reason.',
        isError: true,
      );
      return;
    }

    final String? token = await _getToken();

    if (token == null || token.trim().isEmpty) {
      _showMessage(
        'Admin login token is unavailable.',
        isError: true,
      );
      return;
    }

    try {
      final http.Response response = await http.post(
        Uri.parse(
          '$baseUrl/admin/wallet-adjustment',
        ),
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          'Authorization': 'Bearer $token',
        },
        body: jsonEncode({
          'identifier': result['identifier'],
          'action': result['action'],
          'amount': amount,
          'reason': result['reason'],
        }),
      );

      final dynamic decoded = _decodeResponse(
        response.body,
      );

      if (response.statusCode >= 200 && response.statusCode < 300) {
        final dynamic customer = decoded is Map ? decoded['customer'] : null;

        final dynamic balance =
            customer is Map ? customer['walletBalance'] : null;

        _showMessage(
          '${_extractMessage(decoded, fallback: 'Wallet adjusted successfully.')}'
          '${balance != null ? ' New balance: ₦$balance' : ''}',
          isError: false,
        );
      } else {
        _showMessage(
          _extractMessage(
            decoded,
            fallback: 'Unable to adjust customer wallet.',
          ),
          isError: true,
        );
      }
    } catch (_) {
      _showMessage(
        'Unable to adjust customer wallet.',
        isError: true,
      );
    }
  }

  Future<String?> _showReviewDialog({
    required String title,
    required String message,
    required String buttonText,
    required bool approve,
  }) async {
    final TextEditingController controller = TextEditingController();

    final String? result = await showDialog<String>(
      context: context,
      barrierDismissible: false,
      builder: (
        BuildContext dialogContext,
      ) {
        return AlertDialog(
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(22),
          ),
          title: Text(
            title,
            style: const TextStyle(
              fontWeight: FontWeight.w800,
            ),
          ),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                message,
                style: const TextStyle(
                  color: Color(0xFF64748B),
                  height: 1.5,
                ),
              ),
              const SizedBox(height: 18),
              TextField(
                controller: controller,
                maxLines: 3,
                decoration: InputDecoration(
                  labelText:
                      approve ? 'Admin note (optional)' : 'Rejection reason',
                  hintText: approve
                      ? 'Example: Payment confirmed'
                      : 'Explain why this request was rejected',
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(14),
                  ),
                ),
              ),
            ],
          ),
          actions: [
            TextButton(
              onPressed: () {
                Navigator.pop(
                  dialogContext,
                );
              },
              child: const Text('Cancel'),
            ),
            FilledButton(
              onPressed: () {
                Navigator.pop(
                  dialogContext,
                  controller.text.trim(),
                );
              },
              style: FilledButton.styleFrom(
                backgroundColor:
                    approve ? const Color(0xFF059669) : const Color(0xFFDC2626),
              ),
              child: Text(buttonText),
            ),
          ],
        );
      },
    );

    controller.dispose();

    return result;
  }

  String _requestId(dynamic request) {
    if (request is! Map) {
      return '';
    }

    return (request['_id'] ?? request['id'] ?? '').toString();
  }

  Map<dynamic, dynamic> _customer(
    dynamic request,
  ) {
    if (request is Map && request['user'] is Map) {
      return request['user'] as Map;
    }

    return {};
  }

  String _customerName(dynamic request) {
    final Map<dynamic, dynamic> user = _customer(request);

    return (user['fullName'] ?? user['name'] ?? 'Servicepay Customer')
        .toString();
  }

  String _customerPhone(dynamic request) {
    final Map<dynamic, dynamic> user = _customer(request);

    return (user['phone'] ?? '').toString();
  }

  String _customerEmail(dynamic request) {
    final Map<dynamic, dynamic> user = _customer(request);

    return (user['email'] ?? '').toString();
  }

  String _field(
    dynamic request,
    String key,
  ) {
    if (request is! Map) {
      return '';
    }

    return (request[key] ?? '').toString();
  }

  double _amount(dynamic request) {
    if (request is! Map) {
      return 0;
    }

    final dynamic value = request['amount'];

    if (value is num) {
      return value.toDouble();
    }

    return double.tryParse(
          value?.toString() ?? '',
        ) ??
        0;
  }

  String _formatMoney(double amount) {
    final String fixed = amount.toStringAsFixed(2);

    final List<String> parts = fixed.split('.');

    final String whole = parts.first;
    final String decimal = parts.last;

    final StringBuffer output = StringBuffer();

    for (int index = 0; index < whole.length; index++) {
      output.write(whole[index]);

      final int remaining = whole.length - index - 1;

      if (remaining > 0 && remaining % 3 == 0) {
        output.write(',');
      }
    }

    return '${output.toString()}.$decimal';
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

      return '$day/$month/${date.year}, '
          '$hour:$minute';
    } catch (_) {
      return value.toString();
    }
  }

  Color _statusColor(String status) {
    switch (status.toUpperCase()) {
      case 'APPROVED':
        return const Color(0xFF059669);

      case 'REJECTED':
        return const Color(0xFFDC2626);

      default:
        return const Color(0xFFD97706);
    }
  }

  IconData _statusIcon(String status) {
    switch (status.toUpperCase()) {
      case 'APPROVED':
        return Icons.check_circle_rounded;

      case 'REJECTED':
        return Icons.cancel_rounded;

      default:
        return Icons.schedule_rounded;
    }
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

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF5F7FA),
      appBar: AppBar(
        backgroundColor: const Color(0xFFF5F7FA),
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        title: const Text(
          'Manual Funding',
          style: TextStyle(
            color: Color(0xFF0F172A),
            fontSize: 22,
            fontWeight: FontWeight.w800,
          ),
        ),
        actions: [
          IconButton(
            tooltip: 'Service Control',
            onPressed: _showServiceControlDialog,
            icon: const Icon(
              Icons.tune_rounded,
            ),
          ),
          IconButton(
            tooltip: 'Credit / Debit Customer',
            onPressed: _showWalletAdjustmentDialog,
            icon: const Icon(
              Icons.account_balance_wallet_rounded,
            ),
          ),
          IconButton(
            tooltip: 'Refresh',
            onPressed: isRefreshing
                ? null
                : () {
                    _loadRequests(
                      refresh: true,
                    );
                  },
            icon: isRefreshing
                ? const SizedBox(
                    width: 21,
                    height: 21,
                    child: CircularProgressIndicator(
                      strokeWidth: 2.3,
                      color: Color(0xFF0F766E),
                    ),
                  )
                : const Icon(
                    Icons.refresh_rounded,
                  ),
          ),
          const SizedBox(width: 8),
        ],
      ),
      body: Column(
        children: [
          _buildStatusFilter(),
          Expanded(
            child: isLoading
                ? const Center(
                    child: CircularProgressIndicator(
                      color: Color(0xFF0F766E),
                    ),
                  )
                : RefreshIndicator(
                    color: const Color(0xFF0F766E),
                    onRefresh: () => _loadRequests(
                      refresh: true,
                    ),
                    child: _buildBody(),
                  ),
          ),
        ],
      ),
    );
  }

  Widget _buildStatusFilter() {
    return SizedBox(
      height: 62,
      child: ListView.separated(
        padding: const EdgeInsets.symmetric(
          horizontal: 16,
          vertical: 10,
        ),
        scrollDirection: Axis.horizontal,
        itemCount: statuses.length,
        separatorBuilder: (_, __) => const SizedBox(width: 8),
        itemBuilder: (
          BuildContext context,
          int index,
        ) {
          final String status = statuses[index];

          final bool selected = status == selectedStatus;

          return ChoiceChip(
            label: Text(status),
            selected: selected,
            showCheckmark: false,
            onSelected: (_) {
              if (status == selectedStatus) {
                return;
              }

              setState(() {
                selectedStatus = status;
              });

              _loadRequests();
            },
            selectedColor: const Color(0xFF0F766E),
            backgroundColor: Colors.white,
            side: BorderSide(
              color:
                  selected ? const Color(0xFF0F766E) : const Color(0xFFE2E8F0),
            ),
            labelStyle: TextStyle(
              color: selected ? Colors.white : const Color(0xFF475569),
              fontWeight: FontWeight.w700,
              fontSize: 12,
            ),
          );
        },
      ),
    );
  }

  Widget _buildBody() {
    if (allRequests.isEmpty) {
      return ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.all(24),
        children: [
          const SizedBox(height: 80),
          Container(
            padding: const EdgeInsets.symmetric(
              horizontal: 24,
              vertical: 38,
            ),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(24),
              border: Border.all(
                color: const Color(0xFFE8EDF3),
              ),
            ),
            child: const Column(
              children: [
                Icon(
                  Icons.account_balance_wallet_outlined,
                  color: Color(0xFF94A3B8),
                  size: 48,
                ),
                SizedBox(height: 15),
                Text(
                  'No funding requests',
                  style: TextStyle(
                    color: Color(0xFF0F172A),
                    fontSize: 17,
                    fontWeight: FontWeight.w800,
                  ),
                ),
                SizedBox(height: 6),
                Text(
                  'Customer manual funding requests will appear here.',
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    color: Color(0xFF64748B),
                    height: 1.5,
                  ),
                ),
              ],
            ),
          ),
        ],
      );
    }

    return LayoutBuilder(
      builder: (
        BuildContext context,
        BoxConstraints constraints,
      ) {
        final double horizontalPadding = constraints.maxWidth >= 800 ? 30 : 16;

        return ListView.separated(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: EdgeInsets.fromLTRB(
            horizontalPadding,
            8,
            horizontalPadding,
            30,
          ),
          itemCount: allRequests.length,
          separatorBuilder: (_, __) => const SizedBox(height: 14),
          itemBuilder: (
            BuildContext context,
            int index,
          ) {
            return _buildRequestCard(
              allRequests[index],
            );
          },
        );
      },
    );
  }

  Widget _buildRequestCard(
    dynamic request,
  ) {
    final String requestId = _requestId(request);

    final String status = _field(request, 'status').toUpperCase();

    final String senderName = _field(request, 'senderName');

    final String senderBank = _field(request, 'senderBank');

    final String reference = _field(
      request,
      'paymentReference',
    );

    final String note = _field(request, 'note');

    final String adminNote = _field(request, 'adminNote');

    final bool processing = isProcessing && processingRequestId == requestId;

    final Color statusColor = _statusColor(status);

    return Center(
      child: ConstrainedBox(
        constraints: const BoxConstraints(
          maxWidth: 850,
        ),
        child: Container(
          padding: const EdgeInsets.all(18),
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(22),
            border: Border.all(
              color: const Color(0xFFE8EDF3),
            ),
            boxShadow: [
              BoxShadow(
                color: Colors.black.withValues(alpha: 0.035),
                blurRadius: 14,
                offset: const Offset(0, 5),
              ),
            ],
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Container(
                    width: 50,
                    height: 50,
                    decoration: BoxDecoration(
                      color: statusColor.withValues(
                        alpha: 0.10,
                      ),
                      borderRadius: BorderRadius.circular(
                        16,
                      ),
                    ),
                    child: Icon(
                      _statusIcon(status),
                      color: statusColor,
                    ),
                  ),
                  const SizedBox(width: 13),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          _customerName(
                            request,
                          ),
                          style: const TextStyle(
                            color: Color(0xFF0F172A),
                            fontSize: 16,
                            fontWeight: FontWeight.w800,
                          ),
                        ),
                        const SizedBox(height: 4),
                        Text(
                          _customerPhone(
                            request,
                          ).isNotEmpty
                              ? _customerPhone(
                                  request,
                                )
                              : _customerEmail(
                                  request,
                                ),
                          style: const TextStyle(
                            color: Color(0xFF64748B),
                            fontSize: 12,
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
                      color: statusColor.withValues(
                        alpha: 0.10,
                      ),
                      borderRadius: BorderRadius.circular(
                        30,
                      ),
                    ),
                    child: Text(
                      status.isEmpty ? 'PENDING' : status,
                      style: TextStyle(
                        color: statusColor,
                        fontSize: 10,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 18),
              Text(
                '₦${_formatMoney(_amount(request))}',
                style: const TextStyle(
                  color: Color(0xFF0F766E),
                  fontSize: 25,
                  fontWeight: FontWeight.w900,
                ),
              ),
              const SizedBox(height: 16),
              _detailRow(
                'Sender Name',
                senderName,
              ),
              _detailRow(
                'Sender Bank',
                senderBank,
              ),
              _detailRow(
                'Reference',
                reference,
              ),
              _detailRow(
                'Submitted',
                _formatDate(
                  request is Map ? request['createdAt'] : null,
                ),
              ),
              if (note.isNotEmpty)
                _detailRow(
                  'Customer Note',
                  note,
                ),
              if (adminNote.isNotEmpty)
                _detailRow(
                  'Admin Note',
                  adminNote,
                ),
              if (status == 'PENDING') ...[
                const SizedBox(height: 18),
                if (processing)
                  const Center(
                    child: CircularProgressIndicator(
                      color: Color(0xFF0F766E),
                    ),
                  )
                else
                  Row(
                    children: [
                      Expanded(
                        child: OutlinedButton.icon(
                          onPressed: () => _rejectRequest(
                            request,
                          ),
                          icon: const Icon(
                            Icons.close_rounded,
                          ),
                          label: const Text(
                            'Reject',
                          ),
                          style: OutlinedButton.styleFrom(
                            foregroundColor: const Color(
                              0xFFDC2626,
                            ),
                            side: const BorderSide(
                              color: Color(
                                0xFFDC2626,
                              ),
                            ),
                            padding: const EdgeInsets.symmetric(
                              vertical: 13,
                            ),
                          ),
                        ),
                      ),
                      const SizedBox(
                        width: 12,
                      ),
                      Expanded(
                        child: FilledButton.icon(
                          onPressed: () => _approveRequest(
                            request,
                          ),
                          icon: const Icon(
                            Icons.check_rounded,
                          ),
                          label: const Text(
                            'Approve',
                          ),
                          style: FilledButton.styleFrom(
                            backgroundColor: const Color(
                              0xFF059669,
                            ),
                            padding: const EdgeInsets.symmetric(
                              vertical: 13,
                            ),
                          ),
                        ),
                      ),
                    ],
                  ),
              ],
            ],
          ),
        ),
      ),
    );
  }

  Widget _detailRow(
    String label,
    String value,
  ) {
    if (value.trim().isEmpty) {
      return const SizedBox.shrink();
    }

    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 112,
            child: Text(
              label,
              style: const TextStyle(
                color: Color(0xFF94A3B8),
                fontSize: 12,
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
          Expanded(
            child: Text(
              value,
              style: const TextStyle(
                color: Color(0xFF334155),
                fontSize: 13,
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

class ManualFundingScreen extends StatefulWidget {
  const ManualFundingScreen({super.key});

  @override
  State<ManualFundingScreen> createState() =>
      _ManualFundingScreenState();
}

class _ManualFundingScreenState
    extends State<ManualFundingScreen> {
  static const String baseUrl =
      'https://api.servicepay.ng/api';

  // IMPORTANT:
  // Replace the bank name and account number below
  // with your real company account details.
  static const String companyAccountName =
      'Yumpay Global Tech';

  static const String companyBankName =
      'Union Bank';

  static const String companyAccountNumber =
      '0175199528';

  final GlobalKey<FormState> formKey =
      GlobalKey<FormState>();

  final TextEditingController amountController =
      TextEditingController();

  final TextEditingController senderNameController =
      TextEditingController();

  final TextEditingController senderBankController =
      TextEditingController();

  final TextEditingController referenceController =
      TextEditingController();

  final TextEditingController noteController =
      TextEditingController();

  bool isSubmitting = false;
  bool isLoadingRequests = true;

  List<dynamic> fundingRequests = [];

  @override
  void initState() {
    super.initState();
    _loadSavedName();
    _loadFundingRequests();
  }

  @override
  void dispose() {
    amountController.dispose();
    senderNameController.dispose();
    senderBankController.dispose();
    referenceController.dispose();
    noteController.dispose();
    super.dispose();
  }

  Future<void> _loadSavedName() async {
    final SharedPreferences prefs =
        await SharedPreferences.getInstance();

    final String savedName =
        prefs.getString('user_name') ??
        prefs.getString('full_name') ??
        prefs.getString('name') ??
        '';

    if (!mounted) return;

    if (senderNameController.text.trim().isEmpty) {
      senderNameController.text = savedName;
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

  Future<String?> _getToken() async {
    final SharedPreferences prefs =
        await SharedPreferences.getInstance();

    return prefs.getString('auth_token');
  }

  Future<void> _copyAccountNumber() async {
    await Clipboard.setData(
      const ClipboardData(
        text: companyAccountNumber,
      ),
    );

    if (!mounted) return;

    _showMessage(
      'Account number copied.',
      isError: false,
    );
  }

  Future<void> _loadFundingRequests() async {
    try {
      final String? token = await _getToken();

      if (token == null || token.trim().isEmpty) {
        if (!mounted) return;

        setState(() {
          isLoadingRequests = false;
        });

        return;
      }

      final http.Response response = await http.get(
        Uri.parse(
          '$baseUrl/manual-funding/my-requests',
        ),
        headers: {
          'Accept': 'application/json',
          'Authorization': 'Bearer $token',
        },
      ).timeout(
        const Duration(seconds: 30),
      );

      final dynamic decoded =
          _decodeResponse(response.body);

      if (!mounted) return;

      if (response.statusCode >= 200 &&
          response.statusCode < 300) {
        final dynamic requests =
            decoded is Map
                ? decoded['requests']
                : null;

        setState(() {
          fundingRequests =
              requests is List ? requests : [];
        });
      }
    } catch (_) {
      // Do not force logout when request history fails.
    } finally {
      if (!mounted) return;

      setState(() {
        isLoadingRequests = false;
      });
    }
  }

  Future<void> _submitFundingRequest() async {
    if (isSubmitting) return;

    FocusScope.of(context).unfocus();

    if (!(formKey.currentState?.validate() ?? false)) {
      return;
    }

    final double? amount = double.tryParse(
      amountController.text
          .replaceAll(',', '')
          .replaceAll('₦', '')
          .trim(),
    );

    if (amount == null || amount < 100) {
      _showMessage(
        'Minimum manual funding amount is ₦100.',
        isError: true,
      );
      return;
    }

    setState(() {
      isSubmitting = true;
    });

    try {
      final String? token = await _getToken();

      if (token == null || token.trim().isEmpty) {
        _showMessage(
          'Your login session is unavailable. Please sign in again.',
          isError: true,
        );
        return;
      }

      final http.Response response = await http.post(
        Uri.parse(
          '$baseUrl/manual-funding/request',
        ),
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          'Authorization': 'Bearer $token',
        },
        body: jsonEncode({
          'amount': amount,
          'senderName':
              senderNameController.text.trim(),
          'senderBank':
              senderBankController.text.trim(),
          'paymentReference':
              referenceController.text.trim(),
          'note': noteController.text.trim(),
        }),
      ).timeout(
        const Duration(seconds: 30),
      );

      final dynamic decoded =
          _decodeResponse(response.body);

      if (response.statusCode >= 200 &&
          response.statusCode < 300) {
        amountController.clear();
        senderBankController.clear();
        referenceController.clear();
        noteController.clear();

        await _loadFundingRequests();

        if (!mounted) return;

        await _showSuccessDialog();
      } else {
        final String message = _extractMessage(
          decoded,
          fallback:
              'Unable to submit manual funding request.',
        );

        _showMessage(
          message,
          isError: true,
        );
      }
    } on http.ClientException {
      _showMessage(
        'Unable to connect to Servicepay. Check your internet connection.',
        isError: true,
      );
    } catch (_) {
      _showMessage(
        'Unable to submit your funding request. Please try again.',
        isError: true,
      );
    } finally {
      if (!mounted) return;

      setState(() {
        isSubmitting = false;
      });
    }
  }

  Future<void> _showSuccessDialog() async {
    await showDialog<void>(
      context: context,
      barrierDismissible: false,
      builder: (BuildContext dialogContext) {
        return AlertDialog(
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(24),
          ),
          contentPadding:
              const EdgeInsets.fromLTRB(
            24,
            28,
            24,
            20,
          ),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: 72,
                height: 72,
                decoration: const BoxDecoration(
                  color: Color(0xFFDCFCE7),
                  shape: BoxShape.circle,
                ),
                child: const Icon(
                  Icons.check_rounded,
                  color: Color(0xFF15803D),
                  size: 40,
                ),
              ),
              const SizedBox(height: 20),
              const Text(
                'Request Submitted',
                textAlign: TextAlign.center,
                style: TextStyle(
                  color: Color(0xFF0F172A),
                  fontSize: 21,
                  fontWeight: FontWeight.w800,
                ),
              ),
              const SizedBox(height: 10),
              const Text(
                'Your manual funding request has been submitted. Your wallet will be credited after admin approval.',
                textAlign: TextAlign.center,
                style: TextStyle(
                  color: Color(0xFF64748B),
                  fontSize: 14,
                  height: 1.5,
                ),
              ),
              const SizedBox(height: 22),
              SizedBox(
                width: double.infinity,
                child: FilledButton(
                  onPressed: () {
                    Navigator.pop(dialogContext);
                  },
                  style: FilledButton.styleFrom(
                    backgroundColor:
                        const Color(0xFF0F766E),
                    padding:
                        const EdgeInsets.symmetric(
                      vertical: 14,
                    ),
                    shape: RoundedRectangleBorder(
                      borderRadius:
                          BorderRadius.circular(14),
                    ),
                  ),
                  child: const Text(
                    'Done',
                    style: TextStyle(
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
              ),
            ],
          ),
        );
      },
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

  String? _requiredValidator(
    String? value,
    String field,
  ) {
    if (value == null || value.trim().isEmpty) {
      return '$field is required.';
    }

    return null;
  }

  String? _amountValidator(String? value) {
    if (value == null || value.trim().isEmpty) {
      return 'Amount is required.';
    }

    final double? amount = double.tryParse(
      value
          .replaceAll(',', '')
          .replaceAll('₦', '')
          .trim(),
    );

    if (amount == null) {
      return 'Enter a valid amount.';
    }

    if (amount < 100) {
      return 'Minimum amount is ₦100.';
    }

    return null;
  }

  String? _referenceValidator(String? value) {
    if (value == null || value.trim().isEmpty) {
      return 'Payment reference is required.';
    }

    if (value.trim().length < 4) {
      return 'Enter a valid payment reference.';
    }

    return null;
  }

  String _formatMoney(dynamic value) {
    final double amount =
        value is num
            ? value.toDouble()
            : double.tryParse(
                  value?.toString() ?? '',
                ) ??
                0;

    final String fixed = amount.toStringAsFixed(2);
    final List<String> parts = fixed.split('.');
    final String whole = parts.first;
    final String decimal = parts.last;

    final StringBuffer output = StringBuffer();

    for (int index = 0;
        index < whole.length;
        index++) {
      output.write(whole[index]);

      final int remaining =
          whole.length - index - 1;

      if (remaining > 0 &&
          remaining % 3 == 0) {
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
        title: const Text(
          'Manual Funding',
          style: TextStyle(
            color: Color(0xFF0F172A),
            fontSize: 21,
            fontWeight: FontWeight.w800,
          ),
        ),
        actions: [
          IconButton(
            tooltip: 'Refresh requests',
            onPressed: () {
              setState(() {
                isLoadingRequests = true;
              });

              _loadFundingRequests();
            },
            icon: const Icon(
              Icons.refresh_rounded,
              color: Color(0xFF0F172A),
            ),
          ),
          const SizedBox(width: 8),
        ],
      ),
      body: SafeArea(
        child: LayoutBuilder(
          builder: (
            BuildContext context,
            BoxConstraints constraints,
          ) {
            final double horizontalPadding =
                constraints.maxWidth >= 700
                    ? 32
                    : 16;

            return SingleChildScrollView(
              padding: EdgeInsets.fromLTRB(
                horizontalPadding,
                8,
                horizontalPadding,
                32,
              ),
              child: Center(
                child: ConstrainedBox(
                  constraints:
                      const BoxConstraints(
                    maxWidth: 760,
                  ),
                  child: Column(
                    crossAxisAlignment:
                        CrossAxisAlignment.start,
                    children: [
                      _buildAccountCard(),
                      const SizedBox(height: 18),
                      _buildInstructions(),
                      const SizedBox(height: 22),
                      _buildFundingForm(),
                      const SizedBox(height: 28),
                      _buildRequestHistory(),
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

  Widget _buildAccountCard() {
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
            color: const Color(0xFF0F766E)
                .withValues(alpha: 0.22),
            blurRadius: 24,
            offset: const Offset(0, 12),
          ),
        ],
      ),
      child: Stack(
        children: [
          Positioned(
            right: -40,
            top: -50,
            child: Container(
              width: 145,
              height: 145,
              decoration: BoxDecoration(
                color: Colors.white
                    .withValues(alpha: 0.06),
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
                          .withValues(alpha: 0.14),
                      borderRadius:
                          BorderRadius.circular(15),
                    ),
                    child: const Icon(
                      Icons.account_balance_rounded,
                      color: Colors.white,
                    ),
                  ),
                  const SizedBox(width: 12),
                  const Expanded(
                    child: Text(
                      'Transfer to this account',
                      style: TextStyle(
                        color: Colors.white,
                        fontSize: 17,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 24),
              _accountInformation(
                label: 'Account Name',
                value: companyAccountName,
              ),
              const SizedBox(height: 16),
              _accountInformation(
                label: 'Bank Name',
                value: companyBankName,
              ),
              const SizedBox(height: 16),
              Text(
                'Account Number',
                style: TextStyle(
                  color: Colors.white
                      .withValues(alpha: 0.72),
                  fontSize: 12,
                  fontWeight: FontWeight.w500,
                ),
              ),
              const SizedBox(height: 5),
              Row(
                children: [
                  const Expanded(
                    child: Text(
                      companyAccountNumber,
                      style: TextStyle(
                        color: Colors.white,
                        fontSize: 25,
                        fontWeight: FontWeight.w900,
                        letterSpacing: 1.2,
                      ),
                    ),
                  ),
                  Material(
                    color: Colors.white
                        .withValues(alpha: 0.14),
                    borderRadius:
                        BorderRadius.circular(12),
                    child: InkWell(
                      onTap: _copyAccountNumber,
                      borderRadius:
                          BorderRadius.circular(12),
                      child: const Padding(
                        padding: EdgeInsets.symmetric(
                          horizontal: 13,
                          vertical: 10,
                        ),
                        child: Row(
                          children: [
                            Icon(
                              Icons.copy_rounded,
                              color: Colors.white,
                              size: 18,
                            ),
                            SizedBox(width: 6),
                            Text(
                              'Copy',
                              style: TextStyle(
                                color: Colors.white,
                                fontSize: 12,
                                fontWeight:
                                    FontWeight.w700,
                              ),
                            ),
                          ],
                        ),
                      ),
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

  Widget _accountInformation({
    required String label,
    required String value,
  }) {
    return Column(
      crossAxisAlignment:
          CrossAxisAlignment.start,
      children: [
        Text(
          label,
          style: TextStyle(
            color: Colors.white
                .withValues(alpha: 0.72),
            fontSize: 12,
            fontWeight: FontWeight.w500,
          ),
        ),
        const SizedBox(height: 4),
        Text(
          value,
          style: const TextStyle(
            color: Colors.white,
            fontSize: 17,
            fontWeight: FontWeight.w800,
          ),
        ),
      ],
    );
  }

  Widget _buildInstructions() {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(17),
      decoration: BoxDecoration(
        color: const Color(0xFFEFF6FF),
        borderRadius: BorderRadius.circular(18),
        border: Border.all(
          color: const Color(0xFFBFDBFE),
        ),
      ),
      child: const Row(
        crossAxisAlignment:
            CrossAxisAlignment.start,
        children: [
          Icon(
            Icons.info_outline_rounded,
            color: Color(0xFF2563EB),
            size: 22,
          ),
          SizedBox(width: 12),
          Expanded(
            child: Text(
              'Make the bank transfer first. After payment, complete the form below using the exact sender details and transaction reference. Your wallet will be credited after admin confirmation.',
              style: TextStyle(
                color: Color(0xFF1E40AF),
                fontSize: 13,
                height: 1.5,
                fontWeight: FontWeight.w500,
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildFundingForm() {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(24),
        border: Border.all(
          color: const Color(0xFFE8EDF3),
        ),
        boxShadow: [
          BoxShadow(
            color: Colors.black
                .withValues(alpha: 0.035),
            blurRadius: 16,
            offset: const Offset(0, 6),
          ),
        ],
      ),
      child: Form(
        key: formKey,
        child: Column(
          crossAxisAlignment:
              CrossAxisAlignment.start,
          children: [
            const Text(
              'Payment Details',
              style: TextStyle(
                color: Color(0xFF0F172A),
                fontSize: 19,
                fontWeight: FontWeight.w800,
              ),
            ),
            const SizedBox(height: 6),
            const Text(
              'Enter the same details used for your bank transfer.',
              style: TextStyle(
                color: Color(0xFF64748B),
                fontSize: 13,
              ),
            ),
            const SizedBox(height: 22),
            _buildTextField(
              controller: amountController,
              label: 'Amount',
              hint: 'Enter amount transferred',
              icon: Icons.payments_outlined,
              keyboardType:
                  const TextInputType.numberWithOptions(
                decimal: true,
              ),
              prefixText: '₦ ',
              validator: _amountValidator,
            ),
            const SizedBox(height: 16),
            _buildTextField(
              controller: senderNameController,
              label: 'Sender Name',
              hint:
                  'Name on the bank account used',
              icon: Icons.person_outline_rounded,
              textCapitalization:
                  TextCapitalization.words,
              validator: (value) =>
                  _requiredValidator(
                value,
                'Sender name',
              ),
            ),
            const SizedBox(height: 16),
            _buildTextField(
              controller: senderBankController,
              label: 'Sender Bank',
              hint:
                  'Example: Moniepoint, OPay or GTBank',
              icon:
                  Icons.account_balance_outlined,
              textCapitalization:
                  TextCapitalization.words,
              validator: (value) =>
                  _requiredValidator(
                value,
                'Sender bank',
              ),
            ),
            const SizedBox(height: 16),
            _buildTextField(
              controller: referenceController,
              label: 'Payment Reference',
              hint:
                  'Enter your bank transaction reference',
              icon: Icons.tag_rounded,
              textCapitalization:
                  TextCapitalization.characters,
              validator: _referenceValidator,
            ),
            const SizedBox(height: 16),
            _buildTextField(
              controller: noteController,
              label: 'Note (Optional)',
              hint:
                  'Add any additional information',
              icon: Icons.notes_rounded,
              maxLines: 3,
            ),
            const SizedBox(height: 22),
            SizedBox(
              width: double.infinity,
              height: 54,
              child: FilledButton.icon(
                onPressed: isSubmitting
                    ? null
                    : _submitFundingRequest,
                style: FilledButton.styleFrom(
                  backgroundColor:
                      const Color(0xFF0F766E),
                  disabledBackgroundColor:
                      const Color(0xFF94A3B8),
                  shape: RoundedRectangleBorder(
                    borderRadius:
                        BorderRadius.circular(15),
                  ),
                ),
                icon: isSubmitting
                    ? const SizedBox(
                        width: 20,
                        height: 20,
                        child:
                            CircularProgressIndicator(
                          strokeWidth: 2.3,
                          color: Colors.white,
                        ),
                      )
                    : const Icon(
                        Icons.send_rounded,
                      ),
                label: Text(
                  isSubmitting
                      ? 'Submitting...'
                      : 'I Have Made the Transfer',
                  style: const TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildTextField({
    required TextEditingController controller,
    required String label,
    required String hint,
    required IconData icon,
    TextInputType? keyboardType,
    TextCapitalization textCapitalization =
        TextCapitalization.none,
    String? prefixText,
    int maxLines = 1,
    String? Function(String?)? validator,
  }) {
    return TextFormField(
      controller: controller,
      keyboardType: keyboardType,
      textCapitalization: textCapitalization,
      maxLines: maxLines,
      validator: validator,
      decoration: InputDecoration(
        labelText: label,
        hintText: hint,
        prefixText: prefixText,
        prefixIcon: Icon(
          icon,
          color: const Color(0xFF0F766E),
        ),
        filled: true,
        fillColor: const Color(0xFFF8FAFC),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(15),
          borderSide: const BorderSide(
            color: Color(0xFFE2E8F0),
          ),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(15),
          borderSide: const BorderSide(
            color: Color(0xFFE2E8F0),
          ),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(15),
          borderSide: const BorderSide(
            color: Color(0xFF0F766E),
            width: 2,
          ),
        ),
        errorBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(15),
          borderSide: const BorderSide(
            color: Color(0xFFDC2626),
          ),
        ),
        focusedErrorBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(15),
          borderSide: const BorderSide(
            color: Color(0xFFDC2626),
            width: 2,
          ),
        ),
      ),
    );
  }

  Widget _buildRequestHistory() {
    return Column(
      crossAxisAlignment:
          CrossAxisAlignment.start,
      children: [
        const Text(
          'Funding Requests',
          style: TextStyle(
            color: Color(0xFF0F172A),
            fontSize: 19,
            fontWeight: FontWeight.w800,
          ),
        ),
        const SizedBox(height: 12),
        if (isLoadingRequests)
          const Center(
            child: Padding(
              padding: EdgeInsets.all(24),
              child: CircularProgressIndicator(
                color: Color(0xFF0F766E),
              ),
            ),
          )
        else if (fundingRequests.isEmpty)
          _buildEmptyRequests()
        else
          ListView.separated(
            itemCount: fundingRequests.length,
            shrinkWrap: true,
            physics:
                const NeverScrollableScrollPhysics(),
            separatorBuilder: (_, __) =>
                const SizedBox(height: 10),
            itemBuilder: (
              BuildContext context,
              int index,
            ) {
              return _buildRequestCard(
                fundingRequests[index],
              );
            },
          ),
      ],
    );
  }

  Widget _buildEmptyRequests() {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(
        horizontal: 24,
        vertical: 32,
      ),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(22),
        border: Border.all(
          color: const Color(0xFFE8EDF3),
        ),
      ),
      child: const Column(
        children: [
          Icon(
            Icons.receipt_long_outlined,
            color: Color(0xFF94A3B8),
            size: 42,
          ),
          SizedBox(height: 12),
          Text(
            'No funding requests yet',
            style: TextStyle(
              color: Color(0xFF0F172A),
              fontSize: 15,
              fontWeight: FontWeight.w800,
            ),
          ),
          SizedBox(height: 5),
          Text(
            'Submitted requests will appear here.',
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

  Widget _buildRequestCard(dynamic request) {
    if (request is! Map) {
      return const SizedBox.shrink();
    }

    final String status =
        (request['status'] ?? 'PENDING')
            .toString()
            .toUpperCase();

    final dynamic amount = request['amount'];

    final String reference =
        (request['paymentReference'] ?? '')
            .toString();

    final String bank =
        (request['senderBank'] ?? '')
            .toString();

    final dynamic createdAt =
        request['createdAt'];

    final String adminNote =
        (request['adminNote'] ?? '')
            .toString()
            .trim();

    final Color statusColor =
        _statusColor(status);

    return Container(
      padding: const EdgeInsets.all(17),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(
          color: const Color(0xFFE8EDF3),
        ),
      ),
      child: Row(
        crossAxisAlignment:
            CrossAxisAlignment.start,
        children: [
          Container(
            width: 46,
            height: 46,
            decoration: BoxDecoration(
              color: statusColor
                  .withValues(alpha: 0.10),
              borderRadius:
                  BorderRadius.circular(15),
            ),
            child: Icon(
              _statusIcon(status),
              color: statusColor,
              size: 23,
            ),
          ),
          const SizedBox(width: 13),
          Expanded(
            child: Column(
              crossAxisAlignment:
                  CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        '₦${_formatMoney(amount)}',
                        style: const TextStyle(
                          color:
                              Color(0xFF0F172A),
                          fontSize: 16,
                          fontWeight:
                              FontWeight.w800,
                        ),
                      ),
                    ),
                    Container(
                      padding:
                          const EdgeInsets.symmetric(
                        horizontal: 9,
                        vertical: 5,
                      ),
                      decoration: BoxDecoration(
                        color: statusColor
                            .withValues(
                          alpha: 0.10,
                        ),
                        borderRadius:
                            BorderRadius.circular(20),
                      ),
                      child: Text(
                        status,
                        style: TextStyle(
                          color: statusColor,
                          fontSize: 10,
                          fontWeight:
                              FontWeight.w800,
                        ),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 6),
                if (bank.isNotEmpty)
                  Text(
                    bank,
                    style: const TextStyle(
                      color: Color(0xFF475569),
                      fontSize: 13,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                if (reference.isNotEmpty) ...[
                  const SizedBox(height: 4),
                  Text(
                    'Reference: $reference',
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      color: Color(0xFF64748B),
                      fontSize: 12,
                    ),
                  ),
                ],
                const SizedBox(height: 5),
                Text(
                  _formatDate(createdAt),
                  style: const TextStyle(
                    color: Color(0xFF94A3B8),
                    fontSize: 11,
                  ),
                ),
                if (adminNote.isNotEmpty) ...[
                  const SizedBox(height: 9),
                  Container(
                    width: double.infinity,
                    padding: const EdgeInsets.all(10),
                    decoration: BoxDecoration(
                      color:
                          const Color(0xFFF8FAFC),
                      borderRadius:
                          BorderRadius.circular(10),
                    ),
                    child: Text(
                      'Admin note: $adminNote',
                      style: const TextStyle(
                        color: Color(0xFF475569),
                        fontSize: 12,
                        height: 1.4,
                      ),
                    ),
                  ),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
}
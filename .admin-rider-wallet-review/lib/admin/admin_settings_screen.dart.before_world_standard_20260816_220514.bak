import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

import '../login_screen.dart';

class AdminSettingsScreen extends StatefulWidget {
  const AdminSettingsScreen({
    super.key,
  });

  @override
  State<AdminSettingsScreen> createState() =>
      _AdminSettingsScreenState();
}

class _AdminSettingsScreenState
    extends State<AdminSettingsScreen> {
  static const String baseUrl =
      'https://api.servicepay.ng/api';

  static const Color primaryColor =
      Color(0xFF0F766E);

  static const Color backgroundColor =
      Color(0xFFF5F7FA);

  bool isLoading = true;
  bool isSaving = false;
  bool hasError = false;

  String errorMessage = '';

  String adminName = 'Admin';
  String adminEmail = '';
  String adminRole = 'HEAD_OFFICE';

  final TextEditingController applicationNameController =
      TextEditingController();

  final TextEditingController applicationSloganController =
      TextEditingController();

  final TextEditingController currencyController =
      TextEditingController();

  final TextEditingController currencySymbolController =
      TextEditingController();

  bool airtimeEnabled = true;
  bool dataEnabled = true;
  bool electricityEnabled = true;
  bool cableTvEnabled = true;
  bool examPinEnabled = true;
  bool ninVerificationEnabled = true;
  bool bvnVerificationEnabled = false;
  bool deliveryEnabled = true;
  bool walletFundingEnabled = true;
  bool servicepayTransferEnabled = true;
  bool bankTransferEnabled = false;
  bool flightBookingEnabled = false;
  bool notificationsEnabled = true;

  final TextEditingController minimumElectricityController =
      TextEditingController();

  final TextEditingController maximumElectricityController =
      TextEditingController();

  bool maintenanceMode = false;

  final TextEditingController maintenanceTitleController =
      TextEditingController();

  final TextEditingController maintenanceMessageController =
      TextEditingController();

  bool kycRequiredForRegistration = false;
  bool kycRequiredAfterRegistration = true;
  bool kycRequiredForWalletFunding = true;
  bool kycRequiredForServicepayTransfer = true;
  bool kycRequiredForBankTransfer = true;
  bool kycRequiredForHighValueTransactions = true;
  bool unverifiedCanUseBasicServices = true;

  String acceptedIdentityType = 'NIN_OR_BVN';

  final TextEditingController unverifiedDailyLimitController =
      TextEditingController();

  final TextEditingController highValueThresholdController =
      TextEditingController();

  final TextEditingController minimumAgeController =
      TextEditingController();

  bool registrationEnabled = true;
  bool requireEmail = false;
  bool requirePhoneVerification = false;
  bool requireEmailVerification = false;
  bool requireNinOrBvnAfterRegistration = true;
  bool allowReferralCode = true;

  String defaultCustomerStatus = 'ACTIVE';

  final TextEditingController minimumWalletFundingController =
      TextEditingController();

  final TextEditingController maximumWalletFundingController =
      TextEditingController();

  final TextEditingController minimumServicepayTransferController =
      TextEditingController();

  final TextEditingController maximumServicepayTransferController =
      TextEditingController();

  final TextEditingController dailyServicepayTransferLimitController =
      TextEditingController();

  final TextEditingController minimumBankTransferController =
      TextEditingController();

  final TextEditingController maximumBankTransferController =
      TextEditingController();

  final TextEditingController dailyBankTransferLimitController =
      TextEditingController();

  final TextEditingController minimumAirtimeController =
      TextEditingController();

  final TextEditingController maximumAirtimeController =
      TextEditingController();

  final TextEditingController maximumDataController =
      TextEditingController();

  final TextEditingController maximumElectricityPaymentController =
      TextEditingController();

  final TextEditingController maximumCableTvPaymentController =
      TextEditingController();

  final TextEditingController dailyCustomerTransactionLimitController =
      TextEditingController();

  final TextEditingController supportPhoneController =
      TextEditingController();

  final TextEditingController supportEmailController =
      TextEditingController();

  final TextEditingController whatsappController =
      TextEditingController();

  final TextEditingController officeAddressController =
      TextEditingController();

  final TextEditingController websiteUrlController =
      TextEditingController();

  final TextEditingController privacyPolicyUrlController =
      TextEditingController();

  final TextEditingController termsUrlController =
      TextEditingController();

  final TextEditingController supportFromController =
      TextEditingController();

  final TextEditingController supportToController =
      TextEditingController();

  final Set<String> supportDays = <String>{
    'MONDAY',
    'TUESDAY',
    'WEDNESDAY',
    'THURSDAY',
    'FRIDAY',
    'SATURDAY',
  };

  final TextEditingController minimumSupportedVersionController =
      TextEditingController();

  final TextEditingController latestVersionController =
      TextEditingController();

  final TextEditingController updateMessageController =
      TextEditingController();

  final TextEditingController androidUpdateUrlController =
      TextEditingController();

  final TextEditingController iosUpdateUrlController =
      TextEditingController();

  bool forceUpdate = false;

  @override
  void initState() {
    super.initState();

    loadLocalAdminDetails();
    loadSettings();
  }

  @override
  void dispose() {
    applicationNameController.dispose();
    applicationSloganController.dispose();
    currencyController.dispose();
    currencySymbolController.dispose();

    minimumElectricityController.dispose();
    maximumElectricityController.dispose();

    maintenanceTitleController.dispose();
    maintenanceMessageController.dispose();

    unverifiedDailyLimitController.dispose();
    highValueThresholdController.dispose();
    minimumAgeController.dispose();

    minimumWalletFundingController.dispose();
    maximumWalletFundingController.dispose();

    minimumServicepayTransferController.dispose();
    maximumServicepayTransferController.dispose();
    dailyServicepayTransferLimitController.dispose();

    minimumBankTransferController.dispose();
    maximumBankTransferController.dispose();
    dailyBankTransferLimitController.dispose();

    minimumAirtimeController.dispose();
    maximumAirtimeController.dispose();
    maximumDataController.dispose();

    maximumElectricityPaymentController.dispose();
    maximumCableTvPaymentController.dispose();
    dailyCustomerTransactionLimitController.dispose();

    supportPhoneController.dispose();
    supportEmailController.dispose();
    whatsappController.dispose();
    officeAddressController.dispose();
    websiteUrlController.dispose();
    privacyPolicyUrlController.dispose();
    termsUrlController.dispose();
    supportFromController.dispose();
    supportToController.dispose();

    minimumSupportedVersionController.dispose();
    latestVersionController.dispose();
    updateMessageController.dispose();
    androidUpdateUrlController.dispose();
    iosUpdateUrlController.dispose();

    super.dispose();
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

  bool toBool(
    dynamic value,
    bool fallback,
  ) {
    if (value is bool) {
      return value;
    }

    if (value?.toString().toLowerCase() == 'true') {
      return true;
    }

    if (value?.toString().toLowerCase() == 'false') {
      return false;
    }

    return fallback;
  }

  String formatNumber(
    dynamic value, {
    String fallback = '0',
  }) {
    if (value == null) {
      return fallback;
    }

    final double? amount = double.tryParse(
      value.toString(),
    );

    if (amount == null) {
      return fallback;
    }

    if (amount == amount.roundToDouble()) {
      return amount.toInt().toString();
    }

    return amount.toStringAsFixed(2);
  }

  double? parseAmount(
    TextEditingController controller,
  ) {
    final String text = controller.text
        .replaceAll(',', '')
        .trim();

    if (text.isEmpty) {
      return null;
    }

    return double.tryParse(text);
  }

  int? parseInteger(
    TextEditingController controller,
  ) {
    return int.tryParse(
      controller.text.trim(),
    );
  }

  Map<String, dynamic> decodeResponse(
    http.Response response,
  ) {
    final String rawBody = response.body.trim();

    if (rawBody.isEmpty) {
      return <String, dynamic>{
        'success': false,
        'message':
            'The server returned an empty response.',
      };
    }

    try {
      final dynamic decoded = jsonDecode(
        rawBody,
      );

      if (decoded is Map) {
        return Map<String, dynamic>.from(
          decoded,
        );
      }
    } catch (_) {
      // Return standard response below.
    }

    return <String, dynamic>{
      'success': false,
      'message':
          'The server returned an invalid response.',
    };
  }

  String getMessage(
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

  Future<String?> getAdminToken() async {
    final SharedPreferences preferences =
        await SharedPreferences.getInstance();

    final String? rawToken =
        preferences.getString('auth_token') ??
            preferences.getString('token') ??
            preferences.getString('admin_token');

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

  Future<void> loadLocalAdminDetails() async {
    final SharedPreferences preferences =
        await SharedPreferences.getInstance();

    if (!mounted) {
      return;
    }

    setState(() {
      adminName =
          preferences.getString('full_name') ??
              preferences.getString('user_name') ??
              preferences.getString('name') ??
              'Admin';

      adminEmail =
          preferences.getString('user_email') ??
              preferences.getString('email') ??
              '';

      adminRole =
          preferences.getString('user_role') ??
              preferences.getString('role') ??
              'HEAD_OFFICE';
    });
  }

  void showMessage(
    String message, {
    bool isError = false,
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
          backgroundColor: isError
              ? const Color(0xFFDC2626)
              : primaryColor,
        ),
      );
  }

  Future<void> loadSettings() async {
    if (mounted) {
      setState(() {
        isLoading = true;
        hasError = false;
        errorMessage = '';
      });
    }

    try {
      final String? token = await getAdminToken();

      if (token == null) {
        throw Exception(
          'Admin session has expired. Please sign in again.',
        );
      }

      final http.Response response = await http
          .get(
            Uri.parse(
              '$baseUrl/settings/admin',
            ),
            headers: <String, String>{
              'Accept': 'application/json',
              'Authorization': 'Bearer $token',
            },
          )
          .timeout(
            const Duration(seconds: 45),
          );

      final Map<String, dynamic> body =
          decodeResponse(response);

      final bool successful =
          response.statusCode >= 200 &&
          response.statusCode < 300 &&
          body['success'] == true;

      if (!successful) {
        throw Exception(
          getMessage(
            body,
            fallback:
                'Unable to load admin settings.',
          ),
        );
      }

      final Map<String, dynamic> data =
          toMap(body['data']);

      final Map<String, dynamic> settings =
          toMap(
        body['settings'] ?? data['settings'],
      );

      if (settings.isEmpty) {
        throw Exception(
          'The server returned incomplete settings.',
        );
      }

      final Map<String, dynamic> services =
          toMap(settings['services']);

      final Map<String, dynamic> electricity =
          toMap(settings['electricity']);

      final Map<String, dynamic> platform =
          toMap(settings['platform']);

      final Map<String, dynamic> kyc =
          toMap(settings['kyc']);

      final Map<String, dynamic> registration =
          toMap(settings['registration']);

      final Map<String, dynamic> limits =
          toMap(settings['transactionLimits']);

      final Map<String, dynamic> support =
          toMap(settings['support']);

      final Map<String, dynamic> appVersion =
          toMap(settings['appVersion']);

      if (!mounted) {
        return;
      }

      setState(() {
        applicationNameController.text =
            settings['applicationName']
                    ?.toString() ??
                'ServicePay';

        applicationSloganController.text =
            settings['applicationSlogan']
                    ?.toString() ??
                'One Platform, Many Solutions.';

        currencyController.text =
            settings['currency']?.toString() ??
                'NGN';

        currencySymbolController.text =
            settings['currencySymbol']
                    ?.toString() ??
                '₦';

        airtimeEnabled = toBool(
          services['airtime'] ??
              services['airtimeEnabled'],
          true,
        );

        dataEnabled = toBool(
          services['data'] ??
              services['dataEnabled'],
          true,
        );

        electricityEnabled = toBool(
          services['electricity'] ??
              services['electricityEnabled'],
          true,
        );

        cableTvEnabled = toBool(
          services['cableTv'],
          true,
        );

        examPinEnabled = toBool(
          services['examPin'],
          true,
        );

        ninVerificationEnabled = toBool(
          services['ninVerification'] ??
              services['ninVerificationEnabled'],
          true,
        );

        bvnVerificationEnabled = toBool(
          services['bvnVerification'],
          false,
        );

        deliveryEnabled = toBool(
          services['delivery'],
          true,
        );

        walletFundingEnabled = toBool(
          services['walletFunding'],
          true,
        );

        servicepayTransferEnabled = toBool(
          services['servicepayTransfer'],
          true,
        );

        bankTransferEnabled = toBool(
          services['bankTransfer'],
          false,
        );

        flightBookingEnabled = toBool(
          services['flightBooking'],
          false,
        );

        notificationsEnabled = toBool(
          services['notifications'],
          true,
        );

        minimumElectricityController.text =
            formatNumber(
          electricity['minimumAmount'],
          fallback: '1000',
        );

        maximumElectricityController.text =
            formatNumber(
          electricity['maximumAmount'],
          fallback: '200000',
        );

        maintenanceMode = toBool(
          platform['maintenanceMode'],
          false,
        );

        maintenanceTitleController.text =
            platform['maintenanceTitle']
                    ?.toString() ??
                'ServicePay Maintenance';

        maintenanceMessageController.text =
            platform['maintenanceMessage']
                    ?.toString() ??
                'ServicePay is temporarily unavailable.';

        kycRequiredForRegistration = toBool(
          kyc['requiredForRegistration'],
          false,
        );

        kycRequiredAfterRegistration = toBool(
          kyc['requiredAfterRegistration'],
          true,
        );

        kycRequiredForWalletFunding = toBool(
          kyc['requiredForWalletFunding'],
          true,
        );

        kycRequiredForServicepayTransfer =
            toBool(
          kyc['requiredForServicepayTransfer'],
          true,
        );

        kycRequiredForBankTransfer = toBool(
          kyc['requiredForBankTransfer'],
          true,
        );

        kycRequiredForHighValueTransactions =
            toBool(
          kyc[
              'requiredForHighValueTransactions'],
          true,
        );

        unverifiedCanUseBasicServices = toBool(
          kyc[
              'unverifiedCustomerCanUseBasicServices'],
          true,
        );

        acceptedIdentityType =
            kyc['acceptedIdentityType']
                    ?.toString()
                    .toUpperCase() ??
                'NIN_OR_BVN';

        unverifiedDailyLimitController.text =
            formatNumber(
          kyc['unverifiedCustomerDailyLimit'],
          fallback: '5000',
        );

        highValueThresholdController.text =
            formatNumber(
          kyc['highValueTransactionThreshold'],
          fallback: '50000',
        );

        minimumAgeController.text =
            formatNumber(
          kyc['minimumAge'],
          fallback: '18',
        );
        registrationEnabled = toBool(
          registration['registrationEnabled'],
          true,
        );

        requireEmail = toBool(
          registration['requireEmail'],
          false,
        );

        requirePhoneVerification = toBool(
          registration['requirePhoneVerification'],
          false,
        );

        requireEmailVerification = toBool(
          registration['requireEmailVerification'],
          false,
        );

        requireNinOrBvnAfterRegistration =
            toBool(
          registration[
              'requireNinOrBvnAfterRegistration'],
          true,
        );

        allowReferralCode = toBool(
          registration['allowReferralCode'],
          true,
        );

        defaultCustomerStatus =
            registration['defaultCustomerStatus']
                    ?.toString()
                    .toUpperCase() ??
                'ACTIVE';

        minimumWalletFundingController.text =
            formatNumber(
          limits['minimumWalletFunding'],
          fallback: '100',
        );

        maximumWalletFundingController.text =
            formatNumber(
          limits['maximumWalletFunding'],
          fallback: '500000',
        );

        minimumServicepayTransferController
                .text =
            formatNumber(
          limits['minimumServicepayTransfer'],
          fallback: '100',
        );

        maximumServicepayTransferController
                .text =
            formatNumber(
          limits['maximumServicepayTransfer'],
          fallback: '500000',
        );

        dailyServicepayTransferLimitController
                .text =
            formatNumber(
          limits[
              'dailyServicepayTransferLimit'],
          fallback: '1000000',
        );

        minimumBankTransferController.text =
            formatNumber(
          limits['minimumBankTransfer'],
          fallback: '100',
        );

        maximumBankTransferController.text =
            formatNumber(
          limits['maximumBankTransfer'],
          fallback: '50000',
        );

        dailyBankTransferLimitController.text =
            formatNumber(
          limits['dailyBankTransferLimit'],
          fallback: '200000',
        );

        minimumAirtimeController.text =
            formatNumber(
          limits['minimumAirtimePurchase'],
          fallback: '50',
        );

        maximumAirtimeController.text =
            formatNumber(
          limits['maximumAirtimePurchase'],
          fallback: '50000',
        );

        maximumDataController.text =
            formatNumber(
          limits['maximumDataPurchase'],
          fallback: '100000',
        );

        maximumElectricityPaymentController
                .text =
            formatNumber(
          limits['maximumElectricityPayment'],
          fallback: '200000',
        );

        maximumCableTvPaymentController.text =
            formatNumber(
          limits['maximumCableTvPayment'],
          fallback: '200000',
        );

        dailyCustomerTransactionLimitController
                .text =
            formatNumber(
          limits[
              'dailyCustomerTransactionLimit'],
          fallback: '1000000',
        );

        supportPhoneController.text =
            (support['supportPhone'] ??
                    support['phone'] ??
                    '')
                .toString();

        supportEmailController.text =
            (support['supportEmail'] ??
                    support['email'] ??
                    'support@servicepay.ng')
                .toString();

        whatsappController.text =
            support['whatsappNumber']
                    ?.toString() ??
                '';

        officeAddressController.text =
            support['officeAddress']
                    ?.toString() ??
                '';

        websiteUrlController.text =
            support['websiteUrl']
                    ?.toString() ??
                'https://servicepay.ng';

        privacyPolicyUrlController.text =
            support['privacyPolicyUrl']
                    ?.toString() ??
                '';

        termsUrlController.text =
            support['termsAndConditionsUrl']
                    ?.toString() ??
                '';

        supportFromController.text =
            support['supportAvailableFrom']
                    ?.toString() ??
                '08:00';

        supportToController.text =
            support['supportAvailableTo']
                    ?.toString() ??
                '18:00';

        supportDays.clear();

        final dynamic rawDays =
            support['supportDays'];

        if (rawDays is List) {
          supportDays.addAll(
            rawDays
                .map(
                  (dynamic day) => day
                      .toString()
                      .trim()
                      .toUpperCase(),
                )
                .where(
                  (String day) =>
                      day.isNotEmpty,
                ),
          );
        }

        if (supportDays.isEmpty) {
          supportDays.addAll(
            <String>{
              'MONDAY',
              'TUESDAY',
              'WEDNESDAY',
              'THURSDAY',
              'FRIDAY',
              'SATURDAY',
            },
          );
        }

        minimumSupportedVersionController
                .text =
            appVersion[
                        'minimumSupportedVersion']
                    ?.toString() ??
                '1.0.0';

        latestVersionController.text =
            appVersion['latestVersion']
                    ?.toString() ??
                '1.0.0';

        forceUpdate = toBool(
          appVersion['forceUpdate'],
          false,
        );

        updateMessageController.text =
            appVersion['updateMessage']
                    ?.toString() ??
                'A new version of ServicePay is available.';

        androidUpdateUrlController.text =
            appVersion['androidUpdateUrl']
                    ?.toString() ??
                '';

        iosUpdateUrlController.text =
            appVersion['iosUpdateUrl']
                    ?.toString() ??
                '';

        isLoading = false;
        hasError = false;
      });
    } on TimeoutException {
      if (!mounted) {
        return;
      }

      setState(() {
        isLoading = false;
        hasError = true;
        errorMessage =
            'The settings request timed out. Please try again.';
      });
    } catch (error) {
      if (!mounted) {
        return;
      }

      setState(() {
        isLoading = false;
        hasError = true;
        errorMessage = error
            .toString()
            .replaceFirst(
              'Exception: ',
              '',
            );
      });
    }
  }

  bool validateAmountPair({
    required TextEditingController minimum,
    required TextEditingController maximum,
    required String title,
  }) {
    final double? minimumValue =
        parseAmount(minimum);

    final double? maximumValue =
        parseAmount(maximum);

    if (minimumValue == null ||
        minimumValue < 0) {
      showMessage(
        'Enter a valid minimum $title amount.',
        isError: true,
      );

      return false;
    }

    if (maximumValue == null ||
        maximumValue < minimumValue) {
      showMessage(
        'Maximum $title amount must not be less than the minimum.',
        isError: true,
      );

      return false;
    }

    return true;
  }

  bool validateSettings() {
    if (applicationNameController.text
        .trim()
        .isEmpty) {
      showMessage(
        'Application name is required.',
        isError: true,
      );

      return false;
    }

    if (!validateAmountPair(
      minimum: minimumElectricityController,
      maximum: maximumElectricityController,
      title: 'electricity',
    )) {
      return false;
    }

    if (!validateAmountPair(
      minimum:
          minimumWalletFundingController,
      maximum:
          maximumWalletFundingController,
      title: 'wallet funding',
    )) {
      return false;
    }

    if (!validateAmountPair(
      minimum:
          minimumServicepayTransferController,
      maximum:
          maximumServicepayTransferController,
      title: 'ServicePay transfer',
    )) {
      return false;
    }

    if (!validateAmountPair(
      minimum:
          minimumBankTransferController,
      maximum:
          maximumBankTransferController,
      title: 'bank transfer',
    )) {
      return false;
    }

    final int? minimumAge =
        parseInteger(minimumAgeController);

    if (minimumAge == null ||
        minimumAge < 0 ||
        minimumAge > 100) {
      showMessage(
        'Minimum KYC age must be between 0 and 100.',
        isError: true,
      );

      return false;
    }

    if (supportPhoneController.text
        .trim()
        .isEmpty) {
      showMessage(
        'Support phone number is required.',
        isError: true,
      );

      return false;
    }

    final String email =
        supportEmailController.text
            .trim()
            .toLowerCase();

    if (!RegExp(
      r'^[^\s@]+@[^\s@]+\.[^\s@]+$',
    ).hasMatch(email)) {
      showMessage(
        'Enter a valid support email address.',
        isError: true,
      );

      return false;
    }

    if (supportDays.isEmpty) {
      showMessage(
        'Select at least one support day.',
        isError: true,
      );

      return false;
    }

    return true;
  }

  Future<String?> requestSaveReason() async {
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
              title: const Text(
                'Save Admin Settings',
                style: TextStyle(
                  fontWeight:
                      FontWeight.w900,
                ),
              ),
              content: Column(
                mainAxisSize:
                    MainAxisSize.min,
                children: <Widget>[
                  const Text(
                    'Enter the reason for changing ServicePay settings. This action will be saved in the audit log.',
                  ),
                  const SizedBox(height: 16),
                  TextField(
                    controller: controller,
                    autofocus: true,
                    minLines: 3,
                    maxLines: 5,
                    maxLength: 500,
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
                        primaryColor,
                  ),
                  child:
                      const Text('Save'),
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

  Future<void> saveSettings() async {
    FocusScope.of(context).unfocus();

    if (!validateSettings()) {
      return;
    }

    final String? reason =
        await requestSaveReason();

    if (reason == null) {
      return;
    }

    if (!mounted) {
      return;
    }

    setState(() {
      isSaving = true;
    });

    try {
      final String? token =
          await getAdminToken();

      if (token == null) {
        throw Exception(
          'Admin session has expired. Please sign in again.',
        );
      }

      final Map<String, dynamic>
          requestBody =
          <String, dynamic>{
        'reason': reason,
        'applicationName':
            applicationNameController.text
                .trim(),
        'applicationSlogan':
            applicationSloganController.text
                .trim(),
        'currency': currencyController.text
            .trim()
            .toUpperCase(),
        'currencySymbol':
            currencySymbolController.text
                .trim(),
        'services': <String, dynamic>{
          'airtime': airtimeEnabled,
          'data': dataEnabled,
          'electricity':
              electricityEnabled,
          'cableTv': cableTvEnabled,
          'examPin': examPinEnabled,
          'ninVerification':
              ninVerificationEnabled,
          'bvnVerification':
              bvnVerificationEnabled,
          'delivery': deliveryEnabled,
          'walletFunding':
              walletFundingEnabled,
          'servicepayTransfer':
              servicepayTransferEnabled,
          'bankTransfer':
              bankTransferEnabled,
          'flightBooking':
              flightBookingEnabled,
          'notifications':
              notificationsEnabled,
        },
        'electricity':
            <String, dynamic>{
          'minimumAmount': parseAmount(
            minimumElectricityController,
          ),
          'maximumAmount': parseAmount(
            maximumElectricityController,
          ),
        },
        'platform': <String, dynamic>{
          'maintenanceMode':
              maintenanceMode,
          'maintenanceTitle':
              maintenanceTitleController.text
                  .trim(),
          'maintenanceMessage':
              maintenanceMessageController
                  .text
                  .trim(),
        },
        'kyc': <String, dynamic>{
          'requiredForRegistration':
              kycRequiredForRegistration,
          'requiredAfterRegistration':
              kycRequiredAfterRegistration,
          'requiredForWalletFunding':
              kycRequiredForWalletFunding,
          'requiredForServicepayTransfer':
              kycRequiredForServicepayTransfer,
          'requiredForBankTransfer':
              kycRequiredForBankTransfer,
          'requiredForHighValueTransactions':
              kycRequiredForHighValueTransactions,
          'acceptedIdentityType':
              acceptedIdentityType,
          'unverifiedCustomerCanUseBasicServices':
              unverifiedCanUseBasicServices,
          'unverifiedCustomerDailyLimit':
              parseAmount(
            unverifiedDailyLimitController,
          ),
          'highValueTransactionThreshold':
              parseAmount(
            highValueThresholdController,
          ),
          'minimumAge': parseInteger(
            minimumAgeController,
          ),
        },
        'registration':
            <String, dynamic>{
          'registrationEnabled':
              registrationEnabled,
          'requireEmail': requireEmail,
          'requirePhoneVerification':
              requirePhoneVerification,
          'requireEmailVerification':
              requireEmailVerification,
          'requireNinOrBvnAfterRegistration':
              requireNinOrBvnAfterRegistration,
          'allowReferralCode':
              allowReferralCode,
          'defaultCustomerStatus':
              defaultCustomerStatus,
        },
        'transactionLimits':
            <String, dynamic>{
          'minimumWalletFunding':
              parseAmount(
            minimumWalletFundingController,
          ),
          'maximumWalletFunding':
              parseAmount(
            maximumWalletFundingController,
          ),
          'minimumServicepayTransfer':
              parseAmount(
            minimumServicepayTransferController,
          ),
          'maximumServicepayTransfer':
              parseAmount(
            maximumServicepayTransferController,
          ),
          'dailyServicepayTransferLimit':
              parseAmount(
            dailyServicepayTransferLimitController,
          ),
          'minimumBankTransfer':
              parseAmount(
            minimumBankTransferController,
          ),
          'maximumBankTransfer':
              parseAmount(
            maximumBankTransferController,
          ),
          'dailyBankTransferLimit':
              parseAmount(
            dailyBankTransferLimitController,
          ),
          'minimumAirtimePurchase':
              parseAmount(
            minimumAirtimeController,
          ),
          'maximumAirtimePurchase':
              parseAmount(
            maximumAirtimeController,
          ),
          'maximumDataPurchase':
              parseAmount(
            maximumDataController,
          ),
          'maximumElectricityPayment':
              parseAmount(
            maximumElectricityPaymentController,
          ),
          'maximumCableTvPayment':
              parseAmount(
            maximumCableTvPaymentController,
          ),
          'dailyCustomerTransactionLimit':
              parseAmount(
            dailyCustomerTransactionLimitController,
          ),
        },
        'support': <String, dynamic>{
          'supportPhone':
              supportPhoneController.text
                  .trim(),
          'supportEmail':
              supportEmailController.text
                  .trim()
                  .toLowerCase(),
          'whatsappNumber':
              whatsappController.text
                  .trim(),
          'officeAddress':
              officeAddressController.text
                  .trim(),
          'websiteUrl':
              websiteUrlController.text
                  .trim(),
          'privacyPolicyUrl':
              privacyPolicyUrlController.text
                  .trim(),
          'termsAndConditionsUrl':
              termsUrlController.text
                  .trim(),
          'supportAvailableFrom':
              supportFromController.text
                  .trim(),
          'supportAvailableTo':
              supportToController.text
                  .trim(),
          'supportDays':
              supportDays.toList(),
        },
        'appVersion': <String, dynamic>{
          'minimumSupportedVersion':
              minimumSupportedVersionController
                  .text
                  .trim(),
          'latestVersion':
              latestVersionController.text
                  .trim(),
          'forceUpdate': forceUpdate,
          'updateMessage':
              updateMessageController.text
                  .trim(),
          'androidUpdateUrl':
              androidUpdateUrlController.text
                  .trim(),
          'iosUpdateUrl':
              iosUpdateUrlController.text
                  .trim(),
        },
      };

      final http.Response response =
          await http
              .put(
                Uri.parse(
                  '$baseUrl/settings/admin',
                ),
                headers:
                    <String, String>{
                  'Accept':
                      'application/json',
                  'Content-Type':
                      'application/json',
                  'Authorization':
                      'Bearer $token',
                },
                body: jsonEncode(
                  requestBody,
                ),
              )
              .timeout(
                const Duration(
                  seconds: 60,
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
          getMessage(
            body,
            fallback:
                'Unable to save admin settings.',
          ),
        );
      }

      showMessage(
        getMessage(
          body,
          fallback:
              'Admin settings saved successfully.',
        ),
      );

      await loadSettings();
    } on TimeoutException {
      showMessage(
        'The save request timed out. Check the settings before trying again.',
        isError: true,
      );
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
          isSaving = false;
        });
      }
    }
  }

  Future<void> logout() async {
    final bool? confirmed =
        await showDialog<bool>(
      context: context,
      builder: (
        BuildContext dialogContext,
      ) {
        return AlertDialog(
          title: const Text(
            'Log Out',
          ),
          content: const Text(
            'Are you sure you want to log out of ServicePay Admin?',
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
              style:
                  FilledButton.styleFrom(
                backgroundColor:
                    const Color(
                  0xFFDC2626,
                ),
              ),
              child:
                  const Text('Log Out'),
            ),
          ],
        );
      },
    );

    if (confirmed != true) {
      return;
    }

    final SharedPreferences preferences =
        await SharedPreferences.getInstance();

    await preferences.clear();

    if (!mounted) {
      return;
    }

    Navigator.of(context).pushAndRemoveUntil(
      MaterialPageRoute<void>(
        builder: (_) =>
            const LoginScreen(),
      ),
      (
        Route<dynamic> route,
      ) =>
          false,
    );
  }

  Widget sectionTitle(
    String title,
    IconData icon,
  ) {
    return Padding(
      padding:
          const EdgeInsets.only(
        top: 22,
        bottom: 10,
      ),
      child: Row(
        children: <Widget>[
          Icon(
            icon,
            size: 21,
            color: primaryColor,
          ),
          const SizedBox(width: 9),
          Text(
            title,
            style: const TextStyle(
              color:
                  Color(0xFF0F172A),
              fontSize: 17,
              fontWeight:
                  FontWeight.w900,
            ),
          ),
        ],
      ),
    );
  }

  Widget settingsCard({
    required List<Widget> children,
  }) {
    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius:
            BorderRadius.circular(18),
        border: Border.all(
          color:
              const Color(0xFFE2E8F0),
        ),
      ),
      child: Column(
        children: children,
      ),
    );
  }

  Widget switchTile({
    required IconData icon,
    required String title,
    required String subtitle,
    required bool value,
    required ValueChanged<bool>
        onChanged,
    Color iconColor = primaryColor,
    bool showDivider = true,
  }) {
    return Container(
      decoration: BoxDecoration(
        border: showDivider
            ? const Border(
                bottom: BorderSide(
                  color:
                      Color(0xFFE2E8F0),
                ),
              )
            : null,
      ),
      child: SwitchListTile(
        value: value,
        onChanged:
            isSaving ? null : onChanged,
        activeThumbColor: primaryColor,
        secondary: Container(
          width: 43,
          height: 43,
          decoration: BoxDecoration(
            color: iconColor.withValues(
              alpha: 0.10,
            ),
            borderRadius:
                BorderRadius.circular(13),
          ),
          child: Icon(
            icon,
            color: iconColor,
          ),
        ),
        title: Text(
          title,
          style: const TextStyle(
            color:
                Color(0xFF0F172A),
            fontWeight:
                FontWeight.w800,
          ),
        ),
        subtitle: Text(
          subtitle,
          style: const TextStyle(
            color:
                Color(0xFF64748B),
            fontSize: 12,
          ),
        ),
      ),
    );
  }

  Widget textField({
    required TextEditingController
        controller,
    required String label,
    required IconData icon,
    TextInputType? keyboardType,
    int maxLines = 1,
    String? prefixText,
  }) {
    return TextField(
      controller: controller,
      enabled: !isSaving,
      keyboardType: keyboardType,
      maxLines: maxLines,
      inputFormatters:
          keyboardType ==
                  const TextInputType
                      .numberWithOptions(
                    decimal: true,
                  )
              ? <TextInputFormatter>[
                  FilteringTextInputFormatter
                      .allow(
                    RegExp(
                      r'^\d*\.?\d{0,2}',
                    ),
                  ),
                ]
              : null,
      decoration: InputDecoration(
        labelText: label,
        prefixIcon: Icon(icon),
        prefixText: prefixText,
        border: OutlineInputBorder(
          borderRadius:
              BorderRadius.circular(14),
        ),
      ),
    );
  }

  Widget twoAmountFields({
    required TextEditingController first,
    required TextEditingController second,
    required String firstLabel,
    required String secondLabel,
  }) {
    return LayoutBuilder(
      builder: (
        BuildContext context,
        BoxConstraints constraints,
      ) {
        final bool useRow =
            constraints.maxWidth >= 650;

        final Widget firstField =
            textField(
          controller: first,
          label: firstLabel,
          icon:
              Icons.arrow_downward_rounded,
          keyboardType:
              const TextInputType
                  .numberWithOptions(
            decimal: true,
          ),
          prefixText: '₦ ',
        );

        final Widget secondField =
            textField(
          controller: second,
          label: secondLabel,
          icon:
              Icons.arrow_upward_rounded,
          keyboardType:
              const TextInputType
                  .numberWithOptions(
            decimal: true,
          ),
          prefixText: '₦ ',
        );

        if (useRow) {
          return Row(
            children: <Widget>[
              Expanded(child: firstField),
              const SizedBox(width: 14),
              Expanded(
                child: secondField,
              ),
            ],
          );
        }

        return Column(
          children: <Widget>[
            firstField,
            const SizedBox(height: 14),
            secondField,
          ],
        );
      },
    );
  }
  @override
  Widget build(
    BuildContext context,
  ) {
    return Scaffold(
      backgroundColor: backgroundColor,
      appBar: AppBar(
        backgroundColor: primaryColor,
        foregroundColor: Colors.white,
        title: const Text(
          'Admin Settings',
          style: TextStyle(
            fontWeight: FontWeight.w900,
          ),
        ),
        actions: <Widget>[
          IconButton(
            tooltip: 'Refresh',
            onPressed:
                isLoading || isSaving
                    ? null
                    : loadSettings,
            icon: const Icon(
              Icons.refresh_rounded,
            ),
          ),
        ],
      ),
      body: isLoading
          ? const Center(
              child:
                  CircularProgressIndicator(
                color: primaryColor,
              ),
            )
          : hasError
              ? buildErrorState()
              : buildSettingsContent(),
    );
  }

  Widget buildErrorState() {
    return Center(
      child: SingleChildScrollView(
        padding:
            const EdgeInsets.all(24),
        child: Column(
          children: <Widget>[
            const Icon(
              Icons.cloud_off_rounded,
              color: Color(0xFFDC2626),
              size: 65,
            ),
            const SizedBox(height: 17),
            const Text(
              'Unable to Load Settings',
              textAlign: TextAlign.center,
              style: TextStyle(
                fontSize: 21,
                fontWeight:
                    FontWeight.w900,
              ),
            ),
            const SizedBox(height: 8),
            Text(
              errorMessage,
              textAlign: TextAlign.center,
              style: const TextStyle(
                color: Color(0xFF64748B),
                height: 1.5,
              ),
            ),
            const SizedBox(height: 22),
            FilledButton.icon(
              onPressed: loadSettings,
              style:
                  FilledButton.styleFrom(
                backgroundColor:
                    primaryColor,
              ),
              icon: const Icon(
                Icons.refresh_rounded,
              ),
              label:
                  const Text('Try Again'),
            ),
          ],
        ),
      ),
    );
  }

  Widget buildSettingsContent() {
    return RefreshIndicator(
      color: primaryColor,
      onRefresh: loadSettings,
      child: LayoutBuilder(
        builder: (
          BuildContext context,
          BoxConstraints constraints,
        ) {
          final double contentWidth =
              constraints.maxWidth > 1050
                  ? 1000
                  : double.infinity;

          return ListView(
            physics:
                const AlwaysScrollableScrollPhysics(),
            padding:
                const EdgeInsets.fromLTRB(
              16,
              16,
              16,
              40,
            ),
            children: <Widget>[
              Align(
                alignment:
                    Alignment.topCenter,
                child: SizedBox(
                  width: contentWidth,
                  child: Column(
                    crossAxisAlignment:
                        CrossAxisAlignment.start,
                    children: <Widget>[
                      buildHeader(),

                      sectionTitle(
                        'General Application',
                        Icons.apps_rounded,
                      ),

                      settingsCard(
                        children: <Widget>[
                          Padding(
                            padding:
                                const EdgeInsets.all(
                              16,
                            ),
                            child: Column(
                              children: <Widget>[
                                textField(
                                  controller:
                                      applicationNameController,
                                  label:
                                      'Application Name',
                                  icon: Icons
                                      .business_rounded,
                                ),
                                const SizedBox(
                                  height: 14,
                                ),
                                textField(
                                  controller:
                                      applicationSloganController,
                                  label:
                                      'Application Slogan',
                                  icon: Icons
                                      .campaign_outlined,
                                ),
                                const SizedBox(
                                  height: 14,
                                ),
                                Row(
                                  children: <Widget>[
                                    Expanded(
                                      child:
                                          textField(
                                        controller:
                                            currencyController,
                                        label:
                                            'Currency',
                                        icon: Icons
                                            .payments_outlined,
                                      ),
                                    ),
                                    const SizedBox(
                                      width: 12,
                                    ),
                                    Expanded(
                                      child:
                                          textField(
                                        controller:
                                            currencySymbolController,
                                        label:
                                            'Currency Symbol',
                                        icon: Icons
                                            .currency_exchange,
                                      ),
                                    ),
                                  ],
                                ),
                              ],
                            ),
                          ),
                        ],
                      ),

                      sectionTitle(
                        'Service Availability',
                        Icons.toggle_on_rounded,
                      ),

                      settingsCard(
                        children: <Widget>[
                          switchTile(
                            icon: Icons
                                .phone_android_rounded,
                            title: 'Airtime',
                            subtitle:
                                'Allow customers to buy airtime.',
                            value: airtimeEnabled,
                            onChanged: (
                              bool value,
                            ) {
                              setState(() {
                                airtimeEnabled =
                                    value;
                              });
                            },
                          ),
                          switchTile(
                            icon:
                                Icons.wifi_rounded,
                            title: 'Data',
                            subtitle:
                                'Allow customers to buy data bundles.',
                            value: dataEnabled,
                            onChanged: (
                              bool value,
                            ) {
                              setState(() {
                                dataEnabled = value;
                              });
                            },
                          ),
                          switchTile(
                            icon: Icons
                                .electric_bolt_rounded,
                            title: 'Electricity',
                            subtitle:
                                'Allow electricity bill payments.',
                            value:
                                electricityEnabled,
                            onChanged: (
                              bool value,
                            ) {
                              setState(() {
                                electricityEnabled =
                                    value;
                              });
                            },
                          ),
                          switchTile(
                            icon:
                                Icons.live_tv_rounded,
                            title: 'Cable TV',
                            subtitle:
                                'Allow DStv, GOtv and other TV payments.',
                            value: cableTvEnabled,
                            onChanged: (
                              bool value,
                            ) {
                              setState(() {
                                cableTvEnabled =
                                    value;
                              });
                            },
                          ),
                          switchTile(
                            icon: Icons
                                .workspace_premium_rounded,
                            title: 'Exam PIN',
                            subtitle:
                                'Allow exam PIN purchases.',
                            value: examPinEnabled,
                            onChanged: (
                              bool value,
                            ) {
                              setState(() {
                                examPinEnabled =
                                    value;
                              });
                            },
                          ),
                          switchTile(
                            icon: Icons
                                .fingerprint_rounded,
                            title:
                                'NIN Verification',
                            subtitle:
                                'Allow NIN verification services.',
                            value:
                                ninVerificationEnabled,
                            onChanged: (
                              bool value,
                            ) {
                              setState(() {
                                ninVerificationEnabled =
                                    value;
                              });
                            },
                          ),
                          switchTile(
                            icon:
                                Icons.badge_outlined,
                            title:
                                'BVN Verification',
                            subtitle:
                                'Allow BVN verification when provider access is available.',
                            value:
                                bvnVerificationEnabled,
                            onChanged: (
                              bool value,
                            ) {
                              setState(() {
                                bvnVerificationEnabled =
                                    value;
                              });
                            },
                          ),
                          switchTile(
                            icon: Icons
                                .local_shipping_rounded,
                            title: 'Delivery',
                            subtitle:
                                'Allow logistics and delivery requests.',
                            value: deliveryEnabled,
                            onChanged: (
                              bool value,
                            ) {
                              setState(() {
                                deliveryEnabled =
                                    value;
                              });
                            },
                          ),
                          switchTile(
                            icon: Icons
                                .account_balance_wallet_rounded,
                            title: 'Wallet Funding',
                            subtitle:
                                'Allow customers to fund their wallets.',
                            value:
                                walletFundingEnabled,
                            onChanged: (
                              bool value,
                            ) {
                              setState(() {
                                walletFundingEnabled =
                                    value;
                              });
                            },
                          ),
                          switchTile(
                            icon:
                                Icons.send_rounded,
                            title:
                                'ServicePay Transfer',
                            subtitle:
                                'Allow wallet-to-wallet transfers.',
                            value:
                                servicepayTransferEnabled,
                            onChanged: (
                              bool value,
                            ) {
                              setState(() {
                                servicepayTransferEnabled =
                                    value;
                              });
                            },
                          ),
                          switchTile(
                            icon: Icons
                                .account_balance_rounded,
                            title: 'Bank Transfer',
                            subtitle:
                                'Allow transfers to Nigerian bank accounts.',
                            value:
                                bankTransferEnabled,
                            iconColor:
                                const Color(
                              0xFF2563EB,
                            ),
                            onChanged: (
                              bool value,
                            ) {
                              setState(() {
                                bankTransferEnabled =
                                    value;
                              });
                            },
                          ),
                          switchTile(
                            icon: Icons
                                .flight_takeoff_rounded,
                            title: 'Flight Booking',
                            subtitle:
                                'Allow flight-booking services.',
                            value:
                                flightBookingEnabled,
                            onChanged: (
                              bool value,
                            ) {
                              setState(() {
                                flightBookingEnabled =
                                    value;
                              });
                            },
                          ),
                          switchTile(
                            icon: Icons
                                .notifications_rounded,
                            title: 'Notifications',
                            subtitle:
                                'Allow customer notifications.',
                            value:
                                notificationsEnabled,
                            showDivider: false,
                            onChanged: (
                              bool value,
                            ) {
                              setState(() {
                                notificationsEnabled =
                                    value;
                              });
                            },
                          ),
                        ],
                      ),

                      sectionTitle(
                        'Electricity Limits',
                        Icons
                            .electric_meter_outlined,
                      ),

                      settingsCard(
                        children: <Widget>[
                          Padding(
                            padding:
                                const EdgeInsets.all(
                              16,
                            ),
                            child: twoAmountFields(
                              first:
                                  minimumElectricityController,
                              second:
                                  maximumElectricityController,
                              firstLabel:
                                  'Minimum Electricity Amount',
                              secondLabel:
                                  'Maximum Electricity Amount',
                            ),
                          ),
                        ],
                      ),

                      sectionTitle(
                        'KYC Rules',
                        Icons
                            .verified_user_rounded,
                      ),

                      settingsCard(
                        children: <Widget>[
                          switchTile(
                            icon:
                                Icons.app_registration,
                            title:
                                'KYC During Registration',
                            subtitle:
                                'Require NIN or BVN before registration completes.',
                            value:
                                kycRequiredForRegistration,
                            onChanged: (
                              bool value,
                            ) {
                              setState(() {
                                kycRequiredForRegistration =
                                    value;
                              });
                            },
                          ),
                          switchTile(
                            icon: Icons
                                .assignment_ind_outlined,
                            title:
                                'KYC After Registration',
                            subtitle:
                                'Prompt customers to complete KYC after registration.',
                            value:
                                kycRequiredAfterRegistration,
                            onChanged: (
                              bool value,
                            ) {
                              setState(() {
                                kycRequiredAfterRegistration =
                                    value;
                              });
                            },
                          ),
                          switchTile(
                            icon: Icons
                                .account_balance_wallet_outlined,
                            title:
                                'KYC for Wallet Funding',
                            subtitle:
                                'Require KYC before wallet funding.',
                            value:
                                kycRequiredForWalletFunding,
                            onChanged: (
                              bool value,
                            ) {
                              setState(() {
                                kycRequiredForWalletFunding =
                                    value;
                              });
                            },
                          ),
                          switchTile(
                            icon:
                                Icons.swap_horiz,
                            title:
                                'KYC for ServicePay Transfer',
                            subtitle:
                                'Require KYC before internal transfers.',
                            value:
                                kycRequiredForServicepayTransfer,
                            onChanged: (
                              bool value,
                            ) {
                              setState(() {
                                kycRequiredForServicepayTransfer =
                                    value;
                              });
                            },
                          ),
                          switchTile(
                            icon: Icons
                                .account_balance_rounded,
                            title:
                                'KYC for Bank Transfer',
                            subtitle:
                                'Require KYC before bank transfers.',
                            value:
                                kycRequiredForBankTransfer,
                            onChanged: (
                              bool value,
                            ) {
                              setState(() {
                                kycRequiredForBankTransfer =
                                    value;
                              });
                            },
                          ),
                          switchTile(
                            icon:
                                Icons.trending_up,
                            title:
                                'KYC for High-Value Transactions',
                            subtitle:
                                'Require enhanced verification above the threshold.',
                            value:
                                kycRequiredForHighValueTransactions,
                            onChanged: (
                              bool value,
                            ) {
                              setState(() {
                                kycRequiredForHighValueTransactions =
                                    value;
                              });
                            },
                          ),
                          switchTile(
                            icon: Icons
                                .shopping_bag_outlined,
                            title:
                                'Basic Services for Unverified Customers',
                            subtitle:
                                'Allow basic services within configured limits.',
                            value:
                                unverifiedCanUseBasicServices,
                            showDivider: false,
                            onChanged: (
                              bool value,
                            ) {
                              setState(() {
                                unverifiedCanUseBasicServices =
                                    value;
                              });
                            },
                          ),
                          Padding(
                            padding:
                                const EdgeInsets.all(
                              16,
                            ),
                            child: Column(
                              children: <Widget>[
                                DropdownButtonFormField<
                                    String>(
                                  initialValue:
                                      acceptedIdentityType,
                                  decoration:
                                      const InputDecoration(
                                    labelText:
                                        'Accepted Identity',
                                    prefixIcon: Icon(
                                      Icons
                                          .badge_outlined,
                                    ),
                                    border:
                                        OutlineInputBorder(),
                                  ),
                                  items:
                                      const <DropdownMenuItem<
                                          String>>[
                                    DropdownMenuItem<
                                        String>(
                                      value: 'NIN',
                                      child: Text(
                                        'NIN Only',
                                      ),
                                    ),
                                    DropdownMenuItem<
                                        String>(
                                      value: 'BVN',
                                      child: Text(
                                        'BVN Only',
                                      ),
                                    ),
                                    DropdownMenuItem<
                                        String>(
                                      value:
                                          'NIN_OR_BVN',
                                      child: Text(
                                        'NIN or BVN',
                                      ),
                                    ),
                                    DropdownMenuItem<
                                        String>(
                                      value:
                                          'NIN_AND_BVN',
                                      child: Text(
                                        'NIN and BVN',
                                      ),
                                    ),
                                  ],
                                  onChanged: isSaving
                                      ? null
                                      : (
                                          String?
                                              value,
                                        ) {
                                          if (value ==
                                              null) {
                                            return;
                                          }

                                          setState(
                                            () {
                                              acceptedIdentityType =
                                                  value;
                                            },
                                          );
                                        },
                                ),
                                const SizedBox(
                                  height: 14,
                                ),
                                textField(
                                  controller:
                                      unverifiedDailyLimitController,
                                  label:
                                      'Unverified Customer Daily Limit',
                                  icon:
                                      Icons.speed_rounded,
                                  keyboardType:
                                      const TextInputType
                                          .numberWithOptions(
                                    decimal: true,
                                  ),
                                  prefixText: '₦ ',
                                ),
                                const SizedBox(
                                  height: 14,
                                ),
                                textField(
                                  controller:
                                      highValueThresholdController,
                                  label:
                                      'High-Value Transaction Threshold',
                                  icon: Icons
                                      .trending_up_rounded,
                                  keyboardType:
                                      const TextInputType
                                          .numberWithOptions(
                                    decimal: true,
                                  ),
                                  prefixText: '₦ ',
                                ),
                                const SizedBox(
                                  height: 14,
                                ),
                                textField(
                                  controller:
                                      minimumAgeController,
                                  label:
                                      'Minimum Customer Age',
                                  icon:
                                      Icons.cake_outlined,
                                  keyboardType:
                                      TextInputType.number,
                                ),
                              ],
                            ),
                          ),
                        ],
                      ),

                      sectionTitle(
                        'Registration Rules',
                        Icons
                            .person_add_alt_rounded,
                      ),

                      settingsCard(
                        children: <Widget>[
                          switchTile(
                            icon:
                                Icons.how_to_reg,
                            title:
                                'Customer Registration',
                            subtitle:
                                'Allow new customer registration.',
                            value:
                                registrationEnabled,
                            onChanged: (
                              bool value,
                            ) {
                              setState(() {
                                registrationEnabled =
                                    value;
                              });
                            },
                          ),
                          switchTile(
                            icon:
                                Icons.email_outlined,
                            title: 'Require Email',
                            subtitle:
                                'Make email mandatory during registration.',
                            value: requireEmail,
                            onChanged: (
                              bool value,
                            ) {
                              setState(() {
                                requireEmail = value;
                              });
                            },
                          ),
                          switchTile(
                            icon:
                                Icons.sms_outlined,
                            title:
                                'Phone Verification',
                            subtitle:
                                'Require OTP phone verification.',
                            value:
                                requirePhoneVerification,
                            onChanged: (
                              bool value,
                            ) {
                              setState(() {
                                requirePhoneVerification =
                                    value;
                              });
                            },
                          ),
                          switchTile(
                            icon: Icons
                                .mark_email_read_outlined,
                            title:
                                'Email Verification',
                            subtitle:
                                'Require email verification.',
                            value:
                                requireEmailVerification,
                            onChanged: (
                              bool value,
                            ) {
                              setState(() {
                                requireEmailVerification =
                                    value;
                              });
                            },
                          ),
                          switchTile(
                            icon:
                                Icons.fingerprint,
                            title:
                                'NIN/BVN After Registration',
                            subtitle:
                                'Require customers to complete identity verification.',
                            value:
                                requireNinOrBvnAfterRegistration,
                            onChanged: (
                              bool value,
                            ) {
                              setState(() {
                                requireNinOrBvnAfterRegistration =
                                    value;
                              });
                            },
                          ),
                          switchTile(
                            icon: Icons
                                .group_add_outlined,
                            title: 'Referral Code',
                            subtitle:
                                'Allow referral codes during registration.',
                            value:
                                allowReferralCode,
                            showDivider: false,
                            onChanged: (
                              bool value,
                            ) {
                              setState(() {
                                allowReferralCode =
                                    value;
                              });
                            },
                          ),
                          Padding(
                            padding:
                                const EdgeInsets.all(
                              16,
                            ),
                            child:
                                DropdownButtonFormField<
                                    String>(
                              initialValue:
                                  defaultCustomerStatus,
                              decoration:
                                  const InputDecoration(
                                labelText:
                                    'Default Customer Status',
                                prefixIcon: Icon(
                                  Icons
                                      .manage_accounts_outlined,
                                ),
                                border:
                                    OutlineInputBorder(),
                              ),
                              items:
                                  const <DropdownMenuItem<
                                      String>>[
                                DropdownMenuItem<
                                    String>(
                                  value: 'ACTIVE',
                                  child:
                                      Text('ACTIVE'),
                                ),
                                DropdownMenuItem<
                                    String>(
                                  value:
                                      'SUSPENDED',
                                  child: Text(
                                    'SUSPENDED',
                                  ),
                                ),
                                DropdownMenuItem<
                                    String>(
                                  value: 'BLOCKED',
                                  child:
                                      Text('BLOCKED'),
                                ),
                              ],
                              onChanged: isSaving
                                  ? null
                                  : (
                                      String? value,
                                    ) {
                                      if (value ==
                                          null) {
                                        return;
                                      }

                                      setState(() {
                                        defaultCustomerStatus =
                                            value;
                                      });
                                    },
                            ),
                          ),
                        ],
                      ),

                      sectionTitle(
                        'Transaction Limits',
                        Icons.speed_rounded,
                      ),

                      settingsCard(
                        children: <Widget>[
                          Padding(
                            padding:
                                const EdgeInsets.all(
                              16,
                            ),
                            child: Column(
                              children: <Widget>[
                                twoAmountFields(
                                  first:
                                      minimumWalletFundingController,
                                  second:
                                      maximumWalletFundingController,
                                  firstLabel:
                                      'Minimum Wallet Funding',
                                  secondLabel:
                                      'Maximum Wallet Funding',
                                ),
                                const SizedBox(
                                  height: 16,
                                ),
                                twoAmountFields(
                                  first:
                                      minimumServicepayTransferController,
                                  second:
                                      maximumServicepayTransferController,
                                  firstLabel:
                                      'Minimum ServicePay Transfer',
                                  secondLabel:
                                      'Maximum ServicePay Transfer',
                                ),
                                const SizedBox(
                                  height: 14,
                                ),
                                textField(
                                  controller:
                                      dailyServicepayTransferLimitController,
                                  label:
                                      'Daily ServicePay Transfer Limit',
                                  icon:
                                      Icons.today_outlined,
                                  keyboardType:
                                      const TextInputType
                                          .numberWithOptions(
                                    decimal: true,
                                  ),
                                  prefixText: '₦ ',
                                ),
                                const SizedBox(
                                  height: 16,
                                ),
                                twoAmountFields(
                                  first:
                                      minimumBankTransferController,
                                  second:
                                      maximumBankTransferController,
                                  firstLabel:
                                      'Minimum Bank Transfer',
                                  secondLabel:
                                      'Maximum Bank Transfer',
                                ),
                                const SizedBox(
                                  height: 14,
                                ),
                                textField(
                                  controller:
                                      dailyBankTransferLimitController,
                                  label:
                                      'Daily Bank Transfer Limit',
                                  icon:
                                      Icons.today_outlined,
                                  keyboardType:
                                      const TextInputType
                                          .numberWithOptions(
                                    decimal: true,
                                  ),
                                  prefixText: '₦ ',
                                ),
                                const SizedBox(
                                  height: 16,
                                ),
                                twoAmountFields(
                                  first:
                                      minimumAirtimeController,
                                  second:
                                      maximumAirtimeController,
                                  firstLabel:
                                      'Minimum Airtime Purchase',
                                  secondLabel:
                                      'Maximum Airtime Purchase',
                                ),
                                const SizedBox(
                                  height: 14,
                                ),
                                textField(
                                  controller:
                                      maximumDataController,
                                  label:
                                      'Maximum Data Purchase',
                                  icon:
                                      Icons.wifi_rounded,
                                  keyboardType:
                                      const TextInputType
                                          .numberWithOptions(
                                    decimal: true,
                                  ),
                                  prefixText: '₦ ',
                                ),
                                const SizedBox(
                                  height: 14,
                                ),
                                textField(
                                  controller:
                                      maximumElectricityPaymentController,
                                  label:
                                      'Maximum Electricity Payment',
                                  icon: Icons
                                      .electric_bolt_rounded,
                                  keyboardType:
                                      const TextInputType
                                          .numberWithOptions(
                                    decimal: true,
                                  ),
                                  prefixText: '₦ ',
                                ),
                                const SizedBox(
                                  height: 14,
                                ),
                                textField(
                                  controller:
                                      maximumCableTvPaymentController,
                                  label:
                                      'Maximum Cable TV Payment',
                                  icon:
                                      Icons.live_tv_rounded,
                                  keyboardType:
                                      const TextInputType
                                          .numberWithOptions(
                                    decimal: true,
                                  ),
                                  prefixText: '₦ ',
                                ),
                                const SizedBox(
                                  height: 14,
                                ),
                                textField(
                                  controller:
                                      dailyCustomerTransactionLimitController,
                                  label:
                                      'Daily Customer Transaction Limit',
                                  icon:
                                      Icons.speed_outlined,
                                  keyboardType:
                                      const TextInputType
                                          .numberWithOptions(
                                    decimal: true,
                                  ),
                                  prefixText: '₦ ',
                                ),
                              ],
                            ),
                          ),
                        ],
                      ),

                      sectionTitle(
                        'Platform Control',
                        Icons
                            .admin_panel_settings_outlined,
                      ),

                      settingsCard(
                        children: <Widget>[
                          switchTile(
                            icon:
                                Icons.construction,
                            iconColor:
                                const Color(
                              0xFFF59E0B,
                            ),
                            title:
                                'Maintenance Mode',
                            subtitle:
                                'Temporarily disable customer access.',
                            value:
                                maintenanceMode,
                            showDivider: false,
                            onChanged: (
                              bool value,
                            ) {
                              setState(() {
                                maintenanceMode =
                                    value;
                              });
                            },
                          ),
                          Padding(
                            padding:
                                const EdgeInsets.all(
                              16,
                            ),
                            child: Column(
                              children: <Widget>[
                                textField(
                                  controller:
                                      maintenanceTitleController,
                                  label:
                                      'Maintenance Title',
                                  icon: Icons
                                      .construction_outlined,
                                ),
                                const SizedBox(
                                  height: 14,
                                ),
                                textField(
                                  controller:
                                      maintenanceMessageController,
                                  label:
                                      'Maintenance Message',
                                  icon: Icons
                                      .message_outlined,
                                  maxLines: 4,
                                ),
                              ],
                            ),
                          ),
                        ],
                      ),

                      sectionTitle(
                        'Customer Support',
                        Icons
                            .support_agent_rounded,
                      ),

                      settingsCard(
                        children: <Widget>[
                          Padding(
                            padding:
                                const EdgeInsets.all(
                              16,
                            ),
                            child: Column(
                              children: <Widget>[
                                textField(
                                  controller:
                                      supportPhoneController,
                                  label:
                                      'Support Phone',
                                  icon: Icons
                                      .phone_outlined,
                                  keyboardType:
                                      TextInputType.phone,
                                ),
                                const SizedBox(
                                  height: 14,
                                ),
                                textField(
                                  controller:
                                      supportEmailController,
                                  label:
                                      'Support Email',
                                  icon: Icons
                                      .email_outlined,
                                  keyboardType:
                                      TextInputType
                                          .emailAddress,
                                ),
                                const SizedBox(
                                  height: 14,
                                ),
                                textField(
                                  controller:
                                      whatsappController,
                                  label:
                                      'WhatsApp Number',
                                  icon: Icons
                                      .chat_outlined,
                                  keyboardType:
                                      TextInputType.phone,
                                ),
                                const SizedBox(
                                  height: 14,
                                ),
                                textField(
                                  controller:
                                      officeAddressController,
                                  label:
                                      'Office Address',
                                  icon: Icons
                                      .location_on_outlined,
                                  maxLines: 3,
                                ),
                                const SizedBox(
                                  height: 14,
                                ),
                                textField(
                                  controller:
                                      websiteUrlController,
                                  label:
                                      'Website URL',
                                  icon: Icons
                                      .language_rounded,
                                  keyboardType:
                                      TextInputType.url,
                                ),
                                const SizedBox(
                                  height: 14,
                                ),
                                textField(
                                  controller:
                                      privacyPolicyUrlController,
                                  label:
                                      'Privacy Policy URL',
                                  icon: Icons
                                      .privacy_tip_outlined,
                                  keyboardType:
                                      TextInputType.url,
                                ),
                                const SizedBox(
                                  height: 14,
                                ),
                                textField(
                                  controller:
                                      termsUrlController,
                                  label:
                                      'Terms and Conditions URL',
                                  icon: Icons
                                      .description_outlined,
                                  keyboardType:
                                      TextInputType.url,
                                ),
                                const SizedBox(
                                  height: 14,
                                ),
                                Row(
                                  children: <Widget>[
                                    Expanded(
                                      child:
                                          textField(
                                        controller:
                                            supportFromController,
                                        label:
                                            'Support From',
                                        icon: Icons
                                            .schedule,
                                      ),
                                    ),
                                    const SizedBox(
                                      width: 12,
                                    ),
                                    Expanded(
                                      child:
                                          textField(
                                        controller:
                                            supportToController,
                                        label:
                                            'Support To',
                                        icon: Icons
                                            .schedule,
                                      ),
                                    ),
                                  ],
                                ),
                                const SizedBox(
                                  height: 18,
                                ),
                                const Align(
                                  alignment: Alignment
                                      .centerLeft,
                                  child: Text(
                                    'Support Days',
                                    style:
                                        TextStyle(
                                      fontWeight:
                                          FontWeight
                                              .w800,
                                    ),
                                  ),
                                ),
                                const SizedBox(
                                  height: 9,
                                ),
                                Wrap(
                                  spacing: 8,
                                  runSpacing: 8,
                                  children: const <
                                      String>[
                                    'MONDAY',
                                    'TUESDAY',
                                    'WEDNESDAY',
                                    'THURSDAY',
                                    'FRIDAY',
                                    'SATURDAY',
                                    'SUNDAY',
                                  ].map(
                                    (
                                      String day,
                                    ) {
                                      final bool selected =
                                          supportDays
                                              .contains(
                                        day,
                                      );

                                      return FilterChip(
                                        label: Text(
                                          day.substring(
                                            0,
                                            3,
                                          ),
                                        ),
                                        selected:
                                            selected,
                                        onSelected:
                                            isSaving
                                                ? null
                                                : (
                                                    bool
                                                        value,
                                                  ) {
                                                    setState(
                                                      () {
                                                        if (value) {
                                                          supportDays.add(
                                                            day,
                                                          );
                                                        } else {
                                                          supportDays.remove(
                                                            day,
                                                          );
                                                        }
                                                      },
                                                    );
                                                  },
                                      );
                                    },
                                  ).toList(),
                                ),
                              ],
                            ),
                          ),
                        ],
                      ),

                      sectionTitle(
                        'App Version & Updates',
                        Icons
                            .system_update_rounded,
                      ),

                      settingsCard(
                        children: <Widget>[
                          switchTile(
                            icon: Icons
                                .system_update,
                            title:
                                'Force App Update',
                            subtitle:
                                'Require customers to install the latest version.',
                            value: forceUpdate,
                            showDivider: false,
                            onChanged: (
                              bool value,
                            ) {
                              setState(() {
                                forceUpdate = value;
                              });
                            },
                          ),
                          Padding(
                            padding:
                                const EdgeInsets.all(
                              16,
                            ),
                            child: Column(
                              children: <Widget>[
                                Row(
                                  children: <Widget>[
                                    Expanded(
                                      child:
                                          textField(
                                        controller:
                                            minimumSupportedVersionController,
                                        label:
                                            'Minimum Supported Version',
                                        icon: Icons
                                            .security_update_warning_outlined,
                                      ),
                                    ),
                                    const SizedBox(
                                      width: 12,
                                    ),
                                    Expanded(
                                      child:
                                          textField(
                                        controller:
                                            latestVersionController,
                                        label:
                                            'Latest Version',
                                        icon: Icons
                                            .new_releases_outlined,
                                      ),
                                    ),
                                  ],
                                ),
                                const SizedBox(
                                  height: 14,
                                ),
                                textField(
                                  controller:
                                      updateMessageController,
                                  label:
                                      'Update Message',
                                  icon: Icons
                                      .message_outlined,
                                  maxLines: 3,
                                ),
                                const SizedBox(
                                  height: 14,
                                ),
                                textField(
                                  controller:
                                      androidUpdateUrlController,
                                  label:
                                      'Android Update URL',
                                  icon: Icons
                                      .android_rounded,
                                  keyboardType:
                                      TextInputType.url,
                                ),
                                const SizedBox(
                                  height: 14,
                                ),
                                textField(
                                  controller:
                                      iosUpdateUrlController,
                                  label:
                                      'iOS Update URL',
                                  icon: Icons
                                      .phone_iphone_rounded,
                                  keyboardType:
                                      TextInputType.url,
                                ),
                              ],
                            ),
                          ),
                        ],
                      ),

                      sectionTitle(
                        'Admin Account',
                        Icons
                            .account_circle_rounded,
                      ),

                      settingsCard(
                        children: <Widget>[
                          ListTile(
                            leading: CircleAvatar(
                              backgroundColor:
                                  const Color(
                                0xFFE6F4F1,
                              ),
                              child: Text(
                                adminName.isEmpty
                                    ? 'A'
                                    : adminName[0]
                                        .toUpperCase(),
                                style:
                                    const TextStyle(
                                  color:
                                      primaryColor,
                                  fontWeight:
                                      FontWeight
                                          .w900,
                                ),
                              ),
                            ),
                            title: Text(
                              adminName,
                              style:
                                  const TextStyle(
                                fontWeight:
                                    FontWeight
                                        .w900,
                              ),
                            ),
                            subtitle: Text(
                              adminEmail.isEmpty
                                  ? adminRole
                                      .replaceAll(
                                        '_',
                                        ' ',
                                      )
                                  : '$adminEmail • '
                                      '${adminRole.replaceAll('_', ' ')}',
                            ),
                          ),
                          const Divider(
                            height: 1,
                          ),
                          ListTile(
                            leading: const Icon(
                              Icons.logout_rounded,
                              color:
                                  Color(
                                0xFFDC2626,
                              ),
                            ),
                            title: const Text(
                              'Log Out',
                              style:
                                 TextStyle(
                                color:
                                    Color(
                                  0xFFDC2626,
                                ),
                                fontWeight:
                                    FontWeight
                                        .w800,
                              ),
                            ),
                            subtitle: const Text(
                              'End this admin session securely.',
                            ),
                            trailing: const Icon(
                              Icons
                                  .chevron_right_rounded,
                            ),
                            onTap: logout,
                          ),
                        ],
                      ),

                      const SizedBox(
                        height: 26,
                      ),

                      SizedBox(
                        height: 58,
                        child:
                            FilledButton.icon(
                          onPressed: isSaving
                              ? null
                              : saveSettings,
                          style:
                              FilledButton.styleFrom(
                            backgroundColor:
                                primaryColor,
                            shape:
                                RoundedRectangleBorder(
                              borderRadius:
                                  BorderRadius
                                      .circular(
                                16,
                              ),
                            ),
                          ),
                          icon: isSaving
                              ? const SizedBox(
                                  width: 22,
                                  height: 22,
                                  child:
                                      CircularProgressIndicator(
                                    strokeWidth:
                                        2.4,
                                    color:
                                        Colors.white,
                                  ),
                                )
                              : const Icon(
                                  Icons.save_rounded,
                                ),
                          label: Text(
                            isSaving
                                ? 'Saving Settings...'
                                : 'Save All Settings',
                            style:
                                const TextStyle(
                              fontSize: 16,
                              fontWeight:
                                  FontWeight
                                      .w900,
                            ),
                          ),
                        ),
                      ),

                      const SizedBox(
                        height: 16,
                      ),

                      const Text(
                        'API keys, passwords and provider secrets remain securely stored in Render Environment Variables and are never displayed here.',
                        textAlign:
                            TextAlign.center,
                        style: TextStyle(
                          color:
                              Color(
                            0xFF64748B,
                          ),
                          fontSize: 12,
                          height: 1.45,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ],
          );
        },
      ),
    );
  }

  Widget buildHeader() {
    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          colors: <Color>[
            Color(0xFF0F766E),
            Color(0xFF14B8A6),
          ],
        ),
        borderRadius:
            BorderRadius.circular(22),
        boxShadow: const <BoxShadow>[
          BoxShadow(
            color: Color(0x300F766E),
            blurRadius: 20,
            offset: Offset(0, 9),
          ),
        ],
      ),
      child: const Row(
        children: <Widget>[
          CircleAvatar(
            radius: 30,
            backgroundColor:
                Colors.white24,
            child: Icon(
              Icons.settings_rounded,
              color: Colors.white,
              size: 34,
            ),
          ),
          SizedBox(width: 15),
          Expanded(
            child: Column(
              crossAxisAlignment:
                  CrossAxisAlignment.start,
              children: <Widget>[
                Text(
                  'ServicePay Controls',
                  style: TextStyle(
                    color: Colors.white,
                    fontSize: 21,
                    fontWeight:
                        FontWeight.w900,
                  ),
                ),
                SizedBox(height: 6),
                Text(
                  'Manage services, KYC, registration, limits, support and application updates.',
                  style: TextStyle(
                    color: Colors.white,
                    height: 1.45,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

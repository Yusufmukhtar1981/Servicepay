import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:gal/gal.dart';
import 'package:http/http.dart' as http;
import 'package:share_plus/share_plus.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:screenshot/screenshot.dart';

class BvnVerificationScreen extends StatefulWidget {
  const BvnVerificationScreen({super.key});

  @override
  State<BvnVerificationScreen> createState() => _BvnVerificationScreenState();
}

class _BvnVerificationScreenState extends State<BvnVerificationScreen> {
  static const String baseUrl = 'https://api.servicepay.ng/api';

  static const Color primaryGreen = Color(0xFF149B8F);

  static const double bvnFee = 200;

  final GlobalKey<FormState> formKey = GlobalKey<FormState>();

  final TextEditingController bvnController = TextEditingController();

  bool hasConsent = false;
  bool isLoading = false;
  bool isLoadingHistory = true;

  List<Map<String, dynamic>> verificationHistory = [];

  @override
  void initState() {
    super.initState();
    loadVerificationHistory();
  }

  @override
  void dispose() {
    bvnController.dispose();
    super.dispose();
  }

  Future<String?> getSavedAuthToken(
    SharedPreferences preferences,
  ) async {
    const List<String> tokenKeys = [
      'auth_token',
      'token',
      'access_token',
      'accessToken',
      'jwt_token',
      'jwt',
    ];

    for (final String key in tokenKeys) {
      final String? saved = preferences.getString(key);

      if (saved == null || saved.trim().isEmpty) {
        continue;
      }

      String token = saved.trim();

      if (token.toLowerCase().startsWith('bearer ')) {
        token = token.substring(7).trim();
      }

      if (token.isEmpty) {
        continue;
      }

      await preferences.setString(
        'auth_token',
        token,
      );

      return token;
    }

    return null;
  }

  String? validateBvn(
    String? value,
  ) {
    final String bvn = value?.trim() ?? '';

    if (bvn.isEmpty) {
      return 'Enter the BVN number';
    }

    if (!RegExp(r'^\d+$').hasMatch(bvn)) {
      return 'BVN must contain numbers only';
    }

    if (bvn.length != 11) {
      return 'BVN must be exactly 11 digits';
    }

    return null;
  }

  Map<String, dynamic> decodeServerResponse(
    http.Response response,
  ) {
    final String body = response.body.trim();

    if (body.isEmpty) {
      return {
        'success': false,
        'message': 'The server returned an empty response.',
      };
    }

    try {
      final dynamic decoded = jsonDecode(body);

      if (decoded is Map) {
        return Map<String, dynamic>.from(decoded);
      }

      return {
        'success': false,
        'message': 'Invalid response received from the server.',
      };
    } catch (_) {
      return {
        'success': false,
        'message': 'The server returned an invalid response.',
      };
    }
  }

  String messageFromResponse(
    Map<String, dynamic> responseData, {
    required String fallback,
  }) {
    final dynamic value = responseData['message'] ??
        responseData['error'] ??
        responseData['detail'];

    final String message = value?.toString().trim() ?? '';

    return message.isEmpty ? fallback : message;
  }

  Map<String, dynamic> extractVerificationResult(
    Map<String, dynamic> responseData,
  ) {
    final dynamic directVerification = responseData['verification'];

    if (directVerification is Map) {
      return Map<String, dynamic>.from(
        directVerification,
      );
    }

    final dynamic rawData = responseData['data'];

    if (rawData is! Map) {
      return {};
    }

    final Map<String, dynamic> data = Map<String, dynamic>.from(rawData);

    final dynamic nestedVerification = data['verificationData'];

    final Map<String, dynamic> details = nestedVerification is Map
        ? Map<String, dynamic>.from(
            nestedVerification,
          )
        : Map<String, dynamic>.from(data);

    return {
      ...details,
      'verificationId': data['verificationId']?.toString() ?? '',
      'reference': data['reference']?.toString() ??
          details['reference']?.toString() ??
          '',
      'amountCharged':
          data['amountCharged'] ?? details['amountCharged'] ?? bvnFee,
      'walletBalance': data['walletBalance'] ?? details['walletBalance'],
      'createdAt': data['createdAt']?.toString() ??
          details['createdAt']?.toString() ??
          '',
      'status': data['status']?.toString() ??
          details['status']?.toString() ??
          'Verified',
      'message':
          responseData['message']?.toString() ?? 'BVN verified successfully.',
    };
  }

  Map<String, dynamic> flattenHistoryItem(
    Map<String, dynamic> record,
  ) {
    final dynamic nested = record['verificationData'];

    final Map<String, dynamic> details =
        nested is Map ? Map<String, dynamic>.from(nested) : {};

    return {
      ...details,
      'verificationId': record['_id']?.toString() ?? '',
      'reference': record['reference']?.toString() ?? '',
      'amountCharged': record['amountCharged'] ?? bvnFee,
      'createdAt': record['createdAt']?.toString() ?? '',
      'status': record['status']?.toString() ?? '',
      'bvnNumberMasked': record['bvnNumberMasked']?.toString() ?? '',
      'maskedIdNumber': record['bvnNumberMasked']?.toString() ??
          record['idNumberMasked']?.toString() ??
          '',
      'message': 'Saved BVN verification',
    };
  }

  Future<void> saveWalletBalance(
    SharedPreferences preferences,
    Map<String, dynamic> result,
  ) async {
    final dynamic value = result['walletBalance'];

    if (value == null) {
      return;
    }

    final double? balance = double.tryParse(value.toString());

    if (balance == null) {
      return;
    }

    await preferences.setDouble(
      'wallet_balance',
      balance,
    );
  }

  Future<void> loadVerificationHistory() async {
    try {
      final SharedPreferences preferences =
          await SharedPreferences.getInstance();

      final String? token = await getSavedAuthToken(preferences);

      if (token == null || token.isEmpty) {
        return;
      }

      final http.Response response = await http.get(
        Uri.parse(
          '$baseUrl/id-verification/bvn/history',
        ),
        headers: {
          'Accept': 'application/json',
          'Authorization': 'Bearer $token',
        },
      ).timeout(
        const Duration(seconds: 45),
      );

      final Map<String, dynamic> responseData = decodeServerResponse(response);

      if (!mounted) {
        return;
      }

      if (response.statusCode >= 200 &&
          response.statusCode < 300 &&
          responseData['success'] == true) {
        final dynamic data = responseData['data'];

        if (data is List) {
          setState(() {
            verificationHistory = data
                .whereType<Map>()
                .map(
                  (item) => Map<String, dynamic>.from(item),
                )
                .toList();
          });
        }
      }
    } catch (_) {
      // History error must not stop BVN verification.
    } finally {
      if (mounted) {
        setState(() {
          isLoadingHistory = false;
        });
      }
    }
  }

  Future<void> verifyBvn() async {
    FocusScope.of(context).unfocus();

    final bool valid = formKey.currentState?.validate() ?? false;

    if (!valid) {
      return;
    }

    if (!hasConsent) {
      showMessage(
        'You must confirm that the BVN owner has granted permission.',
        isError: true,
      );
      return;
    }

    if (isLoading) {
      return;
    }

    setState(() {
      isLoading = true;
    });

    try {
      final SharedPreferences preferences =
          await SharedPreferences.getInstance();

      final String? token = await getSavedAuthToken(preferences);

      if (!mounted) {
        return;
      }

      if (token == null || token.isEmpty) {
        showMessage(
          'Your login session has expired. Please log in again.',
          isError: true,
        );
        return;
      }

      final String enteredBvn = bvnController.text.trim();

      final http.Response response = await http
          .post(
            Uri.parse(
              '$baseUrl/id-verification/bvn',
            ),
            headers: {
              'Accept': 'application/json',
              'Content-Type': 'application/json',
              'Authorization': 'Bearer $token',
            },
            body: jsonEncode({
              'bvnNumber': enteredBvn,
              'consentAccepted': true,
            }),
          )
          .timeout(
            const Duration(seconds: 65),
          );

      final Map<String, dynamic> responseData = decodeServerResponse(response);

      if (!mounted) {
        return;
      }

      if (response.statusCode == 401) {
        await preferences.remove('auth_token');

        showMessage(
          messageFromResponse(
            responseData,
            fallback: 'Your login session is invalid. Please log in again.',
          ),
          isError: true,
        );
        return;
      }

      final bool successful = response.statusCode >= 200 &&
          response.statusCode < 300 &&
          responseData['success'] == true;

      if (!successful) {
        showMessage(
          messageFromResponse(
            responseData,
            fallback:
                'BVN verification failed. Status: ${response.statusCode}.',
          ),
          isError: true,
        );
        return;
      }

      final Map<String, dynamic> result = extractVerificationResult(
        responseData,
      );

      result['bvn'] = result['bvn']?.toString().trim().isNotEmpty == true
          ? result['bvn']
          : enteredBvn;

      result['idType'] = 'BVN';

      await saveWalletBalance(
        preferences,
        result,
      );

      if (!mounted) {
        return;
      }

      await Navigator.of(context).push<void>(
        MaterialPageRoute(
          builder: (_) => BvnVerificationResultScreen(
            verification: result,
          ),
        ),
      );

      if (!mounted) {
        return;
      }

      bvnController.clear();

      setState(() {
        hasConsent = false;
      });

      await loadVerificationHistory();
    } on TimeoutException {
      showMessage(
        'The BVN verification request timed out. Please try again.',
        isError: true,
      );
    } on http.ClientException {
      showMessage(
        'Unable to connect to the verification server.',
        isError: true,
      );
    } catch (_) {
      showMessage(
        'Unable to complete BVN verification. Please try again.',
        isError: true,
      );
    } finally {
      if (mounted) {
        setState(() {
          isLoading = false;
        });
      }
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
          behavior: SnackBarBehavior.floating,
          backgroundColor: isError ? const Color(0xFFDC2626) : primaryGreen,
        ),
      );
  }

  String? firstValue(
    Map<String, dynamic> data,
    List<String> keys,
  ) {
    for (final String key in keys) {
      final dynamic value = data[key];

      if (value == null) {
        continue;
      }

      final String text = value.toString().trim();

      if (text.isNotEmpty && text.toLowerCase() != 'null') {
        return text;
      }
    }

    return null;
  }

  String formatDate(
    String value,
  ) {
    try {
      final DateTime parsed = DateTime.parse(value).toLocal();

      return '${parsed.day.toString().padLeft(2, '0')}/'
          '${parsed.month.toString().padLeft(2, '0')}/'
          '${parsed.year}';
    } catch (_) {
      return value;
    }
  }

  Widget buildHistorySection() {
    if (isLoadingHistory) {
      return const Center(
        child: Padding(
          padding: EdgeInsets.all(25),
          child: CircularProgressIndicator(),
        ),
      );
    }

    if (verificationHistory.isEmpty) {
      return Container(
        padding: const EdgeInsets.all(22),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(18),
        ),
        child: const Column(
          children: [
            Icon(
              Icons.history_rounded,
              size: 42,
              color: Colors.grey,
            ),
            SizedBox(height: 8),
            Text(
              'No BVN verification yet',
              style: TextStyle(
                fontWeight: FontWeight.w700,
              ),
            ),
          ],
        ),
      );
    }

    return Column(
      children: verificationHistory.take(5).map(
        (record) {
          final Map<String, dynamic> result = flattenHistoryItem(record);

          final String name = firstValue(
                result,
                const [
                  'fullName',
                  'full_name',
                  'name',
                ],
              ) ??
              'BVN Verification';

          final String reference = result['reference']?.toString() ?? '';

          final String date = formatDate(
            result['createdAt']?.toString() ?? '',
          );

          return Card(
            margin: const EdgeInsets.only(bottom: 10),
            color: Colors.white,
            elevation: 0,
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(16),
              side: const BorderSide(
                color: Color(0xFFE5E7EB),
              ),
            ),
            child: ListTile(
              onTap: () {
                Navigator.of(context).push(
                  MaterialPageRoute(
                    builder: (_) => BvnVerificationResultScreen(
                      verification: result,
                    ),
                  ),
                );
              },
              leading: const CircleAvatar(
                backgroundColor: Color(0xFFE6F7F4),
                child: Icon(
                  Icons.account_balance_outlined,
                  color: primaryGreen,
                ),
              ),
              title: Text(
                name,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  fontWeight: FontWeight.w800,
                ),
              ),
              subtitle: Text(
                [
                  if (date.isNotEmpty) date,
                  if (reference.isNotEmpty) reference,
                ].join(' • '),
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
              ),
              trailing: const Icon(
                Icons.chevron_right_rounded,
              ),
            ),
          );
        },
      ).toList(),
    );
  }

  @override
  Widget build(
    BuildContext context,
  ) {
    return Scaffold(
      backgroundColor: const Color(0xFFF7F8FA),
      appBar: AppBar(
        title: const Text(
          'BVN Verification',
          style: TextStyle(
            fontWeight: FontWeight.w800,
          ),
        ),
      ),
      body: RefreshIndicator(
        onRefresh: loadVerificationHistory,
        child: Form(
          key: formKey,
          child: ListView(
            padding: const EdgeInsets.all(18),
            children: [
              Container(
                padding: const EdgeInsets.all(20),
                decoration: BoxDecoration(
                  gradient: const LinearGradient(
                    colors: [
                      Color(0xFF149B8F),
                      Color(0xFF0F766E),
                    ],
                  ),
                  borderRadius: BorderRadius.circular(24),
                ),
                child: const Row(
                  children: [
                    CircleAvatar(
                      radius: 28,
                      backgroundColor: Colors.white24,
                      child: Icon(
                        Icons.account_balance_outlined,
                        color: Colors.white,
                        size: 31,
                      ),
                    ),
                    SizedBox(width: 14),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'Verify a BVN',
                            style: TextStyle(
                              color: Colors.white,
                              fontSize: 20,
                              fontWeight: FontWeight.w900,
                            ),
                          ),
                          SizedBox(height: 5),
                          Text(
                            'Confirm Bank Verification Number information securely.',
                            style: TextStyle(
                              color: Colors.white,
                              height: 1.4,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 22),
              Container(
                padding: const EdgeInsets.all(20),
                decoration: BoxDecoration(
                  color: Colors.white,
                  borderRadius: BorderRadius.circular(24),
                  boxShadow: [
                    BoxShadow(
                      color: Colors.black.withOpacity(0.05),
                      blurRadius: 20,
                      offset: const Offset(0, 8),
                    ),
                  ],
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text(
                      'BVN NUMBER',
                      style: TextStyle(
                        color: Color(0xFF8A8A94),
                        fontSize: 13,
                        letterSpacing: 1.2,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    const SizedBox(height: 9),
                    TextFormField(
                      controller: bvnController,
                      enabled: !isLoading,
                      keyboardType: TextInputType.number,
                      maxLength: 11,
                      inputFormatters: [
                        FilteringTextInputFormatter.digitsOnly,
                        LengthLimitingTextInputFormatter(
                          11,
                        ),
                      ],
                      validator: validateBvn,
                      textAlign: TextAlign.center,
                      style: const TextStyle(
                        fontSize: 19,
                        letterSpacing: 3,
                        fontWeight: FontWeight.w800,
                      ),
                      decoration: InputDecoration(
                        hintText: '###########',
                        counterText: '',
                        prefixIcon: const Icon(
                          Icons.numbers_rounded,
                        ),
                        filled: true,
                        fillColor: const Color(0xFFFAFAFB),
                        border: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(18),
                        ),
                      ),
                    ),
                    const SizedBox(height: 16),
                    Container(
                      padding: const EdgeInsets.all(16),
                      decoration: BoxDecoration(
                        color: const Color(0xFFFFF7ED),
                        borderRadius: BorderRadius.circular(16),
                        border: Border.all(
                          color: const Color(0xFFFED7AA),
                        ),
                      ),
                      child: const Row(
                        children: [
                          Icon(
                            Icons.account_balance_wallet_outlined,
                            color: Color(0xFFEA580C),
                          ),
                          SizedBox(width: 11),
                          Expanded(
                            child: Text(
                              'BVN verification fee',
                              style: TextStyle(
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                          ),
                          Text(
                            '₦200',
                            style: TextStyle(
                              color: Color(0xFFEA580C),
                              fontSize: 19,
                              fontWeight: FontWeight.w900,
                            ),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: 14),
                    CheckboxListTile(
                      value: hasConsent,
                      onChanged: isLoading
                          ? null
                          : (bool? value) {
                              setState(() {
                                hasConsent = value ?? false;
                              });
                            },
                      activeColor: primaryGreen,
                      controlAffinity: ListTileControlAffinity.leading,
                      contentPadding: EdgeInsets.zero,
                      title: const Text(
                        'I confirm that the owner of this BVN has granted permission to verify the information.',
                        style: TextStyle(
                          height: 1.4,
                          fontSize: 14,
                        ),
                      ),
                    ),
                    const SizedBox(height: 14),
                    SizedBox(
                      height: 58,
                      width: double.infinity,
                      child: FilledButton.icon(
                        onPressed: isLoading ? null : verifyBvn,
                        style: FilledButton.styleFrom(
                          backgroundColor: primaryGreen,
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(
                              18,
                            ),
                          ),
                        ),
                        icon: isLoading
                            ? const SizedBox(
                                width: 22,
                                height: 22,
                                child: CircularProgressIndicator(
                                  strokeWidth: 2.5,
                                  color: Colors.white,
                                ),
                              )
                            : const Icon(
                                Icons.verified_outlined,
                              ),
                        label: Text(
                          isLoading ? 'Verifying...' : 'Verify BVN — ₦200',
                          style: const TextStyle(
                            fontSize: 17,
                            fontWeight: FontWeight.w800,
                          ),
                        ),
                      ),
                    ),
                    const SizedBox(height: 14),
                    const Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Icon(
                          Icons.lock_outline,
                          color: Colors.grey,
                          size: 19,
                        ),
                        SizedBox(width: 8),
                        Expanded(
                          child: Text(
                            'The ₦200 fee will only be deducted after BVN verification succeeds.',
                            style: TextStyle(
                              color: Colors.grey,
                              height: 1.4,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 24),
              const Text(
                'Recent BVN Verifications',
                style: TextStyle(
                  fontSize: 19,
                  fontWeight: FontWeight.w900,
                ),
              ),
              const SizedBox(height: 5),
              const Text(
                'Your latest BVN verification activity.',
                style: TextStyle(
                  color: Color(0xFF8A8A94),
                ),
              ),
              const SizedBox(height: 14),
              buildHistorySection(),
            ],
          ),
        ),
      ),
    );
  }
}

class BvnVerificationResultScreen extends StatelessWidget {
  static const Color primaryGreen = Color(0xFF149B8F);

  final Map<String, dynamic> verification;

  BvnVerificationResultScreen({
    super.key,
    required this.verification,
  });

  final ScreenshotController screenshotController = ScreenshotController();

  String value(
    List<String> keys, {
    String fallback = 'Not provided',
  }) {
    for (final String key in keys) {
      final dynamic raw = verification[key];

      if (raw == null) {
        continue;
      }

      final String text = raw.toString().trim();

      if (text.isNotEmpty && text.toLowerCase() != 'null') {
        return text;
      }
    }

    return fallback;
  }

  String formatGender(
    String gender,
  ) {
    final String clean = gender.trim().toLowerCase();

    if (clean == 'm' || clean == 'male') {
      return 'Male';
    }

    if (clean == 'f' || clean == 'female') {
      return 'Female';
    }

    return gender;
  }

  Future<Uint8List?> captureCard(
    BuildContext context,
  ) async {
    try {
      await Future<void>.delayed(
        const Duration(milliseconds: 200),
      );

      return screenshotController.capture(
        delay: const Duration(milliseconds: 100),
        pixelRatio: 3,
      );
    } catch (_) {
      showActionMessage(
        context,
        'Unable to prepare the BVN card image.',
        isError: true,
      );

      return null;
    }
  }

  Future<void> downloadCard(
    BuildContext context,
  ) async {
    final Uint8List? imageBytes = await captureCard(context);

    if (imageBytes == null) {
      return;
    }

    try {
      final bool hasAccess = await Gal.hasAccess();

      if (!hasAccess) {
        await Gal.requestAccess();
      }

      await Gal.putImageBytes(
        imageBytes,
        name: 'servicepay_bvn_${DateTime.now().millisecondsSinceEpoch}',
      );

      if (!context.mounted) {
        return;
      }

      showActionMessage(
        context,
        'BVN card downloaded to your Gallery.',
        isError: false,
      );
    } catch (_) {
      if (!context.mounted) {
        return;
      }

      showActionMessage(
        context,
        'Unable to save the BVN card.',
        isError: true,
      );
    }
  }

  Future<void> shareCard(
    BuildContext context,
  ) async {
    final Uint8List? imageBytes = await captureCard(context);

    if (imageBytes == null) {
      return;
    }

    try {
      final RenderBox? renderBox = context.findRenderObject() as RenderBox?;

      await SharePlus.instance.share(
        ShareParams(
          title: 'ServicePay BVN Verification',
          text: 'ServicePay BVN verification result',
          files: [
            XFile.fromData(
              imageBytes,
              mimeType: 'image/png',
            ),
          ],
          fileNameOverrides: [
            'servicepay_bvn_${DateTime.now().millisecondsSinceEpoch}.png',
          ],
          sharePositionOrigin: renderBox == null
              ? null
              : renderBox.localToGlobal(
                    Offset.zero,
                  ) &
                  renderBox.size,
        ),
      );
    } catch (_) {
      if (!context.mounted) {
        return;
      }

      showActionMessage(
        context,
        'Unable to share the BVN card.',
        isError: true,
      );
    }
  }

  void showActionMessage(
    BuildContext context,
    String message, {
    required bool isError,
  }) {
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(
        SnackBar(
          content: Text(message),
          behavior: SnackBarBehavior.floating,
          backgroundColor: isError ? const Color(0xFFDC2626) : primaryGreen,
        ),
      );
  }

  @override
  Widget build(
    BuildContext context,
  ) {
    final String fullName = value(
      const [
        'fullName',
        'full_name',
        'name',
      ],
    );

    final String firstName = value(
      const [
        'firstName',
        'first_name',
        'firstname',
      ],
      fallback: '',
    );

    final String middleName = value(
      const [
        'middleName',
        'middle_name',
        'middlename',
      ],
      fallback: '',
    );

    final String lastName = value(
      const [
        'lastName',
        'last_name',
        'lastname',
        'surname',
      ],
      fallback: '',
    );

    final String dateOfBirth = value(
      const [
        'dateOfBirth',
        'date_of_birth',
        'birthdate',
        'dob',
      ],
    );

    final String gender = formatGender(
      value(
        const ['gender', 'sex'],
      ),
    );

    final String phone = value(
      const [
        'phone',
        'phoneNumber',
        'phone_number',
        'telephone',
      ],
    );

    final String address = value(
      const [
        'address',
        'residentialAddress',
        'residence_address',
      ],
    );

    final String photo = value(
      const [
        'photo',
        'image',
        'passport',
        'passport_photo',
      ],
      fallback: '',
    );

    final String bvn = value(
      const [
        'bvn',
        'bvnNumber',
        'bvn_number',
        'maskedIdNumber',
        'bvnNumberMasked',
      ],
      fallback: '***********',
    );

    final String reference = value(
      const ['reference'],
      fallback: '',
    );

    final String status = value(
      const ['status'],
      fallback: 'Verified',
    );

    final String createdAt = value(
      const ['createdAt'],
      fallback: '',
    );

    final double amount = double.tryParse(
          verification['amountCharged']?.toString() ?? '',
        ) ??
        200;

    final double? walletBalance = double.tryParse(
      verification['walletBalance']?.toString() ?? '',
    );

    return Scaffold(
      backgroundColor: const Color(0xFFF4F7F6),
      appBar: AppBar(
        title: const Text(
          'BVN Verification Result',
        ),
      ),
      body: ListView(
        padding: const EdgeInsets.all(18),
        children: [
          const Icon(
            Icons.verified_rounded,
            color: primaryGreen,
            size: 68,
          ),
          const SizedBox(height: 8),
          const Text(
            'BVN Verification Successful',
            textAlign: TextAlign.center,
            style: TextStyle(
              fontSize: 24,
              fontWeight: FontWeight.w900,
            ),
          ),
          const SizedBox(height: 20),
          Screenshot(
            controller: screenshotController,
            child: BvnVerifiedCard(
              fullName: fullName,
              dateOfBirth: dateOfBirth,
              gender: gender,
              bvn: bvn,
              photoValue: photo,
              reference: reference,
            ),
          ),
          const SizedBox(height: 18),
          Container(
            padding: const EdgeInsets.all(17),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(18),
              border: Border.all(
                color: const Color(0xFFE5E7EB),
              ),
            ),
            child: Column(
              children: [
                ResultRow(
                  label: 'ID Type',
                  value: 'BVN',
                ),
                ResultRow(
                  label: 'BVN',
                  value: bvn,
                ),
                ResultRow(
                  label: 'Full Name',
                  value: fullName,
                ),
                if (firstName.isNotEmpty)
                  ResultRow(
                    label: 'First Name',
                    value: firstName,
                  ),
                if (middleName.isNotEmpty)
                  ResultRow(
                    label: 'Middle Name',
                    value: middleName,
                  ),
                if (lastName.isNotEmpty)
                  ResultRow(
                    label: 'Last Name',
                    value: lastName,
                  ),
                ResultRow(
                  label: 'Date of Birth',
                  value: dateOfBirth,
                ),
                ResultRow(
                  label: 'Gender',
                  value: gender,
                ),
                ResultRow(
                  label: 'Phone',
                  value: phone,
                ),
                if (address != 'Not provided')
                  ResultRow(
                    label: 'Address',
                    value: address,
                  ),
                ResultRow(
                  label: 'Status',
                  value: status,
                  valueColor: primaryGreen,
                ),
                if (reference.isNotEmpty)
                  ResultRow(
                    label: 'Reference',
                    value: reference,
                  ),
                if (createdAt.isNotEmpty)
                  ResultRow(
                    label: 'Verified At',
                    value: createdAt,
                  ),
                ResultRow(
                  label: 'Amount Charged',
                  value: '₦${amount.toStringAsFixed(2)}',
                ),
                if (walletBalance != null)
                  ResultRow(
                    label: 'Wallet Balance',
                    value: '₦${walletBalance.toStringAsFixed(2)}',
                    showDivider: false,
                  ),
              ],
            ),
          ),
          const SizedBox(height: 18),
          Row(
            children: [
              Expanded(
                child: OutlinedButton.icon(
                  onPressed: () {
                    downloadCard(context);
                  },
                  icon: const Icon(
                    Icons.download_rounded,
                  ),
                  label: const Text(
                    'Download Card',
                    style: TextStyle(
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: FilledButton.icon(
                  onPressed: () {
                    shareCard(context);
                  },
                  style: FilledButton.styleFrom(
                    backgroundColor: primaryGreen,
                  ),
                  icon: const Icon(
                    Icons.share_rounded,
                  ),
                  label: const Text(
                    'Share Card',
                    style: TextStyle(
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 18),
          Container(
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(
              color: const Color(0xFFFFF7ED),
              borderRadius: BorderRadius.circular(14),
              border: Border.all(
                color: const Color(0xFFFED7AA),
              ),
            ),
            child: const Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Icon(
                  Icons.info_outline,
                  color: Color(0xFFEA580C),
                ),
                SizedBox(width: 9),
                Expanded(
                  child: Text(
                    'This is a ServicePay BVN verification result. It is not a replacement for an official bank or government identity document.',
                    style: TextStyle(
                      color: Color(0xFF7C2D12),
                      height: 1.4,
                    ),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 20),
          SizedBox(
            height: 55,
            child: FilledButton(
              onPressed: () {
                Navigator.pop(context);
              },
              style: FilledButton.styleFrom(
                backgroundColor: primaryGreen,
              ),
              child: const Text(
                'Done',
                style: TextStyle(
                  fontSize: 16,
                  fontWeight: FontWeight.w800,
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class BvnVerifiedCard extends StatelessWidget {
  static const Color primaryGreen = Color(0xFF149B8F);

  final String fullName;
  final String dateOfBirth;
  final String gender;
  final String bvn;
  final String photoValue;
  final String reference;

  const BvnVerifiedCard({
    super.key,
    required this.fullName,
    required this.dateOfBirth,
    required this.gender,
    required this.bvn,
    required this.photoValue,
    required this.reference,
  });

  @override
  Widget build(
    BuildContext context,
  ) {
    return AspectRatio(
      aspectRatio: 1.58,
      child: Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          gradient: const LinearGradient(
            colors: [
              Color(0xFFF8FFFD),
              Color(0xFFD9F5EC),
            ],
          ),
          borderRadius: BorderRadius.circular(22),
          border: Border.all(
            color: const Color(0xFF9DDCC8),
          ),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Row(
              children: [
                CircleAvatar(
                  backgroundColor: primaryGreen,
                  child: Icon(
                    Icons.account_balance_outlined,
                    color: Colors.white,
                  ),
                ),
                SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'SERVICEPAY',
                        style: TextStyle(
                          color: primaryGreen,
                          fontWeight: FontWeight.w900,
                          letterSpacing: 1.3,
                        ),
                      ),
                      Text(
                        'BVN VERIFIED',
                        style: TextStyle(
                          fontSize: 10,
                          color: Color(0xFF52705A),
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ],
                  ),
                ),
                Icon(
                  Icons.verified_rounded,
                  color: primaryGreen,
                  size: 34,
                ),
              ],
            ),
            const SizedBox(height: 14),
            Expanded(
              child: Row(
                children: [
                  BvnIdentityPhoto(
                    photoValue: photoValue,
                  ),
                  const SizedBox(width: 13),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text(
                          'FULL NAME',
                          style: TextStyle(
                            fontSize: 9,
                            color: Color(0xFF647A69),
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                        Text(
                          fullName.toUpperCase(),
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            fontSize: 15,
                            fontWeight: FontWeight.w900,
                          ),
                        ),
                        const Spacer(),
                        Row(
                          children: [
                            Expanded(
                              child: BvnCardField(
                                label: 'DATE OF BIRTH',
                                value: dateOfBirth,
                              ),
                            ),
                            Expanded(
                              child: BvnCardField(
                                label: 'GENDER',
                                value: gender,
                              ),
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 10),
            Container(
              padding: const EdgeInsets.symmetric(
                horizontal: 12,
                vertical: 9,
              ),
              decoration: BoxDecoration(
                color: Colors.white.withOpacity(0.75),
                borderRadius: BorderRadius.circular(12),
              ),
              child: Row(
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text(
                          'BVN NUMBER',
                          style: TextStyle(
                            fontSize: 9,
                            color: Color(0xFF647A69),
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                        Text(
                          bvn,
                          style: const TextStyle(
                            fontSize: 16,
                            letterSpacing: 1.2,
                            fontWeight: FontWeight.w900,
                          ),
                        ),
                      ],
                    ),
                  ),
                  if (reference.isNotEmpty)
                    const Icon(
                      Icons.qr_code_2,
                      color: primaryGreen,
                      size: 35,
                    ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class BvnIdentityPhoto extends StatelessWidget {
  final String photoValue;

  const BvnIdentityPhoto({
    super.key,
    required this.photoValue,
  });

  @override
  Widget build(
    BuildContext context,
  ) {
    return Container(
      width: 85,
      height: 102,
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(
        color: const Color(0xFFE5E7EB),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(
          color: const Color(0xFF9DDCC8),
        ),
      ),
      child: buildImage(),
    );
  }

  Widget buildImage() {
    final String value = photoValue.trim();

    if (value.isEmpty) {
      return const Icon(
        Icons.person,
        size: 55,
        color: Colors.grey,
      );
    }

    if (value.startsWith('http://') || value.startsWith('https://')) {
      return Image.network(
        value,
        fit: BoxFit.cover,
        errorBuilder: (_, __, ___) {
          return const Icon(
            Icons.person,
            size: 55,
            color: Colors.grey,
          );
        },
      );
    }

    try {
      String clean = value;

      if (clean.contains(',')) {
        clean = clean.split(',').last;
      }

      clean = clean.replaceAll(
        RegExp(r'\s+'),
        '',
      );

      final Uint8List bytes = base64Decode(clean);

      return Image.memory(
        bytes,
        fit: BoxFit.cover,
        errorBuilder: (_, __, ___) {
          return const Icon(
            Icons.person,
            size: 55,
            color: Colors.grey,
          );
        },
      );
    } catch (_) {
      return const Icon(
        Icons.person,
        size: 55,
        color: Colors.grey,
      );
    }
  }
}

class BvnCardField extends StatelessWidget {
  final String label;
  final String value;

  const BvnCardField({
    super.key,
    required this.label,
    required this.value,
  });

  @override
  Widget build(
    BuildContext context,
  ) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          label,
          style: const TextStyle(
            fontSize: 8,
            color: Color(0xFF647A69),
            fontWeight: FontWeight.w700,
          ),
        ),
        Text(
          value,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: const TextStyle(
            fontSize: 11,
            fontWeight: FontWeight.w800,
          ),
        ),
      ],
    );
  }
}

class ResultRow extends StatelessWidget {
  final String label;
  final String value;
  final Color? valueColor;
  final bool showDivider;

  const ResultRow({
    super.key,
    required this.label,
    required this.value,
    this.valueColor,
    this.showDivider = true,
  });

  @override
  Widget build(
    BuildContext context,
  ) {
    return Container(
      padding: const EdgeInsets.symmetric(
        vertical: 12,
      ),
      decoration: BoxDecoration(
        border: showDivider
            ? const Border(
                bottom: BorderSide(
                  color: Color(0xFFE5E7EB),
                ),
              )
            : null,
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 115,
            child: Text(
              label,
              style: const TextStyle(
                color: Color(0xFF6B7280),
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: SelectableText(
              value,
              textAlign: TextAlign.right,
              style: TextStyle(
                color: valueColor ?? const Color(0xFF17211A),
                fontWeight: FontWeight.w800,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

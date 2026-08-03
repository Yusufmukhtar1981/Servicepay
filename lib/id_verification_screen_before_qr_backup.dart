import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';
import 'package:qr_flutter/qr_flutter.dart';

class IdVerificationScreen extends StatefulWidget {
  final String initialIdType;

  const IdVerificationScreen({
    super.key,
    this.initialIdType = 'NIN',
  });

  @override
  State<IdVerificationScreen> createState() => _IdVerificationScreenState();
}

class _IdVerificationScreenState extends State<IdVerificationScreen> {
  static const String baseUrl = 'https://api.servicepay.ng/api';

  static const Color primaryGreen = Color(0xFF149B8F);

  final GlobalKey<FormState> formKey = GlobalKey<FormState>();

  final TextEditingController ninController = TextEditingController();

  bool hasConsent = false;
  bool isLoading = false;
  bool isLoadingHistory = true;

  String selectedSearchType = 'NIN_NUMBER';
  String selectedSlipType = 'PREMIUM';

  List<Map<String, dynamic>> verificationHistory = [];

  final Map<String, Map<String, dynamic>> searchTypes = {
    'NIN_NUMBER': {
      'title': 'NIN Number',
      'icon': Icons.badge_outlined,
      'available': true,
    },
    'PHONE_NUMBER': {
      'title': 'Phone Number',
      'icon': Icons.phone_android_outlined,
      'available': false,
    },
    'DEMOGRAPHIC': {
      'title': 'Demographic Search',
      'icon': Icons.person_search_outlined,
      'available': false,
    },
  };

  final Map<String, Map<String, dynamic>> slipTypes = {
    'PREMIUM': {
      'title': 'Premium',
      'fee': 250.0,
      'icon': Icons.credit_card_rounded,
      'description': 'Premium NIN card layout',
    },
    'STANDARD': {
      'title': 'Standard',
      'fee': 250.0,
      'icon': Icons.badge_rounded,
      'description': 'Standard NIN card layout',
    },
    'REGULAR': {
      'title': 'Regular',
      'fee': 200.0,
      'icon': Icons.article_outlined,
      'description': 'Regular NIN slip layout',
    },
    'INFORMATION': {
      'title': 'Information',
      'fee': 150.0,
      'icon': Icons.description_outlined,
      'description': 'Basic information layout',
    },
  };

  @override
  void initState() {
    super.initState();
    loadVerificationHistory();
  }

  @override
  void dispose() {
    ninController.dispose();
    super.dispose();
  }

  double get selectedFee {
    return (slipTypes[selectedSlipType]?['fee'] as num?)?.toDouble() ?? 0;
  }

  String get selectedSlipTitle {
    return slipTypes[selectedSlipType]?['title']?.toString() ??
        selectedSlipType;
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

      if (token.toLowerCase().startsWith(
            'bearer ',
          )) {
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

  String? validateNin(
    String? value,
  ) {
    final String nin = value?.trim() ?? '';

    if (nin.isEmpty) {
      return 'Enter the NIN number';
    }

    if (!RegExp(r'^\d+$').hasMatch(nin)) {
      return 'NIN must contain numbers only';
    }

    if (nin.length != 11) {
      return 'NIN must be exactly 11 digits';
    }

    return null;
  }

  Future<void> loadVerificationHistory() async {
    try {
      final SharedPreferences preferences =
          await SharedPreferences.getInstance();

      final String? token = await getSavedAuthToken(preferences);

      if (token == null || token.isEmpty) {
        if (mounted) {
          setState(() {
            isLoadingHistory = false;
          });
        }
        return;
      }

      final http.Response response = await http.get(
        Uri.parse(
          '$baseUrl/id-verification/nin/history',
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
      // History failure must not stop verification.
    } finally {
      if (mounted) {
        setState(() {
          isLoadingHistory = false;
        });
      }
    }
  }

  Future<void> verifyNin() async {
    FocusScope.of(context).unfocus();

    final bool valid = formKey.currentState?.validate() ?? false;

    if (!valid) {
      return;
    }

    if (!hasConsent) {
      showMessage(
        'You must confirm that the ID owner has granted permission.',
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

      final http.Response response = await http
          .post(
            Uri.parse(
              '$baseUrl/id-verification/nin',
            ),
            headers: {
              'Accept': 'application/json',
              'Content-Type': 'application/json',
              'Authorization': 'Bearer $token',
            },
            body: jsonEncode({
              'ninNumber': ninController.text.trim(),
              'slipType': selectedSlipType,
              'searchType': selectedSearchType,
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
                'NIN verification failed. Status: ${response.statusCode}.',
          ),
          isError: true,
        );
        return;
      }

      final Map<String, dynamic> result = extractSuccessfulResult(responseData);

      await saveWalletBalance(
        preferences,
        result,
      );

      if (!mounted) {
        return;
      }

      await Navigator.of(context).push<void>(
        MaterialPageRoute(
          builder: (_) => VerificationResultScreen(
            verification: result,
          ),
        ),
      );

      if (!mounted) {
        return;
      }

      ninController.clear();

      setState(() {
        hasConsent = false;
      });

      await loadVerificationHistory();
    } on TimeoutException {
      showMessage(
        'The verification request timed out. Please try again.',
        isError: true,
      );
    } on http.ClientException {
      showMessage(
        'Unable to connect to the verification server.',
        isError: true,
      );
    } catch (error) {
      showMessage(
        'Unable to complete verification. Please try again.',
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

  Map<String, dynamic> extractSuccessfulResult(
    Map<String, dynamic> responseData,
  ) {
    final dynamic rawData = responseData['data'];

    if (rawData is! Map) {
      return {};
    }

    final Map<String, dynamic> data = Map<String, dynamic>.from(rawData);

    final dynamic rawVerificationData = data['verificationData'];

    final Map<String, dynamic> verificationData = rawVerificationData is Map
        ? Map<String, dynamic>.from(
            rawVerificationData,
          )
        : {};

    return {
      ...verificationData,
      'verificationId': data['verificationId']?.toString() ?? '',
      'reference': data['reference']?.toString() ?? '',
      'searchType': data['searchType']?.toString() ?? selectedSearchType,
      'slipType': data['slipType']?.toString() ?? selectedSlipType,
      'amountCharged': data['amountCharged'] ?? selectedFee,
      'walletBalance': data['walletBalance'],
      'createdAt': data['createdAt']?.toString() ?? '',
      'status': 'SUCCESSFUL',
      'message':
          responseData['message']?.toString() ?? 'NIN verified successfully.',
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
      'searchType': record['searchType']?.toString() ?? '',
      'slipType': record['slipType']?.toString() ?? '',
      'amountCharged': record['amountCharged'] ?? 0,
      'createdAt': record['createdAt']?.toString() ?? '',
      'status': record['status']?.toString() ?? '',
      'ninNumberMasked': record['ninNumberMasked']?.toString() ?? '',
      'message': 'Saved NIN verification',
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
        return Map<String, dynamic>.from(
          decoded,
        );
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

  Widget buildSectionNumber(
    String number,
    String title,
  ) {
    return Row(
      children: [
        CircleAvatar(
          radius: 20,
          backgroundColor: primaryGreen,
          child: Text(
            number,
            style: const TextStyle(
              color: Colors.white,
              fontWeight: FontWeight.w800,
            ),
          ),
        ),
        const SizedBox(width: 10),
        Text(
          title.toUpperCase(),
          style: const TextStyle(
            color: Color(0xFF8A8A94),
            fontSize: 14,
            letterSpacing: 1.3,
            fontWeight: FontWeight.w700,
          ),
        ),
      ],
    );
  }

  Widget buildSearchTypeCard(
    String key,
  ) {
    final Map<String, dynamic> item = searchTypes[key]!;

    final bool selected = selectedSearchType == key;

    final bool available = item['available'] == true;

    return Expanded(
      child: InkWell(
        onTap: isLoading
            ? null
            : () {
                if (!available) {
                  showMessage(
                    '${item['title']} will be available soon.',
                    isError: true,
                  );
                  return;
                }

                setState(() {
                  selectedSearchType = key;
                });
              },
        borderRadius: BorderRadius.circular(18),
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 200),
          height: 120,
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            color: selected ? const Color(0xFFF0ECFF) : Colors.white,
            borderRadius: BorderRadius.circular(18),
            border: Border.all(
              color:
                  selected ? const Color(0xFF805AD5) : const Color(0xFFE5E7EB),
              width: selected ? 2.5 : 1,
            ),
          ),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(
                item['icon'] as IconData,
                size: 31,
                color: available ? const Color(0xFF805AD5) : Colors.grey,
              ),
              const SizedBox(height: 10),
              Text(
                item['title'].toString(),
                textAlign: TextAlign.center,
                style: TextStyle(
                  color: available ? const Color(0xFF29263A) : Colors.grey,
                  fontWeight: FontWeight.w800,
                ),
              ),
              if (!available)
                const Padding(
                  padding: EdgeInsets.only(top: 4),
                  child: Text(
                    'Soon',
                    style: TextStyle(
                      color: Colors.orange,
                      fontSize: 11,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }

  Widget buildSlipCard(
    String key,
  ) {
    final Map<String, dynamic> item = slipTypes[key]!;

    final bool selected = selectedSlipType == key;

    final double fee = (item['fee'] as num).toDouble();

    return InkWell(
      onTap: isLoading
          ? null
          : () {
              setState(() {
                selectedSlipType = key;
              });
            },
      borderRadius: BorderRadius.circular(18),
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 200),
        width: 145,
        padding: const EdgeInsets.all(13),
        decoration: BoxDecoration(
          color: selected ? const Color(0xFFEAF9F4) : Colors.white,
          borderRadius: BorderRadius.circular(18),
          border: Border.all(
            color: selected ? const Color(0xFF35B78F) : const Color(0xFFE5E7EB),
            width: selected ? 2.5 : 1,
          ),
        ),
        child: Column(
          children: [
            Text(
              '₦${fee.toStringAsFixed(0)}.00',
              style: const TextStyle(
                color: Color(0xFF29263A),
                fontSize: 17,
                fontWeight: FontWeight.w900,
              ),
            ),
            const Spacer(),
            Icon(
              item['icon'] as IconData,
              size: 37,
              color: selected ? primaryGreen : const Color(0xFF8B8B94),
            ),
            const Spacer(),
            Text(
              item['title'].toString(),
              style: TextStyle(
                color: selected ? primaryGreen : const Color(0xFF777783),
                fontWeight: FontWeight.w800,
              ),
            ),
          ],
        ),
      ),
    );
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
              'No NIN verification yet',
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
                ],
              ) ??
              'NIN Verification';

          final String reference = result['reference']?.toString() ?? '';

          final String date = formatDate(
            result['createdAt']?.toString() ?? '',
          );

          final String slipType = result['slipType']?.toString() ?? '';

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
                    builder: (_) => VerificationResultScreen(
                      verification: result,
                    ),
                  ),
                );
              },
              leading: const CircleAvatar(
                backgroundColor: Color(0xFFE6F7F4),
                child: Icon(
                  Icons.badge_outlined,
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
                  if (slipType.isNotEmpty) slipType,
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

  @override
  Widget build(
    BuildContext context,
  ) {
    return Scaffold(
      backgroundColor: const Color(0xFFF7F8FA),
      appBar: AppBar(
        title: const Text(
          'NIN Verification',
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
                  color: Colors.white,
                  borderRadius: BorderRadius.circular(28),
                  boxShadow: [
                    BoxShadow(
                      color: Colors.black.withValues(
                        alpha: 0.05,
                      ),
                      blurRadius: 22,
                      offset: const Offset(0, 8),
                    ),
                  ],
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    buildSectionNumber(
                      '1',
                      'Search Type',
                    ),
                    const SizedBox(height: 16),
                    Row(
                      children: [
                        buildSearchTypeCard(
                          'NIN_NUMBER',
                        ),
                        const SizedBox(width: 8),
                        buildSearchTypeCard(
                          'PHONE_NUMBER',
                        ),
                        const SizedBox(width: 8),
                        buildSearchTypeCard(
                          'DEMOGRAPHIC',
                        ),
                      ],
                    ),
                    const SizedBox(height: 28),
                    buildSectionNumber(
                      '2',
                      'Slip Layout',
                    ),
                    const SizedBox(height: 16),
                    SizedBox(
                      height: 150,
                      child: ListView.separated(
                        scrollDirection: Axis.horizontal,
                        itemCount: slipTypes.length,
                        separatorBuilder: (_, __) => const SizedBox(
                          width: 10,
                        ),
                        itemBuilder: (context, index) {
                          final String key = slipTypes.keys.elementAt(index);

                          return buildSlipCard(key);
                        },
                      ),
                    ),
                    const SizedBox(height: 28),
                    buildSectionNumber(
                      '3',
                      'Supply ID Number',
                    ),
                    const SizedBox(height: 16),
                    const Text(
                      'NIN NUMBER',
                      style: TextStyle(
                        color: Color(0xFF8A8A94),
                        fontSize: 13,
                        letterSpacing: 1.2,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    const SizedBox(height: 8),
                    TextFormField(
                      controller: ninController,
                      enabled: !isLoading,
                      keyboardType: TextInputType.number,
                      maxLength: 11,
                      inputFormatters: [
                        FilteringTextInputFormatter.digitsOnly,
                        LengthLimitingTextInputFormatter(
                          11,
                        ),
                      ],
                      validator: validateNin,
                      textAlign: TextAlign.center,
                      style: const TextStyle(
                        fontSize: 19,
                        letterSpacing: 3,
                        fontWeight: FontWeight.w800,
                      ),
                      decoration: InputDecoration(
                        hintText: '###########',
                        counterText: '',
                        filled: true,
                        fillColor: const Color(0xFFFAFAFB),
                        border: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(
                            18,
                          ),
                        ),
                      ),
                    ),
                    const SizedBox(height: 8),
                    const Text(
                      'We will never share your details with anyone else.',
                      style: TextStyle(
                        color: Color(0xFF9999A2),
                      ),
                    ),
                    const SizedBox(height: 18),
                    Container(
                      decoration: BoxDecoration(
                        color: const Color(0xFFFBF8F3),
                        borderRadius: BorderRadius.circular(
                          18,
                        ),
                        border: Border.all(
                          color: const Color(0xFFEAE4DB),
                        ),
                      ),
                      child: CheckboxListTile(
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
                        title: const Text(
                          'I confirm that the owner of this ID has granted permission to verify his or her identity.',
                          style: TextStyle(
                            height: 1.4,
                            fontSize: 14,
                          ),
                        ),
                      ),
                    ),
                    const SizedBox(height: 20),
                    SizedBox(
                      height: 58,
                      width: double.infinity,
                      child: FilledButton.icon(
                        onPressed: isLoading ? null : verifyNin,
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
                                Icons.fingerprint_rounded,
                                size: 28,
                              ),
                        label: Text(
                          isLoading
                              ? 'Verifying...'
                              : 'Verify — ₦${selectedFee.toStringAsFixed(0)}',
                          style: const TextStyle(
                            fontSize: 17,
                            fontWeight: FontWeight.w800,
                          ),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 24),
              const Text(
                'Recent NIN Verifications',
                style: TextStyle(
                  fontSize: 19,
                  fontWeight: FontWeight.w900,
                ),
              ),
              const SizedBox(height: 5),
              const Text(
                'Your latest verification activity.',
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

class VerificationResultScreen extends StatelessWidget {
  static const Color primaryGreen = Color(0xFF149B8F);

  final Map<String, dynamic> verification;

  const VerificationResultScreen({
    super.key,
    required this.verification,
  });

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

  String maskNin(
    String nin,
  ) {
    if (nin.isEmpty) {
      return '***********';
    }

    if (nin.contains('*')) {
      return nin;
    }

    if (nin.length <= 4) {
      return '****';
    }

    return '${'*' * (nin.length - 4)}'
        '${nin.substring(nin.length - 4)}';
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

    final String dateOfBirth = value(
      const [
        'dateOfBirth',
        'date_of_birth',
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

    final String nin = maskNin(
      value(
        const [
          'nin',
          'ninNumberMasked',
          'nin_number',
        ],
        fallback: '',
      ),
    );

    final String reference = value(
      const ['reference'],
      fallback: '',
    );

    final String slipType = value(
      const ['slipType'],
      fallback: 'PREMIUM',
    );

    final String status = value(
      const ['status'],
      fallback: 'SUCCESSFUL',
    );

    final double amount = double.tryParse(
          verification['amountCharged']?.toString() ?? '',
        ) ??
        0;

    return Scaffold(
      backgroundColor: const Color(0xFFF4F7F6),
      appBar: AppBar(
        title: const Text(
          'Verification Result',
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
            'Verification Successful',
            textAlign: TextAlign.center,
            style: TextStyle(
              fontSize: 24,
              fontWeight: FontWeight.w900,
            ),
          ),
          const SizedBox(height: 20),
          VerifiedNinCard(
            fullName: fullName,
            dateOfBirth: dateOfBirth,
            gender: gender,
            nin: nin,
            photoValue: photo,
            reference: reference,
            slipType: slipType,
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
                  label: 'Full Name',
                  value: fullName,
                ),
                ResultRow(
                  label: 'NIN',
                  value: nin,
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
                ResultRow(
                  label: 'Address',
                  value: address,
                ),
                ResultRow(
                  label: 'Layout',
                  value: slipType,
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
                ResultRow(
                  label: 'Amount Charged',
                  value: '₦${amount.toStringAsFixed(2)}',
                  showDivider: false,
                ),
              ],
            ),
          ),
          const SizedBox(height: 16),
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
                    'This is a ServicePay verification result. It is not a replacement for an official government-issued identity document.',
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

class VerifiedNinCard extends StatelessWidget {
  static const Color primaryGreen = Color(0xFF149B8F);

  final String fullName;
  final String dateOfBirth;
  final String gender;
  final String nin;
  final String photoValue;
  final String reference;
  final String slipType;

  const VerifiedNinCard({
    super.key,
    required this.fullName,
    required this.dateOfBirth,
    required this.gender,
    required this.nin,
    required this.photoValue,
    required this.reference,
    required this.slipType,
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
          boxShadow: [
            BoxShadow(
              color: Colors.black.withValues(alpha: 0.10),
              blurRadius: 18,
              offset: const Offset(0, 8),
            ),
          ],
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                const CircleAvatar(
                  backgroundColor: primaryGreen,
                  child: Icon(
                    Icons.account_balance_wallet_rounded,
                    color: Colors.white,
                  ),
                ),
                const SizedBox(width: 10),
                const Expanded(
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
                        'VERIFIED IDENTITY',
                        style: TextStyle(
                          fontSize: 10,
                          color: Color(0xFF52705A),
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ],
                  ),
                ),
                Text(
                  slipType,
                  style: const TextStyle(
                    color: primaryGreen,
                    fontSize: 10,
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 14),
            Expanded(
              child: Row(
                children: [
                  IdentityPhoto(
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
                              child: CardField(
                                label: 'DATE OF BIRTH',
                                value: dateOfBirth,
                              ),
                            ),
                            Expanded(
                              child: CardField(
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
                color: Colors.white.withValues(alpha: 0.75),
                borderRadius: BorderRadius.circular(12),
              ),
              child: Row(
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text(
                          'NIN NUMBER',
                          style: TextStyle(
                            fontSize: 9,
                            color: Color(0xFF647A69),
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                        Text(
                          nin,
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

class IdentityPhoto extends StatelessWidget {
  final String photoValue;

  const IdentityPhoto({
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

class CardField extends StatelessWidget {
  final String label;
  final String value;

  const CardField({
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
                color: valueColor ??
                    const Color(
                      0xFF17211A,
                    ),
                fontWeight: FontWeight.w800,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

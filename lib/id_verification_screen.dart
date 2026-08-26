import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';
import 'package:share_plus/share_plus.dart';
import 'package:screenshot/screenshot.dart';
import 'package:gal/gal.dart';

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

  String selectedIdType = 'NIN';
  String selectedSearchType = 'NIN_NUMBER';

  List<Map<String, dynamic>> verificationHistory = [];

  final Map<String, Map<String, dynamic>> idTypes = {
    'NIN': {
      'title': 'NIN',
      'subtitle': 'National Identification Number',
      'icon': Icons.badge_outlined,
      'available': true,
    },
    'BVN': {
      'title': 'BVN',
      'subtitle': 'Bank Verification Number',
      'icon': Icons.account_balance_outlined,
      'available': false,
    },
    'PASSPORT': {
      'title': 'Passport',
      'subtitle': 'International Passport',
      'icon': Icons.public_rounded,
      'available': false,
    },
  };

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

  @override
  void initState() {
    super.initState();

    final String requestedType = widget.initialIdType.trim().toUpperCase();

    selectedIdType = idTypes.containsKey(requestedType) ? requestedType : 'NIN';

    loadVerificationHistory();
  }

  @override
  void dispose() {
    ninController.dispose();
    super.dispose();
  }

  double get selectedFee {
    return 250;
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

  String? validateNin(String? value) {
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
    if (mounted) {
      setState(() {
        isLoadingHistory = true;
      });
    }

    try {
      final SharedPreferences preferences =
          await SharedPreferences.getInstance();

      final String? token = await getSavedAuthToken(preferences);

      if (token == null || token.isEmpty) {
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
                  (item) => Map<String, dynamic>.from(
                    item,
                  ),
                )
                .toList();
          });
        }
      }
    } catch (_) {
      // History failure must not stop NIN verification.
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

    final String submittedNin = ninController.text.trim();

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
              'ninNumber': submittedNin,
              'slipType': 'PREMIUM',
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
        await preferences.remove(
          'auth_token',
        );

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

      final Map<String, dynamic> result = extractSuccessfulResult(
        responseData,
      );

      result['fullNin'] = submittedNin;

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
    } catch (_) {
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
      'slipType': 'PREMIUM',
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

    final Map<String, dynamic> details = nested is Map
        ? Map<String, dynamic>.from(
            nested,
          )
        : {};

    return {
      ...details,
      'verificationId': record['_id']?.toString() ?? '',
      'reference': record['reference']?.toString() ?? '',
      'searchType': record['searchType']?.toString() ?? '',
      'slipType': 'PREMIUM',
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

  String formatDate(String value) {
    try {
      final DateTime parsed = DateTime.parse(value).toLocal();

      return '${parsed.day.toString().padLeft(2, '0')}/'
          '${parsed.month.toString().padLeft(2, '0')}/'
          '${parsed.year}';
    } catch (_) {
      return value;
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

  Widget buildIdTypeCard(String key) {
    final Map<String, dynamic> item = idTypes[key]!;

    final bool selected = selectedIdType == key;

    final bool available = item['available'] == true;

    return SizedBox(
      width: 150,
      child: InkWell(
        onTap: isLoading
            ? null
            : () {
                if (!available) {
                  showMessage(
                    '${item['title']} verification will be available soon.',
                    isError: true,
                  );
                  return;
                }

                setState(() {
                  selectedIdType = key;
                });
              },
        borderRadius: BorderRadius.circular(18),
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 200),
          height: 126,
          padding: const EdgeInsets.symmetric(
            horizontal: 10,
            vertical: 12,
          ),
          decoration: BoxDecoration(
            color: selected ? const Color(0xFFEAF9F4) : Colors.white,
            borderRadius: BorderRadius.circular(18),
            border: Border.all(
              color: selected ? primaryGreen : const Color(0xFFE5E7EB),
              width: selected ? 2.5 : 1,
            ),
          ),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(
                item['icon'] as IconData,
                size: 30,
                color: available ? primaryGreen : Colors.grey,
              ),
              const SizedBox(height: 8),
              Text(
                item['title'].toString(),
                textAlign: TextAlign.center,
                style: TextStyle(
                  color: available ? const Color(0xFF17211A) : Colors.grey,
                  fontSize: 14,
                  fontWeight: FontWeight.w900,
                ),
              ),
              const SizedBox(height: 3),
              Text(
                item['subtitle'].toString(),
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                textAlign: TextAlign.center,
                style: const TextStyle(
                  color: Color(0xFF8A8A94),
                  fontSize: 10,
                  height: 1.1,
                  fontWeight: FontWeight.w600,
                ),
              ),
              if (!available)
                const Padding(
                  padding: EdgeInsets.only(top: 3),
                  child: Text(
                    'Soon',
                    style: TextStyle(
                      color: Colors.orange,
                      fontSize: 10,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                ),
            ],
          ),
        ),
      ),
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
          height: 142,
          padding: const EdgeInsets.symmetric(
            horizontal: 7,
            vertical: 10,
          ),
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
                size: 29,
                color: available ? const Color(0xFF805AD5) : Colors.grey,
              ),
              const SizedBox(height: 8),
              Flexible(
                child: Text(
                  item['title'].toString(),
                  maxLines: 3,
                  overflow: TextOverflow.ellipsis,
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    color: available ? const Color(0xFF29263A) : Colors.grey,
                    fontSize: 13,
                    height: 1.15,
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ),
              if (!available) ...[
                const SizedBox(height: 4),
                const Text(
                  'Soon',
                  style: TextStyle(
                    color: Colors.orange,
                    fontSize: 10,
                    height: 1,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ],
            ],
          ),
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

          final String cardType =
              result['status']?.toString().toUpperCase() == 'SUCCESSFUL'
                  ? 'Premium identity card'
                  : 'NIN verification';

          return Card(
            margin: const EdgeInsets.only(
              bottom: 10,
            ),
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
                  cardType,
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
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF7F8FA),
      appBar: AppBar(
        title: const Text(
          'ID Verification',
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
                      'ID Type',
                    ),
                    const SizedBox(height: 16),
                    SizedBox(
                      height: 126,
                      child: ListView.separated(
                        scrollDirection: Axis.horizontal,
                        itemCount: idTypes.length,
                        separatorBuilder: (_, __) => const SizedBox(
                          width: 10,
                        ),
                        itemBuilder: (context, index) {
                          final String key = idTypes.keys.elementAt(
                            index,
                          );

                          return buildIdTypeCard(
                            key,
                          );
                        },
                      ),
                    ),
                    const SizedBox(height: 28),
                    buildSectionNumber(
                      '2',
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
                      '3',
                      'Premium Identity Card',
                    ),
                    const SizedBox(height: 16),
                    Container(
                      width: double.infinity,
                      padding: const EdgeInsets.all(16),
                      decoration: BoxDecoration(
                        color: const Color(0xFFEAF9F4),
                        borderRadius: BorderRadius.circular(18),
                        border: Border.all(
                          color: const Color(0xFFB9E4D2),
                        ),
                      ),
                      child: const Row(
                        children: [
                          CircleAvatar(
                            radius: 23,
                            backgroundColor: Color(0xFF0A7A3F),
                            child: Icon(
                              Icons.credit_card_rounded,
                              color: Colors.white,
                              size: 25,
                            ),
                          ),
                          SizedBox(width: 12),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  'Premium identity card',
                                  style: TextStyle(
                                    color: Color(0xFF07512D),
                                    fontSize: 15,
                                    fontWeight: FontWeight.w900,
                                  ),
                                ),
                                SizedBox(height: 3),
                                Text(
                                  'One secure Nigerian identity card is generated after successful verification.',
                                  style: TextStyle(
                                    color: Color(0xFF4D6A5A),
                                    fontSize: 12,
                                    height: 1.35,
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: 28),
                    buildSectionNumber(
                      '4',
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
                        fillColor: const Color(
                          0xFFFAFAFB,
                        ),
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
                        color: const Color(
                          0xFFFBF8F3,
                        ),
                        borderRadius: BorderRadius.circular(
                          18,
                        ),
                        border: Border.all(
                          color: const Color(
                            0xFFEAE4DB,
                          ),
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

class VerificationResultScreen extends StatefulWidget {
  final Map<String, dynamic> verification;

  const VerificationResultScreen({
    super.key,
    required this.verification,
  });

  @override
  State<VerificationResultScreen> createState() =>
      _VerificationResultScreenState();
}

class _VerificationResultScreenState extends State<VerificationResultScreen> {
  static const Color primaryGreen = Color(0xFF149B8F);

  final ScreenshotController screenshotController = ScreenshotController();

  bool isDownloading = false;
  bool isSharing = false;

  Map<String, dynamic> get verification => widget.verification;

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

  String formatGender(String gender) {
    final String clean = gender.trim().toLowerCase();

    if (clean == 'm' || clean == 'male') {
      return 'Male';
    }

    if (clean == 'f' || clean == 'female') {
      return 'Female';
    }

    return gender;
  }

  String formatNin(String rawNin) {
    final String clean = rawNin.replaceAll(
      RegExp(r'[^0-9*]'),
      '',
    );

    if (clean.length != 11) {
      return clean.isEmpty ? '***********' : clean;
    }

    return '${clean.substring(0, 3)} '
        '${clean.substring(3, 6)} '
        '${clean.substring(6, 9)} '
        '${clean.substring(9, 11)}';
  }

  String formatDate(String rawDate) {
    final String clean = rawDate.trim();

    if (clean.isEmpty || clean == 'Not provided') {
      return clean;
    }

    try {
      final DateTime parsed = DateTime.parse(clean).toLocal();

      const List<String> months = [
        'JAN',
        'FEB',
        'MAR',
        'APR',
        'MAY',
        'JUN',
        'JUL',
        'AUG',
        'SEP',
        'OCT',
        'NOV',
        'DEC',
      ];

      return '${parsed.day.toString().padLeft(2, '0')} '
          '${months[parsed.month - 1]} '
          '${parsed.year}';
    } catch (_) {
      return clean;
    }
  }

  Future<Uint8List?> captureCard() async {
    try {
      await Future<void>.delayed(
        const Duration(milliseconds: 250),
      );

      return await screenshotController.capture(
        delay: const Duration(milliseconds: 100),
        pixelRatio: 3,
      );
    } catch (_) {
      if (mounted) {
        showMessage(
          'Unable to prepare the NIN card.',
          isError: true,
        );
      }

      return null;
    }
  }

  Future<void> downloadCard() async {
    if (isDownloading || isSharing) {
      return;
    }

    setState(() {
      isDownloading = true;
    });

    try {
      final Uint8List? imageBytes = await captureCard();

      if (imageBytes == null) {
        return;
      }

      await Gal.putImageBytes(
        imageBytes,
        name: 'servicepay_nin_${DateTime.now().millisecondsSinceEpoch}',
      );

      if (mounted) {
        showMessage(
          'NIN card saved to your Gallery.',
          isError: false,
        );
      }
    } catch (_) {
      if (mounted) {
        showMessage(
          'Unable to download the NIN card. Please allow gallery permission and try again.',
          isError: true,
        );
      }
    } finally {
      if (mounted) {
        setState(() {
          isDownloading = false;
        });
      }
    }
  }

  Future<void> shareCard() async {
    if (isSharing || isDownloading) {
      return;
    }

    setState(() {
      isSharing = true;
    });

    try {
      final Uint8List? imageBytes = await captureCard();

      if (imageBytes == null) {
        return;
      }

      if (!mounted) {
        return;
      }

      final RenderBox? renderBox = context.findRenderObject() as RenderBox?;

      await SharePlus.instance.share(
        ShareParams(
          text: 'Premium NIN identity card',
          files: [
            XFile.fromData(
              imageBytes,
              mimeType: 'image/png',
              name: 'servicepay_nin_card.png',
            ),
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
      if (mounted) {
        showMessage(
          'Unable to share the NIN card. Please try again.',
          isError: true,
        );
      }
    } finally {
      if (mounted) {
        setState(() {
          isSharing = false;
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

  Widget buildNonSuccessfulResult(
    BuildContext context, {
    required String status,
    required String reference,
  }) {
    final bool isPending = status.trim().toUpperCase() == 'PENDING';
    final String title =
        isPending ? 'Verification Pending' : 'Verification Failed';
    final String message = isPending
        ? 'This verification is still being processed. No identity card is available yet.'
        : 'This verification was not successful. No identity card was generated.';

    return Scaffold(
      backgroundColor: const Color(0xFFF4F7F6),
      appBar: AppBar(
        title: const Text(
          'NIN Verification',
          style: TextStyle(
            fontWeight: FontWeight.w800,
          ),
        ),
      ),
      body: Center(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24),
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 520),
            child: Container(
              width: double.infinity,
              padding: const EdgeInsets.all(24),
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(22),
                border: Border.all(
                  color: const Color(0xFFE5E7EB),
                ),
              ),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(
                    isPending
                        ? Icons.hourglass_top_rounded
                        : Icons.error_outline_rounded,
                    color: isPending
                        ? const Color(0xFFD97706)
                        : const Color(0xFFDC2626),
                    size: 62,
                  ),
                  const SizedBox(height: 14),
                  Text(
                    title,
                    textAlign: TextAlign.center,
                    style: const TextStyle(
                      fontSize: 22,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                  const SizedBox(height: 10),
                  Text(
                    message,
                    textAlign: TextAlign.center,
                    style: const TextStyle(
                      color: Color(0xFF667085),
                      height: 1.45,
                    ),
                  ),
                  if (reference.isNotEmpty) ...[
                    const SizedBox(height: 18),
                    Text(
                      'Reference: $reference',
                      textAlign: TextAlign.center,
                      style: const TextStyle(
                        color: Color(0xFF475467),
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ],
                  const SizedBox(height: 22),
                  SizedBox(
                    width: double.infinity,
                    height: 50,
                    child: FilledButton(
                      onPressed: () => Navigator.pop(context),
                      style: FilledButton.styleFrom(
                        backgroundColor: primaryGreen,
                      ),
                      child: const Text(
                        'Done',
                        style: TextStyle(
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final String fullName = value(
      const [
        'fullName',
        'full_name',
        'name',
      ],
    );

    final List<String> nameParts = fullName
        .split(' ')
        .where(
          (part) => part.trim().isNotEmpty,
        )
        .toList();

    final String surname = value(
      const [
        'surname',
        'lastName',
        'last_name',
      ],
      fallback: nameParts.isNotEmpty ? nameParts.last : fullName,
    );

    final String firstName = value(
      const [
        'firstName',
        'firstname',
        'first_name',
      ],
      fallback: nameParts.isNotEmpty ? nameParts.first : fullName,
    );

    final String middleName = value(
      const [
        'middleName',
        'middlename',
        'middle_name',
      ],
      fallback: nameParts.length > 2
          ? nameParts.sublist(1, nameParts.length - 1).join(' ')
          : '',
    );

    final String dateOfBirth = formatDate(
      value(
        const [
          'dateOfBirth',
          'date_of_birth',
          'dob',
        ],
      ),
    );

    final String gender = formatGender(
      value(
        const [
          'gender',
          'sex',
        ],
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

    final String stateOfOrigin = value(
      const [
        'stateOfOrigin',
        'state_of_origin',
        'birthstate',
      ],
      fallback: '',
    );

    final String lga = value(
      const [
        'lga',
        'local_government',
        'localGovernment',
      ],
      fallback: '',
    );

    final String nationality = value(
      const [
        'nationality',
        'country',
      ],
      fallback: 'Nigerian',
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

    final String nin = formatNin(
      value(
        const [
          'fullNin',
          'nin',
          'ninNumber',
          'nin_number',
          'ninNumberMasked',
        ],
        fallback: '',
      ),
    );

    final String reference = value(
      const ['reference'],
      fallback: '',
    );

    final String status = value(
      const ['status'],
      fallback: 'SUCCESSFUL',
    );

    if (status.trim().toUpperCase() != 'SUCCESSFUL') {
      return buildNonSuccessfulResult(
        context,
        status: status,
        reference: reference,
      );
    }

    final String verificationDate = formatDate(
      value(
        const ['createdAt'],
        fallback: DateTime.now().toIso8601String(),
      ),
    );

    final String issueDate = formatDate(
      value(
        const [
          'dateOfIssue',
          'date_of_issue',
          'issued_date',
        ],
        fallback: verificationDate,
      ),
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
          style: TextStyle(
            fontWeight: FontWeight.w800,
          ),
        ),
      ),
      body: ListView(
        padding: const EdgeInsets.all(18),
        children: [
          const Icon(
            Icons.verified_rounded,
            color: primaryGreen,
            size: 64,
          ),
          const SizedBox(height: 8),
          const Text(
            'Verification Successful',
            textAlign: TextAlign.center,
            style: TextStyle(
              fontSize: 23,
              fontWeight: FontWeight.w900,
            ),
          ),
          const SizedBox(height: 18),
          Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 720),
              child: Screenshot(
                controller: screenshotController,
                child: VerifiedNinCard(
                  surname: surname,
                  firstName: firstName,
                  middleName: middleName,
                  dateOfBirth: dateOfBirth,
                  gender: gender,
                  nin: nin,
                  photoValue: photo,
                  reference: reference,
                  verificationDate: issueDate,
                  nationality: nationality,
                ),
              ),
            ),
          ),
          const SizedBox(height: 16),
          Row(
            children: [
              Expanded(
                child: SizedBox(
                  height: 54,
                  child: OutlinedButton.icon(
                    onPressed: isDownloading || isSharing ? null : downloadCard,
                    icon: isDownloading
                        ? const SizedBox(
                            width: 20,
                            height: 20,
                            child: CircularProgressIndicator(
                              strokeWidth: 2.3,
                            ),
                          )
                        : const Icon(
                            Icons.download_rounded,
                          ),
                    label: Text(
                      isDownloading ? 'Downloading...' : 'Download Card',
                    ),
                    style: OutlinedButton.styleFrom(
                      foregroundColor: primaryGreen,
                      side: const BorderSide(
                        color: primaryGreen,
                      ),
                    ),
                  ),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: SizedBox(
                  height: 54,
                  child: FilledButton.icon(
                    onPressed: isDownloading || isSharing ? null : shareCard,
                    icon: isSharing
                        ? const SizedBox(
                            width: 20,
                            height: 20,
                            child: CircularProgressIndicator(
                              strokeWidth: 2.3,
                              color: Colors.white,
                            ),
                          )
                        : const Icon(
                            Icons.share_rounded,
                          ),
                    label: Text(
                      isSharing ? 'Preparing...' : 'Share Card',
                    ),
                    style: FilledButton.styleFrom(
                      backgroundColor: primaryGreen,
                    ),
                  ),
                ),
              ),
            ],
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
                  label: 'Surname',
                  value: surname,
                ),
                ResultRow(
                  label: 'First Name',
                  value: firstName,
                ),
                if (middleName.isNotEmpty)
                  ResultRow(
                    label: 'Middle Name',
                    value: middleName,
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
                if (stateOfOrigin.isNotEmpty)
                  ResultRow(
                    label: 'State of Origin',
                    value: stateOfOrigin,
                  ),
                if (lga.isNotEmpty)
                  ResultRow(
                    label: 'LGA',
                    value: lga,
                  ),
                ResultRow(
                  label: 'Nationality',
                  value: nationality,
                ),
                ResultRow(
                  label: 'Card Type',
                  value: 'Premium Identity Card',
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
                    'This verification result is not an official NIMC-issued identity document or a replacement for one.',
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
  static const Color green = Color(0xFF0A7A3F);
  static const Color deepGreen = Color(0xFF07512D);
  static const Color darkText = Color(0xFF171D19);

  final String surname;
  final String firstName;
  final String middleName;
  final String dateOfBirth;
  final String gender;
  final String nin;
  final String photoValue;
  final String reference;
  final String verificationDate;
  final String nationality;

  const VerifiedNinCard({
    super.key,
    required this.surname,
    required this.firstName,
    required this.middleName,
    required this.dateOfBirth,
    required this.gender,
    required this.nin,
    required this.photoValue,
    required this.reference,
    required this.verificationDate,
    required this.nationality,
  });

  String get qrData {
    if (reference.trim().isNotEmpty) {
      return 'NIN:${reference.trim()}';
    }
    return 'NIN:$nin';
  }

  String get sexCode {
    final String value = gender.trim().toUpperCase();
    if (value.startsWith('M')) return 'M';
    if (value.startsWith('F')) return 'F';
    return value;
  }

  String get nationalityCode {
    final String clean = nationality.trim().toUpperCase();
    if (clean.startsWith('NIGER')) return 'NGA';
    if (clean.length >= 3) return clean.substring(0, 3);
    return clean.isEmpty ? 'NGA' : clean;
  }

  @override
  Widget build(BuildContext context) {
    return AspectRatio(
      aspectRatio: 1.45,
      child: Container(
        clipBehavior: Clip.antiAlias,
        decoration: BoxDecoration(
          color: const Color(0xFFF4FAF0),
          borderRadius: BorderRadius.circular(18),
          border: Border.all(
            color: const Color(0xFF7EA989),
            width: 1.2,
          ),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withValues(alpha: 0.11),
              blurRadius: 16,
              offset: const Offset(0, 7),
            ),
          ],
        ),
        child: Stack(
          children: [
            Positioned.fill(
              child: CustomPaint(
                painter: ServicePayNinSecurityPainter(),
              ),
            ),
            Positioned.fill(
              child: IgnorePointer(
                child: Center(
                  child: Opacity(
                    opacity: 0.10,
                    child: Image.asset(
                      'assets/images/nigeria_coat_of_arms.png',
                      width: 220,
                      fit: BoxFit.contain,
                    ),
                  ),
                ),
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(11, 5, 11, 5),
              child: Column(
                children: [
                  SizedBox(
                    height: 50,
                    child: Stack(
                      alignment: Alignment.center,
                      children: [
                        const Positioned(
                          left: 0,
                          top: 0,
                          bottom: 0,
                          child: Image(
                            image: AssetImage(
                              'assets/images/nigeria_coat_of_arms.png',
                            ),
                            width: 42,
                            fit: BoxFit.contain,
                          ),
                        ),
                        const Center(
                          child: Column(
                            mainAxisAlignment: MainAxisAlignment.center,
                            children: [
                              FittedBox(
                                fit: BoxFit.scaleDown,
                                child: Text(
                                  'FEDERAL REPUBLIC OF NIGERIA',
                                  textAlign: TextAlign.center,
                                  style: TextStyle(
                                    color: deepGreen,
                                    fontSize: 12.5,
                                    fontWeight: FontWeight.w900,
                                    letterSpacing: 0.35,
                                  ),
                                ),
                              ),
                              SizedBox(height: 1),
                              Text(
                                'National Identity Card',
                                textAlign: TextAlign.center,
                                style: TextStyle(
                                  color: darkText,
                                  fontSize: 8.4,
                                  fontWeight: FontWeight.w800,
                                  letterSpacing: 0.3,
                                ),
                              ),
                            ],
                          ),
                        ),
                        const Positioned(
                          right: 0,
                          child: _NigeriaFlagMark(),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 4),
                  Expanded(
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        SizedBox(
                          width: 82,
                          child: IdentityPhoto(
                            photoValue: photoValue,
                          ),
                        ),
                        const SizedBox(width: 10),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              ServicePayNinField(
                                label: 'SURNAME',
                                value: surname.toUpperCase(),
                                large: true,
                              ),
                              const SizedBox(height: 5),
                              ServicePayNinField(
                                label: 'FIRST NAME',
                                value: firstName.toUpperCase(),
                                large: true,
                              ),
                              if (middleName.isNotEmpty) ...[
                                const SizedBox(height: 5),
                                ServicePayNinField(
                                  label: 'MIDDLE NAME',
                                  value: middleName.toUpperCase(),
                                ),
                              ],
                              const Spacer(),
                              Row(
                                crossAxisAlignment: CrossAxisAlignment.end,
                                children: [
                                  Expanded(
                                    flex: 2,
                                    child: ServicePayNinField(
                                      label: 'DATE OF BIRTH',
                                      value: dateOfBirth,
                                    ),
                                  ),
                                  const SizedBox(width: 8),
                                  Expanded(
                                    child: ServicePayNinField(
                                      label: 'GENDER',
                                      value: sexCode,
                                    ),
                                  ),
                                ],
                              ),
                            ],
                          ),
                        ),
                        const SizedBox(width: 8),
                        SizedBox(
                          width: 62,
                          child: Column(
                            children: [
                              Container(
                                padding: const EdgeInsets.all(3),
                                decoration: BoxDecoration(
                                  color: Colors.white.withValues(alpha: 0.92),
                                  border: Border.all(
                                    color: const Color(0xFF8DAF91),
                                  ),
                                  borderRadius: BorderRadius.circular(4),
                                ),
                                child: QrImageView(
                                  data: qrData,
                                  version: QrVersions.auto,
                                  size: 52,
                                  padding: EdgeInsets.zero,
                                  gapless: true,
                                  errorCorrectionLevel: QrErrorCorrectLevel.M,
                                ),
                              ),
                              const SizedBox(height: 2),
                              const Text(
                                'SCAN TO VERIFY',
                                textAlign: TextAlign.center,
                                style: TextStyle(
                                  color: deepGreen,
                                  fontSize: 5,
                                  fontWeight: FontWeight.w900,
                                ),
                              ),
                              const Spacer(),
                              const Text(
                                'NATIONALITY',
                                style: TextStyle(
                                  color: Color(0xFF56695B),
                                  fontSize: 5.2,
                                  fontWeight: FontWeight.w800,
                                ),
                              ),
                              Text(
                                nationalityCode,
                                style: const TextStyle(
                                  color: darkText,
                                  fontSize: 13,
                                  height: 1,
                                  fontWeight: FontWeight.w900,
                                ),
                              ),
                              const SizedBox(height: 4),
                              const Text(
                                'ISSUE DATE',
                                style: TextStyle(
                                  color: Color(0xFF56695B),
                                  fontSize: 5.2,
                                  fontWeight: FontWeight.w800,
                                ),
                              ),
                              FittedBox(
                                fit: BoxFit.scaleDown,
                                child: Text(
                                  verificationDate,
                                  style: const TextStyle(
                                    color: darkText,
                                    fontSize: 7,
                                    fontWeight: FontWeight.w900,
                                  ),
                                ),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 5),
                  Container(
                    width: double.infinity,
                    padding: const EdgeInsets.symmetric(
                      horizontal: 7,
                      vertical: 3,
                    ),
                    decoration: BoxDecoration(
                      color: Colors.white.withValues(alpha: 0.48),
                      border: Border(
                        top: BorderSide(
                          color: deepGreen.withValues(alpha: 0.24),
                        ),
                        bottom: BorderSide(
                          color: deepGreen.withValues(alpha: 0.16),
                        ),
                      ),
                    ),
                    child: Column(
                      children: [
                        const Text(
                          'National Identification Number (NIN)',
                          textAlign: TextAlign.center,
                          style: TextStyle(
                            color: darkText,
                            fontSize: 7.2,
                            fontWeight: FontWeight.w900,
                          ),
                        ),
                        FittedBox(
                          fit: BoxFit.scaleDown,
                          child: Text(
                            nin,
                            style: const TextStyle(
                              color: Color(0xFF1F3627),
                              fontSize: 22,
                              height: 1.05,
                              fontWeight: FontWeight.w900,
                              letterSpacing: 3.5,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 3),
                  Row(
                    children: [
                      const _NigeriaFlagMark(
                        width: 31,
                        height: 8,
                      ),
                      const SizedBox(width: 6),
                      Expanded(
                        child: Text(
                          reference.isNotEmpty
                              ? 'REFERENCE: $reference'
                              : 'NATIONAL IDENTITY CARD',
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            color: Color(0xFF526258),
                            fontSize: 5.2,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ),
                      const Text(
                        'NIGERIA',
                        style: TextStyle(
                          color: deepGreen,
                          fontSize: 5.5,
                          fontWeight: FontWeight.w900,
                          letterSpacing: 0.8,
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 1),
                  const FittedBox(
                    fit: BoxFit.scaleDown,
                    child: Text(
                      'VERIFICATION RESULT • NOT AN OFFICIAL NIMC-ISSUED IDENTITY DOCUMENT',
                      style: TextStyle(
                        color: Color(0xFF5D6B62),
                        fontSize: 4.2,
                        fontWeight: FontWeight.w700,
                        letterSpacing: 0.15,
                      ),
                    ),
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

class _NigeriaFlagMark extends StatelessWidget {
  final double width;
  final double height;

  const _NigeriaFlagMark({
    this.width = 36,
    this.height = 10,
  });

  @override
  Widget build(BuildContext context) {
    return ClipRRect(
      borderRadius: BorderRadius.circular(2),
      child: SizedBox(
        width: width,
        height: height,
        child: const Row(
          children: [
            Expanded(child: ColoredBox(color: VerifiedNinCard.green)),
            Expanded(child: ColoredBox(color: Colors.white)),
            Expanded(child: ColoredBox(color: VerifiedNinCard.green)),
          ],
        ),
      ),
    );
  }
}

class ServicePayNinSecurityPainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final Paint primary = Paint()
      ..color = const Color(0xFF1D8246).withValues(alpha: 0.10)
      ..style = PaintingStyle.stroke
      ..strokeWidth = 0.55;

    final Paint fine = Paint()
      ..color = const Color(0xFF7AA36F).withValues(alpha: 0.08)
      ..style = PaintingStyle.stroke
      ..strokeWidth = 0.42;

    for (double y = -8; y < size.height + 10; y += 6.5) {
      final Path p = Path()
        ..moveTo(0, y)
        ..cubicTo(
          size.width * 0.16,
          y - 13,
          size.width * 0.34,
          y + 13,
          size.width * 0.50,
          y,
        )
        ..cubicTo(
          size.width * 0.68,
          y - 12,
          size.width * 0.84,
          y + 12,
          size.width,
          y,
        );

      canvas.drawPath(p, primary);
    }

    for (double radius = 14; radius <= 135; radius += 6) {
      canvas.drawOval(
        Rect.fromCenter(
          center: Offset(
            size.width * 0.07,
            size.height * 0.27,
          ),
          width: radius * 2.35,
          height: radius * 1.15,
        ),
        fine,
      );
    }

    for (double radius = 12; radius <= 125; radius += 6) {
      canvas.drawOval(
        Rect.fromCenter(
          center: Offset(
            size.width * 0.93,
            size.height * 0.69,
          ),
          width: radius * 2.25,
          height: radius * 1.12,
        ),
        fine,
      );
    }

    for (double x = -40; x < size.width + 40; x += 11) {
      final Path p = Path()
        ..moveTo(x, 0)
        ..quadraticBezierTo(
          x + 25,
          size.height * 0.48,
          x,
          size.height,
        );

      canvas.drawPath(p, fine);
    }

    final Paint patch = Paint()
      ..color = const Color(0xFF0C7439).withValues(alpha: 0.055)
      ..style = PaintingStyle.fill;

    final Path topPatch = Path()
      ..moveTo(0, 0)
      ..lineTo(size.width * 0.30, 0)
      ..quadraticBezierTo(
        size.width * 0.20,
        size.height * 0.12,
        0,
        size.height * 0.08,
      )
      ..close();

    canvas.drawPath(topPatch, patch);

    final Path bottomPatch = Path()
      ..moveTo(0, size.height * 0.82)
      ..quadraticBezierTo(
        size.width * 0.24,
        size.height * 0.70,
        size.width * 0.47,
        size.height * 0.84,
      )
      ..quadraticBezierTo(
        size.width * 0.73,
        size.height * 0.97,
        size.width,
        size.height * 0.79,
      )
      ..lineTo(size.width, size.height)
      ..lineTo(0, size.height)
      ..close();

    canvas.drawPath(bottomPatch, patch);
  }

  @override
  bool shouldRepaint(
    covariant CustomPainter oldDelegate,
  ) {
    return false;
  }
}

class NigeriaThemeWatermarkPainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final Paint stroke = Paint()
      ..color = const Color(0xFF0A743A)
      ..style = PaintingStyle.stroke
      ..strokeWidth = 3.2;

    final Paint lightStroke = Paint()
      ..color = const Color(0xFF0A743A)
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.6;

    final Offset c = Offset(
      size.width / 2,
      size.height / 2,
    );

    canvas.drawOval(
      Rect.fromCenter(
        center: c,
        width: size.width * 0.90,
        height: size.height * 0.82,
      ),
      lightStroke,
    );

    canvas.drawOval(
      Rect.fromCenter(
        center: c,
        width: size.width * 0.76,
        height: size.height * 0.70,
      ),
      lightStroke,
    );

    final Path centerShield = Path()
      ..moveTo(c.dx, c.dy - 52)
      ..lineTo(c.dx + 40, c.dy - 32)
      ..lineTo(c.dx + 34, c.dy + 16)
      ..quadraticBezierTo(
        c.dx + 20,
        c.dy + 45,
        c.dx,
        c.dy + 58,
      )
      ..quadraticBezierTo(
        c.dx - 20,
        c.dy + 45,
        c.dx - 34,
        c.dy + 16,
      )
      ..lineTo(c.dx - 40, c.dy - 32)
      ..close();

    canvas.drawPath(centerShield, stroke);

    final Path leftCurve = Path()
      ..moveTo(c.dx - 42, c.dy - 24)
      ..quadraticBezierTo(
        c.dx - 85,
        c.dy - 5,
        c.dx - 66,
        c.dy + 52,
      );

    final Path rightCurve = Path()
      ..moveTo(c.dx + 42, c.dy - 24)
      ..quadraticBezierTo(
        c.dx + 85,
        c.dy - 5,
        c.dx + 66,
        c.dy + 52,
      );

    canvas.drawPath(leftCurve, stroke);
    canvas.drawPath(rightCurve, stroke);

    final Path topMark = Path()
      ..moveTo(c.dx, c.dy - 75)
      ..lineTo(c.dx + 8, c.dy - 60)
      ..lineTo(c.dx - 8, c.dy - 60)
      ..close();

    canvas.drawPath(topMark, stroke);

    canvas.drawArc(
      Rect.fromCenter(
        center: Offset(c.dx, c.dy + 48),
        width: 105,
        height: 38,
      ),
      0.2,
      2.75,
      false,
      stroke,
    );
  }

  @override
  bool shouldRepaint(
    covariant CustomPainter oldDelegate,
  ) {
    return false;
  }
}

class ServicePayNinField extends StatelessWidget {
  final String label;
  final String value;
  final bool large;

  const ServicePayNinField({
    super.key,
    required this.label,
    required this.value,
    this.large = false,
  });

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(
          label,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: const TextStyle(
            color: Color(0xFF56695B),
            fontSize: 6.4,
            fontWeight: FontWeight.w800,
          ),
        ),
        const SizedBox(height: 1),
        FittedBox(
          fit: BoxFit.scaleDown,
          alignment: Alignment.centerLeft,
          child: Text(
            value,
            style: TextStyle(
              color: const Color(0xFF171D19),
              fontSize: large ? 13.2 : 9.6,
              height: 1.0,
              fontWeight: large ? FontWeight.w800 : FontWeight.w700,
              letterSpacing: large ? 0.25 : 0,
            ),
          ),
        ),
      ],
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
  Widget build(BuildContext context) {
    return Container(
      key: const ValueKey<String>('nin-card-photo'),
      width: 82,
      height: 105,
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(
        color: const Color(0xFFE5E7EB),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(
          color: const Color(0xFF8DBD9A),
        ),
      ),
      child: buildImage(),
    );
  }

  Widget buildImage() {
    final String imageValue = photoValue.trim();

    if (imageValue.isEmpty) {
      return const Icon(
        Icons.person,
        size: 55,
        color: Colors.grey,
      );
    }

    if (imageValue.startsWith(
          'http://',
        ) ||
        imageValue.startsWith(
          'https://',
        )) {
      return Image.network(
        imageValue,
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
      String clean = imageValue;

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
  final bool large;

  const CardField({
    super.key,
    required this.label,
    required this.value,
    this.large = false,
  });

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          label,
          style: const TextStyle(
            fontSize: 7,
            color: Color(0xFF647A69),
            fontWeight: FontWeight.w800,
          ),
        ),
        Text(
          value,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: TextStyle(
            color: const Color(0xFF18261E),
            fontSize: large ? 12 : 9,
            fontWeight: FontWeight.w900,
            letterSpacing: large ? 1 : 0,
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
  Widget build(BuildContext context) {
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

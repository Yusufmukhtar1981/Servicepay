import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

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
  String selectedSlipType = 'PREMIUM';

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

  final Map<String, Map<String, dynamic>> slipTypes = {
    'PREMIUM': {
      'title': 'Premium',
      'fee': 250.0,
      'icon': Icons.credit_card_rounded,
    },
    'STANDARD': {
      'title': 'Standard',
      'fee': 250.0,
      'icon': Icons.badge_rounded,
    },
    'REGULAR': {
      'title': 'Regular',
      'fee': 200.0,
      'icon': Icons.article_outlined,
    },
    'INFORMATION': {
      'title': 'Information',
      'fee': 150.0,
      'icon': Icons.description_outlined,
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
    return (slipTypes[selectedSlipType]?['fee'] as num?)?.toDouble() ?? 0;
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

  Widget buildSlipCard(String key) {
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
                          final String key = slipTypes.keys.elementAt(
                            index,
                          );

                          return buildSlipCard(
                            key,
                          );
                        },
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

      final RenderBox? renderBox = context.findRenderObject() as RenderBox?;

      await SharePlus.instance.share(
        ShareParams(
          text: 'ServicePay NIN verification slip',
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

    final String givenNames = value(
      const [
        'givenNames',
        'given_names',
        'firstName',
        'first_name',
      ],
      fallback: nameParts.length > 1
          ? nameParts.take(nameParts.length - 1).join(' ')
          : fullName,
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

    final String slipType = value(
      const ['slipType'],
      fallback: 'PREMIUM',
    );

    final String status = value(
      const ['status'],
      fallback: 'SUCCESSFUL',
    );

    final String verificationDate = formatDate(
      value(
        const ['createdAt'],
        fallback: DateTime.now().toIso8601String(),
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
          Screenshot(
            controller: screenshotController,
            child: VerifiedNinCard(
              surname: surname,
              givenNames: givenNames,
              dateOfBirth: dateOfBirth,
              gender: gender,
              nin: nin,
              photoValue: photo,
              reference: reference,
              verificationDate: verificationDate,
              slipType: slipType,
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
                    'This is a ServicePay verification slip. It is not an official NIMC identity card or a replacement for a government-issued identity document.',
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
  final String givenNames;
  final String dateOfBirth;
  final String gender;
  final String nin;
  final String photoValue;
  final String reference;
  final String verificationDate;
  final String slipType;

  const VerifiedNinCard({
    super.key,
    required this.surname,
    required this.givenNames,
    required this.dateOfBirth,
    required this.gender,
    required this.nin,
    required this.photoValue,
    required this.reference,
    required this.verificationDate,
    required this.slipType,
  });

  String get qrData {
    if (reference.trim().isNotEmpty) {
      return 'SERVICEPAY:NIN_VERIFICATION:${reference.trim()}';
    }
    return 'SERVICEPAY:NIN_VERIFICATION:$nin';
  }

  String get sexCode {
    final String value = gender.trim().toUpperCase();
    if (value.startsWith('M')) return 'M';
    if (value.startsWith('F')) return 'F';
    return value;
  }

  @override
  Widget build(BuildContext context) {
    return AspectRatio(
      aspectRatio: 1.60,
      child: Container(
        clipBehavior: Clip.antiAlias,
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(16),
          border: Border.all(
            color: const Color(0xFF8EAD91),
            width: 1.1,
          ),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withValues(alpha: 0.10),
              blurRadius: 14,
              offset: const Offset(0, 6),
            ),
          ],
        ),
        child: Stack(
          children: [
            const Positioned.fill(
              child: ColoredBox(
                color: Color(0xFFF3F9E9),
              ),
            ),

            Positioned.fill(
              child: CustomPaint(
                painter: ServicePayNinSecurityPainter(),
              ),
            ),

            // Nigeria Coat of Arms watermark
            Positioned.fill(
              child: IgnorePointer(
                child: Center(
                  child: Opacity(
                    opacity: 0.12,
                    child: Image.asset(
                      'assets/images/nigeria_coat_of_arms.png',
                      width: 210,
                      fit: BoxFit.contain,
                    ),
                  ),
                ),
              ),
            ),

            Positioned(
              left: 95,
              top: 35,
              child: Opacity(
                opacity: 0.18,
                child: SizedBox(
                  width: 215,
                  height: 180,
                  child: CustomPaint(
                    painter: NigeriaThemeWatermarkPainter(),
                  ),
                ),
              ),
            ),

            Positioned(
              left: -10,
              bottom: 34,
              child: Transform.rotate(
                angle: -0.44,
                child: Text(
                  reference.isNotEmpty ? reference : 'SERVICEPAY VERIFIED',
                  style: TextStyle(
                    color: green.withValues(alpha: 0.11),
                    fontSize: 13,
                    fontWeight: FontWeight.w700,
                    letterSpacing: 2.3,
                  ),
                ),
              ),
            ),

            Padding(
              padding: const EdgeInsets.fromLTRB(12, 9, 12, 7),
              child: Column(
                children: [
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            FittedBox(
                              fit: BoxFit.scaleDown,
                              alignment: Alignment.center,
                              child: Text(
                                'SERVICEPAY NIN VERIFICATION RESULT',
                                textAlign: TextAlign.center,
                                style: TextStyle(
                                  color: green,
                                  fontSize: 14.2,
                                  fontWeight: FontWeight.w900,
                                  letterSpacing: 0.15,
                                ),
                              ),
                            ),
                            SizedBox(height: 1),
                            Text(
                              'SERVICEPAY VERIFIED DIGITAL NIN SLIP',
                              style: TextStyle(
                                color: Color(0xFF171D19),
                                fontSize: 7.3,
                                fontWeight: FontWeight.w900,
                                letterSpacing: 0.45,
                              ),
                            ),
                          ],
                        ),
                      ),
                      Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 5,
                          vertical: 2,
                        ),
                        decoration: BoxDecoration(
                          color: green.withValues(alpha: 0.10),
                          borderRadius: BorderRadius.circular(5),
                        ),
                        child: const Text(
                          'SERVICEPAY',
                          style: TextStyle(
                            color: deepGreen,
                            fontSize: 5.4,
                            fontWeight: FontWeight.w900,
                          ),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 8),
                  Expanded(
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        SizedBox(
                          width: 96,
                          child: Column(
                            children: [
                              Expanded(
                                child: Container(
                                  clipBehavior: Clip.antiAlias,
                                  decoration: BoxDecoration(
                                    color: const Color(0xFFE0E4E0),
                                    border: Border.all(
                                      color: const Color(0xFF8FAE93),
                                    ),
                                  ),
                                  child: IdentityPhoto(
                                    photoValue: photoValue,
                                  ),
                                ),
                              ),
                              const SizedBox(height: 4),
                              Row(
                                mainAxisAlignment: MainAxisAlignment.center,
                                children: [
                                  Container(
                                    width: 18,
                                    height: 20,
                                    alignment: Alignment.center,
                                    decoration: BoxDecoration(
                                      color: green,
                                      borderRadius: BorderRadius.circular(4),
                                    ),
                                    child: const Text(
                                      'S',
                                      style: TextStyle(
                                        color: Colors.white,
                                        fontSize: 10.5,
                                        fontWeight: FontWeight.w900,
                                      ),
                                    ),
                                  ),
                                  const SizedBox(width: 4),
                                  const Text(
                                    'ServicePay',
                                    style: TextStyle(
                                      color: Color(0xFF171D19),
                                      fontSize: 8.4,
                                      fontWeight: FontWeight.w900,
                                    ),
                                  ),
                                ],
                              ),
                            ],
                          ),
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              ServicePayNinField(
                                label: 'SURNAME/NOM',
                                value: surname.toUpperCase(),
                                large: true,
                              ),
                              const SizedBox(height: 9),
                              ServicePayNinField(
                                label: 'GIVEN NAMES/PRENOMS',
                                value: givenNames.toUpperCase(),
                                large: true,
                              ),
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
                                  const SizedBox(width: 12),
                                  Expanded(
                                    child: ServicePayNinField(
                                      label: 'SEX/SEXE',
                                      value: sexCode,
                                    ),
                                  ),
                                ],
                              ),
                            ],
                          ),
                        ),
                        const SizedBox(width: 11),
                        SizedBox(
                          width: 82,
                          child: Column(
                            children: [
                              Container(
                                padding: const EdgeInsets.all(4),
                                decoration: BoxDecoration(
                                  color: Colors.white.withValues(alpha: 0.96),
                                  border: Border.all(
                                    color: const Color(0xFF8DAF91),
                                  ),
                                ),
                                child: Column(
                                  children: [
                                    QrImageView(
                                      data: qrData,
                                      version: QrVersions.auto,
                                      size: 68,
                                      padding: EdgeInsets.zero,
                                      gapless: true,
                                      errorCorrectionLevel:
                                          QrErrorCorrectLevel.M,
                                    ),
                                    const SizedBox(height: 1),
                                    const Text(
                                      'SCAN TO VERIFY',
                                      textAlign: TextAlign.center,
                                      style: TextStyle(
                                        color: deepGreen,
                                        fontSize: 5.2,
                                        fontWeight: FontWeight.w900,
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                              const Spacer(),
                              const Text(
                                'NATIONALITY',
                                textAlign: TextAlign.center,
                                style: TextStyle(
                                  color: Color(0xFF56695B),
                                  fontSize: 5.3,
                                  fontWeight: FontWeight.w800,
                                ),
                              ),
                              const Text(
                                'NGA',
                                style: TextStyle(
                                  color: Color(0xFF171D19),
                                  fontSize: 14.5,
                                  height: 1.0,
                                  fontWeight: FontWeight.w900,
                                ),
                              ),
                              const SizedBox(height: 5),
                              const Text(
                                'ISSUE DATE',
                                style: TextStyle(
                                  color: Color(0xFF56695B),
                                  fontSize: 5.3,
                                  fontWeight: FontWeight.w800,
                                ),
                              ),
                              FittedBox(
                                fit: BoxFit.scaleDown,
                                child: Text(
                                  verificationDate,
                                  style: const TextStyle(
                                    color: Color(0xFF171D19),
                                    fontSize: 7.4,
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
                  const SizedBox(height: 7),
                  Container(
                    width: double.infinity,
                    padding: const EdgeInsets.symmetric(
                      horizontal: 7,
                      vertical: 4,
                    ),
                    decoration: BoxDecoration(
                      color: Colors.white.withValues(alpha: 0.30),
                      border: Border(
                        top: BorderSide(
                          color: deepGreen.withValues(alpha: 0.22),
                        ),
                      ),
                    ),
                    child: Column(
                      children: [
                        const Text(
                          'National Identification Number (NIN)',
                          textAlign: TextAlign.center,
                          style: TextStyle(
                            color: Color(0xFF171D19),
                            fontSize: 7.4,
                            fontWeight: FontWeight.w900,
                          ),
                        ),
                        const SizedBox(height: 1),
                        FittedBox(
                          fit: BoxFit.scaleDown,
                          child: Text(
                            nin,
                            style: const TextStyle(
                              color: Color(0xFF27372D),
                              fontSize: 24,
                              fontWeight: FontWeight.w800,
                              letterSpacing: 3.7,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 3),
                  Row(
                    children: [
                      const Icon(
                        Icons.verified_rounded,
                        color: green,
                        size: 9,
                      ),
                      const SizedBox(width: 3),
                      Expanded(
                        child: Text(
                          reference.isNotEmpty
                              ? 'SERVICEPAY REF: $reference'
                              : 'Verified via ServicePay',
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            color: Color(0xFF526258),
                            fontSize: 5.1,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ),
                      Text(
                        slipType.toUpperCase(),
                        style: const TextStyle(
                          color: deepGreen,
                          fontSize: 5.4,
                          fontWeight: FontWeight.w900,
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 1),
                  const FittedBox(
                    fit: BoxFit.scaleDown,
                    child: Text(
                      'SERVICEPAY IDENTITY VERIFICATION SLIP • NOT AN OFFICIAL NIMC-ISSUED IDENTITY CARD',
                      style: TextStyle(
                        color: Color(0xFF68716B),
                        fontSize: 4.3,
                        fontWeight: FontWeight.w600,
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

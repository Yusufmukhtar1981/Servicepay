import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

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

  static const Color primaryGreen = Color(0xFF2E7D32);

  final GlobalKey<FormState> formKey = GlobalKey<FormState>();

  final TextEditingController idNumberController = TextEditingController();

  bool hasConsent = false;
  bool isLoading = false;

  late String selectedIdType;

  final Map<String, Map<String, dynamic>> idTypes = {
    'NIN': {
      'shortTitle': 'NIN',
      'title': 'National Identification Number',
      'description': 'Verify a National Identification Number',
      'fee': 500.0,
      'length': 11,
      'icon': Icons.badge_outlined,
      'available': true,
    },
    'BVN': {
      'shortTitle': 'BVN',
      'title': 'Bank Verification Number',
      'description': 'Verify a Bank Verification Number',
      'fee': 500.0,
      'length': 11,
      'icon': Icons.account_balance_outlined,
      'available': false,
    },
    'DRIVER_LICENSE': {
      'shortTitle': 'Driver License',
      'title': "Driver's License",
      'description': "Verify a Nigerian driver's licence",
      'fee': 700.0,
      'length': 0,
      'icon': Icons.drive_eta_outlined,
      'available': false,
    },
    'PASSPORT': {
      'shortTitle': 'Passport',
      'title': 'International Passport',
      'description': 'Verify an international passport',
      'fee': 700.0,
      'length': 0,
      'icon': Icons.public_outlined,
      'available': false,
    },
    'VOTER_CARD': {
      'shortTitle': 'Voter Card',
      'title': "Voter's Card",
      'description': "Verify a permanent voter's card",
      'fee': 700.0,
      'length': 0,
      'icon': Icons.how_to_vote_outlined,
      'available': false,
    },
  };

  @override
  void initState() {
    super.initState();

    final String requestedType = widget.initialIdType.trim().toUpperCase();

    selectedIdType = idTypes.containsKey(requestedType) &&
            idTypes[requestedType]?['available'] == true
        ? requestedType
        : 'NIN';
  }

  @override
  void dispose() {
    idNumberController.dispose();
    super.dispose();
  }

  double get selectedFee {
    return (idTypes[selectedIdType]?['fee'] as num?)?.toDouble() ?? 0;
  }

  String get selectedTitle {
    return idTypes[selectedIdType]?['title']?.toString() ?? 'ID Verification';
  }

  String get selectedShortTitle {
    return idTypes[selectedIdType]?['shortTitle']?.toString() ?? selectedIdType;
  }

  int get expectedLength {
    return idTypes[selectedIdType]?['length'] as int? ?? 0;
  }

  bool get selectedTypeAvailable {
    return idTypes[selectedIdType]?['available'] == true;
  }

  bool get usesNumericKeyboard {
    return selectedIdType == 'NIN' || selectedIdType == 'BVN';
  }

  Future<String?> getSavedAuthToken(
    SharedPreferences preferences,
  ) async {
    const List<String> possibleTokenKeys = [
      'auth_token',
      'token',
      'access_token',
      'accessToken',
      'jwt_token',
      'jwt',
    ];

    for (final String key in possibleTokenKeys) {
      final String? savedValue = preferences.getString(key);

      if (savedValue == null || savedValue.trim().isEmpty) {
        continue;
      }

      String token = savedValue.trim();

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

  String? validateIdNumber(
    String? value,
  ) {
    final String idNumber = value?.trim() ?? '';

    if (!selectedTypeAvailable) {
      return '$selectedShortTitle verification is coming soon';
    }

    if (idNumber.isEmpty) {
      return 'Enter the ID number';
    }

    if (usesNumericKeyboard) {
      if (!RegExp(r'^\d+$').hasMatch(idNumber)) {
        return '$selectedShortTitle must contain numbers only';
      }

      if (idNumber.length != expectedLength) {
        return '$selectedShortTitle must be exactly '
            '$expectedLength digits';
      }
    } else {
      if (idNumber.length < 5) {
        return 'Enter a valid ID number';
      }

      if (!RegExp(r'^[a-zA-Z0-9\-\/]+$').hasMatch(idNumber)) {
        return 'Enter a valid ID number';
      }
    }

    return null;
  }

  Future<void> verifyId() async {
    FocusScope.of(context).unfocus();

    if (!selectedTypeAvailable) {
      showMessage(
        '$selectedShortTitle verification is coming soon.',
        isError: true,
      );
      return;
    }

    final bool valid = formKey.currentState?.validate() ?? false;

    if (!valid) {
      return;
    }

    if (!hasConsent) {
      showMessage(
        'You must confirm that you have permission to verify this ID.',
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

      final String? token = await getSavedAuthToken(
        preferences,
      );

      if (!mounted) {
        return;
      }

      if (token == null || token.trim().isEmpty) {
        showMessage(
          'Your login session has expired. Please log out and log in again.',
          isError: true,
        );
        return;
      }

      final http.Response response = await http
          .post(
            Uri.parse(
              '$baseUrl/id-verification/verify',
            ),
            headers: {
              'Accept': 'application/json',
              'Content-Type': 'application/json',
              'Authorization': 'Bearer ${token.trim()}',
            },
            body: jsonEncode({
              'idType': selectedIdType,
              'idNumber': idNumberController.text.trim(),
              'consent': true,
            }),
          )
          .timeout(
            const Duration(
              seconds: 65,
            ),
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
          _messageFromResponse(
            responseData,
            fallback:
                'Your login session is invalid. Please log out and log in again.',
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
          _messageFromResponse(
            responseData,
            fallback:
                'ID verification failed. Server status: ${response.statusCode}.',
          ),
          isError: true,
        );
        return;
      }

      final Map<String, dynamic> verification = extractVerification(
        responseData,
      );

      await saveNewWalletBalance(
        preferences,
        responseData,
        verification,
      );

      if (!mounted) {
        return;
      }

      await showVerificationResult(
        verification,
        responseData['message']?.toString() ?? 'ID verified successfully.',
      );

      if (!mounted) {
        return;
      }

      idNumberController.clear();

      setState(() {
        hasConsent = false;
      });
    } on TimeoutException {
      if (!mounted) {
        return;
      }

      showMessage(
        'The verification request timed out. Please try again.',
        isError: true,
      );
    } on http.ClientException {
      if (!mounted) {
        return;
      }

      showMessage(
        'Unable to connect to the verification server.',
        isError: true,
      );
    } catch (error) {
      if (!mounted) {
        return;
      }

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

  Map<String, dynamic> decodeServerResponse(
    http.Response response,
  ) {
    final String body = response.body.trim();

    if (body.isEmpty) {
      return {
        'success': false,
        'message':
            'The server returned an empty response. Status: ${response.statusCode}.',
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
      String shortBody = body;

      if (shortBody.length > 180) {
        shortBody = shortBody.substring(0, 180);
      }

      return {
        'success': false,
        'message':
            'The server did not return valid JSON. Status: ${response.statusCode}. $shortBody',
      };
    }
  }

  Map<String, dynamic> extractVerification(
    Map<String, dynamic> responseData,
  ) {
    final dynamic direct = responseData['verification'];

    if (direct is Map) {
      return Map<String, dynamic>.from(
        direct,
      );
    }

    final dynamic data = responseData['data'];

    if (data is Map) {
      final dynamic nested = data['verification'];

      if (nested is Map) {
        return Map<String, dynamic>.from(
          nested,
        );
      }

      return Map<String, dynamic>.from(
        data,
      );
    }

    return {};
  }

  String _messageFromResponse(
    Map<String, dynamic> responseData, {
    required String fallback,
  }) {
    final dynamic value = responseData['message'] ??
        responseData['error'] ??
        responseData['detail'];

    final String message = value?.toString().trim() ?? '';

    return message.isEmpty ? fallback : message;
  }

  Future<void> saveNewWalletBalance(
    SharedPreferences preferences,
    Map<String, dynamic> responseData,
    Map<String, dynamic> verification,
  ) async {
    final dynamic balanceValue = verification['walletBalance'] ??
        responseData['walletBalance'] ??
        responseData['balance'];

    if (balanceValue == null) {
      return;
    }

    final double? walletBalance = double.tryParse(
      balanceValue.toString(),
    );

    if (walletBalance == null) {
      return;
    }

    await preferences.setDouble(
      'wallet_balance',
      walletBalance,
    );
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

  Future<void> showVerificationResult(
    Map<String, dynamic> verification,
    String message,
  ) async {
    final String fullName = firstAvailableValue(
          verification,
          const [
            'fullName',
            'full_name',
            'name',
          ],
        ) ??
        'Not provided';

    final String firstName = firstAvailableValue(
          verification,
          const [
            'firstName',
            'first_name',
            'firstname',
          ],
        ) ??
        '';

    final String middleName = firstAvailableValue(
          verification,
          const [
            'middleName',
            'middle_name',
            'middlename',
          ],
        ) ??
        '';

    final String lastName = firstAvailableValue(
          verification,
          const [
            'lastName',
            'last_name',
            'lastname',
            'surname',
          ],
        ) ??
        '';

    final String dateOfBirth = firstAvailableValue(
          verification,
          const [
            'dateOfBirth',
            'date_of_birth',
            'dob',
          ],
        ) ??
        'Not provided';

    final String gender = formatGender(
      firstAvailableValue(
            verification,
            const [
              'gender',
              'sex',
            ],
          ) ??
          'Not provided',
    );

    final String phone = firstAvailableValue(
          verification,
          const [
            'phone',
            'phoneNumber',
            'phone_number',
          ],
        ) ??
        'Not provided';

    final String address = firstAvailableValue(
          verification,
          const [
            'address',
            'residentialAddress',
            'residential_address',
            'residence_address',
          ],
        ) ??
        'Not provided';

    final String maskedIdNumber = firstAvailableValue(
          verification,
          const [
            'maskedIdNumber',
            'masked_id_number',
          ],
        ) ??
        maskIdNumber(
          idNumberController.text.trim(),
        );

    final String status = firstAvailableValue(
          verification,
          const ['status'],
        ) ??
        'Verified';

    final String reference = firstAvailableValue(
          verification,
          const [
            'reference',
            'providerReference',
          ],
        ) ??
        '';

    final String photoValue = firstAvailableValue(
          verification,
          const [
            'photo',
            'image',
            'base64Image',
            'photo_base64',
          ],
        ) ??
        '';

    final String createdAt = firstAvailableValue(
          verification,
          const [
            'createdAt',
            'created_at',
          ],
        ) ??
        '';

    final dynamic amountValue = verification['amountCharged'];

    final double amountCharged = double.tryParse(
          amountValue?.toString() ?? '',
        ) ??
        selectedFee;

    final dynamic balanceValue = verification['walletBalance'];

    final double? walletBalance = balanceValue == null
        ? null
        : double.tryParse(
            balanceValue.toString(),
          );

    if (!mounted) {
      return;
    }

    await Navigator.of(context).push<void>(
      MaterialPageRoute(
        builder: (_) => _VerificationResultScreen(
          idType: selectedShortTitle,
          fullName: fullName,
          firstName: firstName,
          middleName: middleName,
          lastName: lastName,
          dateOfBirth: dateOfBirth,
          gender: gender,
          phone: phone,
          address: address,
          maskedIdNumber: maskedIdNumber,
          status: status,
          reference: reference,
          photoValue: photoValue,
          createdAt: createdAt,
          amountCharged: amountCharged,
          walletBalance: walletBalance,
          message: message,
        ),
      ),
    );
  }

  String formatGender(
    String value,
  ) {
    final String clean = value.trim().toLowerCase();

    if (clean == 'm' || clean == 'male') {
      return 'Male';
    }

    if (clean == 'f' || clean == 'female') {
      return 'Female';
    }

    return value;
  }

  String? firstAvailableValue(
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

  String maskIdNumber(
    String value,
  ) {
    final String idNumber = value.trim();

    if (idNumber.length <= 4) {
      return '****';
    }

    return '${'*' * (idNumber.length - 4)}'
        '${idNumber.substring(idNumber.length - 4)}';
  }

  Widget buildIdTypeCard(
    String idType,
  ) {
    final Map<String, dynamic> details = idTypes[idType]!;

    final bool isSelected = selectedIdType == idType;

    final bool available = details['available'] == true;

    final ColorScheme colorScheme = Theme.of(context).colorScheme;

    return InkWell(
      onTap: isLoading
          ? null
          : () {
              if (!available) {
                showMessage(
                  '${details['shortTitle']} verification is coming soon.',
                  isError: true,
                );
                return;
              }

              setState(() {
                selectedIdType = idType;
                idNumberController.clear();
                hasConsent = false;
              });
            },
      borderRadius: BorderRadius.circular(14),
      child: AnimatedContainer(
        duration: const Duration(
          milliseconds: 200,
        ),
        width: 155,
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: isSelected ? colorScheme.primaryContainer : Colors.white,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(
            color: isSelected ? colorScheme.primary : Colors.grey.shade300,
            width: isSelected ? 2 : 1,
          ),
        ),
        child: Stack(
          children: [
            Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Icon(
                  details['icon'] as IconData,
                  size: 30,
                  color: available
                      ? isSelected
                          ? colorScheme.primary
                          : Colors.grey.shade700
                      : Colors.grey.shade400,
                ),
                const SizedBox(
                  height: 12,
                ),
                Text(
                  details['shortTitle'].toString(),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    fontWeight: FontWeight.bold,
                    color: available ? null : Colors.grey,
                  ),
                ),
                const SizedBox(
                  height: 5,
                ),
                Text(
                  available
                      ? '₦${(details['fee'] as num).toStringAsFixed(0)}'
                      : 'Coming Soon',
                  style: TextStyle(
                    color: available
                        ? isSelected
                            ? colorScheme.primary
                            : Colors.grey.shade700
                        : Colors.orange.shade700,
                    fontSize: available ? 14 : 11,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ],
            ),
            if (!available)
              const Positioned(
                top: 0,
                right: 0,
                child: Icon(
                  Icons.lock_clock_outlined,
                  size: 17,
                  color: Colors.orange,
                ),
              ),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(
    BuildContext context,
  ) {
    final ColorScheme colorScheme = Theme.of(context).colorScheme;

    return Scaffold(
      backgroundColor: const Color(0xFFF8FAFC),
      appBar: AppBar(
        title: const Text(
          'ID Verification',
        ),
      ),
      body: SafeArea(
        child: Form(
          key: formKey,
          child: ListView(
            padding: const EdgeInsets.all(18),
            children: [
              Container(
                padding: const EdgeInsets.all(18),
                decoration: BoxDecoration(
                  gradient: const LinearGradient(
                    colors: [
                      Color(0xFF2E7D32),
                      Color(0xFF43A047),
                    ],
                  ),
                  borderRadius: BorderRadius.circular(
                    18,
                  ),
                ),
                child: const Row(
                  children: [
                    CircleAvatar(
                      radius: 27,
                      backgroundColor: Colors.white24,
                      child: Icon(
                        Icons.verified_user_outlined,
                        color: Colors.white,
                        size: 30,
                      ),
                    ),
                    SizedBox(
                      width: 15,
                    ),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'Verify an Identity',
                            style: TextStyle(
                              color: Colors.white,
                              fontSize: 19,
                              fontWeight: FontWeight.bold,
                            ),
                          ),
                          SizedBox(
                            height: 5,
                          ),
                          Text(
                            'Confirm identity information securely using an authorised ID number.',
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
              const SizedBox(
                height: 25,
              ),
              const Text(
                'Select ID Type',
                style: TextStyle(
                  fontSize: 17,
                  fontWeight: FontWeight.bold,
                ),
              ),
              const SizedBox(
                height: 12,
              ),
              SizedBox(
                height: 130,
                child: ListView.separated(
                  scrollDirection: Axis.horizontal,
                  itemCount: idTypes.length,
                  separatorBuilder: (_, __) => const SizedBox(
                    width: 10,
                  ),
                  itemBuilder: (context, index) {
                    final String idType = idTypes.keys.elementAt(
                      index,
                    );

                    return buildIdTypeCard(
                      idType,
                    );
                  },
                ),
              ),
              const SizedBox(
                height: 25,
              ),
              Text(
                selectedTitle,
                style: const TextStyle(
                  fontSize: 16,
                  fontWeight: FontWeight.w600,
                ),
              ),
              const SizedBox(
                height: 10,
              ),
              TextFormField(
                key: ValueKey(selectedIdType),
                controller: idNumberController,
                enabled: !isLoading && selectedTypeAvailable,
                keyboardType: usesNumericKeyboard
                    ? TextInputType.number
                    : TextInputType.text,
                textCapitalization: TextCapitalization.characters,
                maxLength: expectedLength > 0 ? expectedLength : null,
                inputFormatters: usesNumericKeyboard
                    ? [
                        FilteringTextInputFormatter.digitsOnly,
                        if (expectedLength > 0)
                          LengthLimitingTextInputFormatter(
                            expectedLength,
                          ),
                      ]
                    : null,
                validator: validateIdNumber,
                decoration: InputDecoration(
                  labelText: '$selectedShortTitle Number',
                  hintText: usesNumericKeyboard
                      ? 'Enter 11-digit number'
                      : 'Enter ID number',
                  counterText: '',
                  prefixIcon: const Icon(
                    Icons.numbers,
                  ),
                  filled: true,
                  fillColor: Colors.white,
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(
                      14,
                    ),
                  ),
                ),
              ),
              const SizedBox(
                height: 18,
              ),
              Container(
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  color: Colors.orange.shade50,
                  borderRadius: BorderRadius.circular(
                    14,
                  ),
                  border: Border.all(
                    color: Colors.orange.shade200,
                  ),
                ),
                child: Row(
                  children: [
                    Icon(
                      Icons.account_balance_wallet_outlined,
                      color: Colors.orange.shade800,
                    ),
                    const SizedBox(
                      width: 12,
                    ),
                    const Expanded(
                      child: Text(
                        'Verification fee',
                        style: TextStyle(
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ),
                    Text(
                      '₦${selectedFee.toStringAsFixed(0)}',
                      style: TextStyle(
                        color: Colors.orange.shade900,
                        fontSize: 18,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(
                height: 15,
              ),
              CheckboxListTile(
                value: hasConsent,
                onChanged: isLoading || !selectedTypeAvailable
                    ? null
                    : (bool? value) {
                        setState(() {
                          hasConsent = value ?? false;
                        });
                      },
                controlAffinity: ListTileControlAffinity.leading,
                contentPadding: EdgeInsets.zero,
                title: const Text(
                  'I confirm that I have permission to verify this identity.',
                  style: TextStyle(
                    fontSize: 14,
                  ),
                ),
              ),
              const SizedBox(
                height: 16,
              ),
              SizedBox(
                height: 54,
                child: FilledButton.icon(
                  onPressed:
                      isLoading || !selectedTypeAvailable ? null : verifyId,
                  style: FilledButton.styleFrom(
                    backgroundColor: primaryGreen,
                  ),
                  icon: isLoading
                      ? const SizedBox(
                          width: 21,
                          height: 21,
                          child: CircularProgressIndicator(
                            strokeWidth: 2.5,
                            color: Colors.white,
                          ),
                        )
                      : const Icon(
                          Icons.verified_outlined,
                        ),
                  label: Text(
                    isLoading
                        ? 'Verifying...'
                        : selectedTypeAvailable
                            ? 'Verify Now — ₦${selectedFee.toStringAsFixed(0)}'
                            : 'Coming Soon',
                    style: const TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                ),
              ),
              const SizedBox(
                height: 18,
              ),
              const Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Icon(
                    Icons.lock_outline,
                    size: 19,
                    color: Colors.grey,
                  ),
                  SizedBox(
                    width: 8,
                  ),
                  Expanded(
                    child: Text(
                      'The verification fee will only be deducted after verification succeeds.',
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
      ),
    );
  }
}

class _VerificationResultScreen extends StatelessWidget {
  static const Color primaryGreen = Color(0xFF2E7D32);

  final String idType;
  final String fullName;
  final String firstName;
  final String middleName;
  final String lastName;
  final String dateOfBirth;
  final String gender;
  final String phone;
  final String address;
  final String maskedIdNumber;
  final String status;
  final String reference;
  final String photoValue;
  final String createdAt;
  final double amountCharged;
  final double? walletBalance;
  final String message;

  const _VerificationResultScreen({
    required this.idType,
    required this.fullName,
    required this.firstName,
    required this.middleName,
    required this.lastName,
    required this.dateOfBirth,
    required this.gender,
    required this.phone,
    required this.address,
    required this.maskedIdNumber,
    required this.status,
    required this.reference,
    required this.photoValue,
    required this.createdAt,
    required this.amountCharged,
    required this.walletBalance,
    required this.message,
  });

  @override
  Widget build(
    BuildContext context,
  ) {
    return Scaffold(
      backgroundColor: const Color(0xFFF4F7F5),
      appBar: AppBar(
        title: const Text(
          'Verification Result',
        ),
        backgroundColor: primaryGreen,
        foregroundColor: Colors.white,
      ),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(18),
          children: [
            const Icon(
              Icons.verified_rounded,
              color: primaryGreen,
              size: 66,
            ),
            const SizedBox(
              height: 10,
            ),
            const Text(
              'Verification Successful',
              textAlign: TextAlign.center,
              style: TextStyle(
                fontSize: 25,
                fontWeight: FontWeight.w900,
                color: Color(0xFF17211A),
              ),
            ),
            const SizedBox(
              height: 6,
            ),
            Text(
              message,
              textAlign: TextAlign.center,
              style: const TextStyle(
                color: Color(0xFF6B7280),
              ),
            ),
            const SizedBox(
              height: 22,
            ),

            /*
             * This is a ServicePay-generated
             * verification result card.
             * It is not an official government ID.
             */
            _VerifiedIdentityCard(
              idType: idType,
              fullName: fullName,
              dateOfBirth: dateOfBirth,
              gender: gender,
              maskedIdNumber: maskedIdNumber,
              photoValue: photoValue,
              reference: reference,
            ),
            const SizedBox(
              height: 18,
            ),
            Container(
              padding: const EdgeInsets.all(17),
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(
                  18,
                ),
                border: Border.all(
                  color: const Color(
                    0xFFE5E7EB,
                  ),
                ),
              ),
              child: Column(
                children: [
                  _ResultDetailRow(
                    label: 'ID Type',
                    value: idType,
                  ),
                  _ResultDetailRow(
                    label: 'ID Number',
                    value: maskedIdNumber,
                  ),
                  _ResultDetailRow(
                    label: 'Full Name',
                    value: fullName,
                  ),
                  if (firstName.isNotEmpty)
                    _ResultDetailRow(
                      label: 'First Name',
                      value: firstName,
                    ),
                  if (middleName.isNotEmpty)
                    _ResultDetailRow(
                      label: 'Middle Name',
                      value: middleName,
                    ),
                  if (lastName.isNotEmpty)
                    _ResultDetailRow(
                      label: 'Last Name',
                      value: lastName,
                    ),
                  _ResultDetailRow(
                    label: 'Date of Birth',
                    value: dateOfBirth,
                  ),
                  _ResultDetailRow(
                    label: 'Gender',
                    value: gender,
                  ),
                  _ResultDetailRow(
                    label: 'Phone',
                    value: phone,
                  ),
                  _ResultDetailRow(
                    label: 'Address',
                    value: address,
                  ),
                  _ResultDetailRow(
                    label: 'Status',
                    value: status,
                    valueColor: primaryGreen,
                  ),
                  if (reference.isNotEmpty)
                    _ResultDetailRow(
                      label: 'Reference',
                      value: reference,
                    ),
                  if (createdAt.isNotEmpty)
                    _ResultDetailRow(
                      label: 'Verified At',
                      value: createdAt,
                    ),
                  _ResultDetailRow(
                    label: 'Amount Charged',
                    value: '₦${amountCharged.toStringAsFixed(2)}',
                  ),
                  if (walletBalance != null)
                    _ResultDetailRow(
                      label: 'Wallet Balance',
                      value: '₦${walletBalance!.toStringAsFixed(2)}',
                      showDivider: false,
                    )
                  else
                    const SizedBox.shrink(),
                ],
              ),
            ),
            const SizedBox(
              height: 18,
            ),
            Container(
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(
                color: const Color(
                  0xFFFFF7ED,
                ),
                borderRadius: BorderRadius.circular(
                  14,
                ),
                border: Border.all(
                  color: const Color(
                    0xFFFED7AA,
                  ),
                ),
              ),
              child: const Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Icon(
                    Icons.info_outline_rounded,
                    color: Color(
                      0xFFEA580C,
                    ),
                  ),
                  SizedBox(
                    width: 10,
                  ),
                  Expanded(
                    child: Text(
                      'This card is a ServicePay verification result. It is not a replacement for an official government-issued identity card.',
                      style: TextStyle(
                        color: Color(
                          0xFF7C2D12,
                        ),
                        height: 1.4,
                      ),
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(
              height: 22,
            ),
            SizedBox(
              height: 54,
              child: FilledButton(
                onPressed: () {
                  Navigator.pop(
                    context,
                  );
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
      ),
    );
  }
}

class _VerifiedIdentityCard extends StatelessWidget {
  static const Color primaryGreen = Color(0xFF2E7D32);

  final String idType;
  final String fullName;
  final String dateOfBirth;
  final String gender;
  final String maskedIdNumber;
  final String photoValue;
  final String reference;

  const _VerifiedIdentityCard({
    required this.idType,
    required this.fullName,
    required this.dateOfBirth,
    required this.gender,
    required this.maskedIdNumber,
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
              Color(0xFFF8FFF9),
              Color(0xFFDDF4E2),
            ],
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
          ),
          borderRadius: BorderRadius.circular(
            22,
          ),
          border: Border.all(
            color: const Color(
              0xFFA7D9AF,
            ),
          ),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withValues(
                alpha: 0.10,
              ),
              blurRadius: 18,
              offset: const Offset(
                0,
                8,
              ),
            ),
          ],
        ),
        child: Stack(
          children: [
            Positioned(
              right: -20,
              top: -25,
              child: Icon(
                Icons.verified_user_rounded,
                size: 150,
                color: primaryGreen.withValues(
                  alpha: 0.06,
                ),
              ),
            ),
            Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Row(
                  children: [
                    CircleAvatar(
                      radius: 20,
                      backgroundColor: primaryGreen,
                      child: Icon(
                        Icons.account_balance_wallet_rounded,
                        color: Colors.white,
                      ),
                    ),
                    SizedBox(
                      width: 10,
                    ),
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
                            'VERIFIED IDENTITY',
                            style: TextStyle(
                              fontSize: 10,
                              color: Color(
                                0xFF52705A,
                              ),
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
                const SizedBox(
                  height: 15,
                ),
                Expanded(
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      _IdentityPhoto(
                        photoValue: photoValue,
                      ),
                      const SizedBox(
                        width: 14,
                      ),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            const Text(
                              'FULL NAME',
                              style: TextStyle(
                                fontSize: 9,
                                color: Color(
                                  0xFF647A69,
                                ),
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                            const SizedBox(
                              height: 3,
                            ),
                            Text(
                              fullName.toUpperCase(),
                              maxLines: 2,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(
                                fontSize: 16,
                                height: 1.05,
                                fontWeight: FontWeight.w900,
                                color: Color(
                                  0xFF17211A,
                                ),
                              ),
                            ),
                            const Spacer(),
                            Row(
                              children: [
                                Expanded(
                                  child: _CardField(
                                    label: 'DATE OF BIRTH',
                                    value: dateOfBirth,
                                  ),
                                ),
                                const SizedBox(
                                  width: 8,
                                ),
                                Expanded(
                                  child: _CardField(
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
                const SizedBox(
                  height: 12,
                ),
                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.symmetric(
                    horizontal: 12,
                    vertical: 9,
                  ),
                  decoration: BoxDecoration(
                    color: Colors.white.withValues(
                      alpha: 0.70,
                    ),
                    borderRadius: BorderRadius.circular(
                      12,
                    ),
                  ),
                  child: Row(
                    children: [
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              '$idType NUMBER',
                              style: const TextStyle(
                                fontSize: 9,
                                color: Color(
                                  0xFF647A69,
                                ),
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                            const SizedBox(
                              height: 2,
                            ),
                            Text(
                              maskedIdNumber,
                              style: const TextStyle(
                                fontSize: 17,
                                letterSpacing: 1.2,
                                fontWeight: FontWeight.w900,
                                color: Color(
                                  0xFF17211A,
                                ),
                              ),
                            ),
                          ],
                        ),
                      ),
                      if (reference.isNotEmpty)
                        const Icon(
                          Icons.qr_code_2_rounded,
                          size: 36,
                          color: primaryGreen,
                        ),
                    ],
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _IdentityPhoto extends StatelessWidget {
  final String photoValue;

  const _IdentityPhoto({
    required this.photoValue,
  });

  @override
  Widget build(
    BuildContext context,
  ) {
    return Container(
      width: 88,
      height: 105,
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(
        color: const Color(0xFFE5E7EB),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(
          color: const Color(
            0xFFA7D9AF,
          ),
        ),
      ),
      child: _buildImage(),
    );
  }

  Widget _buildImage() {
    final String value = photoValue.trim();

    if (value.isEmpty) {
      return const Icon(
        Icons.person_rounded,
        size: 58,
        color: Color(0xFF9CA3AF),
      );
    }

    if (value.startsWith('http://') || value.startsWith('https://')) {
      return Image.network(
        value,
        fit: BoxFit.cover,
        errorBuilder: (_, __, ___) {
          return const Icon(
            Icons.person_rounded,
            size: 58,
            color: Color(0xFF9CA3AF),
          );
        },
      );
    }

    try {
      String cleanBase64 = value;

      if (cleanBase64.contains(',')) {
        cleanBase64 = cleanBase64.split(',').last;
      }

      cleanBase64 = cleanBase64.replaceAll(
        RegExp(r'\s+'),
        '',
      );

      final Uint8List bytes = base64Decode(cleanBase64);

      return Image.memory(
        bytes,
        fit: BoxFit.cover,
        errorBuilder: (_, __, ___) {
          return const Icon(
            Icons.person_rounded,
            size: 58,
            color: Color(0xFF9CA3AF),
          );
        },
      );
    } catch (_) {
      return const Icon(
        Icons.person_rounded,
        size: 58,
        color: Color(0xFF9CA3AF),
      );
    }
  }
}

class _CardField extends StatelessWidget {
  final String label;
  final String value;

  const _CardField({
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
        const SizedBox(
          height: 2,
        ),
        Text(
          value,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: const TextStyle(
            fontSize: 11,
            fontWeight: FontWeight.w800,
            color: Color(0xFF17211A),
          ),
        ),
      ],
    );
  }
}

class _ResultDetailRow extends StatelessWidget {
  final String label;
  final String value;
  final Color? valueColor;
  final bool showDivider;

  const _ResultDetailRow({
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
      width: double.infinity,
      padding: const EdgeInsets.symmetric(
        vertical: 12,
      ),
      decoration: BoxDecoration(
        border: showDivider
            ? const Border(
                bottom: BorderSide(
                  color: Color(
                    0xFFE5E7EB,
                  ),
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
                color: Color(
                  0xFF6B7280,
                ),
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
          const SizedBox(
            width: 12,
          ),
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

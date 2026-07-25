import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

class IdVerificationScreen extends StatefulWidget {
  final String initialIdType;

  const IdVerificationScreen({
    super.key,
    this.initialIdType = 'NIN',
  });

  @override
  State<IdVerificationScreen> createState() =>
      _IdVerificationScreenState();
}

class _IdVerificationScreenState extends State<IdVerificationScreen> {
  static const String baseUrl = 'https://api.servicepay.ng/api';

  final GlobalKey<FormState> formKey = GlobalKey<FormState>();

  final TextEditingController idNumberController =
      TextEditingController();

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
    },
    'BVN': {
      'shortTitle': 'BVN',
      'title': 'Bank Verification Number',
      'description': 'Verify a Bank Verification Number',
      'fee': 500.0,
      'length': 11,
      'icon': Icons.account_balance_outlined,
    },
    'DRIVER_LICENSE': {
      'shortTitle': 'Driver License',
      'title': "Driver's License",
      'description': "Verify a Nigerian driver's licence",
      'fee': 700.0,
      'length': 0,
      'icon': Icons.drive_eta_outlined,
    },
    'PASSPORT': {
      'shortTitle': 'Passport',
      'title': 'International Passport',
      'description': 'Verify an international passport',
      'fee': 700.0,
      'length': 0,
      'icon': Icons.public_outlined,
    },
    'VOTER_CARD': {
      'shortTitle': 'Voter Card',
      'title': "Voter's Card",
      'description': "Verify a permanent voter's card",
      'fee': 700.0,
      'length': 0,
      'icon': Icons.how_to_vote_outlined,
    },
  };

  @override
  void initState() {
    super.initState();

    selectedIdType = idTypes.containsKey(widget.initialIdType)
        ? widget.initialIdType
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
    return idTypes[selectedIdType]?['title']?.toString() ??
        'ID Verification';
  }

  String get selectedShortTitle {
    return idTypes[selectedIdType]?['shortTitle']?.toString() ??
        selectedIdType;
  }

  int get expectedLength {
    return idTypes[selectedIdType]?['length'] as int? ?? 0;
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

      if (token.toLowerCase().startsWith('bearer ')) {
        token = token.substring(7).trim();
      }

      if (token.isEmpty) {
        continue;
      }

      await preferences.setString('auth_token', token);

      return token;
    }

    return null;
  }

  String? validateIdNumber(String? value) {
    final String idNumber = value?.trim() ?? '';

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

      final String? token =
          await getSavedAuthToken(preferences);

      if (!mounted) {
        return;
      }

      if (token == null || token.trim().isEmpty) {
        showMessage(
          'Your login session has expired. '
          'Please log out and log in again.',
          isError: true,
        );
        return;
      }

      final Uri endpoint =
          Uri.parse('$baseUrl/id-verification/verify');

      final http.Response response = await http
          .post(
            endpoint,
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
          .timeout(const Duration(seconds: 60));

      final Map<String, dynamic> responseData =
          decodeServerResponse(response);

      if (!mounted) {
        return;
      }

      if (response.statusCode == 401) {
        await preferences.remove('auth_token');

        if (!mounted) {
          return;
        }

        showMessage(
          responseData['message']?.toString().trim().isNotEmpty == true
              ? responseData['message'].toString()
              : 'Your login session is invalid. '
                  'Please log out and log in again.',
          isError: true,
        );

        return;
      }

      final bool successful =
          response.statusCode >= 200 &&
          response.statusCode < 300 &&
          responseData['success'] == true;

      if (!successful) {
        final String serverMessage =
            responseData['message']?.toString().trim() ?? '';

        showMessage(
          serverMessage.isNotEmpty
              ? serverMessage
              : 'ID verification failed. '
                  'Server status: ${response.statusCode}.',
          isError: true,
        );

        return;
      }

      final dynamic verificationValue =
          responseData['verification'] ?? responseData['data'];

      final Map<String, dynamic> verification =
          verificationValue is Map
              ? Map<String, dynamic>.from(verificationValue)
              : <String, dynamic>{};

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
        responseData['message']?.toString() ??
            'ID verified successfully.',
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
        'message': 'The server returned an empty response. '
            'Status: ${response.statusCode}.',
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
      String shortBody = body;

      if (shortBody.length > 180) {
        shortBody = shortBody.substring(0, 180);
      }

      return {
        'success': false,
        'message': 'The server did not return valid JSON. '
            'Status: ${response.statusCode}. '
            '$shortBody',
      };
    }
  }

  Future<void> saveNewWalletBalance(
    SharedPreferences preferences,
    Map<String, dynamic> responseData,
    Map<String, dynamic> verification,
  ) async {
    final dynamic balanceValue =
        verification['walletBalance'] ??
        responseData['walletBalance'] ??
        responseData['balance'];

    if (balanceValue == null) {
      return;
    }

    final double? walletBalance =
        double.tryParse(balanceValue.toString());

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
          backgroundColor: isError
              ? Colors.red.shade700
              : Colors.green.shade700,
        ),
      );
  }

  Future<void> showVerificationResult(
    Map<String, dynamic> verification,
    String message,
  ) async {
    final String fullName =
        firstAvailableValue(
          verification,
          const [
            'fullName',
            'full_name',
            'name',
          ],
        ) ??
        'Not provided';

    final String dateOfBirth =
        firstAvailableValue(
          verification,
          const [
            'dateOfBirth',
            'date_of_birth',
            'dob',
          ],
        ) ??
        'Not provided';

    final String gender =
        firstAvailableValue(
          verification,
          const ['gender'],
        ) ??
        'Not provided';

    final String phone =
        firstAvailableValue(
          verification,
          const [
            'phone',
            'phoneNumber',
            'phone_number',
          ],
        ) ??
        'Not provided';

    final String maskedIdNumber =
        firstAvailableValue(
          verification,
          const [
            'maskedIdNumber',
            'masked_id_number',
          ],
        ) ??
        maskIdNumber(idNumberController.text.trim());

    final String status =
        firstAvailableValue(
          verification,
          const ['status'],
        ) ??
        'Verified';

    final String reference =
        firstAvailableValue(
          verification,
          const [
            'reference',
            'providerReference',
          ],
        ) ??
        '';

    await showDialog<void>(
      context: context,
      barrierDismissible: false,
      builder: (BuildContext dialogContext) {
        return AlertDialog(
          icon: const Icon(
            Icons.verified,
            color: Colors.green,
            size: 54,
          ),
          title: const Text('Verification Successful'),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  message,
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: 20),
                resultRow('ID type', selectedShortTitle),
                resultRow('ID number', maskedIdNumber),
                resultRow('Full name', fullName),
                resultRow('Date of birth', dateOfBirth),
                resultRow('Gender', gender),
                resultRow('Phone', phone),
                resultRow('Status', status),
                if (reference.isNotEmpty)
                  resultRow('Reference', reference),
                resultRow(
                  'Amount charged',
                  '₦${selectedFee.toStringAsFixed(0)}',
                ),
              ],
            ),
          ),
          actions: [
            FilledButton(
              onPressed: () {
                Navigator.pop(dialogContext);
              },
              child: const Text('Done'),
            ),
          ],
        );
      },
    );
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

  String maskIdNumber(String value) {
    final String idNumber = value.trim();

    if (idNumber.length <= 4) {
      return '****';
    }

    return '${'*' * (idNumber.length - 4)}'
        '${idNumber.substring(idNumber.length - 4)}';
  }

  Widget resultRow(
    String label,
    String value,
  ) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: Text(
              label,
              style: const TextStyle(
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Text(
              value,
              textAlign: TextAlign.right,
            ),
          ),
        ],
      ),
    );
  }

  Widget buildIdTypeCard(String idType) {
    final Map<String, dynamic> details = idTypes[idType]!;

    final bool isSelected = selectedIdType == idType;

    final ColorScheme colorScheme =
        Theme.of(context).colorScheme;

    return InkWell(
      onTap: isLoading
          ? null
          : () {
              setState(() {
                selectedIdType = idType;
                idNumberController.clear();
                hasConsent = false;
              });
            },
      borderRadius: BorderRadius.circular(14),
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 200),
        width: 150,
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: isSelected
              ? colorScheme.primaryContainer
              : colorScheme.surface,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(
            color: isSelected
                ? colorScheme.primary
                : Colors.grey.shade300,
            width: isSelected ? 2 : 1,
          ),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(
              details['icon'] as IconData,
              size: 30,
              color: isSelected
                  ? colorScheme.primary
                  : Colors.grey.shade700,
            ),
            const SizedBox(height: 12),
            Text(
              details['shortTitle'].toString(),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(
                fontWeight: FontWeight.bold,
              ),
            ),
            const SizedBox(height: 5),
            Text(
              '₦${(details['fee'] as num).toStringAsFixed(0)}',
              style: TextStyle(
                color: isSelected
                    ? colorScheme.primary
                    : Colors.grey.shade700,
                fontWeight: FontWeight.w600,
              ),
            ),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final ColorScheme colorScheme =
        Theme.of(context).colorScheme;

    return Scaffold(
      appBar: AppBar(
        title: const Text('ID Verification'),
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
                  color: colorScheme.primary,
                  borderRadius: BorderRadius.circular(18),
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
                    SizedBox(width: 15),
                    Expanded(
                      child: Column(
                        crossAxisAlignment:
                            CrossAxisAlignment.start,
                        children: [
                          Text(
                            'Verify an Identity',
                            style: TextStyle(
                              color: Colors.white,
                              fontSize: 19,
                              fontWeight: FontWeight.bold,
                            ),
                          ),
                          SizedBox(height: 5),
                          Text(
                            'Confirm identity information securely '
                            'using an authorised ID number.',
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
              const SizedBox(height: 25),
              const Text(
                'Select ID Type',
                style: TextStyle(
                  fontSize: 17,
                  fontWeight: FontWeight.bold,
                ),
              ),
              const SizedBox(height: 12),
              SizedBox(
                height: 125,
                child: ListView.separated(
                  scrollDirection: Axis.horizontal,
                  itemCount: idTypes.length,
                  separatorBuilder: (_, __) =>
                      const SizedBox(width: 10),
                  itemBuilder: (context, index) {
                    final String idType =
                        idTypes.keys.elementAt(index);

                    return buildIdTypeCard(idType);
                  },
                ),
              ),
              const SizedBox(height: 25),
              Text(
                selectedTitle,
                style: const TextStyle(
                  fontSize: 16,
                  fontWeight: FontWeight.w600,
                ),
              ),
              const SizedBox(height: 10),
              TextFormField(
                key: ValueKey(selectedIdType),
                controller: idNumberController,
                enabled: !isLoading,
                keyboardType: usesNumericKeyboard
                    ? TextInputType.number
                    : TextInputType.text,
                textCapitalization:
                    TextCapitalization.characters,
                validator: validateIdNumber,
                decoration: InputDecoration(
                  labelText: '$selectedShortTitle Number',
                  hintText: usesNumericKeyboard
                      ? 'Enter 11-digit number'
                      : 'Enter ID number',
                  prefixIcon: const Icon(Icons.numbers),
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(14),
                  ),
                ),
              ),
              const SizedBox(height: 18),
              Container(
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  color: Colors.orange.shade50,
                  borderRadius: BorderRadius.circular(14),
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
                    const SizedBox(width: 12),
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
              const SizedBox(height: 15),
              CheckboxListTile(
                value: hasConsent,
                onChanged: isLoading
                    ? null
                    : (bool? value) {
                        setState(() {
                          hasConsent = value ?? false;
                        });
                      },
                controlAffinity:
                    ListTileControlAffinity.leading,
                contentPadding: EdgeInsets.zero,
                title: const Text(
                  'I confirm that I have permission '
                  'to verify this identity.',
                  style: TextStyle(fontSize: 14),
                ),
              ),
              const SizedBox(height: 16),
              SizedBox(
                height: 54,
                child: FilledButton.icon(
                  onPressed: isLoading ? null : verifyId,
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
                        : 'Verify Now — '
                            '₦${selectedFee.toStringAsFixed(0)}',
                    style: const TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                ),
              ),
              const SizedBox(height: 18),
              const Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Icon(
                    Icons.lock_outline,
                    size: 19,
                    color: Colors.grey,
                  ),
                  SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      'The verification fee will only be deducted '
                      'after verification succeeds.',
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
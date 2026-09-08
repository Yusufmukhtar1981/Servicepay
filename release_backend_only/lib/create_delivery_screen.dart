import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

class CreateDeliveryScreen extends StatefulWidget {
  const CreateDeliveryScreen({
    super.key,
  });

  @override
  State<CreateDeliveryScreen> createState() => _CreateDeliveryScreenState();
}

class _CreateDeliveryScreenState extends State<CreateDeliveryScreen> {
  static const String baseUrl = 'https://api.servicepay.ng/api';

  static const Color primaryBlue = Color(0xFF1565C0);

  static const Color primaryGreen = Color(0xFF159447);

  final GlobalKey<FormState> formKey = GlobalKey<FormState>();

  final TextEditingController pickupController = TextEditingController();

  final TextEditingController deliveryController = TextEditingController();

  final TextEditingController senderNameController = TextEditingController();

  final TextEditingController senderPhoneController = TextEditingController();

  final TextEditingController receiverNameController = TextEditingController();

  final TextEditingController receiverPhoneController = TextEditingController();

  final TextEditingController packageDescriptionController =
      TextEditingController();

  bool isLoading = false;
  bool isLoadingCoverage = true;
  String coverageError = '';
  String selectedPickupStateCode = '';
  String selectedDeliveryStateCode = '';
  List<Map<String, dynamic>> deliveryStates = <Map<String, dynamic>>[];
  String profileName = '';
  String profilePhone = '';
  String profileAddress = '';
  bool useProfileDetails = false;

  @override
  void initState() {
    super.initState();

    loadInitialInformation();
  }

  @override
  void dispose() {
    pickupController.dispose();
    deliveryController.dispose();

    senderNameController.dispose();
    senderPhoneController.dispose();

    receiverNameController.dispose();
    receiverPhoneController.dispose();

    packageDescriptionController.dispose();

    super.dispose();
  }

  Future<void> loadInitialInformation() async {
    await loadProfileDetails();
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

  Map<String, dynamic> decodeResponse(
    http.Response response,
  ) {
    final String body = response.body.trim();

    if (body.isEmpty) {
      return <String, dynamic>{};
    }

    try {
      final dynamic decoded = jsonDecode(body);

      return mapFromDynamic(
        decoded,
      );
    } catch (_) {
      return <String, dynamic>{};
    }
  }

  Future<String> getSavedToken() async {
    final SharedPreferences preferences = await SharedPreferences.getInstance();

    const List<String> tokenKeys = [
      'auth_token',
      'token',
      'access_token',
      'accessToken',
      'jwt_token',
      'jwt',
    ];

    for (final String key in tokenKeys) {
      String token = preferences.getString(key)?.trim() ?? '';

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

  Future<void> loadProfileDetails() async {
    final SharedPreferences preferences = await SharedPreferences.getInstance();

    if (!mounted) {
      return;
    }

    setState(() {
      profileName = preferences.getString('user_name') ??
          preferences.getString('full_name') ??
          '';
      profilePhone = preferences.getString('user_phone') ??
          preferences.getString('phone') ??
          '';
      profileAddress = preferences.getString('user_address') ??
          preferences.getString('profile_address') ??
          preferences.getString('address') ??
          '';
    });
  }

  void applyProfileDetails() {
    setState(() {
      senderNameController.text = profileName;
      senderPhoneController.text = profilePhone;
      if (profileAddress.isNotEmpty) {
        pickupController.text = profileAddress;
      }
      useProfileDetails = true;
    });
  }

  Future<void> loadDeliveryCoverage() async {
    if (mounted) {
      setState(() {
        isLoadingCoverage = true;
        coverageError = '';
      });
    }

    try {
      final http.Response response = await http.get(
        Uri.parse(
          '$baseUrl/delivery/coverage',
        ),
        headers: const {
          'Accept': 'application/json',
        },
      ).timeout(
        const Duration(
          seconds: 35,
        ),
      );

      final Map<String, dynamic> root = decodeResponse(response);

      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw Exception(
          text(
            root['message'],
            fallback: 'Unable to load Delivery Coverage.',
          ),
        );
      }

      final Map<String, dynamic> data = mapFromDynamic(
        root['data'],
      );

      final List<Map<String, dynamic>> states = listFromDynamic(
        data['states'] ?? root['states'],
      );

      states.sort(
        (
          Map<String, dynamic> first,
          Map<String, dynamic> second,
        ) {
          return text(
            first['stateName'],
          ).compareTo(
            text(
              second['stateName'],
            ),
          );
        },
      );

      if (!mounted) {
        return;
      }

      setState(() {
        deliveryStates = states;

        isLoadingCoverage = false;
        coverageError = '';
      });
    } on TimeoutException {
      if (!mounted) {
        return;
      }

      setState(() {
        isLoadingCoverage = false;

        coverageError = 'The server took too long to load Delivery Coverage.';
      });
    } catch (error) {
      if (!mounted) {
        return;
      }

      setState(() {
        isLoadingCoverage = false;

        coverageError = error.toString().replaceFirst(
              'Exception: ',
              '',
            );
      });
    }
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
          content: Text(
            message,
          ),
          behavior: SnackBarBehavior.floating,
          duration: const Duration(
            seconds: 5,
          ),
          backgroundColor: isError ? Colors.red.shade700 : primaryGreen,
        ),
      );
  }

  String getErrorMessage(
    http.Response response,
  ) {
    final Map<String, dynamic> result = decodeResponse(response);

    return text(
      result['message'],
      fallback: 'Unable to create delivery request.',
    );
  }

  Map<String, dynamic>? findState(
    String stateCode,
  ) {
    if (stateCode.trim().isEmpty) {
      return null;
    }

    for (final Map<String, dynamic> state in deliveryStates) {
      if (text(
            state['stateCode'],
          ).toUpperCase() ==
          stateCode.toUpperCase()) {
        return state;
      }
    }

    return null;
  }

  bool isStateLive(
    String stateCode,
  ) {
    final Map<String, dynamic>? state = findState(stateCode);

    return state?['isLive'] == true;
  }

  String stateName(
    String stateCode,
  ) {
    final Map<String, dynamic>? state = findState(stateCode);

    return text(
      state?['stateName'],
      fallback: stateCode,
    );
  }

  String stateUnavailableMessage(
    String stateCode,
  ) {
    final Map<String, dynamic>? state = findState(stateCode);

    final String name = text(
      state?['stateName'],
      fallback: stateCode,
    );

    return text(
      state?['unavailableMessage'],
      fallback: 'ServicePay Delivery is not yet available in $name. '
          'We will notify you when the service becomes live.',
    );
  }

  void handleStateSelection({
    required String stateCode,
    required bool pickup,
  }) {
    setState(() {
      if (pickup) {
        selectedPickupStateCode = stateCode;
      } else {
        selectedDeliveryStateCode = stateCode;
      }
    });

    if (!isStateLive(stateCode)) {
      showStateNotLiveDialog(
        stateCode: stateCode,
        pickup: pickup,
      );
    }
  }

  Future<void> showStateNotLiveDialog({
    required String stateCode,
    required bool pickup,
  }) async {
    final String name = stateName(stateCode);

    final String message = stateUnavailableMessage(
      stateCode,
    );

    await showDialog<void>(
      context: context,
      builder: (
        BuildContext dialogContext,
      ) {
        return AlertDialog(
          icon: const Icon(
            Icons.location_off_outlined,
            color: Colors.orange,
            size: 50,
          ),
          title: Text(
            '$name is Not Live Yet',
            textAlign: TextAlign.center,
          ),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                message,
                textAlign: TextAlign.center,
                style: const TextStyle(
                  height: 1.5,
                ),
              ),
              const SizedBox(
                height: 14,
              ),
              Text(
                pickup
                    ? 'You cannot create a pickup request from this state yet.'
                    : 'You cannot create a delivery request to this state yet.',
                textAlign: TextAlign.center,
                style: const TextStyle(
                  color: Colors.black54,
                  fontSize: 13,
                  height: 1.4,
                ),
              ),
            ],
          ),
          actionsAlignment: MainAxisAlignment.center,
          actions: [
            FilledButton(
              onPressed: () {
                Navigator.pop(
                  dialogContext,
                );
              },
              style: FilledButton.styleFrom(
                backgroundColor: primaryBlue,
              ),
              child: const Text(
                'Okay',
              ),
            ),
          ],
        );
      },
    );
  }

  bool validateSelectedStates() {
    if (selectedPickupStateCode.isEmpty) {
      showMessage(
        'Please select the pickup state.',
      );

      return false;
    }

    if (selectedDeliveryStateCode.isEmpty) {
      showMessage(
        'Please select the destination state.',
      );

      return false;
    }

    if (!isStateLive(
      selectedPickupStateCode,
    )) {
      showStateNotLiveDialog(
        stateCode: selectedPickupStateCode,
        pickup: true,
      );

      return false;
    }

    if (!isStateLive(
      selectedDeliveryStateCode,
    )) {
      showStateNotLiveDialog(
        stateCode: selectedDeliveryStateCode,
        pickup: false,
      );

      return false;
    }

    return true;
  }

  Future<void> createDelivery() async {
    FocusScope.of(context).unfocus();

    if (!(formKey.currentState?.validate() ?? false)) {
      return;
    }

    final String token = await getSavedToken();

    if (token.isEmpty) {
      showMessage(
        'Your login session has expired. Please log in again.',
      );

      return;
    }

    setState(() {
      isLoading = true;
    });

    try {
      final http.Response response = await http
          .post(
            Uri.parse(
              '$baseUrl/delivery',
            ),
            headers: {
              'Accept': 'application/json',
              'Content-Type': 'application/json',
              'Authorization': 'Bearer $token',
            },
            body: jsonEncode({
              'pickupAddress': pickupController.text.trim(),
              'deliveryAddress': deliveryController.text.trim(),
              'senderName': senderNameController.text.trim(),
              'senderPhone': senderPhoneController.text.trim(),
              'receiverName': receiverNameController.text.trim(),
              'receiverPhone': receiverPhoneController.text.trim(),
              'packageDescription': packageDescriptionController.text.trim(),
            }),
          )
          .timeout(
            const Duration(
              seconds: 40,
            ),
          );

      if (response.statusCode == 200 || response.statusCode == 201) {
        final Map<String, dynamic> root = decodeResponse(response);

        final Map<String, dynamic> delivery = mapFromDynamic(
          root['delivery'] ??
              mapFromDynamic(
                root['data'],
              )['delivery'],
        );

        final String trackingNumber = text(
          delivery['trackingNumber'],
        );

        if (!mounted) {
          return;
        }

        await showDialog<void>(
          context: context,
          barrierDismissible: false,
          builder: (
            BuildContext dialogContext,
          ) {
            return AlertDialog(
              icon: const Icon(
                Icons.check_circle,
                color: primaryGreen,
                size: 58,
              ),
              title: const Text(
                'Request Created',
                textAlign: TextAlign.center,
              ),
              content: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Text(
                    'Your delivery request has been submitted successfully.',
                    textAlign: TextAlign.center,
                  ),
                  const SizedBox(
                    height: 14,
                  ),
                   const Text(
                     'Delivery Fee: ₦1,500',
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      color: primaryBlue,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  if (trackingNumber.isNotEmpty) ...[
                    const SizedBox(
                      height: 18,
                    ),
                    const Text(
                      'Tracking Number',
                      style: TextStyle(
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    const SizedBox(
                      height: 6,
                    ),
                    SelectableText(
                      trackingNumber,
                      textAlign: TextAlign.center,
                      style: const TextStyle(
                        fontWeight: FontWeight.w800,
                        fontSize: 16,
                        color: primaryBlue,
                      ),
                    ),
                  ],
                ],
              ),
              actionsAlignment: MainAxisAlignment.center,
              actions: [
                FilledButton(
                  onPressed: () {
                    Navigator.pop(
                      dialogContext,
                    );
                  },
                  style: FilledButton.styleFrom(
                    backgroundColor: primaryBlue,
                  ),
                  child: const Text(
                    'Done',
                  ),
                ),
              ],
            );
          },
        );

        if (mounted) {
          Navigator.pop(
            context,
            true,
          );
        }
      } else {
        final String message = getErrorMessage(response);

        showMessage(
          message,
        );
      }
    } on TimeoutException {
      showMessage(
        'The server took too long to respond. Please try again.',
      );
    } on http.ClientException {
      showMessage(
        'Unable to connect to the ServicePay server.',
      );
    } catch (error) {
      showMessage(
        'Unable to create the delivery request. Please try again.',
      );
    } finally {
      if (mounted) {
        setState(() {
          isLoading = false;
        });
      }
    }
  }

  String? validateRequired(
    String? value,
    String fieldName,
  ) {
    if (value == null || value.trim().isEmpty) {
      return 'Please enter $fieldName.';
    }

    return null;
  }

  String? validatePhone(
    String? value,
  ) {
    final String phone = value?.replaceAll(
          RegExp(r'\s+'),
          '',
        ) ??
        '';

    if (phone.isEmpty) {
      return 'Please enter a phone number.';
    }

    if (!RegExp(
      r'^[0-9+]{10,15}$',
    ).hasMatch(phone)) {
      return 'Please enter a valid phone number.';
    }

    return null;
  }

  Widget buildSectionTitle(
    String title,
  ) {
    return Padding(
      padding: const EdgeInsets.only(
        top: 8,
        bottom: 12,
      ),
      child: Text(
        title,
        style: const TextStyle(
          fontSize: 17,
          fontWeight: FontWeight.w700,
          color: Color(0xFF111827),
        ),
      ),
    );
  }

  Widget buildStateDropdown({
    required String label,
    required String selectedValue,
    required IconData icon,
    required bool pickup,
  }) {
    return Padding(
      padding: const EdgeInsets.only(
        bottom: 14,
      ),
      child: DropdownButtonFormField<String>(
        value: selectedValue.isEmpty ? null : selectedValue,
        isExpanded: true,
        decoration: InputDecoration(
          labelText: label,
          prefixIcon: Icon(
            icon,
          ),
          filled: true,
          fillColor: Colors.white,
          border: OutlineInputBorder(
            borderRadius: BorderRadius.circular(
              14,
            ),
          ),
          enabledBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(
              14,
            ),
            borderSide: const BorderSide(
              color: Color(0xFFE5E7EB),
            ),
          ),
          focusedBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(
              14,
            ),
            borderSide: const BorderSide(
              color: primaryBlue,
              width: 1.5,
            ),
          ),
        ),
        items: deliveryStates.map(
          (
            Map<String, dynamic> state,
          ) {
            final String code = text(
              state['stateCode'],
            );

            final String name = text(
              state['stateName'],
              fallback: code,
            );

            final bool live = state['isLive'] == true;

            return DropdownMenuItem<String>(
              value: code,
              child: Row(
                children: [
                  Expanded(
                    child: Text(
                      name,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                  const SizedBox(
                    width: 8,
                  ),
                  Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 7,
                      vertical: 3,
                    ),
                    decoration: BoxDecoration(
                      color: live
                          ? Colors.green.withValues(
                              alpha: 0.12,
                            )
                          : Colors.orange.withValues(
                              alpha: 0.12,
                            ),
                      borderRadius: BorderRadius.circular(
                        20,
                      ),
                    ),
                    child: Text(
                      live ? 'LIVE' : 'NOT LIVE',
                      style: TextStyle(
                        color: live
                            ? Colors.green.shade800
                            : Colors.orange.shade800,
                        fontSize: 9,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                  ),
                ],
              ),
            );
          },
        ).toList(),
        onChanged: isLoading
            ? null
            : (String? value) {
                if (value == null || value.isEmpty) {
                  return;
                }

                handleStateSelection(
                  stateCode: value,
                  pickup: pickup,
                );
              },
        validator: (
          String? value,
        ) {
          if (value == null || value.isEmpty) {
            return 'Please select ${label.toLowerCase()}.';
          }

          if (!isStateLive(value)) {
            return '${stateName(value)} is not live yet.';
          }

          return null;
        },
      ),
    );
  }

  Widget buildTextField({
    required TextEditingController controller,
    required String label,
    required IconData icon,
    String? hint,
    int maxLines = 1,
    TextInputType keyboardType = TextInputType.text,
    String? Function(String?)? validator,
  }) {
    return Padding(
      padding: const EdgeInsets.only(
        bottom: 14,
      ),
      child: TextFormField(
        controller: controller,
        maxLines: maxLines,
        keyboardType: keyboardType,
        validator: validator ??
            (
              String? value,
            ) =>
                validateRequired(
                  value,
                  label.toLowerCase(),
                ),
        decoration: InputDecoration(
          labelText: label,
          hintText: hint,
          prefixIcon: maxLines == 1 ? Icon(icon) : null,
          alignLabelWithHint: maxLines > 1,
          filled: true,
          fillColor: Colors.white,
          border: OutlineInputBorder(
            borderRadius: BorderRadius.circular(
              14,
            ),
            borderSide: const BorderSide(
              color: Color(0xFFE5E7EB),
            ),
          ),
          enabledBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(
              14,
            ),
            borderSide: const BorderSide(
              color: Color(0xFFE5E7EB),
            ),
          ),
          focusedBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(
              14,
            ),
            borderSide: const BorderSide(
              color: primaryBlue,
              width: 1.5,
            ),
          ),
        ),
      ),
    );
  }

  Widget buildCoverageLoadingCard() {
    if (isLoadingCoverage) {
      return Container(
        width: double.infinity,
        margin: const EdgeInsets.only(
          bottom: 16,
        ),
        padding: const EdgeInsets.all(
          16,
        ),
        decoration: BoxDecoration(
          color: const Color(0xFFEAF3FF),
          borderRadius: BorderRadius.circular(
            14,
          ),
        ),
        child: const Row(
          children: [
            SizedBox(
              width: 23,
              height: 23,
              child: CircularProgressIndicator(
                strokeWidth: 2.4,
              ),
            ),
            SizedBox(width: 12),
            Expanded(
              child: Text(
                'Loading ServicePay Delivery Coverage...',
              ),
            ),
          ],
        ),
      );
    }

    if (coverageError.isNotEmpty) {
      return Container(
        width: double.infinity,
        margin: const EdgeInsets.only(
          bottom: 16,
        ),
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
          border: Border.all(
            color: Colors.red.withValues(
              alpha: 0.25,
            ),
          ),
        ),
        child: Column(
          children: [
            Text(
              coverageError,
              textAlign: TextAlign.center,
              style: const TextStyle(
                color: Colors.red,
              ),
            ),
            const SizedBox(
              height: 10,
            ),
            FilledButton.icon(
              onPressed: loadDeliveryCoverage,
              icon: const Icon(
                Icons.refresh_rounded,
              ),
              label: const Text(
                'Try Again',
              ),
            ),
          ],
        ),
      );
    }

    final int liveCount = deliveryStates
        .where(
          (
            Map<String, dynamic> state,
          ) =>
              state['isLive'] == true,
        )
        .length;

    return Container(
      width: double.infinity,
      margin: const EdgeInsets.only(
        bottom: 16,
      ),
      padding: const EdgeInsets.all(
        14,
      ),
      decoration: BoxDecoration(
        color: liveCount > 0
            ? Colors.green.withValues(
                alpha: 0.08,
              )
            : Colors.orange.withValues(
                alpha: 0.08,
              ),
        borderRadius: BorderRadius.circular(
          14,
        ),
        border: Border.all(
          color: liveCount > 0
              ? Colors.green.withValues(
                  alpha: 0.25,
                )
              : Colors.orange.withValues(
                  alpha: 0.25,
                ),
        ),
      ),
      child: Row(
        children: [
          Icon(
            liveCount > 0 ? Icons.check_circle_outline : Icons.info_outline,
            color: liveCount > 0 ? primaryGreen : Colors.orange,
          ),
          const SizedBox(
            width: 10,
          ),
          Expanded(
            child: Text(
              liveCount > 0
                  ? 'ServicePay Delivery is currently live in $liveCount location${liveCount == 1 ? '' : 's'}.'
                  : 'ServicePay Delivery has not been activated in any state yet.',
              style: const TextStyle(
                height: 1.4,
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(
    BuildContext context,
  ) {
    return Scaffold(
      backgroundColor: const Color(0xFFF5F7FB),
      appBar: AppBar(
        title: const Text(
          'Create Delivery Request',
          style: TextStyle(
            fontWeight: FontWeight.w700,
          ),
        ),
        centerTitle: true,
        backgroundColor: Colors.white,
        foregroundColor: const Color(
          0xFF111827,
        ),
        elevation: 0,
      ),
      body: SafeArea(
        child: Form(
          key: formKey,
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(
              18,
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.all(
                    17,
                  ),
                  decoration: BoxDecoration(
                    color: const Color(
                      0xFFEAF3FF,
                    ),
                    borderRadius: BorderRadius.circular(
                      16,
                    ),
                  ),
                  child: const Row(
                    children: [
                      Icon(
                        Icons.local_shipping_outlined,
                        color: primaryBlue,
                        size: 30,
                      ),
                      SizedBox(
                        width: 13,
                      ),
                      Expanded(
                        child: Text(
                          'Enter the pickup and receiver details below. '
                          'Your request will be reviewed and assigned to a rider.',
                          style: TextStyle(
                            color: Color(
                              0xFF1E3A5F,
                            ),
                            height: 1.4,
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(
                  height: 18,
                ),
                Card(
                  margin: const EdgeInsets.only(bottom: 8),
                  elevation: 0,
                  color: Colors.white,
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(14),
                  ),
                  child: CheckboxListTile(
                    value: useProfileDetails,
                    onChanged: isLoading
                        ? null
                        : (bool? value) {
                            if (value == true) {
                              applyProfileDetails();
                            } else {
                              setState(() {
                                useProfileDetails = false;
                              });
                            }
                          },
                    secondary: const Icon(
                      Icons.person_pin_circle_outlined,
                      color: primaryBlue,
                    ),
                    title: const Text(
                      'Use my profile details',
                      style: TextStyle(fontWeight: FontWeight.w700),
                    ),
                    subtitle: const Text(
                      'Automatically fill in your pickup name, phone number, and address.',
                    ),
                    controlAffinity: ListTileControlAffinity.trailing,
                    contentPadding: const EdgeInsets.symmetric(
                      horizontal: 12,
                      vertical: 4,
                    ),
                    activeColor: primaryBlue,
                  ),
                ),
                buildSectionTitle(
                  'Pickup Details',
                ),
                buildTextField(
                  controller: senderNameController,
                  label: 'Pickup Name',
                  icon: Icons.person_outline,
                ),
                buildTextField(
                  controller: senderPhoneController,
                  label: 'Pickup Phone Number',
                  icon: Icons.phone_outlined,
                  keyboardType: TextInputType.phone,
                  validator: validatePhone,
                ),
                buildTextField(
                  controller: pickupController,
                  label: 'Pickup Address',
                  icon: Icons.location_on_outlined,
                  hint: 'Enter the full pickup address',
                  maxLines: 2,
                ),
                buildSectionTitle(
                  'Receiver Information',
                ),
                buildTextField(
                  controller: receiverNameController,
                  label: 'Receiver Name',
                  icon: Icons.person_pin_outlined,
                ),
                buildTextField(
                  controller: receiverPhoneController,
                  label: 'Receiver Phone',
                  icon: Icons.phone_android_outlined,
                  keyboardType: TextInputType.phone,
                  validator: validatePhone,
                ),
                buildTextField(
                  controller: deliveryController,
                  label: 'Receiver Address',
                  icon: Icons.flag_circle_outlined,
                  hint: 'Enter the full receiver address',
                  maxLines: 2,
                ),
                buildTextField(
                  controller: packageDescriptionController,
                  label: 'Delivery Note / Item Description',
                  icon: Icons.description_outlined,
                  hint: 'Optional instructions or item details',
                  maxLines: 3,
                  validator: (_) => null,
                ),
                Card(
                  margin: const EdgeInsets.only(top: 4, bottom: 16),
                  elevation: 0,
                  color: const Color(0xFFEAF7F0),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(14),
                  ),
                  child: const ListTile(
                    leading: Icon(
                      Icons.payments_outlined,
                      color: primaryGreen,
                    ),
                    title: Text(
                      'Delivery Fee',
                      style: TextStyle(fontWeight: FontWeight.w700),
                    ),
                    trailing: Text(
                      '₦1,500',
                      style: TextStyle(
                        color: primaryGreen,
                        fontSize: 17,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                  ),
                ),
                const SizedBox(
                  height: 8,
                ),
                SizedBox(
                  width: double.infinity,
                  height: 54,
                  child: FilledButton.icon(
                    onPressed: isLoading ? null : createDelivery,
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
                            Icons.send_rounded,
                          ),
                    label: Text(
                      isLoading ? 'Submitting...' : 'Request Delivery',
                      style: const TextStyle(
                        fontSize: 16,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    style: FilledButton.styleFrom(
                      backgroundColor: primaryBlue,
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(
                          14,
                        ),
                      ),
                    ),
                  ),
                ),
                const SizedBox(
                  height: 16,
                ),
                const Center(
                  child: Text(
                    'A fixed delivery fee of ₦1,500 will be debited from your wallet.',
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      fontSize: 12,
                      color: Color(
                        0xFF6B7280,
                      ),
                      height: 1.4,
                    ),
                  ),
                ),
                const SizedBox(
                  height: 22,
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

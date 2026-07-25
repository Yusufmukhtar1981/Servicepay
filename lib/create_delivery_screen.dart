import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

class CreateDeliveryScreen extends StatefulWidget {
  const CreateDeliveryScreen({super.key});

  @override
  State<CreateDeliveryScreen> createState() =>
      _CreateDeliveryScreenState();
}

class _CreateDeliveryScreenState
    extends State<CreateDeliveryScreen> {
  static const String baseUrl =
      'https://api.servicepay.ng/api';

  final formKey = GlobalKey<FormState>();

  final pickupController = TextEditingController();
  final deliveryController = TextEditingController();

  final senderNameController = TextEditingController();
  final senderPhoneController = TextEditingController();

  final receiverNameController = TextEditingController();
  final receiverPhoneController = TextEditingController();

  final packageNameController = TextEditingController();
  final packageDescriptionController =
      TextEditingController();
  final packageWeightController = TextEditingController();

  bool isLoading = false;

  @override
  void initState() {
    super.initState();
    loadSenderInformation();
  }

  @override
  void dispose() {
    pickupController.dispose();
    deliveryController.dispose();
    senderNameController.dispose();
    senderPhoneController.dispose();
    receiverNameController.dispose();
    receiverPhoneController.dispose();
    packageNameController.dispose();
    packageDescriptionController.dispose();
    packageWeightController.dispose();
    super.dispose();
  }

  Future<void> loadSenderInformation() async {
    final preferences =
        await SharedPreferences.getInstance();

    if (!mounted) {
      return;
    }

    setState(() {
      senderNameController.text =
          preferences.getString('user_name') ?? '';

      senderPhoneController.text =
          preferences.getString('user_phone') ?? '';
    });
  }

  void showMessage(
    String message, {
    bool isError = true,
  }) {
    if (!mounted) {
      return;
    }

    ScaffoldMessenger.of(context).hideCurrentSnackBar();

    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(message),
        backgroundColor:
            isError ? Colors.red : Colors.green,
      ),
    );
  }

  String getErrorMessage(
    http.Response response,
  ) {
    try {
      final decodedBody = jsonDecode(response.body);

      if (decodedBody is Map<String, dynamic>) {
        return decodedBody['message']?.toString() ??
            'Unable to create delivery request.';
      }
    } catch (_) {
      // Use the default message below.
    }

    return 'Unable to create delivery request.';
  }

  Future<void> createDelivery() async {
    FocusScope.of(context).unfocus();

    if (!(formKey.currentState?.validate() ?? false)) {
      return;
    }

    final preferences =
        await SharedPreferences.getInstance();

    final token =
        preferences.getString('auth_token') ?? '';

    if (token.isEmpty) {
      showMessage(
        'Your login session has expired. Please log in again.',
      );
      return;
    }

    final weightText =
        packageWeightController.text.trim();

    final packageWeight = weightText.isEmpty
        ? 0.0
        : double.tryParse(weightText);

    if (packageWeight == null ||
        packageWeight < 0) {
      showMessage(
        'Please enter a valid package weight.',
      );
      return;
    }

    setState(() {
      isLoading = true;
    });

    try {
      final response = await http
          .post(
            Uri.parse('$baseUrl/delivery'),
            headers: {
              'Content-Type': 'application/json',
              'Authorization': 'Bearer $token',
            },
            body: jsonEncode({
              'pickupAddress':
                  pickupController.text.trim(),
              'deliveryAddress':
                  deliveryController.text.trim(),
              'senderName':
                  senderNameController.text.trim(),
              'senderPhone':
                  senderPhoneController.text.trim(),
              'receiverName':
                  receiverNameController.text.trim(),
              'receiverPhone':
                  receiverPhoneController.text.trim(),
              'packageName':
                  packageNameController.text.trim(),
              'packageDescription':
                  packageDescriptionController.text
                      .trim(),
              'packageWeight': packageWeight,
            }),
          )
          .timeout(
            const Duration(seconds: 30),
          );

      if (response.statusCode == 200 ||
          response.statusCode == 201) {
        final decodedBody =
            jsonDecode(response.body);

        final delivery =
            decodedBody['delivery'];

        final trackingNumber =
            delivery?['trackingNumber']?.toString() ??
                '';

        if (!mounted) {
          return;
        }

        await showDialog<void>(
          context: context,
          barrierDismissible: false,
          builder: (dialogContext) {
            return AlertDialog(
              icon: const Icon(
                Icons.check_circle,
                color: Colors.green,
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
                  if (trackingNumber.isNotEmpty) ...[
                    const SizedBox(height: 18),
                    const Text(
                      'Tracking Number',
                      style: TextStyle(
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    const SizedBox(height: 6),
                    SelectableText(
                      trackingNumber,
                      textAlign: TextAlign.center,
                      style: const TextStyle(
                        fontWeight: FontWeight.w800,
                        fontSize: 16,
                        color: Color(0xFF1565C0),
                      ),
                    ),
                  ],
                ],
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

        if (mounted) {
          Navigator.pop(context, true);
        }
      } else {
        showMessage(
          getErrorMessage(response),
        );
      }
    } catch (error) {
      showMessage(
        'Unable to connect to the Servicepay server. Please try again.',
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
    if (value == null ||
        value.trim().isEmpty) {
      return 'Please enter $fieldName.';
    }

    return null;
  }

  String? validatePhone(String? value) {
    final phone =
        value?.replaceAll(RegExp(r'\s+'), '') ?? '';

    if (phone.isEmpty) {
      return 'Please enter a phone number.';
    }

    if (!RegExp(r'^[0-9+]{10,15}$')
        .hasMatch(phone)) {
      return 'Please enter a valid phone number.';
    }

    return null;
  }

  Widget buildSectionTitle(String title) {
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

  Widget buildTextField({
    required TextEditingController controller,
    required String label,
    required IconData icon,
    String? hint,
    int maxLines = 1,
    TextInputType keyboardType =
        TextInputType.text,
    String? Function(String?)? validator,
  }) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 14),
      child: TextFormField(
        controller: controller,
        maxLines: maxLines,
        keyboardType: keyboardType,
        validator: validator ??
            (value) => validateRequired(
                  value,
                  label.toLowerCase(),
                ),
        decoration: InputDecoration(
          labelText: label,
          hintText: hint,
          prefixIcon: maxLines == 1
              ? Icon(icon)
              : null,
          alignLabelWithHint: maxLines > 1,
          filled: true,
          fillColor: Colors.white,
          border: OutlineInputBorder(
            borderRadius:
                BorderRadius.circular(14),
            borderSide: const BorderSide(
              color: Color(0xFFE5E7EB),
            ),
          ),
          enabledBorder: OutlineInputBorder(
            borderRadius:
                BorderRadius.circular(14),
            borderSide: const BorderSide(
              color: Color(0xFFE5E7EB),
            ),
          ),
          focusedBorder: OutlineInputBorder(
            borderRadius:
                BorderRadius.circular(14),
            borderSide: const BorderSide(
              color: Color(0xFF1565C0),
              width: 1.5,
            ),
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor:
          const Color(0xFFF5F7FB),
      appBar: AppBar(
        title: const Text(
          'Create Delivery',
          style: TextStyle(
            fontWeight: FontWeight.w700,
          ),
        ),
        centerTitle: true,
        backgroundColor: Colors.white,
        foregroundColor:
            const Color(0xFF111827),
        elevation: 0,
      ),
      body: SafeArea(
        child: Form(
          key: formKey,
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(18),
            child: Column(
              crossAxisAlignment:
                  CrossAxisAlignment.start,
              children: [
                Container(
                  width: double.infinity,
                  padding:
                      const EdgeInsets.all(17),
                  decoration: BoxDecoration(
                    color:
                        const Color(0xFFEAF3FF),
                    borderRadius:
                        BorderRadius.circular(16),
                  ),
                  child: const Row(
                    children: [
                      Icon(
                        Icons.local_shipping_outlined,
                        color: Color(0xFF1565C0),
                        size: 30,
                      ),
                      SizedBox(width: 13),
                      Expanded(
                        child: Text(
                          'Provide the pickup, receiver and package information below.',
                          style: TextStyle(
                            color:
                                Color(0xFF1E3A5F),
                            height: 1.4,
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 18),

                buildSectionTitle(
                  'Pickup and Destination',
                ),

                buildTextField(
                  controller: pickupController,
                  label: 'Pickup Address',
                  icon: Icons.location_on_outlined,
                  hint:
                      'Enter the full pickup address',
                  maxLines: 2,
                ),

                buildTextField(
                  controller:
                      deliveryController,
                  label: 'Delivery Address',
                  icon:
                      Icons.flag_circle_outlined,
                  hint:
                      'Enter the full delivery address',
                  maxLines: 2,
                ),

                buildSectionTitle(
                  'Sender Information',
                ),

                buildTextField(
                  controller:
                      senderNameController,
                  label: 'Sender Name',
                  icon: Icons.person_outline,
                ),

                buildTextField(
                  controller:
                      senderPhoneController,
                  label: 'Sender Phone',
                  icon: Icons.phone_outlined,
                  keyboardType:
                      TextInputType.phone,
                  validator: validatePhone,
                ),

                buildSectionTitle(
                  'Receiver Information',
                ),

                buildTextField(
                  controller:
                      receiverNameController,
                  label: 'Receiver Name',
                  icon:
                      Icons.person_pin_outlined,
                ),

                buildTextField(
                  controller:
                      receiverPhoneController,
                  label: 'Receiver Phone',
                  icon:
                      Icons.phone_android_outlined,
                  keyboardType:
                      TextInputType.phone,
                  validator: validatePhone,
                ),

                buildSectionTitle(
                  'Package Information',
                ),

                buildTextField(
                  controller:
                      packageNameController,
                  label: 'Package Name',
                  icon:
                      Icons.inventory_2_outlined,
                  hint:
                      'For example: Documents',
                ),

                buildTextField(
                  controller:
                      packageDescriptionController,
                  label:
                      'Package Description',
                  icon:
                      Icons.description_outlined,
                  hint:
                      'Describe the package',
                  maxLines: 3,
                  validator: (_) => null,
                ),

                buildTextField(
                  controller:
                      packageWeightController,
                  label:
                      'Package Weight in KG',
                  icon:
                      Icons.monitor_weight_outlined,
                  hint: 'For example: 2.5',
                  keyboardType:
                      const TextInputType
                          .numberWithOptions(
                    decimal: true,
                  ),
                  validator: (value) {
                    final text =
                        value?.trim() ?? '';

                    if (text.isEmpty) {
                      return null;
                    }

                    final weight =
                        double.tryParse(text);

                    if (weight == null ||
                        weight < 0) {
                      return 'Please enter a valid package weight.';
                    }

                    return null;
                  },
                ),

                const SizedBox(height: 8),

                SizedBox(
                  width: double.infinity,
                  height: 54,
                  child: FilledButton.icon(
                    onPressed: isLoading
                        ? null
                        : createDelivery,
                    icon: isLoading
                        ? const SizedBox(
                            width: 22,
                            height: 22,
                            child:
                                CircularProgressIndicator(
                              strokeWidth: 2.5,
                              color: Colors.white,
                            ),
                          )
                        : const Icon(
                            Icons.send_rounded,
                          ),
                    label: Text(
                      isLoading
                          ? 'Submitting...'
                          : 'Create Delivery Request',
                      style: const TextStyle(
                        fontSize: 16,
                        fontWeight:
                            FontWeight.w700,
                      ),
                    ),
                    style:
                        FilledButton.styleFrom(
                      backgroundColor:
                          const Color(0xFF1565C0),
                      shape:
                          RoundedRectangleBorder(
                        borderRadius:
                            BorderRadius.circular(
                          14,
                        ),
                      ),
                    ),
                  ),
                ),

                const SizedBox(height: 16),

                const Center(
                  child: Text(
                    'The delivery fee will be provided after your request is reviewed.',
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      fontSize: 12,
                      color: Color(0xFF6B7280),
                      height: 1.4,
                    ),
                  ),
                ),

                const SizedBox(height: 22),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
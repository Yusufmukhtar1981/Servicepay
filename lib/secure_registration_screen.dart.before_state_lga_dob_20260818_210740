import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;

class SecureRegistrationScreen extends StatefulWidget {
  const SecureRegistrationScreen({super.key});

  @override
  State<SecureRegistrationScreen> createState() =>
      _SecureRegistrationScreenState();
}

class _SecureRegistrationScreenState extends State<SecureRegistrationScreen> {
  static const String baseUrl = 'https://api.servicepay.ng/api';

  final PageController _pageController = PageController();

  final fullNameController = TextEditingController();
  final phoneController = TextEditingController();
  final emailController = TextEditingController();
  final dobController = TextEditingController();
  final addressController = TextEditingController();
  final stateController = TextEditingController();
  final lgaController = TextEditingController();

  final passwordController = TextEditingController();
  final confirmPasswordController = TextEditingController();
  final pinController = TextEditingController();
  final confirmPinController = TextEditingController();

  final ninController = TextEditingController();
  final referralController = TextEditingController();

  int currentStep = 0;
  bool loading = false;
  bool hidePassword = true;
  bool hideConfirmPassword = true;
  bool hidePin = true;

  bool acceptTerms = false;
  bool kycConsent = false;

  String gender = '';

  final Color servicePayGreen = const Color(0xFF08783E);

  @override
  void dispose() {
    _pageController.dispose();

    for (final c in [
      fullNameController,
      phoneController,
      emailController,
      dobController,
      addressController,
      stateController,
      lgaController,
      passwordController,
      confirmPasswordController,
      pinController,
      confirmPinController,
      ninController,
      referralController,
    ]) {
      c.dispose();
    }

    super.dispose();
  }

  void showMessage(String message, {bool error = true}) {
    if (!mounted) return;

    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(message)),
    );
  }

  bool validateStepOne() {
    if (fullNameController.text.trim().split(' ').length < 2) {
      showMessage('Please enter your complete name.');
      return false;
    }

    final phone = phoneController.text.replaceAll(RegExp(r'\D'), '');

    if (phone.length < 10) {
      showMessage('Please enter a valid phone number.');
      return false;
    }

    final email = emailController.text.trim();

    if (!RegExp(r'^[^@\s]+@[^@\s]+\.[^@\s]+$').hasMatch(email)) {
      showMessage('Please enter a valid email address.');
      return false;
    }

    if (dobController.text.trim().isEmpty) {
      showMessage('Date of birth is required.');
      return false;
    }

    if (gender.isEmpty) {
      showMessage('Please select your gender.');
      return false;
    }

    if (stateController.text.trim().isEmpty ||
        lgaController.text.trim().isEmpty ||
        addressController.text.trim().length < 5) {
      showMessage('Please complete your residential information.');
      return false;
    }

    return true;
  }

  bool validateStepTwo() {
    final password = passwordController.text;

    if (password.length < 8 ||
        !RegExp(r'[A-Z]').hasMatch(password) ||
        !RegExp(r'[a-z]').hasMatch(password) ||
        !RegExp(r'[0-9]').hasMatch(password) ||
        !RegExp(r'[^A-Za-z0-9]').hasMatch(password)) {
      showMessage(
        'Password must be 8+ characters and include uppercase, '
        'lowercase, number and special character.',
      );
      return false;
    }

    if (password != confirmPasswordController.text) {
      showMessage('Passwords do not match.');
      return false;
    }

    final pin = pinController.text.trim();

    if (!RegExp(r'^\d{4}$').hasMatch(pin)) {
      showMessage('Transaction PIN must contain exactly 4 digits.');
      return false;
    }

    if (pin != confirmPinController.text.trim()) {
      showMessage('Transaction PINs do not match.');
      return false;
    }

    const weakPins = {
      '0000',
      '1111',
      '1234',
      '4321',
      '0123',
      '9876',
    };

    if (weakPins.contains(pin)) {
      showMessage('Please choose a less predictable transaction PIN.');
      return false;
    }

    if (!acceptTerms) {
      showMessage('Please accept the Terms and Privacy Policy.');
      return false;
    }

    return true;
  }

  bool validateStepThree() {
    final nin = ninController.text.replaceAll(RegExp(r'\D'), '');

    if (nin.length != 11) {
      showMessage('Please enter a valid 11-digit NIN.');
      return false;
    }

    if (!kycConsent) {
      showMessage('KYC verification consent is required.');
      return false;
    }

    return true;
  }

  void nextStep() {
    bool valid = false;

    if (currentStep == 0) valid = validateStepOne();
    if (currentStep == 1) valid = validateStepTwo();

    if (!valid) return;

    setState(() => currentStep++);

    _pageController.animateToPage(
      currentStep,
      duration: const Duration(milliseconds: 250),
      curve: Curves.easeInOut,
    );
  }

  void previousStep() {
    if (currentStep == 0) {
      Navigator.pop(context);
      return;
    }

    setState(() => currentStep--);

    _pageController.animateToPage(
      currentStep,
      duration: const Duration(milliseconds: 250),
      curve: Curves.easeInOut,
    );
  }

  Future<void> register() async {
    if (!validateStepThree()) return;

    setState(() => loading = true);

    try {
      final payload = {
        'fullName': fullNameController.text.trim(),
        'phone': phoneController.text.trim(),
        'email': emailController.text.trim().toLowerCase(),
        'password': passwordController.text,
        'transactionPin': pinController.text.trim(),
        'dateOfBirth': dobController.text.trim(),
        'gender': gender,
        'residentialAddress': addressController.text.trim(),
        'state': stateController.text.trim(),
        'lga': lgaController.text.trim(),
        'nin': ninController.text.trim(),
        'kycConsent': true,
        'acceptTerms': true,
        if (referralController.text.trim().isNotEmpty)
          'referralCode': referralController.text.trim(),
      };

      final response = await http.post(
        Uri.parse('$baseUrl/auth/register'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode(payload),
      );

      dynamic data;

      try {
        data = jsonDecode(response.body);
      } catch (_) {
        data = null;
      }

      if (response.statusCode >= 200 && response.statusCode < 300) {
        if (!mounted) return;

        await showDialog<void>(
          context: context,
          barrierDismissible: false,
          builder: (_) => AlertDialog(
            title: const Text('Account Created'),
            content: const Text(
              'Your ServicePay account has been created successfully. '
              'Your identity/KYC information will be processed according '
              'to your account verification level.',
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.pop(context),
                child: const Text('Continue'),
              ),
            ],
          ),
        );

        if (!mounted) return;
        Navigator.pop(context);
        return;
      }

      showMessage(
        data is Map && data['message'] != null
            ? data['message'].toString()
            : 'Unable to create account. Please try again.',
      );
    } catch (_) {
      showMessage(
        'Unable to connect to ServicePay. Please check your connection.',
      );
    } finally {
      if (mounted) setState(() => loading = false);
    }
  }

  Widget stepHeader() {
    final titles = [
      'Personal Details',
      'Account Security',
      'Identity Verification',
    ];

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          'Step ${currentStep + 1} of 3',
          style: TextStyle(
            color: servicePayGreen,
            fontWeight: FontWeight.w700,
          ),
        ),
        const SizedBox(height: 6),
        Text(
          titles[currentStep],
          style: const TextStyle(
            fontSize: 24,
            fontWeight: FontWeight.w800,
          ),
        ),
        const SizedBox(height: 14),
        Row(
          children: List.generate(
            3,
            (index) => Expanded(
              child: Container(
                height: 5,
                margin: EdgeInsets.only(right: index == 2 ? 0 : 6),
                decoration: BoxDecoration(
                  color: index <= currentStep
                      ? servicePayGreen
                      : Colors.grey.shade300,
                  borderRadius: BorderRadius.circular(20),
                ),
              ),
            ),
          ),
        ),
      ],
    );
  }

  Widget field({
    required TextEditingController controller,
    required String label,
    TextInputType? keyboard,
    bool obscure = false,
    Widget? suffixIcon,
    int maxLength = 80,
  }) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 14),
      child: TextField(
        controller: controller,
        keyboardType: keyboard,
        obscureText: obscure,
        maxLength: maxLength,
        decoration: InputDecoration(
          labelText: label,
          counterText: '',
          suffixIcon: suffixIcon,
          border: OutlineInputBorder(
            borderRadius: BorderRadius.circular(12),
          ),
        ),
      ),
    );
  }

  Widget personalStep() {
    return ListView(
      children: [
        stepHeader(),
        const SizedBox(height: 24),
        field(
          controller: fullNameController,
          label: 'Full legal name',
        ),
        field(
          controller: phoneController,
          label: 'Phone number',
          keyboard: TextInputType.phone,
        ),
        field(
          controller: emailController,
          label: 'Email address',
          keyboard: TextInputType.emailAddress,
        ),
        field(
          controller: dobController,
          label: 'Date of birth (YYYY-MM-DD)',
          keyboard: TextInputType.datetime,
        ),
        DropdownButtonFormField<String>(
          value: gender.isEmpty ? null : gender,
          decoration: InputDecoration(
            labelText: 'Gender',
            border: OutlineInputBorder(
              borderRadius: BorderRadius.circular(12),
            ),
          ),
          items: const [
            DropdownMenuItem(value: 'MALE', child: Text('Male')),
            DropdownMenuItem(value: 'FEMALE', child: Text('Female')),
            DropdownMenuItem(value: 'OTHER', child: Text('Other')),
          ],
          onChanged: (value) => setState(() => gender = value ?? ''),
        ),
        const SizedBox(height: 14),
        field(
          controller: stateController,
          label: 'State of residence',
        ),
        field(
          controller: lgaController,
          label: 'LGA',
        ),
        field(
          controller: addressController,
          label: 'Residential address',
          maxLength: 160,
        ),
        field(
          controller: referralController,
          label: 'Referral code (optional)',
        ),
      ],
    );
  }

  Widget securityStep() {
    return ListView(
      children: [
        stepHeader(),
        const SizedBox(height: 24),
        field(
          controller: passwordController,
          label: 'Create strong password',
          obscure: hidePassword,
          suffixIcon: IconButton(
            onPressed: () => setState(() => hidePassword = !hidePassword),
            icon: Icon(
              hidePassword ? Icons.visibility_off : Icons.visibility,
            ),
          ),
        ),
        field(
          controller: confirmPasswordController,
          label: 'Confirm password',
          obscure: hideConfirmPassword,
          suffixIcon: IconButton(
            onPressed: () => setState(
              () => hideConfirmPassword = !hideConfirmPassword,
            ),
            icon: Icon(
              hideConfirmPassword ? Icons.visibility_off : Icons.visibility,
            ),
          ),
        ),
        Container(
          padding: const EdgeInsets.all(14),
          margin: const EdgeInsets.only(bottom: 16),
          decoration: BoxDecoration(
            color: Colors.grey.shade100,
            borderRadius: BorderRadius.circular(12),
          ),
          child: const Text(
            'Password must contain at least 8 characters, uppercase, '
            'lowercase, number and special character.',
          ),
        ),
        field(
          controller: pinController,
          label: 'Create 4-digit transaction PIN',
          keyboard: TextInputType.number,
          obscure: hidePin,
          maxLength: 4,
        ),
        field(
          controller: confirmPinController,
          label: 'Confirm transaction PIN',
          keyboard: TextInputType.number,
          obscure: hidePin,
          maxLength: 4,
        ),
        CheckboxListTile(
          contentPadding: EdgeInsets.zero,
          value: acceptTerms,
          onChanged: (value) => setState(() => acceptTerms = value ?? false),
          title: const Text(
            'I accept the ServicePay Terms & Conditions '
            'and Privacy Policy.',
          ),
          controlAffinity: ListTileControlAffinity.leading,
        ),
      ],
    );
  }

  Widget kycStep() {
    return ListView(
      children: [
        stepHeader(),
        const SizedBox(height: 24),
        Container(
          padding: const EdgeInsets.all(16),
          margin: const EdgeInsets.only(bottom: 18),
          decoration: BoxDecoration(
            color: servicePayGreen.withValues(alpha: 0.08),
            borderRadius: BorderRadius.circular(14),
          ),
          child: const Text(
            'ServicePay requires basic identity verification to help '
            'protect your account and support regulatory compliance. '
            'Higher account tiers may require additional documents.',
          ),
        ),
        field(
          controller: ninController,
          label: '11-digit NIN',
          keyboard: TextInputType.number,
          maxLength: 11,
        ),
        CheckboxListTile(
          contentPadding: EdgeInsets.zero,
          value: kycConsent,
          onChanged: (value) => setState(() => kycConsent = value ?? false),
          title: const Text(
            'I consent to ServicePay using the information provided '
            'for identity and KYC verification.',
          ),
          controlAffinity: ListTileControlAffinity.leading,
        ),
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        leading: IconButton(
          onPressed: loading ? null : previousStep,
          icon: const Icon(Icons.arrow_back),
        ),
        title: const Text('Create ServicePay Account'),
      ),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(20, 16, 20, 12),
          child: Column(
            children: [
              Expanded(
                child: PageView(
                  controller: _pageController,
                  physics: const NeverScrollableScrollPhysics(),
                  children: [
                    personalStep(),
                    securityStep(),
                    kycStep(),
                  ],
                ),
              ),
              const SizedBox(height: 12),
              SizedBox(
                width: double.infinity,
                height: 52,
                child: FilledButton(
                  style: FilledButton.styleFrom(
                    backgroundColor: servicePayGreen,
                  ),
                  onPressed: loading
                      ? null
                      : currentStep < 2
                          ? nextStep
                          : register,
                  child: loading
                      ? const SizedBox(
                          height: 22,
                          width: 22,
                          child: CircularProgressIndicator(
                            strokeWidth: 2,
                            color: Colors.white,
                          ),
                        )
                      : Text(
                          currentStep < 2 ? 'Continue' : 'Create Account',
                        ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

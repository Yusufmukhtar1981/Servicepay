import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

/// Shared Customer-theme form fields for account creation flows
/// (customer self-registration and authorised manager/agent creation).
///
/// Every widget takes the caller's own controller and optional validator so
/// existing screens keep their controllers, validators and endpoints. None
/// of these widgets log, persist or transmit values.

/// Normalises a Nigerian mobile number to its 11-digit local form
/// (0XXXXXXXXXX). Accepts local 11-digit numbers starting with 0 and
/// international +234 / 234 forms. Returns null when invalid.
String? normalizeNigerianPhone(String raw) {
  final compact = raw.replaceAll(RegExp(r'[\s\-()]'), '');
  String local;
  if (RegExp(r'^\+234\d{10}$').hasMatch(compact)) {
    local = '0${compact.substring(4)}';
  } else if (RegExp(r'^234\d{10}$').hasMatch(compact)) {
    local = '0${compact.substring(3)}';
  } else if (RegExp(r'^0\d{10}$').hasMatch(compact)) {
    local = compact;
  } else {
    return null;
  }
  return RegExp(r'^0[789][01]\d{8}$').hasMatch(local) ? local : null;
}

bool isValidRegistrationEmail(String value) => RegExp(
        r'^[A-Za-z0-9._%+\-]+@[A-Za-z0-9\-]+(\.[A-Za-z0-9\-]+)*\.[A-Za-z]{2,}$')
    .hasMatch(value.trim());

/// Reusable validators. Pure functions; safe to use from any form.
abstract final class RegistrationValidators {
  static String? fullName(String? v) {
    final parts = (v ?? '').trim().split(RegExp(r'\s+'));
    if (parts.length < 2 || parts.any((p) => p.length < 2)) {
      return 'Enter your first and last name.';
    }
    return null;
  }

  static String? phone(String? v) => normalizeNigerianPhone(v ?? '') == null
      ? 'Enter a valid Nigerian number, e.g. 08012345678 or +2348012345678.'
      : null;

  static String? email(String? v) =>
      isValidRegistrationEmail(v ?? '') ? null : 'Enter a valid email address.';

  static String? password(String? v) {
    final p = v ?? '';
    if (p.length < 8 ||
        !RegExp(r'[A-Z]').hasMatch(p) ||
        !RegExp(r'[a-z]').hasMatch(p) ||
        !RegExp(r'[0-9]').hasMatch(p) ||
        !RegExp(r'[^A-Za-z0-9]').hasMatch(p)) {
      return 'Use 8+ characters with upper, lower, number and symbol.';
    }
    return null;
  }

  /// Builds a confirmation validator bound to [original].
  static FormFieldValidator<String> matches(
    TextEditingController original,
    String mismatchMessage,
  ) =>
      (v) => (v ?? '').isEmpty || v != original.text
          ? mismatchMessage
          : null;
}

/// Plain themed text field used by all shared registration inputs.
class RegistrationTextField extends StatelessWidget {
  const RegistrationTextField({
    super.key,
    required this.controller,
    required this.label,
    this.validator,
    this.keyboardType,
    this.maxLength = 80,
    this.inputFormatters,
    this.autofillHints,
    this.textCapitalization = TextCapitalization.none,
    this.enabled = true,
  });

  final TextEditingController controller;
  final String label;
  final FormFieldValidator<String>? validator;
  final TextInputType? keyboardType;
  final int maxLength;
  final List<TextInputFormatter>? inputFormatters;
  final Iterable<String>? autofillHints;
  final TextCapitalization textCapitalization;
  final bool enabled;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 14),
      child: TextFormField(
        controller: controller,
        enabled: enabled,
        keyboardType: keyboardType,
        textCapitalization: textCapitalization,
        autofillHints: autofillHints,
        maxLength: maxLength,
        inputFormatters: inputFormatters,
        validator: validator,
        textInputAction: TextInputAction.next,
        autovalidateMode: AutovalidateMode.onUserInteraction,
        decoration: InputDecoration(
          labelText: label,
          counterText: '',
          errorMaxLines: 2,
        ),
      ),
    );
  }
}

/// Obscured secret input (password, PIN, identity number) with its own
/// show/hide toggle. Autocorrect, suggestions and IME learning are disabled.
/// The toggle is reachable via `Key('toggle-$toggleKeyName')` when provided.
class SecretTextField extends StatefulWidget {
  const SecretTextField({
    super.key,
    required this.controller,
    required this.label,
    required this.secretName,
    this.validator,
    this.keyboardType,
    this.maxLength = 64,
    this.inputFormatters,
    this.toggleKeyName,
    this.enabled = true,
  });

  final TextEditingController controller;
  final String label;

  /// Human name used in the toggle tooltip, e.g. "password" or "PIN".
  final String secretName;
  final FormFieldValidator<String>? validator;
  final TextInputType? keyboardType;
  final int maxLength;
  final List<TextInputFormatter>? inputFormatters;
  final String? toggleKeyName;
  final bool enabled;

  @override
  State<SecretTextField> createState() => _SecretTextFieldState();
}

class _SecretTextFieldState extends State<SecretTextField> {
  bool _hidden = true;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 14),
      child: TextFormField(
        controller: widget.controller,
        enabled: widget.enabled,
        keyboardType: widget.keyboardType,
        obscureText: _hidden,
        autocorrect: false,
        enableSuggestions: false,
        enableIMEPersonalizedLearning: false,
        maxLength: widget.maxLength,
        inputFormatters: widget.inputFormatters,
        validator: widget.validator,
        textInputAction: TextInputAction.next,
        autovalidateMode: AutovalidateMode.onUserInteraction,
        decoration: InputDecoration(
          labelText: widget.label,
          counterText: '',
          errorMaxLines: 2,
          suffixIcon: IconButton(
            key: widget.toggleKeyName == null
                ? null
                : Key('toggle-${widget.toggleKeyName}'),
            tooltip: _hidden
                ? 'Show ${widget.secretName}'
                : 'Hide ${widget.secretName}',
            onPressed: () => setState(() => _hidden = !_hidden),
            icon: Icon(_hidden ? Icons.visibility_off : Icons.visibility),
          ),
        ),
      ),
    );
  }
}

// ---- Individual basic fields (compose in any order) ----

class FullNameField extends StatelessWidget {
  const FullNameField({super.key, required this.controller, this.validator,
      this.label = 'Full Name', this.enabled = true});
  final TextEditingController controller;
  final FormFieldValidator<String>? validator;
  final String label;
  final bool enabled;

  @override
  Widget build(BuildContext context) => RegistrationTextField(
        controller: controller,
        label: label,
        enabled: enabled,
        validator: validator ?? RegistrationValidators.fullName,
        textCapitalization: TextCapitalization.words,
        autofillHints: const [AutofillHints.name],
      );
}

class NigerianPhoneField extends StatelessWidget {
  const NigerianPhoneField({super.key, required this.controller,
      this.validator, this.label = 'Phone Number', this.enabled = true});
  final TextEditingController controller;
  final FormFieldValidator<String>? validator;
  final String label;
  final bool enabled;

  @override
  Widget build(BuildContext context) => RegistrationTextField(
        controller: controller,
        label: label,
        enabled: enabled,
        keyboardType: TextInputType.phone,
        maxLength: 20,
        validator: validator ?? RegistrationValidators.phone,
        inputFormatters: [
          FilteringTextInputFormatter.allow(RegExp(r'[0-9+ ]')),
        ],
        autofillHints: const [AutofillHints.telephoneNumber],
      );
}

class EmailField extends StatelessWidget {
  const EmailField({super.key, required this.controller, this.validator,
      this.label = 'Email', this.enabled = true});
  final TextEditingController controller;
  final FormFieldValidator<String>? validator;
  final String label;
  final bool enabled;

  @override
  Widget build(BuildContext context) => RegistrationTextField(
        controller: controller,
        label: label,
        enabled: enabled,
        keyboardType: TextInputType.emailAddress,
        maxLength: 120,
        validator: validator ?? RegistrationValidators.email,
        autofillHints: const [AutofillHints.email],
      );
}

class PasswordField extends StatelessWidget {
  const PasswordField({super.key, required this.controller, this.validator,
      this.label = 'Password', this.toggleKeyName = 'password',
      this.enabled = true});
  final TextEditingController controller;
  final FormFieldValidator<String>? validator;
  final String label;
  final String? toggleKeyName;
  final bool enabled;

  @override
  Widget build(BuildContext context) => SecretTextField(
        controller: controller,
        label: label,
        enabled: enabled,
        secretName: 'password',
        toggleKeyName: toggleKeyName,
        validator: validator ?? RegistrationValidators.password,
      );
}

class ConfirmPasswordField extends StatelessWidget {
  const ConfirmPasswordField({super.key, required this.controller,
      required this.passwordController, this.validator,
      this.label = 'Confirm Password',
      this.toggleKeyName = 'confirmPassword', this.enabled = true});
  final TextEditingController controller;
  final TextEditingController passwordController;
  final FormFieldValidator<String>? validator;
  final String label;
  final String? toggleKeyName;
  final bool enabled;

  @override
  Widget build(BuildContext context) => SecretTextField(
        controller: controller,
        label: label,
        enabled: enabled,
        secretName: 'password confirmation',
        toggleKeyName: toggleKeyName,
        validator: validator ??
            RegistrationValidators.matches(
                passwordController, 'Passwords do not match.'),
      );
}

/// Grouped convenience: Full Name, Phone, Email, Password, Confirm Password.
/// Manager/agent creation screens can drop this in with their controllers.
/// Customer registration composes the individual fields instead so it can
/// interleave State/LGA in the required order.
class RegistrationDetailsFields extends StatelessWidget {
  const RegistrationDetailsFields({
    super.key,
    required this.fullNameController,
    required this.phoneController,
    required this.emailController,
    this.passwordController,
    this.confirmPasswordController,
    this.enabled = true,
  });

  final TextEditingController fullNameController;
  final TextEditingController phoneController;
  final TextEditingController emailController;
  final TextEditingController? passwordController;
  final TextEditingController? confirmPasswordController;
  final bool enabled;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        FullNameField(controller: fullNameController, enabled: enabled),
        NigerianPhoneField(controller: phoneController, enabled: enabled),
        EmailField(controller: emailController, enabled: enabled),
        if (passwordController != null)
          PasswordField(controller: passwordController!, enabled: enabled),
        if (passwordController != null && confirmPasswordController != null)
          ConfirmPasswordField(
            controller: confirmPasswordController!,
            passwordController: passwordController!,
            enabled: enabled,
          ),
      ],
    );
  }
}

import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

class EduPaySchoolManagementScreen extends StatefulWidget {
  const EduPaySchoolManagementScreen({super.key});

  @override
  State<EduPaySchoolManagementScreen> createState() =>
      _EduPaySchoolManagementScreenState();
}

class _EduPaySchoolManagementScreenState
    extends State<EduPaySchoolManagementScreen> {
  final formKey = GlobalKey<FormState>();
  final name = TextEditingController();
  final location = TextEditingController();
  final state = TextEditingController();
  final lga = TextEditingController();
  final type = TextEditingController();
  final contact = TextEditingController();
  final phone = TextEditingController();
  final email = TextEditingController();
  final registration = TextEditingController();
  final representative = TextEditingController();
  bool loading = true;
  bool saving = false;
  String error = '';
  List<Map<String, dynamic>> requests = [];

  @override
  void initState() {
    super.initState();
    loadSchools();
  }

  @override
  void dispose() {
    for (final controller in [name, location, state, lga, type, contact, phone, email, registration, representative]) {
      controller.dispose();
    }
    super.dispose();
  }

  Future<String?> token() async {
    final prefs = await SharedPreferences.getInstance();
    for (final key in ['auth_token', 'token', 'access_token', 'jwt_token']) {
      final value = prefs.getString(key);
      if (value != null && value.trim().isNotEmpty) return value.trim();
    }
    return null;
  }

  Future<void> loadSchools() async {
    try {
      final auth = await token();
      final response = await http.get(
        Uri.parse('https://api.servicepay.ng/api/edupay/state-manager/schools'),
        headers: {'Accept': 'application/json', 'Authorization': 'Bearer $auth'},
      ).timeout(const Duration(seconds: 45));
      final body = jsonDecode(response.body);
      if (response.statusCode < 200 || response.statusCode >= 300 ||
          body is! Map || body['success'] != true) {
        throw Exception(body is Map ? body['message'] : 'Unable to load schools.');
      }
      final raw = body['requests'];
      requests = raw is List
          ? raw.whereType<Map>().map((row) => Map<String, dynamic>.from(row)).toList()
          : [];
    } catch (e) {
      error = e.toString().replaceFirst('Exception: ', '');
    } finally {
      if (mounted) setState(() => loading = false);
    }
  }

  Future<void> createSchool() async {
    if (saving || !(formKey.currentState?.validate() ?? false)) return;
    setState(() { saving = true; error = ''; });
    try {
      final auth = await token();
      final response = await http.post(
        Uri.parse('https://api.servicepay.ng/api/edupay/state-manager/schools'),
        headers: {'Accept': 'application/json', 'Content-Type': 'application/json',
          'Authorization': 'Bearer $auth'},
        body: jsonEncode({
          'schoolName': name.text.trim(), 'location': location.text.trim(),
          'state': state.text.trim(), 'lga': lga.text.trim(),
          'schoolType': type.text.trim(), 'contactPerson': contact.text.trim(),
          'phone': phone.text.trim(), 'email': email.text.trim(),
          'registrationNumber': registration.text.trim(),
          'authorizedRepresentative': representative.text.trim(),
        }),
      ).timeout(const Duration(seconds: 45));
      final body = jsonDecode(response.body);
      if (response.statusCode < 200 || response.statusCode >= 300 ||
          body is! Map || body['success'] != true) {
        throw Exception(body is Map ? body['message'] : 'Unable to register school.');
      }
      for (final controller in [name, location, state, lga, type, contact, phone, email, registration, representative]) {
        controller.clear();
      }
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
          content: Text('School submitted. It is pending Head Office approval.')));
      }
      await loadSchools();
    } catch (e) {
      if (mounted) setState(() => error = e.toString().replaceFirst('Exception: ', ''));
    } finally {
      if (mounted) setState(() => saving = false);
    }
  }

  Widget field(TextEditingController controller, String label, {bool required = false}) =>
      Padding(padding: const EdgeInsets.only(bottom: 12), child: TextFormField(
        controller: controller, decoration: InputDecoration(labelText: label, border: const OutlineInputBorder()),
        validator: required ? (value) => (value == null || value.trim().isEmpty) ? '$label is required.' : null : null,
      ));

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: const Text('EduPay Schools')),
    body: RefreshIndicator(
      onRefresh: loadSchools,
      child: ListView(padding: const EdgeInsets.all(16), children: [
        const Text('Register a school', style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold)),
        const SizedBox(height: 6),
        const Text('Every registration is reviewed by Head Office before it appears in the EduPay catalogue.'),
        const SizedBox(height: 16),
        Form(key: formKey, child: Column(children: [
          field(name, 'School name', required: true), field(location, 'Address / location', required: true),
          field(state, 'State', required: true), field(lga, 'LGA', required: true), field(type, 'School type', required: true), field(contact, 'Contact person', required: true),
          field(phone, 'School phone', required: true), field(email, 'School email', required: true),
          field(registration, 'Registration number', required: true),
          field(representative, 'Authorized representative', required: true),
          SizedBox(width: double.infinity, child: FilledButton(
            onPressed: saving ? null : createSchool,
            child: Text(saving ? 'Submitting...' : 'Submit for approval'))),
        ])),
        if (error.isNotEmpty) Padding(padding: const EdgeInsets.only(top: 12), child: Text(error, style: const TextStyle(color: Colors.red))),
        const SizedBox(height: 24),
        const Text('My registrations', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
        if (loading) const Padding(padding: EdgeInsets.all(20), child: Center(child: CircularProgressIndicator())),
        if (!loading && requests.isEmpty) const Padding(padding: EdgeInsets.only(top: 12), child: Text('No school registrations yet.')),
        ...requests.map((row) => Card(child: ListTile(
          title: Text(row['schoolName']?.toString() ?? 'School'),
          subtitle: Text(row['location']?.toString() ?? ''),
          trailing: Chip(label: Text(row['status']?.toString() ?? 'PENDING_REVIEW')),
        ))),
      ]),
    ),
  );
}
import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:http_parser/http_parser.dart';
import 'package:image_picker/image_picker.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:flutter/services.dart';

bool isSupportedKycImageFilename(String filename) {
  final String extension = filename.split('.').last.toLowerCase();
  return extension == 'jpg' || extension == 'jpeg' || extension == 'png';
}

MediaType kycImageContentType(String filename) {
  final String extension = filename.split('.').last.toLowerCase();
  return MediaType('image', extension == 'png' ? 'png' : 'jpeg');
}

http.MultipartFile kycDocumentMultipartFile({
  required List<int> bytes,
  required String filename,
}) {
  return http.MultipartFile.fromBytes(
    'document',
    bytes,
    filename: filename,
    contentType: kycImageContentType(filename),
  );
}

class _KycLocalImage {
  const _KycLocalImage({required this.name, required this.bytes});

  final String name;
  final Uint8List bytes;
}

class KycScreen extends StatefulWidget {
  const KycScreen({super.key});

  @override
  State<KycScreen> createState() => _KycScreenState();
}

class _KycScreenState extends State<KycScreen> {
  static const String _baseUrl = 'https://api.servicepay.ng/api';
  final GlobalKey<FormState> _formKey = GlobalKey<FormState>();
  final ImagePicker _picker = ImagePicker();
  final TextEditingController _firstName = TextEditingController();
  final TextEditingController _middleName = TextEditingController();
  final TextEditingController _lastName = TextEditingController();
  final TextEditingController _phone = TextEditingController();
  final TextEditingController _email = TextEditingController();
  final TextEditingController _address = TextEditingController();
  final TextEditingController _state = TextEditingController();
  final TextEditingController _lga = TextEditingController();
  final TextEditingController _nin = TextEditingController();
  final TextEditingController _bvn = TextEditingController();

  DateTime? _dateOfBirth;
  String _gender = '';
  String _status = 'NOT_STARTED';
  String _level = 'TIER_1';
  String _requestedLevel = 'TIER_1';
  String _governmentIdType = '';
  String _identityMatchStatus = 'NOT_VERIFIED';
  String _reviewReason = '';

  bool _ninVerified = false;
  bool _bvnVerified = false;
  String _ninLast4 = '';
  String _bvnLast4 = '';
  bool _consentAccepted = false;
  bool _loading = true;
  bool _submitting = false;
  final Map<String, bool> _uploading = <String, bool>{};
  final Map<String, bool> _uploaded = <String, bool>{};
  final Map<String, _KycLocalImage> _previews = <String, _KycLocalImage>{};
  final Map<String, String> _verificationStates = <String, String>{
    'NIN': 'Not verified',
    'BVN': 'Not verified',
  };

  bool get _isLocked => _status == 'PENDING' || _status == 'UNDER_REVIEW';
  bool get _needsDocument => _requestedLevel != 'TIER_1';
  bool get _needsProofOfAddress => _requestedLevel == 'TIER_3';
  bool get _documentBackRequired => <String>[
        'NATIONAL_ID',
        'DRIVERS_LICENSE',
        'VOTERS_CARD'
      ].contains(_governmentIdType);

  @override
  void initState() {
    super.initState();
    _loadKyc();
  }

  @override
  void dispose() {
    for (final TextEditingController controller in <TextEditingController>[
      _firstName,
      _middleName,
      _lastName,
      _phone,
      _email,
      _address,
      _state,
      _lga,
      _nin,
      _bvn,
    ]) {
      controller.dispose();
    }
    super.dispose();
  }

  Future<String?> _token() async {
    final SharedPreferences prefs = await SharedPreferences.getInstance();
    final String? value = prefs.getString('auth_token')?.trim();
    if (value == null || value.isEmpty) return null;
    return value.toLowerCase().startsWith('bearer ')
        ? value.substring(7).trim()
        : value;
  }

  Future<void> _loadKyc() async {
    try {
      final String? token = await _token();
      if (token == null) {
        return;
      }
      final http.Response response = await http.get(
        Uri.parse('$_baseUrl/kyc/status'),
        headers: <String, String>{'Authorization': 'Bearer $token'},
      );
      final dynamic decoded = jsonDecode(response.body);
      if (response.statusCode >= 200 &&
          response.statusCode < 300 &&
          decoded is Map &&
          decoded['success'] == true &&
          decoded['kyc'] is Map) {
        _applyKyc(Map<String, dynamic>.from(decoded['kyc'] as Map));
      }
    } catch (_) {
      // The editable draft remains available; avoid exposing transport details.
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  void _applyKyc(Map<String, dynamic> kyc) {
    String field(String key) => (kyc[key] ?? '').toString();
    _firstName.text = field('firstName');
    _middleName.text = field('middleName');
    _lastName.text = field('lastName');
    _phone.text = field('phone');
    _email.text = field('email');
    _address.text = field('address');
    _state.text = field('state');
    _lga.text = field('lga');
    _status = field('status').toUpperCase().isEmpty
        ? 'NOT_STARTED'
        : field('status').toUpperCase();
    _level = field('level').toUpperCase().isEmpty
        ? 'TIER_1'
        : field('level').toUpperCase();
    _requestedLevel = field('requestedLevel').toUpperCase().isEmpty
        ? _level
        : field('requestedLevel').toUpperCase();
    _reviewReason = field('reviewReason').isNotEmpty
        ? field('reviewReason')
        : field('rejectionReason');
    _dateOfBirth = DateTime.tryParse(field('dateOfBirth'));

    final String gender = field('gender').toUpperCase();
    _gender =
        <String>['MALE', 'FEMALE', 'OTHER'].contains(gender) ? gender : '';
    final Map<String, dynamic> identity = kyc['identity'] is Map
        ? Map<String, dynamic>.from(kyc['identity'] as Map)
        : <String, dynamic>{};
    _ninVerified = identity['ninVerified'] == true;
    _bvnVerified = identity['bvnVerified'] == true;
    _ninLast4 = (identity['ninLast4'] ?? '').toString();
    _bvnLast4 = (identity['bvnLast4'] ?? '').toString();
    _identityMatchStatus =
        (identity['matchStatus'] ?? 'NOT_VERIFIED').toString();
    _verificationStates['NIN'] = _ninVerified
        ? 'Verified'
        : identity['ninSubmitted'] == true
            ? 'Submitted for manual review'
            : 'Not submitted';
    _verificationStates['BVN'] = _bvnVerified
        ? 'Verified'
        : identity['bvnSubmitted'] == true
            ? 'Submitted for manual review'
            : 'Not submitted';

    final Map<String, dynamic> documents = kyc['documents'] is Map
        ? Map<String, dynamic>.from(kyc['documents'] as Map)
        : <String, dynamic>{};
    _governmentIdType = (documents['documentType'] ?? '').toString();
    _uploaded
      ..['SELFIE'] = documents['selfieUploaded'] == true
      ..['ID_DOCUMENT_FRONT'] = documents['idDocumentUploaded'] == true
      ..['ID_DOCUMENT_BACK'] = documents['idDocumentBackUploaded'] == true
      ..['PROOF_OF_ADDRESS'] = documents['proofOfAddressUploaded'] == true;
  }

  void _message(String message, {bool error = false}) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
          content: Text(message),
          backgroundColor: error ? Colors.red.shade700 : null),
    );
  }

  Future<void> _pickDate() async {
    if (_isLocked) return;
    final DateTime now = DateTime.now();
    final DateTime? selected = await showDatePicker(
      context: context,
      initialDate: _dateOfBirth ?? DateTime(now.year - 25),
      firstDate: DateTime(1900),
      lastDate: DateTime(now.year - 18, now.month, now.day),
    );
    if (selected != null && mounted) setState(() => _dateOfBirth = selected);
  }

  Future<void> _verifyIdentity(String type) async {
    if (_isLocked || _verificationStates[type] == 'Verifying') return;
    final String identifier =
        (type == 'NIN' ? _nin : _bvn).text.replaceAll(' ', '');
    if (!RegExp(r'^\d{11}$').hasMatch(identifier)) {
      _message('Enter a valid 11-digit $type before verifying.', error: true);
      return;
    }
    if (!_consentAccepted) {
      _message('Accept the KYC consent before verifying identity.',
          error: true);
      return;
    }
    setState(() => _verificationStates[type] = 'Verifying');
    try {
      final String? token = await _token();
      if (token == null) {
        _message('Please log in again.', error: true);
        return;
      }
      final http.Response response = await http.post(
        Uri.parse('$_baseUrl/kyc/identity/verify'),
        headers: <String, String>{
          'Authorization': 'Bearer $token',
          'Content-Type': 'application/json',
        },
        body: jsonEncode(<String, dynamic>{
          'identityType': type,
          'identityNumber': identifier,
          'consentAccepted': true,
        }),
      );
      final dynamic decoded = jsonDecode(response.body);
      if (response.statusCode >= 200 &&
          response.statusCode < 300 &&
          decoded is Map &&
          decoded['success'] == true) {
        final Map<String, dynamic> identity = decoded['identity'] is Map
            ? Map<String, dynamic>.from(decoded['identity'] as Map)
            : <String, dynamic>{};
        if (mounted) {
          setState(() {
            _ninVerified = identity['ninVerified'] == true;
            _bvnVerified = identity['bvnVerified'] == true;
            _ninLast4 = (identity['ninLast4'] ?? '').toString();
            _bvnLast4 = (identity['bvnLast4'] ?? '').toString();
            _identityMatchStatus =
                (identity['matchStatus'] ?? 'NOT_VERIFIED').toString();
            _verificationStates[type] = 'Verified';
            (type == 'NIN' ? _nin : _bvn).clear();
          });
        }
        _message('$type verified successfully.');
      } else {
        final String code =
            decoded is Map ? (decoded['code'] ?? '').toString() : '';
        if (mounted) {
          setState(() {
            _verificationStates[type] = code == 'PROVIDER_UNAVAILABLE'
                ? 'Provider unavailable'
                : 'Verification failed';
          });
        }
        _message(
          decoded is Map
              ? (decoded['message'] ?? 'Unable to verify $type.').toString()
              : 'Unable to verify $type.',
          error: true,
        );
      }
    } catch (_) {
      if (mounted) {
        setState(() => _verificationStates[type] = 'Verification failed');
      }
      _message('Unable to verify $type. Please try again.', error: true);
    }
  }

  Future<ImageSource?> _sourceChooser(String title) async {
    return showModalBottomSheet<ImageSource>(
      context: context,
      builder: (BuildContext context) => SafeArea(
        child: Wrap(
          children: <Widget>[
            ListTile(title: Text(title), enabled: false),
            ListTile(
              leading: const Icon(Icons.camera_alt_outlined),
              title: const Text('Use camera'),
              onTap: () => Navigator.pop(context, ImageSource.camera),
            ),
            ListTile(
              leading: const Icon(Icons.photo_library_outlined),
              title: const Text('Choose from gallery'),
              onTap: () => Navigator.pop(context, ImageSource.gallery),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _pickAndUpload(String documentType, String title) async {
    if (_isLocked || _uploading[documentType] == true) return;
    if (documentType.startsWith('ID_DOCUMENT') && _governmentIdType.isEmpty) {
      _message('Select your government ID type first.', error: true);
      return;
    }
    final ImageSource? source = await _sourceChooser(title);
    if (source == null) return;
    final XFile? selected = await _picker.pickImage(
      source: source,
      imageQuality: 88,
      maxWidth: 1800,
      maxHeight: 1800,
    );
    if (selected == null) return;
    if (!isSupportedKycImageFilename(selected.name)) {
      _message('Choose a JPEG or PNG image.', error: true);
      return;
    }

    final Uint8List bytes = await selected.readAsBytes();
    if (bytes.length > 8 * 1024 * 1024) {
      _message('KYC images must be 8 MB or smaller.', error: true);
      return;
    }
    if (mounted) {
      setState(() {
        _previews[documentType] =
            _KycLocalImage(name: selected.name, bytes: bytes);
        _uploading[documentType] = true;
      });
    }
    try {
      final String? token = await _token();
      if (token == null) {
        _message('Please log in again.', error: true);
        return;
      }
      final http.MultipartRequest request = http.MultipartRequest(
        'POST',
        Uri.parse('$_baseUrl/kyc/document/upload'),
      );
      request.headers['Authorization'] = 'Bearer $token';
      request.fields['documentType'] = documentType;
      if (documentType.startsWith('ID_DOCUMENT')) {
        request.fields['governmentIdType'] = _governmentIdType;
      }
      request.files
          .add(kycDocumentMultipartFile(bytes: bytes, filename: selected.name));
      final http.Response response =
          await http.Response.fromStream(await request.send());
      final dynamic decoded = jsonDecode(response.body);
      if (response.statusCode >= 200 &&
          response.statusCode < 300 &&
          decoded is Map &&
          decoded['success'] == true) {
        final Map<String, dynamic> documents = decoded['documents'] is Map
            ? Map<String, dynamic>.from(decoded['documents'] as Map)
            : <String, dynamic>{};
        if (mounted) {
          setState(() {
            _uploaded[documentType] = true;
            _uploaded['ID_DOCUMENT_FRONT'] =
                documents['idDocumentUploaded'] == true ||
                    _uploaded['ID_DOCUMENT_FRONT'] == true;
            _uploaded['ID_DOCUMENT_BACK'] =
                documents['idDocumentBackUploaded'] == true ||
                    _uploaded['ID_DOCUMENT_BACK'] == true;
            _uploaded['SELFIE'] = documents['selfieUploaded'] == true ||
                _uploaded['SELFIE'] == true;
            _uploaded['PROOF_OF_ADDRESS'] =
                documents['proofOfAddressUploaded'] == true ||
                    _uploaded['PROOF_OF_ADDRESS'] == true;
          });
        }
        _message('$title uploaded securely.');
      } else {
        _message(
          decoded is Map
              ? (decoded['message'] ?? 'Unable to upload $title.').toString()
              : 'Unable to upload $title.',
          error: true,
        );
      }
    } catch (_) {
      _message('Unable to upload $title. Please retry.', error: true);
    } finally {
      if (mounted) setState(() => _uploading[documentType] = false);
    }
  }

  Future<void> _removeDocument(String documentType) async {
    if (_isLocked) return;
    try {
      final String? token = await _token();
      if (token == null) return;
      final http.Response response = await http.delete(
        Uri.parse('$_baseUrl/kyc/document/$documentType'),
        headers: <String, String>{'Authorization': 'Bearer $token'},
      );
      if (response.statusCode >= 200 && response.statusCode < 300 && mounted) {
        setState(() {
          _uploaded[documentType] = false;
          _previews.remove(documentType);
        });
        _message('Document removed.');
      } else {
        _message('Unable to remove this document.', error: true);
      }
    } catch (_) {
      _message('Unable to remove this document.', error: true);
    }
  }

  Future<void> _submit() async {
    if (_isLocked || _submitting) return;
    if (!(_formKey.currentState?.validate() ?? false)) return;
    if (_dateOfBirth == null || _gender.isEmpty) {
      _message('Complete your date of birth and gender.', error: true);
      return;
    }
    if (!RegExp(r'^\d{11}$').hasMatch(_nin.text.trim()) ||
        !RegExp(r'^\d{11}$').hasMatch(_bvn.text.trim())) {
      _message(
        'Enter valid 11-digit NIN and BVN values before submitting.',
        error: true,
      );
      return;
    }
    if (_needsDocument &&
        (_uploaded['ID_DOCUMENT_FRONT'] != true ||
            _uploaded['SELFIE'] != true)) {
      _message('Upload your government ID and selfie before submitting.',
          error: true);
      return;
    }
    if (_needsDocument &&
        _documentBackRequired &&
        _uploaded['ID_DOCUMENT_BACK'] != true) {
      _message('Upload the back of your government ID before submitting.',
          error: true);
      return;
    }
    if (_needsProofOfAddress && _uploaded['PROOF_OF_ADDRESS'] != true) {
      _message('Upload proof of address before submitting.', error: true);
      return;
    }
    if (!_consentAccepted) {
      _message('Accept the KYC consent before submitting.', error: true);
      return;
    }
    setState(() => _submitting = true);
    try {
      final String? token = await _token();
      if (token == null) {
        _message('Please log in again.', error: true);
        return;
      }
      final http.Response response = await http.post(
        Uri.parse('$_baseUrl/kyc/submit'),
        headers: <String, String>{
          'Authorization': 'Bearer $token',
          'Content-Type': 'application/json',
        },
        body: jsonEncode(<String, dynamic>{
          'firstName': _firstName.text.trim(),
          'middleName': _middleName.text.trim(),
          'lastName': _lastName.text.trim(),
          'dateOfBirth': _dateOfBirth!.toIso8601String(),
          'gender': _gender,
          'phone': _phone.text.trim(),
          'email': _email.text.trim(),
          'address': _address.text.trim(),
          'state': _state.text.trim(),
          'lga': _lga.text.trim(),
          'documentType': _governmentIdType,
          'requestedLevel': _requestedLevel,
          'nin': _nin.text.trim(),
          'bvn': _bvn.text.trim(),
          'consentAccepted': true,
        }),
      );
      final dynamic decoded = jsonDecode(response.body);
      if (response.statusCode >= 200 &&
          response.statusCode < 300 &&
          decoded is Map &&
          decoded['success'] == true) {
        if (decoded['kyc'] is Map && mounted) {
          setState(() =>
              _applyKyc(Map<String, dynamic>.from(decoded['kyc'] as Map)));
        }
        _message((decoded['message'] ?? 'KYC submitted.').toString());
      } else {
        _message(
          decoded is Map
              ? (decoded['message'] ?? 'Unable to submit KYC.').toString()
              : 'Unable to submit KYC.',
          error: true,
        );
      }
    } catch (_) {
      _message('Unable to submit KYC. Please try again.', error: true);
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  String _statusLabel() {
    if (_status == 'NOT_STARTED') {
      final bool hasDraft = <String>[
        _firstName.text,
        _lastName.text,
        _phone.text,
        _email.text,
      ].any((String value) => value.isNotEmpty);
      return hasDraft ? 'Incomplete' : 'Draft';
    }
    if (_status == 'VERIFIED') return 'Approved';
    return _status
        .split('_')
        .map((String word) => word.isEmpty
            ? word
            : '${word[0]}${word.substring(1).toLowerCase()}')
        .join(' ');
  }

  Color _statusColor() {
    if (_status == 'VERIFIED') return Colors.green;
    if (_status == 'REJECTED') return Colors.red;
    if (_status == 'NEEDS_MORE_INFORMATION') return Colors.deepOrange;
    if (_status == 'PENDING' || _status == 'UNDER_REVIEW') return Colors.blue;
    return Colors.grey.shade700;
  }

  Widget _stepCard(
      int number, String title, String subtitle, List<Widget> children) {
    return Card(
      margin: const EdgeInsets.only(bottom: 16),
      elevation: 0,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(18),
        side: BorderSide(color: Colors.grey.shade200),
      ),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Row(
              children: <Widget>[
                CircleAvatar(
                  radius: 15,
                  backgroundColor: const Color(0xFF08783E),
                  child: Text('$number',
                      style: const TextStyle(
                          color: Colors.white, fontWeight: FontWeight.bold)),
                ),
                const SizedBox(width: 10),
                Expanded(
                    child: Text(title,
                        style: const TextStyle(
                            fontSize: 17, fontWeight: FontWeight.w800))),
              ],
            ),
            const SizedBox(height: 7),
            Text(subtitle,
                style: const TextStyle(color: Colors.black54, height: 1.35)),
            const SizedBox(height: 16),
            ...children,
          ],
        ),
      ),
    );
  }

  Widget _field(
    TextEditingController controller,
    String label, {
    TextInputType keyboardType = TextInputType.text,
    int maxLines = 1,
    bool required = true,
  }) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: TextFormField(
        controller: controller,
        enabled: !_isLocked,
        keyboardType: keyboardType,
        maxLines: maxLines,
        decoration: InputDecoration(
            labelText: label, border: const OutlineInputBorder()),
        validator: required
            ? (String? value) => value == null || value.trim().isEmpty
                ? '$label is required.'
                : null
            : null,
      ),
    );
  }

  Widget _identityTile(String type, TextEditingController controller,
      bool verified, String last4) {
    final bool submitted = verified || last4.isNotEmpty;
    final Color color = verified
        ? Colors.green
        : submitted
            ? Colors.blue
            : Colors.grey.shade700;
    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: color.withValues(alpha: .05),
        border: Border.all(color: color.withValues(alpha: .3)),
        borderRadius: BorderRadius.circular(14),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Text('$type reference',
              style: const TextStyle(fontWeight: FontWeight.w800)),
          const SizedBox(height: 8),
          if (!submitted)
            TextField(
              controller: controller,
              enabled: !_isLocked,
              keyboardType: TextInputType.number,
              maxLength: 11,
              obscureText: true,
              inputFormatters: <TextInputFormatter>[
                FilteringTextInputFormatter.digitsOnly,
              ],
              decoration: InputDecoration(
                labelText: 'Enter your $type',
                counterText: '',
                border: const OutlineInputBorder(),
              ),
            ),
          if (submitted)
            Text(
                '${verified ? 'Verified' : 'Submitted'} •••• $last4',
                style: TextStyle(color: color, fontWeight: FontWeight.w600)),
          const SizedBox(height: 6),
          Text(
            verified
                ? '$type is verified.'
                : 'ServicePay will review this identity reference manually after submission.',
            style: TextStyle(color: color, height: 1.3),
          ),
        ],
      ),
    );
  }

  Widget _documentTile(String documentType, String title, String subtitle) {
    final _KycLocalImage? preview = _previews[documentType];
    final bool uploaded = _uploaded[documentType] == true;
    final bool loading = _uploading[documentType] == true;
    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        border: Border.all(
            color: uploaded ? Colors.green.shade300 : Colors.grey.shade300),
        borderRadius: BorderRadius.circular(14),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Row(
            children: <Widget>[
              const Icon(Icons.image_outlined, color: Color(0xFF08783E)),
              const SizedBox(width: 8),
              Expanded(
                  child: Text(title,
                      style: const TextStyle(fontWeight: FontWeight.w800))),
              if (uploaded) const Icon(Icons.check_circle, color: Colors.green),
            ],
          ),
          const SizedBox(height: 5),
          Text(
              uploaded
                  ? 'Uploaded securely. You can replace or remove it before submission.'
                  : subtitle,
              style: const TextStyle(color: Colors.black54, height: 1.3)),
          if (preview != null) ...<Widget>[
            const SizedBox(height: 10),
            ClipRRect(
              borderRadius: BorderRadius.circular(10),
              child: Image.memory(preview.bytes,
                  height: 150, width: double.infinity, fit: BoxFit.cover),
            ),
          ],
          const SizedBox(height: 10),
          Row(
            children: <Widget>[
              Expanded(
                child: OutlinedButton.icon(
                  onPressed: _isLocked || loading
                      ? null
                      : () => _pickAndUpload(documentType, title),
                  icon: loading
                      ? const SizedBox(
                          width: 16,
                          height: 16,
                          child: CircularProgressIndicator(strokeWidth: 2))
                      : Icon(uploaded
                          ? Icons.refresh
                          : Icons.upload_file_outlined),
                  label: Text(loading
                      ? 'Uploading...'
                      : uploaded
                          ? 'Replace'
                          : 'Select / capture'),
                ),
              ),
              if (uploaded || preview != null) ...<Widget>[
                const SizedBox(width: 8),
                IconButton(
                  tooltip: 'Remove $title',
                  onPressed: _isLocked || loading
                      ? null
                      : () => _removeDocument(documentType),
                  icon: const Icon(Icons.delete_outline, color: Colors.red),
                ),
              ],
            ],
          ),
        ],
      ),
    );
  }

  Widget _tierSelector() {
    return DropdownButtonFormField<String>(
      value: _requestedLevel,
      isExpanded: true,
      decoration: const InputDecoration(
          labelText: 'Requested KYC tier', border: OutlineInputBorder()),
      items: const <DropdownMenuItem<String>>[
        DropdownMenuItem(
            value: 'TIER_1', child: Text('Tier 1 — basic verification')),
        DropdownMenuItem(
            value: 'TIER_2', child: Text('Tier 2 — government ID and selfie')),
        DropdownMenuItem(
            value: 'TIER_3',
            child: Text('Tier 3 — identity, selfie and proof of address')),
      ],
      onChanged: _isLocked
          ? null
          : (String? value) =>
              setState(() => _requestedLevel = value ?? 'TIER_1'),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('KYC Verification'),
        backgroundColor: const Color(0xFF08783E),
        foregroundColor: Colors.white,
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : RefreshIndicator(
              onRefresh: _loadKyc,
              child: ListView(
                padding: const EdgeInsets.all(16),
                children: <Widget>[
                  Container(
                    padding: const EdgeInsets.all(16),
                    decoration: BoxDecoration(
                      color: _statusColor().withValues(alpha: .08),
                      borderRadius: BorderRadius.circular(16),
                      border: Border.all(
                          color: _statusColor().withValues(alpha: .25)),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: <Widget>[
                        Text('KYC status: ${_statusLabel()}',
                            style: TextStyle(
                                fontSize: 19,
                                fontWeight: FontWeight.bold,
                                color: _statusColor())),
                        const SizedBox(height: 5),
                        Text(
                            'Current tier: ${_level.replaceAll('_', ' ')} • Requested: ${_requestedLevel.replaceAll('_', ' ')}'),
                        if (_reviewReason.isNotEmpty) ...<Widget>[
                          const SizedBox(height: 8),
                          Text(_reviewReason,
                              style: TextStyle(
                                  color: _statusColor(),
                                  fontWeight: FontWeight.w600)),
                        ],
                      ],
                    ),
                  ),
                  const SizedBox(height: 16),
                  LinearProgressIndicator(
                    value: _status == 'VERIFIED'
                        ? 1
                        : _isLocked
                            ? .9
                            : .45,
                    color: const Color(0xFF08783E),
                    backgroundColor: Colors.green.shade50,
                  ),
                  const SizedBox(height: 16),
                  if (_isLocked)
                    const Padding(
                      padding: EdgeInsets.only(bottom: 12),
                      child: Text(
                          'Your application is submitted. Refresh to track review progress.',
                          style: TextStyle(color: Colors.black54)),
                    ),
                  Form(
                    key: _formKey,
                    child: Column(
                      children: <Widget>[
                        _stepCard(
                            1,
                            'Personal Information',
                            'Enter the details shown on your official identity documents.',
                            <Widget>[
                              _field(_firstName, 'First legal name'),
                              _field(_middleName, 'Middle name',
                                  required: false),
                              _field(_lastName, 'Last legal name'),
                              _field(_phone, 'Phone number',
                                  keyboardType: TextInputType.phone),
                              _field(_email, 'Email address',
                                  keyboardType: TextInputType.emailAddress),
                              _field(_address, 'Residential address',
                                  maxLines: 2),
                              _field(_state, 'State'),
                              _field(_lga, 'LGA'),
                              ListTile(
                                contentPadding: EdgeInsets.zero,
                                title: const Text('Date of birth'),
                                subtitle: Text(_dateOfBirth == null
                                    ? 'Required'
                                    : '${_dateOfBirth!.day.toString().padLeft(2, '0')}/${_dateOfBirth!.month.toString().padLeft(2, '0')}/${_dateOfBirth!.year}'),
                                trailing: OutlinedButton(
                                  onPressed: _isLocked ? null : _pickDate,
                                  child: const Text('Select'),
                                ),
                              ),
                              DropdownButtonFormField<String>(
                                value: _gender.isEmpty ? null : _gender,
                                decoration: const InputDecoration(
                                    labelText: 'Gender',
                                    border: OutlineInputBorder()),
                                items: const <DropdownMenuItem<String>>[
                                  DropdownMenuItem(
                                      value: 'MALE', child: Text('Male')),
                                  DropdownMenuItem(
                                      value: 'FEMALE', child: Text('Female')),
                                  DropdownMenuItem(
                                      value: 'OTHER', child: Text('Other')),
                                ],
                                onChanged: _isLocked
                                    ? null
                                    : (String? value) =>
                                        setState(() => _gender = value ?? ''),
                              ),
                              const SizedBox(height: 12),
                              _tierSelector(),
                            ]),
                        _stepCard(
                            2,
                            'Identity Details',
                            'Enter your 11-digit NIN and BVN. ServicePay will review both details manually after you submit.',
                            <Widget>[
                              _identityTile(
                                  'NIN', _nin, _ninVerified, _ninLast4),
                              _identityTile(
                                  'BVN', _bvn, _bvnVerified, _bvnLast4),
                              if (_identityMatchStatus == 'REVIEW_REQUIRED')
                                const Text(
                                    'Your identity details may need manual review.',
                                    style: TextStyle(color: Colors.orange)),
                            ]),
                        _stepCard(
                            3,
                            'Identity Document',
                            'Upload a clear JPEG or PNG image. Files are stored privately and can be replaced before submission.',
                            <Widget>[
                              DropdownButtonFormField<String>(
                                value: _governmentIdType.isEmpty
                                    ? null
                                    : _governmentIdType,
                                isExpanded: true,
                                decoration: const InputDecoration(
                                    labelText: 'Government ID type',
                                    border: OutlineInputBorder()),
                                items: const <DropdownMenuItem<String>>[
                                  DropdownMenuItem(
                                      value: 'NIN_SLIP',
                                      child: Text('National ID / NIN slip')),
                                  DropdownMenuItem(
                                      value: 'NATIONAL_ID',
                                      child: Text('National ID card')),
                                  DropdownMenuItem(
                                      value: 'DRIVERS_LICENSE',
                                      child: Text("Driver's licence")),
                                  DropdownMenuItem(
                                      value: 'INTERNATIONAL_PASSPORT',
                                      child: Text('International passport')),
                                  DropdownMenuItem(
                                      value: 'VOTERS_CARD',
                                      child: Text("Voter's card")),
                                ],
                                onChanged: _isLocked
                                    ? null
                                    : (String? value) => setState(
                                        () => _governmentIdType = value ?? ''),
                              ),
                              const SizedBox(height: 12),
                              _documentTile(
                                  'ID_DOCUMENT_FRONT',
                                  'Government ID — front',
                                  'Select or capture the front of your government ID.'),
                              if (_documentBackRequired)
                                _documentTile(
                                    'ID_DOCUMENT_BACK',
                                    'Government ID — back',
                                    'Select or capture the back of your government ID.'),
                              if (_needsProofOfAddress)
                                _documentTile(
                                    'PROOF_OF_ADDRESS',
                                    'Proof of address',
                                    'Upload a recent address document.'),
                            ]),
                        _stepCard(
                            4,
                            'Selfie / Liveness-ready Capture',
                            'Capture or upload a clear selfie. It is stored privately and marked ready for future liveness checks.',
                            <Widget>[
                              _documentTile('SELFIE', 'Selfie',
                                  'Use camera or choose a clear JPEG/PNG selfie.'),
                            ]),
                        _stepCard(
                            5,
                            'Review & Consent',
                            'Review the information and document status before submitting one KYC application.',
                            <Widget>[
                              Text('Applicant: ${[
                                _firstName.text,
                                _middleName.text,
                                _lastName.text
                              ].where((String value) => value.isNotEmpty).join(' ')}'),
                              Text(
                                  'Identity: NIN and BVN will be submitted for ServicePay manual review.'),
                              Text(
                                  'Documents: ID ${_uploaded['ID_DOCUMENT_FRONT'] == true ? 'uploaded' : 'missing'} • Selfie ${_uploaded['SELFIE'] == true ? 'uploaded' : 'missing'}'),
                              CheckboxListTile(
                                contentPadding: EdgeInsets.zero,
                                value: _consentAccepted,
                                onChanged: _isLocked
                                    ? null
                                    : (bool? value) => setState(() =>
                                        _consentAccepted = value ?? false),
                                title: const Text(
                                    'I confirm my information is accurate and consent to KYC verification.'),
                                controlAffinity:
                                    ListTileControlAffinity.leading,
                              ),
                            ]),
                        _stepCard(
                            6,
                            'Submission',
                            'Submit your identity details and documents for Head Office manual review.',
                            <Widget>[
                              SizedBox(
                                width: double.infinity,
                                child: FilledButton.icon(
                                  onPressed:
                                      _isLocked || _submitting ? null : _submit,
                                  icon: _submitting
                                      ? const SizedBox(
                                          width: 18,
                                          height: 18,
                                          child: CircularProgressIndicator(
                                              strokeWidth: 2,
                                              color: Colors.white))
                                      : const Icon(Icons.send_outlined),
                                  label: Text(_submitting
                                      ? 'Submitting...'
                                      : 'Submit KYC application'),
                                  style: FilledButton.styleFrom(
                                    backgroundColor: const Color(0xFF08783E),
                                    padding: const EdgeInsets.symmetric(
                                        vertical: 14),
                                  ),
                                ),
                              ),
                            ]),
                      ],
                    ),
                  ),
                ],
              ),
            ),
    );
  }
}

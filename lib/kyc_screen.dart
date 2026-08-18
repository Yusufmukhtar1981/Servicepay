import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';
import 'package:image_picker/image_picker.dart';

class KycScreen extends StatefulWidget {
  const KycScreen({super.key});

  @override
  State<KycScreen> createState() => _KycScreenState();
}

class _KycScreenState extends State<KycScreen> {
  static const String baseUrl = 'https://api.servicepay.ng/api';

  final _formKey = GlobalKey<FormState>();

  final firstNameController = TextEditingController();
  final middleNameController = TextEditingController();
  final lastNameController = TextEditingController();
  final addressController = TextEditingController();
  final stateController = TextEditingController();
  final lgaController = TextEditingController();

  DateTime? dateOfBirth;
  String gender = '';
  String status = 'NOT_STARTED';
  String level = 'TIER_1';
  String requestedLevel = 'TIER_1';

  String selfieUrl = '';
  String idDocumentUrl = '';
  String proofOfAddressUrl = '';

  bool uploadingSelfie = false;
  bool uploadingIdDocument = false;
  bool uploadingProofOfAddress = false;

  final ImagePicker _kycImagePicker = ImagePicker();
  String rejectionReason = '';

  bool isLoading = true;
  bool isSubmitting = false;

  @override
  void initState() {
    super.initState();
    _loadKyc();
  }

  @override
  void dispose() {
    firstNameController.dispose();
    middleNameController.dispose();
    lastNameController.dispose();
    addressController.dispose();
    stateController.dispose();
    lgaController.dispose();
    super.dispose();
  }

  Future<String?> _getToken() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getString('auth_token');
  }

  Future<void> _loadKyc() async {
    try {
      final token = await _getToken();

      if (token == null || token.isEmpty) {
        if (!mounted) return;
        setState(() => isLoading = false);
        _showMessage('Please log in again.');
        return;
      }

      final response = await http.get(
        Uri.parse('$baseUrl/kyc/status'),
        headers: {
          'Authorization': 'Bearer $token',
          'Content-Type': 'application/json',
        },
      );

      final body = jsonDecode(response.body);

      if (response.statusCode >= 200 &&
          response.statusCode < 300 &&
          body['success'] == true) {
        final kyc = body['kyc'] ?? {};

        firstNameController.text = (kyc['firstName'] ?? '').toString();
        middleNameController.text = (kyc['middleName'] ?? '').toString();
        lastNameController.text = (kyc['lastName'] ?? '').toString();
        addressController.text = (kyc['address'] ?? '').toString();
        stateController.text = (kyc['state'] ?? '').toString();
        lgaController.text = (kyc['lga'] ?? '').toString();

        final dob = kyc['dateOfBirth'];
        if (dob != null && dob.toString().isNotEmpty) {
          dateOfBirth = DateTime.tryParse(dob.toString()) ??
              DateTime.tryParse(dob.toString().split('T').first);
        }

        final loadedGender = (kyc['gender'] ?? '').toString().toUpperCase();

        if (['MALE', 'FEMALE', 'OTHER'].contains(loadedGender)) {
          gender = loadedGender;
        }

        status = (kyc['status'] ?? 'NOT_STARTED').toString();
        level = (kyc['level'] ?? 'TIER_1').toString();
        rejectionReason = (kyc['rejectionReason'] ?? '').toString();
      } else {
        _showMessage(
          (body['message'] ?? 'Unable to load KYC.').toString(),
        );
      }
    } catch (e) {
      _showMessage('Unable to load KYC. Please try again.');
    } finally {
      if (mounted) {
        setState(() => isLoading = false);
      }
    }
  }

  Future<void> _pickDate() async {
    final now = DateTime.now();

    final picked = await showDatePicker(
      context: context,
      initialDate: dateOfBirth ?? DateTime(now.year - 25, now.month, now.day),
      firstDate: DateTime(1900),
      lastDate: DateTime(now.year - 18, now.month, now.day),
    );

    if (picked != null) {
      setState(() => dateOfBirth = picked);
    }
  }

  Future<void> _submitKyc() async {
    if (!_formKey.currentState!.validate()) return;

    if (dateOfBirth == null) {
      _showMessage('Please select your date of birth.');
      return;
    }

    if (gender.isEmpty) {
      _showMessage('Please select your gender.');
      return;
    }

    if ((requestedLevel == 'TIER_2' || requestedLevel == 'TIER_3') &&
        idDocumentUrl.isEmpty) {
      _showMessage(
        'Please upload your Government ID.',
      );
      return;
    }

    if ((requestedLevel == 'TIER_2' || requestedLevel == 'TIER_3') &&
        selfieUrl.isEmpty) {
      _showMessage(
        'Please take and upload your selfie.',
      );
      return;
    }

    if (requestedLevel == 'TIER_3' && proofOfAddressUrl.isEmpty) {
      _showMessage(
        'Please upload your proof of address.',
      );
      return;
    }

    setState(() => isSubmitting = true);

    try {
      final token = await _getToken();

      if (token == null || token.isEmpty) {
        _showMessage('Please log in again.');
        return;
      }

      final payload = {
        'firstName': firstNameController.text.trim(),
        'middleName': middleNameController.text.trim(),
        'lastName': lastNameController.text.trim(),
        'dateOfBirth': dateOfBirth!.toIso8601String(),
        'gender': gender,
        'address': addressController.text.trim(),
        'state': stateController.text.trim(),
        'lga': lgaController.text.trim(),
        'requestedLevel': requestedLevel,
      };

      final response = await http.post(
        Uri.parse('$baseUrl/kyc/submit'),
        headers: {
          'Authorization': 'Bearer $token',
          'Content-Type': 'application/json',
        },
        body: jsonEncode(payload),
      );

      final body = jsonDecode(response.body);

      if (response.statusCode >= 200 &&
          response.statusCode < 300 &&
          body['success'] == true) {
        final kyc = body['kyc'] ?? {};

        setState(() {
          status = (kyc['status'] ?? 'PENDING').toString();
          level = (kyc['level'] ?? 'TIER_1').toString();
          rejectionReason = (kyc['rejectionReason'] ?? '').toString();
        });

        _showMessage(
          (body['message'] ?? 'KYC submitted successfully.').toString(),
        );
      } else {
        _showMessage(
          (body['message'] ?? 'Unable to submit KYC.').toString(),
        );
      }
    } catch (e) {
      _showMessage(
        'Unable to submit KYC. Please try again.',
      );
    } finally {
      if (mounted) {
        setState(() => isSubmitting = false);
      }
    }
  }

  void _showMessage(String message) {
    if (!mounted) return;

    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(message)),
    );
  }

  Future<void> _uploadKycDocument(
    String documentType,
  ) async {
    if (isSubmitting) {
      return;
    }

    final bool isSelfie = documentType == 'SELFIE';

    final ImageSource source =
        isSelfie ? ImageSource.camera : ImageSource.gallery;

    try {
      final picked = await _kycImagePicker.pickImage(
        source: source,
        imageQuality: 82,
        maxWidth: 1600,
        maxHeight: 1600,
      );

      if (picked == null) {
        return;
      }

      if (mounted) {
        setState(() {
          if (documentType == 'SELFIE') {
            uploadingSelfie = true;
          } else if (documentType == 'ID_DOCUMENT') {
            uploadingIdDocument = true;
          } else if (documentType == 'PROOF_OF_ADDRESS') {
            uploadingProofOfAddress = true;
          }
        });
      }

      final prefs = await SharedPreferences.getInstance();

      final token = prefs.getString('auth_token') ?? '';

      if (token.isEmpty) {
        _showMessage(
          'Your login session has expired. Please log in again.',
        );
        return;
      }

      final uri = Uri.parse(
        '$baseUrl/kyc/document/upload',
      );

      final request = http.MultipartRequest(
        'POST',
        uri,
      );

      request.headers['Authorization'] = 'Bearer $token';

      request.fields['documentType'] = documentType;

      final bytes = await picked.readAsBytes();

      request.files.add(
        http.MultipartFile.fromBytes(
          'document',
          bytes,
          filename: picked.name,
        ),
      );

      final streamed = await request.send();

      final response = await http.Response.fromStream(
        streamed,
      );

      dynamic body;

      try {
        body = jsonDecode(response.body);
      } catch (_) {
        body = <String, dynamic>{};
      }

      if (response.statusCode >= 200 &&
          response.statusCode < 300 &&
          body is Map &&
          body['success'] == true) {
        final dynamic document = body['document'];

        String uploadedUrl = '';

        if (document is Map) {
          uploadedUrl = (document['url'] ??
                  document['secureUrl'] ??
                  document['documentUrl'] ??
                  '')
              .toString();
        }

        final dynamic kyc = body['kyc'];

        if (kyc is Map) {
          if (documentType == 'SELFIE') {
            uploadedUrl = (kyc['selfieUrl'] ?? uploadedUrl).toString();
          } else if (documentType == 'ID_DOCUMENT') {
            uploadedUrl = (kyc['idDocumentUrl'] ?? uploadedUrl).toString();
          } else if (documentType == 'PROOF_OF_ADDRESS') {
            uploadedUrl = (kyc['proofOfAddressUrl'] ?? uploadedUrl).toString();
          }
        }

        if (mounted) {
          setState(() {
            if (documentType == 'SELFIE') {
              selfieUrl = uploadedUrl.isEmpty ? 'UPLOADED' : uploadedUrl;
            } else if (documentType == 'ID_DOCUMENT') {
              idDocumentUrl = uploadedUrl.isEmpty ? 'UPLOADED' : uploadedUrl;
            } else if (documentType == 'PROOF_OF_ADDRESS') {
              proofOfAddressUrl =
                  uploadedUrl.isEmpty ? 'UPLOADED' : uploadedUrl;
            }
          });
        }

        _showMessage(
          documentType == 'SELFIE'
              ? 'Selfie uploaded successfully.'
              : documentType == 'ID_DOCUMENT'
                  ? 'Government ID uploaded successfully.'
                  : 'Proof of address uploaded successfully.',
        );

        return;
      }

      _showMessage(
        body is Map
            ? (body['message'] ?? 'Unable to upload document.').toString()
            : 'Unable to upload document.',
      );
    } catch (_) {
      _showMessage(
        'Unable to upload document. Please try again.',
      );
    } finally {
      if (mounted) {
        setState(() {
          if (documentType == 'SELFIE') {
            uploadingSelfie = false;
          } else if (documentType == 'ID_DOCUMENT') {
            uploadingIdDocument = false;
          } else if (documentType == 'PROOF_OF_ADDRESS') {
            uploadingProofOfAddress = false;
          }
        });
      }
    }
  }

  bool get _tierRequiresIdentityDocuments {
    return requestedLevel == 'TIER_2' || requestedLevel == 'TIER_3';
  }

  bool get _tierRequiresProofOfAddress {
    return requestedLevel == 'TIER_3';
  }

  Widget _buildKycDocumentsSection() {
    if (requestedLevel == 'TIER_1') {
      return const SizedBox.shrink();
    }

    return Container(
      margin: const EdgeInsets.only(
        top: 18,
        bottom: 10,
      ),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: const Color(0xFFF7FAF8),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(
          color: const Color(0xFF08783E).withValues(alpha: 0.18),
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Row(
            children: [
              Icon(
                Icons.folder_copy_outlined,
                color: Color(0xFF08783E),
              ),
              SizedBox(width: 10),
              Expanded(
                child: Text(
                  'Required Verification Documents',
                  style: TextStyle(
                    fontSize: 17,
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 6),
          Text(
            requestedLevel == 'TIER_3'
                ? 'Tier 3 requires a Government ID, selfie and proof of address.'
                : 'Tier 2 requires a Government ID and selfie.',
            style: const TextStyle(
              fontSize: 13,
              color: Color(0xFF667085),
              height: 1.4,
            ),
          ),
          const SizedBox(height: 16),
          if (_tierRequiresIdentityDocuments)
            _kycDocumentTile(
              title: 'Government ID',
              subtitle:
                  'Upload NIN slip/card, National ID, Driver’s Licence or International Passport.',
              icon: Icons.badge_outlined,
              uploaded: idDocumentUrl.isNotEmpty,
              loading: uploadingIdDocument,
              buttonText: idDocumentUrl.isNotEmpty ? 'Replace ID' : 'Upload ID',
              onTap: () => _uploadKycDocument(
                'ID_DOCUMENT',
              ),
            ),
          if (_tierRequiresIdentityDocuments) const SizedBox(height: 12),
          if (_tierRequiresIdentityDocuments)
            _kycDocumentTile(
              title: 'Selfie',
              subtitle: 'Take a clear live selfie showing your full face.',
              icon: Icons.face_retouching_natural_outlined,
              uploaded: selfieUrl.isNotEmpty,
              loading: uploadingSelfie,
              buttonText:
                  selfieUrl.isNotEmpty ? 'Retake Selfie' : 'Take Selfie',
              onTap: () => _uploadKycDocument(
                'SELFIE',
              ),
            ),
          if (_tierRequiresProofOfAddress) const SizedBox(height: 12),
          if (_tierRequiresProofOfAddress)
            _kycDocumentTile(
              title: 'Proof of Address',
              subtitle:
                  'Upload a recent utility bill, bank statement or other acceptable proof of residence.',
              icon: Icons.home_work_outlined,
              uploaded: proofOfAddressUrl.isNotEmpty,
              loading: uploadingProofOfAddress,
              buttonText: proofOfAddressUrl.isNotEmpty
                  ? 'Replace Document'
                  : 'Upload Document',
              onTap: () => _uploadKycDocument(
                'PROOF_OF_ADDRESS',
              ),
            ),
        ],
      ),
    );
  }

  Widget _kycDocumentTile({
    required String title,
    required String subtitle,
    required IconData icon,
    required bool uploaded,
    required bool loading,
    required String buttonText,
    required VoidCallback onTap,
  }) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(
          color: uploaded ? const Color(0xFF22A06B) : const Color(0xFFE4E7EC),
        ),
      ),
      child: Column(
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                width: 44,
                height: 44,
                decoration: BoxDecoration(
                  color: const Color(0xFFEAF7F0),
                  borderRadius: BorderRadius.circular(
                    12,
                  ),
                ),
                child: Icon(
                  uploaded ? Icons.check_circle_rounded : icon,
                  color: const Color(0xFF08783E),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      title,
                      style: const TextStyle(
                        fontSize: 15,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      uploaded ? 'Uploaded successfully' : subtitle,
                      style: TextStyle(
                        fontSize: 12.5,
                        height: 1.35,
                        color: uploaded
                            ? const Color(
                                0xFF08783E,
                              )
                            : const Color(
                                0xFF667085,
                              ),
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          SizedBox(
            width: double.infinity,
            child: OutlinedButton.icon(
              onPressed: loading ? null : onTap,
              icon: loading
                  ? const SizedBox(
                      width: 18,
                      height: 18,
                      child: CircularProgressIndicator(
                        strokeWidth: 2,
                      ),
                    )
                  : Icon(
                      uploaded
                          ? Icons.refresh_rounded
                          : Icons.upload_file_rounded,
                    ),
              label: Text(
                loading ? 'Uploading...' : buttonText,
              ),
            ),
          ),
        ],
      ),
    );
  }

  Color _statusColor() {
    switch (status) {
      case 'VERIFIED':
        return Colors.green;
      case 'REJECTED':
        return Colors.red;
      case 'UNDER_REVIEW':
        return Colors.orange;
      case 'PENDING':
        return Colors.blue;
      default:
        return Colors.grey;
    }
  }

  IconData _statusIcon() {
    switch (status) {
      case 'VERIFIED':
        return Icons.verified_rounded;
      case 'REJECTED':
        return Icons.cancel_rounded;
      case 'UNDER_REVIEW':
        return Icons.manage_search_rounded;
      case 'PENDING':
        return Icons.hourglass_top_rounded;
      default:
        return Icons.person_search_rounded;
    }
  }

  String _statusLabel() {
    return status
        .replaceAll('_', ' ')
        .split(' ')
        .map(
          (e) => e.isEmpty
              ? e
              : '${e[0].toUpperCase()}${e.substring(1).toLowerCase()}',
        )
        .join(' ');
  }

  String _formatDate(DateTime date) {
    final day = date.day.toString().padLeft(2, '0');
    final month = date.month.toString().padLeft(2, '0');
    return '$day/$month/${date.year}';
  }

  Widget _buildTierSelector() {
    String limitText(String tier) {
      switch (tier) {
        case 'TIER_2':
          return '₦200,000 per transaction • ₦1,000,000 daily';
        case 'TIER_3':
          return '₦1,000,000 per transaction • ₦5,000,000 daily';
        default:
          return '₦50,000 per transaction • ₦200,000 daily';
      }
    }

    Widget tierTile({
      required String tier,
      required String title,
      required String description,
      required IconData icon,
    }) {
      final selected = requestedLevel == tier;

      return InkWell(
        borderRadius: BorderRadius.circular(14),
        onTap: isSubmitting
            ? null
            : () {
                setState(() {
                  requestedLevel = tier;
                });
              },
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 180),
          margin: const EdgeInsets.only(bottom: 10),
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(14),
            border: Border.all(
              color: selected ? const Color(0xFF08783E) : Colors.grey.shade300,
              width: selected ? 2 : 1,
            ),
            color: selected ? const Color(0xFFEAF7F0) : Colors.white,
          ),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                width: 42,
                height: 42,
                decoration: BoxDecoration(
                  color:
                      selected ? const Color(0xFF08783E) : Colors.grey.shade100,
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Icon(
                  icon,
                  color: selected ? Colors.white : const Color(0xFF08783E),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      title,
                      style: const TextStyle(
                        fontWeight: FontWeight.w800,
                        fontSize: 15,
                      ),
                    ),
                    const SizedBox(height: 3),
                    Text(
                      description,
                      style: const TextStyle(
                        fontSize: 12,
                        color: Colors.black54,
                      ),
                    ),
                    const SizedBox(height: 5),
                    Text(
                      limitText(tier),
                      style: const TextStyle(
                        fontSize: 12,
                        fontWeight: FontWeight.w700,
                        color: Color(0xFF08783E),
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 8),
              Icon(
                selected ? Icons.check_circle : Icons.radio_button_unchecked,
                color: selected ? const Color(0xFF08783E) : Colors.grey,
              ),
            ],
          ),
        ),
      );
    }

    return Card(
      elevation: 0,
      margin: const EdgeInsets.only(bottom: 18),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: BorderSide(
          color: Colors.grey.shade200,
        ),
      ),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'Choose KYC Tier',
              style: TextStyle(
                fontSize: 17,
                fontWeight: FontWeight.w800,
              ),
            ),
            const SizedBox(height: 5),
            const Text(
              'Select the verification level you want to apply for.',
              style: TextStyle(
                fontSize: 12,
                color: Colors.black54,
              ),
            ),
            const SizedBox(height: 14),
            tierTile(
              tier: 'TIER_1',
              title: 'Tier 1',
              description: 'Basic identity verification.',
              icon: Icons.verified_user_outlined,
            ),
            tierTile(
              tier: 'TIER_2',
              title: 'Tier 2',
              description: 'Enhanced identity verification.',
              icon: Icons.shield_outlined,
            ),
            tierTile(
              tier: 'TIER_3',
              title: 'Tier 3',
              description: 'Full identity and address verification.',
              icon: Icons.workspace_premium_outlined,
            ),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    const primary = Color(0xFF08783E);

    return Scaffold(
      appBar: AppBar(
        title: const Text('KYC Verification'),
        backgroundColor: primary,
        foregroundColor: Colors.white,
      ),
      body: isLoading
          ? const Center(
              child: CircularProgressIndicator(),
            )
          : RefreshIndicator(
              onRefresh: _loadKyc,
              child: ListView(
                padding: const EdgeInsets.all(16),
                children: [
                  Container(
                    padding: const EdgeInsets.all(18),
                    decoration: BoxDecoration(
                      color: _statusColor().withValues(alpha: 0.08),
                      borderRadius: BorderRadius.circular(18),
                      border: Border.all(
                        color: _statusColor().withValues(alpha: 0.25),
                      ),
                    ),
                    child: Row(
                      children: [
                        CircleAvatar(
                          radius: 27,
                          backgroundColor:
                              _statusColor().withValues(alpha: 0.15),
                          child: Icon(
                            _statusIcon(),
                            color: _statusColor(),
                            size: 30,
                          ),
                        ),
                        const SizedBox(width: 14),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              _buildTierSelector(),
                              _buildKycDocumentsSection(),
                              const Text(
                                'Verification Status',
                                style: TextStyle(
                                  fontSize: 13,
                                  color: Colors.black54,
                                ),
                              ),
                              const SizedBox(height: 4),
                              Text(
                                _statusLabel(),
                                style: TextStyle(
                                  fontSize: 19,
                                  fontWeight: FontWeight.bold,
                                  color: _statusColor(),
                                ),
                              ),
                              const SizedBox(height: 4),
                              Text(
                                'Current level: ${level.replaceAll('_', ' ')}',
                                style: const TextStyle(
                                  fontSize: 13,
                                ),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ),
                  if (status == 'REJECTED' && rejectionReason.isNotEmpty) ...[
                    const SizedBox(height: 14),
                    Container(
                      padding: const EdgeInsets.all(14),
                      decoration: BoxDecoration(
                        color: Colors.red.shade50,
                        borderRadius: BorderRadius.circular(14),
                      ),
                      child: Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Icon(
                            Icons.info_outline,
                            color: Colors.red,
                          ),
                          const SizedBox(width: 10),
                          Expanded(
                            child: Text(
                              'Reason: $rejectionReason',
                              style: const TextStyle(
                                color: Colors.red,
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                  const SizedBox(height: 22),
                  const Text(
                    'Personal Information',
                    style: TextStyle(
                      fontSize: 18,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                  const SizedBox(height: 14),
                  Form(
                    key: _formKey,
                    child: Column(
                      children: [
                        _textField(
                          controller: firstNameController,
                          label: 'First Name',
                          icon: Icons.person_outline,
                          required: true,
                        ),
                        _textField(
                          controller: middleNameController,
                          label: 'Middle Name',
                          icon: Icons.person_outline,
                        ),
                        _textField(
                          controller: lastNameController,
                          label: 'Last Name',
                          icon: Icons.person_outline,
                          required: true,
                        ),
                        InkWell(
                          onTap: _pickDate,
                          borderRadius: BorderRadius.circular(14),
                          child: InputDecorator(
                            decoration: const InputDecoration(
                              labelText: 'Date of Birth',
                              prefixIcon: Icon(Icons.cake_outlined),
                              border: OutlineInputBorder(),
                            ),
                            child: Text(
                              dateOfBirth == null
                                  ? 'Select date'
                                  : _formatDate(
                                      dateOfBirth!,
                                    ),
                            ),
                          ),
                        ),
                        const SizedBox(height: 14),
                        DropdownButtonFormField<String>(
                          initialValue: gender.isEmpty ? null : gender,
                          decoration: const InputDecoration(
                            labelText: 'Gender',
                            prefixIcon: Icon(Icons.people_outline),
                            border: OutlineInputBorder(),
                          ),
                          items: const [
                            DropdownMenuItem(
                              value: 'MALE',
                              child: Text('Male'),
                            ),
                            DropdownMenuItem(
                              value: 'FEMALE',
                              child: Text('Female'),
                            ),
                            DropdownMenuItem(
                              value: 'OTHER',
                              child: Text('Other'),
                            ),
                          ],
                          onChanged: (value) {
                            setState(() {
                              gender = value ?? '';
                            });
                          },
                        ),
                        const SizedBox(height: 14),
                        _textField(
                          controller: addressController,
                          label: 'Residential Address',
                          icon: Icons.home_outlined,
                          required: true,
                          maxLines: 2,
                        ),
                        _textField(
                          controller: stateController,
                          label: 'State',
                          icon: Icons.location_on_outlined,
                          required: true,
                        ),
                        _textField(
                          controller: lgaController,
                          label: 'LGA',
                          icon: Icons.map_outlined,
                        ),
                        const SizedBox(height: 8),
                        Container(
                          width: double.infinity,
                          padding: const EdgeInsets.all(14),
                          decoration: BoxDecoration(
                            color: Colors.green.shade50,
                            borderRadius: BorderRadius.circular(14),
                          ),
                          child: const Row(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Icon(
                                Icons.security_rounded,
                                color: primary,
                              ),
                              SizedBox(width: 10),
                              Expanded(
                                child: Text(
                                  'Your NIN/BVN will be linked securely through ServicePay verification. Raw identity numbers are not stored in this KYC form.',
                                  style: TextStyle(
                                    fontSize: 13,
                                  ),
                                ),
                              ),
                            ],
                          ),
                        ),
                        const SizedBox(height: 22),
                        SizedBox(
                          width: double.infinity,
                          height: 52,
                          child: ElevatedButton.icon(
                            onPressed: isSubmitting ? null : _submitKyc,
                            icon: isSubmitting
                                ? const SizedBox(
                                    width: 20,
                                    height: 20,
                                    child: CircularProgressIndicator(
                                      strokeWidth: 2,
                                    ),
                                  )
                                : const Icon(
                                    Icons.verified_user_outlined,
                                  ),
                            label: Text(
                              isSubmitting
                                  ? 'Submitting...'
                                  : status == 'VERIFIED'
                                      ? 'Update KYC Information'
                                      : 'Submit KYC',
                            ),
                            style: ElevatedButton.styleFrom(
                              backgroundColor: primary,
                              foregroundColor: Colors.white,
                              shape: RoundedRectangleBorder(
                                borderRadius: BorderRadius.circular(
                                  14,
                                ),
                              ),
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 20),
                ],
              ),
            ),
    );
  }

  Widget _textField({
    required TextEditingController controller,
    required String label,
    required IconData icon,
    bool required = false,
    int maxLines = 1,
  }) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 14),
      child: TextFormField(
        controller: controller,
        maxLines: maxLines,
        validator: (value) {
          if (required && (value == null || value.trim().isEmpty)) {
            return '$label is required';
          }
          return null;
        },
        decoration: InputDecoration(
          labelText: label,
          prefixIcon: Icon(icon),
          border: const OutlineInputBorder(),
        ),
      ),
    );
  }
}

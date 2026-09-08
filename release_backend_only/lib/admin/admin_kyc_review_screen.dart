import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import 'admin_kyc_api_service.dart';

class AdminKycReviewScreen extends StatefulWidget {
  const AdminKycReviewScreen({super.key});

  @override
  State<AdminKycReviewScreen> createState() => _AdminKycReviewScreenState();
}

class _AdminKycReviewScreenState extends State<AdminKycReviewScreen> {
  final TextEditingController _search = TextEditingController();
  List<AdminKycApplication> _applications = <AdminKycApplication>[];
  String _status = '';
  String? _error;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final List<AdminKycApplication> result =
          await AdminKycApiService.applications(
        search: _search.text,
        status: _status,
      );
      if (mounted) setState(() => _applications = result);
    } catch (error) {
      if (mounted) {
        setState(
          () => _error = error.toString().replaceFirst('Exception: ', ''),
        );
      }
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        backgroundColor: const Color(0xFFF5F7FA),
        appBar: AppBar(
          title: const Text('KYC Reviews'),
          backgroundColor: const Color(0xFF08783E),
          foregroundColor: Colors.white,
        ),
        body: Column(
          children: <Widget>[
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
              child: TextField(
                controller: _search,
                onSubmitted: (_) => _load(),
                decoration: InputDecoration(
                  hintText: 'Search name, phone, email, NIN or BVN',
                  prefixIcon: const Icon(Icons.search),
                  suffixIcon: IconButton(
                    tooltip: 'Search',
                    onPressed: _load,
                    icon: const Icon(Icons.search),
                  ),
                  filled: true,
                  fillColor: Colors.white,
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(14),
                    borderSide: BorderSide.none,
                  ),
                ),
              ),
            ),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: DropdownButtonFormField<String>(
                value: _status,
                decoration: const InputDecoration(
                  labelText: 'Status',
                  filled: true,
                  fillColor: Colors.white,
                  border: OutlineInputBorder(),
                ),
                items: const <DropdownMenuItem<String>>[
                  DropdownMenuItem(value: '', child: Text('All statuses')),
                  DropdownMenuItem(value: 'PENDING', child: Text('Pending')),
                  DropdownMenuItem(
                    value: 'UNDER_REVIEW',
                    child: Text('Under review'),
                  ),
                  DropdownMenuItem(value: 'VERIFIED', child: Text('Verified')),
                  DropdownMenuItem(value: 'REJECTED', child: Text('Rejected')),
                  DropdownMenuItem(
                    value: 'NEEDS_MORE_INFORMATION',
                    child: Text('More information required'),
                  ),
                ],
                onChanged: (String? value) {
                  setState(() => _status = value ?? '');
                  _load();
                },
              ),
            ),
            if (_loading) const LinearProgressIndicator(),
            if (_error != null)
              Padding(
                padding: const EdgeInsets.all(16),
                child: Text(_error!, style: const TextStyle(color: Colors.red)),
              ),
            Expanded(
              child: !_loading && _applications.isEmpty
                  ? const Center(child: Text('No KYC applications found.'))
                  : RefreshIndicator(
                      onRefresh: _load,
                      child: ListView.builder(
                        padding: const EdgeInsets.symmetric(vertical: 8),
                        itemCount: _applications.length,
                        itemBuilder: (_, int index) {
                          final AdminKycApplication application =
                              _applications[index];
                          return Card(
                            margin: const EdgeInsets.symmetric(
                              horizontal: 16,
                              vertical: 5,
                            ),
                            child: ListTile(
                              leading: CircleAvatar(
                                backgroundColor: const Color(0xFFEAF7F0),
                                child: Text(
                                  application.displayName.isEmpty
                                      ? '?'
                                      : application.displayName[0]
                                          .toUpperCase(),
                                ),
                              ),
                              title: Text(application.displayName.isEmpty
                                  ? 'Unnamed applicant'
                                  : application.displayName),
                              subtitle: Text(
                                '${application.requestedLevel.isEmpty ? application.level : application.requestedLevel} • ${application.email.isNotEmpty ? application.email : application.phone}',
                              ),
                              trailing: _StatusChip(status: application.status),
                              onTap: () async {
                                await Navigator.push<void>(
                                  context,
                                  MaterialPageRoute<void>(
                                    builder: (_) => _AdminKycDetailScreen(
                                      kycId: application.id,
                                    ),
                                  ),
                                );
                                _load();
                              },
                            ),
                          );
                        },
                      ),
                    ),
            ),
          ],
        ),
      );
}

class _AdminKycDetailScreen extends StatefulWidget {
  const _AdminKycDetailScreen({required this.kycId});
  final String kycId;

  @override
  State<_AdminKycDetailScreen> createState() => _AdminKycDetailScreenState();
}

class _AdminKycDetailScreenState extends State<_AdminKycDetailScreen> {
  AdminKycApplication? _application;
  String? _error;
  bool _loading = true;
  bool _updating = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final AdminKycApplication result =
          await AdminKycApiService.application(widget.kycId);
      if (mounted) setState(() => _application = result);
    } catch (error) {
      if (mounted) {
        setState(
          () => _error = error.toString().replaceFirst('Exception: ', ''),
        );
      }
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _review(String status) async {
    String reason = '';
    if (status == 'REJECTED' || status == 'REQUEST_MORE_INFORMATION') {
      final TextEditingController controller = TextEditingController();
      final String? submitted = await showDialog<String>(
        context: context,
        builder: (BuildContext context) => AlertDialog(
          title: Text(
            status == 'REJECTED'
                ? 'Reject KYC application'
                : 'Request more information',
          ),
          content: TextField(
            controller: controller,
            autofocus: true,
            maxLines: 3,
            decoration: const InputDecoration(
              labelText: 'Required review reason',
              hintText: 'Explain what the applicant must correct or provide',
            ),
          ),
          actions: <Widget>[
            TextButton(
              onPressed: () => Navigator.pop(context),
              child: const Text('Cancel'),
            ),
            FilledButton(
              onPressed: () {
                final String value = controller.text.trim();
                if (value.isNotEmpty) Navigator.pop(context, value);
              },
              child: Text(
                status == 'REJECTED' ? 'Reject' : 'Send request',
              ),
            ),
          ],
        ),
      );
      controller.dispose();
      if (submitted == null) return;
      reason = submitted;
    }
    setState(() => _updating = true);
    try {
      final AdminKycApplication updated = await AdminKycApiService.updateStatus(
        widget.kycId,
        status: status,
        reviewReason: reason,
      );
      if (!mounted) return;
      setState(() => _application = updated);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('KYC marked ${_label(status).toLowerCase()}.')),
      );
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(error.toString().replaceFirst('Exception: ', '')),
            backgroundColor: Colors.red,
          ),
        );
      }
    } finally {
      if (mounted) setState(() => _updating = false);
    }
  }

  Future<void> _openDocument(String documentType) async {
    try {
      final String url = await AdminKycApiService.documentUrl(
        widget.kycId,
        documentType,
      );
      final Uri? uri = Uri.tryParse(url);
      if (uri != null &&
          await launchUrl(uri, mode: LaunchMode.externalApplication)) {
        return;
      }
      throw Exception('Unable to open this authorized document link.');
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
              content: Text('Unable to open this authorized document link.')),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final AdminKycApplication? application = _application;
    return Scaffold(
      backgroundColor: const Color(0xFFF5F7FA),
      appBar: AppBar(
        title: const Text('KYC Application'),
        backgroundColor: const Color(0xFF08783E),
        foregroundColor: Colors.white,
        actions: <Widget>[
          IconButton(
              onPressed: _loading ? null : _load,
              icon: const Icon(Icons.refresh)),
        ],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
              ? Center(
                  child: Padding(
                      padding: const EdgeInsets.all(24), child: Text(_error!)))
              : application == null
                  ? const SizedBox.shrink()
                  : ListView(
                      padding: const EdgeInsets.all(16),
                      children: <Widget>[
                        _section('Review status', <Widget>[
                          Row(children: <Widget>[
                            Expanded(
                                child: Text(_label(application.status),
                                    style: const TextStyle(
                                        fontSize: 19,
                                        fontWeight: FontWeight.bold))),
                            _StatusChip(status: application.status),
                          ]),
                          if (application.reviewReason.isNotEmpty) ...<Widget>[
                            const SizedBox(height: 12),
                            Text('Review reason: ${application.reviewReason}',
                                style: const TextStyle(color: Colors.red)),
                          ],
                        ]),
                        _section('Applicant details', <Widget>[
                          _field('Name', application.displayName),
                          _field('Email', application.email),
                          _field('Phone', application.phone),
                          _field('Date of birth', application.dateOfBirth),
                          _field('Gender', _label(application.gender)),
                          _field('Address', application.address),
                          _field(
                              'State / LGA',
                              [application.state, application.lga]
                                  .where((value) => value.isNotEmpty)
                                  .join(' / ')),
                          _field('Requested tier',
                              _label(application.requestedLevel)),
                          _field('Approved tier', _label(application.level)),
                          _field('Submitted', application.submittedAt),
                          _field(
                            'Identity match',
                            _label(application.identityMatchStatus),
                          ),
                           _field('Verification method',
                               _label(application.verificationMethod)),
                           _field('Verified at', application.verifiedAt),
                        ]),
                        _section('Identity verification', <Widget>[
                          _field(
                            'NIN',
                             application.nin.isNotEmpty
                                 ? application.nin
                                 : application.ninVerified
                                     ? 'Verified •••• ${application.ninLast4}'
                                     : 'Not submitted',
                          ),
                          _field(
                            'BVN',
                             application.bvn.isNotEmpty
                                 ? application.bvn
                                 : application.bvnVerified
                                     ? 'Verified •••• ${application.bvnLast4}'
                                     : 'Not submitted',
                          ),
                          _field(
                            'Government ID type',
                            _label(application.documentType),
                          ),
                        ]),
                        _section('Authorized documents', <Widget>[
                          _document(
                            'Government ID — front',
                            'ID_DOCUMENT_FRONT',
                            application.idDocumentUploaded,
                            application.idDocumentNeedsSecureReupload,
                          ),
                          _document(
                            'Government ID — back',
                            'ID_DOCUMENT_BACK',
                            application.idDocumentBackUploaded,
                            false,
                          ),
                          _document(
                            'Selfie',
                            'SELFIE',
                            application.selfieUploaded,
                            application.selfieNeedsSecureReupload,
                          ),
                          _document(
                            'Proof of address',
                            'PROOF_OF_ADDRESS',
                            application.proofOfAddressUploaded,
                            application.proofOfAddressNeedsSecureReupload,
                          ),
                        ]),
                        if (application.reviewHistory.isNotEmpty)
                          _section(
                            'Review history',
                            application.reviewHistory
                                .map(
                                  (AdminKycReviewEvent event) => Padding(
                                    padding: const EdgeInsets.only(bottom: 10),
                                    child: Text(
                                      '${_label(event.action)}'
                                      '${event.occurredAt.isEmpty ? '' : ' • ${event.occurredAt}'}'
                                      '${event.reason.isEmpty ? '' : '\n${event.reason}'}',
                                    ),
                                  ),
                                )
                                .toList(),
                          ),
                        if (application.status == 'PENDING' ||
                            application.status == 'UNDER_REVIEW')
                          Row(children: <Widget>[
                            Expanded(
                                child: OutlinedButton.icon(
                                    onPressed: _updating
                                        ? null
                                        : () => _review('REJECTED'),
                                    icon: const Icon(Icons.close),
                                    label: Text(
                                        _updating ? 'Updating...' : 'Reject'),
                                    style: OutlinedButton.styleFrom(
                                        foregroundColor: Colors.red))),
                            const SizedBox(width: 12),
                            Expanded(
                                child: ElevatedButton.icon(
                                    onPressed: _updating
                                        ? null
                                        : () => _review('APPROVED'),
                                    icon: const Icon(Icons.verified),
                                    label: Text(
                                        _updating ? 'Updating...' : 'Approve'),
                                    style: ElevatedButton.styleFrom(
                                        backgroundColor:
                                            const Color(0xFF08783E),
                                        foregroundColor: Colors.white))),
                          ]),
                        if (application.status == 'PENDING' ||
                            application.status == 'UNDER_REVIEW') ...<Widget>[
                          const SizedBox(height: 12),
                          SizedBox(
                            width: double.infinity,
                            child: OutlinedButton.icon(
                              onPressed: _updating
                                  ? null
                                  : () => _review('REQUEST_MORE_INFORMATION'),
                              icon: const Icon(Icons.question_answer_outlined),
                              label: const Text('Request more information'),
                            ),
                          ),
                        ],
                      ],
                    ),
    );
  }

  Widget _section(String title, List<Widget> children) => Card(
        margin: const EdgeInsets.only(bottom: 16),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Text(title,
                    style: const TextStyle(
                        fontSize: 17, fontWeight: FontWeight.bold)),
                const SizedBox(height: 12),
                ...children,
              ]),
        ),
      );

  Widget _field(String label, String value) => Padding(
        padding: const EdgeInsets.only(bottom: 10),
        child: RichText(
            text: TextSpan(
                style: DefaultTextStyle.of(context).style,
                children: <TextSpan>[
              TextSpan(
                  text: '$label: ',
                  style: const TextStyle(fontWeight: FontWeight.w600)),
              TextSpan(text: value.isEmpty ? 'Not provided' : value),
            ])),
      );

  Widget _document(
    String title,
    String documentType,
    bool uploaded,
    bool needsSecureReupload,
  ) =>
      ListTile(
        contentPadding: EdgeInsets.zero,
        leading: const Icon(Icons.description_outlined),
        title: Text(title),
        subtitle: Text(needsSecureReupload
            ? 'Secure re-upload required'
            : uploaded
                ? 'Uploaded — tap to open'
                : 'Not provided'),
        trailing: uploaded && !needsSecureReupload
            ? const Icon(Icons.open_in_new)
            : null,
        onTap: uploaded && !needsSecureReupload
            ? () => _openDocument(documentType)
            : null,
      );
}

class _StatusChip extends StatelessWidget {
  const _StatusChip({required this.status});
  final String status;

  @override
  Widget build(BuildContext context) {
    final Color color = status == 'VERIFIED'
        ? Colors.green
        : status == 'REJECTED'
            ? Colors.red
            : status == 'NEEDS_MORE_INFORMATION'
                ? Colors.deepOrange
                : status == 'UNDER_REVIEW'
                    ? Colors.orange
                    : Colors.blueGrey;
    return Chip(
      label: Text(_label(status), style: TextStyle(color: color, fontSize: 12)),
      backgroundColor: color.withValues(alpha: .1),
      side: BorderSide.none,
    );
  }
}

String _label(String value) => value
    .split('_')
    .where((String word) => word.isNotEmpty)
    .map((String word) => '${word[0]}${word.substring(1).toLowerCase()}')
    .join(' ');

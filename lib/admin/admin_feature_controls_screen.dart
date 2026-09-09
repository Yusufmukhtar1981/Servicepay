import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'admin_feature_controls_api.dart';
import 'admin_permissions.dart';

class AdminFeatureControlsScreen extends StatefulWidget {
  const AdminFeatureControlsScreen({super.key, this.api});

  final AdminFeatureControlsApi? api;

  @override
  State<AdminFeatureControlsScreen> createState() =>
      _AdminFeatureControlsScreenState();
}

class _AdminFeatureControlsScreenState
    extends State<AdminFeatureControlsScreen> {
  static const Map<String, String> _labels = <String, String>{
    'airtime': 'Airtime',
    'data': 'Mobile Data',
    'electricity': 'Electricity',
    'cableTv': 'Cable TV',
    'examPin': 'Exam PIN',
    'ninVerification': 'NIN Verification',
    'bvnVerification': 'BVN Verification',
    'delivery': 'Delivery',
    'walletFunding': 'Wallet Funding',
    'servicepayTransfer': 'ServicePay Transfer',
    'bankTransfer': 'Bank Transfer',
    'flightBooking': 'Flight Booking',
    'notifications': 'Notifications',
    'kekeNapep': 'Keke Napep',
    'amana': 'Amana',
  };

  late final AdminFeatureControlsApi _api =
      widget.api ?? AdminFeatureControlsApi();
  final TextEditingController _reason = TextEditingController();
  Map<String, bool> _saved = <String, bool>{};
  Map<String, bool> _draft = <String, bool>{};
  bool _loading = true;
  bool _saving = false;
  bool _canUpdate = false;
  String? _error;

  bool get _changed =>
      _draft.entries.any((entry) => _saved[entry.key] != entry.value);

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _reason.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final prefs = await SharedPreferences.getInstance();
      final access = await AdminSessionStore.loadAccess();
      final role = (prefs.getString('user_role') ?? access.role).toUpperCase();
      final values = await _api.load();
      if (!mounted) return;
      setState(() {
        _canUpdate = role == 'HEAD_OFFICE' &&
            access.has(AdminPermissions.settingsUpdate);
        _saved = Map<String, bool>.from(values);
        _draft = Map<String, bool>.from(values);
      });
    } catch (error) {
      if (!mounted) return;
      setState(() => _error = error.toString());
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _save() async {
    if (!_canUpdate || !_changed || _saving) return;
    final reason = _reason.text.trim();
    if (reason.length < 10) {
      _message('Provide a reason of at least 10 characters.');
      return;
    }
    final changes = _draft.entries
        .where((entry) => _saved[entry.key] != entry.value)
        .map((entry) =>
            '${_labels[entry.key] ?? entry.key}: ${entry.value ? "Enabled" : "Disabled"}')
        .join('\n');
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Confirm feature-control changes'),
        content: Text(
          '$changes\n\nReason: $reason\n\n'
          'These settings affect customer access after deployment.',
        ),
        actions: <Widget>[
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('CANCEL'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('CONFIRM CHANGES'),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    setState(() => _saving = true);
    try {
      await _api.save(_draft, reason);
      if (!mounted) return;
      setState(() {
        _saved = Map<String, bool>.from(_draft);
        _reason.clear();
      });
      _message('Feature Controls saved.');
    } catch (error) {
      if (mounted) _message(error.toString());
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  void _message(String message) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(message)),
    );
  }

  @override
  Widget build(BuildContext context) {
    final keys = _draft.keys.toList()
      ..sort((a, b) => (_labels[a] ?? a).compareTo(_labels[b] ?? b));
    return Scaffold(
      appBar: AppBar(
        title: const Text('Feature Controls'),
        actions: <Widget>[
          IconButton(
            tooltip: 'Reload Feature Controls',
            onPressed: _saving ? null : _load,
            icon: const Icon(Icons.refresh),
          ),
        ],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
              ? Center(
                  child: Padding(
                    padding: const EdgeInsets.all(24),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: <Widget>[
                        Text(_error!, textAlign: TextAlign.center),
                        const SizedBox(height: 12),
                        FilledButton(
                          onPressed: _load,
                          child: const Text('TRY AGAIN'),
                        ),
                      ],
                    ),
                  ),
                )
              : ListView(
                  padding: const EdgeInsets.all(20),
                  children: <Widget>[
                    const Text(
                      'Service availability',
                      style:
                          TextStyle(fontSize: 24, fontWeight: FontWeight.bold),
                    ),
                    const SizedBox(height: 6),
                    Text(
                      _canUpdate
                          ? 'Changes require an audit reason and confirmation.'
                          : 'You have read-only access. Only Head Office can save changes.',
                    ),
                    const SizedBox(height: 20),
                    ...keys.map(
                      (key) => Card(
                        child: SwitchListTile(
                          title: Text(_labels[key] ?? key),
                          subtitle: Text(
                              _draft[key] == true ? 'Enabled' : 'Disabled'),
                          value: _draft[key] == true,
                          onChanged: _canUpdate && !_saving
                              ? (value) => setState(() => _draft[key] = value)
                              : null,
                        ),
                      ),
                    ),
                    const SizedBox(height: 12),
                    TextField(
                      controller: _reason,
                      enabled: _canUpdate && !_saving,
                      minLines: 2,
                      maxLines: 4,
                      maxLength: 500,
                      decoration: const InputDecoration(
                        labelText: 'Audit reason',
                        hintText:
                            'Explain why these service controls are changing.',
                        border: OutlineInputBorder(),
                      ),
                    ),
                    const SizedBox(height: 12),
                    FilledButton.icon(
                      onPressed:
                          _canUpdate && _changed && !_saving ? _save : null,
                      icon: _saving
                          ? const SizedBox(
                              width: 18,
                              height: 18,
                              child: CircularProgressIndicator(strokeWidth: 2),
                            )
                          : const Icon(Icons.save_outlined),
                      label: const Text('SAVE FEATURE CONTROLS'),
                    ),
                  ],
                ),
    );
  }
}

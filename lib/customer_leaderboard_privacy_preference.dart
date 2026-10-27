import 'package:flutter/material.dart';

import 'services/customer_leaderboard_api.dart';

/// Signals mounted Champions surfaces to re-read the consent-aware report.
/// It carries no preference value and is never persisted locally.
final ValueNotifier<int> customerLeaderboardPrivacyChanged = ValueNotifier(0);

class CustomerLeaderboardPrivacyPreference extends StatefulWidget {
  const CustomerLeaderboardPrivacyPreference({
    super.key,
    this.api,
    this.onChanged,
  });

  final CustomerLeaderboardApi? api;
  final Future<void> Function()? onChanged;

  @override
  State<CustomerLeaderboardPrivacyPreference> createState() =>
      _CustomerLeaderboardPrivacyPreferenceState();
}

class _CustomerLeaderboardPrivacyPreferenceState
    extends State<CustomerLeaderboardPrivacyPreference> {
  late final CustomerLeaderboardApi _api;
  bool? _showFullName;
  bool _loading = true;
  bool _saving = false;
  String? _error;
  String? _confirmation;

  @override
  void initState() {
    super.initState();
    _api = widget.api ?? CustomerLeaderboardApi();
    _load();
  }

  Future<void> _load() async {
    if (_saving) return;
    setState(() {
      _loading = true;
      _error = null;
      _confirmation = null;
    });
    try {
      final value = await _api.loadShowFullName();
      if (!mounted) return;
      setState(() {
        _showFullName = value;
        _loading = false;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _error = _message(error);
        _loading = false;
      });
    }
  }

  Future<void> _save(bool value) async {
    if (_saving || _loading || _showFullName == null) return;
    setState(() {
      _saving = true;
      _error = null;
      _confirmation = null;
    });
    try {
      final confirmedValue = await _api.updateShowFullName(value);
      if (!mounted) return;
      setState(() {
        _showFullName = confirmedValue;
        _saving = false;
        _confirmation = 'Your preference was updated.';
      });
      customerLeaderboardPrivacyChanged.value++;
      await widget.onChanged?.call();
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _saving = false;
        _error = _message(error);
      });
    }
  }

  String _message(Object error) => error
      .toString()
      .replaceFirst('FormatException: ', '')
      .replaceFirst('ClientException: ', '');

  @override
  Widget build(BuildContext context) {
    final ready = !_loading && !_saving && _showFullName != null;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      decoration: BoxDecoration(
        color: const Color(0xFFF1F6F1),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: const Color(0xFFDCE8DE)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.center,
            children: [
              const Icon(Icons.visibility_outlined,
                  color: Color(0xFF08783E), size: 21),
              const SizedBox(width: 10),
              const Expanded(
                child: Text(
                  'Show My Full Name on Champions Leaderboard',
                  style: TextStyle(
                      color: Color(0xFF18382F),
                      fontSize: 13,
                      fontWeight: FontWeight.w800),
                ),
              ),
              if (_loading || _saving)
                const SizedBox(
                  width: 20,
                  height: 20,
                  child: CircularProgressIndicator(
                      strokeWidth: 2, color: Color(0xFF08783E)),
                )
              else
                Switch.adaptive(
                  key: const Key('champions-full-name-switch'),
                  value: _showFullName ?? false,
                  onChanged: ready ? _save : null,
                  activeTrackColor: const Color(0xFF08783E),
                ),
            ],
          ),
          const SizedBox(height: 5),
          const Padding(
            padding: EdgeInsets.only(left: 31, right: 3),
            child: Text(
              'Off by default. When enabled, your registered full name may appear in the monthly rankings.',
              style: TextStyle(
                  color: Color(0xFF60736A), fontSize: 11, height: 1.45),
            ),
          ),
          if (_error != null) ...[
            const SizedBox(height: 8),
            Row(
              children: [
                Expanded(
                  child: Text(
                    _error!,
                    key: const Key('champions-privacy-error'),
                    style:
                        const TextStyle(color: Color(0xFFB42318), fontSize: 12),
                  ),
                ),
                TextButton(
                  onPressed: _loading || _saving ? null : _load,
                  child: const Text('Retry'),
                ),
              ],
            ),
          ],
          if (_confirmation != null) ...[
            const SizedBox(height: 7),
            Text(
              _confirmation!,
              key: const Key('champions-privacy-confirmation'),
              style: const TextStyle(
                  color: Color(0xFF08783E),
                  fontSize: 11,
                  fontWeight: FontWeight.w700),
            ),
          ],
        ],
      ),
    );
  }
}

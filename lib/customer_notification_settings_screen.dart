import 'dart:async';

import 'package:flutter/material.dart';

import 'services/customer_alert_media.dart';
import 'services/customer_notification_settings.dart';
import 'services/customer_settings_events.dart';
import 'services/session_store.dart';

class CustomerNotificationSettingsScreen extends StatefulWidget {
  const CustomerNotificationSettingsScreen({super.key, this.api, this.media});
  final CustomerNotificationSettingsApi? api;
  final CustomerAlertMediaService? media;

  @override
  State<CustomerNotificationSettingsScreen> createState() =>
      _CustomerNotificationSettingsScreenState();
}

class _CustomerNotificationSettingsScreenState
    extends State<CustomerNotificationSettingsScreen> {
  late final CustomerNotificationSettingsApi _api;
  late final CustomerAlertMediaService _media;
  late final bool _ownsApi;
  CustomerNotificationSettings _settings = const CustomerNotificationSettings();
  bool _loading = true;
  bool _testingSound = false;
  bool _testingVoice = false;
  String? _error;
  String? _saving;
  late final Future<String?> _sessionToken;

  @override
  void initState() {
    super.initState();
    _ownsApi = widget.api == null;
    _api = widget.api ?? CustomerNotificationSettingsApi();
    _media = widget.media ?? CustomerAlertMediaService.shared;
    _sessionToken = SessionStore.readToken();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final next = await _api.load();
      if (mounted) setState(() => _settings = next);
    } catch (error) {
      if (mounted) setState(() => _error = error.toString());
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _update(String key, Object value) async {
    if (_saving != null) return;
    if (value == false && key == 'soundNotifications') {
      unawaited(_media.stopSound());
    } else if (value == false && key == 'voiceAnnouncements') {
      unawaited(_media.stopSpeech());
    }
    setState(() {
      _saving = key;
      _error = null;
    });
    try {
      final next = await _api.update(<String, dynamic>{key: value});
      if (mounted) {
        setState(() => _settings = next);
        await CustomerSettingsEvents.publish(
          next,
          expectedSessionToken: await _sessionToken,
        );
      }
    } catch (error) {
      if (mounted) setState(() => _error = 'Your change was not saved. $error');
    } finally {
      if (mounted) setState(() => _saving = null);
    }
  }

  Future<void> _testSound() async {
    if (_testingSound) return;
    setState(() => _testingSound = true);
    final played = await _media.testSound();
    if (mounted) {
      setState(() => _testingSound = false);
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
        content: Text(played
            ? 'Test sound played on this device.'
            : 'Sound playback is blocked or unavailable. Incoming credits will still show a visual notice.'),
      ));
    }
  }

  Future<void> _testVoice() async {
    if (_testingVoice) return;
    setState(() => _testingVoice = true);
    final played = await _media.testVoice();
    if (mounted) {
      setState(() => _testingVoice = false);
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
        content: Text(played
            ? 'English device voice test completed.'
            : 'No available English device voice or playback was blocked. Visual notices remain available.'),
      ));
    }
  }

  @override
  void dispose() {
    if (_ownsApi) _api.close();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        backgroundColor: const Color(0xFFF5F8F5),
        appBar: AppBar(
          title: const Text('Dashboard & alerts'),
          backgroundColor: const Color(0xFF087D3B),
          foregroundColor: Colors.white,
        ),
        body: _loading
            ? const Center(
                child: SizedBox(
                  width: 280,
                  child: LinearProgressIndicator(color: Color(0xFF087D3B)),
                ),
              )
            : RefreshIndicator(
                onRefresh: _load,
                child: ListView(
                  padding: const EdgeInsets.fromLTRB(18, 22, 18, 36),
                  children: <Widget>[
                    const Text('Make it yours',
                        style: TextStyle(
                            fontSize: 24, fontWeight: FontWeight.w800)),
                    const SizedBox(height: 6),
                    const Text(
                      'Choose how your dashboard looks and how you hear about wallet credits.',
                      style: TextStyle(height: 1.45, color: Color(0xFF59685E)),
                    ),
                    if (_error != null) ...<Widget>[
                      const SizedBox(height: 16),
                      _SettingsError(message: _error!, onRetry: _load),
                    ],
                    const SizedBox(height: 22),
                    _PreferenceCard(
                      title: 'Dashboard background',
                      subtitle:
                          'Only the page background changes. Your wallet and service cards stay the same.',
                      child: SegmentedButton<String>(
                        segments: const <ButtonSegment<String>>[
                          ButtonSegment(value: 'green', label: Text('Green')),
                          ButtonSegment(
                              value: 'default', label: Text('Default')),
                        ],
                        selected: <String>{_settings.dashboardBackground},
                        onSelectionChanged: _saving == null
                            ? (values) =>
                                _update('dashboardBackground', values.first)
                            : null,
                      ),
                    ),
                    const SizedBox(height: 14),
                    _PreferenceCard(
                      title: 'Sound notification',
                      subtitle:
                          'Play a short locally generated alert when money arrives.',
                      child: SwitchListTile.adaptive(
                        contentPadding: EdgeInsets.zero,
                        title: const Text('Play notification sound'),
                        value: _settings.soundNotifications,
                        onChanged: _saving == null
                            ? (value) => _update('soundNotifications', value)
                            : null,
                        activeColor: const Color(0xFF087D3B),
                      ),
                    ),
                    const SizedBox(height: 14),
                    _PreferenceCard(
                      title: 'Try your sound',
                      subtitle:
                          'Tap to test local audio and allow playback in browsers that require a gesture.',
                      child: Align(
                        alignment: Alignment.centerLeft,
                        child: OutlinedButton.icon(
                          onPressed: _testingSound ? null : _testSound,
                          icon: _testingSound
                              ? const SizedBox(
                                  width: 16,
                                  height: 16,
                                  child:
                                      CircularProgressIndicator(strokeWidth: 2))
                              : const Icon(Icons.volume_up_outlined),
                          label: const Text('Test sound'),
                        ),
                      ),
                    ),
                    const SizedBox(height: 14),
                    _PreferenceCard(
                      title: 'Voice announcement',
                      subtitle:
                          'Speak incoming naira amounts using an available English device voice. Voice and accent depend on your device; Hausa speech is not assumed. Amounts are never sent to a speech service.',
                      child: SwitchListTile.adaptive(
                        contentPadding: EdgeInsets.zero,
                        title: const Text('Announce money received'),
                        value: _settings.voiceAnnouncements,
                        onChanged: _saving == null
                            ? (value) => _update('voiceAnnouncements', value)
                            : null,
                        activeColor: const Color(0xFF087D3B),
                      ),
                    ),
                    const SizedBox(height: 8),
                    Align(
                      alignment: Alignment.centerLeft,
                      child: OutlinedButton.icon(
                        onPressed: _testingVoice ? null : _testVoice,
                        icon: _testingVoice
                            ? const SizedBox(
                                width: 16,
                                height: 16,
                                child:
                                    CircularProgressIndicator(strokeWidth: 2))
                            : const Icon(Icons.record_voice_over_outlined),
                        label: const Text('Test English voice'),
                      ),
                    ),
                    if (_saving != null) ...<Widget>[
                      const SizedBox(height: 16),
                      const LinearProgressIndicator(color: Color(0xFF087D3B)),
                    ],
                  ],
                ),
              ),
      );
}

class _PreferenceCard extends StatelessWidget {
  const _PreferenceCard({
    required this.title,
    required this.subtitle,
    required this.child,
  });
  final String title;
  final String subtitle;
  final Widget child;

  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.fromLTRB(16, 16, 12, 12),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(18),
          border: Border.all(color: const Color(0xFFDDE9DF)),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Text(title,
                style:
                    const TextStyle(fontWeight: FontWeight.w800, fontSize: 16)),
            const SizedBox(height: 4),
            Text(subtitle,
                style: const TextStyle(color: Color(0xFF657269), height: 1.4)),
            const SizedBox(height: 12),
            child,
          ],
        ),
      );
}

class _SettingsError extends StatelessWidget {
  const _SettingsError({required this.message, required this.onRetry});
  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: const Color(0xFFFFF4EE),
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: const Color(0xFFE8C4B0)),
        ),
        child: Row(
          children: <Widget>[
            Expanded(
                child: Text(message,
                    style: const TextStyle(color: Color(0xFF713E2A)))),
            TextButton(onPressed: onRetry, child: const Text('Retry')),
          ],
        ),
      );
}

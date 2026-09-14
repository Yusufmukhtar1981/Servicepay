import 'dart:async';

import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../servicepay_theme.dart';
import '../services/announcement_service.dart';

class AnnouncementBanner extends StatelessWidget {
  const AnnouncementBanner({
    super.key,
    required this.announcement,
    required this.onDismiss,
    required this.onAcknowledge,
    required this.onAction,
  });

  final ServicePayAnnouncement announcement;
  final VoidCallback onDismiss;
  final VoidCallback onAcknowledge;
  final VoidCallback onAction;

  @override
  Widget build(BuildContext context) {
    final Color accent = announcement.type == 'WARNING'
        ? const Color(0xFFB46B16)
        : ServicePayColors.brand;
    return Container(
      margin: const EdgeInsets.only(bottom: 14),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: accent.withValues(alpha: .25)),
        boxShadow: const [
          BoxShadow(
              color: Color(0x120A3B27), blurRadius: 16, offset: Offset(0, 6)),
        ],
      ),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(Icons.campaign_outlined, color: accent, size: 23),
            const SizedBox(width: 11),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(announcement.title,
                      style: const TextStyle(
                          color: Color(0xFF17382B),
                          fontSize: 14,
                          fontWeight: FontWeight.w900)),
                  const SizedBox(height: 4),
                  Text(announcement.message,
                      maxLines: 3,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                          color: ServicePayColors.muted, height: 1.35)),
                  if (announcement.ctaText != null) ...[
                    const SizedBox(height: 8),
                    TextButton(
                      onPressed: onAction,
                      style: TextButton.styleFrom(
                          padding: EdgeInsets.zero,
                          foregroundColor: ServicePayColors.brandDeep),
                      child: Text(announcement.ctaText!,
                          style: const TextStyle(fontWeight: FontWeight.w900)),
                    ),
                  ],
                  if (announcement.mandatory)
                    TextButton(
                      onPressed: onAcknowledge,
                      style: TextButton.styleFrom(
                          padding: EdgeInsets.zero,
                          foregroundColor: ServicePayColors.brandDeep),
                      child: const Text('Acknowledge',
                          style: TextStyle(fontWeight: FontWeight.w900)),
                    ),
                ],
              ),
            ),
            if (announcement.canDismiss)
              IconButton(
                tooltip: 'Dismiss announcement',
                onPressed: onDismiss,
                icon: const Icon(Icons.close_rounded, size: 19),
              ),
          ],
        ),
      ),
    );
  }
}

class AnnouncementPopup extends StatelessWidget {
  const AnnouncementPopup({
    super.key,
    required this.announcement,
    required this.onDismiss,
    required this.onAcknowledge,
    required this.onAction,
  });

  final ServicePayAnnouncement announcement;
  final VoidCallback onDismiss;
  final VoidCallback onAcknowledge;
  final VoidCallback onAction;

  @override
  Widget build(BuildContext context) {
    final DateTime? createdAt = announcement.createdAt?.toLocal();
    const List<String> months = <String>[
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec',
    ];
    final String? publishedDate = createdAt == null
        ? null
        : '${createdAt.day} ${months[createdAt.month - 1]} ${createdAt.year}';
    return AlertDialog(
      insetPadding: const EdgeInsets.symmetric(horizontal: 22, vertical: 28),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(25)),
      title: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const CircleAvatar(
            radius: 20,
            backgroundColor: Color(0xFFEAF7F0),
            child: Icon(Icons.shield_rounded, color: ServicePayColors.brand),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'ServicePay',
                  style: TextStyle(
                    color: ServicePayColors.brand,
                    fontSize: 12,
                    fontWeight: FontWeight.w900,
                  ),
                ),
                const SizedBox(height: 3),
                Text(
                  announcement.title,
                  style: const TextStyle(
                    color: Color(0xFF17382B),
                    fontWeight: FontWeight.w900,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
      content: SingleChildScrollView(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            if (announcement.imageUrl?.isNotEmpty == true)
              ClipRRect(
                borderRadius: BorderRadius.circular(15),
                child: Image.network(announcement.imageUrl!,
                    width: double.infinity,
                    height: 150,
                    fit: BoxFit.cover,
                    errorBuilder: (_, __, ___) => const SizedBox.shrink()),
              ),
            if (announcement.imageUrl?.isNotEmpty == true)
              const SizedBox(height: 14),
            Text(announcement.message,
                style: const TextStyle(
                    color: ServicePayColors.muted, height: 1.45)),
            if (publishedDate != null) ...[
              const SizedBox(height: 12),
              Text(
                'Published $publishedDate',
                style: const TextStyle(
                  color: ServicePayColors.muted,
                  fontSize: 12,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ],
          ],
        ),
      ),
      actions: [
        if (announcement.canDismiss)
          TextButton(onPressed: onDismiss, child: const Text('Got it')),
        if (announcement.ctaText != null)
          FilledButton(onPressed: onAction, child: Text(announcement.ctaText!)),
        if (announcement.mandatory)
          FilledButton(
              onPressed: onAcknowledge, child: const Text('Acknowledge')),
      ],
    );
  }
}

Future<void> launchAnnouncementAction(
  BuildContext context,
  ServicePayAnnouncement announcement,
) async {
  final action = announcement.ctaAction?.trim();
  if (action == null || action.isEmpty) return;
  final Uri? uri = Uri.tryParse(action);
  if (uri != null && (uri.scheme == 'https' || uri.scheme == 'http')) {
    await launchUrl(uri, mode: LaunchMode.externalApplication);
    return;
  }
  if (context.mounted) {
    ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
        content: Text('This announcement action is unavailable.')));
  }
}

class AnnouncementSurface extends StatefulWidget {
  const AnnouncementSurface({
    super.key,
    required this.announcements,
    required this.service,
  });

  final List<ServicePayAnnouncement> announcements;
  final AnnouncementService service;

  @override
  State<AnnouncementSurface> createState() => _AnnouncementSurfaceState();
}

class _AnnouncementSurfaceState extends State<AnnouncementSurface> {
  late List<ServicePayAnnouncement> _items = widget.announcements;
  String? _activePopupId;
  final Set<String> _completedPopupIds = <String>{};
  final Set<String> _viewedIds = <String>{};

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _schedulePopup();
  }

  @override
  void didUpdateWidget(covariant AnnouncementSurface oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.announcements != widget.announcements) {
      _items = widget.announcements;
      _schedulePopup();
    }
  }

  void _schedulePopup() {
    for (final item in _items.where(_shouldShow)) {
      if (_viewedIds.add(item.id)) {
        unawaited(widget.service.view(item.id));
      }
    }
    if (_activePopupId != null) return;
    final matching = _items
        .where((item) =>
            item.isPopup &&
            _shouldShow(item) &&
            !_completedPopupIds.contains(item.id))
        .toList()
      ..sort((left, right) => right.priority != left.priority
          ? right.priority.compareTo(left.priority)
          : (right.createdAt ?? DateTime(1970))
              .compareTo(left.createdAt ?? DateTime(1970)));
    final popup = matching.isEmpty ? null : matching.first;
    if (popup == null) return;
    _activePopupId = popup.id;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      showDialog<void>(
        context: context,
        barrierDismissible: popup.canDismiss,
        builder: (_) => AnnouncementPopup(
          announcement: popup,
          onDismiss: () => _dismiss(popup),
          onAcknowledge: () => unawaited(_acknowledge(popup)),
          onAction: () => unawaited(_action(popup)),
        ),
      ).then((_) {
        if (!mounted || _activePopupId != popup.id) return;
        _activePopupId = null;
        if (popup.canDismiss && _items.any((item) => item.id == popup.id)) {
          _removeLocal(popup);
          unawaited(widget.service.dismiss(popup.id));
        }
        _schedulePopup();
      });
    });
  }

  bool _shouldShow(ServicePayAnnouncement item) =>
      !item.dismissed &&
      !item.acknowledged &&
      (item.visibility != 'once' || !item.viewed);

  void _removeLocal(ServicePayAnnouncement item) {
    if (!mounted) return;
    setState(
        () => _items = _items.where((value) => value.id != item.id).toList());
  }

  void _remove(ServicePayAnnouncement item) {
    _removeLocal(item);
    _schedulePopup();
  }

  void _dismiss(ServicePayAnnouncement item) {
    _completedPopupIds.add(item.id);
    if (_activePopupId == item.id) {
      _activePopupId = null;
      Navigator.of(context).pop();
    }
    _remove(item);
    unawaited(widget.service.dismiss(item.id));
  }

  Future<void> _acknowledge(ServicePayAnnouncement item) async {
    final bool recorded = await widget.service.acknowledge(item.id);
    if (!mounted) return;
    if (!recorded) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text(
            'Acknowledgment could not be recorded. Please try again.',
          ),
        ),
      );
      return;
    }
    _completedPopupIds.add(item.id);
    if (_activePopupId == item.id) {
      _activePopupId = null;
      Navigator.of(context).pop();
    }
    _remove(item);
  }

  Future<void> _action(ServicePayAnnouncement item) async {
    // The CTA is not launched until the interaction has been sent. A failed
    // analytics request must still not strand the customer.
    try {
      await widget.service.click(item.id);
    } catch (_) {
      // Navigation remains safe and available when telemetry is unavailable.
    }
    if (!mounted) return;
    if (item.isPopup && !item.mandatory && Navigator.of(context).canPop()) {
      _completedPopupIds.add(item.id);
      _activePopupId = null;
      Navigator.of(context).pop();
      _remove(item);
    }
    await launchAnnouncementAction(context, item);
  }

  @override
  Widget build(BuildContext context) {
    final banners = _items.where((item) => item.isBanner && _shouldShow(item));
    return Column(
      children: banners
          .map((item) => AnnouncementBanner(
                announcement: item,
                onDismiss: () {
                  _dismiss(item);
                },
                onAcknowledge: () => unawaited(_acknowledge(item)),
                onAction: () => unawaited(_action(item)),
              ))
          .toList(),
    );
  }
}

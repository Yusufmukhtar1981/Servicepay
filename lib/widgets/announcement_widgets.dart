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

class AnnouncementPromotionCarousel extends StatefulWidget {
  const AnnouncementPromotionCarousel({
    super.key,
    required this.announcements,
    required this.onDismiss,
    required this.onAcknowledge,
    required this.onAction,
  });

  final List<ServicePayAnnouncement> announcements;
  final ValueChanged<ServicePayAnnouncement> onDismiss;
  final ValueChanged<ServicePayAnnouncement> onAcknowledge;
  final ValueChanged<ServicePayAnnouncement> onAction;

  @override
  State<AnnouncementPromotionCarousel> createState() =>
      _AnnouncementPromotionCarouselState();
}

class _AnnouncementPromotionCarouselState
    extends State<AnnouncementPromotionCarousel> {
  late final PageController _pageController;
  Timer? _rotationTimer;
  int _page = 0;
  bool _isPaused = false;
  bool _animationsDisabled = false;
  bool _programmaticPageChange = false;

  @override
  void initState() {
    super.initState();
    _pageController = PageController();
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final bool disabled =
        MediaQuery.maybeOf(context)?.disableAnimations ?? false;
    if (disabled != _animationsDisabled) {
      _animationsDisabled = disabled;
      if (disabled) {
        _rotationTimer?.cancel();
        _rotationTimer = null;
      } else if (!_isPaused) {
        _startRotation();
      }
    } else if (!_animationsDisabled && _rotationTimer == null && !_isPaused) {
      _startRotation();
    }
  }

  @override
  void didUpdateWidget(covariant AnnouncementPromotionCarousel oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.announcements.length != oldWidget.announcements.length) {
      _page = widget.announcements.isEmpty
          ? 0
          : _page.clamp(0, widget.announcements.length - 1);
      _startRotation();
    }
  }

  void _startRotation() {
    _rotationTimer?.cancel();
    if (widget.announcements.length < 2 || _isPaused || _animationsDisabled) {
      return;
    }
    _rotationTimer = Timer.periodic(const Duration(seconds: 6), (_) {
      if (!mounted || !_pageController.hasClients) return;
      final int next = (_page + 1) % widget.announcements.length;
      _programmaticPageChange = true;
      _pageController.animateToPage(
        next,
        duration: const Duration(milliseconds: 520),
        curve: Curves.easeOutCubic,
      );
    });
  }

  void _pauseRotation() {
    if (_isPaused) return;
    setState(() => _isPaused = true);
    _rotationTimer?.cancel();
    _rotationTimer = null;
  }

  void _toggleRotation() {
    if (_animationsDisabled) return;
    setState(() => _isPaused = !_isPaused);
    if (_isPaused) {
      _rotationTimer?.cancel();
      _rotationTimer = null;
    } else {
      _startRotation();
    }
  }

  @override
  void dispose() {
    _rotationTimer?.cancel();
    _pageController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (widget.announcements.isEmpty) return const SizedBox.shrink();
    return Semantics(
      container: true,
      label: 'ServicePay promotions',
      child: Column(
        children: [
          LayoutBuilder(
            builder: (context, constraints) {
              // Keep the default banner compact, then add vertical room at
              // every viewport width when customers use larger system text.
              final double textScale =
                  MediaQuery.textScalerOf(context).scale(1);
              final double baseHeight = constraints.maxWidth < 360
                  ? 194
                  : (constraints.maxWidth * .43).clamp(158.0, 194.0);
              final double scaleExtra =
                  ((textScale - 1).clamp(0, 1.5) * 320).toDouble();
              final double height =
                  (baseHeight + scaleExtra).clamp(baseHeight, 560.0);
              return SizedBox(
                height: height,
                child: Listener(
                  onPointerDown: (_) => _pauseRotation(),
                  child: PageView.builder(
                    controller: _pageController,
                    itemCount: widget.announcements.length,
                    onPageChanged: (value) {
                      if (!_programmaticPageChange) _pauseRotation();
                      _programmaticPageChange = false;
                      setState(() => _page = value);
                    },
                    itemBuilder: (context, index) => Semantics(
                      container: true,
                      label:
                          'Promotion ${index + 1} of ${widget.announcements.length}',
                      liveRegion: index == _page,
                      child: _PromotionCard(
                        announcement: widget.announcements[index],
                        onDismiss: () =>
                            widget.onDismiss(widget.announcements[index]),
                        onAcknowledge: () =>
                            widget.onAcknowledge(widget.announcements[index]),
                        onAction: () =>
                            widget.onAction(widget.announcements[index]),
                      ),
                    ),
                  ),
                ),
              );
            },
          ),
          if (widget.announcements.length > 1) ...[
            const SizedBox(height: 9),
            Semantics(
              container: true,
              liveRegion: true,
              label: 'Promotion ${_page + 1} of ${widget.announcements.length}',
              child: const SizedBox.shrink(),
            ),
            Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: List<Widget>.generate(
                widget.announcements.length,
                (index) => AnimatedContainer(
                  duration: const Duration(milliseconds: 220),
                  margin: const EdgeInsets.symmetric(horizontal: 3),
                  width: index == _page ? 20 : 6,
                  height: 6,
                  decoration: BoxDecoration(
                    color: index == _page
                        ? ServicePayColors.brand
                        : ServicePayColors.border,
                    borderRadius: BorderRadius.circular(8),
                  ),
                ),
              ),
            ),
            Semantics(
              container: true,
              button: true,
              enabled: !_animationsDisabled,
              label: _animationsDisabled
                  ? 'Promotion auto-rotation unavailable when animations are disabled'
                  : (_isPaused
                      ? 'Resume promotion auto-rotation'
                      : 'Pause promotion auto-rotation'),
              child: IconButton(
                tooltip: _animationsDisabled
                    ? 'Auto-rotation unavailable'
                    : (_isPaused ? 'Resume promotions' : 'Pause promotions'),
                onPressed: _animationsDisabled ? null : _toggleRotation,
                icon: Icon(
                  _isPaused ? Icons.play_arrow_rounded : Icons.pause_rounded,
                  size: 18,
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class _PromotionCard extends StatelessWidget {
  const _PromotionCard({
    required this.announcement,
    required this.onDismiss,
    required this.onAcknowledge,
    required this.onAction,
  });

  final ServicePayAnnouncement announcement;
  final VoidCallback onDismiss;
  final VoidCallback onAcknowledge;
  final VoidCallback onAction;

  String _dateLabel(DateTime? value) {
    if (value == null) return '';
    final date = value.toLocal();
    const months = <String>[
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
    return '${date.day} ${months[date.month - 1]} ${date.year}';
  }

  @override
  Widget build(BuildContext context) {
    final bool hasImage = announcement.imageUrl?.trim().isNotEmpty == true;
    final String start = _dateLabel(announcement.startsAt);
    final String published = _dateLabel(announcement.createdAt);
    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 1),
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(
        color: hasImage ? ServicePayColors.ink : ServicePayColors.brandDeep,
        borderRadius: BorderRadius.circular(20),
        boxShadow: const [
          BoxShadow(
            color: Color(0x190A3B27),
            blurRadius: 18,
            offset: Offset(0, 8),
          ),
        ],
      ),
      child: Stack(
        fit: StackFit.expand,
        children: [
          if (hasImage)
            Image.network(
              announcement.imageUrl!,
              fit: BoxFit.cover,
              errorBuilder: (_, __, ___) => const _BrandedPromotionBackdrop(),
            )
          else
            const _BrandedPromotionBackdrop(),
          if (hasImage)
            const DecoratedBox(
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  colors: [Color(0xC9002919), Color(0x24103527)],
                  begin: Alignment.bottomLeft,
                  end: Alignment.topRight,
                ),
              ),
            ),
          Padding(
            padding: const EdgeInsets.fromLTRB(18, 15, 54, 14),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Wrap(
                  spacing: 8,
                  runSpacing: 4,
                  alignment: WrapAlignment.spaceBetween,
                  children: [
                    Container(
                      padding: const EdgeInsets.symmetric(
                          horizontal: 9, vertical: 5),
                      decoration: BoxDecoration(
                        color: Colors.white.withValues(alpha: .16),
                        borderRadius: BorderRadius.circular(20),
                      ),
                      child: Text(
                        announcement.type == 'PROMOTION'
                            ? 'SERVICEPAY PROMOTION'
                            : 'SERVICEPAY UPDATE',
                        style: const TextStyle(
                          color: Colors.white,
                          fontSize: 9,
                          fontWeight: FontWeight.w900,
                          letterSpacing: .8,
                        ),
                      ),
                    ),
                    if (start.isNotEmpty)
                      Text(
                        'Live $start',
                        style: TextStyle(
                          color: Colors.white.withValues(alpha: .78),
                          fontSize: 10,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                  ],
                ),
                const Spacer(),
                Text(
                  announcement.title,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 19,
                    height: 1.08,
                    fontWeight: FontWeight.w900,
                  ),
                ),
                const SizedBox(height: 5),
                Text(
                  announcement.message,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    color: Colors.white.withValues(alpha: .86),
                    fontSize: 12,
                    height: 1.25,
                  ),
                ),
                if (published.isNotEmpty)
                  Padding(
                    padding: const EdgeInsets.only(top: 4),
                    child: Text(
                      'Published $published',
                      style: TextStyle(
                        color: Colors.white.withValues(alpha: .62),
                        fontSize: 9,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ),
                if (announcement.ctaText != null || announcement.mandatory)
                  Align(
                    alignment: Alignment.bottomLeft,
                    child: Padding(
                      padding: const EdgeInsets.only(top: 4),
                      child: Wrap(
                        spacing: 8,
                        children: [
                          if (announcement.ctaText != null)
                            TextButton(
                              onPressed: onAction,
                              style: TextButton.styleFrom(
                                foregroundColor: Colors.white,
                                padding: const EdgeInsets.symmetric(
                                    horizontal: 2, vertical: 2),
                                minimumSize: const Size(0, 28),
                              ),
                              child: Text(
                                announcement.ctaText!,
                                style: const TextStyle(
                                    fontWeight: FontWeight.w900),
                              ),
                            ),
                          if (announcement.mandatory)
                            TextButton(
                              onPressed: onAcknowledge,
                              style: TextButton.styleFrom(
                                foregroundColor: Colors.white,
                                padding: const EdgeInsets.symmetric(
                                    horizontal: 2, vertical: 2),
                                minimumSize: const Size(0, 28),
                              ),
                              child: const Text('Acknowledge'),
                            ),
                        ],
                      ),
                    ),
                  ),
              ],
            ),
          ),
          if (announcement.canDismiss)
            Positioned(
              top: 5,
              right: 5,
              child: IconButton(
                tooltip: 'Dismiss announcement',
                onPressed: onDismiss,
                color: Colors.white,
                icon: const Icon(Icons.close_rounded, size: 18),
              ),
            ),
        ],
      ),
    );
  }
}

class _BrandedPromotionBackdrop extends StatelessWidget {
  const _BrandedPromotionBackdrop();

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          colors: [ServicePayColors.brandDeep, ServicePayColors.brand],
          begin: Alignment.bottomLeft,
          end: Alignment.topRight,
        ),
      ),
      child: Stack(
        children: [
          Positioned(
            right: -20,
            top: -34,
            child: Icon(Icons.auto_awesome_rounded,
                size: 160, color: Colors.white.withValues(alpha: .08)),
          ),
          Positioned(
            right: 22,
            bottom: -38,
            child: Icon(Icons.account_balance_wallet_rounded,
                size: 150, color: Colors.white.withValues(alpha: .08)),
          ),
        ],
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
      (item.startsAt == null || !DateTime.now().isBefore(item.startsAt!)) &&
      (item.endsAt == null || !DateTime.now().isAfter(item.endsAt!)) &&
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
    final banners = _items
        .where((item) => item.isBanner && _shouldShow(item))
        .toList()
      ..sort((left, right) => right.priority != left.priority
          ? right.priority.compareTo(left.priority)
          : (right.createdAt ?? DateTime(1970))
              .compareTo(left.createdAt ?? DateTime(1970)));
    return Column(
      children: banners.isEmpty
          ? const <Widget>[]
          : <Widget>[
              AnnouncementPromotionCarousel(
                announcements: banners,
                onDismiss: _dismiss,
                onAcknowledge: (item) => unawaited(_acknowledge(item)),
                onAction: (item) => unawaited(_action(item)),
              ),
            ],
    );
  }
}

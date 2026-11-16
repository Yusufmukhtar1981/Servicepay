import 'dart:async';

import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../servicepay_theme.dart';
import '../services/announcement_service.dart';
import '../services/reward_progress_service.dart';
import '../referral_presentation_policy.dart';
import 'customer_dashboard_visuals.dart';

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

class RewardProgressCard extends StatelessWidget {
  const RewardProgressCard({
    super.key,
    required this.announcement,
    this.progress,
    this.loading = false,
    this.error,
  });

  final ServicePayAnnouncement announcement;
  final RewardProgress? progress;
  final bool loading;
  final String? error;

  String _money(double value) {
    final String fixed = value.toStringAsFixed(2);
    final List<String> parts = fixed.split('.');
    final String whole = parts.first;
    final StringBuffer formatted = StringBuffer();
    for (int i = 0; i < whole.length; i++) {
      final int remaining = whole.length - i;
      formatted.write(whole[i]);
      if (remaining > 1 && remaining % 3 == 1) formatted.write(',');
    }
    return '₦${formatted.toString()}.${parts.last}';
  }

  double _ratio(double current, double required) {
    if (required <= 0) return 0;
    return (current / required).clamp(0.0, 1.0).toDouble();
  }

  @override
  Widget build(BuildContext context) {
    final RewardProgress? value = progress;
    return Container(
      margin: const EdgeInsets.only(top: 12, bottom: 4),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: CustomerDashboardPalette.card,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: CustomerDashboardPalette.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Wrap(
            spacing: 10,
            runSpacing: 6,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: <Widget>[
              const Icon(Icons.card_giftcard_rounded,
                  color: CustomerDashboardPalette.royalBlue, size: 23),
              const Text(
                'Smartphone Reward Progress',
                style: TextStyle(
                  color: CustomerDashboardPalette.text,
                  fontSize: 16,
                  fontWeight: FontWeight.w900,
                ),
              ),
            ],
          ),
          const SizedBox(height: 3),
          Text(
            announcement.rewardDescription?.trim().isNotEmpty == true
                ? announcement.rewardDescription!
                : 'Reward campaign',
            style: const TextStyle(
              color: CustomerDashboardPalette.muted,
              fontWeight: FontWeight.w700,
            ),
          ),
          const SizedBox(height: 14),
          if (loading && value == null)
            const Row(
              children: <Widget>[
                SizedBox(
                  width: 18,
                  height: 18,
                  child: CircularProgressIndicator(strokeWidth: 2),
                ),
                SizedBox(width: 10),
                Expanded(child: Text('Loading your reward progress…')),
              ],
            )
          else if (error != null && value == null)
            Text(error!,
                style: const TextStyle(
                    color: CustomerDashboardPalette.muted, height: 1.35))
          else if (value == null || !value.hasData)
            const Text(
              'No reward progress is available for this campaign yet.',
              style: TextStyle(
                  color: CustomerDashboardPalette.muted, height: 1.35),
            )
          else ...[
            _ProgressMetric(
              label: 'Transactions',
              value: value.requiredTransactionCount > 0
                  ? '${value.transactionCount} / ${value.requiredTransactionCount}'
                  : '${value.transactionCount}',
              progress: _ratio(
                value.transactionCount.toDouble(),
                value.requiredTransactionCount.toDouble(),
              ),
            ),
            const SizedBox(height: 14),
            _ProgressMetric(
              label: 'Transaction value',
              value: value.requiredTransactionValue > 0
                  ? '${_money(value.transactionValue)} / ${_money(value.requiredTransactionValue)}'
                  : _money(value.transactionValue),
              progress: _ratio(
                value.transactionValue,
                value.requiredTransactionValue,
              ),
            ),
            const SizedBox(height: 14),
            if (value.qualified)
              const Text(
                'QUALIFIED',
                style: TextStyle(
                  color: CustomerDashboardPalette.royalBlue,
                  fontWeight: FontWeight.w900,
                  letterSpacing: .7,
                ),
              )
            else ...[
              const Text(
                'Keep going! Complete both requirements to qualify for the reward draw.',
                style: TextStyle(
                  color: CustomerDashboardPalette.softText,
                  height: 1.35,
                  fontWeight: FontWeight.w700,
                ),
              ),
              if (value.remainingTransactions != null ||
                  value.remainingValue != null) ...[
                const SizedBox(height: 5),
                Text(
                  _remainingLabel(value),
                  style: const TextStyle(
                    color: CustomerDashboardPalette.muted,
                    fontSize: 12,
                  ),
                ),
              ],
            ],
          ],
        ],
      ),
    );
  }

  String _remainingLabel(RewardProgress value) {
    final List<String> remaining = <String>[];
    if (value.remainingTransactions != null) {
      remaining.add('${value.remainingTransactions} transactions');
    }
    if (value.remainingValue != null) {
      remaining.add(_money(value.remainingValue!));
    }
    return '${remaining.join(' and ')} remaining.';
  }
}

class _ProgressMetric extends StatelessWidget {
  const _ProgressMetric({
    required this.label,
    required this.value,
    required this.progress,
  });

  final String label;
  final String value;
  final double progress;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        Wrap(
          alignment: WrapAlignment.spaceBetween,
          runSpacing: 3,
          children: <Widget>[
            Text(label,
                style: const TextStyle(
                    color: CustomerDashboardPalette.muted,
                    fontWeight: FontWeight.w700)),
            Text(value,
                style: const TextStyle(
                    color: CustomerDashboardPalette.text,
                    fontWeight: FontWeight.w900)),
          ],
        ),
        const SizedBox(height: 7),
        ClipRRect(
          borderRadius: BorderRadius.circular(8),
          child: LinearProgressIndicator(
            value: progress.clamp(0.0, 1.0).toDouble(),
            minHeight: 8,
            color: CustomerDashboardPalette.royalBlue,
            backgroundColor: CustomerDashboardPalette.paleBlue,
          ),
        ),
      ],
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
    this.referralPolicy,
    this.onReferralAction,
  });

  final List<ServicePayAnnouncement> announcements;
  final ValueChanged<ServicePayAnnouncement> onDismiss;
  final ValueChanged<ServicePayAnnouncement> onAcknowledge;
  final ValueChanged<ServicePayAnnouncement> onAction;
  final ReferralPresentationPolicy? referralPolicy;
  final VoidCallback? onReferralAction;

  int get _itemCount => announcements.length + (referralPolicy == null ? 0 : 1);

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

  double _referralContentHeight(BuildContext context, double width) {
    final policy = widget.referralPolicy;
    if (policy == null) return 0;
    final scaler = MediaQuery.textScalerOf(context);
    final scale = scaler.scale(1);
    final compact = width < 365;
    final hasIllustration = !(scale > 1.35 && width < 420);
    final innerWidth = width - (compact ? 32 : 40);
    final copyWidth = hasIllustration ? (innerWidth - 5) * .6 : innerWidth;
    double measure(String text, double size, double lineHeight,
        {int? maxLines, double? maxWidth, double? letterSpacing}) {
      final painter = TextPainter(
        text: TextSpan(
          text: text,
          style: DefaultTextStyle.of(context).style.merge(TextStyle(
            fontSize: size,
            height: lineHeight,
            fontWeight: FontWeight.w900,
            letterSpacing: letterSpacing,
          )),
        ),
        textDirection: Directionality.of(context),
        textScaler: scaler,
        maxLines: maxLines,
      )..layout(
          maxWidth: (maxWidth ?? copyWidth)
              .clamp(1.0, double.infinity)
              .toDouble());
      final height = painter.height;
      painter.dispose();
      return height;
    }
    final labelHeight =
        measure('Refer Now →', 12, 1.3, maxWidth: copyWidth - 28) + 16;
    final buttonHeight = labelHeight > 44 ? labelHeight : 44.0;
    return measure('Refer & Earn', 21, 1.08, letterSpacing: -.45) +
        measure(policy.message, 13, 1.3) +
        buttonHeight +
        measure('Rewards follow verification and eligibility.', 9, 1.2,
            maxLines: 2) +
        34 + 8 + 11 + 6 + 12;
  }

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
    if (widget._itemCount != oldWidget._itemCount) {
      _page = widget._itemCount == 0
          ? 0
          : _page.clamp(0, widget._itemCount - 1);
      _startRotation();
    }
  }

  void _startRotation() {
    _rotationTimer?.cancel();
    if (widget._itemCount < 2 || _isPaused || _animationsDisabled) {
      return;
    }
    _rotationTimer = Timer.periodic(const Duration(seconds: 6), (_) {
      if (!mounted || !_pageController.hasClients) return;
      final int next = (_page + 1) % widget._itemCount;
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
    if (widget._itemCount == 0) return const SizedBox.shrink();
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
              final bool containsImage = widget.announcements.any(
                (item) => item.imageUrl?.trim().isNotEmpty == true,
              );
              final bool narrowImageCard =
                  containsImage && constraints.maxWidth < 560;
              final bool hasReferral = widget.referralPolicy != null;
              final double baseHeight = containsImage
                  ? (narrowImageCard ? 342 : constraints.maxWidth * .34)
                  : hasReferral
                      ? (constraints.maxWidth < 330 ? 252 : 220)
                      : (constraints.maxWidth < 360
                      ? 194
                      : (constraints.maxWidth * .30).clamp(176.0, 218.0));
              final double scaleExtra =
                  ((textScale - 1).clamp(0, 1.5) * (containsImage ? 230 : 320))
                      .toDouble();
              final double fallbackHeight =
                  (baseHeight + scaleExtra).clamp(baseHeight, 560.0);
              final double referralHeight =
                  _referralContentHeight(context, constraints.maxWidth);
              final double height = referralHeight > fallbackHeight
                  ? referralHeight
                  : fallbackHeight;
              return SizedBox(
                key: const Key('announcement-promotion-viewport'),
                height: height,
                child: Listener(
                  onPointerDown: (_) => _pauseRotation(),
                  child: PageView.builder(
                    controller: _pageController,
                    itemCount: widget._itemCount,
                    onPageChanged: (value) {
                      if (!_programmaticPageChange) _pauseRotation();
                      _programmaticPageChange = false;
                      setState(() => _page = value);
                    },
                    itemBuilder: (context, index) => Semantics(
                      container: true,
                      label: 'Promotion ${index + 1} of ${widget._itemCount}',
                      liveRegion: index == _page,
                      child: widget.referralPolicy != null && index == 0
                          ? _ReferralPromotionCard(
                              policy: widget.referralPolicy!,
                              onTap: widget.onReferralAction ?? () {},
                            )
                          : _PromotionCard(
                              announcement: widget.announcements[
                                  index - (widget.referralPolicy == null ? 0 : 1)],
                              onDismiss: () => widget.onDismiss(
                                widget.announcements[
                                    index - (widget.referralPolicy == null ? 0 : 1)],
                              ),
                              onAcknowledge: () => widget.onAcknowledge(
                                widget.announcements[
                                    index - (widget.referralPolicy == null ? 0 : 1)],
                              ),
                              onAction: () => widget.onAction(
                                widget.announcements[
                                    index - (widget.referralPolicy == null ? 0 : 1)],
                              ),
                            ),
                    ),
                  ),
                ),
              );
            },
          ),
          if (widget._itemCount > 1) ...[
            const SizedBox(height: 9),
            Semantics(
              container: true,
              liveRegion: true,
              label: 'Promotion ${_page + 1} of ${widget._itemCount}',
              child: const SizedBox.shrink(),
            ),
            Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: List<Widget>.generate(
                widget._itemCount,
                (index) => Semantics(
                  button: true,
                  selected: index == _page,
                  label: 'Show promotion ${index + 1}',
                  child: SizedBox(
                    width: 44,
                    height: 44,
                    child: InkWell(
                      key: Key('announcement-promotion-dot-$index'),
                      borderRadius: BorderRadius.circular(22),
                      onTap: () {
                        _pauseRotation();
                        _programmaticPageChange = true;
                        _pageController.animateToPage(
                          index,
                          duration: _animationsDisabled
                              ? Duration.zero
                              : const Duration(milliseconds: 320),
                          curve: Curves.easeOutCubic,
                        );
                      },
                      child: Center(
                        child: AnimatedContainer(
                          duration: _animationsDisabled
                              ? Duration.zero
                              : const Duration(milliseconds: 220),
                          width: index == _page ? 20 : 6,
                          height: 6,
                          decoration: BoxDecoration(
                            color: index == _page
                                ? CustomerDashboardPalette.royalBlue
                                : CustomerDashboardPalette.muted,
                            borderRadius: BorderRadius.circular(8),
                          ),
                        ),
                      ),
                    ),
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

class _ReferralPromotionCard extends StatelessWidget {
  const _ReferralPromotionCard({
    required this.policy,
    required this.onTap,
  });

  final ReferralPresentationPolicy policy;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final double scale = MediaQuery.textScalerOf(context).scale(1);
        final bool compact = constraints.maxWidth < 365;
        return Semantics(
          key: const Key('referral-promotion-card'),
          container: true,
          label: 'Refer and Earn. ${policy.message}',
          child: Material(
            color: const Color(0xFF082D21),
            clipBehavior: Clip.antiAlias,
            borderRadius: BorderRadius.circular(20),
            child: Stack(
                children: <Widget>[
                  Padding(
                    padding: EdgeInsets.fromLTRB(
                      compact ? 16 : 20,
                      18,
                      compact ? 16 : 20,
                      16,
                    ),
                    child: Row(
                      children: <Widget>[
                        Expanded(
                          flex: 6,
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            mainAxisAlignment: MainAxisAlignment.center,
                            children: <Widget>[
                              const Text(
                                'Refer & Earn',
                                style: TextStyle(
                                  color: Colors.white,
                                  fontSize: 21,
                                  height: 1.08,
                                  fontWeight: FontWeight.w900,
                                  letterSpacing: -.45,
                                ),
                              ),
                              const SizedBox(height: 8),
                              Text(
                                policy.message,
                                style: const TextStyle(
                                  color: Color(0xFFD4EBDD),
                                  fontSize: 13,
                                  height: 1.3,
                                  fontWeight: FontWeight.w600,
                                ),
                              ),
                              const SizedBox(height: 11),
                              Align(
                                alignment: Alignment.centerLeft,
                                child: FilledButton(
                                  key: const Key('referral-promotion-cta'),
                                  onPressed: onTap,
                                  style: FilledButton.styleFrom(
                                    backgroundColor: const Color(0xFF39E875),
                                    foregroundColor: const Color(0xFF052619),
                                    minimumSize: const Size(0, 44),
                                    padding: const EdgeInsets.symmetric(
                                      horizontal: 14,
                                    ),
                                    shape: const StadiumBorder(),
                                  ),
                                  child: const Text(
                                    'Refer Now →',
                                    style: TextStyle(
                                      fontSize: 12,
                                      fontWeight: FontWeight.w900,
                                    ),
                                  ),
                                ),
                              ),
                              const SizedBox(height: 4),
                              const Text(
                                'Rewards follow verification and eligibility.',
                                maxLines: 2,
                                overflow: TextOverflow.ellipsis,
                                style: TextStyle(
                                  color: Color(0xFFA7C5B1),
                                  fontSize: 9,
                                  height: 1.2,
                                ),
                              ),
                            ],
                          ),
                        ),
                        if (!(scale > 1.35 && constraints.maxWidth < 420)) ...[
                        const SizedBox(width: 5),
                        Expanded(
                          flex: 4,
                          child: SizedBox(
                            height: compact ? 142 : 170,
                            child: CustomPaint(
                              painter: _ReferralArtworkPainter(
                                reward: ReferralPresentationPolicy.money(
                                  policy.registrationBonus,
                                ),
                              ),
                            ),
                          ),
                        ),
                        ],
                      ],
                    ),
                  ),
                ],
            ),
          ),
        );
      },
    );
  }
}

class _ReferralArtworkPainter extends CustomPainter {
  const _ReferralArtworkPainter({this.reward = ''});

  final String reward;

  @override
  void paint(Canvas canvas, Size size) {
    final Paint ring = Paint()
      ..color = const Color(0xFF56EB84).withValues(alpha: .14)
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.2;
    canvas.drawCircle(
      Offset(size.width * .53, size.height * .53),
      size.shortestSide * .38,
      ring,
    );
    final Paint cone = Paint()..color = const Color(0xFFDAF7E3);
    final Path mouth = Path()
      ..moveTo(size.width * .23, size.height * .44)
      ..lineTo(size.width * .68, size.height * .26)
      ..lineTo(size.width * .68, size.height * .72)
      ..lineTo(size.width * .23, size.height * .55)
      ..close();
    canvas.drawPath(mouth, cone);
    final Paint bell = Paint()..color = const Color(0xFF37E875);
    canvas.drawPath(
      Path()
        ..moveTo(size.width * .61, size.height * .29)
        ..quadraticBezierTo(size.width * .73, size.height * .49,
            size.width * .61, size.height * .69)
        ..lineTo(size.width * .70, size.height * .70)
        ..quadraticBezierTo(size.width * .84, size.height * .49,
            size.width * .70, size.height * .28)
        ..close(),
      bell,
    );
    canvas.drawRRect(
      RRect.fromRectAndRadius(
        Rect.fromLTWH(size.width * .25, size.height * .49,
            size.width * .18, size.height * .13),
        const Radius.circular(5),
      ),
      Paint()..color = const Color(0xFF16894B),
    );
    canvas.drawLine(
      Offset(size.width * .37, size.height * .59),
      Offset(size.width * .47, size.height * .78),
      Paint()
        ..color = const Color(0xFF36E875)
        ..strokeWidth = 5
        ..strokeCap = StrokeCap.round,
    );
    final Paint coin = Paint()..color = const Color(0xFFFFC94A);
    canvas.drawOval(
      Rect.fromCenter(
        center: Offset(size.width * .75, size.height * .76),
        width: size.width * .43,
        height: size.height * .23,
      ),
      coin,
    );
    if (reward.isNotEmpty) {
      final TextPainter text = TextPainter(
        text: TextSpan(
          text: reward,
          style: const TextStyle(
            color: Color(0xFF3A2A08),
            fontSize: 11,
            fontWeight: FontWeight.w900,
          ),
        ),
        textDirection: TextDirection.ltr,
        maxLines: 1,
      )..layout(maxWidth: size.width * .40);
      text.paint(
        canvas,
        Offset(size.width * .75 - text.width / 2,
            size.height * .76 - text.height / 2),
      );
      text.dispose();
    }
    final Paint sparkle = Paint()
      ..color = const Color(0xFFFFC94A)
      ..strokeWidth = 2.2
      ..strokeCap = StrokeCap.round;
    for (final Offset point in <Offset>[
      Offset(size.width * .17, size.height * .27),
      Offset(size.width * .48, size.height * .15),
      Offset(size.width * .88, size.height * .38),
    ]) {
      canvas.drawLine(point.translate(-3, 0), point.translate(3, 0), sparkle);
      canvas.drawLine(point.translate(0, -3), point.translate(0, 3), sparkle);
    }
  }

  @override
  bool shouldRepaint(covariant _ReferralArtworkPainter oldDelegate) =>
      reward != oldDelegate.reward;
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
    if (hasImage) {
      return _ImagePromotionCard(
        announcement: announcement,
        startLabel: start,
        publishedLabel: published,
        onDismiss: onDismiss,
        onAcknowledge: onAcknowledge,
        onAction: onAction,
      );
    }
    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 1),
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(
        color: ServicePayColors.brandDeep,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: CustomerDashboardPalette.border),
      ),
      child: Stack(
        fit: StackFit.expand,
        children: [
          const _BrandedPromotionBackdrop(),
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

class _ImagePromotionCard extends StatelessWidget {
  const _ImagePromotionCard({
    required this.announcement,
    required this.startLabel,
    required this.publishedLabel,
    required this.onDismiss,
    required this.onAcknowledge,
    required this.onAction,
  });

  final ServicePayAnnouncement announcement;
  final String startLabel;
  final String publishedLabel;
  final VoidCallback onDismiss;
  final VoidCallback onAcknowledge;
  final VoidCallback onAction;

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final bool wide = constraints.maxWidth >= 560;
        final Widget image = ColoredBox(
          key: const Key('announcement-promotion-image-area'),
          color: Colors.white,
          child: SizedBox.expand(
            child: Image.network(
              announcement.imageUrl!,
              key: const Key('announcement-promotion-image'),
              fit: BoxFit.contain,
              alignment: Alignment.center,
              errorBuilder: (_, __, ___) => const Icon(
                Icons.campaign_outlined,
                color: ServicePayColors.brandDeep,
                size: 38,
              ),
            ),
          ),
        );
        final Widget caption = Container(
          key: const Key('announcement-promotion-caption'),
          color: CustomerDashboardPalette.card,
          padding: const EdgeInsets.fromLTRB(18, 14, 14, 12),
          child: SingleChildScrollView(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        announcement.type == 'PROMOTION'
                            ? 'SERVICEPAY PROMOTION'
                            : 'SERVICEPAY UPDATE',
                        style: const TextStyle(
                          color: CustomerDashboardPalette.royalBlue,
                          fontSize: 10,
                          fontWeight: FontWeight.w900,
                          letterSpacing: .8,
                        ),
                      ),
                    ),
                    if (announcement.canDismiss)
                      IconButton(
                        tooltip: 'Dismiss announcement',
                        onPressed: onDismiss,
                        visualDensity: VisualDensity.compact,
                        iconSize: 18,
                        color: ServicePayColors.brandDeep,
                        icon: const Icon(Icons.close_rounded),
                      ),
                  ],
                ),
                if (startLabel.isNotEmpty)
                  Text(
                    'Live $startLabel',
                    style: const TextStyle(
                      color: CustomerDashboardPalette.muted,
                      fontSize: 11,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                const SizedBox(height: 5),
                Text(
                  announcement.title,
                  style: const TextStyle(
                    color: CustomerDashboardPalette.text,
                    fontSize: 18,
                    height: 1.1,
                    fontWeight: FontWeight.w900,
                  ),
                ),
                const SizedBox(height: 5),
                Text(
                  announcement.message,
                  style: const TextStyle(
                    color: CustomerDashboardPalette.softText,
                    fontSize: 12,
                    height: 1.3,
                  ),
                ),
                if (publishedLabel.isNotEmpty) ...[
                  const SizedBox(height: 5),
                  Text(
                    'Published $publishedLabel',
                    style: const TextStyle(
                      color: CustomerDashboardPalette.muted,
                      fontSize: 10,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ],
                if (announcement.ctaText != null || announcement.mandatory) ...[
                  const SizedBox(height: 6),
                  Wrap(
                    spacing: 8,
                    runSpacing: 4,
                    children: [
                      if (announcement.ctaText != null)
                        FilledButton(
                          onPressed: onAction,
                          style: FilledButton.styleFrom(
                            backgroundColor: ServicePayColors.brandDeep,
                            foregroundColor: Colors.white,
                          ),
                          child: Text(announcement.ctaText!),
                        ),
                      if (announcement.mandatory)
                        TextButton(
                          onPressed: onAcknowledge,
                          child: const Text('Acknowledge'),
                        ),
                    ],
                  ),
                ],
              ],
            ),
          ),
        );
        return Container(
          key: const Key('announcement-promotion-card'),
          margin: const EdgeInsets.symmetric(horizontal: 1),
          clipBehavior: Clip.antiAlias,
          decoration: BoxDecoration(
            color: CustomerDashboardPalette.card,
            borderRadius: BorderRadius.circular(20),
            border: Border.all(color: CustomerDashboardPalette.border),
          ),
          child: wide
              ? Row(
                  children: [
                    Expanded(flex: 5, child: image),
                    Expanded(flex: 6, child: caption),
                  ],
                )
              : Column(
                  children: [
                    Expanded(flex: 5, child: image),
                    Expanded(flex: 6, child: caption),
                  ],
                ),
        );
      },
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
                    fit: BoxFit.contain,
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
    this.onPopupCompleted,
    this.onBannerRemoved,
    this.rewardProgressService,
    this.referralPolicy,
    this.onReferralAction,
  });

  final List<ServicePayAnnouncement> announcements;
  final AnnouncementService service;
  final ValueChanged<ServicePayAnnouncement>? onPopupCompleted;
  final ValueChanged<ServicePayAnnouncement>? onBannerRemoved;
  final RewardProgressService? rewardProgressService;
  final ReferralPresentationPolicy? referralPolicy;
  final VoidCallback? onReferralAction;

  @override
  State<AnnouncementSurface> createState() => _AnnouncementSurfaceState();
}

/// Campaign delivery is independent of wallet/dashboard loading. Only a
/// successful empty response is described as having no active promotions.
class AnnouncementLoadPlaceholder extends StatelessWidget {
  const AnnouncementLoadPlaceholder({
    required this.loading,
    required this.error,
    required this.onRetry,
    super.key,
  });

  final bool loading;
  final String? error;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    if (loading) {
      return Semantics(
        key: const Key('announcement-loading-state'),
        label: 'Loading ServicePay updates',
        child: const SizedBox(
          height: 112,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              _AnnouncementSkeletonLine(width: .62),
              SizedBox(height: 12),
              _AnnouncementSkeletonLine(width: .92),
              SizedBox(height: 8),
              _AnnouncementSkeletonLine(width: .74),
            ],
          ),
        ),
      );
    }
    if (error != null) {
      return Container(
        key: const Key('announcement-error-state'),
        padding: const EdgeInsets.fromLTRB(2, 9, 2, 12),
        child: Row(
          children: [
            const Icon(Icons.cloud_off_outlined,
                color: CustomerDashboardPalette.muted, size: 20),
            const SizedBox(width: 10),
            const Expanded(
              child: Text(
                'Updates could not be loaded.',
                style: TextStyle(
                    color: CustomerDashboardPalette.muted,
                    fontSize: 13,
                    fontWeight: FontWeight.w700),
              ),
            ),
            TextButton(
              onPressed: onRetry,
              child: const Text('Retry'),
            ),
          ],
        ),
      );
    }
    return Container(
      key: const Key('announcement-empty-state'),
      padding: const EdgeInsets.symmetric(vertical: 20, horizontal: 12),
      decoration: BoxDecoration(
        color: CustomerDashboardPalette.card,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: CustomerDashboardPalette.border),
      ),
      child: const Row(
        children: [
          Icon(Icons.campaign_outlined,
              color: CustomerDashboardPalette.royalBlue, size: 23),
          SizedBox(width: 11),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('No active promotions',
                    style: TextStyle(
                        color: CustomerDashboardPalette.text,
                        fontWeight: FontWeight.w900)),
                SizedBox(height: 3),
                Text('ServicePay updates will appear here when available.',
                    style: TextStyle(
                        color: CustomerDashboardPalette.muted,
                        height: 1.35,
                        fontSize: 12)),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _AnnouncementSkeletonLine extends StatelessWidget {
  const _AnnouncementSkeletonLine({required this.width});

  final double width;

  @override
  Widget build(BuildContext context) => FractionallySizedBox(
        widthFactor: width,
        child: Container(
          height: 11,
          decoration: BoxDecoration(
            color: const Color(0xFFE8F5EC),
            borderRadius: BorderRadius.circular(8),
          ),
        ),
      );
}

class _AnnouncementSurfaceState extends State<AnnouncementSurface> {
  late List<ServicePayAnnouncement> _items = widget.announcements;
  String? _activePopupId;
  final Set<String> _completedPopupIds = <String>{};
  final Set<String> _reportedPopupCompletionIds = <String>{};
  final Set<String> _viewedIds = <String>{};
  final Set<String> _requestedProgressIds = <String>{};
  final Set<String> _loadingProgressIds = <String>{};
  final Map<String, RewardProgress> _progress = <String, RewardProgress>{};
  final Map<String, String> _progressErrors = <String, String>{};

  void _reportPopupCompleted(ServicePayAnnouncement item) {
    if (item.isBanner && _reportedPopupCompletionIds.add(item.id)) {
      widget.onPopupCompleted?.call(item);
    }
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _schedulePopup();
    _loadRewardProgress();
  }

  @override
  void didUpdateWidget(covariant AnnouncementSurface oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.announcements != widget.announcements) {
      // Dashboard refreshes replace the active list. Re-query the server even
      // when a campaign id remains active so its progress is never stale.
      _requestedProgressIds.removeWhere(
        (id) => widget.announcements.any((item) => item.id == id),
      );
      _items = widget.announcements;
      _schedulePopup();
      _loadRewardProgress();
    }
  }

  List<ServicePayAnnouncement> get _trackedBanners => _items
      .where((item) =>
          item.isBanner && item.campaignTrackingEnabled && _shouldShow(item))
      .toList();

  void _loadRewardProgress() {
    final RewardProgressService? progressService = widget.rewardProgressService;
    if (progressService == null) return;
    for (final ServicePayAnnouncement item in _trackedBanners) {
      if (!_requestedProgressIds.add(item.id)) continue;
      _loadingProgressIds.add(item.id);
      unawaited(_fetchRewardProgress(item, progressService));
    }
    if (mounted && _loadingProgressIds.isNotEmpty) setState(() {});
  }

  Future<void> _fetchRewardProgress(
    ServicePayAnnouncement item,
    RewardProgressService progressService,
  ) async {
    try {
      final RewardProgress progress =
          await progressService.fetchProgress(item.id);
      if (!mounted) return;
      if (_items.any((value) => value.id == item.id)) {
        setState(() {
          _progress[item.id] = progress;
          _progressErrors.remove(item.id);
          _loadingProgressIds.remove(item.id);
        });
      }
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _progressErrors[item.id] = 'Reward progress is currently unavailable.';
        _loadingProgressIds.remove(item.id);
      });
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
          onDismiss: () => _dismissPopup(popup),
          onAcknowledge: () => unawaited(_acknowledgePopup(popup)),
          onAction: () => unawaited(_action(popup, fromPopup: true)),
        ),
      ).then((_) {
        if (!mounted) return;
        if (_activePopupId == popup.id) {
          _activePopupId = null;
        }
        // A barrier dismissal completes only the popup surface. A BOTH
        // announcement must remain available to its dashboard banner.
        if (popup.canDismiss && _completedPopupIds.add(popup.id)) {
          _reportPopupCompleted(popup);
          if (!popup.isBanner) {
            _removeLocal(popup);
            unawaited(widget.service.dismiss(popup.id));
          }
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

  void _dismissPopup(ServicePayAnnouncement item) {
    _completedPopupIds.add(item.id);
    _reportPopupCompleted(item);
    if (_activePopupId == item.id) {
      Navigator.of(context).pop();
    }
    // "Got it" acknowledges the popup presentation only. Persisting a
    // campaign dismissal here would also suppress the banner for BOTH.
    if (!item.isBanner) {
      _removeLocal(item);
      unawaited(widget.service.dismiss(item.id));
    }
  }

  void _dismissBanner(ServicePayAnnouncement item) {
    _completedPopupIds.add(item.id);
    widget.onBannerRemoved?.call(item);
    _remove(item);
    unawaited(widget.service.dismiss(item.id));
  }

  Future<void> _acknowledgePopup(ServicePayAnnouncement item) async {
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
    _reportPopupCompleted(item);
    if (_activePopupId == item.id) {
      Navigator.of(context).pop();
    }
    if (!item.isBanner) {
      _removeLocal(item);
    }
  }

  Future<void> _acknowledgeBanner(ServicePayAnnouncement item) async {
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
    widget.onBannerRemoved?.call(item);
    _remove(item);
  }

  Future<void> _action(
    ServicePayAnnouncement item, {
    bool fromPopup = false,
  }) async {
    // The CTA is not launched until the interaction has been sent. A failed
    // analytics request must still not strand the customer.
    try {
      await widget.service.click(item.id);
    } catch (_) {
      // Navigation remains safe and available when telemetry is unavailable.
    }
    if (!mounted) return;
    if (fromPopup &&
        item.isPopup &&
        !item.mandatory &&
        Navigator.of(context).canPop()) {
      _completedPopupIds.add(item.id);
      _reportPopupCompleted(item);
      Navigator.of(context).pop();
      if (!item.isBanner) {
        _removeLocal(item);
      }
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
    final List<Widget> children = <Widget>[];
    if (banners.isNotEmpty) {
      children.add(
        AnnouncementPromotionCarousel(
          announcements: banners,
          onDismiss: _dismissBanner,
          onAcknowledge: (item) => unawaited(_acknowledgeBanner(item)),
          onAction: (item) => unawaited(_action(item)),
          referralPolicy: widget.referralPolicy,
          onReferralAction: widget.onReferralAction,
        ),
      );
    } else if (widget.referralPolicy != null) {
      children.add(
        AnnouncementPromotionCarousel(
          announcements: const <ServicePayAnnouncement>[],
          onDismiss: _dismissBanner,
          onAcknowledge: (item) => unawaited(_acknowledgeBanner(item)),
          onAction: (item) => unawaited(_action(item)),
          referralPolicy: widget.referralPolicy,
          onReferralAction: widget.onReferralAction,
        ),
      );
    }
    for (final ServicePayAnnouncement item in _trackedBanners) {
      children.add(
        RewardProgressCard(
          key: ValueKey<String>('reward-progress-card-${item.id}'),
          announcement: item,
          progress: _progress[item.id],
          loading: _loadingProgressIds.contains(item.id),
          error: _progressErrors[item.id],
        ),
      );
    }
    return Column(children: children);
  }
}

import 'package:flutter/material.dart';

enum PurchasePhase { idle, confirming, processing, success, failed, pending }

/// Transport acceptance is not proof of delivery.
PurchasePhase purchaseOutcome(Map<String, dynamic> result) {
  final status = '${result['status'] ?? ''}'.toUpperCase();
  final reference = '${result['reference'] ?? ''}';
  if (result['pending'] == true ||
      const {'PENDING', 'UNKNOWN', 'READY', 'SENDING'}.contains(status)) {
    return PurchasePhase.pending;
  }
  if (result['success'] == true &&
      reference.isNotEmpty &&
      const {'SUCCESS', 'SUCCESSFUL', 'COMPLETED'}.contains(status)) {
    return PurchasePhase.success;
  }
  final http = result['httpStatus'] is int ? result['httpStatus'] as int : 0;
  if (const {'REFUNDED', 'REVERSED'}.contains(status) ||
      (status == 'FAILED' && result['dispatchStatus'] == 'REFUNDED') ||
      (http >= 400 && http < 500 && http != 409 && reference.isEmpty)) {
    return PurchasePhase.failed;
  }
  return PurchasePhase.pending;
}

/// Blocks navigation and underlying inputs until the financial response arrives.
/// This is route-owned: it never pushes/pops a modal over a subsequent receipt.
class PurchaseProcessing extends StatelessWidget {
  const PurchaseProcessing({
    super.key,
    required this.processing,
    required this.service,
    required this.child,
    this.requestId,
    this.pending = false,
    this.nonBlocking = false,
  });
  final bool processing;
  final bool pending;
  final bool nonBlocking;
  final String service;
  final Widget child;
  final String? requestId;

  @override
  Widget build(BuildContext context) {
    // A live transaction is never presented as a passive status banner. The
    // caller's nonBlocking setting only applies once a request is pending.
    if (processing) {
      return PopScope(
        canPop: false,
        child: Stack(
          fit: StackFit.expand,
          children: [
            child,
            const Positioned.fill(
              child: ModalBarrier(
                dismissible: false,
                color: Color(0x990B211D),
              ),
            ),
            Positioned.fill(
              child: SafeArea(
                child: LayoutBuilder(
                  builder: (context, constraints) => SingleChildScrollView(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 20,
                      vertical: 24,
                    ),
                    child: ConstrainedBox(
                      constraints: BoxConstraints(
                        minHeight: constraints.maxHeight - 48,
                      ),
                      child: Center(
                        child: ConstrainedBox(
                          constraints: const BoxConstraints(maxWidth: 420),
                          child: Semantics(
                            liveRegion: true,
                            label: [
                              'Processing your transaction',
                              if (requestId?.isNotEmpty == true)
                                'Request ID: $requestId',
                            ].join('. '),
                            child: Material(
                              color: const Color(0xFFF8FCFA),
                              elevation: 18,
                              shadowColor: const Color(0x66051F18),
                              borderRadius: BorderRadius.circular(28),
                              clipBehavior: Clip.antiAlias,
                              child: Container(
                                width: double.infinity,
                                decoration: BoxDecoration(
                                  border: Border.all(
                                    color: const Color(0xFFD5E9DF),
                                  ),
                                  borderRadius: BorderRadius.circular(28),
                                ),
                                padding: const EdgeInsets.fromLTRB(
                                  26,
                                  28,
                                  26,
                                  26,
                                ),
                                child: Column(
                                  mainAxisSize: MainAxisSize.min,
                                  children: [
                                    Container(
                                      width: 78,
                                      height: 78,
                                      padding: const EdgeInsets.all(10),
                                      decoration: BoxDecoration(
                                        color: const Color(0xFFE7F3EC),
                                        borderRadius: BorderRadius.circular(24),
                                      ),
                                      child: Image.asset(
                                        'assets/image/servicepay_logo.png',
                                        fit: BoxFit.contain,
                                        semanticLabel: 'ServicePay',
                                      ),
                                    ),
                                    const SizedBox(height: 22),
                                    const SizedBox(
                                      width: 34,
                                      height: 34,
                                      child: CircularProgressIndicator(
                                        strokeWidth: 3,
                                        color: Color(0xFF137A50),
                                        backgroundColor: Color(0xFFD9EADF),
                                      ),
                                    ),
                                    const SizedBox(height: 20),
                                    Text(
                                      'Processing your transaction',
                                      textAlign: TextAlign.center,
                                      style: Theme.of(context)
                                          .textTheme
                                          .titleLarge
                                          ?.copyWith(
                                            color: const Color(0xFF163B2D),
                                            fontWeight: FontWeight.w800,
                                            height: 1.2,
                                          ),
                                    ),
                                    const SizedBox(height: 10),
                                    const Text(
                                      'Please wait while we process your transaction...',
                                      textAlign: TextAlign.center,
                                      style: TextStyle(
                                        color: Color(0xFF52685D),
                                        height: 1.5,
                                      ),
                                    ),
                                    const SizedBox(height: 12),
                                    const Text(
                                      'Please do not close the app.',
                                      textAlign: TextAlign.center,
                                      style: TextStyle(
                                        color: Color(0xFF254C3B),
                                        fontWeight: FontWeight.w700,
                                        height: 1.4,
                                      ),
                                    ),
                                    if (requestId?.isNotEmpty == true) ...[
                                      const SizedBox(height: 18),
                                      Container(
                                        width: double.infinity,
                                        padding: const EdgeInsets.symmetric(
                                          horizontal: 14,
                                          vertical: 10,
                                        ),
                                        decoration: BoxDecoration(
                                          color: const Color(0xFFEDF5F0),
                                          borderRadius:
                                              BorderRadius.circular(14),
                                        ),
                                        child: Text(
                                          'Request ID: $requestId',
                                          textAlign: TextAlign.center,
                                          style: const TextStyle(
                                            color: Color(0xFF365B49),
                                            fontSize: 12,
                                            fontWeight: FontWeight.w600,
                                          ),
                                        ),
                                      ),
                                    ],
                                  ],
                                ),
                              ),
                            ),
                          ),
                        ),
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ],
        ),
      );
    }

    if (pending && nonBlocking) {
      return Stack(
        children: [
          child,
          Positioned(
            top: 8,
            left: 12,
            right: 12,
            child: IgnorePointer(
              child: SafeArea(
                bottom: false,
                child: Semantics(
                  liveRegion: true,
                  label: 'Purchase status processing. Check History for updates.',
                  child: Material(
                    elevation: 4,
                    color: Theme.of(context).colorScheme.surface,
                    borderRadius: BorderRadius.circular(14),
                    child: Padding(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 16,
                        vertical: 12,
                      ),
                      child: Row(
                        children: [
                          const Icon(Icons.pending_actions_rounded),
                          const SizedBox(width: 12),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                const Text(
                                  'PROCESSING — check History for updates.',
                                ),
                                const Text(
                                  'Your request key is saved. Do not submit again.',
                                ),
                                if (requestId?.isNotEmpty == true)
                                  Text(
                                    'Request ID: $requestId',
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                  ),
                              ],
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ),
        ],
      );
    }

    return PopScope(
      canPop: true,
      child: Stack(
        children: [child],
      ),
    );
  }
}

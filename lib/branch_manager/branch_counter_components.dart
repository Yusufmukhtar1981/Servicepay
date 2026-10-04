part of 'branch_counter_screen.dart';

class _CounterHeading extends StatelessWidget {
  const _CounterHeading({required this.config, required this.wide});
  final Map<String, dynamic> config;
  final bool wide;

  @override
  Widget build(BuildContext context) {
    final Map<String, dynamic> branch = _map(config['branch']);
    return Container(
      padding: EdgeInsets.all(wide ? 26 : 20),
      decoration: BoxDecoration(
        color: _forest,
        borderRadius: BorderRadius.circular(22),
      ),
      child: Row(
        children: <Widget>[
          Container(
            width: 48,
            height: 48,
            decoration: BoxDecoration(
                color: Colors.white.withValues(alpha: .12),
                borderRadius: BorderRadius.circular(15)),
            child: const Icon(Icons.local_shipping_outlined,
                color: Colors.white, size: 25),
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Text('${branch['name'] ?? 'Branch counter'}',
                    style: const TextStyle(
                        color: Colors.white,
                        fontSize: 19,
                        fontWeight: FontWeight.w900)),
                const SizedBox(height: 3),
                Text(
                    '${branch['lga'] ?? ''}${branch['lga'] == null ? '' : ', '}${branch['state'] ?? 'Delivery desk'}',
                    style: const TextStyle(
                        color: Color(0xffc8ded3), fontSize: 12)),
              ],
            ),
          ),
          if (wide)
            const Text('BRANCH COUNTER',
                style: TextStyle(
                    color: Color(0xffc8ded3),
                    fontSize: 10,
                    letterSpacing: 1.3,
                    fontWeight: FontWeight.w800)),
        ],
      ),
    );
  }
}

class _StatsGrid extends StatelessWidget {
  const _StatsGrid({required this.stats, required this.width});
  final Map<String, dynamic> stats;
  final double width;

  @override
  Widget build(BuildContext context) {
    final List<(String, String, IconData)> values =
        <(String, String, IconData)>[
      ('Today’s parcels', '${stats['todayOrders'] ?? 0}', Icons.inventory_2_outlined),
      ('Collected', '₦${_money(stats['todayRevenue'] ?? 0)}', Icons.payments_outlined),
      ('Awaiting pickup', '${stats['pendingPickup'] ?? 0}', Icons.pending_actions_outlined),
      ('In transit', '${stats['inTransit'] ?? 0}', Icons.route_outlined),
    ];
    return GridView.count(
      crossAxisCount: width >= 900 ? 4 : 2,
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      crossAxisSpacing: 10,
      mainAxisSpacing: 10,
      childAspectRatio: width >= 900 ? 2.1 : 1.25,
      children: values
          .map((value) => Container(
                padding: const EdgeInsets.all(14),
                decoration: BoxDecoration(
                    color: Colors.white,
                    borderRadius: BorderRadius.circular(16),
                    border: Border.all(color: const Color(0xffe1e9e3))),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: <Widget>[
                    Icon(value.$3, color: _green, size: 19),
                    Text(value.$2,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                            color: _ink,
                            fontSize: 19,
                            fontWeight: FontWeight.w900)),
                    Text(value.$1,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                            color: Color(0xff718177), fontSize: 10)),
                  ],
                ),
              ))
          .toList(),
    );
  }
}

class _OrderTile extends StatelessWidget {
  const _OrderTile({required this.order, required this.onTap});
  final Map<String, dynamic> order;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final Map<String, dynamic> sender = _map(order['sender']);
    final Map<String, dynamic> receiver = _map(order['receiver']);
    return Material(
      color: Colors.white,
      borderRadius: BorderRadius.circular(16),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(16),
        child: Container(
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: const Color(0xffe1e9e3))),
          child: Row(
            children: <Widget>[
              Container(
                width: 42,
                height: 42,
                decoration: BoxDecoration(
                    color: const Color(0xffe9f4ed),
                    borderRadius: BorderRadius.circular(13)),
                child: const Icon(Icons.inventory_2_outlined, color: _green),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: <Widget>[
                      Text('${order['trackingNumber'] ?? 'Tracking pending'}',
                          style: const TextStyle(
                              color: _ink,
                              fontSize: 13,
                              fontWeight: FontWeight.w900)),
                      const SizedBox(height: 4),
                      Text(
                          '${sender['name'] ?? 'Sender'} → ${receiver['name'] ?? 'Receiver'}',
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                              color: Color(0xff65776d), fontSize: 11)),
                      const SizedBox(height: 6),
                      Wrap(spacing: 6, children: <Widget>[
                        _StatusPill('${order['status'] ?? 'PENDING'}'),
                        _PaymentPill(
                            '${order['paymentStatus'] ?? 'UNPAID'}'),
                      ]),
                    ]),
              ),
              const SizedBox(width: 8),
              Column(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: <Widget>[
                  Text('₦${_money(order['total'])}',
                      style: const TextStyle(
                          color: _ink,
                          fontSize: 13,
                          fontWeight: FontWeight.w900)),
                  const SizedBox(height: 5),
                  const Icon(Icons.chevron_right_rounded,
                      color: Color(0xff8a9b91)),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _StatusPill extends StatelessWidget {
  const _StatusPill(this.value);
  final String value;

  @override
  Widget build(BuildContext context) {
    final Color color = value.toUpperCase() == 'DELIVERED'
        ? const Color(0xff2b7250)
        : value.toUpperCase() == 'CANCELLED'
            ? const Color(0xffa33d31)
            : const Color(0xff9b6a19);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
          color: color.withValues(alpha: .1),
          borderRadius: BorderRadius.circular(20)),
      child: Text(_human(value),
          style: TextStyle(
              color: color, fontSize: 9, fontWeight: FontWeight.w800)),
    );
  }
}

class _PaymentPill extends StatelessWidget {
  const _PaymentPill(this.value);
  final String value;

  @override
  Widget build(BuildContext context) {
    final bool paid = value.toUpperCase() == 'PAID';
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
          color: (paid ? _green : const Color(0xff687a70))
              .withValues(alpha: .09),
          borderRadius: BorderRadius.circular(20)),
      child: Text(value.toUpperCase(),
          style: TextStyle(
              color: paid ? _green : const Color(0xff687a70),
              fontSize: 9,
              fontWeight: FontWeight.w800)),
    );
  }
}

class _Notice extends StatelessWidget {
  const _Notice({required this.icon, required this.text});
  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) => Container(
        width: double.infinity,
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
            color: const Color(0xffeef5ef),
            borderRadius: BorderRadius.circular(12)),
        child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Icon(icon, size: 18, color: _green),
          const SizedBox(width: 9),
          Expanded(
              child: Text(text,
                  style: const TextStyle(
                      color: Color(0xff4c6458), fontSize: 11, height: 1.45))),
        ]),
      );
}

class _Panel extends StatelessWidget {
  const _Panel({required this.title, required this.subtitle, required this.child});
  final String title;
  final String subtitle;
  final Widget child;

  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(18),
            border: Border.all(color: const Color(0xffe1e9e3))),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(title,
              style: const TextStyle(
                  color: _ink, fontSize: 15, fontWeight: FontWeight.w900)),
          const SizedBox(height: 3),
          Text(subtitle,
              style: const TextStyle(
                  color: Color(0xff718177), fontSize: 11, height: 1.4)),
          const SizedBox(height: 14),
          child,
        ]),
      );
}

class _InlineError extends StatelessWidget {
  const _InlineError(this.message);
  final String message;
  @override
  Widget build(BuildContext context) => Container(
        margin: const EdgeInsets.only(bottom: 12),
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
            color: const Color(0xffffefec),
            borderRadius: BorderRadius.circular(12)),
        child: Row(children: [
          const Icon(Icons.error_outline, color: Color(0xffa33d31)),
          const SizedBox(width: 8),
          Expanded(
              child: Text(message,
                  style: const TextStyle(
                      color: Color(0xff85372e), fontSize: 12))),
        ]),
      );
}

class _CounterEmpty extends StatelessWidget {
  const _CounterEmpty({required this.onCreate});
  final VoidCallback onCreate;
  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.all(28),
        decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(18),
            border: Border.all(color: const Color(0xffe1e9e3))),
        child: Column(children: <Widget>[
          const Icon(Icons.local_shipping_outlined, size: 36, color: _green),
          const SizedBox(height: 9),
          const Text('The counter is clear',
              style: TextStyle(fontWeight: FontWeight.w900, color: _ink)),
          const SizedBox(height: 5),
          const Text('New parcels registered here will appear in this queue.',
              textAlign: TextAlign.center,
              style: TextStyle(color: Color(0xff718177), fontSize: 12)),
          const SizedBox(height: 12),
          OutlinedButton.icon(
              onPressed: onCreate,
              icon: const Icon(Icons.add_rounded),
              label: const Text('Register a parcel')),
        ]),
      );
}

class _CounterSkeleton extends StatelessWidget {
  const _CounterSkeleton();
  @override
  Widget build(BuildContext context) => ListView(
        padding: const EdgeInsets.all(18),
        children: List<Widget>.generate(
            6,
            (int index) => Container(
                  height: index == 0 ? 112 : 74,
                  margin: const EdgeInsets.only(bottom: 12),
                  decoration: BoxDecoration(
                      color: const Color(0xffe7ede8),
                      borderRadius: BorderRadius.circular(16)),
                )),
      );
}

class _CounterError extends StatelessWidget {
  const _CounterError({required this.message, required this.retry});
  final String message;
  final VoidCallback retry;
  @override
  Widget build(BuildContext context) => Center(
        child: Padding(
          padding: const EdgeInsets.all(28),
          child: Column(mainAxisSize: MainAxisSize.min, children: <Widget>[
            const Icon(Icons.cloud_off_outlined,
                size: 36, color: Color(0xffa0473d)),
            const SizedBox(height: 10),
            const Text('Could not load branch orders',
                style: TextStyle(fontWeight: FontWeight.w900)),
            const SizedBox(height: 7),
            Text(message, textAlign: TextAlign.center),
            const SizedBox(height: 12),
            FilledButton.icon(
                onPressed: retry,
                icon: const Icon(Icons.refresh_rounded),
                label: const Text('Try again')),
          ]),
        ),
      );
}

class _DetailLine extends StatelessWidget {
  const _DetailLine(this.label, this.value);
  final String label;
  final String value;
  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 6),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Expanded(
                child: Text(label,
                    style: const TextStyle(
                        color: Color(0xff718177), fontSize: 12))),
            const SizedBox(width: 12),
            Flexible(
                child: Text(value,
                    textAlign: TextAlign.right,
                    style: const TextStyle(
                        color: _ink,
                        fontSize: 12,
                        fontWeight: FontWeight.w700))),
          ],
        ),
      );
}

class _TrackingBlock extends StatelessWidget {
  const _TrackingBlock({required this.tracking, required this.receipt});
  final String tracking;
  final String receipt;
  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.all(18),
        decoration: BoxDecoration(
            color: _forest, borderRadius: BorderRadius.circular(18)),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          const Text('TRACKING NUMBER',
              style: TextStyle(
                  color: Color(0xffc8ded3),
                  fontSize: 10,
                  letterSpacing: 1.2,
                  fontWeight: FontWeight.w800)),
          const SizedBox(height: 5),
          SelectableText(tracking,
              style: const TextStyle(
                  color: Colors.white,
                  fontSize: 20,
                  fontWeight: FontWeight.w900)),
          const SizedBox(height: 4),
          Text('Receipt  $receipt',
              style: const TextStyle(color: Color(0xffc8ded3), fontSize: 11)),
        ]),
      );
}

List<Widget> _chargeDetails(dynamic charges) {
  if (charges is num) {
    return <Widget>[_DetailLine('Charges', '₦${_money(charges)}')];
  }
  if (charges is Map) {
    return charges.entries
        .map((MapEntry<dynamic, dynamic> entry) => _DetailLine(
              _human('${entry.key}'),
              '₦${_money(entry.value is Map
                  ? _map(entry.value)['amount']
                  : entry.value)}',
            ))
        .toList();
  }
  if (charges is List) {
    return charges.map((dynamic item) {
      if (item is Map) {
        final Map<String, dynamic> charge = _map(item);
        return _DetailLine(
          '${charge['name'] ?? 'Charge'}',
          '₦${_money(charge['amount'] ?? charge['total'] ?? 0)}',
        );
      }
      return _DetailLine('Charge', '₦${_money(item)}');
    }).toList();
  }
  return <Widget>[];
}
import 'package:flutter/material.dart';

class AdminTransactionCard extends StatelessWidget {
  const AdminTransactionCard({
    super.key,
    required this.contextData,
    required this.dateLabel,
  });

  final Map<String, dynamic> contextData;
  final String Function(dynamic value) dateLabel;

  @override
  Widget build(BuildContext context) {
    final reference = '${contextData['reference'] ?? ''}'.trim();
    final amount = contextData['amount'];
    final status = '${contextData['status'] ?? 'Unavailable'}';
    final occurredAt = contextData['occurredAt'];
    return Card(
      color: Colors.grey.shade100,
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'Related transaction',
              style: TextStyle(fontWeight: FontWeight.w800),
            ),
            Text('Reference: ${reference.isEmpty ? 'Unavailable' : reference}'),
            Text('Type: ${contextData['transactionType'] ?? 'Unavailable'}'),
            Text('Amount: NGN ${amount ?? 'Unavailable'}'),
            Text('Status: $status'),
            if (occurredAt != null) Text('Occurred: ${dateLabel(occurredAt)}'),
          ],
        ),
      ),
    );
  }
}

class AdminTicketTimeline extends StatelessWidget {
  const AdminTicketTimeline({
    super.key,
    required this.events,
    required this.currentStatus,
    required this.updatedAt,
  });
  final List<Map<String, dynamic>> events;
  final String currentStatus;
  final dynamic updatedAt;

  @override
  Widget build(BuildContext context) {
    final actualEvents = events.isEmpty
        ? <Map<String, dynamic>>[
            <String, dynamic>{
              'status': currentStatus,
              'createdAt': updatedAt,
              'actorRole': 'LEGACY',
            },
          ]
        : events;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'Status timeline',
            style: TextStyle(fontWeight: FontWeight.w800),
          ),
          const SizedBox(height: 8),
          ...actualEvents.map((event) {
            final raw = '${event['status'] ?? currentStatus}';
            final label = raw == 'IN_PROGRESS' || raw == 'IN_REVIEW'
                ? 'IN REVIEW'
                : raw == 'WAITING_ON_CUSTOMER'
                ? 'AWAITING CUSTOMER'
                : raw.replaceAll('_', ' ');
            final date = DateTime.tryParse(
              '${event['createdAt'] ?? ''}',
            )?.toLocal();
            final when = date == null
                ? 'Timestamp unavailable'
                : '${date.day.toString().padLeft(2, '0')}/${date.month.toString().padLeft(2, '0')}/${date.year} • ${date.hour.toString().padLeft(2, '0')}:${date.minute.toString().padLeft(2, '0')}';
            final actor = '${event['actorName'] ?? ''}'.trim();
            final role = '${event['actorRole'] ?? 'SUPPORT'}';
            return ListTile(
              dense: true,
              contentPadding: EdgeInsets.zero,
              leading: const Icon(Icons.check_circle, color: Colors.green),
              title: Text(label),
              subtitle: Text(
                '$when • ${actor.isEmpty ? role : '$actor ($role)'}',
              ),
            );
          }),
        ],
      ),
    );
  }
}

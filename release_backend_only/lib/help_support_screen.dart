import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';
import 'support_tickets_screen.dart';
import 'services/support_api_service.dart';
import 'servicepay_theme.dart';

class HelpSupportScreen extends StatelessWidget {
  const HelpSupportScreen({super.key});

  static const Color primaryGreen = ServicePayColors.brand;
  static const Color backgroundColor = ServicePayColors.canvas;

  static const String supportPhone = '09136151515';
  static const String whatsappPhone = '2349136151515';
  static const String supportEmail = 'admin@servicepay.ng';
  static const Map<String, String> supportCategories = {
    'TRANSACTION': 'Transaction Issues',
    'TRANSFER': 'Transfer Issues',
    'WITHDRAWAL': 'Withdrawal Issues',
    'AIRTIME_DATA': 'Airtime & Data',
    'BILLS': 'Electricity / Bills',
    'ACCOUNT_KYC': 'Account & KYC',
    'TRANSACTION_PIN': 'Transaction PIN',
    'LOGIN_SECURITY': 'Login & Security',
    'DELIVERY': 'Delivery',
    'MARKETPLACE': 'Marketplace',
    'SOLAR': 'ServicePay Solar',
    'EMPOWERMENT': 'Empowerment',
    'OTHER': 'Other Issues',
  };

  Future<void> _openLink(
    BuildContext context,
    Uri uri,
  ) async {
    try {
      final opened = await launchUrl(
        uri,
        mode: LaunchMode.externalApplication,
      );

      if (!opened && context.mounted) {
        _showError(context);
      }
    } catch (_) {
      if (context.mounted) {
        _showError(context);
      }
    }
  }

  void _showError(BuildContext context) {
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(
        const SnackBar(
          content: Text(
            'Unable to open this service.',
          ),
          backgroundColor: Colors.red,
          behavior: SnackBarBehavior.floating,
        ),
      );
  }

  Future<void> _openWhatsApp(
    BuildContext context,
  ) async {
    final message = Uri.encodeComponent(
      'Hello ServicePay Support, I need assistance.',
    );

    await _openLink(
      context,
      Uri.parse(
        'https://wa.me/$whatsappPhone?text=$message',
      ),
    );
  }

  Future<void> _callSupport(
    BuildContext context,
  ) async {
    await _openLink(
      context,
      Uri.parse('tel:$supportPhone'),
    );
  }

  Future<void> _emailSupport(
    BuildContext context,
  ) async {
    await _openLink(
      context,
      Uri(
        scheme: 'mailto',
        path: supportEmail,
        queryParameters: {
          'subject': 'ServicePay Support Request',
          'body':
              'Hello ServicePay Support,\n\nPlease describe your issue below:\n\n',
        },
      ),
    );
  }

  Future<void> _reportProblem(BuildContext context,
      {String category = 'OTHER'}) async {
    await Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => SupportRequestScreen(initialCategory: category),
      ),
    );
  }

  void _openTerms(
    BuildContext context,
  ) {
    Navigator.push(
      context,
      MaterialPageRoute(
        builder: (_) => const LegalInformationScreen(
          title: 'Terms of Service',
          icon: Icons.description_outlined,
          sections: [
            LegalSection(
              title: 'Using ServicePay',
              content:
                  'You must provide accurate information and keep your login details secure. You are responsible for activities performed through your account.',
            ),
            LegalSection(
              title: 'Payments and Transactions',
              content:
                  'Before confirming a payment, verify the recipient, service, phone number and amount. Some completed transactions may not be reversible.',
            ),
            LegalSection(
              title: 'Wallet Funding',
              content:
                  'Only transfer to the virtual account displayed inside your ServicePay Wallet. Confirm the account details before sending money.',
            ),
            LegalSection(
              title: 'Prohibited Activities',
              content:
                  'ServicePay must not be used for fraud, money laundering, impersonation or unlawful transactions.',
            ),
            LegalSection(
              title: 'Service Availability',
              content:
                  'Some services may depend on third-party providers, network availability and maintenance.',
            ),
          ],
        ),
      ),
    );
  }

  void _openPrivacy(
    BuildContext context,
  ) {
    Navigator.push(
      context,
      MaterialPageRoute(
        builder: (_) => const LegalInformationScreen(
          title: 'Privacy Policy',
          icon: Icons.privacy_tip_outlined,
          sections: [
            LegalSection(
              title: 'Information We Collect',
              content:
                  'ServicePay may collect your name, phone number, email address, account information and transaction records.',
            ),
            LegalSection(
              title: 'How Information Is Used',
              content:
                  'Your information is used to manage your account, process services, prevent fraud and provide support.',
            ),
            LegalSection(
              title: 'Identity Verification',
              content:
                  'Identity information is processed for verification, compliance and account-security purposes.',
            ),
            LegalSection(
              title: 'Information Sharing',
              content:
                  'Information may be shared with authorised service providers when required to complete a service or comply with the law.',
            ),
            LegalSection(
              title: 'Account Security',
              content:
                  'Never share your password, verification code or authentication details with another person.',
            ),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: backgroundColor,
      appBar: AppBar(
        backgroundColor: primaryGreen,
        foregroundColor: Colors.white,
        title: const Text(
          'Help & Support',
          style: TextStyle(
            fontWeight: FontWeight.bold,
          ),
        ),
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(
          16,
          18,
          16,
          35,
        ),
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(
              maxWidth: 750,
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                SupportHeader(
                  onWhatsApp: () {
                    _openWhatsApp(context);
                  },
                ),
                const SizedBox(height: 24),
                const SectionTitle(title: 'Choose an issue'),
                const SizedBox(height: 12),
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: supportCategories.entries
                      .map(
                        (entry) => ActionChip(
                          avatar: const Icon(Icons.support_agent_outlined,
                              size: 17),
                          label: Text(entry.value),
                          onPressed: () =>
                              _reportProblem(context, category: entry.key),
                        ),
                      )
                      .toList(),
                ),
                const SizedBox(height: 24),
                const SectionTitle(
                  title: 'Contact Support',
                ),
                const SizedBox(height: 12),
                SupportActionCard(
                  icon: Icons.chat_bubble_outline_rounded,
                  title: 'WhatsApp Support',
                  subtitle: 'Chat with ServicePay support on WhatsApp.',
                  iconColor: const Color(0xFF16A34A),
                  iconBackground: const Color(0xFFDCFCE7),
                  onTap: () {
                    _openWhatsApp(context);
                  },
                ),
                SupportActionCard(
                  icon: Icons.call_outlined,
                  title: 'Call Support',
                  subtitle: 'Call $supportPhone for assistance.',
                  iconColor: const Color(0xFF2563EB),
                  iconBackground: const Color(0xFFDBEAFE),
                  onTap: () {
                    _callSupport(context);
                  },
                ),
                SupportActionCard(
                  icon: Icons.email_outlined,
                  title: 'Email Support',
                  subtitle: supportEmail,
                  iconColor: const Color(0xFF7C3AED),
                  iconBackground: const Color(0xFFEDE9FE),
                  onTap: () {
                    _emailSupport(context);
                  },
                ),
                SupportActionCard(
                  icon: Icons.report_problem_outlined,
                  title: 'Report a Problem',
                  subtitle:
                      'Send details about a failed service or account issue.',
                  iconColor: const Color(0xFFDC2626),
                  iconBackground: const Color(0xFFFEE2E2),
                  onTap: () {
                    _reportProblem(context);
                  },
                ),
                SupportActionCard(
                  icon: Icons.confirmation_number_outlined,
                  title: 'My Support Tickets',
                  subtitle: 'Track problem reports and reply to support.',
                  iconColor: const Color(0xFF0F766E),
                  iconBackground: const Color(0xFFCCFBF1),
                  onTap: () => Navigator.push(
                      context,
                      MaterialPageRoute(
                          builder: (_) => const SupportTicketsScreen())),
                ),
                const SizedBox(height: 24),
                const SectionTitle(
                  title: 'Frequently Asked Questions',
                ),
                const SizedBox(height: 12),
                const FaqSection(),
                const SizedBox(height: 20),
                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.all(16),
                  decoration: BoxDecoration(
                    color: const Color(0xFFFFF7ED),
                    borderRadius: BorderRadius.circular(16),
                    border: Border.all(color: const Color(0xFFFED7AA)),
                  ),
                  child: const Text(
                    'ServicePay Support will never ask for your password, OTP or transaction PIN.',
                    style: TextStyle(
                      color: Color(0xFF9A3412),
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
                const SizedBox(height: 24),
                const SectionTitle(
                  title: 'Legal & Privacy',
                ),
                const SizedBox(height: 12),
                SupportActionCard(
                  icon: Icons.description_outlined,
                  title: 'Terms of Service',
                  subtitle: 'Read the conditions for using ServicePay.',
                  iconColor: const Color(0xFFD97706),
                  iconBackground: const Color(0xFFFEF3C7),
                  onTap: () {
                    _openTerms(context);
                  },
                ),
                SupportActionCard(
                  icon: Icons.privacy_tip_outlined,
                  title: 'Privacy Policy',
                  subtitle: 'Learn how ServicePay handles your information.',
                  iconColor: const Color(0xFF0F766E),
                  iconBackground: const Color(0xFFCCFBF1),
                  onTap: () {
                    _openPrivacy(context);
                  },
                ),
                SupportActionCard(
                  icon: Icons.delete_outline,
                  title: 'Delete Account or Request Data',
                  subtitle: 'Submit a secure account or data request.',
                  iconColor: const Color(0xFFB42318),
                  iconBackground: const Color(0xFFFEE4E2),
                  onTap: () => launchUrl(
                    Uri.parse('https://servicepay.ng/delete-account'),
                    mode: LaunchMode.externalApplication,
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class SupportHeader extends StatelessWidget {
  final VoidCallback onWhatsApp;

  const SupportHeader({
    super.key,
    required this.onWhatsApp,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(22),
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          colors: [
            Color(0xFF2E7D32),
            Color(0xFF43A047),
          ],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        borderRadius: BorderRadius.circular(24),
      ),
      child: Column(
        children: [
          Container(
            width: 72,
            height: 72,
            decoration: BoxDecoration(
              color: Colors.white.withValues(
                alpha: 0.18,
              ),
              shape: BoxShape.circle,
            ),
            child: const Icon(
              Icons.support_agent_rounded,
              color: Colors.white,
              size: 38,
            ),
          ),
          const SizedBox(height: 16),
          const Text(
            'How can we help?',
            style: TextStyle(
              color: Colors.white,
              fontSize: 23,
              fontWeight: FontWeight.w900,
            ),
          ),
          const SizedBox(height: 8),
          const Text(
            'Get assistance with your account, wallet, payments and ServicePay services.',
            textAlign: TextAlign.center,
            style: TextStyle(
              color: Colors.white70,
              fontSize: 14,
              height: 1.5,
            ),
          ),
          const SizedBox(height: 18),
          FilledButton.icon(
            onPressed: onWhatsApp,
            icon: const Icon(
              Icons.chat_rounded,
            ),
            label: const Text(
              'Chat With Support',
            ),
            style: FilledButton.styleFrom(
              backgroundColor: Colors.white,
              foregroundColor: HelpSupportScreen.primaryGreen,
            ),
          ),
        ],
      ),
    );
  }
}

class SectionTitle extends StatelessWidget {
  final String title;

  const SectionTitle({
    super.key,
    required this.title,
  });

  @override
  Widget build(BuildContext context) {
    return Text(
      title,
      style: const TextStyle(
        color: Color(0xFF0F172A),
        fontSize: 19,
        fontWeight: FontWeight.w800,
      ),
    );
  }
}

class SupportActionCard extends StatelessWidget {
  final IconData icon;
  final String title;
  final String subtitle;
  final Color iconColor;
  final Color iconBackground;
  final VoidCallback onTap;

  const SupportActionCard({
    super.key,
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.iconColor,
    required this.iconBackground,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return Card(
      margin: const EdgeInsets.only(
        bottom: 11,
      ),
      elevation: 0,
      color: Colors.white,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(18),
        side: const BorderSide(
          color: Color(0xFFE8EDF3),
        ),
      ),
      child: ListTile(
        contentPadding: const EdgeInsets.symmetric(
          horizontal: 15,
          vertical: 8,
        ),
        leading: Container(
          width: 48,
          height: 48,
          decoration: BoxDecoration(
            color: iconBackground,
            borderRadius: BorderRadius.circular(15),
          ),
          child: Icon(
            icon,
            color: iconColor,
          ),
        ),
        title: Text(
          title,
          style: const TextStyle(
            fontWeight: FontWeight.w800,
          ),
        ),
        subtitle: Text(
          subtitle,
          style: const TextStyle(
            color: Color(0xFF64748B),
            fontSize: 12,
          ),
        ),
        trailing: const Icon(
          Icons.arrow_forward_ios_rounded,
          size: 15,
        ),
        onTap: onTap,
      ),
    );
  }
}

class FaqSection extends StatefulWidget {
  const FaqSection({super.key});

  static const List<Map<String, String>> faqs = [
    {
      'question': 'How do I fund my wallet?',
      'answer':
          'Open Wallet and transfer to the virtual account shown there. Confirm the account name, number and bank before sending money.',
    },
    {
      'question': 'Why is my wallet balance not updated?',
      'answer':
          'Refresh the Wallet page. If a virtual-account transfer is still missing, contact Support with the transaction reference.',
    },
    {
      'question': 'Can I transfer to another ServicePay user?',
      'answer':
          'Yes. Open Transfer, enter the registered phone number, confirm the amount and submit.',
    },
    {
      'question': 'What should I do if a transaction fails?',
      'answer':
          'Check your wallet balance and internet connection. If money was deducted, contact support with the transaction reference.',
    },
    {
      'question': 'How do I verify my identity?',
      'answer':
          'Open Verify ID, select the identity type, provide the required information and submit.',
    },
    {
      'question': 'How do I keep my account secure?',
      'answer':
          'Never share your password, login code or verification details with another person.',
    },
    {
      'question': 'How do I reset my transaction PIN?',
      'answer':
          'Open Profile and use Change Transaction PIN or Forgot/Reset PIN. ServicePay Support will never ask you to disclose your PIN.',
    },
    {
      'question': 'What should I do about a pending transaction?',
      'answer':
          'Open the transaction details and use Check transaction status when it is available. If the status remains unclear, report the issue with the transaction reference.',
    },
    {
      'question': 'How do I track a delivery?',
      'answer':
          'Open Delivery and use the tracking details shown for your active request or order.',
    },
    {
      'question': 'Where can I see Marketplace orders?',
      'answer':
          'Open Marketplace and select My Orders to review your order and delivery status.',
    },
    {
      'question': 'Where can I review solar financing?',
      'answer':
          'Open ServicePay Solar to review available plans and the status of your application.',
    },
  ];

  @override
  State<FaqSection> createState() => _FaqSectionState();
}

class _FaqSectionState extends State<FaqSection> {
  String query = '';

  @override
  Widget build(BuildContext context) {
    final faqs = FaqSection.faqs
        .where((faq) =>
            query.isEmpty ||
            faq.values.any(
                (value) => value.toLowerCase().contains(query.toLowerCase())))
        .toList();
    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(
          color: const Color(0xFFE8EDF3),
        ),
      ),
      child: Column(
        children: [
          Padding(
            padding: const EdgeInsets.all(12),
            child: TextField(
              onChanged: (value) => setState(() => query = value.trim()),
              textInputAction: TextInputAction.search,
              decoration: const InputDecoration(
                hintText: 'Search FAQs',
                prefixIcon: Icon(Icons.search_rounded),
              ),
            ),
          ),
          if (faqs.isEmpty)
            const Padding(
              padding: EdgeInsets.all(20),
              child: Text('No FAQ matches your search.'),
            ),
          for (int index = 0; index < faqs.length; index++) ...[
            ExpansionTile(
              title: Text(
                faqs[index]['question']!,
                style: const TextStyle(
                  fontSize: 14,
                  fontWeight: FontWeight.w700,
                ),
              ),
              childrenPadding: const EdgeInsets.fromLTRB(
                16,
                0,
                16,
                16,
              ),
              children: [
                Align(
                  alignment: Alignment.centerLeft,
                  child: Text(
                    faqs[index]['answer']!,
                    style: const TextStyle(
                      color: Color(0xFF64748B),
                      fontSize: 13,
                      height: 1.5,
                    ),
                  ),
                ),
              ],
            ),
            if (index < faqs.length - 1) const Divider(height: 1),
          ],
        ],
      ),
    );
  }
}

class LegalSection {
  final String title;
  final String content;

  const LegalSection({
    required this.title,
    required this.content,
  });
}

class LegalInformationScreen extends StatelessWidget {
  final String title;
  final IconData icon;
  final List<LegalSection> sections;

  const LegalInformationScreen({
    super.key,
    required this.title,
    required this.icon,
    required this.sections,
  });

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: HelpSupportScreen.backgroundColor,
      appBar: AppBar(
        backgroundColor: HelpSupportScreen.primaryGreen,
        foregroundColor: Colors.white,
        title: Text(title),
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(18),
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(
              maxWidth: 750,
            ),
            child: Container(
              width: double.infinity,
              padding: const EdgeInsets.all(22),
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(22),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Icon(
                    icon,
                    color: HelpSupportScreen.primaryGreen,
                    size: 48,
                  ),
                  const SizedBox(height: 16),
                  Text(
                    title,
                    style: const TextStyle(
                      fontSize: 24,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                  const SizedBox(height: 20),
                  for (final section in sections) ...[
                    Text(
                      section.title,
                      style: const TextStyle(
                        fontSize: 16,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                    const SizedBox(height: 7),
                    Text(
                      section.content,
                      style: const TextStyle(
                        color: Color(0xFF64748B),
                        fontSize: 14,
                        height: 1.6,
                      ),
                    ),
                    const SizedBox(height: 20),
                  ],
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class SupportRequestScreen extends StatefulWidget {
  const SupportRequestScreen({
    super.key,
    this.initialCategory = 'OTHER',
    this.initialSubject = '',
    this.transactionLookupId,
    this.transactionSummary,
    this.idempotencyKey,
    this.onCreated,
  });
  final String initialCategory;
  final String initialSubject;
  final String? transactionLookupId;
  final String? transactionSummary;
  final String? idempotencyKey;
  final Future<void> Function(SupportTicket ticket)? onCreated;

  @override
  State<SupportRequestScreen> createState() => _SupportRequestScreenState();
}

class _SupportRequestScreenState extends State<SupportRequestScreen> {
  late final _subject = TextEditingController(text: widget.initialSubject);
  final _description = TextEditingController();
  final _api = SupportApiService();
  late final String _idempotencyKey = widget.idempotencyKey ??
      'support-${DateTime.now().microsecondsSinceEpoch}';
  late String _category =
      HelpSupportScreen.supportCategories.containsKey(widget.initialCategory)
          ? widget.initialCategory
          : 'OTHER';
  String _priority = 'NORMAL';
  bool _submitting = false;
  String _error = '';
  @override
  void dispose() {
    _subject.dispose();
    _description.dispose();
    _api.close();
    super.dispose();
  }

  Future<void> _submit() async {
    if (_subject.text.trim().isEmpty || _description.text.trim().isEmpty) {
      setState(() => _error = 'Enter the issue title and description.');
      return;
    }
    setState(() {
      _submitting = true;
      _error = '';
    });
    try {
      final ticket = await _api.createTicket(
          subject: _subject.text,
          description: _description.text,
          priority: _priority,
          category: _category,
          idempotencyKey: _idempotencyKey,
          transactionLookupId: widget.transactionLookupId);
      await widget.onCreated?.call(ticket);
      if (!mounted) return;
      await showDialog<void>(
          context: context,
          builder: (context) => AlertDialog(
                title: const Text('Problem reported'),
                content: Text(
                    'Your support ticket has been created.\nReference: ${ticket.reference}'),
                actions: [
                  FilledButton(
                      onPressed: () => Navigator.pop(context),
                      child: const Text('Done'))
                ],
              ));
      if (mounted) {
        Navigator.of(context).pushReplacement(
          MaterialPageRoute<void>(
            builder: (_) => SupportTicketDetailScreen(ticketId: ticket.id),
          ),
        );
      }
    } catch (e) {
      if (mounted) setState(() => _error = e.toString());
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        backgroundColor: HelpSupportScreen.backgroundColor,
        appBar: AppBar(
          backgroundColor: HelpSupportScreen.primaryGreen,
          foregroundColor: Colors.white,
          title: const Text('Report a Problem'),
        ),
        body: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 650),
            child: SingleChildScrollView(
              padding: const EdgeInsets.all(20),
              child: Card(
                  elevation: 0,
                  child: Padding(
                      padding: const EdgeInsets.all(20),
                      child: Column(mainAxisSize: MainAxisSize.min, children: [
                        if (_error.isNotEmpty)
                          Semantics(
                            liveRegion: true,
                            child: Container(
                              width: double.infinity,
                              margin: const EdgeInsets.only(bottom: 14),
                              padding: const EdgeInsets.all(12),
                              decoration: BoxDecoration(
                                color: const Color(0xFFFFF1F0),
                                borderRadius: BorderRadius.circular(12),
                                border: Border.all(
                                  color: const Color(0xFFFECACA),
                                ),
                              ),
                              child: Row(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  const Icon(
                                    Icons.error_outline_rounded,
                                    color: ServicePayColors.danger,
                                    size: 20,
                                  ),
                                  const SizedBox(width: 8),
                                  Expanded(
                                    child: Text(
                                      _error,
                                      style: const TextStyle(
                                        color: ServicePayColors.danger,
                                      ),
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          ),
                        DropdownButtonFormField<String>(
                            value: _category,
                            isExpanded: true,
                            decoration: const InputDecoration(
                                labelText: 'Issue category',
                                border: OutlineInputBorder()),
                            items: HelpSupportScreen.supportCategories.entries
                                .map((entry) => DropdownMenuItem(
                                      value: entry.key,
                                      child: Text(
                                        entry.value,
                                        maxLines: 1,
                                        overflow: TextOverflow.ellipsis,
                                      ),
                                    ))
                                .toList(),
                            onChanged: _submitting
                                ? null
                                : (value) =>
                                    setState(() => _category = value!)),
                        const SizedBox(height: 14),
                        TextField(
                            controller: _subject,
                            enabled: !_submitting,
                            textCapitalization: TextCapitalization.sentences,
                            textInputAction: TextInputAction.next,
                            decoration: const InputDecoration(
                                labelText: 'Issue title')),
                        const SizedBox(height: 14),
                        TextField(
                            controller: _description,
                            enabled: !_submitting,
                            minLines: 4,
                            maxLines: 6,
                            textCapitalization: TextCapitalization.sentences,
                            keyboardType: TextInputType.multiline,
                            decoration: const InputDecoration(
                                labelText: 'Description',
                                hintText:
                                    'Include what happened and when it happened.',
                                alignLabelWithHint: true)),
                        const SizedBox(height: 14),
                        if ((widget.transactionSummary ?? '').isNotEmpty)
                          Container(
                            width: double.infinity,
                            padding: const EdgeInsets.all(12),
                            margin: const EdgeInsets.only(bottom: 14),
                            decoration: BoxDecoration(
                              color: const Color(0xFFEFF6FF),
                              borderRadius: BorderRadius.circular(12),
                            ),
                            child: Text(widget.transactionSummary!),
                          ),
                        DropdownButtonFormField<String>(
                            value: _priority,
                            isExpanded: true,
                            decoration: const InputDecoration(
                                labelText: 'Priority',
                                border: OutlineInputBorder()),
                            items: const [
                              DropdownMenuItem(
                                  value: 'LOW', child: Text('Low')),
                              DropdownMenuItem(
                                  value: 'NORMAL', child: Text('Normal')),
                              DropdownMenuItem(
                                  value: 'HIGH', child: Text('High')),
                              DropdownMenuItem(
                                  value: 'URGENT', child: Text('Urgent')),
                            ],
                            onChanged: _submitting
                                ? null
                                : (value) =>
                                    setState(() => _priority = value!)),
                        const SizedBox(height: 18),
                        const Text(
                          'ServicePay Support will never ask for your password, OTP or transaction PIN.',
                          style:
                              TextStyle(color: Color(0xFF9A3412), fontSize: 12),
                        ),
                        const SizedBox(height: 18),
                        SizedBox(
                          width: double.infinity,
                          child: FilledButton.icon(
                              onPressed: _submitting ? null : _submit,
                              icon: _submitting
                                  ? const SizedBox(
                                      width: 16,
                                      height: 16,
                                      child: CircularProgressIndicator(
                                          strokeWidth: 2))
                                  : const Icon(Icons.send_rounded),
                              label: const Text('Submit ticket')),
                        ),
                      ]))),
            ),
          ),
        ),
      );
}

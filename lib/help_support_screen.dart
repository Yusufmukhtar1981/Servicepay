import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

class HelpSupportScreen extends StatelessWidget {
  const HelpSupportScreen({super.key});

  static const Color primaryGreen = Color(0xFF2E7D32);
  static const Color backgroundColor = Color(0xFFF8FAFC);

  static const String supportPhone = '08033671266';
  static const String whatsappPhone = '2348033671266';
  static const String supportEmail = 'admin@servicepay.ng';

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
      'Hello Servicepay Support, I need assistance.',
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
          'subject': 'Servicepay Support Request',
          'body':
              'Hello Servicepay Support,\n\nPlease describe your issue below:\n\n',
        },
      ),
    );
  }

  Future<void> _reportProblem(
    BuildContext context,
  ) async {
    final subjectController =
        TextEditingController();

    final messageController =
        TextEditingController();

    final submitted = await showDialog<bool>(
      context: context,
      barrierDismissible: false,
      builder: (dialogContext) {
        return AlertDialog(
          title: const Text(
            'Report a Problem',
            style: TextStyle(
              fontWeight: FontWeight.bold,
            ),
          ),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(20),
          ),
          content: SizedBox(
            width: 450,
            child: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  TextField(
                    controller: subjectController,
                    decoration: InputDecoration(
                      labelText: 'Issue title',
                      hintText:
                          'Example: Wallet not updated',
                      border: OutlineInputBorder(
                        borderRadius:
                            BorderRadius.circular(14),
                      ),
                    ),
                  ),
                  const SizedBox(height: 14),
                  TextField(
                    controller: messageController,
                    minLines: 4,
                    maxLines: 6,
                    decoration: InputDecoration(
                      labelText: 'Description',
                      hintText:
                          'Explain the problem you experienced.',
                      alignLabelWithHint: true,
                      border: OutlineInputBorder(
                        borderRadius:
                            BorderRadius.circular(14),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
          actions: [
            TextButton(
              onPressed: () {
                Navigator.pop(
                  dialogContext,
                  false,
                );
              },
              child: const Text('Cancel'),
            ),
            FilledButton.icon(
              onPressed: () {
                if (subjectController.text
                        .trim()
                        .isEmpty ||
                    messageController.text
                        .trim()
                        .isEmpty) {
                  ScaffoldMessenger.of(
                    dialogContext,
                  ).showSnackBar(
                    const SnackBar(
                      content: Text(
                        'Enter the issue title and description.',
                      ),
                    ),
                  );
                  return;
                }

                Navigator.pop(
                  dialogContext,
                  true,
                );
              },
              icon: const Icon(
                Icons.send_rounded,
              ),
              label: const Text('Send'),
              style: FilledButton.styleFrom(
                backgroundColor: primaryGreen,
              ),
            ),
          ],
        );
      },
    );

    if (submitted != true) {
      subjectController.dispose();
      messageController.dispose();
      return;
    }

    final subject =
        subjectController.text.trim();

    final description =
        messageController.text.trim();

    subjectController.dispose();
    messageController.dispose();

    if (!context.mounted) return;

    await _openLink(
      context,
      Uri(
        scheme: 'mailto',
        path: supportEmail,
        queryParameters: {
          'subject':
              'Servicepay Problem Report: $subject',
          'body':
              'Hello Servicepay Support,\n\n'
                  'Issue: $subject\n\n'
                  'Description:\n$description\n\n'
                  'Please assist me with this issue.',
        },
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
              title: 'Using Servicepay',
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
                  'Manual funding requests are reviewed before a wallet is credited. Only transfer to the official account displayed inside Servicepay.',
            ),
            LegalSection(
              title: 'Prohibited Activities',
              content:
                  'Servicepay must not be used for fraud, money laundering, impersonation or unlawful transactions.',
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
                  'Servicepay may collect your name, phone number, email address, account information and transaction records.',
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
              crossAxisAlignment:
                  CrossAxisAlignment.start,
              children: [
                SupportHeader(
                  onWhatsApp: () {
                    _openWhatsApp(context);
                  },
                ),
                const SizedBox(height: 24),
                const SectionTitle(
                  title: 'Contact Support',
                ),
                const SizedBox(height: 12),
                SupportActionCard(
                  icon:
                      Icons.chat_bubble_outline_rounded,
                  title: 'WhatsApp Support',
                  subtitle:
                      'Chat with Servicepay support on WhatsApp.',
                  iconColor:
                      const Color(0xFF16A34A),
                  iconBackground:
                      const Color(0xFFDCFCE7),
                  onTap: () {
                    _openWhatsApp(context);
                  },
                ),
                SupportActionCard(
                  icon: Icons.call_outlined,
                  title: 'Call Support',
                  subtitle:
                      'Call $supportPhone for assistance.',
                  iconColor:
                      const Color(0xFF2563EB),
                  iconBackground:
                      const Color(0xFFDBEAFE),
                  onTap: () {
                    _callSupport(context);
                  },
                ),
                SupportActionCard(
                  icon: Icons.email_outlined,
                  title: 'Email Support',
                  subtitle: supportEmail,
                  iconColor:
                      const Color(0xFF7C3AED),
                  iconBackground:
                      const Color(0xFFEDE9FE),
                  onTap: () {
                    _emailSupport(context);
                  },
                ),
                SupportActionCard(
                  icon:
                      Icons.report_problem_outlined,
                  title: 'Report a Problem',
                  subtitle:
                      'Send details about a failed service or account issue.',
                  iconColor:
                      const Color(0xFFDC2626),
                  iconBackground:
                      const Color(0xFFFEE2E2),
                  onTap: () {
                    _reportProblem(context);
                  },
                ),
                const SizedBox(height: 24),
                const SectionTitle(
                  title:
                      'Frequently Asked Questions',
                ),
                const SizedBox(height: 12),
                const FaqSection(),
                const SizedBox(height: 24),
                const SectionTitle(
                  title: 'Legal & Privacy',
                ),
                const SizedBox(height: 12),
                SupportActionCard(
                  icon:
                      Icons.description_outlined,
                  title: 'Terms of Service',
                  subtitle:
                      'Read the conditions for using Servicepay.',
                  iconColor:
                      const Color(0xFFD97706),
                  iconBackground:
                      const Color(0xFFFEF3C7),
                  onTap: () {
                    _openTerms(context);
                  },
                ),
                SupportActionCard(
                  icon:
                      Icons.privacy_tip_outlined,
                  title: 'Privacy Policy',
                  subtitle:
                      'Learn how Servicepay handles your information.',
                  iconColor:
                      const Color(0xFF0F766E),
                  iconBackground:
                      const Color(0xFFCCFBF1),
                  onTap: () {
                    _openPrivacy(context);
                  },
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
            'Get assistance with your account, wallet, payments and Servicepay services.',
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
              foregroundColor:
                  HelpSupportScreen.primaryGreen,
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
        borderRadius:
            BorderRadius.circular(18),
        side: const BorderSide(
          color: Color(0xFFE8EDF3),
        ),
      ),
      child: ListTile(
        contentPadding:
            const EdgeInsets.symmetric(
          horizontal: 15,
          vertical: 8,
        ),
        leading: Container(
          width: 48,
          height: 48,
          decoration: BoxDecoration(
            color: iconBackground,
            borderRadius:
                BorderRadius.circular(15),
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

class FaqSection extends StatelessWidget {
  const FaqSection({super.key});

  static const List<Map<String, String>>
      faqs = [
    {
      'question':
          'How do I fund my wallet?',
      'answer':
          'Open Wallet, tap Fund Wallet, transfer to the official Servicepay account and submit your payment details.',
    },
    {
      'question':
          'Why is my wallet balance not updated?',
      'answer':
          'Refresh the Wallet page. Manual funding must first be reviewed and approved by an administrator.',
    },
    {
      'question':
          'Can I transfer to another Servicepay user?',
      'answer':
          'Yes. Open Transfer, enter the registered phone number, confirm the amount and submit.',
    },
    {
      'question':
          'What should I do if a transaction fails?',
      'answer':
          'Check your wallet balance and internet connection. If money was deducted, contact support with the transaction reference.',
    },
    {
      'question':
          'How do I verify my identity?',
      'answer':
          'Open Verify ID, select the identity type, provide the required information and submit.',
    },
    {
      'question':
          'How do I keep my account secure?',
      'answer':
          'Never share your password, login code or verification details with another person.',
    },
  ];

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius:
            BorderRadius.circular(20),
        border: Border.all(
          color: const Color(0xFFE8EDF3),
        ),
      ),
      child: Column(
        children: [
          for (
            int index = 0;
            index < faqs.length;
            index++
          ) ...[
            ExpansionTile(
              title: Text(
                faqs[index]['question']!,
                style: const TextStyle(
                  fontSize: 14,
                  fontWeight: FontWeight.w700,
                ),
              ),
              childrenPadding:
                  const EdgeInsets.fromLTRB(
                16,
                0,
                16,
                16,
              ),
              children: [
                Align(
                  alignment:
                      Alignment.centerLeft,
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
            if (index < faqs.length - 1)
              const Divider(height: 1),
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

class LegalInformationScreen
    extends StatelessWidget {
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
      backgroundColor:
          HelpSupportScreen.backgroundColor,
      appBar: AppBar(
        backgroundColor:
            HelpSupportScreen.primaryGreen,
        foregroundColor: Colors.white,
        title: Text(title),
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(18),
        child: Center(
          child: ConstrainedBox(
            constraints:
                const BoxConstraints(
              maxWidth: 750,
            ),
            child: Container(
              width: double.infinity,
              padding: const EdgeInsets.all(22),
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius:
                    BorderRadius.circular(22),
              ),
              child: Column(
                crossAxisAlignment:
                    CrossAxisAlignment.start,
                children: [
                  Icon(
                    icon,
                    color: HelpSupportScreen
                        .primaryGreen,
                    size: 48,
                  ),
                  const SizedBox(height: 16),
                  Text(
                    title,
                    style: const TextStyle(
                      fontSize: 24,
                      fontWeight:
                          FontWeight.w900,
                    ),
                  ),
                  const SizedBox(height: 20),
                  for (final section
                      in sections) ...[
                    Text(
                      section.title,
                      style: const TextStyle(
                        fontSize: 16,
                        fontWeight:
                            FontWeight.w800,
                      ),
                    ),
                    const SizedBox(height: 7),
                    Text(
                      section.content,
                      style: const TextStyle(
                        color:
                            Color(0xFF64748B),
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
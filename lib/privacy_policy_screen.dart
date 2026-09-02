import 'package:flutter/material.dart';

class PrivacyPolicyScreen extends StatelessWidget {
  const PrivacyPolicyScreen({super.key});

  static const Color primaryGreen = Color(0xFF08783E);
  static const Color darkGreen = Color(0xFF055C30);
  static const Color pageBackground = Color(0xFFF8FAF9);

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: pageBackground,
      appBar: AppBar(
        backgroundColor: Colors.white,
        foregroundColor: darkGreen,
        elevation: 0,
        titleSpacing: 24,
        title: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Image.asset(
              'assets/image/servicepay_logo.png',
              width: 36,
              height: 36,
              fit: BoxFit.contain,
              errorBuilder: (_, __, ___) =>
                  const Icon(Icons.account_balance_wallet_rounded),
            ),
            const SizedBox(width: 10),
            const Text(
              'ServicePay',
              style: TextStyle(fontWeight: FontWeight.w900),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).maybePop(),
            child: const Text('Back to ServicePay'),
          ),
          const SizedBox(width: 12),
        ],
      ),
      body: SelectionArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(20, 36, 20, 64),
          child: Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 900),
              child: Card(
                elevation: 0,
                color: Colors.white,
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(24),
                ),
                child: Padding(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 32,
                    vertical: 40,
                  ),
                  child: _content(context),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _content(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text(
          'Privacy Policy',
          style: TextStyle(
            color: darkGreen,
            fontSize: 38,
            fontWeight: FontWeight.w900,
            height: 1.15,
          ),
        ),
        const SizedBox(height: 12),
        const Text(
          'Last updated: 2 September 2026',
          style: TextStyle(color: Colors.black54, fontWeight: FontWeight.w600),
        ),
        const SizedBox(height: 24),
        const Text(
          'YUMPAY GLOBAL TECH. LTD (“YUMPAY”, “we”, “us” or “our”) operates '
          'ServicePay, a digital services platform available in Nigeria. This '
          'Privacy Policy explains what information we collect, how we use it, '
          'when we share it, and the choices available to you when you use '
          'ServicePay, our website, mobile applications and related services.',
          style: _bodyStyle,
        ),
        const SizedBox(height: 30),
        _section(
          '1. Information we collect',
          'Depending on the ServicePay feature you use, we may collect information '
          'you provide directly, information generated when you use the service, '
          'and information received from service providers or other parties. '
          'We aim to collect information that is relevant to providing, securing '
          'and improving the requested service.',
          bullets: const [
            'Contact and account details such as your name, phone number, email address, password-related data, address and account preferences.',
            'Identity and verification details such as NIN, BVN, identity documents, verification results and photographs where a feature or legal obligation requires them.',
            'Financial and transaction information such as wallet activity, payment references, bills, transfers, withdrawals, funding records, purchase details and transaction status.',
            'Device and security information such as device type, operating system, app version, browser information, IP address, log data, diagnostic events and security signals.',
            'Location information where it is required for delivery, interstate logistics, transport, dispatch, route support, fraud prevention or another relevant feature. We request or use location only as permitted by your device settings and applicable law.',
            'Feature data from Marketplace, Local Delivery, Interstate Logistics, Solar, financing, wallet, voice calling, Mini Apps, Transport and other ServicePay services you choose to use.',
          ],
        ),
        _section(
          '2. How we use information',
          'We use information for the following purposes:',
          bullets: const [
            'Create and manage accounts, authenticate users and provide requested features.',
            'Process payments, wallet actions, withdrawals, purchases, deliveries, logistics activities, financing applications and service requests.',
            'Calculate and display applicable prices, fees, eligibility information, delivery estimates and transaction status.',
            'Communicate with you about account activity, service updates, support requests, security events and operational notices.',
            'Prevent fraud, abuse, unauthorized access, duplicate accounts and other security or financial risks.',
            'Maintain records, troubleshoot problems, measure service performance and improve the ServicePay experience.',
            'Meet legal, accounting, tax, audit, law-enforcement and other compliance obligations, or protect the rights, safety and property of ServicePay, our users and others.',
          ],
        ),
        _section(
          '3. Financial, wallet and payment information',
          'When you fund a wallet, pay for a service, request a withdrawal or complete '
          'another transaction, ServicePay records the information needed to process '
          'and reconcile that activity. Payment processors, banks, mobile-money or '
          'telecom providers may process payment credentials or settlement details '
          'under their own terms. We do not ask you to send payment PINs or passwords '
          'to us through ordinary support messages. Keep those credentials private and '
          'use only the official ServicePay flows.',
        ),
        _section(
          '4. Marketplace, delivery, logistics, solar and financing data',
          'If you use Marketplace, delivery or Interstate Logistics, we may process '
          'seller, buyer, pickup, drop-off, recipient, route, parcel, weight, vehicle, '
          'driver, rider, tracking, delivery confirmation and support information. '
          'If you use Solar or financing services, we may process application, '
          'eligibility, device, installation, repayment and related service records. '
          'The exact information depends on the service and the choices you make.',
        ),
        _section(
          '5. Sharing information',
          'We may share the minimum information reasonably necessary with:',
          bullets: const [
            'Payment processors, banks, wallet and withdrawal partners, and other financial service providers involved in a requested transaction.',
            'Identity and KYC providers that help verify identity or meet required checks.',
            'Telecom, messaging, utility, solar, technology and other service providers that help deliver a requested feature.',
            'Marketplace sellers, delivery and logistics partners, drivers, riders or recipients when needed to complete an order or shipment.',
            'Professional advisers, auditors, insurers, vendors and infrastructure providers working for or with ServicePay under appropriate obligations.',
            'Government authorities, courts, regulators or law-enforcement bodies where disclosure is required or permitted by law, or is necessary to protect people, rights or property.',
          ],
          closing:
              'We do not sell personal information as a standalone product. We may '
              'share aggregated or de-identified information where it does not '
              'reasonably identify an individual.',
        ),
        _section(
          '6. Retention',
          'We retain information for as long as reasonably necessary for the purposes '
          'described in this policy, including to provide services, maintain accurate '
          'financial and operational records, resolve disputes, prevent fraud, enforce '
          'agreements and meet legal or compliance requirements. Retention periods vary '
          'by the type of information and the service involved. When information is no '
          'longer needed, we take reasonable steps to delete it, anonymize it or securely '
          'dispose of it, subject to lawful exceptions.',
        ),
        _section(
          '7. Data security',
          'We use reasonable administrative, technical and organizational safeguards '
          'designed to protect information against unauthorized access, alteration, '
          'loss, misuse or disclosure. No online service can guarantee absolute security. '
          'You are responsible for protecting your device, account credentials and '
          'transaction PIN, and for contacting us promptly if you suspect unauthorized '
          'activity.',
        ),
        _section(
          '8. Your choices and rights',
          'Subject to applicable law and reasonable verification, you may ask us to '
          'access, correct or update personal information; ask questions about its use; '
          'object to or limit certain processing; or request deletion where retention '
          'is not required. Some requests may affect our ability to provide a feature, '
          'and we may retain information where required for security, legal, financial '
          'or dispute-resolution purposes.',
        ),
        _section(
          '9. Account and data deletion requests',
          'To request account closure or deletion of personal information, contact '
          'admin@servicepay.ng from the email address associated with your account where '
          'possible. Include enough information for us to understand and verify the '
          'request, but do not send passwords, PINs, one-time codes or identity documents '
          'unless we specifically provide a secure verification method. Closing an '
          'account does not automatically erase records that we must retain by law or '
          'that are needed to prevent fraud, resolve a dispute or complete a transaction.',
        ),
        _section(
          '10. Children’s privacy',
          'ServicePay is not directed to children who are not permitted to use the '
          'relevant service under applicable law. We do not knowingly collect personal '
          'information from a child through a service where such collection is not '
          'permitted. If you believe a child has provided personal information improperly, '
          'please contact us so we can review the request.',
        ),
        _section(
          '11. Cookies and similar technologies',
          'Our website or web applications may use cookies, local storage, session '
          'storage and similar technologies to keep the site working, remember settings, '
          'support authentication and understand basic usage. You can control cookies '
          'through your browser settings, although disabling necessary technologies may '
          'affect functionality. Our mobile applications may use device storage and '
          'platform services for equivalent purposes.',
        ),
        _section(
          '12. Third-party services and international transfers',
          'ServicePay may link to or use third-party services, including payment, '
          'identity, telecom, messaging, mapping, hosting, analytics and app-platform '
          'services. Their processing is governed by their own privacy notices. Some '
          'providers may process information outside Nigeria. Where that happens, we '
          'take reasonable steps required by applicable law and the relevant service '
          'arrangements to protect the information.',
        ),
        _section(
          '13. Changes to this policy',
          'We may update this Privacy Policy when our services, technology or legal '
          'obligations change. We will post the updated version at this URL and update '
          'the “Last updated” date. If a change is material, we may provide an additional '
          'notice through the ServicePay service or another appropriate channel.',
        ),
        _section(
          '14. Contact us',
          'Privacy questions, rights requests and data deletion requests can be sent to:',
          closing:
              'YUMPAY GLOBAL TECH. LTD\n'
              'Email: admin@servicepay.ng\n'
              'Phone: +2349136151515\n'
              'Website: https://servicepay.ng\n'
              'Country: Nigeria',
        ),
      ],
    );
  }

  static Widget _section(
    String title,
    String body, {
    List<String> bullets = const [],
    String? closing,
  }) {
    return Padding(
      padding: const EdgeInsets.only(top: 28),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            title,
            style: const TextStyle(
              color: darkGreen,
              fontSize: 21,
              fontWeight: FontWeight.w800,
              height: 1.3,
            ),
          ),
          const SizedBox(height: 10),
          Text(body, style: _bodyStyle),
          if (bullets.isNotEmpty) ...[
            const SizedBox(height: 8),
            ...bullets.map(
              (bullet) => Padding(
                padding: const EdgeInsets.only(top: 7, left: 4),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Padding(
                      padding: EdgeInsets.only(top: 8, right: 10),
                      child: Icon(
                        Icons.circle,
                        size: 6,
                        color: primaryGreen,
                      ),
                    ),
                    Expanded(child: Text(bullet, style: _bodyStyle)),
                  ],
                ),
              ),
            ),
          ],
          if (closing != null) ...[
            const SizedBox(height: 12),
            Text(closing, style: _bodyStyle),
          ],
        ],
      ),
    );
  }

  static const TextStyle _bodyStyle = TextStyle(
    color: Color(0xFF26352D),
    fontSize: 16,
    height: 1.65,
  );
}
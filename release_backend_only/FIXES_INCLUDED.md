# Servicepay Full Repair

Included:
- Customer-facing Hausa strings changed to English in active source files.
- Wallet route registered in the backend.
- Paystack initialization and idempotent payment verification.
- Wallet balance refresh from the backend.
- Airtime endpoint protected by JWT, wallet debit, transaction record, and automatic refund on provider failure.
- ClubKonnect/Nello network-name to provider-code mapping.
- Cards and Bank Transfer entries/screens added to Customer Dashboard.
- Duplicate `url_launcher` entry removed from pubspec.yaml.
- Existing Customer and Admin projects retained.

Production activation still required:
- Cards require a licensed card-issuing provider and credentials.
- Bank transfer requires a licensed payout provider, account-name enquiry, bank list, transfer initiation, webhook verification, and credentials.
- Set production secrets from backend/.env.example in the hosting environment.
- Run `flutter pub get`, `dart format lib`, `flutter analyze`, tests, and APK build in a machine/Codespace with Flutter SDK installed.

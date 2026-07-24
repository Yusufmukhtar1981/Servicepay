# Servicepay Clean Source Package

Included:
- Customer Flutter app and Customer Dashboard
- Admin Flutter app and Admin Dashboard
- Node/Express backend
- Wallet Funding, Airtime, and Servicepay-to-Servicepay Transfer source

Paused/removed from active dashboard:
- Bank Transfer
- Cards

Removed to reduce package size:
- Nested ZIP/APK files
- node_modules
- build output
- .dart_tool, .gradle, .git
- generated plugin/ephemeral folders
- desktop platform generated folders

After extraction:
1. Customer app: run `flutter pub get`
2. Admin app: enter `ServicePay_Admin_Phase1`, then run `flutter pub get`
3. Backend: enter `backend`, then run `npm install`

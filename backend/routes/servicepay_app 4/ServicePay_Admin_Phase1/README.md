<<<<<<< HEAD
# servicepay_app

A new Flutter project.

## Getting Started

This project is a starting point for a Flutter application.

A few resources to get you started if this is your first Flutter project:

- [Learn Flutter](https://docs.flutter.dev/get-started/learn-flutter)
- [Write your first Flutter app](https://docs.flutter.dev/get-started/codelab)
- [Flutter learning resources](https://docs.flutter.dev/reference/learning-resources)

For help getting started with Flutter development, view the
[online documentation](https://docs.flutter.dev/), which offers tutorials,
samples, guidance on mobile development, and a full API reference.
=======
# ServicePay

ServicePay is a secure fintech platform for bill payments, wallet services, bank transfers, and digital financial services.

## Features
- Airtime
- Data
- Electricity
- Cable TV
- Education PINs
- Wallet
- Bank Transfer
- QR Payments
- Referral System

Developed with Flutter + Laravel.
>>>>>>> ce23f58a61260033f20cb00429232e70bd53923d

## Admin Dashboard setup

Phase 1 includes a protected Admin Dashboard for users whose role is `HEAD_OFFICE`.

Create or update the admin account from the backend folder:

```bash
cd backend
npm install
npm run create-admin
```

Defaults:

- Email: `admin@servicepay.ng`
- Phone: `08000000000`
- Password: `ServicePay123`

For production, set `ADMIN_EMAIL`, `ADMIN_PHONE`, `ADMIN_PASSWORD`, and `ADMIN_NAME` in `backend/.env` before running the command.

Start the backend:

```bash
node index.js
```

Admin endpoint:

```text
GET /api/admin/dashboard
```

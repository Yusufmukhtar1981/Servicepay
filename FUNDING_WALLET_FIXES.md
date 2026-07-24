# ServicePay Wallet Funding Fixes

## Completed
- Paystack initialization uses the authenticated ServicePay user.
- Paystack metadata stores the ServicePay user ID and expected amount.
- Payment verification confirms successful status, ownership, purpose, and amount.
- Duplicate verification requests cannot credit the wallet twice.
- Successful funding updates MongoDB `walletBalance` and `totalTransactions`.
- Funding is recorded as a `WALLET_FUNDING` transaction.
- Wallet screen refreshes balance and displays recent transaction history.
- Cards and Bank Transfer shortcuts were removed from the customer dashboard for now.
- ServicePay-to-ServicePay transfer remains available.

## Deployment requirements
Set these backend environment variables on Render:
- `MONGODB_URI`
- `JWT_SECRET`
- `PAYSTACK_SECRET_KEY` (must begin with `sk_`)

Redeploy the backend after uploading these changes. Rebuild/redeploy the Flutter customer app so the updated wallet screen appears.

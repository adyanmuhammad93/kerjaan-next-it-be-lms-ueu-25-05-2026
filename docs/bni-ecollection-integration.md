# BNI eCollection (VA) Integration

## Environment

- `DATA_ENCRYPTION_KEY` (base64, 32 bytes): used to encrypt gateway payloads at rest.
- `BNI_ECOLLECTION_BASE_URL`: `https://apibeta.bni-ecollection.com/` (sandbox) or `https://api.bni-ecollection.com/` (production).
- `BNI_ECOLLECTION_CLIENT_ID`: client id from BNI.
- `BNI_ECOLLECTION_SECRET_KEY`: secret key from BNI.
- `BNI_ECOLLECTION_PREFIX`: request prefix from BNI.
- `BNI_ECOLLECTION_TIME_DIFF_LIMIT_SEC`: timestamp drift tolerance.
- `BNI_CALLBACK_IP_ALLOWLIST`: optional allowlist for callback source IPs.

## Database

Migration: [019_bni_ecollection.ts](file:///Users/circlebidev-mac-01/Documents/Projects/NEXT/lms-ueu/backend/src/db/migrations/019_bni_ecollection.ts)

## Backend Endpoints

All endpoints are registered under `/api/payments`.

- `POST /api/payments/bni/initiate` (auth required)
  - Creates a local transaction + calls BNI `createbilling`.
  - Returns `transaction` including `virtual_account`, `gateway_trx_id`, and `gateway_expires_at`.

- `POST /api/payments/bni/:id/reconcile` (auth required)
  - Calls BNI `inquirybilling` for the transaction and updates local status if a paid invoice is detected.

- `POST /api/payments/bni/callback` (public)
  - Receives BNI payment notification.
  - Decrypts the payload, validates timestamp, records a notification row (idempotent), and auto-enrolls on success.
  - Must respond with `{ "status": "000" }` to stop retries.

## Frontend Flow

- Checkout initiates BNI VA, then routes to `/payment/bni/:id`.
- Payment status page polls `/api/payments/:id` and offers manual reconcile via `/api/payments/bni/:id/reconcile`.


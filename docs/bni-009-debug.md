# BNI eCollection 009/999 Debug Runbook

## Enable debug logs

Set these environment variables for the backend runtime:

- `BNI_DEBUG_LOG=true`
- `LOG_LEVEL=debug`

Restart/recreate the backend container after updating env:

```bash
docker compose up -d --force-recreate backend
```

## Collect logs (staging/prod)

```bash
docker logs -f lms-backend | grep '"ns":"bni"'
```

All emitted debug lines are JSON with:

- `ts`: ISO timestamp
- `ns`: `bni`
- `event`: step marker

## Reproduce (same path as users)

1. Login as a student.
2. Open Checkout, choose IDR, choose BNI VA.
3. Submit payment initiation until backend returns `BNI eCollection error 009` (or `999`).
4. Save the `gateway_trx_id`/`tx_id` from response for correlation.

## Reproduce (direct API smoke test)

From the backend folder on the same machine/container where env is configured:

```bash
pnpm tsx scripts/bni-smoke.ts
```

Recommended variations:

```bash
BNI_ECOLLECTION_PREFIX=988 pnpm tsx scripts/bni-smoke.ts
BNI_ECOLLECTION_PREFIX=8 pnpm tsx scripts/bni-smoke.ts
BNI_REQUEST_TYPE=inquirybilling BNI_TRX_ID=INVTEST001 pnpm tsx scripts/bni-smoke.ts
```

## What to look for in logs

### Outgoing request

Events:

- `init_gateway`
- `bni_request_payload`
- `call_start`
- `encrypt`
- `call_http`
- `call_bni_error`

Key fields:

- `prefix`
- `client_id_suffix`
- `request.type`, `request.trx_id`, `request.trx_amount`, `request.datetime_expired`
- `encrypt.now_sec`, `encrypt.plain_sha256`, `encrypt.cipher_sha256`
- `call_http.http_status`, `call_http.duration_ms`
- `call_bni_error.bni_status`, `call_bni_error.bni_message`

### Incoming callback

Events:

- `callback_received`
- `incoming_decrypt_start`
- `decrypt_time_diff_exceeded` (if any)
- `callback_decrypted`
- `callback_process_start`
- `callback_verified` or `callback_reject_*`

## Findings checklist (most common root causes)

If time drift is suspected:

- Compare `Date.now()` between host/container using epoch seconds.
- If drift exceeds `BNI_ECOLLECTION_TIME_DIFF_LIMIT_SEC`, you should see `decrypt_time_diff_exceeded`.

If BNI returns `009` or `999` and there is no local decrypt/time-diff failure:

1. Verify `BNI_ECOLLECTION_BASE_URL` matches the credential environment (sandbox vs production).
2. Verify `BNI_ECOLLECTION_PREFIX` is the API routing prefix assigned by BNI for this `client_id` (it may not match the visible VA starting digits).
3. Verify `BNI_ECOLLECTION_CLIENT_ID` and `BNI_ECOLLECTION_SECRET_KEY` match (wrong pairing commonly produces non-specific gateway errors).
4. Confirm `trx_id` length <= 30 and contains only permitted characters.
5. Share `client_id`, `prefix`, `trx_id`, request timestamp, and BNI `status/message` to BNI support for server-side decryption validation (never share secret key).


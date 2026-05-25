# BNI eCollection Monitoring Runbook

## What to Monitor

### Core Business Metrics

- Payment initiation count (`POST /api/payments/bni/initiate`)
- Callback received count (`POST /api/payments/bni/callback`)
- Paid/verified transactions count (`transactions.status = verified` and `payment_method = bni_ecollection`)
- Rejected transactions count (`transactions.status = rejected` and `payment_method = bni_ecollection`)
- Reconciliation usage count (`POST /api/payments/bni/:id/reconcile`)

### Reliability Metrics

- Callback success rate: fraction of callbacks returning HTTP 200 + `{status:"000"}`
- Callback retry indicator: repeated notifications with same `payment_ntb` (see `payment_gateway_notifications` unique constraint collisions)
- Latency:
  - Initiate latency (BNI API round-trip + DB transaction time)
  - Callback handler latency (DB time + enrollment fulfillment time)

### Gateway Health

- BNI API error codes observed from initiation / reconciliation:
  - `002` (IP/client_id issue), `010` (timeout), `200` (system offline), `998/999` (internal)

## Where to Look

### Database Queries (Postgres)

1) Success rate by day

```sql
select
  date_trunc('day', created_at) as day,
  count(*) filter (where payment_method='bni_ecollection') as initiated,
  count(*) filter (where payment_method='bni_ecollection' and status='verified') as verified,
  count(*) filter (where payment_method='bni_ecollection' and status='rejected') as rejected
from transactions
group by 1
order by 1 desc;
```

2) Callback volume

```sql
select
  date_trunc('hour', received_at) as hour,
  count(*) as notifications
from payment_gateway_notifications
where provider='bni_ecollection'
group by 1
order by 1 desc;
```

3) Stuck transactions (pending but expired)

```sql
select id, gateway_trx_id, gateway_expires_at, created_at
from transactions
where payment_method='bni_ecollection'
  and status='pending'
  and gateway_expires_at is not null
  and gateway_expires_at < now()
order by gateway_expires_at desc;
```

## Alerting Recommendations

- High callback failure rate (e.g., spike in non-000 responses or HTTP 5xx on callback endpoint)
- Spike in `rejected` with `BNI_*_MISMATCH` notes (possible fraud, misconfiguration, or pricing/rounding issues)
- BNI error spikes (`transactions.notes like 'BNI_%'`)
- Unusual reconciliation volume (gateway callbacks delayed or blocked)

## Incident Playbook

1) Initiation failures
- Validate `BNI_ECOLLECTION_*` env vars.
- Confirm the server public IP is allowlisted by BNI (error `002`).
- Check BNI base URL (sandbox vs prod).

2) Callback not arriving
- Confirm callback URL is reachable publicly and terminates TLS.
- If behind reverse proxy, confirm request IP forwarding and `BNI_CALLBACK_IP_ALLOWLIST` settings.
- Temporarily disable allowlist to confirm whether traffic is being blocked.

3) Paid but not verified in LMS
- Use `POST /api/payments/bni/:id/reconcile` to force `inquirybilling`.
- Inspect `payment_gateway_notifications` for the related `gateway_trx_id` / `payment_ntb`.


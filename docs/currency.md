## Supported currencies

The application supports only:

- `USD` (2 decimals)
- `IDR` (0 decimals)

Course and bundle prices are stored in the database as USD values (`courses.price`, `bundles.price`).

## FX rates

IDR amounts are derived from USD amounts using a USD→IDR rate stored in the `settings` table under key `fx_rates`:

```json
{ "usd_idr": 15800 }
```

The backend reads this setting during transaction creation and stores the applied rate on the transaction (`transactions.fx_rate_usd_idr`) to keep invoices consistent over time.

## Transaction amounts

Each transaction stores:

- `total_amount` (USD, 2 decimals)
- `currency_code` (`USD` or `IDR`)
- `total_amount_currency` (amount in `currency_code`)
- `fx_rate_usd_idr` (only for `IDR` transactions)

Each transaction item stores:

- `price` (USD, 2 decimals)
- `price_currency` (amount in the transaction currency)

## Payment gateways

- `bni_ecollection` is processed in `IDR` only. The billed amount is always `total_amount_currency` (integer rupiah).


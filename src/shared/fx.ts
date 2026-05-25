import type { Knex } from 'knex';

export async function getUsdIdrRate(knex: Knex): Promise<{ usd_idr: number; updatedAt?: Date | null } | null> {
  const row = await knex('settings').where({ key: 'fx_rates' }).first();
  const raw = row?.value;
  let parsed: any = null;
  if (typeof raw === 'string') {
    try { parsed = JSON.parse(raw); } catch { parsed = null; }
  } else {
    parsed = raw;
  }
  const usd_idr = Number(parsed?.usd_idr);
  if (!Number.isFinite(usd_idr) || usd_idr <= 0) return null;
  const updatedAt = row?.updated_at ? new Date(row.updated_at) : null;
  return { usd_idr, updatedAt };
}


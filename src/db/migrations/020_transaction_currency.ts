import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('transactions', (t) => {
    t.string('currency_code', 3).notNullable().defaultTo('USD');
    t.decimal('total_amount_currency', 15, 2).notNullable().defaultTo(0);
    t.decimal('fx_rate_usd_idr', 18, 6);
    t.index(['currency_code']);
  });

  await knex.schema.alterTable('transaction_items', (t) => {
    t.decimal('price_currency', 15, 2).notNullable().defaultTo(0);
  });

  await knex('transactions').update({ total_amount_currency: knex.ref('total_amount') });
  await knex('transaction_items').update({ price_currency: knex.ref('price') });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('transaction_items', (t) => {
    t.dropColumn('price_currency');
  });

  await knex.schema.alterTable('transactions', (t) => {
    t.dropIndex(['currency_code']);
    t.dropColumn('fx_rate_usd_idr');
    t.dropColumn('total_amount_currency');
    t.dropColumn('currency_code');
  });
}


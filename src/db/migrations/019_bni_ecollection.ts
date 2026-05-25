import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('transactions', (t) => {
    t.enu('payment_method', ['manual', 'bni_ecollection']).notNullable().defaultTo('manual');
    t.string('gateway_trx_id', 30);
    t.string('virtual_account', 16);
    t.string('billing_type', 1);
    t.timestamp('gateway_expires_at', { useTz: true });
    t.timestamp('gateway_paid_at', { useTz: true });
    t.decimal('payment_amount', 14, 0);
    t.decimal('cumulative_payment_amount', 14, 0);
    t.string('payment_ntb', 6);
    t.text('gateway_payload_enc');
    t.unique(['gateway_trx_id']);
  });

  await knex.schema.createTable('payment_gateway_notifications', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    t.string('provider', 50).notNullable();
    t.string('gateway_trx_id', 30);
    t.string('payment_ntb', 6);
    t.timestamp('received_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.text('payload_enc');
    t.index(['provider']);
    t.index(['gateway_trx_id']);
    t.unique(['provider', 'payment_ntb']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('payment_gateway_notifications');
  await knex.schema.alterTable('transactions', (t) => {
    t.dropUnique(['gateway_trx_id']);
    t.dropColumn('gateway_payload_enc');
    t.dropColumn('payment_ntb');
    t.dropColumn('cumulative_payment_amount');
    t.dropColumn('payment_amount');
    t.dropColumn('gateway_paid_at');
    t.dropColumn('gateway_expires_at');
    t.dropColumn('billing_type');
    t.dropColumn('virtual_account');
    t.dropColumn('gateway_trx_id');
    t.dropColumn('payment_method');
  });
}


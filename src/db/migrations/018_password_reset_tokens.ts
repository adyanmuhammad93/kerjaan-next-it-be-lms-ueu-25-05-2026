import type { Knex } from 'knex';

/**
 * Migration 018: Password Reset Tokens
 * 
 * Stores hashed password reset tokens with expiry and usage tracking.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('password_reset_tokens', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    t.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.string('token_hash', 128).notNullable().unique();
    t.timestamp('expires_at').notNullable();
    t.timestamp('used_at');
    t.timestamps(true, true);

    // Index for fast token lookup
    t.index(['token_hash']);
    // Index for cleanup queries
    t.index(['expires_at']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('password_reset_tokens');
}

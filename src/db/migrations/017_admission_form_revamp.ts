import type { Knex } from 'knex';

/**
 * Migration 017: Admission Form Revamp
 * 
 * Creates `admission_periods` and `programs` reference tables,
 * and adds split name fields + phone + FK columns to `users` table
 * for the Graduate Certificate Admission Form.
 */
export async function up(knex: Knex): Promise<void> {
  // 1. Create admission_periods table
  await knex.schema.createTable('admission_periods', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    t.string('name', 100).notNullable();           // e.g. "2026/2027 Semester Ganjil"
    t.string('code', 20).unique();                  // e.g. "2026-1"
    t.date('start_date');
    t.date('end_date');
    t.boolean('registration_open').notNullable().defaultTo(true);
    t.timestamps(true, true);
  });

  // 2. Create programs table
  await knex.schema.createTable('programs', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    t.string('name', 200).notNullable();            // e.g. "Graduate Certificate in Data Science"
    t.string('code', 20).unique();                  // e.g. "GC-DS-01"
    t.text('description');
    t.boolean('is_active').notNullable().defaultTo(true);
    t.timestamps(true, true);
  });

  // 3. Add new columns to users table
  await knex.schema.alterTable('users', (t) => {
    t.string('first_name', 100);
    t.string('middle_name', 100);
    t.string('last_name', 100);
    t.string('phone', 20);
    t.uuid('admission_period_id').references('id').inTable('admission_periods').onDelete('SET NULL');
    t.uuid('program_id').references('id').inTable('programs').onDelete('SET NULL');
  });

  // 4. Backfill: copy existing full_name → first_name for existing users
  await knex.raw(`
    UPDATE users 
    SET first_name = full_name 
    WHERE first_name IS NULL AND full_name IS NOT NULL
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('users', (t) => {
    t.dropColumn('first_name');
    t.dropColumn('middle_name');
    t.dropColumn('last_name');
    t.dropColumn('phone');
    t.dropColumn('admission_period_id');
    t.dropColumn('program_id');
  });
  await knex.schema.dropTableIfExists('programs');
  await knex.schema.dropTableIfExists('admission_periods');
}

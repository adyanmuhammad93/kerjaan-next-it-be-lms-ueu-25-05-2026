import { db } from '../../db/knex.js';
import { NotFoundError } from '../../shared/errors.js';

export const admissionPeriodsService = {
  /** List all admission periods. If onlyOpen=true, returns only those with registration_open=true */
  async list(onlyOpen = false) {
    let query = db('admission_periods').orderBy('created_at', 'desc');
    if (onlyOpen) query = query.where({ registration_open: true });
    return query;
  },

  async getById(id: string) {
    const period = await db('admission_periods').where({ id }).first();
    if (!period) throw new NotFoundError('Admission period');
    return period;
  },

  async create(input: { name: string; code?: string; startDate?: string; endDate?: string; registrationOpen?: boolean }) {
    const [period] = await db('admission_periods').insert({
      name: input.name,
      code: input.code || null,
      start_date: input.startDate || null,
      end_date: input.endDate || null,
      registration_open: input.registrationOpen ?? true,
    }).returning('*');
    return period;
  },

  async update(id: string, input: { name?: string; code?: string; startDate?: string; endDate?: string; registrationOpen?: boolean }) {
    const payload: Record<string, any> = { updated_at: new Date() };
    if (input.name !== undefined) payload.name = input.name;
    if (input.code !== undefined) payload.code = input.code;
    if (input.startDate !== undefined) payload.start_date = input.startDate;
    if (input.endDate !== undefined) payload.end_date = input.endDate;
    if (input.registrationOpen !== undefined) payload.registration_open = input.registrationOpen;

    await db('admission_periods').where({ id }).update(payload);
  },

  async delete(id: string) {
    await db('admission_periods').where({ id }).delete();
  },
};

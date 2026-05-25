import { db } from '../../db/knex.js';
import { NotFoundError } from '../../shared/errors.js';

export const programsService = {
  /** List all programs. If onlyActive=true, returns only those with is_active=true */
  async list(onlyActive = false) {
    let query = db('programs').orderBy('name', 'asc');
    if (onlyActive) query = query.where({ is_active: true });
    return query;
  },

  async getById(id: string) {
    const program = await db('programs').where({ id }).first();
    if (!program) throw new NotFoundError('Program');
    return program;
  },

  async create(input: { name: string; code?: string; description?: string; isActive?: boolean }) {
    const [program] = await db('programs').insert({
      name: input.name,
      code: input.code || null,
      description: input.description || null,
      is_active: input.isActive ?? true,
    }).returning('*');
    return program;
  },

  async update(id: string, input: { name?: string; code?: string; description?: string; isActive?: boolean }) {
    const payload: Record<string, any> = { updated_at: new Date() };
    if (input.name !== undefined) payload.name = input.name;
    if (input.code !== undefined) payload.code = input.code;
    if (input.description !== undefined) payload.description = input.description;
    if (input.isActive !== undefined) payload.is_active = input.isActive;

    await db('programs').where({ id }).update(payload);
  },

  async delete(id: string) {
    await db('programs').where({ id }).delete();
  },
};

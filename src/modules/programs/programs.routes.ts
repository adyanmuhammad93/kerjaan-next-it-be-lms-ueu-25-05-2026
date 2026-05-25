import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authenticate, requireRole } from '../../middleware/authenticate.js';
import { programsService } from './programs.service.js';
import { z } from 'zod';
import { ValidationError } from '../../shared/errors.js';

const createSchema = z.object({
  name: z.string().min(1).max(200).trim(),
  code: z.string().max(20).trim().optional(),
  description: z.string().optional(),
  isActive: z.boolean().optional(),
});

const updateSchema = createSchema.partial();

export async function programRoutes(app: FastifyInstance) {
  // GET /api/programs — public, returns active programs for registration form dropdown
  app.get('/', async (request: FastifyRequest, reply: FastifyReply) => {
    const onlyActive = (request.query as any).onlyActive === 'true';
    const programs = await programsService.list(onlyActive);
    return reply.send({ programs });
  });

  // GET /api/programs/:id
  app.get('/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const program = await programsService.getById(id);
    return reply.send({ program });
  });

  // POST /api/programs — admin only
  app.post('/', { preHandler: [authenticate, requireRole('admin')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = createSchema.safeParse(request.body);
    if (!parsed.success) throw new ValidationError(parsed.error.errors.map(e => e.message).join(', '));
    const program = await programsService.create(parsed.data);
    return reply.status(201).send({ program });
  });

  // PUT /api/programs/:id — admin only
  app.put('/:id', { preHandler: [authenticate, requireRole('admin')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const parsed = updateSchema.safeParse(request.body);
    if (!parsed.success) throw new ValidationError(parsed.error.errors.map(e => e.message).join(', '));
    await programsService.update(id, parsed.data);
    return reply.send({ message: 'Program updated' });
  });

  // DELETE /api/programs/:id — admin only
  app.delete('/:id', { preHandler: [authenticate, requireRole('admin')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    await programsService.delete(id);
    return reply.status(204).send();
  });
}

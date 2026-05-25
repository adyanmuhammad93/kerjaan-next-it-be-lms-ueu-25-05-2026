import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authenticate, requireRole } from '../../middleware/authenticate.js';
import { admissionPeriodsService } from './admissionPeriods.service.js';
import { z } from 'zod';
import { ValidationError } from '../../shared/errors.js';

const createSchema = z.object({
  name: z.string().min(1).max(100).trim(),
  code: z.string().max(20).trim().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  registrationOpen: z.boolean().optional(),
});

const updateSchema = createSchema.partial();

export async function admissionPeriodRoutes(app: FastifyInstance) {
  // GET /api/admission-periods — public, returns open periods for registration form dropdown
  app.get('/', async (_request: FastifyRequest, reply: FastifyReply) => {
    const onlyOpen = (_request.query as any).onlyOpen === 'true';
    const periods = await admissionPeriodsService.list(onlyOpen);
    return reply.send({ periods });
  });

  // GET /api/admission-periods/:id
  app.get('/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const period = await admissionPeriodsService.getById(id);
    return reply.send({ period });
  });

  // POST /api/admission-periods — admin only
  app.post('/', { preHandler: [authenticate, requireRole('admin')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = createSchema.safeParse(request.body);
    if (!parsed.success) throw new ValidationError(parsed.error.errors.map(e => e.message).join(', '));
    const period = await admissionPeriodsService.create(parsed.data);
    return reply.status(201).send({ period });
  });

  // PUT /api/admission-periods/:id — admin only
  app.put('/:id', { preHandler: [authenticate, requireRole('admin')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const parsed = updateSchema.safeParse(request.body);
    if (!parsed.success) throw new ValidationError(parsed.error.errors.map(e => e.message).join(', '));
    await admissionPeriodsService.update(id, parsed.data);
    return reply.send({ message: 'Admission period updated' });
  });

  // DELETE /api/admission-periods/:id — admin only
  app.delete('/:id', { preHandler: [authenticate, requireRole('admin')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    await admissionPeriodsService.delete(id);
    return reply.status(204).send();
  });
}

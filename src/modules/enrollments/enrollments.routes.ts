import { db } from '../../db/knex.js'; 
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authenticate, requireRole } from '../../middleware/authenticate.js';
import { ValidationError } from '../../shared/errors.js';

function applyInstructorCourseScope(query: any, instructorId: string) {
  return query.where(function(this: any) {
    this.where('courses.instructor_id', instructorId)
      .orWhereExists(
        db('course_assignments as ca')
          .whereRaw('ca.course_id = courses.id')
          .where('ca.instructor_id', instructorId)
          .select(1),
      );
  });
}

// Service
export const enrollmentsService = {
  async enroll(userId: string, courseId: string, status: 'active' | 'pending' = 'active') {
    await db('enrollments')
      .insert({ user_id: userId, course_id: courseId, status })
      .onConflict(['user_id', 'course_id'])
      .merge({ status });
    return true;
  },

  async getStatus(userId: string, courseId: string) {
    const row = await db('enrollments').where({ user_id: userId, course_id: courseId }).first();
    return row?.status || null;
  },

  async updateStatus(enrollmentId: string, status: 'active' | 'rejected') {
    await db('enrollments').where({ id: enrollmentId }).update({ status });
  },

  async getStudentsForCourse(courseId: string) {
    return db('enrollments as e')
      .join('users', 'e.user_id', 'users.id')
      .where('e.course_id', courseId)
      .where('e.status', 'active')
      .select('e.id', 'e.status', 'e.enrolled_at', 'e.user_id', 'users.full_name', 'users.email', 'users.avatar_url');
  },

  async getEnrollmentsForInstructor(instructorId: string) {
    const query = db('enrollments as e')
      .join('courses', 'e.course_id', 'courses.id')
      .join('users', 'e.user_id', 'users.id')
      .where('e.status', 'active')
      .select(
        'e.id', 'e.status', 'e.enrolled_at', 'e.user_id', 'e.course_id',
        'courses.title as course_title', 'courses.price',
        'users.full_name as name', 'users.email',
      )
      .orderBy('e.enrolled_at', 'desc');
  },

  async getCourseEnrollmentCount(courseId: string): Promise<number> {
    const [{ count }] = await db('enrollments').where({ course_id: courseId, status: 'active' }).count('id as count');
    return Number(count);
  },

  async getStudentEnrollments(userId: string) {
    return db('enrollments as e')
      .join('courses', 'e.course_id', 'courses.id')
      .where('e.user_id', userId)
      .select('e.*', 'courses.title', 'courses.thumbnail_url', 'courses.instructor_name');
  },
};

// Routes
export async function enrollmentRoutes(app: FastifyInstance) {
  // POST /api/enrollments
  app.post('/', { preHandler: [authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = (request as any).user;
    const { userId, courseId, status = 'active' } = request.body as any;
    if (!courseId) throw new ValidationError('courseId is required');
    if (!['active', 'pending'].includes(status)) throw new ValidationError('status must be active or pending');

    const targetUserId = user.role === 'admin' && userId ? userId : user.id;
    await enrollmentsService.enroll(targetUserId, courseId, status);
    return reply.status(201).send({ message: 'Enrolled successfully', userId: targetUserId, courseId, status });
  });

  // POST /api/enrollments/admin — admin enrolls a target student in a course
  app.post('/admin', { preHandler: [authenticate, requireRole('admin')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { userId, courseId, status = 'active' } = request.body as any;
    if (!userId || !courseId) throw new ValidationError('userId and courseId are required');
    if (!['active', 'pending'].includes(status)) throw new ValidationError('status must be active or pending');

    await enrollmentsService.enroll(userId, courseId, status);
    return reply.status(201).send({ message: 'Enrollment upserted successfully', userId, courseId, status });
  });

  // PATCH /api/enrollments/admin/status — admin updates a target student's enrollment status
  app.patch('/admin/status', { preHandler: [authenticate, requireRole('admin')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { userId, courseId, status = 'active' } = request.body as any;
    if (!userId || !courseId) throw new ValidationError('userId and courseId are required');
    if (!['active', 'pending', 'rejected'].includes(status)) throw new ValidationError('status must be active, pending, or rejected');

    await db('enrollments')
      .insert({ user_id: userId, course_id: courseId, status })
      .onConflict(['user_id', 'course_id'])
      .merge({ status });

    return reply.send({ message: 'Enrollment status updated', userId, courseId, status });
  });

  // GET /api/enrollments/status/:courseId
  app.get('/status/:courseId', { preHandler: [authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = (request as any).user;
    const { courseId } = request.params as any;
    const status = await enrollmentsService.getStatus(user.id, courseId);
    return reply.send({ status });
  });

  // Legacy: GET /api/enrollments/status?courseId= (query param form)
  app.get('/status', { preHandler: [authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = (request as any).user;
    const { courseId } = request.query as any;
    const status = await enrollmentsService.getStatus(user.id, courseId);
    return reply.send({ status });
  });

  // PATCH /api/enrollments/:id — instructor/admin update enrollment status
  app.patch('/:id', { preHandler: [authenticate, requireRole('instructor', 'admin')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const { status } = request.body as any;
    await enrollmentsService.updateStatus(id, status);
    return reply.send({ message: 'Status updated' });
  });

  // GET /api/enrollments/course/:courseId — students in a course
  app.get('/course/:courseId', { preHandler: [authenticate, requireRole('instructor', 'admin')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { courseId } = request.params as { courseId: string };
    const students = await enrollmentsService.getStudentsForCourse(courseId);
    return reply.send({ students });
  });

  // GET /api/enrollments/my-students — all students enrolled in instructor's courses
  app.get('/my-students', { preHandler: [authenticate, requireRole('instructor', 'admin')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = (request as any).user;
    const instructorId = user.role === 'admin' ? undefined : user.id;
    let query = db('enrollments as e')
      .join('courses', 'e.course_id', 'courses.id')
      .join('users', 'e.user_id', 'users.id')
      .where('e.status', 'active')
      .select(
        'e.id', 'e.status', 'e.enrolled_at', 'e.user_id', 'e.course_id',
        'courses.title as course_title', 'courses.price',
        'users.full_name as name', 'users.email',
      )
      .orderBy('e.enrolled_at', 'desc');
    if (instructorId) query =  applyInstructorCourseScope(query, instructorId);
    const students = await query;
    return reply.send({ students });
  });

  // GET /api/enrollments/my — current user's enrollments
  app.get('/my', { preHandler: [authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = (request as any).user;
    const enrollments = await enrollmentsService.getStudentEnrollments(user.id);
    return reply.send({ enrollments });
  });

  // GET /api/enrollments/:courseId/count
  app.get('/:courseId/count', async (request: FastifyRequest, reply: FastifyReply) => {
    const { courseId } = request.params as { courseId: string };
    const count = await enrollmentsService.getCourseEnrollmentCount(courseId);
    return reply.send({ count });
  });
}

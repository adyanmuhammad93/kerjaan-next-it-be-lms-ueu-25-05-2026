import { db } from '../../db/knex.js'; 
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authenticate, requireRole } from '../../middleware/authenticate.js';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { ValidationError } from '../../shared/errors.js';
import { config } from '../../config/env.js';
import { encryptJson, decryptJson } from '../../shared/crypto.js';
import { BniEcollectionClient } from './bniEcollection.js';
import { convertUsdToIdrMinor, parseCurrencyCode, toMinorUnits, fromMinorUnits } from '../../shared/money.js';
import { getUsdIdrRate } from '../../shared/fx.js';
import { bniDebug, sanitizeBniPayload } from '../../shared/bniDebug.js';

const itemSchema = z.object({
  itemId: z.string().uuid(),
  itemType: z.enum(['course', 'bundle']),
  price: z.number().min(0).optional(),
  title: z.string().min(1).max(300).optional(),
});

const createTxSchema = z.object({
  totalAmount: z.number().positive(),
  proofUrl: z.string().optional(),
  items: z.array(itemSchema).min(1),
  currencyCode: z.enum(['USD', 'IDR']).optional().default('USD'),
});

const bniInitSchema = z.object({
  totalAmount: z.number().positive(),
  items: z.array(itemSchema).min(1),
  customerName: z.string().min(1).max(255).optional(),
  customerEmail: z.string().email().optional(),
  customerPhone: z.string().max(30).optional(),
  billingType: z.enum(['o', 'c', 'i', 'm', 'n', 'x']).optional().default('c'),
  expiresInHours: z.coerce.number().int().min(1).max(168).optional().default(24),
  currencyCode: z.enum(['IDR']).optional().default('IDR'),
});

const verifyTxSchema = z.object({
  status: z.enum(['verified', 'rejected']).optional().default('verified'),
  userId: z.string().uuid().optional(),
  notes: z.string().optional(),
  items: z.array(itemSchema).optional(),
});

type TransactionItemInput = z.infer<typeof itemSchema>;
type NormalizedTransactionItem = {
  item_id: string;
  item_type: 'course' | 'bundle';
  price?: number;
  price_currency?: number;
  title?: string;
};

// Helper: attach items to transactions
async function attachItems(txs: any[]) {
  const ids = txs.map((t: any) => t.id);
  if (ids.length === 0) return txs.map((t: any) => ({ ...t, items: [] }));
  const items = await db('transaction_items').whereIn('transaction_id', ids);
  return txs.map((t: any) => {
    const gatewayPayload = t.gateway_payload_enc
      ? decryptJson(t.gateway_payload_enc, config.crypto.dataEncryptionKey)
      : null;
    return { ...t, gateway_payload: gatewayPayload, items: items.filter((i: any) => i.transaction_id === t.id) };
  });
}

function normalizeBodyItems(items?: TransactionItemInput[]): NormalizedTransactionItem[] {
  return (items || []).map((item) => ({
    item_id: item.itemId,
    item_type: item.itemType,
    price: item.price,
    title: item.title,
  }));
}

async function upsertActiveEnrollment(trx: any, userId: string, courseId: string) {
  await trx('enrollments')
    .insert({ user_id: userId, course_id: courseId, status: 'active' })
    .onConflict(['user_id', 'course_id'])
    .merge({ status: 'active' });
}

async function createEnrollmentsForItems(trx: any, userId: string, items: NormalizedTransactionItem[]) {
  const enrolledCourseIds = new Set<string>();

  for (const item of items) {
    if (item.item_type === 'course') {
      await upsertActiveEnrollment(trx, userId, item.item_id);
      enrolledCourseIds.add(item.item_id);
      continue;
    }

    if (item.item_type === 'bundle') {
      const bundleCourses = await trx('bundle_courses')
        .where({ bundle_id: item.item_id })
        .select('course_id');

      for (const bc of bundleCourses) {
        await upsertActiveEnrollment(trx, userId, bc.course_id);
        enrolledCourseIds.add(bc.course_id);
      }
    }
  }

  return Array.from(enrolledCourseIds);
}

function generateGatewayTrxId() {
  const rand = Math.random().toString(36).slice(2, 10).toUpperCase();
  const ts = Date.now().toString(36).toUpperCase();
  return `BNI${ts}${rand}`.slice(0, 30);
}

function toIdrGatewayAmount(amount: number) {
  if (!Number.isFinite(amount) || amount <= 0) throw new ValidationError('Invalid amount');
  if (Math.round(amount) !== amount) throw new ValidationError('Amount must be an integer for IDR billing');
  if (String(Math.trunc(amount)).length > 14) throw new ValidationError('Amount exceeds maximum supported length');
  return Math.trunc(amount);
}

async function loadUsdPricingForItems(trx: any, items: { itemId: string; itemType: 'course' | 'bundle' }[]) {
  const courseIds = items.filter((i) => i.itemType === 'course').map((i) => i.itemId);
  const bundleIds = items.filter((i) => i.itemType === 'bundle').map((i) => i.itemId);

  const courseRows = courseIds.length
    ? await trx('courses').whereIn('id', courseIds).select('id', 'title', 'price')
    : [];
  const bundleRows = bundleIds.length
    ? await trx('bundles').whereIn('id', bundleIds).select('id', 'title', 'price')
    : [];

  const courseMap = new Map<string, any>(courseRows.map((r: any) => [r.id, r]));
  const bundleMap = new Map<string, any>(bundleRows.map((r: any) => [r.id, r]));

  const normalized = items.map((i) => {
    const row: any = i.itemType === 'course' ? courseMap.get(i.itemId) : bundleMap.get(i.itemId);
    if (!row) throw new ValidationError(`Item not found: ${i.itemId}`);
    const priceUsd = Number(row.price);
    if (!Number.isFinite(priceUsd) || priceUsd < 0) throw new ValidationError('Invalid item price');
    return { item_id: i.itemId, item_type: i.itemType, title: row.title, price: priceUsd } as NormalizedTransactionItem;
  });

  const totalUsd = normalized.reduce((acc, i) => acc + (i.price || 0), 0);
  return { items: normalized, totalUsd };
}

// Service
export const paymentsService = {
  async createTransaction(userId: string, input: z.infer<typeof createTxSchema>) {
    return db.transaction(async (trx) => {
      const currencyCode = parseCurrencyCode(input.currencyCode);
      const pricing = await loadUsdPricingForItems(trx, input.items.map((i) => ({ itemId: i.itemId, itemType: i.itemType })));
      const inputTotal = Number(input.totalAmount);
      if (!Number.isFinite(inputTotal) || inputTotal <= 0) throw new ValidationError('Invalid total amount');

      let totalCurrency = pricing.totalUsd;
      let fxRateUsdIdr: number | null = null;
      let itemsWithCurrency = pricing.items.map((i) => ({ ...i, price_currency: i.price } as NormalizedTransactionItem));

      if (currencyCode === 'IDR') {
        const rate = await getUsdIdrRate(trx);
        if (!rate) throw new ValidationError('FX rate is not configured (settings: fx_rates.usd_idr)');
        fxRateUsdIdr = rate.usd_idr;
        itemsWithCurrency = pricing.items.map((i) => {
          const usdCents = toMinorUnits(i.price || 0, 'USD');
          const idr = convertUsdToIdrMinor(usdCents, fxRateUsdIdr as number);
          return { ...i, price_currency: fromMinorUnits(idr, 'IDR') };
        });
        totalCurrency = itemsWithCurrency.reduce((acc, i) => acc + Number(i.price_currency || 0), 0);
      }

      if (currencyCode === 'USD') {
        if (Math.abs(inputTotal - pricing.totalUsd) > 0.01) throw new ValidationError('Total amount mismatch');
      } else {
        const legacyOk = Math.abs(inputTotal - pricing.totalUsd) <= 0.01;
        const idrOk = Math.abs(inputTotal - totalCurrency) <= 0.01;
        if (!legacyOk && !idrOk) throw new ValidationError('Total amount mismatch');
      }

      const [tx] = await trx('transactions').insert({
        id: uuidv4(),
        user_id: userId,
        total_amount: pricing.totalUsd,
        total_amount_currency: totalCurrency,
        currency_code: currencyCode,
        fx_rate_usd_idr: fxRateUsdIdr,
        proof_url: input.proofUrl,
        status: 'pending',
      }).returning('*');

      const itemPayload = itemsWithCurrency.map(i => ({
        id: uuidv4(),
        transaction_id: tx.id,
        item_id: i.item_id,
        item_type: i.item_type,
        price: i.price,
        price_currency: i.price_currency,
        title: i.title,
      }));
      await trx('transaction_items').insert(itemPayload);

      return tx;
    });
  },

  async createBniEcollectionTransaction(userId: string, input: z.infer<typeof bniInitSchema>) {
    const bni = new BniEcollectionClient();
    return db.transaction(async (trx) => {
      bniDebug('init_start', { user_id: userId, input: sanitizeBniPayload(input) });
      const userRow = await trx('users').where({ id: userId }).first();
      if (!userRow) throw new ValidationError('User not found');
      bniDebug('init_user_loaded', { user_id: userId, user_email: userRow.email ? String(userRow.email).replace(/^(.).+(@.*)$/, '$1***$2') : null });

      const pricing = await loadUsdPricingForItems(trx, input.items.map((i) => ({ itemId: i.itemId, itemType: i.itemType })));
      const rate = await getUsdIdrRate(trx);
      if (!rate) throw new ValidationError('FX rate is not configured (settings: fx_rates.usd_idr)');

      const fxRateUsdIdr = rate.usd_idr;
      bniDebug('init_pricing', { total_usd: pricing.totalUsd, fx_usd_idr: fxRateUsdIdr });
      const itemsWithCurrency = pricing.items.map((i) => {
        const usdCents = toMinorUnits(i.price || 0, 'USD');
        const idr = convertUsdToIdrMinor(usdCents, fxRateUsdIdr);
        return { ...i, price_currency: fromMinorUnits(idr, 'IDR') };
      });
      const totalIdr = itemsWithCurrency.reduce((acc, i) => acc + Number(i.price_currency || 0), 0);
      const inputTotal = Number(input.totalAmount);
      if (!Number.isFinite(inputTotal) || inputTotal <= 0) throw new ValidationError('Invalid total amount');
      const legacyOk = Math.abs(inputTotal - pricing.totalUsd) <= 0.01;
      const idrOk = Math.abs(inputTotal - totalIdr) <= 0.01;
      if (!legacyOk && !idrOk) throw new ValidationError('Total amount mismatch');
      bniDebug('init_totals', { input_total: inputTotal, total_usd: pricing.totalUsd, total_idr: totalIdr, legacy_ok: legacyOk, idr_ok: idrOk });

      const gatewayTrxId = generateGatewayTrxId();
      const billingType = input.billingType;
      const trxAmount = billingType === 'o' ? 0 : toIdrGatewayAmount(totalIdr);
      const expiresAt = new Date(Date.now() + input.expiresInHours * 3600 * 1000);
      bniDebug('init_gateway', { gateway_trx_id: gatewayTrxId, billing_type: billingType, trx_amount: trxAmount, expires_at: expiresAt.toISOString() });

      const [tx] = await trx('transactions')
        .insert({
          id: uuidv4(),
          user_id: userId,
          total_amount: pricing.totalUsd,
          total_amount_currency: totalIdr,
          currency_code: 'IDR',
          fx_rate_usd_idr: fxRateUsdIdr,
          status: 'pending',
          payment_method: 'bni_ecollection',
          gateway_trx_id: gatewayTrxId,
          billing_type: billingType,
          gateway_expires_at: expiresAt,
        })
        .returning('*');
      bniDebug('db_tx_created', { tx_id: tx.id, gateway_trx_id: gatewayTrxId, status: tx.status });

      const itemPayload = itemsWithCurrency.map(i => ({
        id: uuidv4(),
        transaction_id: tx.id,
        item_id: i.item_id,
        item_type: i.item_type,
        price: i.price,
        price_currency: i.price_currency,
        title: i.title,
      }));
      await trx('transaction_items').insert(itemPayload);
      bniDebug('db_items_created', { tx_id: tx.id, item_count: itemPayload.length });

      const requestPayload = {
        type: 'createbilling',
        client_id: config.bniEcollection.clientId,
        trx_id: gatewayTrxId,
        trx_amount: trxAmount,
        billing_type: billingType,
        customer_name: input.customerName || userRow.full_name || userRow.email,
        customer_email: input.customerEmail || userRow.email,
        customer_phone: input.customerPhone,
        virtual_account: null,
        datetime_expired: expiresAt.toISOString(),
        description: `Payment ${gatewayTrxId}`,
      };
      bniDebug('bni_request_payload', { tx_id: tx.id, payload: sanitizeBniPayload(requestPayload) });

      const result = await bni.call<typeof requestPayload, { trx_id: string; virtual_account: string }>(requestPayload as any);
      if (!result.ok) {
        bniDebug('bni_create_failed', { tx_id: tx.id, gateway_trx_id: gatewayTrxId, bni_status: result.status, bni_message: result.message });
        await trx('transactions')
          .where({ id: tx.id })
          .update({ notes: `BNI_${result.status}:${result.message}`, updated_at: new Date() });
        throw new ValidationError(`BNI eCollection error ${result.status}: ${result.message}`);
      }

      const payloadEnc = encryptJson(result.data, config.crypto.dataEncryptionKey);
      if (!payloadEnc) throw new ValidationError('DATA_ENCRYPTION_KEY is required');
      const [updated] = await trx('transactions')
        .where({ id: tx.id })
        .update({
          virtual_account: result.data.virtual_account,
          gateway_payload_enc: payloadEnc,
          updated_at: new Date(),
        })
        .returning('*');
      bniDebug('bni_create_success', { tx_id: updated.id, gateway_trx_id: gatewayTrxId, virtual_account: updated.virtual_account });

      return updated;
    });
  },

  async verifyTransaction(txId: string, fallback?: { userId?: string; items?: TransactionItemInput[] }) {
    return db.transaction(async (trx) => {
      const tx = await trx('transactions').where({ id: txId }).first();
      if (!tx) return null;

      const studentUserId = tx.user_id || fallback?.userId;
      if (!studentUserId) throw new ValidationError('Student userId is required to verify this transaction');

      const dbItems = await trx('transaction_items').where({ transaction_id: txId });
      const items = dbItems.length > 0 ? dbItems : normalizeBodyItems(fallback?.items);
      if (items.length === 0) throw new ValidationError('Transaction must have at least one item to verify');

      const enrolledCourseIds = await createEnrollmentsForItems(trx, studentUserId, items);
      const [updatedTx] = await trx('transactions')
        .where({ id: txId })
        .update({ status: 'verified', updated_at: new Date() })
        .returning('*');

      return { transaction: updatedTx, enrolledCourseIds };
    });
  },

  async reconcileBniEcollection(txId: string) {
    const bni = new BniEcollectionClient();
    return db.transaction(async (trx) => {
      bniDebug('reconcile_start', { tx_id: txId });
      const tx = await trx('transactions').where({ id: txId }).first();
      if (!tx) return null;
      if (tx.payment_method !== 'bni_ecollection') throw new ValidationError('Transaction is not a BNI eCollection payment');
      if (!tx.gateway_trx_id) throw new ValidationError('Missing gateway reference');

      const reqPayload = { type: 'inquirybilling', client_id: config.bniEcollection.clientId, trx_id: tx.gateway_trx_id };
      bniDebug('bni_inquiry_payload', { tx_id: txId, payload: sanitizeBniPayload(reqPayload) });
      const res = await bni.call<typeof reqPayload, any>(reqPayload as any);
      if (!res.ok) {
        bniDebug('bni_inquiry_failed', { tx_id: txId, bni_status: res.status, bni_message: res.message });
        return { ok: false as const, status: res.status, message: res.message };
      }

      const data = res.data as any;
      const vaStatus = String(data.va_status || '');
      const paid = data.datetime_payment_iso8601 || data.datetime_payment;
      bniDebug('bni_inquiry_result', { tx_id: txId, va_status: vaStatus, paid: Boolean(paid), data: sanitizeBniPayload(data) });
      if (vaStatus === '2' && paid) {
        const notify = {
          trx_id: data.trx_id,
          virtual_account: data.virtual_account,
          customer_name: data.customer_name,
          trx_amount: data.trx_amount,
          payment_amount: data.payment_amount,
          cumulative_payment_amount: data.cumulative_payment_amount || data.payment_amount,
          payment_ntb: data.payment_ntb,
          datetime_payment: data.datetime_payment,
          datetime_payment_iso8601: data.datetime_payment_iso8601,
        };
        await this.processBniPaymentNotification(trx, notify);
      }

      const updated = await trx('transactions').where({ id: txId }).first();
      bniDebug('reconcile_end', { tx_id: txId, status: updated?.status, notes: updated?.notes });
      return { ok: true as const, data: updated };
    });
  },

  async processBniPaymentNotification(trx: any, notification: any) {
    bniDebug('callback_process_start', { notification: sanitizeBniPayload(notification) });
    const gatewayTrxId = String(notification.trx_id || '');
    if (!gatewayTrxId) throw new ValidationError('Missing trx_id');
    const tx = await trx('transactions').where({ gateway_trx_id: gatewayTrxId }).first();
    if (!tx) throw new ValidationError('Transaction not found');
    bniDebug('callback_tx_loaded', { tx_id: tx.id, gateway_trx_id: gatewayTrxId, status: tx.status, billing_type: tx.billing_type, expected_total_idr: tx.total_amount_currency });

    const paymentNtb = notification.payment_ntb ? String(notification.payment_ntb) : null;
    const payloadEnc = encryptJson(notification, config.crypto.dataEncryptionKey);
    if (!payloadEnc) throw new ValidationError('DATA_ENCRYPTION_KEY is required');
    if (paymentNtb) {
      await trx('payment_gateway_notifications')
        .insert({
          id: uuidv4(),
          provider: 'bni_ecollection',
          gateway_trx_id: gatewayTrxId,
          payment_ntb: paymentNtb,
          payload_enc: payloadEnc,
        })
        .onConflict(['provider', 'payment_ntb'])
        .ignore();
      bniDebug('callback_ntb_upserted', { payment_ntb: paymentNtb });
    }

    if (tx.status === 'verified') return { transaction: tx, enrolledCourseIds: [] as string[] };

    const dbItems = await trx('transaction_items').where({ transaction_id: tx.id });
    if (dbItems.length === 0) throw new ValidationError('Transaction has no items');

    const expectedTrxAmount = tx.billing_type === 'o'
      ? 0
      : Math.trunc(Number(tx.total_amount_currency ?? tx.total_amount));
    const notifTrxAmount = notification.trx_amount != null ? Number(notification.trx_amount) : null;
    if (tx.virtual_account && notification.virtual_account && String(notification.virtual_account) !== tx.virtual_account) {
      bniDebug('callback_reject_va_mismatch', { tx_id: tx.id, notif_va: notification.virtual_account, expected_va: tx.virtual_account });
      const [rejected] = await trx('transactions')
        .where({ id: tx.id })
        .update({
          status: 'rejected',
          notes: `BNI_VA_MISMATCH`,
          gateway_payload_enc: payloadEnc,
          updated_at: new Date(),
        })
        .returning('*');
      return { transaction: rejected, enrolledCourseIds: [] as string[] };
    }
    if (notifTrxAmount != null && Number.isFinite(notifTrxAmount) && notifTrxAmount !== expectedTrxAmount) {
      bniDebug('callback_reject_trx_amount_mismatch', { tx_id: tx.id, notif_trx_amount: notifTrxAmount, expected_trx_amount: expectedTrxAmount });
      const [rejected] = await trx('transactions')
        .where({ id: tx.id })
        .update({
          status: 'rejected',
          notes: `BNI_TRX_AMOUNT_MISMATCH:${notifTrxAmount}:${expectedTrxAmount}`,
          gateway_payload_enc: payloadEnc,
          updated_at: new Date(),
        })
        .returning('*');
      return { transaction: rejected, enrolledCourseIds: [] as string[] };
    }

    const paidAt = notification.datetime_payment_iso8601
      ? new Date(notification.datetime_payment_iso8601)
      : (notification.datetime_payment ? new Date(notification.datetime_payment) : new Date());

    const paymentAmount = notification.payment_amount ? Number(notification.payment_amount) : null;
    const cumulativePaymentAmount = notification.cumulative_payment_amount ? Number(notification.cumulative_payment_amount) : paymentAmount;

    if (tx.billing_type === 'c' && paymentAmount != null && Number.isFinite(paymentAmount) && paymentAmount !== expectedTrxAmount) {
      bniDebug('callback_reject_payment_amount_mismatch', { tx_id: tx.id, payment_amount: paymentAmount, expected_trx_amount: expectedTrxAmount });
      const [rejected] = await trx('transactions')
        .where({ id: tx.id })
        .update({
          status: 'rejected',
          notes: `BNI_PAYMENT_AMOUNT_MISMATCH:${paymentAmount}:${expectedTrxAmount}`,
          gateway_paid_at: paidAt,
          payment_amount: paymentAmount,
          cumulative_payment_amount: cumulativePaymentAmount,
          payment_ntb: paymentNtb,
          gateway_payload_enc: payloadEnc,
          updated_at: new Date(),
        })
        .returning('*');
      return { transaction: rejected, enrolledCourseIds: [] as string[] };
    }

    const enrolledCourseIds = await createEnrollmentsForItems(trx, tx.user_id, dbItems);
    const [updatedTx] = await trx('transactions')
      .where({ id: tx.id })
      .update({
        status: 'verified',
        gateway_paid_at: paidAt,
        payment_amount: paymentAmount,
        cumulative_payment_amount: cumulativePaymentAmount,
        payment_ntb: paymentNtb,
        gateway_payload_enc: payloadEnc,
        updated_at: new Date(),
      })
      .returning('*');
    bniDebug('callback_verified', { tx_id: updatedTx.id, gateway_trx_id: gatewayTrxId, enrolled_course_count: enrolledCourseIds.length });

    return { transaction: updatedTx, enrolledCourseIds };
  },

  async rejectTransaction(txId: string, notes?: string) {
    await db('transactions').where({ id: txId }).update({ status: 'rejected', notes, updated_at: new Date() });
  },

  async getUserTransactions(userId: string) {
    const txs = await db('transactions').where({ user_id: userId }).orderBy('created_at', 'desc');
    return attachItems(txs);
  },

  async getAllTransactions(status?: string) {
    let q = db('transactions as t')
      .join('users', 't.user_id', 'users.id')
      .select('t.*', 'users.full_name as user_name', 'users.email as user_email')
      .orderBy('t.created_at', 'desc');
    if (status) q = q.where('t.status', status);
    const txs = await q;
    return attachItems(txs);
  },

  async getById(txId: string) {
    const tx = await db('transactions as t')
      .join('users', 't.user_id', 'users.id')
      .select('t.*', 'users.full_name as user_name', 'users.email as user_email')
      .where('t.id', txId)
      .first();
    if (!tx) return null;
    const [enriched] = await attachItems([tx]);
    return enriched;
  },
};

// Routes
export async function paymentRoutes(app: FastifyInstance) {
  app.post('/bni/callback', async (request: FastifyRequest, reply: FastifyReply) => {
    bniDebug('callback_received', { ip: request.ip, has_wrapped_data: Boolean((request.body as any)?.data) });
    const allowlist = config.bniEcollection.callbackIpAllowlist;
    if (allowlist.length > 0 && !allowlist.includes(request.ip)) {
      request.log.warn({ ip: request.ip }, 'bni_callback_ip_blocked');
      return reply.status(403).send({ status: '002' });
    }

    const body = request.body as any;
    const bni = new BniEcollectionClient();
    const decrypted = body && body.data && body.client_id ? bni.decryptIncoming<any>(body) : body;
    if (!decrypted) return reply.status(400).send({ status: '001' });
    bniDebug('callback_decrypted', { decrypted: sanitizeBniPayload(decrypted) });

    try {
      await db.transaction(async (trx) => {
        await paymentsService.processBniPaymentNotification(trx, decrypted);
      });
      return reply.send({ status: '000' });
    } catch (err: any) {
      request.log.error({ err }, 'bni_callback_processing_failed');
      return reply.status(500).send({ status: '999' });
    }
  });

  app.post('/bni/initiate', { preHandler: [authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = bniInitSchema.safeParse(request.body);
    if (!parsed.success) throw new ValidationError(parsed.error.errors.map(e => e.message).join(', '));
    const user = (request as any).user;
    bniDebug('initiate_http', { user_id: user.id, body: sanitizeBniPayload(parsed.data) });
    const tx = await paymentsService.createBniEcollectionTransaction(user.id, parsed.data);
    const [enriched] = await attachItems([tx]);
    return reply.status(201).send({ transaction: enriched });
  });

  app.post('/bni/:id/reconcile', { preHandler: [authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const user = (request as any).user;
    const tx = await paymentsService.getById(id);
    if (!tx) return reply.status(404).send({ error: 'Not found' });
    if (user.role !== 'admin' && tx.user_id !== user.id) return reply.status(403).send({ error: 'Forbidden' });
    const result = await paymentsService.reconcileBniEcollection(id);
    if (!result) return reply.status(404).send({ error: 'Not found' });
    if (!result.ok) return reply.status(400).send({ error: 'BNI_ERROR', status: result.status, message: result.message });
    const enrichedTx = await paymentsService.getById(id);
    return reply.send({ transaction: enrichedTx });
  });

  // POST /api/payments
  app.post('/', { preHandler: [authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = createTxSchema.safeParse(request.body);
    if (!parsed.success) throw new ValidationError(parsed.error.errors.map(e => e.message).join(', '));
    const user = (request as any).user;
    const tx = await paymentsService.createTransaction(user.id, parsed.data);
    const [enriched] = await attachItems([tx]);
    return reply.status(201).send({ transaction: enriched });
  });

  // GET /api/payments — admin: all (with optional status filter), user: own
  app.get('/', { preHandler: [authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = (request as any).user;
    const q = request.query as any;
    if (user.role === 'admin') {
      const txs = await paymentsService.getAllTransactions(q.status);
      return reply.send({ transactions: txs });
    }
    const txs = await paymentsService.getUserTransactions(user.id);
    return reply.send({ transactions: txs });
  });

  // GET /api/payments/my — explicit own transactions
  app.get('/my', { preHandler: [authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = (request as any).user;
    const txs = await paymentsService.getUserTransactions(user.id);
    return reply.send({ transactions: txs });
  });

  // GET /api/payments/:id
  app.get('/:id', { preHandler: [authenticate] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const user = (request as any).user;
    const tx = await paymentsService.getById(id);
    if (!tx) return reply.status(404).send({ error: 'Not found' });
    if (user.role !== 'admin' && tx.user_id !== user.id) return reply.status(403).send({ error: 'Forbidden' });
    return reply.send({ transaction: tx });
  });

  // PATCH /api/payments/:id/verify — admin
  app.patch('/:id/verify', { preHandler: [authenticate, requireRole('admin')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const parsed = verifyTxSchema.safeParse(request.body || {});
    if (!parsed.success) throw new ValidationError(parsed.error.errors.map(e => e.message).join(', '));

    if (parsed.data.status === 'rejected') {
      await paymentsService.rejectTransaction(id, parsed.data.notes);
      return reply.send({ message: 'Transaction rejected' });
    }

    const result = await paymentsService.verifyTransaction(id, {
      userId: parsed.data.userId,
      items: parsed.data.items,
    });
    if (!result) return reply.status(404).send({ error: 'Transaction not found' });

    return reply.send({
      message: 'Transaction verified and enrollments created',
      transaction: result.transaction,
      enrolledCourseIds: result.enrolledCourseIds,
    });
  });

  // Legacy POST verify/reject
  app.post('/:id/verify', { preHandler: [authenticate, requireRole('admin')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const result = await paymentsService.verifyTransaction(id);
    if (!result) return reply.status(404).send({ error: 'Transaction not found' });
    return reply.send({
      message: 'Transaction verified and enrollments created',
      transaction: result.transaction,
      enrolledCourseIds: result.enrolledCourseIds,
    });
  });

  app.post('/:id/reject', { preHandler: [authenticate, requireRole('admin')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const { notes } = request.body as any;
    await paymentsService.rejectTransaction(id, notes);
    return reply.send({ message: 'Transaction rejected' });
  });
}

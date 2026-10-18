import { z } from 'zod';
import { authedProcedure, router, requireRole } from '../trpc/trpc.js';
import type { LedgerService } from './ledger.service.js';

// §user request — "Owner/Manager/Front Desk sab" can log Cash In/Out, same reach as who can
// already collect a guest payment at check-in. Category management stays owner/manager-only,
// same as the rest of Settings.
const ownerManagerFrontDesk = requireRole('pms', ['owner', 'manager', 'front_desk']);
const ownerOrManager = requireRole('pms', ['owner', 'manager']);

// Same payment-method list bookings.router.ts's addPayment uses — kept in sync by hand since
// there's no shared zod schema module between the two routers yet.
const paymentMethodSchema = z.enum([
  'cash',
  'online',
  'card',
  'bank_transfer',
  'company_settlement',
  'agent_settlement',
  'upi',
  'credit_sale',
  'cheque',
  'cash_deposit',
]);

export function createLedgerRouter(ledger: LedgerService) {
  return router({
    listCategories: authedProcedure.input(z.object({ hotelId: z.string() })).query(({ input }) => ledger.listCategories(input.hotelId)),

    createCategory: ownerOrManager
      .input(z.object({ hotelId: z.string(), name: z.string().min(1).max(60), parentId: z.string().optional() }))
      .mutation(({ input }) => ledger.createCategory(input)),

    deleteCategory: ownerOrManager.input(z.object({ categoryId: z.string() })).mutation(({ input }) => ledger.deleteCategory(input.categoryId)),

    listTransactions: authedProcedure
      .input(z.object({ hotelId: z.string(), from: z.coerce.date().optional(), to: z.coerce.date().optional() }))
      .query(({ input }) => ledger.listTransactions(input)),

    getSummary: authedProcedure.input(z.object({ hotelId: z.string() })).query(({ input }) => ledger.getSummary(input.hotelId)),

    createEntry: ownerManagerFrontDesk
      .input(
        z.object({
          hotelId: z.string(),
          type: z.enum(['cash_in', 'cash_out']),
          amount: z.number().positive(),
          paymentMethod: paymentMethodSchema,
          categoryId: z.string().optional(),
          remarks: z.string().max(500).optional(),
          isPettyCash: z.boolean().optional(),
        }),
      )
      .mutation(({ ctx, input }) => ledger.createEntry({ ...input, actorId: ctx.user.userId })),

    deleteEntry: ownerOrManager.input(z.object({ entryId: z.string() })).mutation(({ input }) => ledger.deleteEntry(input.entryId)),

    setOpeningBalance: ownerOrManager
      .input(z.object({ hotelId: z.string(), amount: z.number().nonnegative().nullable(), date: z.coerce.date().nullable() }))
      .mutation(({ input }) => ledger.setOpeningBalance(input.hotelId, input.amount, input.date)),
  });
}

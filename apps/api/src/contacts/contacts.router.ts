import { z } from 'zod';
import { router, requireRole } from '../trpc/trpc.js';
import type { ContactsService } from './contacts.service.js';

// §user request — "FMO add kar sake lekin sirf owner delete kar sake": list/create reach every
// day-to-day PMS role (same bar as who can log a Ledger entry), delete is owner-only — same
// pattern as staff.router.ts's ownerOnly for staff removal.
const frontDeskUp = requireRole('pms', ['owner', 'manager', 'front_desk']);
const ownerOnly = requireRole('pms', ['owner']);

export function createContactsRouter(contacts: ContactsService) {
  return router({
    list: frontDeskUp.input(z.object({ hotelId: z.string() })).query(({ input }) => contacts.listContacts(input.hotelId)),

    create: frontDeskUp
      .input(z.object({ hotelId: z.string(), name: z.string().min(1).max(100), category: z.string().min(1).max(60), phone: z.string().min(1).max(20) }))
      .mutation(({ input }) => contacts.createContact(input)),

    delete: ownerOnly.input(z.object({ contactId: z.string() })).mutation(({ input }) => contacts.deleteContact(input.contactId)),
  });
}

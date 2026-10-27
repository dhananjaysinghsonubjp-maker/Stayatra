import { useEffect, useState } from 'react';
import { query, mutate, ApiError } from '../api';
import { useAuth } from '../AuthContext';
import { Button, Card, EmptyState, Field, PageHeader, StatCard, inputClass } from '../components/ui';
import type { HotelContact } from '../types';

// §user request — "ugly lag raha hai, proper banao": each category gets a stable colour (hashed
// from its name, not random per render) so the directory reads as organised at a glance — every
// "Plumber" card looks the same, without a fixed enum locking the hotel into a preset list.
const AVATAR_PALETTE = [
  'from-brand-500 to-brand-700',
  'from-emerald-500 to-emerald-700',
  'from-amber-500 to-amber-600',
  'from-sky-500 to-sky-700',
  'from-rose-500 to-rose-700',
  'from-violet-500 to-violet-700',
  'from-teal-500 to-teal-700',
  'from-orange-500 to-orange-600',
];
function paletteFor(category: string) {
  let hash = 0;
  for (let i = 0; i < category.length; i++) hash = (hash * 31 + category.charCodeAt(i)) >>> 0;
  return AVATAR_PALETTE[hash % AVATAR_PALETTE.length];
}

function Avatar({ name, category }: { name: string; category: string }) {
  return (
    <div
      className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-br text-sm font-bold text-white ${paletteFor(category)}`}
    >
      {name[0]?.toUpperCase() ?? '?'}
    </div>
  );
}

function ContactCard({ contact, canDelete, onDelete }: { contact: HotelContact; canDelete: boolean; onDelete: () => void }) {
  return (
    <Card className="flex items-start gap-3 p-4 transition-shadow hover:shadow-md">
      <Avatar name={contact.name} category={contact.category} />
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <p className="truncate text-sm font-bold text-slate-900 dark:text-white">{contact.name}</p>
          {canDelete && (
            <button
              onClick={onDelete}
              title="Delete contact"
              className="shrink-0 rounded-md p-1 text-slate-300 hover:bg-red-50 hover:text-red-600 dark:text-slate-600 dark:hover:bg-red-900/20 dark:hover:text-red-400"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0-1 14a2 2 0 01-2 2H7a2 2 0 01-2-2L4 6h16z" />
              </svg>
            </button>
          )}
        </div>
        <span className="mt-1 inline-block rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-semibold text-slate-600 dark:bg-slate-700 dark:text-slate-300">
          {contact.category}
        </span>
        <a
          href={`tel:${contact.phone}`}
          className="mt-2.5 flex w-fit items-center gap-1.5 rounded-lg bg-emerald-50 px-2.5 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-900/20 dark:text-emerald-400 dark:hover:bg-emerald-900/30"
        >
          <svg viewBox="0 0 24 24" fill="currentColor" className="h-3.5 w-3.5">
            <path d="M6.6 10.8c1.4 2.8 3.8 5.2 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.5.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1C10.8 21 3 13.2 3 3.9c0-.5.4-.9 1-.9h3.5c.6 0 1 .4 1 1 0 1.2.2 2.4.6 3.5.1.3.1.7-.2 1l-2.3 2.3z" />
          </svg>
          {contact.phone}
        </a>
      </div>
    </Card>
  );
}

/**
 * §user request — "hotel ke important contacts, jaise electrician/plumber ke 5-6 number, FMO
 * add kar sake lekin sirf owner delete kar sake": a flat, always-growing directory, not a modal
 * flow — the add form stays right at the bottom so adding several contacts in a row (the "5-6
 * electricians" case) doesn't mean reopening a dialog each time. Same page for both roles;
 * `isOwner` only toggles whether the Delete button renders (server enforces this too).
 */
export function Contacts({ hotelId, isOwner }: { hotelId: string; isOwner: boolean }) {
  const { token } = useAuth();
  const [contacts, setContacts] = useState<HotelContact[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');

  async function refresh() {
    try {
      setContacts(await query<HotelContact[]>('contacts.list', { hotelId }, token ?? undefined));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load contacts');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hotelId]);

  async function deleteContact(id: string) {
    if (!confirm('Delete this contact?')) return;
    try {
      await mutate('contacts.delete', { contactId: id }, token ?? undefined);
      void refresh();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : 'Failed to delete contact');
    }
  }

  // §bugfix — "badmash (1) dikha raha hai but click karne ke baad show nahi hota": same class of
  // bug as the Property ID login fix — an exact `===` match against a stored category that can
  // carry an invisible trailing space (mobile keyboard autocomplete, copy-paste) silently matches
  // nothing. Comparing trimmed+lowercased values on both sides makes the match (and the dedup
  // list it's built from) immune to that, while the pill/card still display the original casing.
  const normalize = (s: string) => s.trim().toLowerCase();
  const categories = [...new Map(contacts.map((c) => [normalize(c.category), c.category.trim()])).values()].sort();
  const q = normalize(search);
  const filtered = contacts.filter((c) => {
    if (categoryFilter && normalize(c.category) !== normalize(categoryFilter)) return false;
    // §user request — "category vise search ho, naam yaad nahi rahega": search now matches the
    // category too, not just name/phone — typing "plumber" finds every plumber.
    if (q && !c.name.toLowerCase().includes(q) && !c.phone.includes(q) && !normalize(c.category).includes(q)) return false;
    return true;
  });

  return (
    <div>
      <PageHeader title="Important Contacts" subtitle="Electricians, plumbers, and every other outside number the hotel keeps on hand." />

      {!loading && contacts.length > 0 && (
        <div className="mb-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <StatCard label="Total Contacts" value={contacts.length} />
          <StatCard label="Categories" value={categories.length} />
        </div>
      )}

      {error && <p className="mb-4 text-sm text-red-600 dark:text-red-400">{error}</p>}

      {!loading && contacts.length > 0 && (
        <Card className="mb-5 px-5 py-4">
          <div className="flex flex-col gap-3.5">
            <div className="relative">
              <svg
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M11 19a8 8 0 100-16 8 8 0 000 16z" />
              </svg>
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name, category, or phone"
                className="w-full rounded-lg border border-slate-300 py-2 pl-9 pr-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 dark:border-slate-600 dark:bg-slate-800 dark:text-white dark:placeholder:text-slate-500"
              />
            </div>
            {categories.length > 1 && (
              <div className="-mx-1 flex items-center gap-2 overflow-x-auto px-1 pb-1">
                <button
                  onClick={() => setCategoryFilter('')}
                  className={`inline-flex shrink-0 items-center rounded-lg border px-3.5 py-1.5 text-xs font-medium transition-colors ${
                    categoryFilter === ''
                      ? 'border-brand-600 bg-brand-50 text-brand-700 dark:border-brand-500 dark:bg-brand-500/10 dark:text-brand-300'
                      : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'
                  }`}
                >
                  All ({contacts.length})
                </button>
                {categories.map((c) => {
                  const count = contacts.filter((x) => normalize(x.category) === normalize(c)).length;
                  return (
                    <button
                      key={c}
                      onClick={() => setCategoryFilter(c)}
                      className={`inline-flex shrink-0 items-center rounded-lg border px-3.5 py-1.5 text-xs font-medium transition-colors ${
                        normalize(categoryFilter) === normalize(c)
                          ? 'border-brand-600 bg-brand-50 text-brand-700 dark:border-brand-500 dark:bg-brand-500/10 dark:text-brand-300'
                          : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'
                      }`}
                    >
                      {c} ({count})
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </Card>
      )}

      {loading ? (
        <Card className="p-6">
          <p className="text-sm text-slate-400">Loading…</p>
        </Card>
      ) : contacts.length === 0 ? (
        <Card className="p-6">
          <EmptyState title="No contacts yet" hint="Add one below — an electrician, a plumber, anyone the hotel calls regularly." />
        </Card>
      ) : filtered.length === 0 ? (
        <Card className="p-6">
          <EmptyState title="No contacts match" hint="Try a different search or category" />
        </Card>
      ) : (
        <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((c) => (
            <ContactCard key={c.id} contact={c} canDelete={isOwner} onDelete={() => void deleteContact(c.id)} />
          ))}
        </div>
      )}

      <AddContactRow hotelId={hotelId} existingCategories={categories} onAdded={refresh} />
    </div>
  );
}

const NEW_CATEGORY_VALUE = '__new__';

function AddContactRow({
  hotelId,
  existingCategories,
  onAdded,
}: {
  hotelId: string;
  existingCategories: string[];
  onAdded: () => void;
}) {
  const { token } = useAuth();
  const [name, setName] = useState('');
  // §user request — "category banane ka option ho, dropdown ban jaye, automatically aa jaye
  // select karne ke liye": categories aren't their own table (just the distinct values already
  // on existing contacts), so this dropdown already has every category ever used — picking
  // "+ Add new category" drops to a plain text input; once that contact's saved, the new name
  // is now one of `existingCategories` too, so it's in the dropdown (selected) for the next one.
  const [categorySelect, setCategorySelect] = useState('');
  const [newCategory, setNewCategory] = useState('');
  const [phone, setPhone] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const addingNewCategory = categorySelect === NEW_CATEGORY_VALUE;
  const category = addingNewCategory ? newCategory : categorySelect;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !category.trim() || !phone.trim()) {
      setError('Fill in all three fields');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await mutate('contacts.create', { hotelId, name: name.trim(), category: category.trim(), phone: phone.trim() }, token ?? undefined);
      const savedCategory = category.trim();
      setName('');
      setPhone('');
      setNewCategory('');
      // §user request — auto-selected for the next entry, not reset to blank: adding several
      // contacts of the same category in a row (the "5-6 electricians" case) shouldn't mean
      // re-picking "Electrician" every single time.
      setCategorySelect(savedCategory);
      onAdded();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to add contact');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center gap-2 border-b border-slate-100 bg-slate-50/60 px-5 py-3.5 dark:border-slate-700 dark:bg-slate-800/60">
        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-600 text-white">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </div>
        <p className="text-sm font-semibold text-slate-900 dark:text-white">Add a contact</p>
      </div>
      <form onSubmit={submit} className="flex flex-wrap items-end gap-3 p-5">
        <div className="min-w-[160px] flex-1">
          <Field label="Name">
            <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Aryan" />
          </Field>
        </div>
        <div className="min-w-[160px] flex-1">
          <Field label="Category">
            {addingNewCategory ? (
              <div className="flex gap-1.5">
                <input
                  className={inputClass}
                  value={newCategory}
                  onChange={(e) => setNewCategory(e.target.value)}
                  placeholder="e.g. Plumber"
                  autoFocus
                />
                <button
                  type="button"
                  onClick={() => setCategorySelect('')}
                  title="Back to list"
                  className="shrink-0 rounded-lg border border-slate-300 px-2 text-xs text-slate-500 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-400 dark:hover:bg-slate-700"
                >
                  ✕
                </button>
              </div>
            ) : (
              <select className={inputClass} value={categorySelect} onChange={(e) => setCategorySelect(e.target.value)}>
                <option value="">— select —</option>
                {existingCategories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
                <option value={NEW_CATEGORY_VALUE}>+ Add new category</option>
              </select>
            )}
          </Field>
        </div>
        <div className="min-w-[160px] flex-1">
          <Field label="Phone">
            <input className={inputClass} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="e.g. 9819392139" />
          </Field>
        </div>
        <Button type="submit" disabled={saving}>
          {saving ? 'Adding…' : '+ Add Contact'}
        </Button>
      </form>
      {error && <p className="px-5 pb-4 text-sm text-red-600 dark:text-red-400">{error}</p>}
    </Card>
  );
}

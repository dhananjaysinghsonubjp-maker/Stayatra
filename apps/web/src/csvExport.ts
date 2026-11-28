// §user request — "jahan jahan PDF/print ka option hai, har jagah CSV ka bhi option aana chahiye":
// one shared exporter, not fifteen copies of the same escaping/download logic — reads whatever
// <table> element(s) are already rendered inside a report/receipt/voucher's print view and turns
// them straight into a CSV, so every report that gets a table for free (nothing report-specific to
// wire up) also gets CSV for free.
function csvEscape(value: string): string {
  const cleaned = value.replace(/\s+/g, ' ').trim();
  if (/[",\n]/.test(cleaned)) return `"${cleaned.replace(/"/g, '""')}"`;
  return cleaned;
}

export function exportTablesToCsv(container: HTMLElement, filename: string) {
  const tables = container.querySelectorAll('table');
  if (tables.length === 0) return;
  const lines: string[] = [];
  tables.forEach((table, tableIndex) => {
    if (tableIndex > 0) lines.push('');
    table.querySelectorAll('tr').forEach((tr) => {
      const cells = Array.from(tr.querySelectorAll('th, td')).map((cell) => csvEscape(cell.textContent ?? ''));
      if (cells.length > 0) lines.push(cells.join(','));
    });
  });
  // A UTF-8 BOM so Excel renders ₹ and other non-ASCII characters correctly instead of mojibake —
  // Excel otherwise guesses the system codepage for a plain CSV with no BOM.
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.toLowerCase().endsWith('.csv') ? filename : `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

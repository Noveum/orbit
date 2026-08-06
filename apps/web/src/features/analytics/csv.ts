const FORMULA_LEAD = /^[=+@\t\r-]/;
const NEEDS_QUOTES = /[",\n\r]/;

function quoted(text: string): string {
  return `"${text.replace(/"/g, '""')}"`;
}

export function csvCell(value: string | number): string {
  if (typeof value === 'number') return String(value);
  if (FORMULA_LEAD.test(value)) return quoted(`'${value}`);
  if (NEEDS_QUOTES.test(value)) return quoted(value);
  return value;
}

export function toCsv(rows: ReadonlyArray<ReadonlyArray<string | number>>): string {
  return rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
}

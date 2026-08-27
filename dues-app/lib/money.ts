// Money helpers. Everything in the app is integer cents; these are the only
// places dollars and cents convert into each other.

export function formatCents(cents: number): string {
  const sign = cents < 0 ? '−' : '';
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100);
  const rem = abs % 100;
  const body = dollars.toLocaleString('en-US');
  return rem === 0 ? `${sign}$${body}` : `${sign}$${body}.${String(rem).padStart(2, '0')}`;
}

// Parses what an exec types into an amount field: "450", "$450.00", "1,350.50".
// Returns null on anything that isn't a clean number, so callers can reject it
// rather than silently recording a 0.
export function parseAmountToCents(input: string): number | null {
  const cleaned = input.replace(/[$,\s]/g, '');
  if (!/^-?\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  return Math.round(parseFloat(cleaned) * 100);
}

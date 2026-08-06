export interface ParsedPersonRow {
  name: string;
  sort_order: number;
}

/** Splits one CSV line into fields, honoring double-quoted fields (with embedded commas / "" escapes). */
function splitCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (inQuotes) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      fields.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  fields.push(current);
  return fields;
}

/**
 * Parses a roster CSV. Expects a `name` column and optionally an `order` column
 * (case-insensitive header names). If no `order` column is present, row order
 * in the file becomes sort_order.
 */
export function parseRosterCsv(csvText: string): ParsedPersonRow[] {
  const lines = csvText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length === 0) return [];

  const header = splitCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
  const nameIdx = header.indexOf('name');
  const orderIdx = header.indexOf('order');

  const dataLines = nameIdx === -1 ? lines : lines.slice(1);
  const effectiveNameIdx = nameIdx === -1 ? 0 : nameIdx;

  return dataLines.map((line, i) => {
    const cols = splitCsvLine(line).map((c) => c.trim());
    const name = cols[effectiveNameIdx] ?? '';
    const order =
      orderIdx !== -1 && cols[orderIdx] !== undefined && cols[orderIdx] !== ''
        ? Number(cols[orderIdx])
        : i;
    return { name, sort_order: Number.isFinite(order) ? order : i };
  });
}

/** Builds a CSV export string for attendance history. */
export function buildAttendanceExportCsv(
  rows: Array<{
    date: string;
    label: string | null;
    person_name: string;
    status: string | null;
    excused: boolean;
    arrived_late: boolean;
    arrival_time: string | null;
    left_early: boolean;
    departure_time: string | null;
  }>
): string {
  const header = [
    'date',
    'session_label',
    'person',
    'status',
    'excused',
    'arrived_late',
    'arrival_time',
    'left_early',
    'departure_time',
  ];
  const lines = [header.join(',')];
  for (const r of rows) {
    lines.push(
      [
        r.date,
        r.label ?? '',
        `"${r.person_name.replace(/"/g, '""')}"`,
        r.status ?? '',
        r.excused,
        r.arrived_late,
        r.arrival_time ?? '',
        r.left_early,
        r.departure_time ?? '',
      ].join(',')
    );
  }
  return lines.join('\n');
}

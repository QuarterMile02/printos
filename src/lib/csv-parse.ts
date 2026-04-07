// Minimal RFC 4180 CSV parser. Handles quoted fields containing commas,
// embedded "" escapes, and embedded newlines (CRLF or LF).
// Returns rows as plain string arrays. Headers are not interpreted here.

export function parseCsv(input: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  let i = 0

  // Strip BOM
  if (input.charCodeAt(0) === 0xfeff) i = 1

  while (i < input.length) {
    const ch = input[i]

    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          field += '"'
          i += 2
          continue
        }
        inQuotes = false
        i++
        continue
      }
      field += ch
      i++
      continue
    }

    if (ch === '"') {
      inQuotes = true
      i++
      continue
    }
    if (ch === ',') {
      row.push(field)
      field = ''
      i++
      continue
    }
    if (ch === '\r') {
      // CR or CRLF — close row
      row.push(field)
      rows.push(row)
      row = []
      field = ''
      if (input[i + 1] === '\n') i += 2
      else i++
      continue
    }
    if (ch === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
      i++
      continue
    }
    field += ch
    i++
  }

  // Final field / row (no trailing newline)
  if (field.length > 0 || row.length > 0) {
    row.push(field)
    rows.push(row)
  }

  // Drop a single trailing empty row caused by a trailing newline
  if (rows.length > 0 && rows[rows.length - 1].length === 1 && rows[rows.length - 1][0] === '') {
    rows.pop()
  }

  return rows
}

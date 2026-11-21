// csv-reader-speed-01-run-20261121 — a fast drop-in for make.fun's csv-reader 1.0.0.
//
// run(input) returns exactly what csv-reader 1.0.0 returns for {text, header}:
// {columns, rows, errors}. The reading policy is the one the bounty states:
// a U+FEFF at the very start is dropped; a record ends at LF or CRLF and an
// empty line is no record; outside quotes a CR not followed by LF is dropped
// (stray_cr); a field that opens with a quote runs to the next quote that is
// not doubled, "" inside it is one quote, each CRLF or lone CR inside it is
// read as LF, and what follows the closing quote up to the next comma or line
// break is appended as it stands (quote_junk, when the field ends); a quote
// that never closes is a literal character and the text after it is read
// again as unquoted (unterminated_quote); a quote inside an unquoted field
// is a literal character; fields stay strings, never trimmed or converted.
// columns is the first record when header is true, else null; rows holds the
// records after it, each padded (short_row, with fields: its field count) or
// cut (long_row, with extra: the cut fields) to the first record's width.
// Each error is {code, line, row}, in the order met; line is the 1-based
// line its record starts on, row its record's index in rows, null for the
// header.
//
// Speed idea: the reference walks one character at a time and builds every
// field a character at a time. This reader instead jumps with indexOf, one
// physical line at a time. A line with no quote and no stray CR is one whole
// record, and its fields are just the line split on commas. A line with
// quotes but no stray CR is still one whole record — no quoted field on it
// can hold a line break, since a line break inside quotes would be an LF
// and the line holds none — so it is parsed field by field on the short
// line alone, each field found with indexOf. Only a line with a stray CR,
// or a quoted field that does not close on its line (so the record spans
// lines, or the quote never closes), falls back to a field-by-field reader
// over the whole text, which itself jumps with indexOf instead of walking
// characters, and handles quoted content a whole segment at a time.

/** How a field ended: at a comma, at a line break, or at the end of the text. */
const COMMA = 0;
const LINE_BREAK = 1;
const END = 2;

/** csv-reader 1.0.0's answer for one case's input. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const n = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  let pos = 0; // the next character to read
  let line = 1; // the line that character is on
  if (text.charCodeAt(0) === 0xfeff) pos = 1;

  // The record being read: the line it starts on and the index in rows it takes (null: the header).
  // Field readers push their errors against these.
  let recordLine = 1;
  let recordRow = null;

  // A quoted segment [a, b) with its line breaks counted and its CRs read as
  // LF: each CRLF or lone CR becomes one LF, each LF stays one LF, and line
  // moves by the number of line breaks the segment held. Returns the segment
  // as it reads. A segment with no CR is returned as it stands.
  function quotedSegment(a, b) {
    const raw = text.slice(a, b);
    if (raw.indexOf('\r') === -1) {
      let i = -1;
      while ((i = raw.indexOf('\n', i + 1)) !== -1) line += 1;
      return raw;
    }
    const fixed = raw.replace(/\r\n?/g, '\n');
    let i = -1;
    while ((i = fixed.indexOf('\n', i + 1)) !== -1) line += 1;
    return fixed;
  }

  // Reads unquoted characters onto `value` up to the next comma or line break:
  // a CR not followed by LF is dropped (stray_cr). Returns the field, how it
  // ended, and how many characters were kept (for quote_junk).
  function readUnquoted(value) {
    let added = 0;
    for (;;) {
      const c = text.indexOf(',', pos);
      const l = text.indexOf('\n', pos);
      const r = text.indexOf('\r', pos);
      let k = c;
      let kind = COMMA;
      if (l !== -1 && (k === -1 || l < k)) { k = l; kind = LINE_BREAK; }
      if (r !== -1 && (k === -1 || r < k)) { k = r; kind = 2; }
      if (k === -1) {
        value += text.slice(pos);
        added += n - pos;
        pos = n;
        return { value, ended: END, added, quoted: false };
      }
      if (kind === COMMA) {
        value += text.slice(pos, k);
        added += k - pos;
        pos = k + 1;
        return { value, ended: COMMA, added, quoted: false };
      }
      if (kind === LINE_BREAK) {
        value += text.slice(pos, k);
        added += k - pos;
        pos = k + 1;
        line += 1;
        return { value, ended: LINE_BREAK, added, quoted: false };
      }
      // A CR: at a line break when followed by LF, else a stray one, dropped.
      if (text.charCodeAt(k + 1) === 10) {
        value += text.slice(pos, k);
        added += k - pos;
        pos = k + 2;
        line += 1;
        return { value, ended: LINE_BREAK, added, quoted: false };
      }
      value += text.slice(pos, k);
      added += k - pos;
      pos = k + 1;
      errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
    }
  }

  // What follows a quoted field's closing quote, with pos just past it.
  function afterQuote(value) {
    if (pos >= n) return { value, ended: END, quoted: true };
    const c = text.charCodeAt(pos);
    if (c === 44) {
      pos += 1;
      return { value, ended: COMMA, quoted: true };
    }
    if (c === 10) {
      pos += 1;
      line += 1;
      return { value, ended: LINE_BREAK, quoted: true };
    }
    if (c === 13 && text.charCodeAt(pos + 1) === 10) {
      pos += 2;
      line += 1;
      return { value, ended: LINE_BREAK, quoted: true };
    }
    // What follows the closing quote is appended as it stands, up to the
    // next comma or line break.
    const junk = readUnquoted(value);
    if (junk.added > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
    return { value: junk.value, ended: junk.ended, quoted: true };
  }

  // Reads a quoted field whose opening quote is at pos.
  function readQuoted() {
    const open = pos;
    const openLine = line;
    let value = '';
    let scan = pos + 1;
    for (;;) {
      const q = text.indexOf('"', scan);
      if (q === -1) {
        // The quote never closes: it is a literal character, and the text
        // after it is read again as unquoted.
        pos = open + 1;
        line = openLine;
        errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
        const u = readUnquoted('"');
        return { value: u.value, ended: u.ended, quoted: true };
      }
      if (text.charCodeAt(q + 1) === 34) {
        // A doubled quote: one quote in the field, and the field goes on.
        value += quotedSegment(scan, q) + '"';
        scan = q + 2;
        continue;
      }
      value += quotedSegment(scan, q);
      pos = q + 1;
      return afterQuote(value);
    }
  }

  // Reads one whole record, field by field (a record that may span lines
  // through quoted line breaks). Returns its fields and whether its last
  // field opened with a quote.
  function readRecordSlow() {
    const fields = [];
    let ended;
    let lastQuoted = false;
    do {
      const f = text.charCodeAt(pos) === 34 ? readQuoted() : readUnquoted('');
      fields.push(f.value);
      lastQuoted = f.quoted;
      ended = f.ended;
    } while (ended === COMMA);
    return { fields, lastQuoted };
  }

  // Reads one whole record off a single physical line `seg` that holds no
  // stray CR (a trailing CRLF's CR is already stripped). A quoted field on
  // the line holds no line break, so every field ends on this line — except
  // when a quote never closes on it, in which case this returns null and
  // the caller falls back to readRecordSlow. The quote_junk errors it meets
  // are returned, not pushed, so a bail leaves nothing behind.
  function parseLine(seg) {
    const fields = [];
    const errs = [];
    const m = seg.length;
    let i = 0;
    let lastQuoted = false;
    for (;;) {
      if (seg.charCodeAt(i) === 34) {
        lastQuoted = true;
        let v = '';
        let scan = i + 1;
        let next = -1;
        for (;;) {
          const q = seg.indexOf('"', scan);
          if (q === -1) return null;
          if (seg.charCodeAt(q + 1) === 34) {
            v += seg.slice(scan, q) + '"';
            scan = q + 2;
            continue;
          }
          v += seg.slice(scan, q);
          next = q + 1;
          break;
        }
        if (next >= m) {
          fields.push(v);
          return { fields, lastQuoted, errs };
        }
        if (seg.charCodeAt(next) === 44) {
          fields.push(v);
          i = next + 1;
          continue;
        }
        // What follows the closing quote, up to the next comma or the end.
        const k = seg.indexOf(',', next);
        const junkEnd = k === -1 ? m : k;
        const junk = seg.slice(next, junkEnd);
        if (junk.length > 0) errs.push({ code: 'quote_junk', line: recordLine, row: recordRow });
        v += junk;
        fields.push(v);
        if (k === -1) return { fields, lastQuoted, errs };
        i = k + 1;
        continue;
      }
      lastQuoted = false;
      const k = seg.indexOf(',', i);
      if (k === -1) {
        fields.push(seg.slice(i));
        return { fields, lastQuoted, errs };
      }
      fields.push(seg.slice(i, k));
      i = k + 1;
    }
  }

  // Closes a record out: the header takes the width, every other record is
  // padded or cut to it, and the short_row / long_row error is recorded.
  function finishRecord(fields, recLine, recRow) {
    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      return;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recLine, row: recRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recLine, row: recRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }

  while (pos < n) {
    const lf = text.indexOf('\n', pos);
    const end = lf === -1 ? n : lf;
    // A line with no quote and no stray CR is one whole record: split it.
    const crlf = lf !== -1 && end > pos && text.charCodeAt(end - 1) === 13;
    const segEnd = crlf ? end - 1 : end;
    const seg = text.slice(pos, segEnd);
    if (seg === '') {
      // A line left with no characters is no record.
      line += 1;
      pos = lf === -1 ? n : lf + 1;
      continue;
    }
    const hasQuote = seg.indexOf('"') !== -1;
    const hasCR = seg.indexOf('\r') !== -1;
    if (!hasQuote && !hasCR) {
      const recLine = line;
      const recRow = header && columns === null ? null : rows.length;
      finishRecord(seg.split(','), recLine, recRow);
      line += 1;
      pos = lf === -1 ? n : lf + 1;
      continue;
    }
    if (!hasCR) {
      // Quotes but no stray CR: the record is this one line. Parse it here.
      recordLine = line;
      recordRow = header && columns === null ? null : rows.length;
      const parsed = parseLine(seg);
      if (parsed !== null) {
        for (const e of parsed.errs) errors.push(e);
        if (parsed.fields.length === 1 && parsed.fields[0] === '' && !parsed.lastQuoted) {
          line += 1;
          pos = lf === -1 ? n : lf + 1;
          continue;
        }
        finishRecord(parsed.fields, recordLine, recordRow);
        line += 1;
        pos = lf === -1 ? n : lf + 1;
        continue;
      }
      // A quoted field does not close on this line: the record spans lines
      // (or the quote never closes). Fall through to the slow reader.
    }
    // A stray CR on this line, or a record spanning lines: read it field by
    // field over the whole text.
    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;
    const rec = readRecordSlow();
    // A line that held only stray CRs is left with no characters: no record
    // (its stray_cr errors stay).
    if (rec.fields.length === 1 && rec.fields[0] === '' && !rec.lastQuoted) continue;
    finishRecord(rec.fields, recordLine, recordRow);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}

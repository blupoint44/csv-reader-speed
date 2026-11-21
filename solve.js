// csv-reader-speed: a fast drop-in replacement for csv-reader 1.0.0.
//
// run(input) returns exactly csv-reader 1.0.0's answer for {text, header}:
// {columns, rows, errors}. The reading policy is the reference's own:
//   - a U+FEFF at the very start of the text is dropped;
//   - a record ends at LF or CRLF; a line left with no characters is no record;
//   - outside quotes a CR not followed by LF is dropped (stray_cr);
//   - a field that opens with a quote runs to the next quote that is not
//     doubled; "" inside it is one quote, and each CRLF or lone CR inside it
//     is read as LF; what follows the closing quote, up to the next comma or
//     line break, is appended as it stands (quote_junk, when the field ends);
//   - a quote that never closes is a literal character and the text after it
//     is read again as unquoted (unterminated_quote);
//   - a quote inside an unquoted field is a literal character; fields stay
//     strings, never trimmed or converted;
//   - columns is the first record when header is true, else null; rows holds
//     the records after it, each padded with "" (short_row) or cut (long_row)
//     to the first record's width;
//   - each error is {code, line, row} in the order met, line the 1-based line
//     its record starts on (counting every LF, CRLF and lone CR inside
//     quotes), row its record's index in rows, null for the header.
//
// Where the reference walks one character at a time and builds every field
// character by character, this reader scans with charCodeAt in tight loops
// and cuts finished fields out of the input with slice: a field that needs
// no repair is a single slice, and only a field that actually drops a stray
// CR, collapses a doubled quote or rewrites a CR inside quotes pays for
// assembling pieces. The whole parse is one function with the unquoted scan
// inlined, so the hot loops run on plain locals with no per-field calls or
// result objects. Error objects are pushed in exactly the reference's
// order: an unterminated_quote before the stray CRs of its re-read, a junk
// field's stray CRs before its quote_junk, and a record's short_row or
// long_row when the record ends.

// How a field ended.
const ENDED_COMMA = 0;
const ENDED_BREAK = 1;
const ENDED_END = 2;

export function run(input) {
  const t = String(input.text);
  const header = input.header === true;
  const n = t.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;
  let pos = 0;
  let line = 1;
  if (n > 0 && t.charCodeAt(0) === 0xfeff) pos = 1;

  for (;;) {
    // Lines with no characters are no records.
    while (pos < n) {
      const c = t.charCodeAt(pos);
      if (c === 10) {
        pos += 1;
        line += 1;
      } else if (c === 13 && pos + 1 < n && t.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= n) break;

    const recordLine = line;
    const recordRow = header && columns === null ? null : rows.length;
    const fields = [];
    let lastQuoted = false;
    let ended = ENDED_END;

    for (;;) {
      let value = '';
      const quoted = pos < n && t.charCodeAt(pos) === 34;
      lastQuoted = quoted;
      // prefix === null means the field is already finished (a quoted field
      // that met its terminator directly). Otherwise the unquoted scan
      // below runs from pos onto prefix: '' for a plain field, '"' for an
      // unterminated quote re-read as unquoted, or the quoted value for
      // the junk tail after a closing quote (junkTail set).
      let prefix = null;
      let junkTail = false;

      if (!quoted) {
        prefix = '';
      } else {
        // A field that opens with a quote: scan for its closing quote.
        const open = pos;
        const openLine = line;
        const contentStart = open + 1;
        let i = contentStart;
        let segStart = i;
        let parts = null;
        let closed = false;
        let closePos = -1;
        while (i < n) {
          const c = t.charCodeAt(i);
          if (c === 34) {
            if (i + 1 < n && t.charCodeAt(i + 1) === 34) {
              if (parts === null) parts = [];
              parts.push(t.slice(segStart, i), '"');
              i += 2;
              segStart = i;
              continue;
            }
            closed = true;
            closePos = i;
            i += 1;
            break;
          }
          if (c === 13) {
            if (parts === null) parts = [];
            parts.push(t.slice(segStart, i), '\n');
            line += 1;
            i += i + 1 < n && t.charCodeAt(i + 1) === 10 ? 2 : 1;
            segStart = i;
            continue;
          }
          if (c === 10) line += 1;
          i += 1;
        }
        if (!closed) {
          // The quote never closes: it is a literal character, and the
          // text after it is read again as unquoted.
          errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
          line = openLine;
          pos = open + 1;
          prefix = '"';
        } else {
          if (parts === null) {
            value = t.slice(contentStart, closePos);
          } else {
            parts.push(t.slice(segStart, closePos));
            value = parts.join('');
          }
          pos = i;
          if (pos >= n) {
            ended = ENDED_END;
          } else {
            const c = t.charCodeAt(pos);
            if (c === 44) {
              pos += 1;
              ended = ENDED_COMMA;
            } else if (c === 10) {
              pos += 1;
              line += 1;
              ended = ENDED_BREAK;
            } else if (c === 13 && pos + 1 < n && t.charCodeAt(pos + 1) === 10) {
              pos += 2;
              line += 1;
              ended = ENDED_BREAK;
            } else {
              // What follows the closing quote is appended as it stands.
              prefix = value;
              junkTail = true;
            }
          }
        }
      }

      if (prefix !== null) {
        // Unquoted scan: read from pos up to the next comma or line break,
        // dropping each stray CR (and recording it, in order).
        const start = pos;
        let segStart = pos;
        let parts = null;
        let endPos = pos;
        let e = ENDED_END;
        while (pos < n) {
          const c = t.charCodeAt(pos);
          if (c === 44) {
            endPos = pos;
            pos += 1;
            e = ENDED_COMMA;
            break;
          }
          if (c === 10) {
            endPos = pos;
            pos += 1;
            line += 1;
            e = ENDED_BREAK;
            break;
          }
          if (c === 13) {
            if (pos + 1 < n && t.charCodeAt(pos + 1) === 10) {
              endPos = pos;
              pos += 2;
              line += 1;
              e = ENDED_BREAK;
              break;
            }
            errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
            if (parts === null) parts = [];
            parts.push(t.slice(segStart, pos));
            pos += 1;
            segStart = pos;
            continue;
          }
          pos += 1;
        }
        if (e === ENDED_END) endPos = pos;
        let content;
        if (parts === null) {
          content = t.slice(start, endPos);
        } else {
          parts.push(t.slice(segStart, endPos));
          content = parts.join('');
        }
        if (junkTail && content.length > 0) {
          errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
        }
        value = prefix === '' ? content : prefix + content;
        ended = e;
      }

      fields.push(value);
      if (ended !== ENDED_COMMA) break;
    }

    // A line that held only stray CRs is left with no characters: no record
    // (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !lastQuoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }

  return { columns: header ? (columns === null ? [] : columns) : null, rows, errors };
}

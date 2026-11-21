[![CSV Reader Speed on make.fun](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
[![CSV Reader Speed rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/blupoint44/csv-reader-speed/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
[![CSV Reader Speed reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/blupoint44/csv-reader-speed/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)

# CSV Reader Speed

A faster drop-in replacement for make.fun's csv-reader 1.0.0: for every
input `{text, header}` it returns exactly csv-reader's answer
`{columns, rows, errors}` — the same fields, the same broken-row errors in
the same order — in a fraction of the CPU time.

## How the implementation works

`solve.js` exports `run(input)`; `main.ts` is the harness driver (Node 22):
it reads every case from `/input/cases.json`, answers each with `run`, and
writes `/output/answers.json`. The driver turns V8's incremental marking
off before importing `solve.js`, as the house baseline's driver does.

The reader implements csv-reader's policy exactly:

- A U+FEFF at the very start of the text is dropped.
- A record ends at LF or CRLF; a line left with no characters is no record.
- Outside quotes a CR not followed by LF is dropped (`stray_cr`).
- A field that opens with a quote runs to the next quote that is not
  doubled; `""` inside it is one quote, and each CRLF or lone CR inside it
  is read as LF. What follows the closing quote, up to the next comma or
  line break, is appended as it stands (`quote_junk`, when the field ends).
- A quote that never closes is a literal character, and the text after it
  is read again as unquoted (`unterminated_quote`).
- A quote inside an unquoted field is a literal character; fields stay
  strings, never trimmed or converted.
- `columns` is the first record when `header` is true, else null; `rows`
  holds the records after it, each padded with `""` (`short_row`) or cut
  (`long_row`) to the first record's width.
- Each error is `{code, line, row}` in the order met: `line` is the 1-based
  line its record starts on (counting every LF, CRLF and lone CR inside
  quotes), `row` its record's index in `rows`, null for the header.

Where the reference walks one character at a time and builds every field
character by character, this reader scans with `charCodeAt` in tight loops
and cuts finished fields out of the input with `slice`: a field that needs
no repair is a single slice, and only a field that actually drops a stray
CR, collapses a doubled quote or rewrites a CR inside quotes pays for
assembling pieces. The whole parse is one function with the unquoted scan
inlined, so the hot loops run on plain locals with no per-field calls or
result objects, no regular expressions, and no dependencies. Errors are
pushed in exactly the reference's order: an `unterminated_quote` before
the stray CRs of its re-read, a junk field's stray CRs before its
`quote_junk`, and a record's `short_row` or `long_row` when it ends.

## Measured local results

Local checks on the kit's practice set (6 cases, ~10.2M characters of CSV),
run on this machine (Node v24, shared CPU — the grader's absolute numbers
will differ; the comparison is what carries):

- Kit grader (`grade-local --driver process`): **passed 1, 6 of 6 cases
  identical**, and the L1 regrade reproduced the outputs byte for byte.
- Differential testing against the reference `readCsv`: **80,238 / 80,238
  identical** across a hand-built edge battery (quoting, embedded line
  breaks, CRLF, BOM, empty fields, trailing commas, stray CRs, junk after
  closing quotes, unterminated quotes, short/long rows), a special-heavy
  random fuzzer, and a structured row fuzzer — plus 6/6 on the practice
  set, and a byte-identical `answers.json` end to end.
- Parse time (`run()` only, median over repeated rounds of the full
  practice set): **~70 ms vs the reference's ~690 ms — about 10× faster**.
- End to end through `main.ts` (JSON read + parse + JSON write, wall):
  ~0.7 s vs the baseline's ~1.6 s.

## How to run

```sh
# the harness contract: cases in, answers out
MAKEFUN_INPUT_DIR=/path/to/input MAKEFUN_OUTPUT_DIR=/path/to/output node main.ts

# or grade against the competition kit's practice set
node cli/makefun.mjs grade-local --kit . --bot <this repo> --driver process
```

## Guide

- The bounty: [csv-reader-speed-01-run-20261121 on
  make.fun](https://make.fun/bounty/csv-reader-speed-01-run-20261121) —
  places go by CPU time (least first) among entries whose answers match
  csv-reader 1.0.0 on every case; a reward also requires beating the house
  baseline at 95% confidence. $100 total, $10 to each of the top 10.
- New to make.fun? Start at [make.fun](https://make.fun/?ref=cc9ads3n)
  (referral link of the submitting account, @blupoint44), download a
  competition kit, and build your own faster drop-in the same way: read
  the reference, match it exactly, then make it quick.

## License

MIT — see [LICENSE](LICENSE).

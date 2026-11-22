# Benchmark — csv-reader-speed-01-run-20261121

Practice set, 6 cases, ~10.5 MB of CSV in, ~12.1 MB of JSON out.
Each run is a fresh `node main.ts` process (like the grader's fresh
container), timed with `time -p` (user + sys CPU), 9 rounds each.
Machine: this Linux VM, Node v24.22.1 (the grader runs Node 22; the code
uses nothing newer than Node 22).

## R6 (this entry) vs the house baseline — full bench, 2026-11-23 ~00:10 WIB

| entry | mean | median | min | max |
| --- | --- | --- | --- | --- |
| house baseline (csv-reader 1.0.0) | 2.75 s | 2.69 s | 2.56 s | 3.03 s |
| this entry (R6) | 1.23 s | 1.24 s | 1.12 s | 1.36 s |

Speedup: **2.24×** (baseline mean / this entry's mean).

Raw rounds (seconds of CPU):

- baseline: 2.57, 2.56, 2.69, 2.66, 2.95, 2.87, 3.03, 2.63, 2.81
- this entry: 1.21, 1.27, 1.29, 1.24, 1.12, 1.24, 1.18, 1.17, 1.36

## R6 vs R5 (the live entry) — alternating A/B, same machine, same hour

The live R5 entry and this R6 entry were run in alternating fresh
processes, 9 rounds each, twice (18 rounds per entry). This controls for
the machine's load, which drifts between sessions (the baseline itself
measured 2.00 s when R5 was built and 2.75 s here).

| entry | pooled mean (18 rounds) |
| --- | --- |
| R5 (live, submission 01a1fd02) | 1.37 s |
| R6 (this entry) | 1.26 s |

**R6 is 7.9% faster than R5 on the same machine in the same hour**
(A/B run 1: 1.242 s vs 1.388 s; run 2: 1.274 s vs 1.344 s).
The only change from R5 is `main.ts`: answers are now rendered one
case at a time and written straight to the file as they are rendered,
instead of being collected into one big array and joined at the end —
each case's answer object is let go once its JSON is written down, so
the peak live set stays one case instead of all six, and no 12 MB
joined copy is ever built. The parser (`solve.js`) is byte-identical
to R5's.

## What did not win (measured, kept out)

- Parser restructure, bounds-based line parser with bulk plain-run
  splits: 4.2% slower than R5 (7 alternating rounds).
- Parser restructure, split-then-glue quoted fields: 14.3% slower
  than R5 (9 alternating rounds).
- `--max-semi-space-size=256` instead of 64: 6.4% slower under the
  streaming driver (9 alternating rounds); also a wash on the old
  driver (4.3% faster once, 1.7% slower on the repeat).
- `--single-generation`: no difference (9 alternating rounds).

Correctness on the same runs: this entry's `answers.json` is byte-identical
to the baseline's (12,073,155 bytes), and two runs of this entry write
identical bytes (deterministic).

Where the time goes (fresh-process phase probe, R5 driver, this VM):

- `run()` parsing all 6 cases, first pass: ~0.60 s (a second pass in the
  same process is ~0.30 s — the first pass carries JIT warm-up and heap
  growth; the warmed parse itself is ~0.20–0.30 s)
- `JSON.stringify` of the answers (one case at a time): ~0.17–0.32 s
- `JSON.parse` of `cases.json` (11.1 MB) + reading it + Node startup: ~0.30 s
- writing `answers.json` (12 MB): ~0.08–0.15 s

Correctness (differential test against csv-reader 1.0.0 itself):

- practice set: 6/6 cases identical to `practice/reference/expected.json`
- 50,124 fuzzed edge inputs (R5; `solve.js` is byte-identical, so the
  evidence carries over) identical, plus 20,124 re-run on this entry
- 30 freshly drawn generator cases (R5) identical, plus 12 re-run
- `grade-local` (server-identical, process driver): **passed 1,
  cases_passed 6/6, 6 of 6 points, L1 regrade reproduced byte for byte**,
  eligible ranked yes / prize yes.
  result_sha256 `eccdf880b819ceba59a24580c2afc6af5c0f703dd1a53e0556b5e165b7dcf6bd`
  (differs from the server's only because the server runs Node v26.13.1,
  this VM v24.22.1).

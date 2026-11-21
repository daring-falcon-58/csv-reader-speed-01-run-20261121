# Benchmark — csv-reader-speed-01-run-20261121

Practice set, 6 cases, ~10.5 MB of CSV in, ~12.1 MB of JSON out.
Each run is a fresh `node main.ts` process (like the grader's fresh
container), timed with `time -p` (user + sys CPU), 9 rounds each.
Machine: this Linux VM, Node v24.22.1 (the grader runs Node 22; the code
uses nothing newer than Node 22).

| entry | mean | median | min | max |
| --- | --- | --- | --- | --- |
| house baseline (csv-reader 1.0.0) | 2.00 s | 2.08 s | 1.70 s | 2.27 s |
| this entry | 0.88 s | 0.86 s | 0.82 s | 0.96 s |

Speedup: **2.28×** (baseline mean / this entry's mean).

Raw rounds (seconds of CPU):

- baseline: 2.27, 1.87, 1.70, 1.72, 2.12, 2.08, 2.13, 2.21, 1.86
- this entry: 0.88, 0.85, 0.89, 0.86, 0.96, 0.90, 0.86, 0.86, 0.82

Correctness on the same runs: this entry's `answers.json` is byte-identical
to the baseline's (12,073,155 bytes), and two runs of this entry write
identical bytes (deterministic).

Where the time goes (in-process profile of one run, warmed):

- `run()` parsing all 6 cases: ~0.24 s
- `JSON.stringify` of the answers (one case at a time): ~0.12–0.17 s
- `JSON.parse` of `cases.json` (11.1 MB): ~0.05 s
- reading `cases.json` + writing `answers.json`: ~0.09 s
- Node startup + module load: ~0.05 s

For scale: the house reports the baseline at 1.38 s and d3-dsv at 0.73 s
on its own rented box for the same size of set. This entry is 0.44× the
baseline's time on this machine, which would put it around 0.6 s on the
house's box — faster than the house's d3-dsv figure. That is a
cross-machine estimate, not a measurement; the heat decides.

Correctness (differential test against csv-reader 1.0.0 itself):

- practice set: 6/6 cases identical to `practice/reference/expected.json`
- 50,124 fuzzed edge inputs (quoted newlines, stray quotes, mixed line
  endings, ragged rows, BOM, empty input, unterminated quotes): identical
- 30 freshly drawn generator cases (fresh seeds): identical

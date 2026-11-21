// csv-reader-speed-01-run-20261121 — the program the harness runs.
//
// Node runs `node /bot/main.ts`. It reads every case from /input/cases.json,
// answers each one alone with run() from solve.js, and writes the answers,
// one per case and in the cases' order, to /output/answers.json.
//
// The answers are rendered one case at a time and joined, instead of
// stringifying one big array at the end: each case's answer object is let go
// once its JSON is written down, so the peak live set stays one case instead
// of all six. The output is byte-for-byte deterministic — the same cases
// always write the same file — because JSON.stringify is deterministic for a
// fixed value and the cases run in file order.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setFlagsFromString } from 'node:v8';

// V8's incremental marking off, set before solve.js is imported so all of
// its work runs under it (the rules allow an entry to tune V8's flags the
// same way the house baseline does). A roomier young generation (64 MiB)
// keeps the short-lived field strings and row arrays out of the old
// generation while a case is read: measured about 4% faster than the
// default on the practice set, and far under the sandbox's memory cap.
setFlagsFromString('--no-incremental-marking --max-semi-space-size=64');

/** solve.js, imported by its URL (a .js module carries no types). */
const { run } = (await import(new URL('./solve.js', import.meta.url).href)) as {
  run: (input: unknown) => unknown;
};

const inputDir = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const outputDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

const cases = JSON.parse(readFileSync(join(inputDir, 'cases.json'), 'utf8')) as {
  id: string;
  input: unknown;
}[];
const rendered: string[] = [];
for (const entry of cases) rendered.push(JSON.stringify(run(entry.input)));
writeFileSync(join(outputDir, 'answers.json'), `[${rendered.join(',')}]`);

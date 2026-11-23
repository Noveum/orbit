import { readFile } from 'node:fs/promises';

const serverOutput = 'dist/server';
const looseDecision =
  /isFinite\([^()]*\)\)[^;{}]*?return\s*(?:!1|false)[\s;}]*return\s+[\w$]+\.loose\s*=/g;
const stringsBindWhenTypesAreNotFetched = /string[^;{}]*\.fetch_types\s*[!=]==\s*(?:!1|false\b)/;
let decisions = 0;

for await (const file of new Bun.Glob('**/*.js').scan({ cwd: serverOutput, absolute: true })) {
  const source = await readFile(file, 'utf8');
  for (const [decision] of source.matchAll(looseDecision)) {
    if (!stringsBindWhenTypesAreNotFetched.test(decision)) {
      throw new Error(`The Workers server bundle contains an unpatched Postgres driver in ${file}`);
    }
    decisions += 1;
  }
}

if (decisions === 0)
  throw new Error('The Workers server bundle contains no Postgres describe decision');

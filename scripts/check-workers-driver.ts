import { readFile } from 'node:fs/promises';

const serverOutput = 'dist/server';
const describeDecision = /\.describeFirst\s*=\s*[^,;{}]*?\.onlyDescribe\b[^,;{}]*/g;
const fetchTypesGuard = /\.fetch_types\s*!==\s*(?:false\b|!1\b)/;
let decisions = 0;

for await (const file of new Bun.Glob('**/*.js').scan({ cwd: serverOutput, absolute: true })) {
  const source = await readFile(file, 'utf8');
  for (const [decision] of source.matchAll(describeDecision)) {
    if (!fetchTypesGuard.test(decision)) {
      throw new Error(`The Workers server bundle contains an unpatched Postgres driver in ${file}`);
    }
    decisions += 1;
  }
}

if (decisions === 0)
  throw new Error('The Workers server bundle contains no Postgres describe decision');

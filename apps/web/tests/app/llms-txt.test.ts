import { describe, expect, it } from 'bun:test';
import { GET } from '../../src/app/llms.txt/route.ts';

async function body(): Promise<string> {
  return await GET().text();
}

describe('/llms.txt', () => {
  it('calls Orbit a task manager, which is what people search for', async () => {
    expect(await body()).toContain('task manager');
  });

  it('never goes back to calling it a work tracker', async () => {
    expect(await body()).not.toContain('work tracker');
  });

  it('says it is free with no paid tier, since that is the whole point', async () => {
    const text = await body();

    expect(text).toContain('no paid tier');
    expect(text).toContain('free, forever');
  });

  it('says it is open source and self-hostable', async () => {
    const text = await body();

    expect(text).toContain('Apache-2.0');
    expect(text).toContain('self-hosted');
    expect(text).toContain('https://github.com/Noveum/orbit');
  });

  it('does not advertise the disabled Slack integration', async () => {
    expect(await body()).not.toMatch(/slack/i);
  });

  it('serves plain text, because that is what the file is for', () => {
    expect(GET().headers.get('content-type')).toBe('text/plain; charset=utf-8');
  });

  it('opens with the heading a reader expects', async () => {
    expect((await body()).startsWith('# Orbit')).toBe(true);
  });
});

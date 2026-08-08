import { describe, expect, it } from 'bun:test';
import { branchName, issuePrompt } from '../../src/utils/index.ts';

const base = {
  identifier: 'ENG-42',
  title: 'Fan out delta packets',
  branch: 'shashank/eng-42-fan-out-delta-packets',
};

describe('issuePrompt', () => {
  it('opens with the issue and the branch somebody would check out', () => {
    const prompt = issuePrompt(base);

    expect(prompt.startsWith('Work on Orbit issue ENG-42:')).toBe(true);
    expect(prompt).toContain('Suggested branch name: shashank/eng-42-fan-out-delta-packets');
    expect(prompt).toContain('<issue identifier="ENG-42">');
    expect(prompt).toContain('<title>Fan out delta packets</title>');
    expect(prompt.endsWith('</issue>')).toBe(true);
  });

  it('carries the context an agent needs to start work', () => {
    const prompt = issuePrompt({
      ...base,
      team: 'Engineering',
      state: 'In Progress',
      priority: 'Urgent',
      assignee: 'shashank',
      project: 'API.market',
      labels: ['marketing', 'infra'],
      url: 'https://orbit.noveum.ai/issue/ENG-42',
    });

    expect(prompt).toContain('<team name="Engineering"/>');
    expect(prompt).toContain('<state name="In Progress"/>');
    expect(prompt).toContain('<priority name="Urgent"/>');
    expect(prompt).toContain('<assignee name="shashank"/>');
    expect(prompt).toContain('<label>marketing</label>');
    expect(prompt).toContain('<label>infra</label>');
    expect(prompt).toContain('<project name="API.market"/>');
    expect(prompt).toContain('<url>https://orbit.noveum.ai/issue/ENG-42</url>');
  });

  it('leaves out every field the issue does not have, rather than printing empty tags', () => {
    const prompt = issuePrompt({ ...base, team: null, project: null, labels: [] });

    expect(prompt).not.toContain('<team');
    expect(prompt).not.toContain('<project');
    expect(prompt).not.toContain('<label>');
    expect(prompt).not.toContain('<description>');
  });

  it('includes a description but drops one that is only whitespace', () => {
    expect(issuePrompt({ ...base, description: 'Reconnect replays by sync id.' })).toContain(
      '<description>\nReconnect replays by sync id.\n</description>',
    );
    expect(issuePrompt({ ...base, description: '   \n  ' })).not.toContain('<description>');
  });

  it('escapes markup so a crafted title cannot forge a tag', () => {
    const prompt = issuePrompt({
      ...base,
      title: 'Fix <script> & "quotes"',
      team: 'A & B',
    });

    expect(prompt).toContain('<title>Fix &lt;script&gt; &amp; &quot;quotes&quot;</title>');
    expect(prompt).toContain('<team name="A &amp; B"/>');
    expect(prompt).not.toContain('<script>');
  });

  it('agrees with branchName, so the prompt suggests the branch the copy button gives', () => {
    const branch = branchName({
      username: 'shashank',
      identifier: 'ENG-42',
      title: 'Fan out delta packets',
    });

    expect(issuePrompt({ ...base, branch })).toContain(`Suggested branch name: ${branch}`);
  });
});

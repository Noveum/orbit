import { describe, expect, it } from 'bun:test';
import { renderMarkdown } from '@orbit/services/markdown';
import { Editor } from '@tiptap/core';
import { findTrigger, matchSlashCommands, SLASH_COMMANDS } from './commands.ts';
import { editorExtensions, type MenuKey, toEditorHtml } from './extensions.ts';
import { calloutToneOf, docToMarkdown } from './markdown.ts';

const handler = { current: (_key: MenuKey) => false };

function mount(markdown: string): Editor {
  const element = document.createElement('div');
  document.body.append(element);
  return new Editor({
    element,
    extensions: editorExtensions(handler),
    content: toEditorHtml(renderMarkdown(markdown)),
  });
}

function roundTrip(markdown: string): string {
  const editor = mount(markdown);
  const out = docToMarkdown(editor.getJSON());
  editor.destroy();
  return out.trimEnd();
}

describe('markdown round trip', () => {
  it('keeps every construct a stored doc can already contain', () => {
    const source = [
      '# Delta protocol',
      '',
      'Every mutation bumps `sync_id` and publishes a **SyncAction**.',
      '',
      '## Rules',
      '',
      '| Rule | Why |',
      '| --- | --- |',
      '| Batch | Speed |',
      '',
      '- [x] Fan out from Redis',
      '- [ ] Suppress the local echo',
      '',
      '1. First',
      '2. Second',
      '',
      '- plain bullet',
      '',
      '> quoted line',
      '',
      '```ts',
      'const a = 1;',
      '```',
      '',
      '![diagram](/api/files/a.png)',
      '',
      '[docs](https://orbit.test/docs)',
      '',
      '---',
    ].join('\n');

    expect(roundTrip(source)).toBe(source);
  });

  it('does not lose a task list checkbox on the way through the editor', () => {
    expect(roundTrip('- [x] done\n- [ ] next')).toBe('- [x] done\n- [ ] next');
  });

  it('round trips a callout as a labelled quote and a toggle as details', () => {
    expect(roundTrip('> **Warning**\n> Read the rollback step first.')).toBe(
      '> **Warning**\n> Read the rollback step first.',
    );
    expect(roundTrip('<details>\n<summary>More</summary>\n\nHidden body\n\n</details>')).toBe(
      '<details>\n<summary>More</summary>\n\nHidden body\n\n</details>',
    );
  });

  it('maps a plain blockquote to a quote and a labelled one to a callout', () => {
    const callout = mount('> **Note**\n> Body');
    const quote = mount('> Body');
    expect(callout.getJSON().content?.[0]?.type).toBe('callout');
    expect(quote.getJSON().content?.[0]?.type).toBe('blockquote');
    callout.destroy();
    quote.destroy();
  });

  it('escapes characters that would otherwise become markup on the next save', () => {
    expect(roundTrip('a \\* b')).toBe('a \\* b');
    expect(roundTrip('snake_case_name stays whole')).toBe('snake_case_name stays whole');
  });

  it('recognises only the tones it can render', () => {
    expect(calloutToneOf('Warning')).toBe('warning');
    expect(calloutToneOf(' note ')).toBe('note');
    expect(calloutToneOf('Heads up')).toBeNull();
  });
});

describe('editor commands', () => {
  it('inserts every block type the slash menu advertises', () => {
    for (const command of SLASH_COMMANDS) {
      if (command.id === 'image') continue;
      const editor = mount('');
      command.run(editor, () => undefined);
      const markdown = docToMarkdown(editor.getJSON());
      expect(markdown.length).toBeGreaterThan(0);
      editor.destroy();
    }
  });

  it('turns a paragraph into a heading, a task list and a code block', () => {
    const editor = mount('hello');
    editor.chain().focus().toggleHeading({ level: 2 }).run();
    expect(docToMarkdown(editor.getJSON()).trimEnd()).toBe('## hello');

    editor.chain().focus().toggleHeading({ level: 2 }).toggleTaskList().run();
    expect(docToMarkdown(editor.getJSON()).trimEnd()).toBe('- [ ] hello');
    editor.destroy();
  });

  it('filters the slash menu by label', () => {
    expect(matchSlashCommands('').length).toBe(SLASH_COMMANDS.length);
    expect(matchSlashCommands('task').map((command) => command.id)).toEqual(['task-list']);
    expect(matchSlashCommands('zzz')).toEqual([]);
  });
});

describe('findTrigger', () => {
  it('opens on a fresh slash or at sign and closes once the word is finished', () => {
    expect(findTrigger('/tab', 4)).toEqual({ kind: 'slash', query: 'tab', from: 0 });
    expect(findTrigger('ping @sha', 9)).toEqual({ kind: 'mention', query: 'sha', from: 5 });
    expect(findTrigger('mail me at me@example.com', 25)).toBeNull();
    expect(findTrigger('a/b', 3)).toBeNull();
    expect(findTrigger('done ', 5)).toBeNull();
  });
});

describe('toEditorHtml', () => {
  it('labels rendered checkbox lists so the editor keeps them as tasks', () => {
    const html = toEditorHtml(renderMarkdown('- [x] done\n- [ ] next'));
    expect(html).toContain('data-type="taskList"');
    expect(html).toContain('data-checked="true"');
    expect(html).toContain('data-checked="false"');
  });

  it('leaves an ordinary list alone', () => {
    const html = toEditorHtml(renderMarkdown('- one\n- two'));
    expect(html).not.toContain('taskList');
  });
});

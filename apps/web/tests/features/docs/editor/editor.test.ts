import { describe, expect, it, mock } from 'bun:test';
import { renderMarkdown } from '@orbit/services/markdown';
import { Editor } from '@tiptap/core';
import {
  findTrigger,
  matchSlashCommands,
  SLASH_COMMANDS,
} from '../../../../src/features/docs/editor/commands.ts';
import {
  editorExtensions,
  type MenuKey,
  toEditorHtml,
} from '../../../../src/features/docs/editor/extensions.ts';
import { calloutToneOf, docToMarkdown } from '../../../../src/features/docs/editor/markdown.ts';

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

  it('does not lose the box on a task nested under a bullet', () => {
    expect(roundTrip('- outer\n  - [ ] nested')).toBe('- outer\n  - [ ] nested');
  });

  it('keeps a task nested under another task', () => {
    expect(roundTrip('- [ ] top\n  - [x] child')).toBe('- [ ] top\n  - [x] child');
  });

  it('keeps underline and highlight marks that markdown alone cannot express', () => {
    expect(roundTrip('An <u>underlined</u> word.')).toBe('An <u>underlined</u> word.');
    expect(roundTrip('A <mark>highlighted</mark> word.')).toBe('A <mark>highlighted</mark> word.');
  });

  it('nests underline over an emphasised run without dropping either mark', () => {
    const editor = mount('start');
    editor.chain().focus().selectAll().toggleBold().toggleUnderline().run();
    expect(docToMarkdown(editor.getJSON()).trimEnd()).toBe('<u>**start**</u>');
    editor.destroy();
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

  it('finds the attachment command by the words people type for it', () => {
    for (const query of ['file', 'attach', 'attachment', 'upload', 'pdf', 'screenshot']) {
      expect(matchSlashCommands(query).map((command) => command.id)).toEqual(['image']);
    }
  });

  it('hands the attachment command the file picker to open', () => {
    const editor = mount('');
    const pick = mock();
    const command = SLASH_COMMANDS.find((entry) => entry.id === 'image');

    command?.run(editor, pick);

    expect(command).toBeDefined();
    expect(pick).toHaveBeenCalledTimes(1);
    expect(docToMarkdown(editor.getJSON()).trim()).toBe('');
    editor.destroy();
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

  it('does not turn a bullet into a task because a task list hangs off it', () => {
    const html = toEditorHtml(renderMarkdown('- outer\n  - [ ] nested'));

    expect(html).toContain('<ul>');
    expect(html).not.toMatch(/data-checked="[^"]*"><p>outer/);
    expect(html.match(/data-type="taskItem"/g)).toHaveLength(1);
  });

  it('keeps the nested box on the item that owns it', () => {
    const html = toEditorHtml(renderMarkdown('- outer\n  - [ ] nested'));

    expect(html).toContain('nested');
    expect(html.match(/data-checked/g)).toHaveLength(1);
  });

  it('keeps a nested list out of the paragraph it wraps the text in', () => {
    const html = toEditorHtml(renderMarkdown('- [ ] top\n  - [x] child'));

    expect(html).not.toMatch(/<p>[^<]*<ul/);
    expect(html.match(/data-type="taskList"/g)).toHaveLength(2);
  });

  it('wraps loose text that pasted markup left beside a paragraph', () => {
    const html = toEditorHtml('<ul><li><input type="checkbox"> lead<p>tail</p></li></ul>');

    expect(html).toContain('<p> lead</p>');
    expect(html).toContain('<p>tail</p>');
  });

  it('does not invent an empty paragraph out of the whitespace between blocks', () => {
    const html = toEditorHtml(
      '<ul>\n<li>\n<p><input type="checkbox"> boxed</p>\n<p>tail</p>\n</li>\n</ul>',
    );

    expect(html).not.toMatch(/<p>\s*<\/p>/);
    expect(html).toContain('data-checked="false"');
  });
});

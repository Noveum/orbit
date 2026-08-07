# Keyboard shortcuts

Orbit assumes you would rather not use the mouse. Press <kbd>?</kbd> anywhere to
see the shortcuts that apply to what you are currently looking at.

Every shortcut on this page is read from the registry in the running app, so if
one here disagrees with what <kbd>?</kbd> shows you, trust <kbd>?</kbd> and
please [file a docs issue](https://github.com/Noveum/orbit/issues/new?template=documentation.yml).

## The two you actually need

| Keys | Does |
| --- | --- |
| <kbd>Cmd</kbd> <kbd>K</kbd> | Command palette. Search issues, run any command, jump anywhere |
| <kbd>?</kbd> | Show the shortcuts that apply right now |

The palette is the fastest route to most things. Type an issue identifier like
`ENG-42` to jump straight to it, or type what you want to do and run it.

On Windows and Linux, <kbd>Ctrl</kbd> stands in for <kbd>Cmd</kbd> everywhere.

## Navigation

Press <kbd>g</kbd>, release it, then press the second key.

| Keys | Goes to |
| --- | --- |
| <kbd>g</kbd> <kbd>i</kbd> | Inbox |
| <kbd>g</kbd> <kbd>m</kbd> | My issues |
| <kbd>g</kbd> <kbd>r</kbd> | Pull requests |
| <kbd>g</kbd> <kbd>p</kbd> | Projects |
| <kbd>g</kbd> <kbd>t</kbd> | Sprints |
| <kbd>g</kbd> <kbd>s</kbd> | Standup |
| <kbd>g</kbd> <kbd>v</kbd> | Views |
| <kbd>g</kbd> <kbd>a</kbd> | Analytics |
| <kbd>g</kbd> <kbd>d</kbd> | Docs |

## Issues

These work on the issue list and the board, acting on whatever is selected.

### Moving around

| Keys | Does |
| --- | --- |
| <kbd>j</kbd> or <kbd>Down</kbd> | Next issue |
| <kbd>k</kbd> or <kbd>Up</kbd> | Previous issue |
| <kbd>Enter</kbd> | Open the issue |
| <kbd>Space</kbd> | Peek at the issue without leaving the list |
| <kbd>Esc</kbd> | Close the peek, then clear the selection |

<kbd>Esc</kbd> does one thing at a time on purpose. The first press closes the
peek, the second clears the selection, so you never lose a selection you meant
to keep.

### Selecting

| Keys | Does |
| --- | --- |
| <kbd>x</kbd> | Select or deselect the current issue |
| <kbd>Shift</kbd> <kbd>j</kbd> or <kbd>Shift</kbd> <kbd>Down</kbd> | Extend the selection down |
| <kbd>Shift</kbd> <kbd>k</kbd> or <kbd>Shift</kbd> <kbd>Up</kbd> | Extend the selection up |
| <kbd>Cmd</kbd> <kbd>A</kbd> | Select every issue |

Selecting several issues and then pressing <kbd>s</kbd>, <kbd>p</kbd>,
<kbd>a</kbd> or <kbd>l</kbd> changes them all at once.

### Changing an issue

| Keys | Does |
| --- | --- |
| <kbd>c</kbd> | Create a new issue |
| <kbd>s</kbd> | Change status |
| <kbd>p</kbd> | Change priority |
| <kbd>a</kbd> | Assign |
| <kbd>l</kbd> | Change labels |
| <kbd>i</kbd> | Change project |
| <kbd>m</kbd> | Change milestone |
| <kbd>Shift</kbd> <kbd>e</kbd> | Change estimate |

Each opens a menu you then drive with the keyboard, so `a` then a few letters of
a name then <kbd>Enter</kbd> reassigns an issue without touching the mouse.

## Filters and views

| Keys | Does |
| --- | --- |
| <kbd>f</kbd> | Add a filter |
| <kbd>Shift</kbd> <kbd>f</kbd> | Remove the last filter condition |
| <kbd>Alt</kbd> <kbd>Shift</kbd> <kbd>f</kbd> | Clear every filter |
| <kbd>Alt</kbd> <kbd>v</kbd> | Save the current filter as a view |
| <kbd>Esc</kbd> | Close the filter editor |

## Inbox

| Keys | Does |
| --- | --- |
| <kbd>j</kbd> or <kbd>Down</kbd> | Next notification |
| <kbd>k</kbd> or <kbd>Up</kbd> | Previous notification |
| <kbd>u</kbd> | Toggle read and unread |
| <kbd>h</kbd> | Snooze for a day |
| <kbd>Backspace</kbd> | Delete the notification |

## Docs

| Keys | Does |
| --- | --- |
| <kbd>c</kbd> | New doc |

<kbd>c</kbd> only appears when you have permission to write docs, which
contributors and guests do not.

## View

| Keys | Does |
| --- | --- |
| <kbd>Cmd</kbd> <kbd>B</kbd> | Switch between board and list |
| <kbd>[</kbd> | Toggle the left sidebar |
| <kbd>]</kbd> | Toggle the right panel |

The theme toggle has no key of its own. Run it from the command palette.

## How the shortcuts resolve

Worth knowing if a shortcut ever does something you did not expect.

Shortcuts are registered with a **scope**, meaning the surface they belong to,
and a **priority**. When more than one could match, Orbit picks in this order:

1. A longer sequence beats a shorter one, so <kbd>g</kbd> <kbd>i</kbd> wins over
   a plain <kbd>g</kbd>.
2. A higher priority wins, so a surface-specific shortcut beats a global one.
3. Where those tie, the more specific one wins, meaning the one using
   <kbd>Shift</kbd>.

This is why <kbd>j</kbd> moves through notifications in the inbox and through
issues on a board, without either surface having to know about the other.

Shortcuts do not fire while you are typing in a text field, unless they were
explicitly registered to. <kbd>Esc</kbd> and <kbd>Cmd</kbd> <kbd>K</kbd> still
work in an input, because you always need a way out.

## Adding one

Shortcuts are registered with the `useHotkey` hook, and being in the registry is
what makes a shortcut appear in the <kbd>?</kbd> dialog. There is no separate
list to update:

```ts
useHotkey('shift+d', duplicateIssue, {
  label: 'Duplicate issue',
  section: 'Issues',
  scope: 'issues',
});
```

Set `advertised: false` for something that should work but not be listed. See
`apps/web/src/lib/keyboard/` and [CONTRIBUTING.md](../CONTRIBUTING.md).

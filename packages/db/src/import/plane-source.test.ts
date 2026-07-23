import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { isImportableComment } from './importable.ts';
import { readPlaneExport } from './plane-source.ts';

const roots: string[] = [];

function project(identifier: string) {
  return {
    id: `id-${identifier}`,
    identifier,
    name: identifier,
    description: '',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: null,
    archived_at: null,
    project_lead: null,
  };
}

function makeExport(identifiers: readonly string[], cached: readonly string[]): string {
  const root = mkdtempSync(resolve(tmpdir(), 'plane-export-'));
  roots.push(root);
  writeFileSync(resolve(root, 'members.json'), JSON.stringify([]));
  writeFileSync(
    resolve(root, 'projects.json'),
    JSON.stringify(identifiers.map((identifier) => project(identifier))),
  );
  writeFileSync(resolve(root, 'workspace-pages.json'), JSON.stringify([]));

  for (const identifier of cached) {
    const directory = resolve(root, identifier);
    mkdirSync(directory, { recursive: true });
    writeFileSync(resolve(directory, 'issues.json'), JSON.stringify([]));
    writeFileSync(resolve(directory, 'states.json'), JSON.stringify([]));
    writeFileSync(resolve(directory, 'cycle-issues.json'), JSON.stringify({}));
    writeFileSync(resolve(directory, 'module-issues.json'), JSON.stringify({}));
  }
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('reading a plane export', () => {
  it('reads every project that has a cached directory', () => {
    const root = makeExport(['ENG', 'MKT'], ['ENG', 'MKT']);
    const source = readPlaneExport(root);
    expect(source.projects.map((entry) => entry.project.identifier)).toEqual(['ENG', 'MKT']);
  });

  it('refuses an incomplete export rather than importing a subset', () => {
    const root = makeExport(['ENG', 'MKT'], ['ENG']);
    expect(() => readPlaneExport(root)).toThrow(/incomplete.*MKT/s);
  });

  it('accepts a missing project the exporter recorded as unreadable', () => {
    const root = makeExport(['ENG', 'SEO'], ['ENG']);
    writeFileSync(resolve(root, 'inaccessible.json'), JSON.stringify(['SEO']));
    const source = readPlaneExport(root);
    expect(source.projects.map((entry) => entry.project.identifier)).toEqual(['ENG']);
    expect(source.inaccessible).toEqual(['SEO']);
  });
});

describe('deciding whether a comment survives the import', () => {
  it('keeps a comment with text', () => {
    expect(isImportableComment('<p>Shipped it</p>')).toBe(true);
  });

  it('keeps a comment that is only an image', () => {
    expect(
      isImportableComment(
        '<image-component data-id="x" src="d15ef111-8cc4-45d6-9ca0-0b2adc5594a7"></image-component>',
      ),
    ).toBe(true);
  });

  it('drops a comment that is empty once markup is stripped', () => {
    expect(isImportableComment('<p></p>')).toBe(false);
    expect(isImportableComment('')).toBe(false);
    expect(isImportableComment(null)).toBe(false);
  });
});

describe('the image tag pattern', () => {
  const valid = 'd15ef111-8cc4-45d6-9ca0-0b2adc5594a7';

  it('does not treat a different tag with the same prefix as an image', () => {
    expect(
      isImportableComment(`<image-component-extra src="${valid}"></image-component-extra>`),
    ).toBe(false);
  });

  it('requires a canonical uuid, not any thirty six characters', () => {
    expect(
      isImportableComment('<image-component src="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa">'),
    ).toBe(false);
    expect(isImportableComment(`<image-component src="${valid}">`)).toBe(true);
  });

  it('accepts a self closing tag', () => {
    expect(isImportableComment(`<image-component src="${valid}" />`)).toBe(true);
  });
});

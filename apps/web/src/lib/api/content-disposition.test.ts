import { describe, expect, it } from 'bun:test';
import { dispositionFor } from './content-disposition.ts';

describe('dispositionFor', () => {
  it('previews the media types a browser renders safely', () => {
    expect(dispositionFor('image/png', 'shot.png')).toBe('inline; filename="shot.png"');
    expect(dispositionFor('application/pdf', 'spec.pdf')).toBe('inline; filename="spec.pdf"');
  });

  it('forces a download for anything that could execute in the app origin', () => {
    expect(dispositionFor('image/svg+xml', 'logo.svg')).toBe('attachment; filename="logo.svg"');
    expect(dispositionFor('text/html', 'page.html')).toBe('attachment; filename="page.html"');
  });

  it('neutralizes quotes and newlines in the file name', () => {
    expect(dispositionFor('text/plain', 'we"ird\r\nname.txt')).toBe(
      'attachment; filename="we_ird__name.txt"',
    );
  });
});

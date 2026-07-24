import { describe, expect, it } from 'bun:test';
import { dispositionFor } from './content-disposition.ts';

describe('dispositionFor', () => {
  it('previews the media types a browser renders safely', () => {
    expect(dispositionFor('image/png', 'shot.png')).toBe(
      `inline; filename="shot.png"; filename*=UTF-8''shot.png`,
    );
    expect(dispositionFor('application/pdf', 'spec.pdf')).toBe(
      `inline; filename="spec.pdf"; filename*=UTF-8''spec.pdf`,
    );
  });

  it('forces a download for anything that could execute in the app origin', () => {
    expect(dispositionFor('image/svg+xml', 'logo.svg')).toBe(
      `attachment; filename="logo.svg"; filename*=UTF-8''logo.svg`,
    );
    expect(dispositionFor('text/html', 'page.html')).toBe(
      `attachment; filename="page.html"; filename*=UTF-8''page.html`,
    );
  });

  it('neutralizes quotes and newlines in the ascii fallback name', () => {
    expect(dispositionFor('text/plain', 'we"ird\r\nname.txt')).toBe(
      `attachment; filename="we_ird__name.txt"; filename*=UTF-8''we%22ird%0D%0Aname.txt`,
    );
  });

  it('keeps the presigned value ascii and round trips the real name via filename*', () => {
    const fileName = 'Designing–Data’s–O’Reilly (2017).pdf';
    const disposition = dispositionFor('application/pdf', fileName);
    expect(/^[\x20-\x7e]*$/.test(disposition)).toBe(true);
    expect(disposition.startsWith('inline; filename="Designing_Data_s_O_Reilly (2017).pdf"')).toBe(
      true,
    );
    const encoded = disposition.split("filename*=UTF-8''")[1];
    expect(encoded).toBeDefined();
    expect(decodeURIComponent(encoded ?? '')).toBe(fileName);
  });
});

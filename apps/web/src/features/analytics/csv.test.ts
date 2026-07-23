import { describe, expect, it } from 'bun:test';
import { csvCell, toCsv } from './csv.ts';

describe('csvCell', () => {
  it('leaves plain values untouched', () => {
    expect(csvCell('Ada')).toBe('Ada');
    expect(csvCell(42)).toBe('42');
  });

  it('quotes and escapes cells with commas, quotes or newlines', () => {
    expect(csvCell('Doe, Jane')).toBe('"Doe, Jane"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('line\nbreak')).toBe('"line\nbreak"');
  });
});

describe('toCsv', () => {
  it('joins rows with CRLF and cells with commas', () => {
    const csv = toCsv([
      ['Name', 'Completed', 'Total'],
      ['Ada Admin', 3, 5],
      ['Doe, Jane', 1, 2],
    ]);
    expect(csv).toBe('Name,Completed,Total\r\nAda Admin,3,5\r\n"Doe, Jane",1,2');
  });
});

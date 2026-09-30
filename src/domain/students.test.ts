import fixture from '../../data/gradebook.fixture.json';
import { buildGradebook } from './buildGradebook';
import { gradebookSchema } from './contract';
import { filterStudents, sortStudents } from './students';

const rows = buildGradebook(gradebookSchema.parse(fixture)).rows;
const names = (r: typeof rows) =>
  r.map((x) => x.fullName.replace('Fixture Student ', '').split(' ')[0]);

describe('filterStudents', () => {
  it('matches by name, case- and accent-insensitively', () => {
    expect(names(filterStudents(rows, 'bRAvo'))).toEqual(['Bravo']);
  });
  it('matches by account number', () => {
    expect(names(filterStudents(rows, 'FX0003'))).toEqual(['Charlie']);
  });
  it('empty query returns everyone', () => {
    expect(filterStudents(rows, '  ')).toHaveLength(rows.length);
  });
});

describe('sortStudents', () => {
  it('sorts alphabetically by name', () => {
    expect(names(sortStudents(rows, 'name', 'asc'))[0]).toBe('Alpha');
    expect(names(sortStudents(rows, 'name', 'desc'))[0]).toBe('Golf');
  });
  it('sorts by account', () => {
    expect(names(sortStudents([...rows].reverse(), 'account', 'asc'))[0]).toBe('Alpha');
  });
  it('sorts by final and keeps incomplete last in both directions', () => {
    const desc = sortStudents(rows, 'final', 'desc');
    const asc = sortStudents(rows, 'final', 'asc');
    expect(names(desc).slice(0, 2)).toEqual(['Charlie', 'Alpha']);
    expect(names(asc).slice(0, 2)).toEqual(['Bravo', 'Delta']);
    for (const sorted of [desc, asc]) {
      expect(sorted.slice(-3).every((r) => r.finalGrade === null)).toBe(true);
    }
  });
});

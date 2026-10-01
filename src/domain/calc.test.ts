import { calculateFinalGrade } from './calc';

describe('calculateFinalGrade', () => {
  it('sums the three contributions', () => {
    expect(calculateFinalGrade(36, 32, 17)).toBe(85);
    expect(calculateFinalGrade(36, 34, 18)).toBe(88);
  });
  it('avoids float noise on API-rounded contributions', () => {
    expect(calculateFinalGrade(38.67, 34, 18.22)).toBe(90.89);
  });
  it('accepts real zero contributions', () => {
    expect(calculateFinalGrade(0, 0, 0)).toBe(0);
  });
  it('is null (INCOMPLETA) when any block is missing; never zero-filled or renormalised', () => {
    expect(calculateFinalGrade(36, null, 18)).toBeNull();
    expect(calculateFinalGrade(null, null, null)).toBeNull();
  });
});

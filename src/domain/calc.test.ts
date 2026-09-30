import { calculateAverage, calculateContribution, calculateFinalGrade } from './calc';

describe('calculateAverage', () => {
  it('excludes null from the average', () => {
    expect(calculateAverage([100, 80, null])).toBe(90);
  });
  it('retains zero as a real grade', () => {
    expect(calculateAverage([100, 0])).toBe(50);
    expect(calculateAverage([0])).toBe(0);
  });
  it('is null when nothing is graded', () => {
    expect(calculateAverage([null, null])).toBeNull();
    expect(calculateAverage([])).toBeNull();
  });
});

describe('calculateContribution', () => {
  it('computes average * weight / 100', () => {
    expect(calculateContribution(95, 40)).toBe(38);
    expect(calculateContribution(50, 40)).toBe(20);
    expect(calculateContribution(85, 20)).toBeCloseTo(17);
  });
  it('keeps a zero average as zero contribution', () => {
    expect(calculateContribution(0, 40)).toBe(0);
  });
  it('is null when average or weight is unavailable', () => {
    expect(calculateContribution(null, 40)).toBeNull();
    expect(calculateContribution(90, null)).toBeNull();
  });
});

describe('calculateFinalGrade', () => {
  it('sums the contributions', () => {
    expect(calculateFinalGrade(36, 34, 18)).toBe(88);
  });
  it('accepts zero contributions', () => {
    expect(calculateFinalGrade(0, 0, 0)).toBe(0);
  });
  it('is null (never zero-filled) when any block is missing', () => {
    expect(calculateFinalGrade(36, null, 18)).toBeNull();
  });
});

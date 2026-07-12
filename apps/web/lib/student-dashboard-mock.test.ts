import { describe, expect, it } from 'vitest';
import { studentDashboardMock } from './student-dashboard-mock';

describe('student dashboard mock data', () => {
  it('keeps the four TOEFL skills complete and uniquely addressable', () => {
    expect(studentDashboardMock.skills.map((skill) => skill.id)).toEqual([
      'reading',
      'listening',
      'speaking',
      'writing',
    ]);
    expect(new Set(studentDashboardMock.skills.map((skill) => skill.href)).size).toBeGreaterThan(1);
  });

  it('provides a seven-day chart for every selectable period', () => {
    expect(studentDashboardMock.weeklyPeriods).toHaveLength(3);
    for (const period of studentDashboardMock.weeklyPeriods) {
      expect(period.values).toHaveLength(7);
      expect(period.values.every((value) => value >= 0 && value <= 4)).toBe(true);
    }
  });

  it('keeps all percentages and the TOEFL target in valid ranges', () => {
    expect(
      studentDashboardMock.skills.every((skill) => skill.progress >= 0 && skill.progress <= 100),
    ).toBe(true);
    expect(studentDashboardMock.toeflTarget.currentScore).toBeLessThanOrEqual(
      studentDashboardMock.toeflTarget.maximumScore,
    );
    expect(studentDashboardMock.toeflTarget.targetScore).toBeLessThanOrEqual(
      studentDashboardMock.toeflTarget.maximumScore,
    );
  });
});

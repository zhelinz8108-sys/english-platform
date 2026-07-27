import { describe, expect, it } from 'vitest';
import { generateTemporaryPassword, normalizeLoginName, roleProfilePlan } from './admin.service.js';

describe('membership role profile provisioning', () => {
  it('activates profiles for assigned roles', () => {
    expect(roleProfilePlan(['student'])).toEqual({ student: 'active', teacher: 'inactive' });
    expect(roleProfilePlan(['student', 'teacher'])).toEqual({
      student: 'active',
      teacher: 'active',
    });
  });

  it('marks removed-role profiles inactive instead of deleting historical profiles', () => {
    expect(roleProfilePlan([])).toEqual({ student: 'inactive', teacher: 'inactive' });
  });
});

describe('student account credentials', () => {
  it('normalizes login names consistently', () => {
    expect(normalizeLoginName('  Student.001  ')).toBe('student.001');
  });

  it('generates passwords that satisfy the first-login password policy', () => {
    const password = generateTemporaryPassword();
    expect(password).toHaveLength(16);
    expect(password).toMatch(/[a-z]/u);
    expect(password).toMatch(/[A-Z]/u);
    expect(password).toMatch(/[0-9]/u);
    expect(password).toMatch(/[^A-Za-z0-9]/u);
  });

  it('does not repeat generated credentials in a practical batch', () => {
    const passwords = Array.from({ length: 100 }, () => generateTemporaryPassword());
    expect(new Set(passwords).size).toBe(passwords.length);
  });
});

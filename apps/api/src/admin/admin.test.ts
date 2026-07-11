import { describe, expect, it } from 'vitest';
import { roleProfilePlan } from './admin.service.js';

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

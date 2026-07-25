import { describe, expect, it } from 'vitest';
import { formatPercent, roleLabels, workflowLabels, workflowTone } from './format';

describe('presentation formatting', () => {
  it('keeps workflow language and tones stable', () => {
    expect(workflowLabels.returned).toBe('已退回');
    expect(workflowTone('returned')).toBe('warning');
    expect(workflowTone('completed')).toBe('success');
  });

  it('formats progress for Chinese readers', () => {
    expect(formatPercent(86)).toBe('86%');
  });

  it('uses concise administrator labels in the user interface', () => {
    expect(roleLabels.owner).toBe('所有者');
    expect(roleLabels.admin).toBe('管理员');
  });
});

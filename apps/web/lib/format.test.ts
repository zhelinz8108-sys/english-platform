import { describe, expect, it } from 'vitest';
import { formatPercent, workflowLabels, workflowTone } from './format';

describe('presentation formatting', () => {
  it('keeps workflow language and tones stable', () => {
    expect(workflowLabels.returned).toBe('已退回');
    expect(workflowTone('returned')).toBe('warning');
    expect(workflowTone('completed')).toBe('success');
  });

  it('formats progress for Chinese readers', () => {
    expect(formatPercent(86)).toBe('86%');
  });
});

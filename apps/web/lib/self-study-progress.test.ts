import { describe, expect, it } from 'vitest';
import { createProgressEventId } from './self-study-progress';

describe('self-study progress events', () => {
  it('creates distinct idempotency identifiers within the requested scope', () => {
    const first = createProgressEventId('listening:track-001');
    const second = createProgressEventId('listening:track-001');

    expect(first).toMatch(/^listening:track-001:.{8,}$/u);
    expect(second).toMatch(/^listening:track-001:.{8,}$/u);
    expect(first).not.toBe(second);
  });
});

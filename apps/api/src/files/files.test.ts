import { describe, expect, it } from 'vitest';
import { mayCompleteFile, mayReserveFile } from './files.service.js';

describe('file authorization', () => {
  it('limits student and teacher reservation purposes', () => {
    expect(mayReserveFile(['student'], 'submission_attachment')).toBe(true);
    expect(mayReserveFile(['student'], 'bulk_import')).toBe(false);
    expect(mayReserveFile(['teacher'], 'content_attachment')).toBe(true);
    expect(mayReserveFile(['teacher'], 'bulk_import')).toBe(false);
    expect(mayReserveFile(['content_editor'], 'bulk_import')).toBe(true);
  });

  it('lets only the creator or privileged content roles complete a pending object', () => {
    expect(mayCompleteFile(['student'], 'member-a', 'member-a')).toBe(true);
    expect(mayCompleteFile(['student'], 'member-a', 'member-b')).toBe(false);
    expect(mayCompleteFile(['admin'], 'member-a', 'member-b')).toBe(true);
  });
});

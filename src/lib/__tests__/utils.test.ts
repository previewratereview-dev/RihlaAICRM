import { describe, it, expect } from 'vitest';
import { getPriorityColorClass } from '@/lib/utils';

describe('getPriorityColorClass', () => {
  it('returns red class for urgent', () => {
    expect(getPriorityColorClass('urgent')).toContain('red');
  });

  it('returns amber class for high', () => {
    expect(getPriorityColorClass('high')).toContain('amber');
  });

  it('returns blue class for medium', () => {
    expect(getPriorityColorClass('medium')).toContain('blue');
  });

  it('returns gray class for low', () => {
    expect(getPriorityColorClass('low')).toContain('gray');
  });

  it('falls back to medium (blue) for unknown priority', () => {
    expect(getPriorityColorClass('unknown')).toContain('blue');
  });
});

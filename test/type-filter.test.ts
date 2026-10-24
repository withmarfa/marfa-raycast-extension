import { describe, expect, it } from 'vitest';
import { exactTypeFilter } from '../src/type-filter';

describe('exact type filters', () => {
  it('does not narrow the all-types selection', () => {
    expect(exactTypeFilter('')).toBeUndefined();
  });

  it('escapes the selected identifier as a filter string value', () => {
    expect(exactTypeFilter('core.note')).toBe('type eq "core.note"');
    expect(exactTypeFilter('app.example" OR type neq "other')).toBe(
      'type eq "app.example\\" OR type neq \\"other"',
    );
  });
});

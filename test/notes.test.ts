import { describe, expect, it } from 'vitest';
import { noteExcerpt, noteTitle, UNTITLED } from '../src/notes';

describe('a note is named by its first line as it reads', () => {
  it('takes the first line that has words', () => {
    expect(noteTitle('\n\n  \nShopping list\nmilk')).toBe('Shopping list');
  });

  it('drops a heading, a quote and a list marker, nested', () => {
    expect(noteTitle('# Plans for the week #')).toBe('Plans for the week');
    expect(noteTitle('> - [ ] **Call** the bank')).toBe('Call the bank');
    expect(noteTitle('12) Twelfth thing')).toBe('Twelfth thing');
  });

  it('keeps a closing hash that is part of the words', () => {
    expect(noteTitle('# Learning C#')).toBe('Learning C#');
  });

  it('reads links and images by their words, and an image without its width', () => {
    expect(noteTitle('See [the plan](https://example.com/plan) today')).toBe('See the plan today');
    expect(noteTitle('![Canal at dusk|320](sha256:abc)')).toBe('Canal at dusk');
    expect(noteTitle('<https://example.com>')).toBe('https://example.com');
  });

  it('keeps escaped punctuation and code literal', () => {
    expect(noteTitle('\\*not emphasis\\* and `**code**`')).toBe('*not emphasis* and **code**');
  });

  it('drops emphasis marks', () => {
    expect(noteTitle('A __bold__, *slanted* and ~~struck~~ line')).toBe(
      'A bold, slanted and struck line',
    );
  });

  it('skips fences and rules, and names an empty note Untitled', () => {
    expect(noteTitle('```\ncode\n```')).toBe('code');
    expect(noteTitle('---\n***\nAfter the rule')).toBe('After the rule');
    expect(noteTitle('')).toBe(UNTITLED);
    expect(noteTitle('#\n> \n- ')).toBe(UNTITLED);
  });

  it('reads a numeric character reference as its character', () => {
    expect(noteTitle('Caf&#233; &#x2014; open')).toBe('Café — open');
  });
});

describe('a note excerpt', () => {
  it('is the words after the naming line, joined and cut', () => {
    expect(noteExcerpt('# Title\n\nFirst **point**\n- second')).toBe('First point second');
    expect(noteExcerpt(`Title\n${'word '.repeat(40)}`, 20)).toBe('word word word word…');
    expect(noteExcerpt('Only a title')).toBe('');
  });
});

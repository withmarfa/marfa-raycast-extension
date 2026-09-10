import { describe, expect, it } from 'vitest';
import { bodyFieldsToRender, buildItemMarkdown } from '../src/item-markdown';
import { item } from './fixtures';

/** How many times `needle` occurs in `haystack`. */
function occurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

describe('buildItemMarkdown', () => {
  it('renders a note body once when the registry names the conventional field', () => {
    // What `core.note` actually registers: `body_field` is `body`, which is
    // also the first conventional name. One block, and it must appear once.
    const body = '## A heading\n\nA paragraph.';
    const markdown = buildItemMarkdown({
      item: item({ properties: { title: 'A note', body } }),
      title: 'A note',
      bodyField: 'body',
    });

    expect(occurrences(markdown, body)).toBe(1);
    expect(occurrences(markdown, 'A heading')).toBe(1);
    expect(occurrences(markdown, 'A paragraph.')).toBe(1);
  });

  it('renders a body with no trailing newline once', () => {
    const body = 'One line, no newline at the end';
    const markdown = buildItemMarkdown({
      item: item({ properties: { body } }),
      title: 'A note',
      bodyField: 'body',
    });

    expect(occurrences(markdown, body)).toBe(1);
  });

  it('renders the registry field once when it is outside the conventional set', () => {
    const textBody = 'The mail body.';
    const markdown = buildItemMarkdown({
      item: item({ type: 'app.mail.message', properties: { text_body: textBody } }),
      title: 'A subject',
      bodyField: 'text_body',
    });

    expect(occurrences(markdown, textBody)).toBe(1);
  });

  it('keeps a second body-carrying property beside the registry field', () => {
    // `core.note` declares `notes` as well, and the sidebar walker drops every
    // conventional name, so a property omitted here appears nowhere at all.
    const markdown = buildItemMarkdown({
      item: item({ properties: { body: 'The note.', notes: 'An annotation.' } }),
      title: 'A note',
      bodyField: 'body',
    });

    expect(occurrences(markdown, 'The note.')).toBe(1);
    expect(occurrences(markdown, 'An annotation.')).toBe(1);
    expect(markdown.indexOf('The note.')).toBeLessThan(markdown.indexOf('An annotation.'));
  });

  it('falls back to the conventional names when the registry names none', () => {
    const markdown = buildItemMarkdown({
      item: item({ properties: { description: 'A description.' } }),
      title: 'Untitled',
    });

    expect(occurrences(markdown, 'A description.')).toBe(1);
  });

  it('renders the heading, then a snippet, then the body', () => {
    const markdown = buildItemMarkdown({
      item: item({ properties: { body: 'The note.' } }),
      title: 'A note',
      bodyField: 'body',
      snippet: 'matched text',
    });

    expect(markdown.indexOf('# A note')).toBeLessThan(markdown.indexOf('matched text'));
    expect(markdown.indexOf('matched text')).toBeLessThan(markdown.indexOf('The note.'));
  });

  it('renders a url property as a link, once', () => {
    const markdown = buildItemMarkdown({
      item: item({ type: 'core.bookmark', properties: { url: 'https://example.com/a' } }),
      title: 'A bookmark',
    });

    expect(occurrences(markdown, '[https://example.com/a](https://example.com/a)')).toBe(1);
    expect(occurrences(markdown, 'https://example.com/a')).toBe(2);
  });

  it('does not repeat a url the registry named as the body', () => {
    const markdown = buildItemMarkdown({
      item: item({ type: 'core.bookmark', properties: { url: 'https://example.com/a' } }),
      title: 'A bookmark',
      bodyField: 'url',
    });

    expect(occurrences(markdown, 'https://example.com/a')).toBe(1);
  });

  it('places an image above the heading', () => {
    const markdown = buildItemMarkdown({
      item: item({ type: 'core.file.image', properties: {} }),
      title: 'A picture',
      imageUrl: 'https://example.com/a.png',
    });

    expect(markdown.indexOf('![A picture]')).toBeLessThan(markdown.indexOf('# A picture'));
  });

  it('bounds each body block when asked to', () => {
    const markdown = buildItemMarkdown({
      item: item({ properties: { body: 'abcdefghij' } }),
      title: 'A note',
      bodyField: 'body',
      truncateAt: 4,
    });

    expect(markdown).toContain('abcd…');
    expect(markdown).not.toContain('abcdefghij');
  });

  it('leaves an empty or absent property out', () => {
    const markdown = buildItemMarkdown({
      item: item({ properties: { body: '', notes: 'Only this.' } }),
      title: 'A note',
      bodyField: 'body',
    });

    expect(markdown).toBe('# A note\n\nOnly this.\n');
  });
});

describe('bodyFieldsToRender', () => {
  it('leads with the registry field and names it once', () => {
    expect(bodyFieldsToRender('body')).toEqual(['body', 'description', 'text', 'notes']);
  });

  it('prepends a registry field from outside the conventional set', () => {
    expect(bodyFieldsToRender('text_body')).toEqual([
      'text_body',
      'body',
      'description',
      'text',
      'notes',
    ]);
  });

  it('is the conventional set when the registry names nothing', () => {
    expect(bodyFieldsToRender(undefined)).toEqual(['body', 'description', 'text', 'notes']);
  });
});

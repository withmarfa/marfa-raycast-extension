import { describe, expect, it } from 'vitest';
import type { PlannedField } from '../src/capture-plan';
import {
  captureFromFile,
  captureFromText,
  clipboardBody,
  clipboardSeed,
  clipboardType,
  htmlToMarkdown,
  isWebUrl,
} from '../src/clipboard';

const text = (value: string) => ({ text: value, html: '' });

describe('what the clipboard becomes', () => {
  it('a lone web address is a bookmark', () => {
    expect(captureFromText(text('  https://example.com/a?b=1 \n'))).toEqual({
      type: 'core.bookmark',
      properties: { url: 'https://example.com/a?b=1' },
      noun: 'Bookmark',
    });
  });

  it('anything else is a note, including text that holds a link', () => {
    expect(captureFromText(text('Read https://example.com later'))?.type).toBe('core.note');
    expect(captureFromText(text('mailto:someone@example.com'))?.type).toBe('core.note');
    expect(captureFromText(text('line one\nline two'))?.properties).toEqual({
      body: 'line one\nline two',
    });
  });

  it('nothing but space is nothing', () => {
    expect(captureFromText(text(' \n\t'))).toBeNull();
    expect(isWebUrl('ftp://example.com')).toBe(false);
  });
});

describe('what a copied file becomes', () => {
  it('an image is an image, named by its file name', () => {
    expect(captureFromFile('/Users/someone/Desktop/Canal at dusk.PNG')).toEqual({
      path: '/Users/someone/Desktop/Canal at dusk.PNG',
      type: 'core.file.image',
      mimeType: 'image/png',
      title: 'Canal at dusk.PNG',
    });
  });

  it('reads a file URL as its path', () => {
    const file = captureFromFile('file:///Users/someone/Documents/Plan%20v2.pdf');
    expect(file.path).toBe('/Users/someone/Documents/Plan v2.pdf');
    expect(file).toMatchObject({
      type: 'core.file',
      mimeType: 'application/pdf',
      title: 'Plan v2.pdf',
    });
  });

  it('keeps an escaped # in a file URL as part of the name', () => {
    expect(captureFromFile('file:///Users/someone/Report%20%232.pdf').path).toBe(
      '/Users/someone/Report #2.pdf',
    );
  });

  it('anything unknown is a file of bytes', () => {
    expect(captureFromFile('/tmp/archive.xyz').mimeType).toBe('application/octet-stream');
    expect(captureFromFile('/tmp/Makefile')).toMatchObject({
      type: 'core.file',
      title: 'Makefile',
    });
  });
});

describe('copied HTML', () => {
  it('keeps formatting as markdown', () => {
    const html =
      '<meta charset="utf-8"><h2>Plan</h2><p>Go <b>now</b> to <a href="https://example.org">the site</a></p><ul><li>one</li><li>two</li></ul><ol start="3"><li>three</li></ol>';
    expect(htmlToMarkdown(html)).toBe(
      '## Plan\n\nGo **now** to [the site](https://example.org)\n\n- one\n- two\n\n3. three',
    );
  });

  it('leaves out styles, scripts and inlined image bytes', () => {
    const html =
      '<style>p{color:red}</style><script>alert(1)</script><p><em>kept</em><img src="data:image/png;base64,AAAA"></p>';
    expect(htmlToMarkdown(html)).toBe('*kept*');
  });

  it('reads an editor’s styled spans as the plain text, unescaped', () => {
    // Code copied from an editor is HTML of coloured spans; as markdown every * and _ would be escaped.
    const html = '<div><span style="color:#f00">const a_b = 2 * 3;</span></div>';
    expect(htmlToMarkdown(html)).toBeUndefined();
    expect(clipboardBody({ text: 'const a_b = 2 * 3;', html })).toBe('const a_b = 2 * 3;');
  });

  it('unwraps the bold Google Docs puts around a whole copy', () => {
    const html =
      '<b style="font-weight:normal;" id="docs-internal-guid-1"><p><span>Plain</span> and <i>leaning</i></p></b>';
    expect(htmlToMarkdown(html)).toBe('Plain and *leaning*');
  });

  it('makes a note of formatted text, and a bookmark of a lone link however it was copied', () => {
    expect(
      captureFromText({ text: 'Plan\nGo now', html: '<h1>Plan</h1><p>Go <b>now</b></p>' }),
    ).toEqual({
      type: 'core.note',
      properties: { body: '# Plan\n\nGo **now**' },
      noun: 'Note',
    });
    expect(
      captureFromText({
        text: 'https://example.org',
        html: '<a href="https://example.org">https://example.org</a>',
      })?.type,
    ).toBe('core.bookmark');
  });
});

describe('where the clipboard goes in a form', () => {
  const field = (name: string, rawType = 'string'): PlannedField => ({
    name,
    kind: 'text',
    title: name,
    required: false,
    rawType,
  });
  const hints = { titleField: 'title', bodyField: 'body', hasUrlField: true };
  const link = { text: 'https://example.org/a', html: '', file: null };
  const words = { text: 'Some words', html: '<p>Some <b>words</b></p>', file: null };
  const file = { text: 'Plan.pdf', html: '', file: 'file:///tmp/Plan.pdf' };

  it('puts a link in the URL field, and in the title only when the type has no URL field', () => {
    expect(clipboardSeed(link, field('url', 'url'), hints)).toBe('https://example.org/a');
    expect(clipboardSeed(link, field('title'), hints)).toBeUndefined();
    expect(clipboardSeed(link, field('title'), { ...hints, hasUrlField: false })).toBe(
      'https://example.org/a',
    );
    expect(clipboardSeed(link, field('body'), hints)).toBeUndefined();
  });

  it('puts text in the body, as markdown, and a file’s name in the title', () => {
    expect(clipboardSeed(words, field('body'), hints)).toBe('Some **words**');
    expect(clipboardSeed(words, field('title'), hints)).toBeUndefined();
    expect(clipboardSeed(file, field('title'), hints)).toBe('Plan.pdf');
    expect(clipboardSeed(file, field('body'), hints)).toBeUndefined();
  });

  it('starts on the type the clipboard suggests', () => {
    expect(clipboardType(file, 'core.task')).toBe('core.file');
    expect(clipboardType({ ...file, file: '/tmp/a.png' }, 'core.task')).toBe('core.file.image');
    expect(clipboardType(link, 'core.task')).toBe('core.bookmark');
    expect(clipboardType(words, 'core.task')).toBe('core.task');
  });
});

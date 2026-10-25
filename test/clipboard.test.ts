import { describe, expect, it } from 'vitest';
import type { PlannedField } from '../src/capture-plan';
import {
  captureFromFile,
  clipboardBody,
  clipboardSeed,
  clipboardType,
  selectionSnapshot,
  htmlToMarkdown,
  isWebUrl,
} from '../src/clipboard';

const text = (value: string) => ({ text: value, html: '' });

describe('what the clipboard becomes', () => {
  it('a lone web address is a link, however it was copied', () => {
    expect(isWebUrl('https://example.com/a?b=1')).toBe(true);
    expect(isWebUrl('Read https://example.com later')).toBe(false);
    expect(isWebUrl('mailto:someone@example.com')).toBe(false);
    expect(isWebUrl('ftp://example.com')).toBe(false);
  });

  it('keeps the lines of plain text', () => {
    expect(clipboardBody(text('line one\nline two'))).toBe('line one\nline two');
    expect(clipboardBody(text(' \n\t'))).toBe('');
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
    // Code copied from an editor is HTML of colored spans; as markdown every * and _ would be escaped.
    const html = '<div><span style="color:#f00">const a_b = 2 * 3;</span></div>';
    expect(htmlToMarkdown(html)).toBeUndefined();
    expect(clipboardBody({ text: 'const a_b = 2 * 3;', html })).toBe('const a_b = 2 * 3;');
  });

  it('fences code, whether or not a code element sits inside the pre', () => {
    const html = '<pre><span class="k">const</span> a = b*c;\nif (x_y) {}</pre>';
    expect(htmlToMarkdown(html)).toBe('```\nconst a = b*c;\nif (x_y) {}\n```');
  });

  it('keeps a table as a markdown table', () => {
    const html =
      '<table><thead><tr><th>Name</th><th>Qty</th></tr></thead><tbody><tr><td>Flour</td><td>500 | g</td></tr></tbody></table>';
    expect(htmlToMarkdown(html)).toBe('| Name | Qty |\n| --- | --- |\n| Flour | 500 \\| g |');
  });

  it('takes a Google Docs copy with no formatting as its plain text', () => {
    const html =
      '<b style="font-weight:normal;" id="docs-internal-guid-2"><p><span>a*b_c</span></p></b>';
    expect(htmlToMarkdown(html)).toBeUndefined();
  });

  it('unwraps the bold Google Docs puts around a whole copy', () => {
    const html =
      '<b style="font-weight:normal;" id="docs-internal-guid-1"><p><span>Plain</span> and <i>leaning</i></p></b>';
    expect(htmlToMarkdown(html)).toBe('Plain and *leaning*');
  });

  it('turns formatted text into Markdown, and still sees a lone link however it was copied', () => {
    expect(clipboardBody({ text: 'Plan\nGo now', html: '<h1>Plan</h1><p>Go <b>now</b></p>' })).toBe(
      '# Plan\n\nGo **now**',
    );
    expect(
      clipboardType(
        {
          text: 'https://example.org',
          html: '<a href="https://example.org">https://example.org</a>',
          file: null,
        },
        'core.note',
      ),
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
  const hints = { titleField: 'title', bodyField: 'body', urlField: 'url' };
  const link = { text: 'https://example.org/a', html: '', file: null };
  const words = { text: 'Some words', html: '<p>Some <b>words</b></p>', file: null };
  const file = { text: 'Plan.pdf', html: '', file: 'file:///tmp/Plan.pdf' };

  it('puts a link in the one URL field, and in the title only when the type has none', () => {
    expect(clipboardSeed(link, field('url', 'url'), hints)).toBe('https://example.org/a');
    // A bookmark's cover and source are URLs too, and are not the page.
    expect(clipboardSeed(link, field('image_url', 'url'), hints)).toBeUndefined();
    expect(clipboardSeed(link, field('source_url', 'url'), hints)).toBeUndefined();
    expect(clipboardSeed(link, field('title'), hints)).toBeUndefined();
    expect(clipboardSeed(link, field('title'), { ...hints, urlField: undefined })).toBe(
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

describe('what a selection starts a capture with', () => {
  it('its text alone', () => {
    expect(selectionSnapshot('Selected words')).toEqual({
      text: 'Selected words',
      html: '',
      file: null,
    });
  });

  it('nothing when nothing is selected or the selection is blank', () => {
    expect(selectionSnapshot(undefined)).toBeNull();
    expect(selectionSnapshot('')).toBeNull();
    expect(selectionSnapshot(' \n\t ')).toBeNull();
  });

  it('a note, even while a file is copied, since a selection holds text alone', () => {
    const snapshot = selectionSnapshot('Selected words');
    expect(snapshot && clipboardType(snapshot, 'core.note')).toBe('core.note');
  });

  it('a selected web address as a bookmark', () => {
    const snapshot = selectionSnapshot('https://example.org/a');
    expect(snapshot && clipboardType(snapshot, 'core.note')).toBe('core.bookmark');
  });
});

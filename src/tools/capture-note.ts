import { type Tool } from '@raycast/api';
import { NOTE_TYPE } from '../display';
import { describeFailure } from '../failure';
import { createItem } from '../marfa';
import { noteTitle } from '../notes';

type Input = {
  /**
   * The note in markdown. Its first line names it, so start with a short line that says what the
   * note is about, in the person's own words.
   */
  body: string;
  /** Tags to file it under, only if the person asked for them. Lowercase, no `#`. */
  tags?: string[];
};

function cleanTags(tags: string[] | undefined): string[] {
  return [...new Set((tags ?? []).map((tag) => tag.replace(/^#/, '').trim()).filter(Boolean))];
}

export const confirmation: Tool.Confirmation<Input> = async (input) => ({
  message: 'Save this note to Marfa?',
  info: [
    { name: 'Note', value: noteTitle(input.body) },
    { name: 'Tags', value: cleanTags(input.tags).join(', ') || undefined },
  ],
});

/** Writes a note to the library, exactly as Quick Capture does. */
export default async function tool(input: Input) {
  try {
    const { item, metadata } = await createItem({
      type: NOTE_TYPE,
      properties: { body: input.body },
      tags: cleanTags(input.tags),
    });
    return { id: item.id, title: noteTitle(input.body), tags: metadata.tags };
  } catch (error) {
    const failure = describeFailure(error);
    throw new Error(`${failure.title}. ${failure.message}`);
  }
}

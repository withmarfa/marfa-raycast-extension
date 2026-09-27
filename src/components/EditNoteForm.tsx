import {
  Action,
  ActionPanel,
  Detail,
  Form,
  Icon,
  showToast,
  Toast,
  useNavigation,
} from '@raycast/api';
import { usePromise } from '@raycast/utils';
import { useState } from 'react';
import { changedProperties } from '../display';
import { conflictCurrent } from '../failure';
import { showFailure } from '../feedback';
import { getItem, updateItem, type Item } from '../marfa';

/**
 * Edits a note's body against the version the form loaded.
 *
 * The form reads the note afresh rather than trusting the list row, which may
 * be minutes old: an edit based on a stale read turns someone else's change
 * into a conflict nobody needed.
 */
export function EditNoteForm({ id, onSaved }: { id: string; onSaved: () => void }) {
  const { pop } = useNavigation();
  const {
    data: item,
    isLoading,
    revalidate,
  } = usePromise(async (itemId: string) => (await getItem(itemId)).item, [id], {
    onError: (error) => void showFailure(error, 'Loading the note'),
  });
  const [collision, setCollision] = useState<{ mine: string; theirs: string } | undefined>();

  if (collision) {
    return (
      <CollisionView
        {...collision}
        onReload={() => {
          setCollision(undefined);
          revalidate();
        }}
      />
    );
  }

  async function save(values: { body: string }) {
    if (!item) return;
    const changed = changedProperties(item.properties, { body: values.body });
    if (Object.keys(changed).length === 0) {
      pop();
      return;
    }
    const toast = await showToast({ style: Toast.Style.Animated, title: 'Saving' });
    try {
      const saved = await updateItem({ id: item.id, version: item.version, properties: changed });
      if (saved.resolution?.conflicted_copy_id) {
        toast.style = Toast.Style.Failure;
        toast.title = 'Changed elsewhere meanwhile';
        toast.message = 'The other change stays; yours was saved beside it as a conflicted copy.';
      } else {
        toast.style = Toast.Style.Success;
        toast.title = 'Saved';
      }
      onSaved();
      pop();
    } catch (error) {
      const current = conflictCurrent(error);
      if (current) {
        await toast.hide();
        setCollision({ mine: values.body, theirs: bodyText(current.properties) });
        return;
      }
      await toast.hide();
      await showFailure(error, 'Saving');
    }
  }

  return (
    <Form
      navigationTitle="Edit Note"
      isLoading={isLoading}
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Save" icon={Icon.Check} onSubmit={save} />
        </ActionPanel>
      }
    >
      {item && <BodyField item={item} />}
    </Form>
  );
}

/** Keyed by version, so a reload after a collision shows the server's text. */
function BodyField({ item }: { item: Item }) {
  return (
    <Form.TextArea
      key={`${item.id}:${String(item.version)}`}
      id="body"
      title="Note"
      enableMarkdown
      defaultValue={bodyText(item.properties)}
    />
  );
}

function bodyText(properties: Record<string, unknown>): string {
  return typeof properties.body === 'string' ? properties.body : '';
}

/**
 * A collision the server could not settle. Nothing is merged here: the person
 * sees both texts, keeps theirs on the clipboard if they want it, and edits the
 * current version.
 */
function CollisionView({
  mine,
  theirs,
  onReload,
}: {
  mine: string;
  theirs: string;
  onReload: () => void;
}) {
  const markdown = [
    '## Changed elsewhere',
    'Someone changed this note after you opened it, and the two edits collide. Your edit was not saved.',
    '### Now on the server',
    theirs || '_(empty)_',
    '---',
    '### Your edit',
    mine || '_(empty)_',
  ].join('\n\n');
  return (
    <Detail
      navigationTitle="Changed Elsewhere"
      markdown={markdown}
      actions={
        <ActionPanel>
          <Action title="Edit the Current Version" icon={Icon.Pencil} onAction={onReload} />
          <Action.CopyToClipboard title="Copy Your Edit" content={mine} />
        </ActionPanel>
      }
    />
  );
}

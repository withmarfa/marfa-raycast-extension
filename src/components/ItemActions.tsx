import {
  Action,
  ActionPanel,
  Alert,
  confirmAlert,
  Form,
  Icon,
  Keyboard,
  showToast,
  Toast,
  useNavigation,
} from '@raycast/api';
import type { ReactNode } from 'react';
import { parseTags, type Registry } from '../display';
import { showFailure } from '../feedback';
import {
  addTags,
  type Entry,
  type Item,
  purgeItem,
  removeTag,
  restoreItem,
  transitionItem,
  trashItem,
} from '../marfa';
import { CaptureForm } from './CaptureForm';
import { EditItemForm } from './EditItemForm';
import { EditNoteForm } from './EditNoteForm';

export function webUrl(item: Item): string | undefined {
  const url = item.properties.url;
  return typeof url === 'string' && /^https?:\/\//.test(url) ? url : undefined;
}

/**
 * What can be done to one item, the same from a list row and from its detail.
 * `onChanged` reads the item's surroundings again; `onGone` leaves a view the
 * item no longer belongs to, such as its detail after a purge.
 */
export function ItemActions({
  entry,
  registry,
  onChanged,
  onGone,
  lead,
}: {
  entry: Entry;
  registry: Registry;
  onChanged: () => void;
  onGone?: () => void;
  /** Actions that come first, such as opening the detail from a row. */
  lead?: ReactNode;
}) {
  const { item, metadata } = entry;
  const title = registry.titleOf(item);
  const body = registry.bodyOf(item);
  const url = webUrl(item);
  const trashed = item.state === 'trashed';
  const archived = item.state === 'archived';
  const isNote = registry.isNote(item.type);
  // An edit form needs the type's schema; a type the server does not describe has none to build from.
  const editable = !trashed && (isNote || registry.type(item.type) !== undefined);

  async function trash() {
    try {
      await trashItem(item.id);
      onChanged();
      onGone?.();
      await showToast({
        style: Toast.Style.Success,
        title: 'Moved to Trash',
        message: title,
        primaryAction: { title: 'Undo', onAction: () => void restore() },
      });
    } catch (error) {
      await showFailure(error, 'Moving to Trash');
    }
  }

  async function restore() {
    try {
      await restoreItem(item.id);
      onChanged();
      await showToast({ style: Toast.Style.Success, title: 'Restored', message: title });
    } catch (error) {
      await showFailure(error, 'Restoring');
    }
  }

  async function transition(state: 'active' | 'archived') {
    try {
      await transitionItem(item.id, state);
      onChanged();
      await showToast({
        style: Toast.Style.Success,
        title: state === 'archived' ? 'Archived' : 'Unarchived',
        message: title,
        primaryAction: {
          title: 'Undo',
          onAction: () => void transition(state === 'archived' ? 'active' : 'archived'),
        },
      });
    } catch (error) {
      await showFailure(error, state === 'archived' ? 'Archiving' : 'Unarchiving');
    }
  }

  async function purge() {
    const confirmed = await confirmAlert({
      title: 'Delete Permanently?',
      message: `“${title}” will be deleted from the server for good, in every app. This cannot be undone.`,
      primaryAction: { title: 'Delete Permanently', style: Alert.ActionStyle.Destructive },
    });
    if (!confirmed) return;
    try {
      await purgeItem(item.id);
      onChanged();
      onGone?.();
      await showToast({ style: Toast.Style.Success, title: 'Deleted permanently', message: title });
    } catch (error) {
      await showFailure(error, 'Deleting permanently');
    }
  }

  async function untag(tag: string) {
    try {
      await removeTag(item.id, tag);
      onChanged();
    } catch (error) {
      await showFailure(error, 'Removing the tag');
    }
  }

  return (
    <>
      <ActionPanel.Section>
        {lead}
        {editable && (
          <Action.Push
            title={isNote ? 'Edit Note' : `Edit ${registry.label(item.type)}`}
            icon={Icon.Pencil}
            shortcut={Keyboard.Shortcut.Common.Edit}
            target={
              isNote ? (
                <EditNoteForm id={item.id} onSaved={onChanged} />
              ) : (
                <EditItemForm id={item.id} registry={registry} onSaved={onChanged} />
              )
            }
          />
        )}
        {url && <Action.OpenInBrowser url={url} shortcut={Keyboard.Shortcut.Common.Open} />}
        {body && (
          <Action.CopyToClipboard
            title="Copy Text"
            content={body}
            shortcut={Keyboard.Shortcut.Common.Copy}
          />
        )}
      </ActionPanel.Section>
      {!trashed && (
        <ActionPanel.Section title="Link">
          <Action.Push
            title="Reply"
            icon={Icon.Reply}
            target={
              <LinkedCapture
                registry={registry}
                typeId="core.note"
                edge="in-thread"
                to={item}
                title={`Reply to ${title}`}
                onCaptured={onChanged}
              />
            }
          />
          <Action.Push
            title="Annotate"
            icon={Icon.Highlight}
            target={
              <LinkedCapture
                registry={registry}
                typeId="core.highlight"
                edge="references"
                to={item}
                title={`Annotate ${title}`}
                onCaptured={onChanged}
              />
            }
          />
        </ActionPanel.Section>
      )}
      {!trashed && (
        <ActionPanel.Section title="Tags">
          <Action.Push
            title="Add Tags"
            icon={Icon.Tag}
            shortcut={{ modifiers: ['cmd', 'shift'], key: 't' }}
            target={<AddTagsForm item={item} existing={metadata.tags} onAdded={onChanged} />}
          />
          {metadata.tags.length > 0 && (
            <ActionPanel.Submenu title="Remove Tag" icon={Icon.XMarkCircle}>
              {metadata.tags.map((tag) => (
                <Action key={tag} title={tag} onAction={() => void untag(tag)} />
              ))}
            </ActionPanel.Submenu>
          )}
        </ActionPanel.Section>
      )}
      <ActionPanel.Section title="State">
        {!trashed && (
          <Action
            title={archived ? 'Unarchive' : 'Archive'}
            icon={archived ? Icon.Tray : Icon.Box}
            shortcut={{ modifiers: ['cmd', 'shift'], key: 'e' }}
            onAction={() => void transition(archived ? 'active' : 'archived')}
          />
        )}
        {trashed ? (
          <Action
            title="Restore"
            icon={Icon.ArrowCounterClockwise}
            shortcut={{ modifiers: ['cmd'], key: 'z' }}
            onAction={restore}
          />
        ) : (
          <Action
            title="Move to Trash"
            icon={Icon.Trash}
            style={Action.Style.Destructive}
            shortcut={Keyboard.Shortcut.Common.Remove}
            onAction={trash}
          />
        )}
        {trashed && (
          <Action
            title="Delete Permanently"
            icon={Icon.XMarkTopRightSquare}
            style={Action.Style.Destructive}
            shortcut={Keyboard.Shortcut.Common.RemoveAll}
            onAction={purge}
          />
        )}
      </ActionPanel.Section>
      <ActionPanel.Section title="Copy">
        <Action.CopyToClipboard
          title="Copy ID"
          content={item.id}
          shortcut={{ modifiers: ['cmd', 'shift'], key: 'i' }}
        />
        {url && <Action.CopyToClipboard title="Copy URL" content={url} />}
      </ActionPanel.Section>
    </>
  );
}

/**
 * A new item linked to this one: a reply is a note in its thread, and an
 * annotation a highlight that references it.
 */
function LinkedCapture({
  registry,
  typeId,
  edge,
  to,
  title,
  onCaptured,
}: {
  registry: Registry;
  typeId: string;
  edge: string;
  to: Item;
  title: string;
  onCaptured: () => void;
}) {
  const { pop } = useNavigation();
  return (
    <CaptureForm
      registry={registry}
      registryLoading={false}
      initialType={typeId}
      lockType
      edges={{ [edge]: [to.id] }}
      navigationTitle={title}
      submitTitle={edge === 'in-thread' ? 'Reply' : 'Save Highlight'}
      onCaptured={async (label) => {
        onCaptured();
        pop();
        await showToast({ style: Toast.Style.Success, title: `${label} saved` });
      }}
    />
  );
}

function AddTagsForm({
  item,
  existing,
  onAdded,
}: {
  item: Item;
  existing: string[];
  onAdded: () => void;
}) {
  const { pop } = useNavigation();

  async function add(values: { tags: string }) {
    const tags = parseTags(values.tags).filter((tag) => !existing.includes(tag));
    try {
      if (tags.length > 0) await addTags(item.id, tags);
      onAdded();
      pop();
    } catch (error) {
      await showFailure(error, 'Adding tags');
    }
  }

  return (
    <Form
      navigationTitle="Add Tags"
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Add Tags" icon={Icon.Tag} onSubmit={add} />
        </ActionPanel>
      }
    >
      <Form.TextField id="tags" title="Tags" placeholder="reading, later" info="Comma-separated" />
    </Form>
  );
}

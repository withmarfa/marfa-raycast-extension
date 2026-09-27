import {
  Action,
  ActionPanel,
  Color,
  Form,
  Icon,
  Keyboard,
  List,
  showToast,
  Toast,
  useNavigation,
} from '@raycast/api';
import type { ReactNode } from 'react';
import { typeIcon } from '../appearance';
import { parseTags, type Registry } from '../display';
import { showFailure } from '../feedback';
import { addTags, removeTag, restoreItem, trashItem, type Entry, type Item } from '../marfa';
import { EditNoteForm } from './EditNoteForm';

function webUrl(item: Item): string | undefined {
  const url = item.properties.url;
  return typeof url === 'string' && /^https?:\/\//.test(url) ? url : undefined;
}

function when(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export function EntryListItem({
  entry,
  registry,
  showingDetail,
  onChanged,
  listActions,
}: {
  entry: Entry;
  registry: Registry;
  showingDetail: boolean;
  onChanged: () => void;
  listActions: ReactNode;
}) {
  const { item, metadata } = entry;
  const title = registry.titleOf(item);
  const body = registry.bodyOf(item);
  const url = webUrl(item);
  const trashed = item.state === 'trashed';

  async function trash() {
    try {
      await trashItem(item.id);
      onChanged();
      await showToast({
        style: Toast.Style.Success,
        title: 'Moved to Trash',
        message: title,
        primaryAction: {
          title: 'Undo',
          onAction: () => void restore(),
        },
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

  async function untag(tag: string) {
    try {
      await removeTag(item.id, tag);
      onChanged();
    } catch (error) {
      await showFailure(error, 'Removing the tag');
    }
  }

  const detail = (
    <List.Item.Detail
      markdown={body || `_${registry.label(item.type)} with no text_`}
      metadata={
        <List.Item.Detail.Metadata>
          <List.Item.Detail.Metadata.Label title="Type" text={registry.label(item.type)} />
          {item.state !== 'active' && (
            <List.Item.Detail.Metadata.TagList title="State">
              <List.Item.Detail.Metadata.TagList.Item
                text={trashed ? 'Trashed' : 'Archived'}
                color={trashed ? Color.Red : Color.Blue}
              />
            </List.Item.Detail.Metadata.TagList>
          )}
          {metadata.tags.length > 0 && (
            <List.Item.Detail.Metadata.TagList title="Tags">
              {metadata.tags.map((tag) => (
                <List.Item.Detail.Metadata.TagList.Item key={tag} text={tag} />
              ))}
            </List.Item.Detail.Metadata.TagList>
          )}
          {url && <List.Item.Detail.Metadata.Link title="URL" target={url} text={url} />}
          <List.Item.Detail.Metadata.Separator />
          <List.Item.Detail.Metadata.Label title="Updated" text={when(item.updated_at)} />
          <List.Item.Detail.Metadata.Label title="Created" text={when(item.created_at)} />
          <List.Item.Detail.Metadata.Label title="Source" text={item.source} />
        </List.Item.Detail.Metadata>
      }
    />
  );

  return (
    <List.Item
      id={item.id}
      title={title}
      subtitle={showingDetail ? undefined : registry.subtitleOf(item)}
      keywords={[...metadata.tags, ...registry.subtitleOf(item).split(/\s+/)]}
      icon={typeIcon(registry, item.type, trashed)}
      accessories={
        showingDetail
          ? undefined
          : [
              ...metadata.tags.slice(0, 2).map((tag) => ({ tag })),
              { date: new Date(item.updated_at), tooltip: `Updated ${when(item.updated_at)}` },
            ]
      }
      detail={showingDetail ? detail : undefined}
      actions={
        <ActionPanel title={title}>
          <ActionPanel.Section>
            {registry.isNote(item.type) && !trashed && (
              <Action.Push
                title="Edit Note"
                icon={Icon.Pencil}
                target={<EditNoteForm id={item.id} onSaved={onChanged} />}
              />
            )}
            {url && <Action.OpenInBrowser url={url} />}
            {body && (
              <Action.CopyToClipboard
                title="Copy Text"
                content={body}
                shortcut={Keyboard.Shortcut.Common.Copy}
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
          </ActionPanel.Section>
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
          {listActions}
          <ActionPanel.Section>
            <Action.CopyToClipboard
              title="Copy ID"
              content={item.id}
              shortcut={{ modifiers: ['cmd', 'shift'], key: 'i' }}
            />
          </ActionPanel.Section>
        </ActionPanel>
      }
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

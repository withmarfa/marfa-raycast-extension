import {
  ActionPanel,
  Action,
  Form,
  Icon,
  showToast,
  Toast,
  useNavigation,
  confirmAlert,
  Alert,
  Keyboard,
} from '@raycast/api';
import { showFailureToast } from '@raycast/utils';
import { useState } from 'react';
import type { Item, Metadata, ItemState } from '@withmarfa/sdk';
import { getClient } from '../client';
import { getItemUrl } from '../helpers';
import type { TypeRegistry } from '../type-display';

function AddTagForm({ itemId, onComplete }: { itemId: string; onComplete: () => void }) {
  const { pop } = useNavigation();

  async function handleSubmit(values: { tags: string }) {
    const tags = values.tags
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    if (tags.length === 0) return;
    try {
      const client = getClient();
      await client.metadata.addTags(itemId, tags);
      await showToast({ style: Toast.Style.Success, title: 'Tags added' });
      onComplete();
      pop();
    } catch (error) {
      await showFailureToast(error, { title: 'Failed to add tags' });
    }
  }

  return (
    <Form
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Add Tags" icon={Icon.Tag} onSubmit={handleSubmit} />
        </ActionPanel>
      }
    >
      <Form.TextField id="tags" title="Tags" placeholder="tag1, tag2, tag3 (comma-separated)" />
    </Form>
  );
}

function ReplyForm({ targetItemId, onComplete }: { targetItemId: string; onComplete: () => void }) {
  const { pop } = useNavigation();
  const [bodyError, setBodyError] = useState<string | undefined>();

  async function handleSubmit(values: { title: string; body: string }) {
    if (!values.body?.trim()) {
      setBodyError('Body is required');
      return;
    }
    const properties: Record<string, unknown> = { body: values.body };
    if (values.title?.trim()) properties.title = values.title;
    try {
      const client = getClient();
      await client.items.create({
        type: 'core.note',
        properties,
        edges: { 'in-thread': [targetItemId] },
        tier: 'library',
      });
      await showToast({ style: Toast.Style.Success, title: 'Reply sent' });
      onComplete();
      pop();
    } catch (error) {
      await showFailureToast(error, { title: 'Failed to reply' });
    }
  }

  return (
    <Form
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Reply" icon={Icon.Reply} onSubmit={handleSubmit} />
        </ActionPanel>
      }
    >
      <Form.TextField id="title" title="Title" placeholder="Optional" />
      <Form.TextArea
        id="body"
        title="Body"
        placeholder="Your reply..."
        error={bodyError}
        onChange={() => setBodyError(undefined)}
      />
    </Form>
  );
}

function AnnotateForm({
  targetItemId,
  onComplete,
}: {
  targetItemId: string;
  onComplete: () => void;
}) {
  const { pop } = useNavigation();
  const [textError, setTextError] = useState<string | undefined>();

  async function handleSubmit(values: { text: string; note: string }) {
    if (!values.text?.trim()) {
      setTextError('Highlighted text is required');
      return;
    }
    const properties: Record<string, unknown> = { text: values.text };
    if (values.note?.trim()) properties.note = values.note;
    try {
      const client = getClient();
      await client.items.create({
        type: 'core.highlight',
        properties,
        edges: { references: [targetItemId] },
        tier: 'library',
      });
      await showToast({ style: Toast.Style.Success, title: 'Highlight saved' });
      onComplete();
      pop();
    } catch (error) {
      await showFailureToast(error, { title: 'Failed to save highlight' });
    }
  }

  return (
    <Form
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Save Highlight" icon={Icon.Highlight} onSubmit={handleSubmit} />
        </ActionPanel>
      }
    >
      <Form.TextArea
        id="text"
        title="Highlighted Text"
        placeholder="The passage you're highlighting..."
        error={textError}
        onChange={() => setTextError(undefined)}
      />
      <Form.TextArea id="note" title="Note" placeholder="Optional commentary" />
    </Form>
  );
}

interface ItemActionSectionsProps {
  item: Item;
  metadata?: Metadata;
  registry: TypeRegistry;
  onRefresh: () => void;
}

export function ItemActionSections({
  item,
  metadata,
  registry,
  onRefresh,
}: ItemActionSectionsProps) {
  const { pop } = useNavigation();
  const url = getItemUrl(item);

  async function handleTransition(state: ItemState) {
    try {
      const client = getClient();
      await client.items.transition(item.id, state);
      await showToast({ style: Toast.Style.Success, title: `Moved to ${state}` });
      onRefresh();
    } catch (error) {
      await showFailureToast(error, { title: 'Failed to transition' });
    }
  }

  async function handleRestore() {
    try {
      const client = getClient();
      await client.items.restore(item.id);
      await showToast({ style: Toast.Style.Success, title: 'Item restored' });
      onRefresh();
    } catch (error) {
      await showFailureToast(error, { title: 'Failed to restore' });
    }
  }

  async function handleRemoveTag(tag: string) {
    try {
      const client = getClient();
      await client.metadata.removeTag(item.id, tag);
      await showToast({ style: Toast.Style.Success, title: `Removed tag: ${tag}` });
      onRefresh();
    } catch (error) {
      await showFailureToast(error, { title: 'Failed to remove tag' });
    }
  }

  async function handlePurge() {
    const confirmed = await confirmAlert({
      title: 'Delete Permanently',
      message: `Permanently delete "${registry.titleOf(item)}"? This cannot be undone.`,
      primaryAction: { title: 'Delete Permanently', style: Alert.ActionStyle.Destructive },
    });
    if (!confirmed) return;
    try {
      const client = getClient();
      await client.items.purge(item.id);
      await showToast({ style: Toast.Style.Success, title: 'Item deleted permanently' });
      onRefresh();
      pop();
    } catch (error) {
      await showFailureToast(error, { title: 'Failed to delete permanently' });
    }
  }

  const transitions: { state: ItemState; title: string; icon: Icon }[] = [];
  // Trashed items expose no state transitions here — Restore is a separate action.
  if (item.state !== 'trashed') {
    if (item.state !== 'active')
      transitions.push({ state: 'active', title: 'Move to Active', icon: Icon.CheckCircle });
    if (item.state !== 'archived')
      transitions.push({ state: 'archived', title: 'Archive', icon: Icon.Tray });
    transitions.push({ state: 'trashed', title: 'Trash', icon: Icon.Trash });
  }

  return (
    <>
      {url && (
        <ActionPanel.Section>
          <Action.OpenInBrowser url={url} shortcut={Keyboard.Shortcut.Common.Open} />
        </ActionPanel.Section>
      )}

      <ActionPanel.Section title="Copy">
        <Action.CopyToClipboard
          title="Copy Title"
          content={registry.titleOf(item)}
          shortcut={Keyboard.Shortcut.Common.Copy}
        />
        {url && (
          <Action.CopyToClipboard
            title="Copy URL"
            content={url}
            shortcut={{ modifiers: ['cmd', 'shift'], key: 'u' }}
          />
        )}
        <Action.CopyToClipboard
          title="Copy ID"
          content={item.id}
          shortcut={Keyboard.Shortcut.Common.Pin}
        />
      </ActionPanel.Section>

      <ActionPanel.Section title="Edges">
        <Action.Push
          title="Reply"
          icon={Icon.Reply}
          target={<ReplyForm targetItemId={item.id} onComplete={onRefresh} />}
        />
        <Action.Push
          title="Annotate"
          icon={Icon.Highlight}
          target={<AnnotateForm targetItemId={item.id} onComplete={onRefresh} />}
        />
      </ActionPanel.Section>

      <ActionPanel.Section title="Tags">
        <Action.Push
          title="Add Tag"
          icon={Icon.Tag}
          shortcut={{ modifiers: ['cmd'], key: 't' }}
          target={<AddTagForm itemId={item.id} onComplete={onRefresh} />}
        />
        {metadata?.tags.map((tag) => (
          <Action
            key={tag}
            title={`Remove Tag: ${tag}`}
            icon={Icon.XMarkCircle}
            onAction={() => handleRemoveTag(tag)}
          />
        ))}
      </ActionPanel.Section>

      <ActionPanel.Section title="State">
        {item.state === 'trashed' && (
          <Action
            title="Restore"
            icon={Icon.ArrowCounterClockwise}
            onAction={handleRestore}
            shortcut={{ modifiers: ['cmd', 'shift'], key: 'r' }}
          />
        )}
        {transitions.map(({ state, title, icon }) => (
          <Action key={state} title={title} icon={icon} onAction={() => handleTransition(state)} />
        ))}
      </ActionPanel.Section>

      {item.state === 'trashed' && (
        <ActionPanel.Section title="Danger">
          <Action
            title="Delete Permanently"
            icon={Icon.Trash}
            style={Action.Style.Destructive}
            onAction={handlePurge}
            shortcut={{ modifiers: ['ctrl'], key: 'x' }}
          />
        </ActionPanel.Section>
      )}
    </>
  );
}

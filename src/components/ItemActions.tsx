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
} from "@raycast/api";
import type { Item, Metadata, ItemState } from "../types";
import { transitionItem, addTags, removeTag, deleteItem } from "../api";
import { getItemTitle } from "../helpers";

function AddTagForm({ itemId, onComplete }: { itemId: string; onComplete: () => void }) {
  const { pop } = useNavigation();

  async function handleSubmit(values: { tags: string }) {
    const tags = values.tags
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    if (tags.length === 0) return;
    try {
      await addTags(itemId, tags);
      await showToast({ style: Toast.Style.Success, title: "Tags added" });
      onComplete();
      pop();
    } catch (error) {
      await showToast({ style: Toast.Style.Failure, title: "Failed to add tags", message: String(error) });
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

interface ItemActionSectionsProps {
  item: Item;
  metadata?: Metadata;
  onRefresh: () => void;
}

export function ItemActionSections({ item, metadata, onRefresh }: ItemActionSectionsProps) {
  const { pop } = useNavigation();

  async function handleTransition(state: ItemState) {
    try {
      await transitionItem(item.id, state);
      await showToast({ style: Toast.Style.Success, title: `Moved to ${state}` });
      onRefresh();
    } catch (error) {
      await showToast({ style: Toast.Style.Failure, title: "Failed to transition", message: String(error) });
    }
  }

  async function handleRemoveTag(tag: string) {
    try {
      await removeTag(item.id, tag);
      await showToast({ style: Toast.Style.Success, title: `Removed tag: ${tag}` });
      onRefresh();
    } catch (error) {
      await showToast({ style: Toast.Style.Failure, title: "Failed to remove tag", message: String(error) });
    }
  }

  async function handleDelete() {
    const confirmed = await confirmAlert({
      title: "Delete Item",
      message: `Are you sure you want to delete "${getItemTitle(item)}"?`,
      primaryAction: { title: "Delete", style: Alert.ActionStyle.Destructive },
    });
    if (!confirmed) return;
    try {
      await deleteItem(item.id);
      await showToast({ style: Toast.Style.Success, title: "Item deleted" });
      onRefresh();
      pop();
    } catch (error) {
      await showToast({ style: Toast.Style.Failure, title: "Failed to delete", message: String(error) });
    }
  }

  const transitions: { state: ItemState; title: string; icon: Icon }[] = [];
  if (item.state !== "active") transitions.push({ state: "active", title: "Move to Active", icon: Icon.CheckCircle });
  if (item.state !== "archived")
    transitions.push({ state: "archived", title: "Archive", icon: Icon.Tray });
  if (item.state !== "new") transitions.push({ state: "new", title: "Move to New", icon: Icon.Plus });

  return (
    <>
      <ActionPanel.Section>
        <Action.CopyToClipboard
          title="Copy ID"
          content={item.id}
          shortcut={{ modifiers: ["cmd"], key: "." }}
        />
      </ActionPanel.Section>

      <ActionPanel.Section title="Tags">
        <Action.Push
          title="Add Tag"
          icon={Icon.Tag}
          shortcut={{ modifiers: ["cmd"], key: "t" }}
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
        {transitions.map(({ state, title, icon }) => (
          <Action key={state} title={title} icon={icon} onAction={() => handleTransition(state)} />
        ))}
      </ActionPanel.Section>

      <ActionPanel.Section title="Danger">
        <Action
          title="Delete"
          icon={Icon.Trash}
          style={Action.Style.Destructive}
          onAction={handleDelete}
          shortcut={{ modifiers: ["ctrl"], key: "x" }}
        />
      </ActionPanel.Section>
    </>
  );
}

import { Action, ActionPanel, Color, Detail, Icon, Keyboard, List } from '@raycast/api';
import { useCachedPromise } from '@raycast/utils';
import { getClient } from '../client';
import { STATE_CONFIG } from '../constants';
import {
  getItemUrl,
  formatDate,
  formatTime,
  formatRelativeTime,
  toTitleCase,
  getImageSource,
  arrayBufferToBase64,
} from '../helpers';
import { ItemActionSections } from './ItemActions';
import { splitItemProperties, type ScalarSidebarEntry } from '../item-metadata';
import { useTypeRegistry } from '../use-type-registry';
import type { TypeRegistry } from '../type-display';
import type { Edge, Item } from '@withmarfa/sdk';

interface ItemDetailViewProps {
  itemId: string;
  onRefresh: () => void;
}

export function ItemDetailView({ itemId, onRefresh }: ItemDetailViewProps) {
  const { registry } = useTypeRegistry();
  const { data, isLoading, revalidate } = useCachedPromise(
    async (id: string) => {
      const client = getClient();
      const [item, metadata, edgesResponse] = await Promise.all([
        client.items.get(id),
        client.metadata.get(id),
        client.items.edges(id, { limit: 100 }),
      ]);
      const source = getImageSource(item);
      let imageMarkdownUrl: string | null = null;
      if (source?.kind === 'url') {
        imageMarkdownUrl = source.url;
      } else if (source?.kind === 'blob') {
        try {
          const bytes = await client.blobs.download(source.blobRef);
          imageMarkdownUrl = `data:${source.mimeType};base64,${arrayBufferToBase64(bytes)}`;
        } catch {
          imageMarkdownUrl = null;
        }
      }
      return { item, metadata, edges: edgesResponse.data, imageMarkdownUrl };
    },
    [itemId],
  );

  if (!data) {
    return <Detail isLoading={isLoading} />;
  }

  const { item, metadata, edges, imageMarkdownUrl } = data;
  const title = registry.titleOf(item);
  const bodyField = registry.bodyField(item.type);
  const url = getItemUrl(item);
  const typeLabel = registry.label(item.type);
  const typeVersion = registry.schema(item.type)?.version;
  const typeColor = registry.appearance(item.type).color;
  const stateConfig = STATE_CONFIG[item.state];

  const lines: string[] = [];
  if (imageMarkdownUrl) {
    lines.push(`![${title}](${imageMarkdownUrl})`, '');
  }
  lines.push(`# ${title}`, '');
  const p = item.properties;

  // The registry's own body field first, then the conventional names for
  // types it has no hint for.
  const hintedBody = bodyField ? p[bodyField] : undefined;
  if (typeof hintedBody === 'string' && hintedBody) lines.push(hintedBody, '');
  if (typeof p.body === 'string' && p.body) lines.push(p.body, '');
  if (typeof p.description === 'string' && p.description) lines.push(p.description, '');
  if (typeof p.text === 'string' && p.text) lines.push(p.text, '');
  if (typeof p.notes === 'string' && p.notes) lines.push(p.notes, '');
  if (typeof p.url === 'string' && p.url) lines.push(`[${p.url}](${p.url})`, '');

  const { scalar: sidebarEntries, complex: complexEntries } = splitItemProperties(item, [
    registry.titleField(item.type),
    bodyField,
  ]);

  // The nested values used to print here as two fenced JSON blocks, which is a
  // debug dump on a screen a person reads to understand one item. They are
  // summarized in the sidebar and copyable whole, which is what anyone actually
  // wanted the JSON for.
  const extensionNamespaces = Object.keys(metadata.extensions);
  const complexJson = JSON.stringify(
    Object.fromEntries(complexEntries.map((entry) => [entry.key, entry.value])),
    null,
    2,
  );

  const edgeCounts = new Map<string, number>();
  for (const edge of edges) {
    edgeCounts.set(edge.edge_type, (edgeCounts.get(edge.edge_type) ?? 0) + 1);
  }

  function handleRefresh() {
    revalidate();
    onRefresh();
  }

  return (
    <Detail
      isLoading={isLoading}
      markdown={lines.join('\n')}
      navigationTitle={title}
      metadata={
        <Detail.Metadata>
          <Detail.Metadata.TagList title="Type">
            <Detail.Metadata.TagList.Item text={typeLabel} color={typeColor} />
          </Detail.Metadata.TagList>
          <Detail.Metadata.TagList title="State">
            <Detail.Metadata.TagList.Item
              text={stateConfig?.label ?? item.state}
              color={stateConfig?.color ?? Color.PrimaryText}
            />
          </Detail.Metadata.TagList>
          {/* Only when there is one. A `system.*` item has no tier, and the row
              used to render a dash, which is a row whose entire content is
              that it has none. */}
          {item.tier && (
            <Detail.Metadata.TagList title="Tier">
              <Detail.Metadata.TagList.Item
                text={item.tier === 'library' ? 'Library' : 'Feed'}
                color={item.tier === 'library' ? Color.Green : Color.SecondaryText}
              />
            </Detail.Metadata.TagList>
          )}
          {metadata.tags.length > 0 && (
            <Detail.Metadata.TagList title="Tags">
              {metadata.tags.map((tag) => (
                <Detail.Metadata.TagList.Item key={tag} text={tag} />
              ))}
            </Detail.Metadata.TagList>
          )}

          <Detail.Metadata.Separator />
          <Detail.Metadata.Label
            title="Timestamp"
            text={`${formatDate(item.timestamp)} ${formatTime(item.timestamp)}`}
          />
          <Detail.Metadata.Label
            title="Updated"
            text={`${formatDate(item.updated_at)} ${formatTime(item.updated_at)} (${formatRelativeTime(item.updated_at)})`}
          />
          <Detail.Metadata.Label
            title="Created"
            text={`${formatDate(item.created_at)} ${formatTime(item.created_at)}`}
          />

          {/* Custom properties from the item's typed schema */}
          {/* One item's properties in one place. These were split across two
              non-adjacent sections, so a reader scanning a type's fields found
              half of them below the item's UUID. */}
          {(sidebarEntries.length > 0 || complexEntries.length > 0) && (
            <>
              <Detail.Metadata.Separator />
              {sidebarEntries.map((entry) => renderSidebarEntry(entry))}
              {complexEntries.map((entry) => (
                <Detail.Metadata.Label
                  key={entry.key}
                  title={toTitleCase(entry.key)}
                  text={summarizeComplex(entry.value)}
                />
              ))}
            </>
          )}

          {/* Provenance */}
          <Detail.Metadata.Separator />
          <Detail.Metadata.Label title="Source" text={item.source} />
          {item.device && <Detail.Metadata.Label title="Device" text={item.device} />}
          {item.source_id && <Detail.Metadata.Label title="Source ID" text={item.source_id} />}
          {/* Both halves or neither. One coordinate is not a location, and the
              row that used to render for it said so with a dash, which is a
              row whose only content is that it has none. The inline panel
              already required both; this is the two agreeing. */}
          {item.capture_latitude !== undefined && item.capture_longitude !== undefined && (
            <Detail.Metadata.Label
              title="Location"
              text={`${item.capture_latitude.toFixed(4)}, ${item.capture_longitude.toFixed(4)}`}
            />
          )}

          {/* Identity */}
          <Detail.Metadata.Separator />
          <Detail.Metadata.Label title="ID" text={item.id} />
          <Detail.Metadata.Label title="Revision" text={String(item.version)} />
          <Detail.Metadata.Label
            title="Schema version"
            // A number with nothing to compare it against says nothing. An item
            // written before its type moved is ordinary and harmless, and this
            // is the only place a person could notice it.
            text={
              typeVersion !== undefined && typeVersion !== item.schema_version
                ? `${String(item.schema_version)} (type is now v${String(typeVersion)})`
                : String(item.schema_version)
            }
          />

          {/* Relationships */}
          {(edgeCounts.size > 0 || extensionNamespaces.length > 0) && <Detail.Metadata.Separator />}
          {edgeCounts.size > 0 && (
            <Detail.Metadata.TagList title="Edges">
              {Array.from(edgeCounts.entries()).map(([edgeType, count]) => (
                <Detail.Metadata.TagList.Item
                  key={edgeType}
                  text={`${edgeType} (${count})`}
                  color={Color.SecondaryText}
                />
              ))}
            </Detail.Metadata.TagList>
          )}
          {extensionNamespaces.length > 0 && (
            <Detail.Metadata.TagList title="Extensions">
              {extensionNamespaces.map((ns) => (
                <Detail.Metadata.TagList.Item key={ns} text={ns} color={Color.SecondaryText} />
              ))}
            </Detail.Metadata.TagList>
          )}
        </Detail.Metadata>
      }
      actions={
        <ActionPanel>
          <ActionPanel.Section>
            {url && <Action.OpenInBrowser url={url} />}
            <Action
              title="Refresh"
              icon={Icon.ArrowClockwise}
              shortcut={Keyboard.Shortcut.Common.Refresh}
              onAction={handleRefresh}
            />
            {/* Neither copy action takes a shortcut. This panel already binds
                the common copy chord to Copy Title, and two actions on one
                chord means one of them silently stops working. */}
            {complexEntries.length > 0 && (
              <Action.CopyToClipboard title="Copy Extended Properties" content={complexJson} />
            )}
            {extensionNamespaces.length > 0 && (
              <Action.CopyToClipboard
                title="Copy Extensions"
                content={JSON.stringify(metadata.extensions, null, 2)}
              />
            )}
            {edges.length > 0 && (
              <Action.Push
                title="View Edges"
                icon={Icon.Link}
                target={
                  <EdgesDetailView itemTitle={title} edges={edges} onRefresh={handleRefresh} />
                }
              />
            )}
          </ActionPanel.Section>
          <ItemActionSections
            item={item}
            metadata={metadata}
            registry={registry}
            onRefresh={handleRefresh}
          />
        </ActionPanel>
      }
    />
  );
}

/**
 * What a nested value is, in the width of a metadata row.
 *
 * Enough to know whether it is worth copying, which is the decision this row
 * exists to support. The value itself is a copy action away, because a row
 * cannot render an object and a screen that tries reads as a dump.
 */
function summarizeComplex(value: unknown): string {
  if (Array.isArray(value)) {
    return value.length === 1 ? '1 entry' : `${String(value.length)} entries`;
  }
  if (typeof value === 'object' && value !== null) {
    const keys = Object.keys(value);
    // Named rather than listed. Key names read as a value in a row whose title
    // is already the property, so `metrics: { count: 5 }` rendered as
    // "Metrics: count", which parses as the metric being the word count.
    return keys.length === 1 ? '1 key' : `${String(keys.length)} keys`;
  }
  return String(value);
}

function renderSidebarEntry(entry: ScalarSidebarEntry) {
  const title = toTitleCase(entry.key);
  switch (entry.kind) {
    case 'datetime':
      return (
        <Detail.Metadata.Label
          key={entry.key}
          title={title}
          text={`${formatDate(entry.value)} ${formatTime(entry.value)}`}
        />
      );
    case 'url':
      return (
        <Detail.Metadata.Link
          key={entry.key}
          title={title}
          target={entry.value}
          text={entry.value}
        />
      );
    case 'boolean':
      return (
        <Detail.Metadata.TagList key={entry.key} title={title}>
          <Detail.Metadata.TagList.Item
            text={entry.value ? 'Yes' : 'No'}
            color={entry.value ? Color.Green : Color.SecondaryText}
          />
        </Detail.Metadata.TagList>
      );
    case 'number':
      return <Detail.Metadata.Label key={entry.key} title={title} text={String(entry.value)} />;
    case 'string':
    case 'array':
      return <Detail.Metadata.Label key={entry.key} title={title} text={entry.value} />;
  }
}

function EdgesDetailView({
  itemTitle,
  edges,
  onRefresh,
}: {
  itemTitle: string;
  edges: Edge[];
  onRefresh: () => void;
}) {
  const { registry } = useTypeRegistry();

  /**
   * Every target in one round-trip.
   *
   * **Not one request per row, which is what a hook inside the row would
   * mean.** React invokes every child to build the list, so nothing about a
   * per-row fetch is lazy: an item at the hundred-edge cap would fire a hundred
   * concurrent reads the instant this view opened, and a server that refused
   * them would raise a hundred separate toasts. `getMany` is capped at 100
   * server-side, which is the same bound the edge read already uses.
   *
   * Ids the caller cannot read are omitted rather than erroring, and the result
   * is unordered, so it is indexed rather than zipped.
   */
  const { data: targets, isLoading } = useCachedPromise(
    async (ids: string[]) => {
      if (ids.length === 0) return new Map<string, Item>();
      const items = await getClient().items.getMany(ids);
      return new Map(items.map((item) => [item.id, item]));
    },
    [[...new Set(edges.map((edge) => edge.target_id))]],
    { failureToastOptions: { title: 'Could not read the items these edges point at' } },
  );

  const grouped = new Map<string, Edge[]>();
  for (const edge of edges) {
    const list = grouped.get(edge.edge_type);
    if (list) list.push(edge);
    else grouped.set(edge.edge_type, [edge]);
  }

  return (
    <List
      isLoading={isLoading}
      navigationTitle={`Edges: ${itemTitle}`}
      searchBarPlaceholder="Filter edges..."
    >
      {[...grouped.entries()].map(([edgeType, ofType]) => (
        <List.Section key={edgeType} title={edgeType} subtitle={String(ofType.length)}>
          {ofType.map((edge) => (
            <EdgeRow
              key={edge.id}
              edge={edge}
              target={targets?.get(edge.target_id)}
              registry={registry}
              onRefresh={onRefresh}
            />
          ))}
        </List.Section>
      ))}
    </List>
  );
}

/**
 * One edge, with the thing on the other end of it reachable.
 *
 * An edge is a relationship, and a relationship rendered as a JSON object is a
 * dead end: the identifier of the item it points at was right there and there
 * was no way to follow it.
 *
 * A target the caller cannot read is shown by its id rather than hidden. The
 * edge exists either way, and an edge silently missing from this list would be
 * a worse answer than one a person cannot open.
 */
function EdgeRow({
  edge,
  target,
  registry,
  onRefresh,
}: {
  edge: Edge;
  target: Item | undefined;
  registry: TypeRegistry;
  onRefresh: () => void;
}) {
  const appearance = target ? registry.appearance(target.type) : undefined;
  const propertyCount = Object.keys(edge.properties).length;
  const accessories: List.Item.Accessory[] = [];
  if (propertyCount > 0) accessories.push({ text: `${String(propertyCount)} on the edge` });

  return (
    <List.Item
      title={target ? registry.titleOf(target) : edge.target_id}
      subtitle={target ? registry.label(target.type) : 'Not readable by this session'}
      icon={appearance ? { source: appearance.icon, tintColor: appearance.color } : Icon.Link}
      keywords={[edge.edge_type, edge.target_id]}
      accessories={accessories}
      actions={
        <ActionPanel>
          {target && (
            <Action.Push
              title="View Item"
              icon={Icon.Eye}
              target={<ItemDetailView itemId={edge.target_id} onRefresh={onRefresh} />}
            />
          )}
          <Action.CopyToClipboard title="Copy Target ID" content={edge.target_id} />
          <Action.CopyToClipboard title="Copy Edge JSON" content={JSON.stringify(edge, null, 2)} />
        </ActionPanel>
      }
    />
  );
}

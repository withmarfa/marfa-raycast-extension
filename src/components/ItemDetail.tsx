import {
  Action,
  ActionPanel,
  Color,
  Detail,
  Icon,
  Keyboard,
  List,
  useNavigation,
} from '@raycast/api';
import { usePromise } from '@raycast/utils';
import { typeIcon } from '../appearance';
import { formatRelative, formatWhen } from '../dates';
import type { Registry } from '../display';
import { describeFailure } from '../failure';
import { showFailure } from '../feedback';
import {
  buildItemMarkdown,
  groupRelations,
  IMAGE_PREVIEW_MAX_BYTES,
  imageSource,
  relatedIds,
  type SidebarEntry,
  sidebarEntries,
  summarizeComplex,
} from '../item-view';
import {
  downloadBlob,
  type Entry,
  getItem,
  getMany,
  type Item,
  listEdges,
  listVersions,
} from '../marfa';
import { toTitleCase } from '../schema-fields';
import { ItemActions } from './ItemActions';

const STATE_TAGS: Record<string, { text: string; color: Color }> = {
  active: { text: 'Active', color: Color.Green },
  archived: { text: 'Archived', color: Color.Blue },
  trashed: { text: 'Trashed', color: Color.Red },
};

/** A picture as markdown can draw it: a stored image fetched into a data URI, anything else as is. */
async function loadImage(kind: string, ref: string, mimeType: string): Promise<string | null> {
  if (kind !== 'blob') return ref;
  const bytes = await downloadBlob(ref);
  if (bytes.byteLength > IMAGE_PREVIEW_MAX_BYTES) return null;
  return `data:${mimeType};base64,${Buffer.from(bytes).toString('base64')}`;
}

/**
 * One item in full: its text and picture, every property, its tags, its
 * relations and where it came from. Read afresh on open, except in the Trash,
 * where the server answers a trashed item only in a listing, so the row is
 * what there is.
 */
export function ItemDetail({
  entry,
  registry,
  onChanged,
}: {
  entry: Entry;
  registry: Registry;
  onChanged: () => void;
}) {
  const { pop } = useNavigation();
  // A trashed item answers 404 by id, so that answer means the row is still what there is.
  const fresh = usePromise(
    async (id: string) => {
      try {
        return await getItem(id);
      } catch (error) {
        if (describeFailure(error).kind === 'gone') return undefined;
        throw error;
      }
    },
    [entry.item.id],
    {
      execute: entry.item.state !== 'trashed',
      onError: (error) => void showFailure(error, 'Reading the item'),
    },
  );
  const current = fresh.data ?? entry;
  const { item, metadata } = current;
  const trashed = item.state === 'trashed';
  // Keyed by what the picture is, so the row and the fresh read do not each fetch it.
  const source = imageSource(item, registry);
  const image = usePromise(
    loadImage,
    [
      source?.kind ?? '',
      source ? (source.kind === 'blob' ? source.hash : source.url) : '',
      source?.kind === 'blob' ? source.mimeType : '',
    ],
    { execute: source !== null, onError: () => undefined },
  );
  const edges = usePromise((id: string) => listEdges(id), [item.id], {
    execute: !trashed,
    onError: () => undefined,
  });

  const title = registry.titleOf(item);
  const isNote = registry.isNote(item.type);
  const bodyField = registry.bodyField(item.type) ?? (isNote ? 'body' : undefined);
  const titleField = registry.titleField(item.type);
  const markdown = buildItemMarkdown({
    item,
    title,
    bodyField,
    titleField,
    titleIsBody: isNote,
    imageUrl: source ? image.data : null,
  });
  const entries = sidebarEntries(item, [bodyField, isNote ? undefined : titleField]);
  const type = registry.type(item.type);
  const relatedCount = edges.data ? relatedIds(groupRelations(edges.data)).length : 0;
  const state = STATE_TAGS[item.state] ?? { text: item.state, color: Color.SecondaryText };

  function changed() {
    // Read again even in the Trash: a restore makes the item readable by id.
    fresh.revalidate();
    if (!trashed) edges.revalidate();
    onChanged();
  }

  return (
    <Detail
      isLoading={fresh.isLoading || image.isLoading}
      navigationTitle={title}
      markdown={markdown}
      metadata={
        <Detail.Metadata>
          <Detail.Metadata.TagList title="Type">
            <Detail.Metadata.TagList.Item text={registry.label(item.type)} />
          </Detail.Metadata.TagList>
          <Detail.Metadata.TagList title="State">
            <Detail.Metadata.TagList.Item text={state.text} color={state.color} />
          </Detail.Metadata.TagList>
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
          {entries.length > 0 && <Detail.Metadata.Separator />}
          {entries.map((property) => (
            <SidebarRow key={property.key} entry={property} />
          ))}
          <Detail.Metadata.Separator />
          {item.occurred_at && item.occurred_at !== item.created_at && (
            <Detail.Metadata.Label title="Happened" text={formatWhen(item.occurred_at)} />
          )}
          <Detail.Metadata.Label
            title="Updated"
            text={`${formatWhen(item.updated_at)} (${formatRelative(item.updated_at)})`}
          />
          <Detail.Metadata.Label title="Created" text={formatWhen(item.created_at)} />
          <Detail.Metadata.Label title="Source" text={item.source} />
          {item.source_id && <Detail.Metadata.Label title="Source ID" text={item.source_id} />}
          {relatedCount > 0 && (
            <Detail.Metadata.Label
              title="Related"
              text={relatedCount === 1 ? '1 item' : `${String(relatedCount)} items`}
            />
          )}
          {Object.keys(metadata.extensions).length > 0 && (
            <Detail.Metadata.TagList title="Extensions">
              {Object.keys(metadata.extensions).map((namespace) => (
                <Detail.Metadata.TagList.Item
                  key={namespace}
                  text={namespace}
                  color={Color.SecondaryText}
                />
              ))}
            </Detail.Metadata.TagList>
          )}
          <Detail.Metadata.Separator />
          <Detail.Metadata.Label title="ID" text={item.id} />
          <Detail.Metadata.Label
            title="Version"
            text={
              type && type.version !== item.schema_version
                ? `${String(item.version)}, schema ${String(item.schema_version)} (type is now ${String(type.version)})`
                : String(item.version)
            }
          />
        </Detail.Metadata>
      }
      actions={
        <ActionPanel title={title}>
          <ItemActions
            entry={current}
            registry={registry}
            onChanged={changed}
            onGone={pop}
            lead={
              !trashed && (
                <>
                  {relatedCount > 0 && (
                    <Action.Push
                      title="Show Related Items"
                      icon={Icon.Link}
                      shortcut={{ modifiers: ['cmd'], key: 'l' }}
                      target={
                        <RelatedItems
                          id={item.id}
                          title={title}
                          registry={registry}
                          onChanged={changed}
                        />
                      }
                    />
                  )}
                  <Action.Push
                    title="Show Versions"
                    icon={Icon.Clock}
                    shortcut={{ modifiers: ['cmd', 'shift'], key: 'h' }}
                    target={<VersionList item={item} registry={registry} />}
                  />
                </>
              )
            }
          />
          <ActionPanel.Section>
            <Action
              title="Refresh"
              icon={Icon.ArrowClockwise}
              shortcut={Keyboard.Shortcut.Common.Refresh}
              onAction={changed}
            />
            <Action.CopyToClipboard
              title="Copy Properties as JSON"
              content={JSON.stringify(item.properties, null, 2)}
            />
            {Object.keys(metadata.extensions).length > 0 && (
              <Action.CopyToClipboard
                title="Copy Extensions as JSON"
                content={JSON.stringify(metadata.extensions, null, 2)}
              />
            )}
          </ActionPanel.Section>
        </ActionPanel>
      }
    />
  );
}

function SidebarRow({ entry }: { entry: SidebarEntry }) {
  const title = toTitleCase(entry.key);
  switch (entry.kind) {
    case 'datetime':
      return <Detail.Metadata.Label title={title} text={formatWhen(entry.value)} />;
    case 'url':
      return <Detail.Metadata.Link title={title} target={entry.value} text={entry.value} />;
    case 'boolean':
      return (
        <Detail.Metadata.TagList title={title}>
          <Detail.Metadata.TagList.Item
            text={entry.value ? 'Yes' : 'No'}
            color={entry.value ? Color.Green : Color.SecondaryText}
          />
        </Detail.Metadata.TagList>
      );
    case 'complex':
      return <Detail.Metadata.Label title={title} text={summarizeComplex(entry.value)} />;
    default:
      return <Detail.Metadata.Label title={title} text={String(entry.value)} />;
  }
}

/**
 * Every item this one links to and every item linking to it, by edge type,
 * with the items read in one batch rather than one call a row.
 */
function RelatedItems({
  id,
  title,
  registry,
  onChanged,
}: {
  id: string;
  title: string;
  registry: Registry;
  onChanged: () => void;
}) {
  // Its own read, so an action taken from an item opened here shows when it comes back.
  const related = usePromise(
    async (itemId: string) => {
      const groups = groupRelations(await listEdges(itemId));
      const items = new Map((await getMany(relatedIds(groups))).map((row) => [row.id, row]));
      return { groups, items };
    },
    [id],
    { onError: (error) => void showFailure(error, 'Reading the related items') },
  );
  const groups = related.data?.groups ?? [];
  const items = { data: related.data?.items, isLoading: related.isLoading };
  const changed = () => {
    related.revalidate();
    onChanged();
  };

  return (
    <List
      isLoading={items.isLoading}
      navigationTitle={`Related to ${title}`}
      searchBarPlaceholder="Filter related items"
    >
      {groups.map((group) => (
        <List.Section
          key={group.title}
          title={group.title}
          subtitle={String(group.relations.length)}
        >
          {group.relations.map((relation) => {
            const other = items.data?.get(relation.otherId);
            return (
              <List.Item
                key={relation.edge.id}
                title={other ? registry.titleOf(other) : relation.otherId}
                subtitle={
                  other ? registry.label(other.type) : 'Not readable with this key, or in the Trash'
                }
                icon={other ? typeIcon(registry, other.type) : Icon.Link}
                keywords={[relation.edge.edge_type]}
                actions={
                  <ActionPanel>
                    {other && (
                      <Action.Push
                        title="Show Item"
                        icon={Icon.Eye}
                        target={
                          <ItemDetail
                            entry={{
                              item: other,
                              metadata: { item_id: other.id, tags: [], extensions: {} },
                            }}
                            registry={registry}
                            onChanged={changed}
                          />
                        }
                      />
                    )}
                    <Action.CopyToClipboard title="Copy ID" content={relation.otherId} />
                    <Action.CopyToClipboard
                      title="Copy Edge as JSON"
                      content={JSON.stringify(relation.edge, null, 2)}
                    />
                  </ActionPanel>
                }
              />
            );
          })}
        </List.Section>
      ))}
    </List>
  );
}

/** The versions the server keeps of an item before its current one, newest first. */
function VersionList({ item, registry }: { item: Item; registry: Registry }) {
  const versions = usePromise((id: string) => listVersions(id), [item.id], {
    onError: (error) => void showFailure(error, 'Reading the versions'),
  });
  const rows = [...(versions.data ?? [])].sort((a, b) => b.version - a.version);
  const bodyField = registry.bodyField(item.type) ?? 'body';

  return (
    <List
      isLoading={versions.isLoading}
      navigationTitle={`Versions of ${registry.titleOf(item)}`}
      isShowingDetail={rows.length > 0}
    >
      {!versions.isLoading && rows.length === 0 && (
        <List.EmptyView
          title="No earlier versions"
          description={`This is version ${String(item.version)}, and the server keeps none before it.`}
        />
      )}
      {rows.map((version) => {
        const as = { ...item, properties: version.properties, version: version.version };
        return (
          <List.Item
            key={version.id}
            title={`Version ${String(version.version)}`}
            subtitle={formatRelative(version.created_at)}
            detail={
              <List.Item.Detail
                markdown={buildItemMarkdown({
                  item: as,
                  title: registry.titleOf(as),
                  bodyField,
                  titleIsBody: registry.isNote(item.type),
                })}
                metadata={
                  <List.Item.Detail.Metadata>
                    <List.Item.Detail.Metadata.Label
                      title="Saved"
                      text={formatWhen(version.created_at)}
                    />
                  </List.Item.Detail.Metadata>
                }
              />
            }
            actions={
              <ActionPanel>
                {typeof version.properties[bodyField] === 'string' && (
                  <Action.CopyToClipboard
                    title="Copy Text"
                    content={version.properties[bodyField] as string}
                  />
                )}
                <Action.CopyToClipboard
                  title="Copy Properties as JSON"
                  content={JSON.stringify(version.properties, null, 2)}
                />
              </ActionPanel>
            }
          />
        );
      })}
    </List>
  );
}

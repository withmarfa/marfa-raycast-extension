import {
  Action,
  ActionPanel,
  Alert,
  Color,
  confirmAlert,
  Detail,
  Icon,
  showToast,
  Toast,
  useNavigation,
  Keyboard,
} from '@raycast/api';
import { showFailureToast } from '@raycast/utils';
import type { ApiKey } from '@withmarfa/sdk';
import { ForbiddenError } from '@withmarfa/sdk';
import { getClient } from '../client';
import { roleColor } from '../constants';
import { formatRelativeTime } from '../helpers';
import { EditKeyForm } from './KeyForms';
import { showRefusal } from '../show-refusal';

function permissionMapTags(map: Record<string, string> | undefined): Array<[string, string]> {
  return Object.entries(map ?? {});
}

/** How many resources a key names across every map, which is the one thing the
 *  sidebar's tag lists do not say at a glance. */
function permissionCount(apiKey: ApiKey): number {
  return [
    apiKey.type_permissions,
    apiKey.extension_permissions,
    apiKey.edge_permissions,
    apiKey.metadata_permissions,
  ].reduce((total, map) => total + Object.keys(map ?? {}).length, 0);
}

export function KeyDetailView({ apiKey, onRefresh }: { apiKey: ApiKey; onRefresh: () => void }) {
  const { pop } = useNavigation();

  // The four permission maps used to print here as JSON blocks while the
  // sidebar rendered the same entries as tags, so the screen said everything
  // twice and neither copy was readable. The tags are the answer; the raw form
  // is one action away for anyone who wants to paste it somewhere.
  const count = permissionCount(apiKey);
  const markdown = [
    `# ${apiKey.label}`,
    '',
    count === 0
      ? 'This key names no permissions, so it can reach nothing.'
      : `Grants across ${count === 1 ? '1 resource' : `${String(count)} resources`}, listed beside.`,
  ].join('\n');

  const permissionsJson = JSON.stringify(
    {
      type_permissions: apiKey.type_permissions,
      extension_permissions: apiKey.extension_permissions,
      edge_permissions: apiKey.edge_permissions,
      metadata_permissions: apiKey.metadata_permissions,
    },
    null,
    2,
  );

  async function handleRevoke() {
    const confirmed = await confirmAlert({
      title: 'Revoke Key',
      message: `Revoke key "${apiKey.label}"? This cannot be undone.`,
      primaryAction: { title: 'Revoke', style: Alert.ActionStyle.Destructive },
    });
    if (!confirmed) return;
    try {
      const client = getClient();
      await client.keys.revoke(apiKey.id);
      await showToast({ style: Toast.Style.Success, title: 'Key revoked' });
      onRefresh();
      pop();
    } catch (error) {
      if (error instanceof ForbiddenError) {
        await showRefusal(error);
      } else {
        await showFailureToast(error, { title: 'Failed to revoke key' });
      }
    }
  }

  const typeTags = permissionMapTags(apiKey.type_permissions);
  const extTags = permissionMapTags(apiKey.extension_permissions);
  const edgeTags = permissionMapTags(apiKey.edge_permissions);
  const metadataTags = permissionMapTags(apiKey.metadata_permissions);

  return (
    <Detail
      markdown={markdown}
      navigationTitle={apiKey.label}
      metadata={
        <Detail.Metadata>
          {/* No Label row. It is the heading directly above and the navigation
              title, and a screen that states an identifier three times is the
              same defect the list row had. */}
          <Detail.Metadata.TagList title="Role">
            <Detail.Metadata.TagList.Item text={apiKey.role} color={roleColor(apiKey.role)} />
          </Detail.Metadata.TagList>
          <Detail.Metadata.Label title="Source" text={apiKey.source} />
          <Detail.Metadata.Separator />
          <Detail.Metadata.TagList title="Default tier">
            <Detail.Metadata.TagList.Item
              text={apiKey.default_tier}
              color={apiKey.default_tier === 'library' ? Color.Green : Color.SecondaryText}
            />
          </Detail.Metadata.TagList>
          <Detail.Metadata.Separator />
          <Detail.Metadata.Label title="Created" text={formatRelativeTime(apiKey.created_at)} />
          <Detail.Metadata.Label title="Last used" text={formatRelativeTime(apiKey.last_used_at)} />
          <Detail.Metadata.Separator />
          <Detail.Metadata.Label title="ID" text={apiKey.id} />
          <Detail.Metadata.Separator />
          {typeTags.length > 0 && (
            <Detail.Metadata.TagList title="Type permissions">
              {typeTags.map(([pattern, level]) => (
                <Detail.Metadata.TagList.Item key={pattern} text={`${pattern}: ${level}`} />
              ))}
            </Detail.Metadata.TagList>
          )}
          {extTags.length > 0 && (
            <Detail.Metadata.TagList title="Extension permissions">
              {extTags.map(([ns, level]) => (
                <Detail.Metadata.TagList.Item key={ns} text={`${ns}: ${level}`} />
              ))}
            </Detail.Metadata.TagList>
          )}
          {edgeTags.length > 0 && (
            <Detail.Metadata.TagList title="Edge permissions">
              {edgeTags.map(([edge, level]) => (
                <Detail.Metadata.TagList.Item key={edge} text={`${edge}: ${level}`} />
              ))}
            </Detail.Metadata.TagList>
          )}
          {metadataTags.length > 0 && (
            <Detail.Metadata.TagList title="Metadata permissions">
              {metadataTags.map(([resource, level]) => (
                <Detail.Metadata.TagList.Item key={resource} text={`${resource}: ${level}`} />
              ))}
            </Detail.Metadata.TagList>
          )}
        </Detail.Metadata>
      }
      actions={
        <ActionPanel>
          <Action.Push
            title="Edit"
            icon={Icon.Pencil}
            target={<EditKeyForm apiKey={apiKey} onSaved={onRefresh} />}
          />
          <Action.CopyToClipboard
            title="Copy Permissions JSON"
            content={permissionsJson}
            shortcut={Keyboard.Shortcut.Common.Copy}
          />
          <Action.CopyToClipboard
            title="Copy Key ID"
            content={apiKey.id}
            shortcut={Keyboard.Shortcut.Common.Pin}
          />
          <Action.CopyToClipboard
            title="Copy Source"
            content={apiKey.source}
            shortcut={Keyboard.Shortcut.Common.Duplicate}
          />
          <ActionPanel.Section title="Danger">
            <Action
              title="Revoke Key"
              icon={Icon.Trash}
              style={Action.Style.Destructive}
              onAction={handleRevoke}
              shortcut={{ modifiers: ['ctrl'], key: 'x' }}
            />
          </ActionPanel.Section>
        </ActionPanel>
      }
    />
  );
}

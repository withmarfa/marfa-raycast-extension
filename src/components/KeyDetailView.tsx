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
} from '@raycast/api';
import { showFailureToast } from '@raycast/utils';
import type { ApiKey } from '@mymehq/sdk';
import { ForbiddenError } from '@mymehq/sdk';
import { getClient } from '../client';
import { formatRelativeTime } from '../helpers';
import { EditKeyForm } from './KeyForms';

function permissionMapTags(map: Record<string, string> | undefined): Array<[string, string]> {
  return Object.entries(map ?? {});
}

function permissionMapBlock(label: string, map: Record<string, string> | undefined): string {
  const entries = Object.entries(map ?? {});
  if (entries.length === 0) return `**${label}:** none\n`;
  return `**${label}:**\n\n\`\`\`json\n${JSON.stringify(map, null, 2)}\n\`\`\`\n`;
}

export function KeyDetailView({ apiKey, onRefresh }: { apiKey: ApiKey; onRefresh: () => void }) {
  const { pop } = useNavigation();

  const markdown = [
    `# ${apiKey.label}`,
    '',
    permissionMapBlock('Type permissions', apiKey.type_permissions),
    permissionMapBlock('Extension permissions', apiKey.extension_permissions),
    permissionMapBlock('Edge permissions', apiKey.edge_permissions),
  ].join('\n');

  async function handleRevoke() {
    const confirmed = await confirmAlert({
      title: 'Revoke Key',
      message: `Revoke key "${apiKey.label}"? This cannot be undone.`,
      primaryAction: { title: 'Revoke', style: Alert.ActionStyle.Destructive },
    });
    if (!confirmed) return;
    try {
      const client = await getClient();
      await client.keys.revoke(apiKey.id);
      await showToast({ style: Toast.Style.Success, title: 'Key revoked' });
      onRefresh();
      pop();
    } catch (error) {
      if (error instanceof ForbiddenError) {
        await showFailureToast(error, { title: 'Admin credentials required' });
      } else {
        await showFailureToast(error, { title: 'Failed to revoke key' });
      }
    }
  }

  const typeTags = permissionMapTags(apiKey.type_permissions);
  const extTags = permissionMapTags(apiKey.extension_permissions);
  const edgeTags = permissionMapTags(apiKey.edge_permissions);

  return (
    <Detail
      markdown={markdown}
      navigationTitle={apiKey.label}
      metadata={
        <Detail.Metadata>
          <Detail.Metadata.Label title="Label" text={apiKey.label} />
          <Detail.Metadata.TagList title="Role">
            <Detail.Metadata.TagList.Item
              text={apiKey.role}
              color={apiKey.role === 'admin' ? Color.Red : Color.Blue}
            />
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
            title="Copy Key ID"
            content={apiKey.id}
            shortcut={{ modifiers: ['cmd'], key: '.' }}
          />
          <Action.CopyToClipboard
            title="Copy Source"
            content={apiKey.source}
            shortcut={{ modifiers: ['cmd', 'shift'], key: 's' }}
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

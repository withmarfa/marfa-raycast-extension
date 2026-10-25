import { Action, ActionPanel, Color, Detail, Icon, Keyboard, useNavigation } from '@raycast/api';
import { formatRelative, formatWhen } from '../dates';
import { keySummary, MAPS } from '../keys';
import type { ApiKey } from '../marfa';
import { EditKeyForm } from './KeyForms';

function mapMarkdown(title: string, map: Record<string, string> | undefined): string {
  const entries = Object.entries(map ?? {});
  if (entries.length === 0) return `### ${title}\n\nNothing.`;
  return [
    `### ${title}`,
    '',
    '| Pattern | Level |',
    '| --- | --- |',
    ...entries.map(([pattern, level]) => `| \`${pattern}\` | ${level} |`),
  ].join('\n');
}

/** One key: every map it holds, its permissions and what it writes as. */
export function KeyDetail({
  apiKey,
  own,
  onChanged,
  onRevoke,
}: {
  apiKey: ApiKey;
  own: boolean;
  onChanged: () => void;
  /** Answers whether the key was revoked, so the detail can leave a key that is gone. */
  onRevoke?: () => Promise<boolean>;
}) {
  const { pop } = useNavigation();
  const markdown = [
    `# ${apiKey.label}`,
    ...MAPS.map((map) =>
      mapMarkdown(map.title, apiKey[map.field] as Record<string, string> | undefined),
    ),
    ...(apiKey.enforcement_override
      ? [
          '### Enforcement override',
          '',
          '```json',
          JSON.stringify(apiKey.enforcement_override, null, 2),
          '```',
        ]
      : []),
  ]
    .filter((part) => part !== '')
    .join('\n\n');

  return (
    <Detail
      navigationTitle={apiKey.label}
      markdown={markdown}
      metadata={
        <Detail.Metadata>
          <Detail.Metadata.Label title="Reaches" text={keySummary(apiKey)} />
          {own && (
            <Detail.Metadata.TagList title="In Use">
              <Detail.Metadata.TagList.Item
                text="The key in these preferences"
                color={Color.Green}
              />
            </Detail.Metadata.TagList>
          )}
          <Detail.Metadata.Label title="Source" text={apiKey.source} />
          {(apiKey.sources ?? []).length > 0 && (
            <Detail.Metadata.TagList title="Also Writes As">
              {(apiKey.sources ?? []).map((source) => (
                <Detail.Metadata.TagList.Item key={source} text={source} />
              ))}
            </Detail.Metadata.TagList>
          )}
          <Detail.Metadata.TagList title="Permissions">
            {(apiKey.permissions ?? []).length > 0 ? (
              (apiKey.permissions ?? []).map((permission) => (
                <Detail.Metadata.TagList.Item
                  key={permission}
                  text={permission}
                  color={Color.Orange}
                />
              ))
            ) : (
              <Detail.Metadata.TagList.Item text="None" color={Color.SecondaryText} />
            )}
          </Detail.Metadata.TagList>
          <Detail.Metadata.Label
            title="Default Tier"
            text={apiKey.default_tier === 'feed' ? 'Feed' : 'Library'}
          />
          <Detail.Metadata.Separator />
          <Detail.Metadata.Label title="Created" text={formatWhen(apiKey.created_at)} />
          <Detail.Metadata.Label title="Last Used" text={formatRelative(apiKey.last_used_at)} />
          {apiKey.expires_at && (
            <Detail.Metadata.Label title="Expires" text={formatWhen(apiKey.expires_at)} />
          )}
          {apiKey.oauth_client_id && (
            <Detail.Metadata.Label title="Minted by App" text={apiKey.oauth_client_id} />
          )}
          <Detail.Metadata.Label title="ID" text={apiKey.id} />
        </Detail.Metadata>
      }
      actions={
        <ActionPanel>
          <Action.Push
            title="Edit Key"
            icon={Icon.Pencil}
            shortcut={Keyboard.Shortcut.Common.Edit}
            target={
              <EditKeyForm
                apiKey={apiKey}
                onSaved={() => {
                  // The form pops itself after this; this pop takes the stale detail
                  // with it, so the edit lands on the list, which reads the key again.
                  onChanged();
                  pop();
                }}
              />
            }
          />
          <Action.CopyToClipboard
            title="Copy Key as JSON"
            content={JSON.stringify(apiKey, null, 2)}
          />
          <Action.CopyToClipboard
            title="Copy Key ID"
            content={apiKey.id}
            shortcut={{ modifiers: ['cmd', 'shift'], key: 'i' }}
          />
          {onRevoke && (
            <Action
              title="Revoke Key"
              icon={Icon.Trash}
              style={Action.Style.Destructive}
              shortcut={Keyboard.Shortcut.Common.Remove}
              onAction={() => void onRevoke().then((revoked) => revoked && pop())}
            />
          )}
        </ActionPanel>
      }
    />
  );
}

import { Action, ActionPanel, Color, Detail, Icon, List } from '@raycast/api';
import { showFailureToast, useCachedPromise } from '@raycast/utils';
import type { TypeSchema } from '@mymehq/sdk';
import { getClient, MymeAuthMissingError } from './client';
import { SignInRequiredEmptyView } from './components/SignInRequiredView';

/**
 * Type Registry — read-only operator view. Lists every type registered on
 * the instance (core + custom + system). Detail per type shows the full
 * schema as JSON for inspection. Disabled by default in `package.json`.
 */

type TypeKind = 'core' | 'custom' | 'system';

function classifyType(id: string): TypeKind {
  if (id.startsWith('core.')) return 'core';
  if (id.startsWith('system.')) return 'system';
  return 'custom';
}

const KIND_COLOR: Record<TypeKind, Color> = {
  core: Color.Blue,
  custom: Color.Purple,
  system: Color.SecondaryText,
};

export default function TypeRegistryCommand() {
  const { data, isLoading, error, revalidate } = useCachedPromise(
    async () => {
      const client = await getClient();
      const types = await client.types.list();
      return types.slice().sort((a, b) => a.id.localeCompare(b.id));
    },
    [],
    {
      onError: async (err) => {
        if (err instanceof MymeAuthMissingError) return;
        await showFailureToast(err, { title: 'Failed to load types' });
      },
    },
  );

  if (error instanceof MymeAuthMissingError) {
    return (
      <List isLoading={isLoading}>
        <SignInRequiredEmptyView />
      </List>
    );
  }

  return (
    <List isLoading={isLoading} searchBarPlaceholder="Filter types by id or label...">
      {(data ?? []).map((schema) => {
        const kind = classifyType(schema.id);
        return (
          <List.Item
            key={schema.id}
            icon={{ source: Icon.Document, tintColor: KIND_COLOR[kind] }}
            title={schema.id}
            subtitle={schema.label ?? undefined}
            keywords={[schema.id, schema.label ?? '', kind]}
            accessories={[
              { tag: { value: kind, color: KIND_COLOR[kind] } },
              schema.version !== undefined ? { text: `v${String(schema.version)}` } : { text: '' },
            ]}
            actions={
              <ActionPanel>
                <Action.Push
                  title="View Schema"
                  icon={Icon.Eye}
                  target={<TypeDetail schema={schema} />}
                />
                <Action.CopyToClipboard
                  title="Copy Type ID"
                  content={schema.id}
                  shortcut={{ modifiers: ['cmd'], key: '.' }}
                />
                <Action
                  title="Refresh"
                  icon={Icon.ArrowClockwise}
                  shortcut={{ modifiers: ['cmd'], key: 'r' }}
                  onAction={revalidate}
                />
              </ActionPanel>
            }
          />
        );
      })}
    </List>
  );
}

function TypeDetail({ schema }: { schema: TypeSchema }) {
  const lines: string[] = [];
  lines.push(`# ${schema.id}`, '');
  if (schema.label) lines.push(`**${schema.label}**`, '');
  if (schema.description) lines.push(schema.description, '');
  lines.push('```json');
  lines.push(JSON.stringify(schema, null, 2));
  lines.push('```');
  return (
    <Detail
      navigationTitle={schema.id}
      markdown={lines.join('\n')}
      actions={
        <ActionPanel>
          <Action.CopyToClipboard
            title="Copy Type ID"
            content={schema.id}
            shortcut={{ modifiers: ['cmd'], key: '.' }}
          />
          <Action.CopyToClipboard
            title="Copy Schema JSON"
            content={JSON.stringify(schema, null, 2)}
            shortcut={{ modifiers: ['cmd', 'shift'], key: 'c' }}
          />
        </ActionPanel>
      }
    />
  );
}

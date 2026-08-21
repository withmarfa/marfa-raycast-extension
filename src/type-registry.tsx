import { Action, ActionPanel, Color, Detail, Icon, List, Keyboard } from '@raycast/api';
import { showFailureToast, useCachedPromise } from '@raycast/utils';
import type { TypeSchema } from '@withmarfa/sdk';
import { classifyNamespace } from '@withmarfa/shared';
import type { NamespaceTier } from '@withmarfa/shared';
import { withMarfaAccessToken } from './auth/with-marfa-access-token';
import { getClient } from './client';

/**
 * Type Registry — read-only operator view. Lists every type registered on
 * the instance (core + custom + system). Detail per type shows the full
 * schema as JSON for inspection. Disabled by default in package.json.
 */

/**
 * Tiers come from the platform's own namespace grammar rather than from
 * prefix matching here, so a tier the platform adds is a compile error
 * rather than a type silently filed as "custom".
 */
const TIER_COLOR: Record<NamespaceTier, Color> = {
  core: Color.Blue,
  system: Color.SecondaryText,
  app: Color.SecondaryText,
  user: Color.Purple,
  publisher: Color.Magenta,
  marfa: Color.Magenta,
};

function TypeRegistryCommand() {
  const { data, isLoading, revalidate } = useCachedPromise(
    async () => {
      const client = getClient();
      const types = await client.types.list();
      return types.slice().sort((a, b) => a.id.localeCompare(b.id));
    },
    [],
    {
      onError: async (err) => {
        await showFailureToast(err, { title: 'Failed to load types' });
      },
    },
  );

  return (
    <List isLoading={isLoading} searchBarPlaceholder="Filter types by id or label...">
      {(data ?? []).map((schema) => {
        const tier = classifyNamespace(schema.id);
        return (
          <List.Item
            key={schema.id}
            icon={{ source: Icon.Document, tintColor: TIER_COLOR[tier] }}
            title={schema.id}
            subtitle={schema.label ?? undefined}
            keywords={[schema.id, schema.label ?? '', tier]}
            accessories={[
              { tag: { value: tier, color: TIER_COLOR[tier] } },
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
                  shortcut={Keyboard.Shortcut.Common.Pin}
                />
                <Action
                  title="Refresh"
                  icon={Icon.ArrowClockwise}
                  shortcut={Keyboard.Shortcut.Common.Refresh}
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
            shortcut={Keyboard.Shortcut.Common.Pin}
          />
          <Action.CopyToClipboard
            title="Copy Schema JSON"
            content={JSON.stringify(schema, null, 2)}
            shortcut={Keyboard.Shortcut.Common.Copy}
          />
        </ActionPanel>
      }
    />
  );
}

export default withMarfaAccessToken(TypeRegistryCommand);

import { Action, ActionPanel, Icon, List, Keyboard } from '@raycast/api';
import { showFailureToast, useCachedPromise } from '@raycast/utils';
import type { FieldDefinition } from '@withmarfa/shared';
import { classifyNamespace } from '@withmarfa/shared';
import type { TypeSchema } from '@withmarfa/sdk';
import { withMarfaAccessToken } from './auth/with-marfa-access-token';
import { getClient } from './client';
import { requiredFieldNames, resolveSchemaFields } from './schema-fields';
import { buildTypeRegistry, TIER_APPEARANCE } from './type-display';

/**
 * Type Registry, a read-only operator view over every type an instance holds.
 *
 * **It renders what the schema says rather than the schema itself.** The list
 * used to give every row the same document glyph, in one of six tints, while
 * the extension already held a resolver that tells a book from a song from a
 * film; and opening a type printed its schema as a fenced JSON block, which is
 * the one representation that survives none of the structure the schema has.
 * This is the surface a person opens to understand what an instance holds, and
 * it communicated least.
 */

function TypeRegistryCommand() {
  const { data, isLoading, revalidate } = useCachedPromise(
    async () => {
      const types = await getClient().types.list();
      return types.slice().sort((a, b) => a.id.localeCompare(b.id));
    },
    [],
    {
      onError: async (err) => {
        await showFailureToast(err, { title: 'Failed to load types' });
      },
    },
  );

  // The same resolver every other list uses. Two tier maps disagreeing about
  // what a namespace looks like is one map too many, and this file held the
  // copy nobody saw.
  const registry = buildTypeRegistry(data);

  return (
    <List isLoading={isLoading} searchBarPlaceholder="Filter types by id or label...">
      {(data ?? []).map((schema) => {
        const tier = classifyNamespace(schema.id);
        const { icon, color } = registry.appearance(schema.id);
        const fieldCount = Object.keys(resolveSchemaFields(data, schema.id)).length;
        return (
          <List.Item
            key={schema.id}
            icon={{ source: icon, tintColor: color }}
            title={schema.id}
            subtitle={schema.label ?? undefined}
            keywords={[schema.id, schema.label ?? '', tier]}
            accessories={[
              { text: fieldCount === 1 ? '1 field' : `${String(fieldCount)} fields` },
              // Colored by tier, not by the type's own glyph color. The tag
              // says "core" and grouping is the whole of what it is for, so
              // taking the icon's color made three core rows read as three
              // different things and a user row read as a core one.
              { tag: { value: tier, color: TIER_APPEARANCE[tier].color } },
              ...(schema.version === undefined ? [] : [{ text: `v${String(schema.version)}` }]),
            ]}
            actions={
              <ActionPanel>
                <Action.Push
                  title="View Fields"
                  icon={Icon.Eye}
                  target={<TypeDetail schema={schema} schemas={data ?? []} />}
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

/**
 * A field's shape in the few characters a row can spare.
 *
 * Deliberately a subtitle rather than accessories. Raycast's own guidance is
 * not to carry accessories beside a detail pane, and the pane here already
 * renders the kind, the required flag and every enum value, so accessories
 * would repeat all three while squeezing the field name, which is the only
 * thing identifying the row.
 */
function fieldSubtitle(
  name: string,
  field: FieldDefinition,
  required: ReadonlySet<string>,
): string {
  const kind = field.items_type ? `${field.type} of ${field.items_type}` : field.type;
  return required.has(name) ? `${kind}, required` : kind;
}

function TypeDetail({ schema, schemas }: { schema: TypeSchema; schemas: TypeSchema[] }) {
  // Resolved through the ancestry, so a subtype shows what it inherits rather
  // than only what it re-declares.
  const fields = Object.entries(resolveSchemaFields(schemas, schema.id));
  const required = requiredFieldNames(schemas, schema.id);
  const rawJson = JSON.stringify(schema, null, 2);

  const copyActions = (
    <>
      <Action.CopyToClipboard
        title="Copy Type ID"
        content={schema.id}
        shortcut={Keyboard.Shortcut.Common.Pin}
      />
      <Action.CopyToClipboard
        title="Copy Schema JSON"
        content={rawJson}
        shortcut={Keyboard.Shortcut.Common.Copy}
      />
    </>
  );

  return (
    <List
      navigationTitle={schema.label ? `${schema.label} (${schema.id})` : schema.id}
      searchBarPlaceholder="Filter fields..."
      isShowingDetail
    >
      {fields.length === 0 && (
        <List.EmptyView
          icon={Icon.Document}
          title="No fields"
          description="This type declares no properties of its own or inherited."
          actions={<ActionPanel>{copyActions}</ActionPanel>}
        />
      )}
      {fields.map(([name, field]) => (
        <List.Item
          key={name}
          title={name}
          subtitle={fieldSubtitle(name, field, required)}
          keywords={[name, field.type, field.description ?? '']}
          detail={<List.Item.Detail markdown={fieldMarkdown(name, field, required.has(name))} />}
          actions={
            <ActionPanel>
              <Action.CopyToClipboard title="Copy Field Name" content={name} />
              {copyActions}
            </ActionPanel>
          }
        />
      ))}
    </List>
  );
}

function fieldMarkdown(name: string, field: FieldDefinition, isRequired: boolean): string {
  const lines = [`# ${name}`, ''];
  lines.push(`\`${field.type}\`${isRequired ? ', required' : ', optional'}`, '');
  if (field.description) lines.push(field.description, '');
  if (field.enum_values?.length) {
    lines.push('## One of', '', ...field.enum_values.map((value) => `- \`${value}\``), '');
  }
  if (field.items_type) lines.push(`Each entry is a \`${field.items_type}\`.`, '');
  if (field.format) lines.push(`Format: \`${field.format}\`.`, '');
  if (field.searchable === false) lines.push('Excluded from full-text search.', '');
  return lines.join('\n');
}

export default withMarfaAccessToken(TypeRegistryCommand);

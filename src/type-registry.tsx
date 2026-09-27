import { Action, ActionPanel, Icon, Keyboard, List } from '@raycast/api';
import { NAMESPACE_APPEARANCE, typeIcon } from './appearance';
import { FailureEmptyView } from './components/FailureEmptyView';
import type { Registry } from './display';
import type { TypeDefinition } from './marfa';
import type { FieldDefinition } from './schema-fields';
import { useRegistry } from './use-registry';

/**
 * Every type the server holds, and what each one declares, inherited fields
 * included, rendered as what the schema says rather than as its JSON.
 */
export default function TypeRegistry() {
  const { registry, isLoading, error, revalidate } = useRegistry();
  const types = [...registry.types].sort((a, b) => a.id.localeCompare(b.id));

  return (
    <List isLoading={isLoading} searchBarPlaceholder="Filter types by identifier or label">
      {error && types.length === 0 ? (
        <FailureEmptyView error={error} onRetry={revalidate} />
      ) : (
        types.map((type) => {
          const namespace = registry.namespace(type.id);
          const fieldCount = Object.keys(registry.fields(type.id)).length;
          return (
            <List.Item
              key={type.id}
              icon={typeIcon(registry, type.id)}
              title={type.id}
              subtitle={type.label}
              keywords={[type.label ?? '', namespace, ...(type.parent ? [type.parent] : [])]}
              accessories={[
                ...(type.parent ? [{ text: `from ${type.parent}`, tooltip: 'Inherits from' }] : []),
                { text: fieldCount === 1 ? '1 field' : `${String(fieldCount)} fields` },
                { tag: { value: namespace, color: NAMESPACE_APPEARANCE[namespace].color } },
                { text: `v${String(type.version)}` },
              ]}
              actions={
                <ActionPanel>
                  <Action.Push
                    title="View Fields"
                    icon={Icon.Eye}
                    target={<TypeDetail type={type} registry={registry} />}
                  />
                  <TypeCopyActions type={type} />
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
        })
      )}
    </List>
  );
}

function TypeCopyActions({ type }: { type: TypeDefinition }) {
  return (
    <>
      <Action.CopyToClipboard
        title="Copy Type ID"
        content={type.id}
        shortcut={Keyboard.Shortcut.Common.CopyName}
      />
      <Action.CopyToClipboard
        title="Copy Schema JSON"
        content={JSON.stringify(type, null, 2)}
        shortcut={Keyboard.Shortcut.Common.Copy}
      />
    </>
  );
}

function TypeDetail({ type, registry }: { type: TypeDefinition; registry: Registry }) {
  const fields = Object.entries(registry.fields(type.id));
  const own = new Set(Object.keys(type.fields ?? {}));
  const hints = type.display_hints ?? {};

  return (
    <List
      navigationTitle={type.label ? `${type.label} (${type.id})` : type.id}
      searchBarPlaceholder="Filter fields"
      isShowingDetail={fields.length > 0}
    >
      {fields.length === 0 && (
        <List.EmptyView
          icon={Icon.Document}
          title="No fields"
          description="This type declares no properties, and inherits none."
          actions={
            <ActionPanel>
              <TypeCopyActions type={type} />
            </ActionPanel>
          }
        />
      )}
      {fields.map(([name, field]) => (
        <List.Item
          key={name}
          title={name}
          subtitle={fieldSubtitle(field)}
          keywords={[field.type, field.description ?? '']}
          accessories={[
            ...(name === hints.title_field ? [{ tag: 'title' }] : []),
            ...(name === hints.body_field ? [{ tag: 'body' }] : []),
          ]}
          detail={<List.Item.Detail markdown={fieldMarkdown(name, field, own.has(name), type)} />}
          actions={
            <ActionPanel>
              <Action.CopyToClipboard title="Copy Field Name" content={name} />
              <TypeCopyActions type={type} />
            </ActionPanel>
          }
        />
      ))}
    </List>
  );
}

function fieldSubtitle(field: FieldDefinition): string {
  const kind = field.items_type ? `${field.type} of ${field.items_type}` : field.type;
  return field.required ? `${kind}, required` : kind;
}

function fieldMarkdown(
  name: string,
  field: FieldDefinition,
  declaredHere: boolean,
  type: TypeDefinition,
): string {
  const lines = [`# ${name}`, ''];
  lines.push(`\`${field.type}\`${field.required ? ', required' : ', optional'}`, '');
  if (!declaredHere && type.parent) lines.push(`Inherited through \`${type.parent}\`.`, '');
  if (field.description) lines.push(field.description, '');
  if (field.enum_values?.length) {
    lines.push('## One of', '', ...field.enum_values.map((value) => `- \`${value}\``), '');
  }
  if (field.items_type) lines.push(`Each entry is a \`${field.items_type}\`.`, '');
  if (field.format) lines.push(`Format: \`${field.format}\`.`, '');
  if (field.maxLength !== undefined)
    lines.push(`At most ${String(field.maxLength)} characters.`, '');
  if (field.maxItems !== undefined) lines.push(`At most ${String(field.maxItems)} entries.`, '');
  if (field.searchable === false) lines.push('Kept out of full-text search.', '');
  return lines.join('\n');
}

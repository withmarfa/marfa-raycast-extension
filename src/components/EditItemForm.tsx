import {
  Action,
  ActionPanel,
  Detail,
  Form,
  Icon,
  showToast,
  Toast,
  useNavigation,
} from '@raycast/api';
import { usePromise } from '@raycast/utils';
import { readFile } from 'node:fs/promises';
import { useState } from 'react';
import { captureFormModel } from '../capture-form';
import type { PlannedField } from '../capture-plan';
import {
  baselineProperties,
  buildCaptureProperties,
  type CaptureErrors,
  deviceTimeZone,
} from '../capture-values';
import type { Registry } from '../display';
import { controlValue, editedProperties } from '../edit-values';
import { conflictCurrent, refusedFields } from '../failure';
import { showFailure } from '../feedback';
import { getItem, type Item, updateItem } from '../marfa';
import { thumbnailFromBytes } from '../thumbnail';
import { FieldControl } from './CaptureForm';

type Value = Form.Value | undefined;

/**
 * Edits any type through the form its schema describes, against the version
 * the form loaded. The whole properties go with `replace`, the one way to
 * clear a field; the server still merges a stale edit field by field, so a
 * change made elsewhere to a field this form did not touch survives, and a
 * change made elsewhere to one it did is refused and shown beside this edit.
 *
 * A file's reference and anything the type does not declare are carried
 * through untouched.
 */
export function EditItemForm({
  id,
  registry,
  onSaved,
}: {
  id: string;
  registry: Registry;
  onSaved: () => void;
}) {
  const { pop } = useNavigation();
  const loaded = usePromise(async (itemId: string) => (await getItem(itemId)).item, [id], {
    onError: (error) => {
      void showFailure(error, 'Opening the item');
      pop();
    },
  });
  const [collision, setCollision] = useState<
    { fields: string[]; mine: Record<string, unknown>; theirs: Record<string, unknown> } | undefined
  >();

  if (collision) {
    return (
      <EditCollision
        {...collision}
        onReload={() => {
          setCollision(undefined);
          loaded.revalidate();
        }}
      />
    );
  }
  if (!loaded.data) return <Form isLoading navigationTitle="Edit" />;
  return (
    <LoadedForm
      key={`${loaded.data.id}:${String(loaded.data.version)}`}
      item={loaded.data}
      registry={registry}
      onSaved={() => {
        onSaved();
        pop();
      }}
      onCollision={setCollision}
    />
  );
}

function LoadedForm({
  item,
  registry,
  onSaved,
  onCollision,
}: {
  item: Item;
  registry: Registry;
  onSaved: () => void;
  onCollision: (collision: {
    fields: string[];
    mine: Record<string, unknown>;
    theirs: Record<string, unknown>;
  }) => void;
}) {
  const model = captureFormModel(registry, item.type);
  const fields = [...model.plan.primary, ...model.plan.secondary];
  const [start] = useState<Record<string, Value>>(() =>
    Object.fromEntries(
      fields.map((field) => [field.name, controlValue(field, item.properties[field.name])]),
    ),
  );
  const [values, setValues] = useState<Record<string, Value>>(start);
  const [errors, setErrors] = useState<CaptureErrors>({});
  const zone = deviceTimeZone();
  const declared = new Set(Object.keys(registry.fields(item.type)));
  const undeclared = Object.keys(item.properties).filter((name) => !declared.has(name));

  function set(name: string, value: Value) {
    setValues((current) => ({ ...current, [name]: value }));
    setErrors((current) => {
      if (!(name in current)) return current;
      const next = { ...current };
      delete next[name];
      return next;
    });
  }

  async function save() {
    const read: Record<string, unknown> = {};
    const found: CaptureErrors = {};
    for (const field of fields) {
      const value = values[field.name];
      if (field.kind !== 'thumbnail') {
        read[field.name] = value;
        continue;
      }
      const path = Array.isArray(value) && value[0] ? String(value[0]) : '';
      if (!path) continue;
      const bytes = await readFile(path).catch(() => undefined);
      const thumbnail = bytes
        ? thumbnailFromBytes(new Uint8Array(bytes))
        : { error: 'The file cannot be read' };
      if ('error' in thumbnail) found[field.name] = thumbnail.error;
      else read[field.name] = thumbnail.value;
    }
    const baseline = baselineProperties(fields, item.type, start);
    const built = buildCaptureProperties(
      { ...model.plan, primary: fields, secondary: [] },
      item.type,
      read,
      baseline.read,
    );
    if ('errors' in built || Object.keys(found).length > 0) {
      setErrors({ ...found, ...('errors' in built ? built.errors : {}) });
      return;
    }

    const { properties, changed } = editedProperties(
      fields,
      item.properties,
      built.properties,
      baseline,
    );
    if (changed.length === 0) {
      onSaved();
      return;
    }
    const toast = await showToast({ style: Toast.Style.Animated, title: 'Saving' });
    try {
      // Not settled: most types let the last writer win a collision, which would
      // overwrite the other side's change to the same field without a word.
      const saved = await updateItem({
        id: item.id,
        version: item.version,
        properties,
        mode: 'replace',
        settle: false,
      });
      if (saved.resolution?.conflicted_copy_id) {
        toast.style = Toast.Style.Failure;
        toast.title = 'Changed elsewhere meanwhile';
        toast.message = 'The other change stays; yours was saved beside it as a conflicted copy.';
      } else {
        toast.style = Toast.Style.Success;
        toast.title = 'Saved';
      }
      onSaved();
    } catch (error) {
      await toast.hide();
      const current = conflictCurrent(error);
      if (current) {
        onCollision({ fields: changed, mine: properties, theirs: current.properties });
        return;
      }
      const refused = refusedFields(error);
      if (refused) setErrors(refused);
      await showFailure(error, 'Saving');
    }
  }

  return (
    <Form
      navigationTitle={`Edit ${registry.label(item.type)}`}
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Save" icon={Icon.Check} onSubmit={save} />
        </ActionPanel>
      }
    >
      {fields.map((field: PlannedField) => (
        <FieldControl
          key={field.name}
          field={field}
          value={values[field.name]}
          error={errors[field.name]}
          isBody={field.name === model.bodyField}
          isNote={false}
          zone={zone}
          onChange={(value) => set(field.name, value)}
        />
      ))}
      {model.takesFile && (
        <Form.Description
          title="File"
          text="The stored file stays as it is; capture a new item to store another."
        />
      )}
      {undeclared.length > 0 && (
        <Form.Description
          title="Kept as they are"
          text={`${undeclared.join(', ')}: the type does not declare ${undeclared.length === 1 ? 'it' : 'them'}.`}
        />
      )}
    </Form>
  );
}

function show(value: unknown): string {
  if (value === undefined) return '_(not set)_';
  return typeof value === 'string' ? value : `\`${JSON.stringify(value)}\``;
}

/** An edit the server could not merge: each field the edit changed, as it is now beside as edited. */
function EditCollision({
  fields,
  mine,
  theirs,
  onReload,
}: {
  fields: string[];
  mine: Record<string, unknown>;
  theirs: Record<string, unknown>;
  onReload: () => void;
}) {
  const markdown = [
    '## Changed elsewhere',
    'Someone changed this item after you opened it, and the server could not merge your edit into theirs. Your edit was not saved.',
    ...fields.flatMap((field) => [
      `### ${field}`,
      `**Now on the server:** ${show(theirs[field])}`,
      `**Your edit:** ${show(mine[field])}`,
    ]),
  ].join('\n\n');
  return (
    <Detail
      navigationTitle="Changed Elsewhere"
      markdown={markdown}
      actions={
        <ActionPanel>
          <Action title="Edit the Current Version" icon={Icon.Pencil} onAction={onReload} />
          <Action.CopyToClipboard
            title="Copy Your Edit"
            content={JSON.stringify(
              Object.fromEntries(fields.map((field) => [field, mine[field]])),
              null,
              2,
            )}
          />
        </ActionPanel>
      }
    />
  );
}

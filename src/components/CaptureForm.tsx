import {
  Action,
  ActionPanel,
  Clipboard,
  Form,
  getPreferenceValues,
  Icon,
  popToRoot,
  showHUD,
  showToast,
  Toast,
} from '@raycast/api';
import { openAsBlob } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { useState, type ReactNode } from 'react';
import { captureFormModel, initialValue, ZONE_FIELDS } from '../capture-form';
import type { PlannedField } from '../capture-plan';
import {
  buildCaptureProperties,
  type CaptureErrors,
  deviceTimeZone,
  EXTRA_PROPERTIES_FIELD,
  FILE_FIELD,
  parseAdditionalProperties,
  RAW_JSON_FIELD,
  TAGS_FIELD,
} from '../capture-values';
import {
  captureFromFile,
  clipboardBody,
  clipboardSeed,
  type ClipboardSnapshot,
} from '../clipboard';
import { parseTags, type Registry } from '../display';
import { refusedFields } from '../failure';
import { showFailure } from '../feedback';
import { createItem, uploadBlob } from '../marfa';
import { thumbnailFromBytes } from '../thumbnail';

type Value = Form.Value | undefined;
type Values = Record<string, Value>;

const TYPE_FIELD = 'type';

/**
 * The capture form for any type, built from what the registry says the type
 * is. Every control is controlled, so switching type keeps what was typed
 * under the same field names, and Insert Clipboard can reach the body.
 */
export function CaptureForm(props: {
  registry: Registry;
  registryLoading: boolean;
  initialType: string;
  /** Whether the form keeps a draft when closed, and the draft it was reopened with. */
  enableDrafts?: boolean;
  draftValues?: Form.Values;
  /** The clipboard the form was opened from, to seed fields by what they are. */
  clipboard?: ClipboardSnapshot;
  navigationTitle?: string;
  /** Holds the form to its initial type, for a capture that only makes sense as one. */
  lockType?: boolean;
  /** Edges the new item draws, such as a reply's thread. */
  edges?: Record<string, string[]>;
  /** Called with the new item's label once saved; without it, a HUD closes Raycast. */
  onCaptured?: (label: string) => Promise<void>;
  submitTitle?: string;
}) {
  const { registry, registryLoading, clipboard } = props;
  const { defaultTags } = getPreferenceValues<Preferences>();
  const zone = deviceTimeZone();

  const [values, setValues] = useState<Values>(() => {
    if (props.draftValues) return { ...props.draftValues };
    return {
      [TYPE_FIELD]: props.initialType,
      [TAGS_FIELD]: defaultTags ?? '',
      [FILE_FIELD]: clipboard?.file ? [captureFromFile(clipboard.file).path] : [],
    };
  });
  const [errors, setErrors] = useState<CaptureErrors>({});
  const [showAll, setShowAll] = useState(false);

  const typeId = typeof values[TYPE_FIELD] === 'string' ? values[TYPE_FIELD] : props.initialType;
  const model = captureFormModel(registry, typeId);
  const { plan } = model;
  // A hidden field holding a value (from a draft, or typed before a type
  // switch) opens the section, so nothing is sent that is not on screen and
  // nothing typed is dropped.
  const hiddenWithValue = plan.secondary.some((field) => hasValue(values[field.name]));
  const expanded = showAll || hiddenWithValue;
  const rendered = [...plan.primary, ...(expanded ? plan.secondary : [])];

  // A field nobody has set yet reads its seed from the clipboard, then its
  // control's own starting value; typing replaces both.
  function valueOf(field: PlannedField): Value {
    if (field.name in values) return values[field.name];
    const seed = clipboard
      ? clipboardSeed(clipboard, field, {
          titleField: model.titleField,
          bodyField: model.bodyField,
          urlField: model.urlField,
        })
      : undefined;
    return seed ?? initialValue(field, typeId, zone);
  }

  function set(name: string, value: Value) {
    setValues((current) => ({ ...current, [name]: value }));
    setErrors((current) => {
      if (!(name in current)) return current;
      const next = { ...current };
      delete next[name];
      return next;
    });
  }

  const textOf = (name: string) =>
    typeof values[name] === 'string' ? (values[name] as string) : '';

  async function capture() {
    // A note needs no schema; anything else would be sent unchecked.
    if (!model.isNote && registryLoading && registry.types.length === 0) {
      await showToast({ style: Toast.Style.Failure, title: 'The type registry is still loading' });
      return;
    }

    const read: Values = {};
    const found: CaptureErrors = {};
    for (const field of rendered) {
      const value = valueOf(field);
      if (field.kind === 'thumbnail') {
        const path = Array.isArray(value) ? String(value[0] ?? '') : '';
        if (!path) continue;
        const bytes = await readFile(path).catch(() => undefined);
        const thumbnail = bytes
          ? thumbnailFromBytes(new Uint8Array(bytes))
          : { error: 'The file cannot be read' };
        if ('error' in thumbnail) found[field.name] = thumbnail.error;
        else read[field.name] = thumbnail.value;
        continue;
      }
      read[field.name] = value;
    }
    read[RAW_JSON_FIELD] = values[RAW_JSON_FIELD] ?? '{}';

    const built = buildCaptureProperties(
      { ...plan, primary: rendered, secondary: [] },
      typeId,
      read,
    );
    const failures: CaptureErrors = { ...found, ...('errors' in built ? built.errors : {}) };

    const extra = parseAdditionalProperties(textOf(EXTRA_PROPERTIES_FIELD), [
      ...Object.keys(registry.fields(typeId)),
      ...plan.shadowed,
    ]);
    if ('error' in extra) failures[EXTRA_PROPERTIES_FIELD] = extra.error;

    const picked = values[FILE_FIELD];
    const file =
      model.takesFile && Array.isArray(picked) && picked[0] ? String(picked[0]) : undefined;
    if (model.takesFile && !file)
      failures[FILE_FIELD] = 'Choose a file, or pick a type that holds none';
    if (file && !(await stat(file).catch(() => undefined))?.isFile()) {
      failures[FILE_FIELD] = 'Choose a file, not a folder';
    }

    if (Object.keys(failures).length > 0 || 'errors' in built || 'error' in extra) {
      setErrors(failures);
      if (plan.secondary.some((field) => field.name in failures)) setShowAll(true);
      return;
    }

    const label = registry.label(typeId);
    const toast = await showToast({
      style: Toast.Style.Animated,
      title: `Capturing the ${label.toLowerCase()}`,
    });
    try {
      const properties: Record<string, unknown> = { ...built.properties, ...extra.properties };
      if (file) {
        const { mimeType, title } = captureFromFile(file);
        const { hash } = await uploadBlob(await openAsBlob(file, { type: mimeType }));
        properties.blob_ref = hash;
        properties.mime_type = mimeType;
        if (model.titleField && properties[model.titleField] === undefined) {
          properties[model.titleField] = title;
        }
      }
      await createItem({
        type: typeId,
        properties,
        tags: parseTags(textOf(TAGS_FIELD)),
        edges: props.edges,
      });
      await toast.hide();
      if (props.onCaptured) {
        await props.onCaptured(label);
      } else {
        await showHUD(`${label} captured`);
        await popToRoot({ clearSearchBar: true });
      }
    } catch (error) {
      await toast.hide();
      const fields = refusedFields(error);
      const shown = new Set(rendered.map((field) => field.name));
      if (fields && Object.keys(fields).some((name) => shown.has(name))) {
        setErrors(Object.fromEntries(Object.entries(fields).filter(([name]) => shown.has(name))));
      }
      await showFailure(error, 'Capturing');
    }
  }

  const bodyTarget = rendered.find(
    (field) =>
      field.name === model.bodyField && (field.kind === 'textarea' || field.kind === 'text'),
  );

  async function insertClipboard() {
    if (!bodyTarget) return;
    const content = await Clipboard.read();
    const text = clipboardBody({ text: content.text ?? '', html: content.html ?? '' });
    if (!text) {
      await showToast({ style: Toast.Style.Failure, title: 'No text on the clipboard' });
      return;
    }
    const current = valueOf(bodyTarget);
    const before = typeof current === 'string' ? current.trimEnd() : '';
    set(bodyTarget.name, before ? `${before}\n\n${text}` : text);
  }

  const options = registry.filterable();
  const known = options.some((type) => type.id === typeId);

  return (
    <Form
      enableDrafts={props.enableDrafts}
      isLoading={registryLoading}
      navigationTitle={props.navigationTitle}
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title={props.submitTitle ?? `Capture ${registry.label(typeId)}`}
            icon={Icon.Plus}
            onSubmit={capture}
          />
          {bodyTarget && (
            <Action
              title="Insert Clipboard Text"
              icon={Icon.Clipboard}
              shortcut={{ modifiers: ['cmd', 'shift'], key: 'v' }}
              onAction={insertClipboard}
            />
          )}
          {/* Expands only: a collapsed section's controls would stop counting, and what was typed there with them. */}
          {plan.secondary.length > 0 && !expanded && (
            <Action
              title={`Show ${String(plan.secondary.length)} More Fields`}
              icon={Icon.Sidebar}
              shortcut={{ modifiers: ['cmd', 'shift'], key: 'a' }}
              onAction={() => setShowAll(true)}
            />
          )}
        </ActionPanel>
      }
    >
      {props.lockType ? (
        <Form.Description title="Type" text={registry.label(typeId)} />
      ) : (
        <Form.Dropdown
          id={TYPE_FIELD}
          title="Type"
          value={typeId}
          info={registry.type(typeId)?.description}
          onChange={(value) => {
            set(TYPE_FIELD, value);
            setErrors({});
            setShowAll(false);
          }}
        >
          {options.map((type) => (
            <Form.Dropdown.Item key={type.id} value={type.id} title={registry.label(type.id)} />
          ))}
          {!known && (
            <Form.Dropdown.Item
              value={typeId}
              title={registryLoading ? registry.label(typeId) : `${typeId} (not on this server)`}
            />
          )}
        </Form.Dropdown>
      )}
      <Form.Separator />

      {model.takesFile && (
        <Form.FilePicker
          id={FILE_FIELD}
          title="File"
          allowMultipleSelection={false}
          canChooseDirectories={false}
          value={strings(values[FILE_FIELD])}
          error={errors[FILE_FIELD]}
          onChange={(value) => set(FILE_FIELD, value)}
        />
      )}
      {!plan.known && !registryLoading && !model.isNote && (
        <Form.TextArea
          id={RAW_JSON_FIELD}
          title="Properties"
          info="This server has no schema for the type, so the properties go as the JSON object written here."
          value={textOf(RAW_JSON_FIELD) || '{}'}
          error={errors[RAW_JSON_FIELD]}
          onChange={(value) => set(RAW_JSON_FIELD, value)}
        />
      )}
      {plan.shadowed.length > 0 && (
        <Form.Description
          title="Not settable"
          text={`${plan.shadowed.join(', ')} cannot be set here: each is named like an item field or one of this form's own.`}
        />
      )}

      {rendered.map((field) => (
        <FieldControl
          key={`${typeId}:${field.name}`}
          field={field}
          value={valueOf(field)}
          error={errors[field.name]}
          isBody={field.name === model.bodyField}
          isNote={model.isNote}
          zone={zone}
          onChange={(value) => set(field.name, value)}
        />
      ))}

      <Form.Separator />
      <Form.TextField
        id={TAGS_FIELD}
        title="Tags"
        placeholder="reading, later"
        info="Comma-separated"
        value={textOf(TAGS_FIELD)}
        onChange={(value) => set(TAGS_FIELD, value)}
      />
      {!model.isNote && (
        <Form.TextArea
          id={EXTRA_PROPERTIES_FIELD}
          title="Additional Properties"
          placeholder={'mood: tired\nproject: marfa'}
          info="What the type does not declare, one per line as key: value. Lines starting with # are skipped."
          value={textOf(EXTRA_PROPERTIES_FIELD)}
          error={errors[EXTRA_PROPERTIES_FIELD]}
          onChange={(value) => set(EXTRA_PROPERTIES_FIELD, value)}
        />
      )}
    </Form>
  );
}

/** Every IANA zone the runtime knows, the device's first: the list is searchable. */
function zoneOptions(device: string): string[] {
  const all =
    typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];
  return [device, ...all.filter((zone) => zone !== device)];
}

/** A draft hands a date back as a string; one that does not parse is dropped rather than guessed. */
function reviveDate(value: Value): Date | null {
  if (value instanceof Date) return value;
  if (typeof value !== 'string' || !value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function hasValue(value: Value): boolean {
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'string') return value.trim() !== '';
  return value instanceof Date || value === true;
}

function strings(value: Value): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}

function joinInfo(description: string | undefined, addition: string): string {
  return description ? `${description}\n\n${addition}` : addition;
}

export function FieldControl(props: {
  field: PlannedField;
  value: Value;
  error?: string;
  isBody: boolean;
  isNote: boolean;
  zone: string;
  onChange: (value: Value) => void;
}): ReactNode {
  const { field, value, error, onChange } = props;
  const text = typeof value === 'string' ? value : '';
  const shared = { id: field.name, title: field.title, info: field.info, error };

  if (ZONE_FIELDS.has(field.name) && field.rawType === 'string') {
    const isEnd = field.name === 'end_timezone';
    return (
      <Form.Dropdown {...shared} value={text} onChange={onChange}>
        <Form.Dropdown.Item value="" title={isEnd ? 'Same as start' : 'Not set'} />
        {zoneOptions(props.zone).map((zone) => (
          <Form.Dropdown.Item key={zone} value={zone} title={zone} />
        ))}
      </Form.Dropdown>
    );
  }

  switch (field.kind) {
    case 'textarea':
      return (
        <Form.TextArea
          {...shared}
          title={props.isNote && props.isBody ? 'Note' : field.title}
          placeholder={props.isNote && props.isBody ? 'The first line names the note' : undefined}
          enableMarkdown={props.isBody}
          value={text}
          onChange={onChange}
        />
      );
    case 'checkbox':
      return (
        <Form.Checkbox {...shared} label={field.title} value={value === true} onChange={onChange} />
      );
    case 'dropdown':
      return (
        <Form.Dropdown {...shared} value={text} onChange={onChange}>
          {!field.required && <Form.Dropdown.Item value="" title="Not set" />}
          {(field.enumValues ?? []).map((option) => (
            <Form.Dropdown.Item key={option} value={option} title={option} />
          ))}
        </Form.Dropdown>
      );
    case 'tagpicker':
      return (
        <Form.TagPicker {...shared} value={strings(value)} onChange={onChange}>
          {(field.enumValues ?? []).map((option) => (
            <Form.TagPicker.Item key={option} value={option} title={option} />
          ))}
        </Form.TagPicker>
      );
    case 'datetime':
    case 'date':
      return (
        <Form.DatePicker
          {...shared}
          type={field.kind === 'date' ? Form.DatePicker.Type.Date : Form.DatePicker.Type.DateTime}
          value={reviveDate(value)}
          onChange={onChange}
        />
      );
    case 'list':
      return (
        <Form.TextArea
          {...shared}
          placeholder="One per line"
          info={joinInfo(field.info, `One ${field.itemsType ?? 'value'} per line.`)}
          value={Array.isArray(value) ? value.map(String).join('\n') : text}
          onChange={onChange}
        />
      );
    case 'json':
      return (
        <Form.TextArea
          {...shared}
          placeholder="{ }"
          info={joinInfo(field.info, `JSON, because this field holds a ${field.rawType}.`)}
          value={text}
          onChange={onChange}
        />
      );
    case 'thumbnail':
      return (
        <Form.FilePicker
          {...shared}
          info={joinInfo(field.info, 'A PNG, JPEG or WebP image of at most 16 KB.')}
          allowMultipleSelection={false}
          canChooseDirectories={false}
          value={strings(value)}
          onChange={onChange}
        />
      );
    default:
      return <Form.TextField {...shared} value={text} onChange={onChange} />;
  }
}

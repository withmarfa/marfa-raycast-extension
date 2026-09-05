import { Form } from '@raycast/api';
import { Fragment } from 'react';
import type { ReactNode } from 'react';
import type { PlannedField } from '../capture-plan';
import type { CaptureErrors } from '../capture-values';
import { EXTRA_PROPERTIES_FIELD, RAW_JSON_FIELD } from '../capture-values';
import { deviceTimeZone } from '../capture-utils';

/**
 * The controls a plan describes.
 *
 * A `.map` over the plan, which is the property that matters: every field gets
 * its error from the same loop that renders it, so an error about a field the
 * renderer has no case for cannot exist. The shape this replaces demuxed a
 * closed union of seven field names by hand, and a failure outside that union
 * fell through a bare `return` where the form did nothing at all.
 */

export interface FieldRenderOptions {
  fields: PlannedField[];
  errors: CaptureErrors;
  /** Cleared as soon as the person edits the field it is about. */
  onEdit: (name: string) => void;
  /** Initial values, by field name. */
  seeds: Record<string, Form.Value | undefined>;
}

/**
 * Every IANA zone the runtime knows, the device's first.
 *
 * The one control the schema cannot describe. `timezone` is declared as a
 * string, and a text box for it means typing `Europe/London` exactly; Raycast
 * dropdowns are searchable, so the full list is more usable than any shortlist,
 * and a shortlist is the kind of hardcoded guess this whole change removes.
 */
function timeZoneOptions(): string[] {
  const device = deviceTimeZone();
  const all =
    typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];
  return [device, ...all.filter((zone) => zone !== device)];
}

/** Fields whose control is substituted, keyed by type and name. Two entries,
 *  both for a zone, both because a searchable list beats a text box for a value
 *  that must match an identifier exactly. */
const ZONE_FIELDS = new Set(['timezone', 'end_timezone']);

export function PlannedFields({ fields, errors, onEdit, seeds }: FieldRenderOptions): ReactNode {
  return (
    <>
      {fields.map((field) => (
        <Fragment key={field.name}>
          {renderField(field, errors[field.name], () => onEdit(field.name), seeds[field.name])}
        </Fragment>
      ))}
    </>
  );
}

function renderField(
  field: PlannedField,
  error: string | undefined,
  onChange: () => void,
  seed: Form.Value | undefined,
): ReactNode {
  const shared = {
    id: field.name,
    title: field.title,
    info: field.info,
    error,
  };

  if (ZONE_FIELDS.has(field.name) && field.rawType === 'string') {
    const zones = timeZoneOptions();
    const isEnd = field.name === 'end_timezone';
    return (
      <Form.Dropdown
        {...shared}
        defaultValue={typeof seed === 'string' ? seed : isEnd ? '' : zones[0]}
        onChange={onChange}
      >
        {/* The sentinel is the schema's own default stated as a choice: an
            absent end zone means the zone it started in. */}
        {isEnd && <Form.Dropdown.Item value="" title="Same as start" />}
        {zones.map((zone) => (
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
          defaultValue={typeof seed === 'string' ? seed : undefined}
          onChange={onChange}
        />
      );

    case 'checkbox':
      return (
        <Form.Checkbox
          {...shared}
          label={field.title}
          defaultValue={seed === true}
          onChange={onChange}
        />
      );

    case 'dropdown':
      return (
        <Form.Dropdown
          {...shared}
          defaultValue={typeof seed === 'string' ? seed : field.required ? undefined : ''}
          onChange={onChange}
        >
          {/* An optional enum needs a way to say nothing, or the first value is
              submitted by a person who never chose it. */}
          {!field.required && <Form.Dropdown.Item value="" title="Not set" />}
          {(field.enumValues ?? []).map((value) => (
            <Form.Dropdown.Item key={value} value={value} title={value} />
          ))}
        </Form.Dropdown>
      );

    case 'tagpicker':
      return (
        <Form.TagPicker
          {...shared}
          defaultValue={Array.isArray(seed) ? (seed as string[]) : undefined}
          onChange={onChange}
        >
          {(field.enumValues ?? []).map((value) => (
            <Form.TagPicker.Item key={value} value={value} title={value} />
          ))}
        </Form.TagPicker>
      );

    case 'datetime':
    case 'date':
      return (
        <Form.DatePicker
          {...shared}
          type={field.kind === 'date' ? Form.DatePicker.Type.Date : Form.DatePicker.Type.DateTime}
          defaultValue={reviveDate(seed)}
          onChange={onChange}
        />
      );

    case 'list':
      return (
        <Form.TextArea
          {...shared}
          placeholder={'one per line'}
          info={joinInfo(field.info, `One ${field.itemsType ?? 'value'} per line.`)}
          defaultValue={Array.isArray(seed) ? seed.map(String).join('\n') : undefined}
          onChange={onChange}
        />
      );

    case 'json':
      return (
        <Form.TextArea
          {...shared}
          placeholder={'{ }'}
          info={joinInfo(field.info, `JSON, because this field holds a ${field.rawType}.`)}
          defaultValue={typeof seed === 'string' ? seed : undefined}
          onChange={onChange}
        />
      );

    default:
      return (
        <Form.TextField
          {...shared}
          defaultValue={typeof seed === 'string' ? seed : undefined}
          onChange={onChange}
        />
      );
  }
}

/**
 * A draft stores what it stored, and Raycast hands a date back as a string.
 *
 * `Form.DatePicker` takes a `Date`, so a revived draft would otherwise pass a
 * string into a control typed for a date. Discarded rather than coerced when it
 * does not parse, because a wrong date is worse than an empty one.
 */
function reviveDate(seed: Form.Value | undefined): Date | undefined {
  if (seed instanceof Date) return seed;
  if (typeof seed !== 'string' || !seed) return undefined;
  const value = new Date(seed);
  return Number.isNaN(value.getTime()) ? undefined : value;
}

function joinInfo(description: string | undefined, addition: string): string {
  return description ? `${description}\n\n${addition}` : addition;
}

/**
 * Free-form `key: value` lines, appended to any capture.
 *
 * Kept because a schema describes what a type declares and a person capturing
 * sometimes knows something it does not. Parsed by
 * `capture-utils.parseAdditionalProperties`, which coerces booleans and numbers
 * and refuses a key that shadows a first-class Item field.
 */
export function AdditionalPropertiesField(props: {
  error?: string;
  defaultValue?: string;
  onChange?: () => void;
}): ReactNode {
  return (
    <Form.TextArea
      id={EXTRA_PROPERTIES_FIELD}
      title="Additional properties"
      placeholder={'mood: tired\nproject: marfa\n# one per line, key: value'}
      info="One per line, key: value. Skips lines starting with # and refuses collisions with first-class fields."
      error={props.error}
      defaultValue={props.defaultValue}
      onChange={props.onChange}
    />
  );
}

/**
 * The whole payload as JSON, for a type this server has no schema for.
 *
 * Not the default for anything any more, which is the change. It used to be
 * what two thirds of a registry got.
 */
export function RawPropertiesField(props: { error?: string; onChange?: () => void }): ReactNode {
  return (
    <Form.TextArea
      id={RAW_JSON_FIELD}
      title="Properties"
      placeholder='{"title":"Example"}'
      info="This server has no schema for the selected type, so it will validate whatever is sent."
      error={props.error}
      defaultValue="{}"
      onChange={props.onChange}
    />
  );
}

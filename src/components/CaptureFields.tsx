import { Form } from '@raycast/api';
import type { ReactNode } from 'react';
import { deviceTimeZone } from '../capture-utils';

/**
 * Every IANA zone the runtime knows, device zone first so the common case
 * is the top entry. Raycast dropdowns are searchable, so the full list is
 * more usable than a hand-picked shortlist would be — and a shortlist is
 * exactly the kind of hardcoded guess this extension is getting rid of.
 */
function timeZoneOptions(): string[] {
  const device = deviceTimeZone();
  const all =
    typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];
  return [device, ...all.filter((zone) => zone !== device)];
}

/**
 * Field IDs (`title`, `body`, `url`, etc.) match the `FormValues` shape
 * consumed by the host form's submit handler.
 */
export interface CaptureFieldOptions {
  type: string;
  timeZoneError?: string;
  endsAtError?: string;
  onEventTimingChange?: () => void;
  defaultTitle?: string;
  defaultBody?: string;
  defaultUrl?: string;
  defaultDescription?: string;
  urlError?: string;
  titleError?: string;
  bodyError?: string;
  onUrlChange?: () => void;
  onTitleChange?: () => void;
  onBodyChange?: () => void;
}

export interface CustomPropertiesFieldOptions {
  schemaText: string;
  propertiesError?: string;
  defaultPropertiesJson?: string;
  onPropertiesChange?: () => void;
}

export function CaptureFields(props: CaptureFieldOptions): ReactNode {
  const {
    type,
    timeZoneError,
    endsAtError,
    onEventTimingChange,
    defaultTitle,
    defaultBody,
    defaultUrl,
    defaultDescription,
    urlError,
    titleError,
    bodyError,
    onUrlChange,
    onTitleChange,
    onBodyChange,
  } = props;

  switch (type) {
    case 'core.note':
      return (
        <>
          <Form.TextField
            id="title"
            title="Title"
            placeholder="Note title"
            defaultValue={defaultTitle}
            onChange={onTitleChange}
          />
          <Form.TextArea
            id="body"
            title="Body"
            placeholder="Write your note..."
            defaultValue={defaultBody}
            error={bodyError}
            onChange={onBodyChange}
          />
        </>
      );
    case 'core.bookmark':
      return (
        <>
          <Form.TextField
            id="url"
            title="URL"
            placeholder="https://..."
            defaultValue={defaultUrl}
            error={urlError}
            onChange={onUrlChange}
          />
          <Form.TextField
            id="title"
            title="Title"
            placeholder="Bookmark title"
            defaultValue={defaultTitle}
            onChange={onTitleChange}
          />
          <Form.TextArea
            id="description"
            title="Description"
            placeholder="Optional description"
            defaultValue={defaultDescription}
          />
        </>
      );
    case 'core.task':
      return (
        <>
          <Form.TextField
            id="title"
            title="Title"
            placeholder="Task title"
            defaultValue={defaultTitle}
            error={titleError}
            onChange={onTitleChange}
          />
          <Form.TextArea
            id="description"
            title="Description"
            placeholder="Optional description"
            defaultValue={defaultDescription}
          />
          <Form.DatePicker id="due_at" title="Due Date" />
          <Form.Dropdown id="priority" title="Priority" defaultValue="medium">
            <Form.Dropdown.Item title="Low" value="low" />
            <Form.Dropdown.Item title="Medium" value="medium" />
            <Form.Dropdown.Item title="High" value="high" />
            <Form.Dropdown.Item title="Urgent" value="urgent" />
          </Form.Dropdown>
        </>
      );
    case 'core.event': {
      const zones = timeZoneOptions();
      return (
        <>
          <Form.TextField
            id="title"
            title="Title"
            placeholder="Event title"
            defaultValue={defaultTitle}
            error={titleError}
            onChange={onTitleChange}
          />
          <Form.DatePicker id="starts_at" title="Starts" />
          <Form.DatePicker
            id="ends_at"
            title="Ends"
            error={endsAtError}
            onChange={onEventTimingChange}
          />
          <Form.Checkbox id="all_day" label="All day" defaultValue={false} />
          <Form.Dropdown
            id="timezone"
            title="Time zone"
            defaultValue={zones[0]}
            error={timeZoneError}
            onChange={onEventTimingChange}
            info="The event keeps this zone wherever it is read from, so a booking in another city holds that city's hour."
          >
            {zones.map((zone) => (
              <Form.Dropdown.Item key={zone} value={zone} title={zone} />
            ))}
          </Form.Dropdown>
          <Form.Dropdown
            id="end_timezone"
            title="Ends in"
            defaultValue=""
            info="Only for something that ends somewhere else, like a flight."
          >
            <Form.Dropdown.Item value="" title="Same as start" />
            {zones.map((zone) => (
              <Form.Dropdown.Item key={zone} value={zone} title={zone} />
            ))}
          </Form.Dropdown>
          <Form.TextField id="place" title="Place" placeholder="Location" />
        </>
      );
    }
    default:
      return null;
  }
}

export function CustomPropertiesFields(props: CustomPropertiesFieldOptions): ReactNode {
  return (
    <>
      <Form.Description title="Schema" text={props.schemaText} />
      <Form.TextArea
        id="propertiesJson"
        title="Properties"
        placeholder='{"title":"Example"}'
        defaultValue={props.defaultPropertiesJson ?? '{}'}
        error={props.propertiesError}
        onChange={props.onPropertiesChange}
      />
    </>
  );
}

export interface AdditionalPropertiesFieldOptions {
  error?: string;
  defaultValue?: string;
  onChange?: () => void;
}

/**
 * Free-form `key: value` block appended to every core-type capture. One
 * property per line, `#` comments allowed. Parser lives in
 * `capture-utils.parseAdditionalProperties` — coerces booleans / numbers
 * and rejects shadow keys.
 */
export function AdditionalPropertiesField(props: AdditionalPropertiesFieldOptions): ReactNode {
  return (
    <Form.TextArea
      id="extraProperties"
      title="Additional properties"
      placeholder={'mood: tired\nproject: marfa\n# one per line, key: value'}
      info="One per line, key: value. Skips lines starting with # and rejects collisions with first-class fields."
      error={props.error}
      defaultValue={props.defaultValue}
      onChange={props.onChange}
    />
  );
}

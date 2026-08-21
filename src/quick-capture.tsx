import {
  Action,
  ActionPanel,
  Form,
  getPreferenceValues,
  Icon,
  showHUD,
  useNavigation,
} from '@raycast/api';
import type { LaunchProps } from '@raycast/api';
import { showFailureToast } from '@raycast/utils';
import { useState } from 'react';
import type { CreateItemInput } from '@withmarfa/sdk';
import { withMarfaAccessToken } from './auth/with-marfa-access-token';
import { getClient } from './client';
import {
  buildCoreCaptureProperties,
  fetchCaptureLocation,
  isCoreCaptureType,
  mergeTags,
  normalizeTypeId,
  parseAdditionalProperties,
  parseCustomPropertiesJson,
  validateCoreCapture,
} from './capture-utils';
import {
  AdditionalPropertiesField,
  CaptureFields,
  CustomPropertiesFields,
} from './components/CaptureFields';
import { buildCaptureTypeOptions, findSchema, schemaSummary } from './type-options';
import { useTypeRegistry } from './use-type-registry';

interface CapturePreferences {
  defaultTier?: 'library' | 'feed';
  defaultCaptureType?: string;
  defaultTags?: string;
  captureLocation?: boolean;
}

interface FormValues {
  type: string;
  title: string;
  body: string;
  url: string;
  description: string;
  due_at: Date | null;
  starts_at: Date | null;
  priority: string;
  place: string;
  tags: string;
  propertiesJson: string;
  extraProperties: string;
}

function QuickCaptureCommand({ draftValues }: LaunchProps<{ draftValues: FormValues }>) {
  const prefs = getPreferenceValues<CapturePreferences>();
  const defaultType = normalizeTypeId(prefs.defaultCaptureType);
  const defaultTier = prefs.defaultTier ?? 'library';

  const [type, setType] = useState(draftValues?.type ?? defaultType);
  const [urlError, setUrlError] = useState<string | undefined>();
  const [titleError, setTitleError] = useState<string | undefined>();
  const [bodyError, setBodyError] = useState<string | undefined>();
  const [propertiesError, setPropertiesError] = useState<string | undefined>();
  const [extraError, setExtraError] = useState<string | undefined>();
  const { pop } = useNavigation();

  const { registry, schemas: typeSchemas, isLoading: typesLoading } = useTypeRegistry();

  async function handleSubmit(values: FormValues) {
    let properties: Record<string, unknown>;
    if (isCoreCaptureType(type)) {
      const validation = validateCoreCapture(type, values);
      if (validation) {
        if (validation.field === 'url') setUrlError(validation.message);
        if (validation.field === 'title') setTitleError(validation.message);
        if (validation.field === 'body') setBodyError(validation.message);
        return;
      }
      properties = buildCoreCaptureProperties(type, values);
      const extra = parseAdditionalProperties(values.extraProperties);
      if ('error' in extra) {
        setExtraError(extra.error.message);
        return;
      }
      Object.assign(properties, extra.properties);
    } else {
      const schema = findSchema(typeSchemas, type);
      if (typeSchemas && !schema) {
        setPropertiesError(`Type ${type} is not registered on this server`);
        return;
      }
      const parsed = parseCustomPropertiesJson(values.propertiesJson, schema);
      if ('error' in parsed) {
        setPropertiesError(parsed.error.message);
        return;
      }
      properties = parsed.properties;
    }

    const tags = mergeTags(prefs.defaultTags, values.tags);

    try {
      const client = getClient();
      const payload: CreateItemInput = { type, properties, tags, tier: defaultTier };
      if (prefs.captureLocation) {
        const loc = await fetchCaptureLocation();
        if (loc) {
          payload.capture_latitude = loc.lat;
          payload.capture_longitude = loc.lon;
        }
      }
      await client.items.create(payload);
      await showHUD('Item captured');
      pop();
    } catch (error) {
      await showFailureToast(error, { title: 'Failed to capture' });
    }
  }

  return (
    <Form
      // Capture is the interaction drafts exist to protect: a half-typed
      // note dismissed by accident comes back on the next launch.
      enableDrafts
      isLoading={typesLoading}
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Capture" icon={Icon.Plus} onSubmit={handleSubmit} />
        </ActionPanel>
      }
    >
      <Form.Dropdown
        id="type"
        title="Type"
        value={type}
        onChange={(value) => {
          setType(value);
          setUrlError(undefined);
          setTitleError(undefined);
          setBodyError(undefined);
          setPropertiesError(undefined);
          setExtraError(undefined);
        }}
      >
        {buildCaptureTypeOptions(registry, type).map((t) => (
          <Form.Dropdown.Item key={t.value} value={t.value} title={t.label} />
        ))}
      </Form.Dropdown>

      <Form.Separator />

      {isCoreCaptureType(type) ? (
        <>
          <CaptureFields
            type={type}
            defaultTitle={draftValues?.title}
            defaultBody={draftValues?.body}
            defaultUrl={draftValues?.url}
            defaultDescription={draftValues?.description}
            urlError={urlError}
            titleError={titleError}
            bodyError={bodyError}
            onUrlChange={() => setUrlError(undefined)}
            onTitleChange={() => setTitleError(undefined)}
            onBodyChange={() => setBodyError(undefined)}
          />
          <AdditionalPropertiesField
            error={extraError}
            defaultValue={draftValues?.extraProperties}
            onChange={() => setExtraError(undefined)}
          />
        </>
      ) : (
        <CustomPropertiesFields
          schemaText={schemaSummary(findSchema(typeSchemas, type), type)}
          propertiesError={propertiesError}
          defaultPropertiesJson={draftValues?.propertiesJson}
          onPropertiesChange={() => setPropertiesError(undefined)}
        />
      )}

      <Form.Separator />
      <Form.TextField
        id="tags"
        title="Tags"
        placeholder="tag1, tag2 (comma-separated)"
        defaultValue={draftValues?.tags}
      />
    </Form>
  );
}

export default withMarfaAccessToken(QuickCaptureCommand);

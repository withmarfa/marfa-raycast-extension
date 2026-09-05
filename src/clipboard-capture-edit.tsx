import {
  Action,
  ActionPanel,
  Form,
  getPreferenceValues,
  Icon,
  showHUD,
  useNavigation,
} from '@raycast/api';
import { showFailureToast, useCachedPromise } from '@raycast/utils';
import { useState } from 'react';
import type { CreateItemInput } from '@withmarfa/sdk';
import { withMarfaAccessToken } from './auth/with-marfa-access-token';
import { getClient } from './client';
import { planCaptureForm } from './capture-plan';
import { BLOB_SUPPLIED_FIELDS, uploadBlob, wantsBlob } from './capture-blob';
import {
  buildCaptureProperties,
  EXTRA_PROPERTIES_FIELD,
  FILE_FIELD,
  FORM_FIELD_PREFIX,
  RAW_JSON_FIELD,
  TAGS_FIELD,
  alwaysShownFields,
  type CaptureErrors,
} from './capture-values';
import {
  fetchCaptureLocation,
  mergeTags,
  normalizeTypeId,
  parseAdditionalProperties,
} from './capture-utils';
import {
  carriedProperties,
  clipboardSeed,
  isUrl,
  readClipboardSnapshot,
  type ClipboardSnapshot,
} from './clipboard-source';
import {
  AdditionalPropertiesField,
  PlannedFields,
  RawPropertiesField,
} from './components/CaptureForm';
import { resolveSchemaFields } from './schema-fields';
import { buildCaptureTypeOptions } from './type-options';
import { toTitleCase } from './helpers';
import { useTypeRegistry } from './use-type-registry';

/**
 * Clipboard Capture (Edit): pre-fills a capture form from the clipboard and
 * lets a person shape it before it lands. The no-view command handles the
 * "I trust the default" case.
 *
 * The form is the same generated one Quick Capture uses. This command differs
 * only in where the initial values come from, and in offering a file picker
 * when the chosen type says it holds a file.
 */

interface CapturePreferences {
  defaultTier?: 'library' | 'feed';
  defaultCaptureType?: string;
  defaultTags?: string;
  captureLocation?: boolean;
}

function inferDefaultType(snapshot: ClipboardSnapshot, preferred?: string): string {
  // A file on the clipboard beats the preference, because it is a stronger
  // statement about what is being captured than a default is.
  if (snapshot.file) return 'core.file';
  if (snapshot.text && isUrl(snapshot.text)) return 'core.bookmark';
  return normalizeTypeId(preferred);
}

function ClipboardCaptureEditCommand() {
  const { pop } = useNavigation();
  const prefs = getPreferenceValues<CapturePreferences>();

  const { data: snapshot, isLoading: snapshotLoading } = useCachedPromise(
    readClipboardSnapshot,
    [],
    {
      onError: async (err) => {
        await showFailureToast(err, { title: 'Failed to read clipboard' });
      },
    },
  );
  const { registry, schemas, isLoading: typesLoading } = useTypeRegistry();

  const [chosenType, setChosenType] = useState<string | null>(null);
  const [errors, setErrors] = useState<CaptureErrors>({});
  const [showAll, setShowAll] = useState(false);

  const isLoading = snapshotLoading || typesLoading;
  const type = chosenType ?? (snapshot ? inferDefaultType(snapshot, prefs.defaultCaptureType) : '');

  const titleField = registry.titleField(type);
  const bodyField = registry.bodyField(type);
  const fields = resolveSchemaFields(schemas, type);
  const takesFile = wantsBlob(Object.keys(fields));
  const plan = planCaptureForm(schemas, type, {
    titleField,
    bodyField,
    toTitle: toTitleCase,
    alwaysShow: alwaysShownFields(type),
    reservedByForm: (name) => name.startsWith(FORM_FIELD_PREFIX),
  });

  // A blob supplies these, so a text box for either is a control nobody can
  // satisfy by hand.
  const visible = (list: typeof plan.primary) =>
    takesFile ? list.filter((field) => !BLOB_SUPPLIED_FIELDS.includes(field.name)) : list;

  const clearError = (name: string) => {
    setErrors((current) => {
      if (!(name in current)) return current;
      const next = { ...current };
      delete next[name];
      return next;
    });
  };

  async function handleSubmit(values: Form.Values) {
    if (isLoading) {
      await showFailureToast(new Error('The clipboard and type registry are still loading'), {
        title: 'Not ready',
      });
      return;
    }

    const built = buildCaptureProperties(
      { ...plan, primary: visible(plan.primary), secondary: visible(plan.secondary) },
      type,
      values,
    );
    if ('errors' in built) {
      setErrors(built.errors);
      if (plan.secondary.some((field) => field.name in built.errors)) setShowAll(true);
      return;
    }

    const extra = parseAdditionalProperties(
      typeof values[EXTRA_PROPERTIES_FIELD] === 'string' ? values[EXTRA_PROPERTIES_FIELD] : '',
    );
    if ('error' in extra) {
      setErrors({ [EXTRA_PROPERTIES_FIELD]: extra.error.message });
      return;
    }

    const picked = values[FILE_FIELD];
    const filePath = Array.isArray(picked) && typeof picked[0] === 'string' ? picked[0] : null;
    if (takesFile && !filePath) {
      setErrors({ [FILE_FIELD]: 'Choose a file, or pick a type that does not hold one' });
      return;
    }

    try {
      const client = getClient();
      const blob = filePath ? await uploadBlob(client, filePath) : {};
      const payload: CreateItemInput = {
        type,
        properties: {
          ...(snapshot ? carriedProperties(snapshot) : {}),
          ...built.properties,
          ...blob,
          ...extra.properties,
        },
        tags: mergeTags(
          prefs.defaultTags,
          typeof values[TAGS_FIELD] === 'string' ? values[TAGS_FIELD] : '',
        ),
        tier: prefs.defaultTier ?? 'library',
      };
      if (prefs.captureLocation) {
        const location = await fetchCaptureLocation();
        if (location) {
          payload.capture_latitude = location.lat;
          payload.capture_longitude = location.lon;
        }
      }
      await client.items.create(payload);
      await showHUD('Item captured');
      pop();
    } catch (error) {
      await showFailureToast(error, { title: 'Failed to capture' });
    }
  }

  const seeds: Record<string, Form.Value | undefined> = {};
  if (snapshot) {
    for (const field of [...plan.primary, ...plan.secondary]) {
      const seed = clipboardSeed(snapshot, field, { titleField, bodyField });
      if (seed !== undefined) seeds[field.name] = seed;
    }
  }

  const typeOptions = buildCaptureTypeOptions(registry, type);

  // Nothing is rendered until both reads land. `useCachedPromise` hands back
  // the previous launch's clipboard first, and a Form item takes its default
  // value once per lifecycle and never again, so the fields would mount seeded
  // from whatever was copied last time and keep that text after the real read
  // resolved.
  if (isLoading) return <Form isLoading />;

  return (
    <Form
      isLoading={isLoading}
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Capture" icon={Icon.Plus} onSubmit={handleSubmit} />
          {/* Expands only. Collapsing would unmount the extra items, and an
              unmounted control contributes no value to the submission, so a
              person who opened the section, filled it in and closed it again
              would silently lose everything they typed there. */}
          {plan.secondary.length > 0 && !showAll && (
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
      <Form.Dropdown
        id="type"
        title="Type"
        value={type}
        info={registry.schema(type)?.description}
        onChange={(value) => {
          setChosenType(value);
          setErrors({});
          setShowAll(false);
        }}
      >
        {typeOptions.map((option) => (
          <Form.Dropdown.Item key={option.value} value={option.value} title={option.label} />
        ))}
      </Form.Dropdown>

      <Form.Separator />

      {takesFile && (
        <Form.FilePicker
          id={FILE_FIELD}
          title="File"
          allowMultipleSelection={false}
          error={errors[FILE_FIELD]}
          defaultValue={snapshot?.file ? [snapshot.file] : undefined}
          onChange={() => clearError(FILE_FIELD)}
        />
      )}
      {!plan.known && !isLoading && (
        <RawPropertiesField
          error={errors[RAW_JSON_FIELD]}
          onChange={() => clearError(RAW_JSON_FIELD)}
        />
      )}
      {plan.shadowed.length > 0 && (
        <Form.Description
          title="Not settable"
          text={`${plan.shadowed.join(', ')} name first-class item fields and cannot be set as properties.`}
        />
      )}

      <PlannedFields
        fields={visible(plan.primary)}
        errors={errors}
        onEdit={clearError}
        seeds={seeds}
      />
      {showAll && (
        <PlannedFields
          fields={visible(plan.secondary)}
          errors={errors}
          onEdit={clearError}
          seeds={seeds}
        />
      )}

      <Form.Separator />
      <Form.TextField id={TAGS_FIELD} title="Tags" placeholder="tag1, tag2 (comma-separated)" />
      <AdditionalPropertiesField
        error={errors[EXTRA_PROPERTIES_FIELD]}
        onChange={() => clearError(EXTRA_PROPERTIES_FIELD)}
      />
    </Form>
  );
}

export default withMarfaAccessToken(ClipboardCaptureEditCommand);

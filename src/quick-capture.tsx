import { Action, ActionPanel, Form, getPreferenceValues, Icon, showHUD } from '@raycast/api';
import type { LaunchProps } from '@raycast/api';
import { showFailureToast } from '@raycast/utils';
import { useState } from 'react';
import type { CreateItemInput } from '@withmarfa/sdk';
import { withMarfaAccessToken } from './auth/with-marfa-access-token';
import { getClient } from './client';
import { planCaptureForm } from './capture-plan';
import {
  buildCaptureProperties,
  EXTRA_PROPERTIES_FIELD,
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
  AdditionalPropertiesField,
  PlannedFields,
  RawPropertiesField,
} from './components/CaptureForm';
import { buildCaptureTypeOptions } from './type-options';
import { toTitleCase } from './helpers';
import { useTypeRegistry } from './use-type-registry';

interface CapturePreferences {
  defaultTier?: 'library' | 'feed';
  defaultCaptureType?: string;
  defaultTags?: string;
  captureLocation?: boolean;
}

/**
 * Quick Capture, with its form derived from the type the person chose.
 *
 * Four types used to have hand-written fields and everything else got a
 * textarea expecting JSON, which on an ordinary registry is two thirds of it.
 * The schema says what each field is, so the form is built from that.
 */
function QuickCaptureCommand({ draftValues }: LaunchProps<{ draftValues: Form.Values }>) {
  const prefs = getPreferenceValues<CapturePreferences>();
  const [type, setType] = useState(
    typeof draftValues?.type === 'string' && draftValues.type
      ? draftValues.type
      : normalizeTypeId(prefs.defaultCaptureType),
  );
  const [errors, setErrors] = useState<CaptureErrors>({});
  const [showAll, setShowAll] = useState(false);

  const { registry, schemas, isLoading } = useTypeRegistry();
  const plan = planCaptureForm(schemas, type, {
    titleField: registry.titleField(type),
    bodyField: registry.bodyField(type),
    toTitle: toTitleCase,
    alwaysShow: alwaysShownFields(type),
    reservedByForm: (name) => name.startsWith(FORM_FIELD_PREFIX),
  });

  const clearError = (name: string) => {
    setErrors((current) => {
      if (!(name in current)) return current;
      const next = { ...current };
      delete next[name];
      return next;
    });
  };

  async function handleSubmit(values: Form.Values) {
    // An unarrived registry looks exactly like a type this server does not
    // have, and the second of those submits whatever JSON is in the box with
    // no required-field checks. Submitting before the schemas land would
    // therefore create an item with no properties at all.
    if (isLoading) {
      await showFailureToast(new Error('The type registry has not loaded yet'), {
        title: 'Not ready',
      });
      return;
    }

    const built = buildCaptureProperties(plan, type, values);
    if ('errors' in built) {
      setErrors(built.errors);
      // A field behind the toggle cannot show its own error, so the toggle
      // opens rather than leaving a form that refuses with nothing marked.
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

    try {
      const payload: CreateItemInput = {
        type,
        properties: { ...built.properties, ...extra.properties },
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
      await getClient().items.create(payload);
      await showHUD('Item captured');
    } catch (error) {
      await showFailureToast(error, { title: 'Failed to capture' });
    }
  }

  const seeds: Record<string, Form.Value | undefined> = draftValues ?? {};

  return (
    <Form
      // Capture is the interaction drafts exist to protect: a half-typed note
      // dismissed by accident comes back on the next launch.
      enableDrafts
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
          setType(value);
          setErrors({});
          setShowAll(false);
        }}
      >
        {buildCaptureTypeOptions(registry, type).map((option) => (
          <Form.Dropdown.Item key={option.value} value={option.value} title={option.label} />
        ))}
      </Form.Dropdown>

      <Form.Separator />

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

      <PlannedFields fields={plan.primary} errors={errors} onEdit={clearError} seeds={seeds} />
      {showAll && (
        <PlannedFields fields={plan.secondary} errors={errors} onEdit={clearError} seeds={seeds} />
      )}

      <Form.Separator />
      <Form.TextField
        id={TAGS_FIELD}
        title="Tags"
        placeholder="tag1, tag2 (comma-separated)"
        defaultValue={typeof draftValues?.tags === 'string' ? draftValues.tags : undefined}
      />
      <AdditionalPropertiesField
        error={errors[EXTRA_PROPERTIES_FIELD]}
        defaultValue={
          typeof draftValues?.[EXTRA_PROPERTIES_FIELD] === 'string'
            ? draftValues[EXTRA_PROPERTIES_FIELD]
            : undefined
        }
        onChange={() => clearError(EXTRA_PROPERTIES_FIELD)}
      />
    </Form>
  );
}

export default withMarfaAccessToken(QuickCaptureCommand);

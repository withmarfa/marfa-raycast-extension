import {
  Action,
  ActionPanel,
  Detail,
  Form,
  Icon,
  popToRoot,
  showToast,
  Toast,
  useNavigation,
} from '@raycast/api';
import { useState } from 'react';
import { showFailure } from '../feedback';
import {
  changedKeyFields,
  formatMap,
  keyRefusal,
  type KeyReach,
  type MapField,
  MAPS,
  parseMap,
  parseSources,
  type Permission,
  PERMISSIONS,
  type PresetId,
  presetReach,
  PRESETS,
} from '../keys';
import { type ApiKey, createKey, type KeyBody, type Tier, updateKey } from '../marfa';

type Errors = Partial<Record<string, string>>;
const CUSTOM = 'custom';

/** A reach in the words the form uses, for showing what a preset will hold before it is minted. */
function describeReach(reach: KeyReach): string {
  const parts = MAPS.flatMap((map) => {
    const lines = formatMap(reach[map.field]);
    return lines ? [`${map.title}: ${lines.split('\n').join(', ')}`] : [];
  });
  const permissions = reach.permissions ?? [];
  parts.push(`Permissions: ${permissions.length > 0 ? permissions.join(', ') : 'none'}`);
  return parts.join('\n');
}

/** The five maps, the permissions and the claimed sources, read from the form, or what is wrong. */
function readReach(values: Form.Values): { reach: KeyReach } | { errors: Errors } {
  const errors: Errors = {};
  const reach: KeyReach = {};
  for (const map of MAPS) {
    const parsed = parseMap(String(values[map.field] ?? ''), map.levels);
    if ('error' in parsed) errors[map.field] = parsed.error;
    else reach[map.field] = parsed.map;
  }
  const sources = parseSources(String(values.sources ?? ''));
  if ('error' in sources) errors.sources = sources.error;
  else reach.sources = sources.sources;
  reach.permissions = (Array.isArray(values.permissions) ? values.permissions : []) as Permission[];
  return Object.keys(errors).length > 0 ? { errors } : { reach };
}

function ReachFields({
  start,
  errors,
  onEdit,
}: {
  start: KeyReach;
  errors: Errors;
  onEdit: (field: string) => void;
}) {
  return (
    <>
      <Form.Separator />
      <Form.TagPicker
        id="permissions"
        title="Permissions"
        defaultValue={start.permissions ?? []}
        error={errors.permissions}
        onChange={() => onEdit('permissions')}
      >
        {PERMISSIONS.map((permission) => (
          <Form.TagPicker.Item
            key={permission.name}
            value={permission.name}
            title={`${permission.name}: ${permission.says}`}
          />
        ))}
      </Form.TagPicker>
      {MAPS.map((map) => (
        <Form.TextArea
          key={map.field}
          id={map.field}
          title={map.title}
          placeholder={map.example}
          info={`One pattern=level a line, such as ${map.example} or *=${map.levels[1] ?? 'read'}. The level is ${map.levels.join(', ')}.`}
          defaultValue={formatMap(start[map.field as MapField])}
          error={errors[map.field]}
          onChange={() => onEdit(map.field)}
        />
      ))}
      <Form.TextField
        id="sources"
        title="Also Writes As"
        placeholder="another-source"
        info="Comma-separated sources a write by this key may name besides its own. This key can grant only its own source and those it claims."
        defaultValue={(start.sources ?? []).join(', ')}
        error={errors.sources}
        onChange={() => onEdit('sources')}
      />
    </>
  );
}

function TierField({ value }: { value?: Tier }) {
  return (
    <Form.Dropdown id="default_tier" title="Default Tier" defaultValue={value ?? 'library'}>
      <Form.Dropdown.Item value="library" title="Library" />
      <Form.Dropdown.Item value="feed" title="Feed" />
    </Form.Dropdown>
  );
}

/**
 * Mints a key from a preset or a custom reach. The presets are read from the
 * key doing the minting, since a key cannot give more than it holds.
 */
export function CreateKeyForm({ creator, onCreated }: { creator: ApiKey; onCreated: () => void }) {
  const { push } = useNavigation();
  const [preset, setPreset] = useState<string>('content-write');
  const [errors, setErrors] = useState<Errors>({});
  const clear = (field: string) => setErrors((current) => ({ ...current, [field]: undefined }));
  const custom = preset === CUSTOM;
  // The operator key holds nothing to copy, so a key copying it would hold nothing either.
  const presets = PRESETS.filter((option) => !(creator.is_operator && option.id === 'everything'));
  const chosen = presets.find((option) => option.id === preset);

  async function create(values: Form.Values) {
    const label = String(values.label ?? '').trim();
    const source = String(values.source ?? '').trim();
    const found: Errors = {};
    if (!label) found.label = 'Name the key';
    if (!source) found.source = 'Give the key its own source';
    else if (/^(oauth|connector):/.test(source))
      found.source = 'That prefix is reserved to the server';
    let reach: KeyReach;
    if (custom) {
      const read = readReach(values);
      if ('errors' in read) Object.assign(found, read.errors);
      reach = 'reach' in read ? read.reach : {};
    } else {
      reach = presetReach(preset as PresetId, creator);
    }
    if (Object.values(found).some(Boolean)) {
      setErrors(found);
      return;
    }

    const toast = await showToast({ style: Toast.Style.Animated, title: 'Minting' });
    try {
      const created = await createKey({
        label,
        source,
        default_tier: values.default_tier === 'feed' ? 'feed' : 'library',
        ...(reach as Partial<KeyBody>),
      });
      await toast.hide();
      onCreated();
      push(<KeyCreated label={created.label} secret={created.key} />);
    } catch (error) {
      await toast.hide();
      const refusal = keyRefusal(error);
      if (refusal?.field) setErrors({ [refusal.field]: refusal.message });
      await showFailure(error, 'Minting the key');
    }
  }

  return (
    <Form
      navigationTitle="Create Key"
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Create Key" icon={Icon.Plus} onSubmit={create} />
        </ActionPanel>
      }
    >
      <Form.TextField
        id="label"
        title="Label"
        placeholder="Raycast on the laptop"
        error={errors.label}
        onChange={() => clear('label')}
      />
      <Form.TextField
        id="source"
        title="Source"
        placeholder="raycast-laptop"
        info="What everything this key writes is stamped with. Each key's source is its own, and it cannot change later."
        error={errors.source}
        onChange={() => clear('source')}
      />
      <TierField />
      <Form.Dropdown id="preset" title="Reach" value={preset} onChange={setPreset}>
        {presets.map((option) => (
          <Form.Dropdown.Item key={option.id} value={option.id} title={option.title} />
        ))}
        <Form.Dropdown.Item value={CUSTOM} title="Custom" />
      </Form.Dropdown>
      {chosen && (
        <Form.Description
          title="Holds"
          text={
            chosen.id === 'everything'
              ? `${chosen.says}\n\n${describeReach({ ...creator, sources: undefined } as KeyReach)}`
              : `${chosen.says}\n\n${describeReach(presetReach(chosen.id, creator))}`
          }
        />
      )}
      {custom && (
        <ReachFields start={presetReach('content-write', creator)} errors={errors} onEdit={clear} />
      )}
    </Form>
  );
}

/** The new key, shown this once: the server keeps only its hash. */
function KeyCreated({ label, secret }: { label: string; secret: string }) {
  return (
    <Detail
      navigationTitle="Key Created"
      markdown={[
        `# ${label}`,
        'Copy the key now. The server keeps only its hash, so it is never shown again.',
        '```',
        secret,
        '```',
      ].join('\n\n')}
      actions={
        <ActionPanel>
          <Action.CopyToClipboard title="Copy Key" content={secret} concealed />
          <Action title="Done" icon={Icon.Check} onAction={() => void popToRoot()} />
        </ActionPanel>
      }
    />
  );
}

/** Changes a key's label, tier and reach in place. Its source is fixed for good. */
export function EditKeyForm({ apiKey, onSaved }: { apiKey: ApiKey; onSaved: () => void }) {
  const { pop } = useNavigation();
  const [errors, setErrors] = useState<Errors>({});
  const clear = (field: string) => setErrors((current) => ({ ...current, [field]: undefined }));

  async function save(values: Form.Values) {
    const label = String(values.label ?? '').trim();
    const read = readReach(values);
    if (!label || 'errors' in read) {
      setErrors({
        ...('errors' in read ? read.errors : {}),
        ...(label ? {} : { label: 'Name the key' }),
      });
      return;
    }
    const changes = changedKeyFields(apiKey, {
      ...read.reach,
      label,
      default_tier: values.default_tier === 'feed' ? 'feed' : 'library',
    });
    if (Object.keys(changes).length === 0) {
      pop();
      return;
    }
    const toast = await showToast({ style: Toast.Style.Animated, title: 'Saving' });
    try {
      await updateKey(apiKey.id, changes as Partial<KeyBody>);
      toast.style = Toast.Style.Success;
      toast.title = 'Saved';
      onSaved();
      pop();
    } catch (error) {
      await toast.hide();
      const refusal = keyRefusal(error);
      if (refusal?.field) setErrors({ [refusal.field]: refusal.message });
      await showFailure(error, 'Saving the key');
    }
  }

  return (
    <Form
      navigationTitle={`Edit ${apiKey.label}`}
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Save" icon={Icon.Check} onSubmit={save} />
        </ActionPanel>
      }
    >
      <Form.TextField
        id="label"
        title="Label"
        defaultValue={apiKey.label}
        error={errors.label}
        onChange={() => clear('label')}
      />
      <Form.Description title="Source" text={`${apiKey.source}, fixed for good`} />
      <TierField value={apiKey.default_tier} />
      <ReachFields start={apiKey as KeyReach} errors={errors} onEdit={clear} />
    </Form>
  );
}

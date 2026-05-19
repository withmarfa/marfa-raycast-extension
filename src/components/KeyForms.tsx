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
import { showFailureToast } from '@raycast/utils';
import { useState } from 'react';
import type { ApiKey, UpdateKeyInput } from '@mymehq/sdk';
import { ForbiddenError, MymeError } from '@mymehq/sdk';
import { getClient } from '../client';

/**
 * Permission shapes:
 *   type_permissions      → Record<pattern, 'read' | 'write' | 'none'>
 *   extension_permissions → Record<namespace, 'read' | 'write'>
 *   edge_permissions      → Record<edge_type, 'read' | 'write'>
 *   metadata_permissions  → Record<sub_resource, 'read' | 'write'>
 */

type TypeMap = Record<string, 'read' | 'write' | 'none'>;
type RwMap = Record<string, 'read' | 'write'>;
type KeyRole = 'admin' | 'workspace_admin' | 'member';

interface PermissionBundle {
  type_permissions: TypeMap;
  extension_permissions: RwMap;
  edge_permissions: RwMap;
  metadata_permissions: RwMap;
}

interface CreatePreset {
  id: string;
  label: string;
  role: KeyRole;
  default_tier: 'library' | 'feed';
  permissions: PermissionBundle;
}

const CREATE_PRESETS: CreatePreset[] = [
  {
    id: 'full-admin',
    label: 'Full admin (write everything)',
    role: 'admin',
    default_tier: 'library',
    permissions: {
      type_permissions: { '*': 'write' },
      extension_permissions: { '*': 'write' },
      edge_permissions: { '*': 'write' },
      metadata_permissions: { types: 'write' },
    },
  },
  {
    id: 'workspace-admin',
    label: 'Workspace admin',
    role: 'workspace_admin',
    default_tier: 'library',
    permissions: {
      type_permissions: { '*': 'write' },
      extension_permissions: { '*': 'write' },
      edge_permissions: { '*': 'write' },
      metadata_permissions: { types: 'write' },
    },
  },
  {
    id: 'read-only-browser',
    label: 'Read-only browser',
    role: 'member',
    default_tier: 'library',
    permissions: {
      type_permissions: { '*': 'read' },
      extension_permissions: { '*': 'read' },
      edge_permissions: { '*': 'read' },
      metadata_permissions: { types: 'read' },
    },
  },
  {
    id: 'capture',
    label: 'Capture client',
    role: 'member',
    default_tier: 'library',
    permissions: {
      type_permissions: {
        'core.note': 'write',
        'core.bookmark': 'write',
        'core.task': 'write',
        'core.event': 'write',
        'core.file': 'write',
        'core.highlight': 'write',
        '*': 'read',
      },
      extension_permissions: {},
      edge_permissions: { 'in-thread': 'write', references: 'write', '*': 'read' },
      metadata_permissions: {},
    },
  },
  {
    id: 'custom-type-author',
    label: 'Custom type author',
    role: 'member',
    default_tier: 'library',
    permissions: {
      type_permissions: { '*': 'read' },
      extension_permissions: {},
      edge_permissions: { '*': 'read' },
      metadata_permissions: { types: 'write' },
    },
  },
];

const CUSTOM_PRESET_ID = 'custom';

interface QuickSetOption<T extends string> {
  id: string;
  label: string;
  value: Record<string, T> | null; // null means "Custom — see raw JSON below"
}

const TYPE_QUICKSETS: QuickSetOption<'read' | 'write' | 'none'>[] = [
  { id: 'all-write', label: 'Full access (write everything)', value: { '*': 'write' } },
  { id: 'all-read', label: 'Read everything', value: { '*': 'read' } },
  {
    id: 'capture',
    label: 'Notes & bookmarks (write), others read',
    value: { 'core.note': 'write', 'core.bookmark': 'write', '*': 'read' },
  },
  { id: 'none', label: 'No access', value: {} },
  { id: 'custom', label: 'Custom (edit JSON)', value: null },
];

const RW_QUICKSETS: QuickSetOption<'read' | 'write'>[] = [
  { id: 'all-write', label: 'Full access (write everything)', value: { '*': 'write' } },
  { id: 'all-read', label: 'Read everything', value: { '*': 'read' } },
  { id: 'none', label: 'No access', value: {} },
  { id: 'custom', label: 'Custom (edit JSON)', value: null },
];

const METADATA_QUICKSETS: QuickSetOption<'read' | 'write'>[] = [
  { id: 'types-write', label: 'Type registry author', value: { types: 'write' } },
  { id: 'types-read', label: 'Read type registry', value: { types: 'read' } },
  { id: 'none', label: 'No access', value: {} },
  { id: 'custom', label: 'Custom (edit JSON)', value: null },
];

/** Pretty-print a permission map for the raw editor. */
function stringifyMap(map: Record<string, string>): string {
  return JSON.stringify(map, null, 2);
}

interface ParseSuccess<T> {
  value: T;
}
interface ParseFailure {
  error: string;
}

function parseTypeMap(input: string): ParseSuccess<TypeMap> | ParseFailure {
  return parseMap<'read' | 'write' | 'none'>(input, 'Type permissions', ['read', 'write', 'none']);
}

function parseRwMap(input: string): ParseSuccess<RwMap> | ParseFailure {
  return parseMap<'read' | 'write'>(input, 'Permissions', ['read', 'write']);
}

function parseMap<T extends string>(
  input: string,
  fieldLabel: string,
  allowed: readonly T[],
): ParseSuccess<Record<string, T>> | ParseFailure {
  const trimmed = input.trim();
  if (!trimmed) return { value: {} };
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return { error: `${fieldLabel}: not valid JSON` };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { error: `${fieldLabel}: must be a JSON object` };
  }
  const result: Record<string, T> = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof value !== 'string' || !allowed.includes(value as T)) {
      return {
        error: `${fieldLabel}: "${key}" must be one of ${allowed.map((a) => `"${a}"`).join(', ')}`,
      };
    }
    result[key] = value as T;
  }
  return { value: result };
}

export function PlaintextKeyView({ apiKey }: { apiKey: ApiKey & { key: string } }) {
  const { pop } = useNavigation();
  const markdown = `> Copy this key now — it cannot be retrieved again.

\`\`\`
${apiKey.key}
\`\`\`

**Key ID:** \`${apiKey.id}\`

**Label:** ${apiKey.label}

**Source:** ${apiKey.source}

**Role:** ${apiKey.role}`;

  return (
    <Detail
      markdown={markdown}
      navigationTitle="New API Key"
      actions={
        <ActionPanel>
          <Action.CopyToClipboard
            title="Copy Key"
            content={apiKey.key}
            shortcut={{ modifiers: ['cmd'], key: 'c' }}
          />
          <Action title="Done" icon={Icon.Check} onAction={pop} />
          <Action.CopyToClipboard title="Copy Key ID" content={apiKey.id} />
        </ActionPanel>
      }
    />
  );
}

interface CreateValues {
  preset: string;
  label: string;
  source: string;
  role: string;
  default_tier: string;
  type_quickset: string;
  type_custom_json: string;
  ext_quickset: string;
  ext_custom_json: string;
  edge_quickset: string;
  edge_custom_json: string;
  metadata_quickset: string;
  metadata_custom_json: string;
}

export function CreateKeyForm({ onCreated }: { onCreated: () => void }) {
  const { push } = useNavigation();
  const [presetId, setPresetId] = useState(CREATE_PRESETS[0].id);
  const [typeQuickset, setTypeQuickset] = useState(TYPE_QUICKSETS[0].id);
  const [extQuickset, setExtQuickset] = useState(RW_QUICKSETS[0].id);
  const [edgeQuickset, setEdgeQuickset] = useState(RW_QUICKSETS[0].id);
  const [metadataQuickset, setMetadataQuickset] = useState(METADATA_QUICKSETS[0].id);

  const [labelError, setLabelError] = useState<string | undefined>();
  const [sourceError, setSourceError] = useState<string | undefined>();
  const [typeError, setTypeError] = useState<string | undefined>();
  const [extError, setExtError] = useState<string | undefined>();
  const [edgeError, setEdgeError] = useState<string | undefined>();
  const [metadataError, setMetadataError] = useState<string | undefined>();

  const usingPreset = presetId !== CUSTOM_PRESET_ID;
  const activePreset = CREATE_PRESETS.find((p) => p.id === presetId);

  async function handleSubmit(values: CreateValues) {
    let invalid = false;
    if (!values.label?.trim()) {
      setLabelError('Label is required');
      invalid = true;
    }
    if (!values.source?.trim()) {
      setSourceError('Source is required');
      invalid = true;
    }

    // Resolve permissions. Top-level preset wins; Custom drops to per-map quicksets.
    let permissions: PermissionBundle;
    if (activePreset) {
      permissions = activePreset.permissions;
    } else {
      const typeOpt = TYPE_QUICKSETS.find((q) => q.id === values.type_quickset);
      const extOpt = RW_QUICKSETS.find((q) => q.id === values.ext_quickset);
      const edgeOpt = RW_QUICKSETS.find((q) => q.id === values.edge_quickset);
      const metadataOpt = METADATA_QUICKSETS.find((q) => q.id === values.metadata_quickset);

      let typeMap: TypeMap = {};
      if (typeOpt?.value) {
        typeMap = typeOpt.value;
      } else {
        const parsed = parseTypeMap(values.type_custom_json);
        if ('error' in parsed) {
          setTypeError(parsed.error);
          invalid = true;
        } else {
          typeMap = parsed.value;
        }
      }

      let extMap: RwMap = {};
      if (extOpt?.value) {
        extMap = extOpt.value;
      } else {
        const parsed = parseRwMap(values.ext_custom_json);
        if ('error' in parsed) {
          setExtError(parsed.error);
          invalid = true;
        } else {
          extMap = parsed.value;
        }
      }

      let edgeMap: RwMap = {};
      if (edgeOpt?.value) {
        edgeMap = edgeOpt.value;
      } else {
        const parsed = parseRwMap(values.edge_custom_json);
        if ('error' in parsed) {
          setEdgeError(parsed.error);
          invalid = true;
        } else {
          edgeMap = parsed.value;
        }
      }
      let metadataMap: RwMap = {};
      if (metadataOpt?.value) {
        metadataMap = metadataOpt.value;
      } else {
        const parsed = parseRwMap(values.metadata_custom_json);
        if ('error' in parsed) {
          setMetadataError(parsed.error);
          invalid = true;
        } else {
          metadataMap = parsed.value;
        }
      }
      permissions = {
        type_permissions: typeMap,
        extension_permissions: extMap,
        edge_permissions: edgeMap,
        metadata_permissions: metadataMap,
      };
    }
    if (invalid) return;

    const role = (activePreset?.role ?? (values.role as KeyRole)) as KeyRole;
    const defaultTier = (activePreset?.default_tier ??
      (values.default_tier as 'library' | 'feed')) as 'library' | 'feed';

    try {
      const client = await getClient();
      const created = await client.keys.create({
        label: values.label.trim(),
        source: values.source.trim(),
        role,
        default_tier: defaultTier,
        type_permissions: permissions.type_permissions,
        extension_permissions: permissions.extension_permissions,
        edge_permissions: permissions.edge_permissions,
        metadata_permissions: permissions.metadata_permissions,
      });
      onCreated();
      push(<PlaintextKeyView apiKey={created} />);
    } catch (error) {
      if (error instanceof MymeError && error.status === 409) {
        setSourceError(error.message);
      } else if (error instanceof ForbiddenError) {
        await showFailureToast(error, { title: 'Admin credentials required' });
      } else {
        await showFailureToast(error, { title: 'Failed to create key' });
      }
    }
  }

  return (
    <Form
      navigationTitle="Create API Key"
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Create Key" icon={Icon.Plus} onSubmit={handleSubmit} />
        </ActionPanel>
      }
    >
      <Form.Dropdown
        id="preset"
        title="Preset"
        value={presetId}
        onChange={setPresetId}
        info="Pick a preset for the common cases, or Custom to set permissions per map."
      >
        {CREATE_PRESETS.map((p) => (
          <Form.Dropdown.Item key={p.id} value={p.id} title={p.label} />
        ))}
        <Form.Dropdown.Item value={CUSTOM_PRESET_ID} title="Custom" />
      </Form.Dropdown>

      <Form.Separator />

      <Form.TextField
        id="label"
        title="Label"
        placeholder="What this key is for"
        error={labelError}
        onChange={() => setLabelError(undefined)}
      />
      <Form.TextField
        id="source"
        title="Source"
        placeholder="Display name stamped on items written by this key"
        error={sourceError}
        onChange={() => setSourceError(undefined)}
      />

      {!usingPreset && (
        <>
          <Form.Dropdown id="role" title="Role" defaultValue="member">
            <Form.Dropdown.Item value="member" title="Member" />
            <Form.Dropdown.Item value="workspace_admin" title="Workspace Admin" />
            <Form.Dropdown.Item value="admin" title="Admin" />
          </Form.Dropdown>
          <Form.Dropdown id="default_tier" title="Default Tier" defaultValue="library">
            <Form.Dropdown.Item value="library" title="Library" />
            <Form.Dropdown.Item value="feed" title="Feed" />
          </Form.Dropdown>
          <Form.Separator />
          <Form.Description text="Type permissions" />
          <Form.Dropdown
            id="type_quickset"
            title="Quick set"
            value={typeQuickset}
            onChange={(v) => {
              setTypeQuickset(v);
              setTypeError(undefined);
            }}
          >
            {TYPE_QUICKSETS.map((q) => (
              <Form.Dropdown.Item key={q.id} value={q.id} title={q.label} />
            ))}
          </Form.Dropdown>
          {typeQuickset === 'custom' && (
            <Form.TextArea
              id="type_custom_json"
              title="JSON"
              placeholder='{"core.note":"write","*":"read"}'
              info='JSON object mapping type pattern to "read" | "write" | "none". Supports "*" and "parent.*" wildcards.'
              error={typeError}
              onChange={() => setTypeError(undefined)}
            />
          )}

          <Form.Separator />
          <Form.Description text="Extension permissions" />
          <Form.Dropdown
            id="ext_quickset"
            title="Quick set"
            value={extQuickset}
            onChange={(v) => {
              setExtQuickset(v);
              setExtError(undefined);
            }}
          >
            {RW_QUICKSETS.map((q) => (
              <Form.Dropdown.Item key={q.id} value={q.id} title={q.label} />
            ))}
          </Form.Dropdown>
          {extQuickset === 'custom' && (
            <Form.TextArea
              id="ext_custom_json"
              title="JSON"
              placeholder='{"raycast.myme":"write"}'
              info='JSON object mapping extension namespace to "read" | "write".'
              error={extError}
              onChange={() => setExtError(undefined)}
            />
          )}

          <Form.Separator />
          <Form.Description text="Edge permissions" />
          <Form.Dropdown
            id="edge_quickset"
            title="Quick set"
            value={edgeQuickset}
            onChange={(v) => {
              setEdgeQuickset(v);
              setEdgeError(undefined);
            }}
          >
            {RW_QUICKSETS.map((q) => (
              <Form.Dropdown.Item key={q.id} value={q.id} title={q.label} />
            ))}
          </Form.Dropdown>
          {edgeQuickset === 'custom' && (
            <Form.TextArea
              id="edge_custom_json"
              title="JSON"
              placeholder='{"in-thread":"write","*":"read"}'
              info='JSON object mapping edge type to "read" | "write". Supports "*" wildcard.'
              error={edgeError}
              onChange={() => setEdgeError(undefined)}
            />
          )}

          <Form.Separator />
          <Form.Description text="Metadata permissions" />
          <Form.Dropdown
            id="metadata_quickset"
            title="Quick set"
            value={metadataQuickset}
            onChange={(v) => {
              setMetadataQuickset(v);
              setMetadataError(undefined);
            }}
          >
            {METADATA_QUICKSETS.map((q) => (
              <Form.Dropdown.Item key={q.id} value={q.id} title={q.label} />
            ))}
          </Form.Dropdown>
          {metadataQuickset === 'custom' && (
            <Form.TextArea
              id="metadata_custom_json"
              title="JSON"
              placeholder='{"types":"write"}'
              info='JSON object mapping metadata sub-resource to "read" | "write". Today "types" controls custom type registration.'
              error={metadataError}
              onChange={() => setMetadataError(undefined)}
            />
          )}
        </>
      )}

      {usingPreset && activePreset && (
        <Form.Description
          title="Permissions"
          text={`Role: ${activePreset.role} · Default tier: ${activePreset.default_tier} · Types: ${stringifyMap(activePreset.permissions.type_permissions)} · Extensions: ${stringifyMap(activePreset.permissions.extension_permissions)} · Edges: ${stringifyMap(activePreset.permissions.edge_permissions)} · Metadata: ${stringifyMap(activePreset.permissions.metadata_permissions)}`}
        />
      )}
    </Form>
  );
}

/** Match a stored permission map against the available quicksets. Returns
 *  the matching quickset id, or `'custom'` if no preset matches. */
function matchQuickset<T extends string>(
  map: Record<string, T>,
  quicksets: QuickSetOption<T>[],
): string {
  for (const q of quicksets) {
    if (q.value === null) continue;
    if (shallowMapEqual(q.value, map)) return q.id;
  }
  return 'custom';
}

function shallowMapEqual(a: Record<string, string>, b: Record<string, string>): boolean {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  for (const k of aKeys) {
    if (a[k] !== b[k]) return false;
  }
  return true;
}

interface EditValues {
  label: string;
  default_tier: string;
  type_quickset: string;
  type_custom_json: string;
  ext_quickset: string;
  ext_custom_json: string;
  edge_quickset: string;
  edge_custom_json: string;
  metadata_quickset: string;
  metadata_custom_json: string;
}

export function EditKeyForm({ apiKey, onSaved }: { apiKey: ApiKey; onSaved: () => void }) {
  const { pop } = useNavigation();
  const currentType = (apiKey.type_permissions ?? {}) as TypeMap;
  const currentExt = (apiKey.extension_permissions ?? {}) as RwMap;
  const currentEdge = (apiKey.edge_permissions ?? {}) as RwMap;
  const currentMetadata = (apiKey.metadata_permissions ?? {}) as RwMap;

  const [typeQuickset, setTypeQuickset] = useState(matchQuickset(currentType, TYPE_QUICKSETS));
  const [extQuickset, setExtQuickset] = useState(matchQuickset(currentExt, RW_QUICKSETS));
  const [edgeQuickset, setEdgeQuickset] = useState(matchQuickset(currentEdge, RW_QUICKSETS));
  const [metadataQuickset, setMetadataQuickset] = useState(
    matchQuickset(currentMetadata, METADATA_QUICKSETS),
  );

  const [labelError, setLabelError] = useState<string | undefined>();
  const [typeError, setTypeError] = useState<string | undefined>();
  const [extError, setExtError] = useState<string | undefined>();
  const [edgeError, setEdgeError] = useState<string | undefined>();
  const [metadataError, setMetadataError] = useState<string | undefined>();

  async function handleSubmit(values: EditValues) {
    let invalid = false;
    if (!values.label?.trim()) {
      setLabelError('Label is required');
      invalid = true;
    }

    const typeOpt = TYPE_QUICKSETS.find((q) => q.id === values.type_quickset);
    let typeMap: TypeMap = {};
    if (typeOpt?.value) {
      typeMap = typeOpt.value;
    } else {
      const parsed = parseTypeMap(values.type_custom_json);
      if ('error' in parsed) {
        setTypeError(parsed.error);
        invalid = true;
      } else {
        typeMap = parsed.value;
      }
    }

    const extOpt = RW_QUICKSETS.find((q) => q.id === values.ext_quickset);
    let extMap: RwMap = {};
    if (extOpt?.value) {
      extMap = extOpt.value;
    } else {
      const parsed = parseRwMap(values.ext_custom_json);
      if ('error' in parsed) {
        setExtError(parsed.error);
        invalid = true;
      } else {
        extMap = parsed.value;
      }
    }

    const edgeOpt = RW_QUICKSETS.find((q) => q.id === values.edge_quickset);
    let edgeMap: RwMap = {};
    if (edgeOpt?.value) {
      edgeMap = edgeOpt.value;
    } else {
      const parsed = parseRwMap(values.edge_custom_json);
      if ('error' in parsed) {
        setEdgeError(parsed.error);
        invalid = true;
      } else {
        edgeMap = parsed.value;
      }
    }

    const metadataOpt = METADATA_QUICKSETS.find((q) => q.id === values.metadata_quickset);
    let metadataMap: RwMap = {};
    if (metadataOpt?.value) {
      metadataMap = metadataOpt.value;
    } else {
      const parsed = parseRwMap(values.metadata_custom_json);
      if ('error' in parsed) {
        setMetadataError(parsed.error);
        invalid = true;
      } else {
        metadataMap = parsed.value;
      }
    }

    if (invalid) return;

    const input: UpdateKeyInput = {
      label: values.label.trim(),
      default_tier: values.default_tier as 'library' | 'feed',
      type_permissions: typeMap,
      extension_permissions: extMap,
      edge_permissions: edgeMap,
      metadata_permissions: metadataMap,
    };

    try {
      const client = await getClient();
      await client.keys.update(apiKey.id, input);
      await showToast({ style: Toast.Style.Success, title: 'Key updated' });
      onSaved();
      pop();
    } catch (error) {
      if (error instanceof MymeError && error.status === 400 && error.code === 'validation_error') {
        await showFailureToast(error, { title: error.message });
      } else if (error instanceof ForbiddenError) {
        await showFailureToast(error, { title: 'Admin credentials required' });
      } else {
        await showFailureToast(error, { title: 'Failed to update key' });
      }
    }
  }

  return (
    <Form
      navigationTitle={`Edit ${apiKey.label}`}
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Save Changes" icon={Icon.Check} onSubmit={handleSubmit} />
        </ActionPanel>
      }
    >
      <Form.TextField
        id="label"
        title="Label"
        defaultValue={apiKey.label}
        error={labelError}
        onChange={() => setLabelError(undefined)}
      />
      <Form.Description title="Source" text={`${apiKey.source} (immutable)`} />
      <Form.Description title="Role" text={`${apiKey.role} (immutable)`} />
      <Form.Dropdown id="default_tier" title="Default Tier" defaultValue={apiKey.default_tier}>
        <Form.Dropdown.Item value="library" title="Library" />
        <Form.Dropdown.Item value="feed" title="Feed" />
      </Form.Dropdown>

      <Form.Separator />
      <Form.Description text="Type permissions" />
      <Form.Dropdown
        id="type_quickset"
        title="Quick set"
        value={typeQuickset}
        onChange={(v) => {
          setTypeQuickset(v);
          setTypeError(undefined);
        }}
      >
        {TYPE_QUICKSETS.map((q) => (
          <Form.Dropdown.Item key={q.id} value={q.id} title={q.label} />
        ))}
      </Form.Dropdown>
      {typeQuickset === 'custom' && (
        <Form.TextArea
          id="type_custom_json"
          title="JSON"
          defaultValue={stringifyMap(currentType)}
          info='JSON object mapping type pattern to "read" | "write" | "none".'
          error={typeError}
          onChange={() => setTypeError(undefined)}
        />
      )}

      <Form.Separator />
      <Form.Description text="Extension permissions" />
      <Form.Dropdown
        id="ext_quickset"
        title="Quick set"
        value={extQuickset}
        onChange={(v) => {
          setExtQuickset(v);
          setExtError(undefined);
        }}
      >
        {RW_QUICKSETS.map((q) => (
          <Form.Dropdown.Item key={q.id} value={q.id} title={q.label} />
        ))}
      </Form.Dropdown>
      {extQuickset === 'custom' && (
        <Form.TextArea
          id="ext_custom_json"
          title="JSON"
          defaultValue={stringifyMap(currentExt)}
          info='JSON object mapping extension namespace to "read" | "write".'
          error={extError}
          onChange={() => setExtError(undefined)}
        />
      )}

      <Form.Separator />
      <Form.Description text="Edge permissions" />
      <Form.Dropdown
        id="edge_quickset"
        title="Quick set"
        value={edgeQuickset}
        onChange={(v) => {
          setEdgeQuickset(v);
          setEdgeError(undefined);
        }}
      >
        {RW_QUICKSETS.map((q) => (
          <Form.Dropdown.Item key={q.id} value={q.id} title={q.label} />
        ))}
      </Form.Dropdown>
      {edgeQuickset === 'custom' && (
        <Form.TextArea
          id="edge_custom_json"
          title="JSON"
          defaultValue={stringifyMap(currentEdge)}
          info='JSON object mapping edge type to "read" | "write".'
          error={edgeError}
          onChange={() => setEdgeError(undefined)}
        />
      )}

      <Form.Separator />
      <Form.Description text="Metadata permissions" />
      <Form.Dropdown
        id="metadata_quickset"
        title="Quick set"
        value={metadataQuickset}
        onChange={(v) => {
          setMetadataQuickset(v);
          setMetadataError(undefined);
        }}
      >
        {METADATA_QUICKSETS.map((q) => (
          <Form.Dropdown.Item key={q.id} value={q.id} title={q.label} />
        ))}
      </Form.Dropdown>
      {metadataQuickset === 'custom' && (
        <Form.TextArea
          id="metadata_custom_json"
          title="JSON"
          defaultValue={stringifyMap(currentMetadata)}
          info='JSON object mapping metadata sub-resource to "read" | "write".'
          error={metadataError}
          onChange={() => setMetadataError(undefined)}
        />
      )}
    </Form>
  );
}

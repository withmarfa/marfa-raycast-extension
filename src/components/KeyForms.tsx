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

const TYPE_PLACEHOLDER = '{\n  "core.note": "write",\n  "*": "read"\n}';
const EXT_PLACEHOLDER = '{\n  "raycast.myme": "write"\n}';
const EDGE_PLACEHOLDER = '{\n  "in-thread": "write",\n  "*": "read"\n}';

type ParsedMap = Record<string, string>;

function parsePermissionField(
  input: string,
  fieldLabel: string,
): { value: ParsedMap } | { error: string } {
  const trimmed = input.trim();
  if (!trimmed) return { value: {} };
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return { error: `${fieldLabel} is not valid JSON` };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { error: `${fieldLabel} must be a JSON object` };
  }
  const result: ParsedMap = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof value !== 'string') {
      return { error: `${fieldLabel}: value for "${key}" must be a string` };
    }
    result[key] = value;
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
  label: string;
  source: string;
  role: string;
  default_tier: string;
  type_permissions: string;
  extension_permissions: string;
  edge_permissions: string;
}

export function CreateKeyForm({ onCreated }: { onCreated: () => void }) {
  const { push } = useNavigation();
  const [labelError, setLabelError] = useState<string | undefined>();
  const [sourceError, setSourceError] = useState<string | undefined>();
  const [typeError, setTypeError] = useState<string | undefined>();
  const [extError, setExtError] = useState<string | undefined>();
  const [edgeError, setEdgeError] = useState<string | undefined>();

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
    const type = parsePermissionField(values.type_permissions, 'Type permissions');
    if ('error' in type) {
      setTypeError(type.error);
      invalid = true;
    }
    const ext = parsePermissionField(values.extension_permissions, 'Extension permissions');
    if ('error' in ext) {
      setExtError(ext.error);
      invalid = true;
    }
    const edge = parsePermissionField(values.edge_permissions, 'Edge permissions');
    if ('error' in edge) {
      setEdgeError(edge.error);
      invalid = true;
    }
    if (invalid) return;

    try {
      const client = getClient();
      const created = await client.keys.create({
        label: values.label.trim(),
        source: values.source.trim(),
        role: values.role as 'admin' | 'member',
        default_tier: values.default_tier as 'library' | 'feed',
        type_permissions: ('value' in type ? type.value : {}) as Record<
          string,
          'read' | 'write' | 'none'
        >,
        extension_permissions: ('value' in ext ? ext.value : {}) as Record<
          string,
          'read' | 'write'
        >,
        edge_permissions: ('value' in edge ? edge.value : {}) as Record<string, 'read' | 'write'>,
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
      <Form.Dropdown id="role" title="Role" defaultValue="member">
        <Form.Dropdown.Item value="member" title="Member" />
        <Form.Dropdown.Item value="admin" title="Admin" />
      </Form.Dropdown>
      <Form.Dropdown id="default_tier" title="Default Tier" defaultValue="library">
        <Form.Dropdown.Item value="library" title="Library" />
        <Form.Dropdown.Item value="feed" title="Feed" />
      </Form.Dropdown>
      <Form.Separator />
      <Form.TextArea
        id="type_permissions"
        title="Type Permissions"
        placeholder={TYPE_PLACEHOLDER}
        info='JSON object mapping type pattern to "read" | "write" | "none". Supports "*" and "parent.*" wildcards.'
        error={typeError}
        onChange={() => setTypeError(undefined)}
      />
      <Form.TextArea
        id="extension_permissions"
        title="Extension Permissions"
        placeholder={EXT_PLACEHOLDER}
        info='JSON object mapping extension namespace to "read" | "write". Empty means no extension access.'
        error={extError}
        onChange={() => setExtError(undefined)}
      />
      <Form.TextArea
        id="edge_permissions"
        title="Edge Permissions"
        placeholder={EDGE_PLACEHOLDER}
        info='JSON object mapping edge type to "read" | "write". Supports "*" wildcard. Empty means no edge access.'
        error={edgeError}
        onChange={() => setEdgeError(undefined)}
      />
    </Form>
  );
}

interface EditValues {
  label: string;
  default_tier: string;
  type_permissions: string;
  extension_permissions: string;
  edge_permissions: string;
}

export function EditKeyForm({ apiKey, onSaved }: { apiKey: ApiKey; onSaved: () => void }) {
  const { pop } = useNavigation();
  const [labelError, setLabelError] = useState<string | undefined>();
  const [typeError, setTypeError] = useState<string | undefined>();
  const [extError, setExtError] = useState<string | undefined>();
  const [edgeError, setEdgeError] = useState<string | undefined>();

  async function handleSubmit(values: EditValues) {
    let invalid = false;
    if (!values.label?.trim()) {
      setLabelError('Label is required');
      invalid = true;
    }
    const type = parsePermissionField(values.type_permissions, 'Type permissions');
    if ('error' in type) {
      setTypeError(type.error);
      invalid = true;
    }
    const ext = parsePermissionField(values.extension_permissions, 'Extension permissions');
    if ('error' in ext) {
      setExtError(ext.error);
      invalid = true;
    }
    const edge = parsePermissionField(values.edge_permissions, 'Edge permissions');
    if ('error' in edge) {
      setEdgeError(edge.error);
      invalid = true;
    }
    if (invalid) return;

    const input: UpdateKeyInput = {
      label: values.label.trim(),
      default_tier: values.default_tier as 'library' | 'feed',
      type_permissions: ('value' in type ? type.value : {}) as Record<
        string,
        'read' | 'write' | 'none'
      >,
      extension_permissions: ('value' in ext ? ext.value : {}) as Record<string, 'read' | 'write'>,
      edge_permissions: ('value' in edge ? edge.value : {}) as Record<string, 'read' | 'write'>,
    };

    try {
      const client = getClient();
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
      <Form.TextArea
        id="type_permissions"
        title="Type Permissions"
        defaultValue={JSON.stringify(apiKey.type_permissions ?? {}, null, 2)}
        info='JSON object mapping type pattern to "read" | "write" | "none".'
        error={typeError}
        onChange={() => setTypeError(undefined)}
      />
      <Form.TextArea
        id="extension_permissions"
        title="Extension Permissions"
        defaultValue={JSON.stringify(apiKey.extension_permissions ?? {}, null, 2)}
        info='JSON object mapping extension namespace to "read" | "write".'
        error={extError}
        onChange={() => setExtError(undefined)}
      />
      <Form.TextArea
        id="edge_permissions"
        title="Edge Permissions"
        defaultValue={JSON.stringify(apiKey.edge_permissions ?? {}, null, 2)}
        info='JSON object mapping edge type to "read" | "write".'
        error={edgeError}
        onChange={() => setEdgeError(undefined)}
      />
    </Form>
  );
}

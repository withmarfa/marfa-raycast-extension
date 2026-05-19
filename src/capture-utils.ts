import type { TypeSchema } from '@mymehq/sdk';
import { CAPTURE_TYPES } from './constants';

export type CoreCaptureType = (typeof CAPTURE_TYPES)[number]['value'];
export type TypeSchemaWithRequired = TypeSchema & { required?: string[] };

export interface CaptureValues {
  title?: string;
  body?: string;
  url?: string;
  description?: string;
  due_at?: Date | null;
  starts_at?: Date | null;
  priority?: string;
  place?: string;
}

export interface ValidationError {
  field: 'body' | 'title' | 'url' | 'propertiesJson';
  message: string;
}

const CORE_CAPTURE_TYPE_IDS = new Set<string>(CAPTURE_TYPES.map((t) => t.value));

export function isCoreCaptureType(type: string): type is CoreCaptureType {
  return CORE_CAPTURE_TYPE_IDS.has(type);
}

export function normalizeTypeId(type: string | undefined): string {
  return type?.trim() || 'core.note';
}

export function parseTags(value: string | undefined): string[] | undefined {
  if (!value) return undefined;
  const tags = value
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);
  return tags.length > 0 ? tags : undefined;
}

export function mergeTags(...values: Array<string | undefined>): string[] | undefined {
  const tags: string[] = [];
  for (const value of values) {
    for (const tag of parseTags(value) ?? []) {
      if (!tags.includes(tag)) tags.push(tag);
    }
  }
  return tags.length > 0 ? tags : undefined;
}

export function validateCoreCapture(type: string, values: CaptureValues): ValidationError | null {
  if (type === 'core.note' && !values.body?.trim()) {
    return { field: 'body', message: 'Body is required' };
  }
  if (type === 'core.bookmark' && !values.url?.trim()) {
    return { field: 'url', message: 'URL is required' };
  }
  if ((type === 'core.task' || type === 'core.event') && !values.title?.trim()) {
    return { field: 'title', message: 'Title is required' };
  }
  return null;
}

export function buildCoreCaptureProperties(
  type: CoreCaptureType,
  values: CaptureValues,
  options?: { html?: string; sourceText?: string },
): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  switch (type) {
    case 'core.note':
      if (values.title?.trim()) properties.title = values.title.trim();
      if (values.body?.trim()) properties.body = values.body.trim();
      if (options?.html && options.html !== options.sourceText) properties.html = options.html;
      break;
    case 'core.bookmark':
      if (values.url?.trim()) properties.url = values.url.trim();
      if (values.title?.trim()) properties.title = values.title.trim();
      if (values.description?.trim()) properties.description = values.description.trim();
      break;
    case 'core.task':
      if (values.title?.trim()) properties.title = values.title.trim();
      if (values.description?.trim()) properties.description = values.description.trim();
      if (values.due_at) properties.due_at = values.due_at.toISOString();
      if (values.priority) properties.priority = values.priority;
      break;
    case 'core.event':
      if (values.title?.trim()) properties.title = values.title.trim();
      if (values.starts_at) properties.starts_at = values.starts_at.toISOString();
      if (values.place?.trim()) properties.place = values.place.trim();
      break;
  }
  return properties;
}

export function parseCustomPropertiesJson(
  raw: string | undefined,
  schema?: TypeSchemaWithRequired,
): { properties: Record<string, unknown> } | { error: ValidationError } {
  const trimmed = raw?.trim() ?? '';
  if (!trimmed) return { properties: {} };

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return { error: { field: 'propertiesJson', message: 'Properties must be valid JSON' } };
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { error: { field: 'propertiesJson', message: 'Properties must be a JSON object' } };
  }

  const properties = parsed as Record<string, unknown>;
  for (const field of schema?.required ?? []) {
    const value = properties[field];
    const missing =
      value === undefined ||
      value === null ||
      (typeof value === 'string' && value.trim().length === 0);
    if (missing) {
      return {
        error: { field: 'propertiesJson', message: `Missing required property: ${field}` },
      };
    }
  }

  return { properties };
}

import { ContractMismatchError } from '@withmarfa/client';

/**
 * Every way a call to the server can fail, sorted by what the person can do
 * about it.
 *
 * Pure, so the sorting is tested without Raycast. The views decide how to show
 * each kind: a setup failure owns the screen, since nothing on it can work
 * until the preferences or the server change, and anything else is a toast
 * over what is already there.
 */

export type FailureKind =
  /** The server speaks another contract; this build cannot read it. */
  | 'contract'
  /** The preferences name no server this extension can use. */
  | 'setup'
  /** Nothing answered at the URL. */
  | 'unreachable'
  /** The key was refused. */
  | 'unauthorized'
  /** The key is valid and does not reach what was asked. */
  | 'forbidden'
  /** Someone else changed the item and this edit could not be merged. */
  | 'conflict'
  /** The item is no longer there to change. */
  | 'gone'
  /** Anything else, in the server's own words where it gave any. */
  | 'refused';

export interface Failure {
  kind: FailureKind;
  title: string;
  message: string;
}

/** A refusal the server answered, with its error envelope where it sent one. */
export class MarfaRequestError extends Error {
  readonly status: number;
  readonly code: string;
  readonly body: unknown;

  constructor(status: number, body: unknown) {
    const envelope = readEnvelope(body);
    super(envelope?.message ?? `The server answered ${String(status)}.`);
    this.name = 'MarfaRequestError';
    this.status = status;
    this.code = envelope?.code ?? 'unknown';
    this.body = body;
  }
}

/**
 * The preferences cannot name a server: a URL the client will not send to, or
 * a key no header can carry. The message never repeats the key, since it ends
 * up on screen.
 */
export class SetupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SetupError';
  }
}

function readEnvelope(body: unknown): { code: string; message: string } | undefined {
  if (typeof body !== 'object' || body === null || !('error' in body)) return undefined;
  const error = (body as { error: unknown }).error;
  if (typeof error !== 'object' || error === null) return undefined;
  const { code, message } = error as { code?: unknown; message?: unknown };
  return typeof code === 'string' && typeof message === 'string' ? { code, message } : undefined;
}

export const SETUP_KINDS: ReadonlySet<FailureKind> = new Set([
  'contract',
  'setup',
  'unreachable',
  'unauthorized',
]);

/** The refusals that carry the server's current copy of the item. */
const COLLISION_CODES = new Set(['version_conflict', 'ancestor_unavailable']);

export function describeFailure(error: unknown): Failure {
  if (error instanceof ContractMismatchError) {
    return {
      kind: 'contract',
      title: 'This server speaks another contract',
      message:
        error.served === null
          ? `The server answered ${String(error.status)} without a contract version. This extension reads contract ${String(error.expected)}.`
          : `The server speaks contract ${error.served}; this extension reads contract ${String(error.expected)}. Update whichever of the two is behind.`,
    };
  }
  if (error instanceof SetupError) {
    return { kind: 'setup', title: 'The preferences need a change', message: error.message };
  }
  if (error instanceof MarfaRequestError) return describeRefusal(error);
  // fetch reports every transport failure as this one TypeError, the cause
  // saying which. The client refuses redirects, which lands here too, and
  // means the URL is not the server's own address.
  if (error instanceof TypeError && error.message === 'fetch failed') {
    const cause = error.cause instanceof Error ? error.cause.message : '';
    if (cause === 'unexpected redirect') {
      return {
        kind: 'setup',
        title: 'The Server URL redirects',
        message: 'Enter the address it redirects to, which may start with https.',
      };
    }
    return {
      kind: 'unreachable',
      title: 'Could not reach the server',
      message:
        'Nothing answered at the Server URL. Check that the server is running and the URL is right.',
    };
  }
  return {
    kind: 'refused',
    title: 'Something went wrong',
    message: error instanceof Error ? error.message : String(error),
  };
}

function describeRefusal(error: MarfaRequestError): Failure {
  if (error.status === 401) {
    return {
      kind: 'unauthorized',
      title: 'The server refused the API key',
      message: 'Check the API Key in the extension preferences, or mint a new key for Raycast.',
    };
  }
  if (error.status === 403) {
    return { kind: 'forbidden', title: 'The key does not reach this', message: error.message };
  }
  if (COLLISION_CODES.has(error.code)) {
    return { kind: 'conflict', title: 'Changed elsewhere', message: error.message };
  }
  if (error.code === 'item_not_found') {
    return {
      kind: 'gone',
      title: 'No longer there',
      message: 'It was moved to Trash or deleted elsewhere.',
    };
  }
  // A route the server does not have, or a 404 from something that is not a
  // Marfa server at all: the URL points at the wrong place.
  if (error.status === 404) {
    return {
      kind: 'setup',
      title: 'The Server URL is not a Marfa server',
      message:
        'Nothing at this address answers as Marfa. Enter the server’s own address, with no path.',
    };
  }
  if (error.status >= 500 && error.code === 'unknown') {
    return {
      kind: 'refused',
      title: 'The server failed',
      message: `The server, or a proxy in front of it, answered ${String(error.status)}. Try again shortly.`,
    };
  }
  const fields = refusedFields(error);
  if (fields) {
    const listed = Object.entries(fields)
      .map(([field, message]) => `${field}: ${message}`)
      .join('; ');
    return { kind: 'refused', title: 'The server refused the values', message: listed };
  }
  return { kind: 'refused', title: 'The server refused', message: error.message };
}

/**
 * The fields a refused write names, each with the server's reason, so a form
 * marks the field rather than only saying the write failed.
 */
export function refusedFields(error: unknown): Record<string, string> | undefined {
  if (!(error instanceof MarfaRequestError)) return undefined;
  const envelope = (error.body as { error?: { details?: { errors?: unknown } } } | undefined)
    ?.error;
  const errors = envelope?.details?.errors;
  if (!Array.isArray(errors)) return undefined;
  const fields: Record<string, string> = {};
  for (const entry of errors) {
    const { field, message } = (entry ?? {}) as { field?: unknown; message?: unknown };
    if (typeof field === 'string' && typeof message === 'string' && !(field in fields)) {
      fields[field] = message;
    }
  }
  return Object.keys(fields).length > 0 ? fields : undefined;
}

/**
 * The server's copy of an item a refused edit could not be merged with, from
 * the refusal's `current` snapshot, so the person sees what is there now
 * beside what they wrote.
 */
export function conflictCurrent(
  error: unknown,
): { version: number; properties: Record<string, unknown> } | undefined {
  if (!(error instanceof MarfaRequestError) || !COLLISION_CODES.has(error.code)) return undefined;
  const current = (error.body as { current?: unknown } | undefined)?.current;
  if (typeof current !== 'object' || current === null) return undefined;
  const { version, properties } = current as { version?: unknown; properties?: unknown };
  if (typeof version !== 'number' || typeof properties !== 'object' || properties === null) {
    return undefined;
  }
  return { version, properties: properties as Record<string, unknown> };
}

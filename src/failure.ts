import { ContractMismatchError } from '@withmarfa/client';

/**
 * Every way a call to the server can fail, sorted by what the person can do
 * about it.
 *
 * Pure, so the sorting is tested without Raycast. The views decide how to show
 * each kind: a setup failure owns the screen, since nothing on it can work
 * until the preferences change, and anything else is a toast over what is
 * already there.
 */

export type FailureKind =
  /** The server speaks another contract; this build cannot read it. */
  | 'contract'
  /** The URL preference is not a URL this client will send to. */
  | 'setup'
  /** Nothing answered at the URL. */
  | 'unreachable'
  /** The key was refused. */
  | 'unauthorized'
  /** The key is valid and does not reach what was asked. */
  | 'forbidden'
  /** Someone else changed the item and the change could not be merged. */
  | 'conflict'
  /** Anything else the server refused, in its own words. */
  | 'refused';

export interface Failure {
  kind: FailureKind;
  title: string;
  message: string;
}

/** A refusal the server answered with its error envelope. */
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
  if (error instanceof MarfaRequestError) {
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
    if (error.code === 'version_conflict') {
      return { kind: 'conflict', title: 'Changed elsewhere', message: error.message };
    }
    return { kind: 'refused', title: 'The server refused', message: error.message };
  }
  // createClient refuses a base URL it will not send to with a TypeError whose
  // message names the preference's problem; fetch reports an unreachable host
  // as a TypeError with a cause.
  if (error instanceof TypeError) {
    if (error.message === 'fetch failed' || error.cause !== undefined) {
      return {
        kind: 'unreachable',
        title: 'Could not reach the server',
        message:
          'Nothing answered at the Server URL. Check that the server is running and the URL is right.',
      };
    }
    return { kind: 'setup', title: 'The Server URL is not usable', message: error.message };
  }
  return {
    kind: 'refused',
    title: 'Something went wrong',
    message: error instanceof Error ? error.message : String(error),
  };
}

/**
 * The server's copy of an item a refused edit collided with, from the 409's
 * `current` snapshot, so the person sees what is there now beside what they
 * wrote.
 */
export function conflictCurrent(
  error: unknown,
): { version: number; properties: Record<string, unknown> } | undefined {
  if (!(error instanceof MarfaRequestError) || error.code !== 'version_conflict') return undefined;
  const current = (error.body as { current?: unknown } | undefined)?.current;
  if (typeof current !== 'object' || current === null) return undefined;
  const { version, properties } = current as { version?: unknown; properties?: unknown };
  if (typeof version !== 'number' || typeof properties !== 'object' || properties === null) {
    return undefined;
  }
  return { version, properties: properties as Record<string, unknown> };
}

import { ContractMismatchError } from '@withmarfa/client';
import { describe, expect, it } from 'vitest';
import {
  conflictCurrent,
  describeFailure,
  MarfaRequestError,
  refusedFields,
  SETUP_KINDS,
  SetupError,
} from '../src/failure';

function refusal(status: number, code: string, message = 'refused', extra: object = {}) {
  return new MarfaRequestError(status, { error: { code, message }, ...extra });
}

describe('a failure is sorted by what the person can do about it', () => {
  it('a server on another contract names both numbers', () => {
    const failure = describeFailure(new ContractMismatchError('4', 200));
    expect(failure.kind).toBe('contract');
    expect(failure.message).toContain('contract 4');
    expect(failure.message).toContain(
      `contract ${String(new ContractMismatchError('4', 200).expected)}`,
    );
  });

  it('an answer with no contract says so', () => {
    expect(describeFailure(new ContractMismatchError(null, 502)).message).toContain('502');
  });

  it('a refused key, a narrow key and a collision each have their own kind', () => {
    expect(describeFailure(refusal(401, 'unauthorized')).kind).toBe('unauthorized');
    expect(describeFailure(refusal(403, 'type_not_permitted', 'Not core.task')).message).toBe(
      'Not core.task',
    );
    expect(describeFailure(refusal(409, 'version_conflict')).kind).toBe('conflict');
    expect(describeFailure(refusal(400, 'validation_error', 'body is required'))).toEqual({
      kind: 'refused',
      title: 'The server refused',
      message: 'body is required',
    });
  });

  it('an unreachable server, a redirect and unusable preferences are told apart', () => {
    const unreachable = new TypeError('fetch failed', { cause: new Error('connect ECONNREFUSED') });
    expect(describeFailure(unreachable).kind).toBe('unreachable');
    const redirect = new TypeError('fetch failed', { cause: new Error('unexpected redirect') });
    expect(describeFailure(redirect)).toMatchObject({
      kind: 'setup',
      title: 'The Server URL redirects',
    });
    expect(describeFailure(new SetupError('The Server URL is not usable: Invalid URL.')).kind).toBe(
      'setup',
    );
  });

  it('a TypeError from anywhere else is not blamed on the preferences', () => {
    const failure = describeFailure(
      new TypeError("Cannot read properties of undefined (reading 'map')"),
    );
    expect(failure.kind).toBe('refused');
    expect(failure.title).toBe('Something went wrong');
  });

  it('a note gone from under an edit is told apart from a wrong address', () => {
    expect(describeFailure(refusal(404, 'item_not_found', 'Item x not found')).kind).toBe('gone');
    expect(describeFailure(refusal(404, 'not_found', 'Not found')).kind).toBe('setup');
    expect(describeFailure(new MarfaRequestError(404, '<html>404</html>')).kind).toBe('setup');
  });

  it('a proxy failing in front of the server says so, not that the server refused', () => {
    const failure = describeFailure(new MarfaRequestError(502, '<html>Bad gateway</html>'));
    expect(failure.title).toBe('The server failed');
    expect(failure.message).toContain('502');
    expect(describeFailure(refusal(500, 'internal_error', 'Boom')).message).toBe('Boom');
  });

  it('a body without the envelope still gives a message', () => {
    const odd = new MarfaRequestError(418, '<html>Teapot</html>');
    expect(odd.code).toBe('unknown');
    expect(describeFailure(odd).message).toBe('The server answered 418.');
  });

  it('a missing permission is named, with what to do about it', () => {
    const refused = new MarfaRequestError(403, {
      error: {
        code: 'forbidden',
        message: 'This credential does not hold items.purge',
        details: { required_scope: 'items.purge' },
      },
    });
    expect(describeFailure(refused)).toEqual({
      kind: 'forbidden',
      title: 'The key does not reach this',
      message:
        'It needs the items.purge permission, which the API key does not hold. Use a key minted with it.',
    });
    expect(describeFailure(refusal(403, 'type_not_permitted', 'Not this type')).message).toBe(
      'Not this type',
    );
  });

  it('a refused write names each field and why, as the server gave them', () => {
    const invalid = new MarfaRequestError(400, {
      error: {
        code: 'invalid_properties',
        message: 'Invalid properties',
        details: {
          errors: [
            { field: 'title', message: 'Invalid input: expected string, received undefined' },
            { field: 'priority', message: 'Invalid option' },
          ],
        },
      },
    });
    expect(refusedFields(invalid)).toEqual({
      title: 'Invalid input: expected string, received undefined',
      priority: 'Invalid option',
    });
    expect(describeFailure(invalid)).toEqual({
      kind: 'refused',
      title: 'The server refused the values',
      message:
        'title: Invalid input: expected string, received undefined; priority: Invalid option',
    });
    expect(refusedFields(refusal(400, 'invalid_properties'))).toBeUndefined();
    expect(refusedFields(new Error('x'))).toBeUndefined();
  });

  it('only failures that stop everything own the screen', () => {
    expect([...SETUP_KINDS].sort()).toEqual(['contract', 'setup', 'unauthorized', 'unreachable']);
  });
});

describe('a collision shows what is on the server now', () => {
  it('reads the current snapshot from a collision and from a base the server no longer keeps', () => {
    for (const code of ['version_conflict', 'ancestor_unavailable']) {
      const error = refusal(409, code, 'stale', {
        current: { id: 'i1', version: 5, properties: { body: 'cli body' } },
      });
      expect(conflictCurrent(error)).toEqual({ version: 5, properties: { body: 'cli body' } });
      expect(describeFailure(error).kind).toBe('conflict');
    }
  });

  it('reads nothing from any other failure', () => {
    expect(conflictCurrent(refusal(400, 'validation_error'))).toBeUndefined();
    expect(conflictCurrent(refusal(409, 'version_conflict'))).toBeUndefined();
    expect(conflictCurrent(new Error('x'))).toBeUndefined();
  });
});

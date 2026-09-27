import { ContractMismatchError } from '@withmarfa/client';
import { describe, expect, it } from 'vitest';
import { conflictCurrent, describeFailure, MarfaRequestError, SETUP_KINDS } from '../src/failure';

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

  it('an unreachable server and an unusable URL are told apart', () => {
    const unreachable = new TypeError('fetch failed', { cause: new Error('ECONNREFUSED') });
    expect(describeFailure(unreachable).kind).toBe('unreachable');
    expect(describeFailure(new TypeError('Invalid URL')).kind).toBe('setup');
  });

  it('a body without the envelope still gives a message', () => {
    const odd = new MarfaRequestError(502, '<html>Bad gateway</html>');
    expect(odd.code).toBe('unknown');
    expect(describeFailure(odd).message).toBe('The server answered 502.');
  });

  it('only failures that stop everything own the screen', () => {
    expect([...SETUP_KINDS].sort()).toEqual(['contract', 'setup', 'unauthorized', 'unreachable']);
  });
});

describe('a collision shows what is on the server now', () => {
  it('reads the current snapshot from a version conflict', () => {
    const error = refusal(409, 'version_conflict', 'stale', {
      current: { id: 'i1', version: 5, properties: { body: 'cli body' } },
    });
    expect(conflictCurrent(error)).toEqual({ version: 5, properties: { body: 'cli body' } });
  });

  it('reads nothing from any other failure', () => {
    expect(conflictCurrent(refusal(400, 'validation_error'))).toBeUndefined();
    expect(conflictCurrent(refusal(409, 'version_conflict'))).toBeUndefined();
    expect(conflictCurrent(new Error('x'))).toBeUndefined();
  });
});

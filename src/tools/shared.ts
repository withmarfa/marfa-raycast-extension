import { getClient, isStaticKeySession } from '../client';
import { getGrantedScopes, getUnreadableContent } from '../auth/marfa-oauth';
import { typeReadableBySession } from '../auth/discovery';

/**
 * What every tool needs, and the one guard a tool cannot inherit.
 *
 * **A hook protects nothing here.** The commands read the session's grant
 * through `useTypeGrant`, and a hook runs where something renders; a tool
 * renders nothing. So the same rule is asked for directly, or a tool would
 * return an empty list for a type this session cannot read and the model would
 * report that the person has none of them.
 */
export async function refuseIfNotGranted(typeId: string | undefined): Promise<void> {
  if (!typeId) return;
  const session = { staticKey: isStaticKeySession(), granted: await getGrantedScopes() };
  if (typeReadableBySession(session, typeId)) return;
  throw new Error(
    `This sign-in was not granted access to ${typeId}, so there is nothing to read. ` +
      `It is not that the space holds none: say so rather than reporting an empty result.`,
  );
}

/** The client, for a caller with no command wrapper around it. */
export function toolClient() {
  return getClient();
}

/**
 * An item as a tool should answer with it.
 *
 * Full details rather than an id and a title. Every field omitted becomes a
 * follow-up call, and a model that has to ask twice doubles the latency a
 * person feels.
 */
export function toolItem(item: {
  id: string;
  type: string;
  state: string;
  tier?: string | null;
  properties: Record<string, unknown>;
  timestamp: string;
  updated_at: string;
  source: string;
}) {
  return {
    id: item.id,
    type: item.type,
    state: item.state,
    tier: item.tier ?? undefined,
    properties: item.properties,
    captured: item.timestamp,
    updated: item.updated_at,
    source: item.source,
  };
}

/**
 * What this session cannot see, for a read that was not filtered to one type.
 *
 * **The guard above only fires when a type was named, and the tools tell the
 * model to omit it for everything**, so the common read had nothing checking
 * it. A partially granted session then returns the granted subset and the model
 * says the person has nothing, which is the failure this whole area exists to
 * remove. Returned alongside the results rather than thrown, because the
 * results are real: what is wrong is calling them complete.
 *
 * It names the kinds rather than counting them, because a count is the one
 * thing a model cannot pass on usefully, and reads the stored record rather
 * than the live advertisement, so a search cannot install a wider one and arm
 * a consent prompt that surfaces later looking unrelated.
 */
export async function unreadableNote(): Promise<string | undefined> {
  if (isStaticKeySession()) return undefined;
  const unreadable = await getUnreadableContent();
  if (unreadable.length === 0) return undefined;
  return (
    `This sign-in was not granted ${unreadable.join(', ')}, so these results cover only part ` +
    `of what the person has. Say so rather than describing them as everything, and do not ` +
    `conclude from this that something does not exist.`
  );
}

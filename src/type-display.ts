import { Color, Icon } from '@raycast/api';
import { classifyNamespace, isSystemType, MAX_RESOLUTION_DEPTH } from '@withmarfa/shared';
import type { NamespaceTier, PlatformTypeId } from '@withmarfa/shared';
import type { Item, TypeSchema } from '@withmarfa/sdk';
import { fallbackItemSubtitle, fallbackItemTitle, toTitleCase } from './helpers';

export interface TypeAppearance {
  icon: Icon;
  color: Color;
}

/**
 * Curated appearance overrides — an override over the registry-driven
 * default, not the mechanism by which types are displayed.
 *
 * Labels are deliberately absent: the server returns a `label` for every
 * type it knows, so a second copy here could only ever drift out of
 * agreement with it. An icon is the one thing the registry does not
 * supply, which is why this map exists at all.
 *
 * An entry earns its place on one test — a distinct glyph carries
 * recognition the label cannot, so a book, a song and a film are told apart
 * at a glance in a dense list. That is true of the core vocabulary and
 * essentially nothing else, so the map stops there. Every integration
 * type, and anything an instance or a third party registers, resolves from
 * the registry and its namespace tier, which is what lets a type nobody
 * here has ever seen render correctly.
 *
 * Family roots are listed too, so a core subtype the platform adds later
 * inherits a sensible glyph through `parent` rather than falling all the
 * way out to the tier default.
 *
 * The `satisfies` clause pins this set against the platform registry, so
 * renaming or dropping one fails the build. It is deliberately not
 * extended to cover integration types: pinning those would buy a build
 * check at the cost of the rigidity this module exists to remove.
 */
const CURATED_APPEARANCE = {
  'core.note': { icon: Icon.Document, color: Color.Blue },
  'core.bookmark': { icon: Icon.Link, color: Color.Green },
  'core.task': { icon: Icon.CheckCircle, color: Color.Orange },
  'core.event': { icon: Icon.Calendar, color: Color.Purple },
  'core.highlight': { icon: Icon.Highlight, color: Color.Yellow },
  'core.message': { icon: Icon.Message, color: Color.Blue },
  'core.entity': { icon: Icon.Person, color: Color.Red },
  'core.entity.person': { icon: Icon.Person, color: Color.Red },
  'core.entity.place': { icon: Icon.Pin, color: Color.Red },
  'core.media': { icon: Icon.Video, color: Color.PrimaryText },
  'core.media.book': { icon: Icon.Book, color: Color.PrimaryText },
  'core.media.article': { icon: Icon.BlankDocument, color: Color.PrimaryText },
  'core.media.film': { icon: Icon.Video, color: Color.PrimaryText },
  'core.media.song': { icon: Icon.Music, color: Color.PrimaryText },
  'core.media.album': { icon: Icon.Music, color: Color.PrimaryText },
  'core.media.series': { icon: Icon.Monitor, color: Color.PrimaryText },
  'core.media.episode': { icon: Icon.Monitor, color: Color.PrimaryText },
  'core.file': { icon: Icon.Document, color: Color.SecondaryText },
  'core.file.image': { icon: Icon.Image, color: Color.SecondaryText },
  'core.file.audio': { icon: Icon.Music, color: Color.SecondaryText },
  'core.file.video': { icon: Icon.Video, color: Color.SecondaryText },
} as const satisfies Partial<Record<PlatformTypeId, TypeAppearance>>;

/**
 * Where a type with no curated ancestor lands. The tiers come from the
 * platform's own namespace grammar rather than from prefix matching here,
 * so a new tier is a compile error rather than a silent miss.
 */
const TIER_APPEARANCE: Record<NamespaceTier, TypeAppearance> = {
  core: { icon: Icon.Circle, color: Color.Blue },
  system: { icon: Icon.Cog, color: Color.SecondaryText },
  app: { icon: Icon.AppWindow, color: Color.SecondaryText },
  user: { icon: Icon.Tag, color: Color.Purple },
  publisher: { icon: Icon.Plug, color: Color.Magenta },
  marfa: { icon: Icon.Box, color: Color.Magenta },
};

/**
 * Ends a `parent` chain that loops back on itself.
 *
 * A repeat rather than a count. A small fixed depth silently truncates a legal
 * chain, so a type nested more deeply than the number someone picked would
 * resolve against an ancestor it does not have. The platform's own bound is
 * what stops a pathological one.
 */
const MAX_ANCESTRY_DEPTH = MAX_RESOLUTION_DEPTH;

export interface TypeRegistry {
  schema(typeId: string): TypeSchema | undefined;
  label(typeId: string): string;
  appearance(typeId: string): TypeAppearance;
  titleField(typeId: string): string | undefined;
  bodyField(typeId: string): string | undefined;
  titleOf(item: Item): string;
  subtitleOf(item: Item): string;
  /** Every non-system type the instance knows, ordered by label. */
  selectableTypes(): TypeSchema[];
}

function readableString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

/**
 * Build a display resolver over the schemas the server returned.
 *
 * Ancestry is walked across this list rather than through the helpers in
 * `@withmarfa/shared`, because those resolve against the vocabulary
 * compiled into the package and cannot know the types a given instance
 * registered. The grammar helpers (`classifyNamespace`, `isSystemType`)
 * are instance-independent and are used directly.
 */
export function buildTypeRegistry(schemas: TypeSchema[] | undefined): TypeRegistry {
  const byId = new Map<string, TypeSchema>((schemas ?? []).map((schema) => [schema.id, schema]));

  /** Walk a type and its ancestors, nearest first. */
  function* lineage(typeId: string): Generator<TypeSchema> {
    let current = byId.get(typeId);
    const seen = new Set<string>();
    while (current && !seen.has(current.id) && seen.size < MAX_ANCESTRY_DEPTH) {
      seen.add(current.id);
      yield current;
      current = current.parent ? byId.get(current.parent) : undefined;
    }
  }

  function label(typeId: string): string {
    const own = readableString(byId.get(typeId)?.label);
    if (own) return own;
    // No registration for this type, so humanise the identifier rather than
    // showing a raw dotted string. `core.media.book` reads as "Book".
    const leaf = typeId.split('.').pop() ?? typeId;
    return toTitleCase(leaf);
  }

  function appearance(typeId: string): TypeAppearance {
    const curated: Partial<Record<string, TypeAppearance>> = CURATED_APPEARANCE;
    const own = curated[typeId];
    if (own) return own;
    for (const schema of lineage(typeId)) {
      const inherited = curated[schema.id];
      if (inherited) return inherited;
    }
    return TIER_APPEARANCE[classifyNamespace(typeId)];
  }

  function hintedField(typeId: string, key: 'title_field' | 'body_field'): string | undefined {
    for (const schema of lineage(typeId)) {
      const field = readableString(schema.display_hints?.[key]);
      if (field) return field;
    }
    return undefined;
  }

  function titleOf(item: Item): string {
    const field = hintedField(item.type, 'title_field');
    const hinted = field ? readableString(item.properties[field]) : undefined;
    if (hinted) return hinted;
    // The registry either has no opinion or the item does not carry the
    // field it named. Fall back to the conventional property names, then to
    // the type's own label, which still beats a raw identifier.
    return fallbackItemTitle(item) ?? label(item.type);
  }

  function subtitleOf(item: Item): string {
    const field = hintedField(item.type, 'body_field');
    const hinted = field ? readableString(item.properties[field]) : undefined;
    if (hinted) return hinted.slice(0, 100);
    return fallbackItemSubtitle(item) ?? label(item.type);
  }

  return {
    schema: (typeId) => byId.get(typeId),
    label,
    appearance,
    titleField: (typeId) => hintedField(typeId, 'title_field'),
    bodyField: (typeId) => hintedField(typeId, 'body_field'),
    titleOf,
    subtitleOf,
    selectableTypes: () =>
      (schemas ?? [])
        .filter((schema) => !isSystemType(schema.id))
        .slice()
        .sort((a, b) => label(a.id).localeCompare(label(b.id))),
  };
}

import { Color, Icon, type Image } from '@raycast/api';
import type { Registry } from './display';
import type { Namespace } from './schema-fields';

/**
 * How a type looks in a list. The registry supplies labels; a glyph is the one
 * thing it does not, so the core vocabulary gets curated ones, a subtype
 * inherits its nearest ancestor's through `parent`, and anything else takes
 * its namespace's.
 */

interface Appearance {
  icon: Icon;
  color: Color;
}

const CURATED: Record<string, Appearance> = {
  'core.note': { icon: Icon.Document, color: Color.Blue },
  'core.bookmark': { icon: Icon.Link, color: Color.Green },
  'core.task': { icon: Icon.CheckCircle, color: Color.Orange },
  'core.event': { icon: Icon.Calendar, color: Color.Purple },
  'core.highlight': { icon: Icon.Highlight, color: Color.Yellow },
  'core.message': { icon: Icon.Message, color: Color.Blue },
  'core.entity': { icon: Icon.Person, color: Color.Red },
  'core.entity.place': { icon: Icon.Pin, color: Color.Red },
  'core.media': { icon: Icon.Video, color: Color.PrimaryText },
  'core.media.book': { icon: Icon.Book, color: Color.PrimaryText },
  'core.media.article': { icon: Icon.BlankDocument, color: Color.PrimaryText },
  'core.media.song': { icon: Icon.Music, color: Color.PrimaryText },
  'core.media.album': { icon: Icon.Music, color: Color.PrimaryText },
  'core.media.series': { icon: Icon.Monitor, color: Color.PrimaryText },
  'core.media.episode': { icon: Icon.Monitor, color: Color.PrimaryText },
  'core.file': { icon: Icon.Paperclip, color: Color.SecondaryText },
  'core.file.image': { icon: Icon.Image, color: Color.SecondaryText },
  'core.file.audio': { icon: Icon.Music, color: Color.SecondaryText },
  'core.file.video': { icon: Icon.Video, color: Color.SecondaryText },
};

export const NAMESPACE_APPEARANCE: Record<Namespace, Appearance> = {
  core: { icon: Icon.Circle, color: Color.Blue },
  system: { icon: Icon.Cog, color: Color.SecondaryText },
  app: { icon: Icon.AppWindow, color: Color.SecondaryText },
  user: { icon: Icon.Tag, color: Color.Purple },
  publisher: { icon: Icon.Plug, color: Color.Magenta },
  marfa: { icon: Icon.Box, color: Color.Magenta },
};

function appearance(registry: Registry, typeId: string): Appearance {
  const own = CURATED[typeId];
  if (own) return own;
  for (const type of registry.lineage(typeId)) {
    const inherited = CURATED[type.id];
    if (inherited) return inherited;
  }
  return NAMESPACE_APPEARANCE[registry.namespace(typeId)];
}

/** A muted icon marks an item that is not active, such as one in the Trash. */
export function typeIcon(registry: Registry, typeId: string, muted = false): Image.ImageLike {
  const { icon, color } = appearance(registry, typeId);
  return { source: icon, tintColor: muted ? Color.SecondaryText : color };
}

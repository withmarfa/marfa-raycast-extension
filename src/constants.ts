import { Color, Icon } from '@raycast/api';
import type { PlatformTypeId } from '@withmarfa/shared';

interface TypeDisplay {
  label: string;
  icon: Icon;
  color: Color;
}

/**
 * Display metadata per platform type. The `satisfies` clause binds the keys to
 * the type registry of the pinned `@withmarfa/shared`, so a type the platform
 * renames or drops fails the typecheck here instead of silently becoming an
 * entry that can never match an item. The map stays partial on purpose: a type
 * without an entry falls back to its raw identifier, which is the right
 * behavior for types this extension has no opinion about.
 *
 * The index signature is what callers index with a server-supplied string;
 * `satisfies` is what constrains the literal.
 */
export const TYPE_CONFIG: Record<string, TypeDisplay> = {
  'core.note': { label: 'Note', icon: Icon.Document, color: Color.Blue },
  'core.bookmark': { label: 'Bookmark', icon: Icon.Link, color: Color.Green },
  'core.task': { label: 'Task', icon: Icon.CheckCircle, color: Color.Orange },
  'core.event': { label: 'Event', icon: Icon.Calendar, color: Color.Purple },
  'core.highlight': { label: 'Highlight', icon: Icon.Highlight, color: Color.Yellow },
  'core.entity': { label: 'Entity', icon: Icon.Person, color: Color.Red },
  'core.entity.person': { label: 'Person', icon: Icon.Person, color: Color.Red },
  'core.entity.place': { label: 'Place', icon: Icon.Pin, color: Color.Red },
  'core.media': { label: 'Media', icon: Icon.Video, color: Color.PrimaryText },
  'core.media.book': { label: 'Book', icon: Icon.Book, color: Color.PrimaryText },
  'core.media.article': { label: 'Article', icon: Icon.BlankDocument, color: Color.PrimaryText },
  'core.media.film': { label: 'Film', icon: Icon.Video, color: Color.PrimaryText },
  'core.media.song': { label: 'Song', icon: Icon.Music, color: Color.PrimaryText },
  'core.media.album': { label: 'Album', icon: Icon.Music, color: Color.PrimaryText },
  'core.media.series': { label: 'Series', icon: Icon.Monitor, color: Color.PrimaryText },
  'core.media.episode': { label: 'Episode', icon: Icon.Monitor, color: Color.PrimaryText },
  'core.file': { label: 'File', icon: Icon.Document, color: Color.SecondaryText },
  'core.file.image': { label: 'Image', icon: Icon.Image, color: Color.SecondaryText },
  'core.file.audio': { label: 'Audio', icon: Icon.Music, color: Color.SecondaryText },
  'core.file.video': { label: 'Video', icon: Icon.Video, color: Color.SecondaryText },
} satisfies Partial<Record<PlatformTypeId, TypeDisplay>>;

export const STATE_CONFIG: Record<string, { label: string; color: Color }> = {
  active: { label: 'Active', color: Color.Green },
  archived: { label: 'Archived', color: Color.Blue },
  trashed: { label: 'Trashed', color: Color.Red },
};

export const CAPTURE_TYPES = [
  { value: 'core.note', label: 'Note' },
  { value: 'core.bookmark', label: 'Bookmark' },
  { value: 'core.task', label: 'Task' },
  { value: 'core.event', label: 'Event' },
] as const satisfies readonly { value: PlatformTypeId; label: string }[];

/** The empty value is the "no filter" sentinel, not a type identifier. */
export const ALL_TYPES = [
  { value: '', label: 'All Types' },
  { value: 'core.note', label: 'Note' },
  { value: 'core.bookmark', label: 'Bookmark' },
  { value: 'core.task', label: 'Task' },
  { value: 'core.event', label: 'Event' },
  { value: 'core.highlight', label: 'Highlight' },
  { value: 'core.entity.person', label: 'Person' },
  { value: 'core.entity.place', label: 'Place' },
  { value: 'core.media.book', label: 'Book' },
  { value: 'core.media.article', label: 'Article' },
  { value: 'core.media.film', label: 'Film' },
  { value: 'core.media.song', label: 'Song' },
  { value: 'core.media.album', label: 'Album' },
  { value: 'core.media.series', label: 'Series' },
  { value: 'core.media.episode', label: 'Episode' },
  { value: 'core.file', label: 'File' },
  { value: 'core.file.image', label: 'Image' },
  { value: 'core.file.audio', label: 'Audio' },
  { value: 'core.file.video', label: 'Video' },
] as const satisfies readonly { value: PlatformTypeId | ''; label: string }[];

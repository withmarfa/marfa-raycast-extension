import { Color, Icon } from "@raycast/api";

export const TYPE_CONFIG: Record<string, { label: string; icon: Icon; color: Color }> = {
  "core.note": { label: "Note", icon: Icon.Document, color: Color.Blue },
  "core.bookmark": { label: "Bookmark", icon: Icon.Link, color: Color.Green },
  "core.task": { label: "Task", icon: Icon.CheckCircle, color: Color.Orange },
  "core.event": { label: "Event", icon: Icon.Calendar, color: Color.Purple },
  "core.message": { label: "Message", icon: Icon.Envelope, color: Color.Yellow },
  "core.collection": { label: "Collection", icon: Icon.List, color: Color.Magenta },
  "core.entity": { label: "Entity", icon: Icon.Person, color: Color.Red },
  "core.entity.person": { label: "Person", icon: Icon.Person, color: Color.Red },
  "core.entity.place": { label: "Place", icon: Icon.Pin, color: Color.Red },
  "core.work": { label: "Work", icon: Icon.Book, color: Color.PrimaryText },
  "core.work.book": { label: "Book", icon: Icon.Book, color: Color.PrimaryText },
  "core.work.article": { label: "Article", icon: Icon.TextDocument, color: Color.PrimaryText },
  "core.work.film": { label: "Film", icon: Icon.Video, color: Color.PrimaryText },
  "core.work.song": { label: "Song", icon: Icon.Music, color: Color.PrimaryText },
  "core.work.album": { label: "Album", icon: Icon.Music, color: Color.PrimaryText },
  "core.work.podcast": { label: "Podcast", icon: Icon.Microphone, color: Color.PrimaryText },
  "core.work.series": { label: "Series", icon: Icon.Monitor, color: Color.PrimaryText },
  "core.work.tv_episode": { label: "TV Episode", icon: Icon.Monitor, color: Color.PrimaryText },
  "core.file": { label: "File", icon: Icon.Document, color: Color.SecondaryText },
  "core.file.image": { label: "Image", icon: Icon.Image, color: Color.SecondaryText },
  "core.file.audio": { label: "Audio", icon: Icon.Music, color: Color.SecondaryText },
  "core.file.video": { label: "Video", icon: Icon.Video, color: Color.SecondaryText },
};

export const STATE_CONFIG: Record<string, { label: string; color: Color }> = {
  new: { label: "New", color: Color.Yellow },
  active: { label: "Active", color: Color.Green },
  archived: { label: "Archived", color: Color.Blue },
  trashed: { label: "Trashed", color: Color.Red },
};

export const CAPTURE_TYPES = [
  { value: "core.note", label: "Note" },
  { value: "core.bookmark", label: "Bookmark" },
  { value: "core.task", label: "Task" },
  { value: "core.event", label: "Event" },
] as const;

export const ALL_TYPES = [
  { value: "", label: "All Types" },
  { value: "core.note", label: "Note" },
  { value: "core.bookmark", label: "Bookmark" },
  { value: "core.task", label: "Task" },
  { value: "core.event", label: "Event" },
  { value: "core.message", label: "Message" },
  { value: "core.collection", label: "Collection" },
  { value: "core.entity.person", label: "Person" },
  { value: "core.entity.place", label: "Place" },
  { value: "core.work.book", label: "Book" },
  { value: "core.work.article", label: "Article" },
  { value: "core.work.film", label: "Film" },
  { value: "core.work.song", label: "Song" },
  { value: "core.work.album", label: "Album" },
  { value: "core.work.podcast", label: "Podcast" },
  { value: "core.work.series", label: "Series" },
  { value: "core.work.tv_episode", label: "TV Episode" },
  { value: "core.file.image", label: "Image" },
  { value: "core.file.audio", label: "Audio" },
  { value: "core.file.video", label: "Video" },
] as const;

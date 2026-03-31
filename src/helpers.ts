import type { Item } from "./types";
import { TYPE_CONFIG } from "./constants";

export function getItemTitle(item: Item): string {
  const p = item.properties;
  if (typeof p.title === "string" && p.title) return p.title;
  if (typeof p.name === "string" && p.name) return p.name;
  if (typeof p.url === "string" && p.url) return p.url;
  if (typeof p.body === "string" && p.body) return p.body.slice(0, 80);
  return TYPE_CONFIG[item.type]?.label ?? item.type;
}

export function getItemSubtitle(item: Item): string {
  const p = item.properties;
  if (typeof p.description === "string") return p.description.slice(0, 100);
  if (typeof p.body === "string" && typeof p.title === "string") return p.body.slice(0, 100);
  if (typeof p.url === "string" && typeof p.title === "string") return p.url;
  return TYPE_CONFIG[item.type]?.label ?? item.type;
}

export function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const itemDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.floor((today.getTime() - itemDate.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return date.toLocaleDateString("en-US", { weekday: "long" });
  if (date.getFullYear() === now.getFullYear()) {
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function formatTime(dateStr: string): string {
  return new Date(dateStr).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

export function groupItemsByDate(items: Item[]): Map<string, Item[]> {
  const groups = new Map<string, Item[]>();
  for (const item of items) {
    const key = formatDate(item.timestamp);
    const group = groups.get(key);
    if (group) {
      group.push(item);
    } else {
      groups.set(key, [item]);
    }
  }
  return groups;
}

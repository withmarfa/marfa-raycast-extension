import { getPreferenceValues } from "@raycast/api";
import type { Preferences, ItemWithMetadata, ListResponse, SearchResponse, ItemState, Metadata } from "./types";

function getConfig() {
  const { apiUrl, apiKey } = getPreferenceValues<Preferences>();
  return { apiUrl: apiUrl.replace(/\/+$/, ""), apiKey };
}

export async function mymeRequest<T>(path: string, options?: { method?: string; body?: string }): Promise<T> {
  const { apiUrl, apiKey } = getConfig();
  const res = await fetch(`${apiUrl}${path}`, {
    method: options?.method ?? "GET",
    body: options?.body,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Myme API error ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

export async function listItems(params: {
  type?: string;
  state?: string;
  sort?: string;
  direction?: string;
  limit?: number;
  cursor?: string;
}): Promise<ListResponse> {
  const sp = new URLSearchParams();
  if (params.type) sp.set("type", params.type);
  if (params.state) sp.set("state", params.state);
  if (params.sort) sp.set("sort", params.sort);
  if (params.direction) sp.set("direction", params.direction);
  if (params.limit) sp.set("limit", String(params.limit));
  if (params.cursor) sp.set("cursor", params.cursor);
  const qs = sp.toString();
  return mymeRequest<ListResponse>(`/items${qs ? `?${qs}` : ""}`);
}

export async function getItem(id: string): Promise<ItemWithMetadata> {
  return mymeRequest<ItemWithMetadata>(`/items/${id}`);
}

export async function createItem(input: {
  type: string;
  properties: Record<string, unknown>;
  tags?: string[];
  timestamp?: string;
}): Promise<ItemWithMetadata> {
  return mymeRequest<ItemWithMetadata>("/items", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function transitionItem(id: string, state: ItemState): Promise<ItemWithMetadata> {
  return mymeRequest<ItemWithMetadata>(`/items/${id}/transition`, {
    method: "POST",
    body: JSON.stringify({ state }),
  });
}

export async function addTags(id: string, tags: string[]): Promise<{ metadata: Metadata }> {
  return mymeRequest<{ metadata: Metadata }>(`/items/${id}/tags`, {
    method: "POST",
    body: JSON.stringify({ tags }),
  });
}

export async function removeTag(id: string, tag: string): Promise<{ metadata: Metadata }> {
  return mymeRequest<{ metadata: Metadata }>(`/items/${id}/tags/${encodeURIComponent(tag)}`, {
    method: "DELETE",
  });
}

export async function deleteItem(id: string): Promise<void> {
  await mymeRequest<{ ok: boolean }>(`/items/${id}`, { method: "DELETE" });
}

export async function searchItems(params: {
  q: string;
  type?: string;
  limit?: number;
}): Promise<SearchResponse> {
  const sp = new URLSearchParams();
  sp.set("q", params.q);
  if (params.type) sp.set("type", params.type);
  if (params.limit) sp.set("limit", String(params.limit));
  return mymeRequest<SearchResponse>(`/search?${sp.toString()}`);
}

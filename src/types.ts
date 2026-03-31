export interface Preferences {
  apiUrl: string;
  apiKey: string;
}

export type ItemState = "new" | "active" | "archived" | "trashed";

export interface Item {
  id: string;
  type: string;
  state: ItemState;
  properties: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  timestamp: string;
  version: number;
  source?: string;
  source_id?: string;
  origin?: string;
  schema_version?: number;
  device_id?: string;
  parent_id?: string;
  thread_id?: string;
  capture_latitude?: number;
  capture_longitude?: number;
}

export interface Metadata {
  item_id: string;
  tags: string[];
  about: string[];
}

export interface ItemWithMetadata {
  item: Item;
  metadata: Metadata;
}

export interface SearchResult {
  item: Item;
  metadata: Metadata;
  relevance_score: number;
  snippet?: string;
}

export interface ListResponse {
  data: Item[];
  cursor: string | null;
  has_more: boolean;
}

export interface SearchResponse {
  results: SearchResult[];
}

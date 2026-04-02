export type BlobRef = {
  blob: string; // sha256 hex
  mime: string;
  name?: string;
  size?: number;
};

export type SourceRef = Partial<{
  project: string;
  session: string;
  message: string;
  turn: string;
}>;

export type EventEnvelopeV1 = {
  schema: "openplanner.event.v1";
  id: string;
  ts: string; // ISO
  source: string;
  kind: string;
  source_ref?: SourceRef;
  text?: string;
  attachments?: BlobRef[];
  meta?: Record<string, unknown>;
  extra?: Record<string, unknown>;
};

export type EventIngestRequest = { events: EventEnvelopeV1[] };

export type SearchTier = "hot" | "compact" | "both";

export type DocumentKind = "docs" | "code" | "config" | "data";
export type DocumentVisibility = "internal" | "review" | "public" | "archived";

export type DocumentRecord = {
  id: string;
  title: string;
  content: string;
  project: string;
  kind: DocumentKind;
  visibility: DocumentVisibility;
  source?: string;
  sourcePath?: string;
  domain?: string;
  language?: string;
  createdBy?: string;
  publishedBy?: string;
  publishedAt?: string | null;
  aiDrafted?: boolean;
  aiModel?: string | null;
  aiPromptHash?: string | null;
  metadata?: Record<string, unknown>;
  ts?: string;
};

export type DocumentUpsertRequest = {
  document: DocumentRecord;
};

export type DocumentPatchRequest = {
  title?: string;
  content?: string;
  visibility?: DocumentVisibility;
  sourcePath?: string | null;
  domain?: string | null;
  language?: string | null;
  publishedBy?: string | null;
  publishedAt?: string | null;
  metadata?: Record<string, unknown>;
};

export type FtsSearchRequest = {
  q: string;
  limit?: number;
  source?: string;
  kind?: string;
  project?: string;
  session?: string;
  visibility?: DocumentVisibility;
  tier?: SearchTier;
};

export type VectorSearchRequest = {
  q: string;
  k?: number;
  source?: string;
  kind?: string;
  project?: string;
  visibility?: DocumentVisibility;
  where?: Record<string, unknown>;
  tier?: SearchTier;
};

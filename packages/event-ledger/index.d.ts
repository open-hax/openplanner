declare module "@promethean-os/event-ledger" {
  export interface EventFrom {
    "actor-id": string;
    "actor-kind": string;
    "actor-node"?: string;
  }

  export interface EventTo {
    "actor-id": string;
    "actor-kind": string;
    "actor-node"?: string;
  }

  export interface Envelope {
    "event/id"?: string;
    "event/type": string;
    "event/time"?: string | Date;
    "event/from"?: EventFrom;
    "event/to"?: EventTo;
    "causal/root"?: string;
    "causal/parent"?: string;
    "session/id"?: string;
    "turn/id"?: string;
    "delivery/mode"?: "tell" | "ask" | "stream" | "ack-required";
    "delivery/id"?: string;
    payload?: Record<string, unknown>;
    contracts?: string[];
    expectations?: Record<string, unknown>;
  }

  export interface LedgerEvent extends Envelope {
    "event/id": string;
    "event/time": string;
    "event/from"?: EventFrom;
    "event/to"?: EventTo;
    "causal/root": string;
    "session/id": string;
    "delivery/mode": "tell" | "ask" | "stream" | "ack-required";
    "ledger/seq": number;
    "expiresAt": string;
    "createdAt": string;
    "updatedAt": string;
  }

  export interface WatchFilter {
    "event/type"?: string | string[];
    "session/id"?: string;
    "causal/root"?: string;
  }

  export type WatchCallback = (event: LedgerEvent) => void;

  export interface WatcherHandle {
    id: string;
    close(): void;
  }

  export function appendEvent(db: any, envelope: Envelope): Promise<LedgerEvent>;
  export function appendEvents(db: any, envelopes: Envelope[]): Promise<LedgerEvent[]>;
  export function setupIndexes(db: any): Promise<void>;
  export function validateEnvelope(envelope: unknown): { valid: boolean; errors?: string[] };
  export function watchLedger(db: any, filter: WatchFilter, callback: WatchCallback): WatcherHandle;
  export function watchOnce(db: any, filter: WatchFilter, timeoutMs?: number): Promise<LedgerEvent | null>;
  export function closeWatcher(id: string): void;
  export function closeAllWatchers(): void;

  // REST Compatibility Adapter
  export interface RestEvent {
    schema?: string;
    id?: string;
    ts?: string;
    source?: string;
    kind: string;
    source_ref?: { project?: string; session?: string; message?: string; turn?: string };
    text?: string;
    attachments?: Array<{ blob: string; mime: string; name?: string; size?: number }>;
    meta?: Record<string, unknown>;
    extra?: Record<string, unknown>;
  }

  export interface RestAppendResult {
    ok: boolean;
    count: number;
    ids: string[];
    projectedGraphEdges: number;
    ftsEnabled: boolean;
    storageBackend: string;
    indexed: boolean;
    indexing: string;
    ledgerSeqs: number[];
  }

  export function restEventToEnvelope(restEvent: RestEvent): Envelope;
  export function appendRestEvent(db: any, restEvent: RestEvent): Promise<RestAppendResult>;
  export function appendRestEvents(db: any, restEvents: RestEvent[]): Promise<RestAppendResult>;

  // TTL Configuration
  export interface TtlOverride {
    prefixes: string[];
    "ttl-days": number;
  }

  export function resolveTtl(db: any, eventType?: string): Promise<number>;
  export function loadOverrides(db: any): Promise<TtlOverride[]>;

  // Legacy Bridge
  export function bridgeEnabled(): Promise<boolean>;
  export function mergeFindEvents(
    db: any,
    cursor?: { "event/time": string; "event/id": string } | null,
    limit?: number
  ): Promise<Array<Record<string, unknown>>>;
  export function findEventById(db: any, eventId: string): Promise<Record<string, unknown> | null>;
}

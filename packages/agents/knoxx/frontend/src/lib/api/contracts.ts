import { request } from "./core";

// ── Contract types ──────────────────────────────────────────────────────────

export interface AgentContract {
  "contract/id": string;
  "contract/kind": "agent" | "policy" | "fulfillment" | "tool-call" | "trigger";
  "contract/version"?: number;
  "contract/uses"?: string[];
  enabled?: boolean;
  "trigger-kind"?: "event" | "cron" | "manual";
  "source-kind"?: string;
  "source-mode"?: string;
  "cadence-min"?: number;
  agent?: {
    role?: string;
    model?: string;
    thinking?: string;
  };
  prompts?: {
    system?: string;
    task?: string;
    user?: string;
  };
  events?: {
    always?: string[];
    maybe?: string[];
  };
  data?: Record<string, unknown>;
  hooks?: Record<string, unknown>;
  "ui/schema"?: Record<string, unknown>;
}

export interface ContractValidationResult {
  ok: boolean;
  errors: Array<{ path: string[]; message: string }>;
  warnings: Array<{ path: string[]; message: string }>;
  // Present for validate/save/get responses when the backend can parse EDN.
  contract?: AgentContract | null;
}

export interface ContractCompileResult {
  ok: boolean;
  contract: AgentContract;
  sql: {
    contract: Record<string, unknown>;
    "event-kinds": Array<Record<string, unknown>>;
    bindings: Array<Record<string, unknown>>;
    tools: Array<Record<string, unknown>>;
  };
  errors?: Array<{ path: string[]; message: string }>;
}

export interface ContractListItem {
  id: string;
  kind: string;
  version: number;
  enabled: boolean;
  ednHash: number;
  compiledAt: string | null;
  updatedAt: string;
}

export interface ContractListResponse {
  contracts: ContractListItem[];
}

export interface ContractGetResponse {
  contract: AgentContract;
  ednText: string;
  validation: ContractValidationResult;
}

export interface ContractSaveResponse {
  ok: boolean;
  contract: AgentContract;
  ednText: string;
  validation: ContractValidationResult;
}

// ── API functions ───────────────────────────────────────────────────────────

export async function listContracts(): Promise<ContractListResponse> {
  return request<ContractListResponse>("/api/admin/contracts");
}

export async function getContract(
  contractId: string,
): Promise<ContractGetResponse> {
  return request<ContractGetResponse>(
    `/api/admin/contracts/${encodeURIComponent(contractId)}`,
  );
}

export async function saveContract(
  contractId: string,
  ednText: string,
): Promise<ContractSaveResponse> {
  return request<ContractSaveResponse>(
    `/api/admin/contracts/${encodeURIComponent(contractId)}`,
    {
      method: "PUT",
      body: JSON.stringify({ ednText }),
    },
  );
}

export async function validateContract(
  ednText: string,
): Promise<ContractValidationResult> {
  return request<ContractValidationResult>(
    "/api/admin/contracts/validate",
    {
      method: "POST",
      body: JSON.stringify({ ednText }),
    },
  );
}

export async function compileContract(
  contractId: string,
): Promise<ContractCompileResult> {
  return request<ContractCompileResult>(
    `/api/admin/contracts/${encodeURIComponent(contractId)}/compile`,
    { method: "POST" },
  );
}

export async function copyContract(
  sourceId: string,
  newId: string,
): Promise<ContractSaveResponse> {
  return request<ContractSaveResponse>(
    `/api/admin/contracts/${encodeURIComponent(sourceId)}/copy`,
    {
      method: "POST",
      body: JSON.stringify({ newId }),
    },
  );
}

// ── Seed from event-agents ──────────────────────────────────────────────────

export interface SeedResult {
  seeded: string[];
  skipped: number;
  message: string;
}

/**
 * Bootstrap EDN contracts from event-agent jobs that don't already have contracts.
 * Returns the list of newly seeded contract IDs.
 */
export async function seedContractsFromEventAgents(): Promise<SeedResult> {
  const resp = await fetch("/api/admin/contracts/seed-from-event-agents", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
  const text = await resp.text();
  // Parse EDN response — it's a simple map, try JSON-like parsing
  // The backend returns pr-str output which is EDN
  try {
    // Try to extract the seeded vector and message from the EDN text
    const seededMatch = text.match(/:seeded\s+\[([^\]]*)\]/);
    const skippedMatch = text.match(/:skipped\s+(\d+)/);
    const messageMatch = text.match(/:message\s+"([^"]*)"/);
    const seeded = seededMatch?.[1]
      ? seededMatch[1]
          .split(/\s+/)
          .filter(Boolean)
          .map((s) => s.replace(/"/g, ""))
      : [];
    return {
      seeded,
      skipped: Number(skippedMatch?.[1] ?? 0),
      message: messageMatch?.[1] ?? text,
    };
  } catch {
    return { seeded: [], skipped: 0, message: text };
  }
}

// ── Contract Agent API (EDN-native) ──────────────────────────────────────────

/**
 * Read a contract as raw EDN text via the agent API.
 * Returns the raw EDN string (not wrapped in JSON).
 */
export async function agentGetContractEdn(
  contractId: string,
): Promise<string> {
  const resp = await fetch(
    `/api/agent/contracts/${encodeURIComponent(contractId)}`,
    { method: "GET", headers: { Accept: "text/plain" } },
  );
  return resp.text();
}

/**
 * Save a contract as raw EDN text via the agent API.
 * Accepts EDN text directly (not JSON-wrapped).
 */
export async function agentPutContractEdn(
  contractId: string,
  ednText: string,
): Promise<string> {
  const resp = await fetch(
    `/api/agent/contracts/${encodeURIComponent(contractId)}`,
    {
      method: "PUT",
      headers: { "Content-Type": "text/plain; charset=utf-8" },
      body: ednText,
    },
  );
  return resp.text();
}

// ── Default contract template ───────────────────────────────────────────────

export const DEFAULT_CONTRACT_EDN = `{:contract/id "new-agent"
 :contract/kind :agent
 :contract/version 1
 :enabled true
 :trigger-kind :event
 :source-kind :discord
 :source-mode :patrol
 :cadence-min 5

 :agent
 {:role :system_admin
  :model "glm-5"
  :thinking :off}

 :prompts
 {:system "Observe configured Discord channels, detect fresh human signals, and queue structured events without speaking publicly."
  :task   "Read recent channel messages, update freshness state, and dispatch normalized Discord events for worthy human signals."}

 :events
 {:always [:discord.mention]
  :maybe  [:discord.message :discord.reaction]}

 :data
 {:source  {:max-messages 25}
  :filters {:channels []
            :keywords []}
  :tools   []}

 :hooks
 {:before {}
  :after  {}}}
`;

// ── Event kind catalog ─────────────────────────────────────────────────────

export const EVENT_KIND_OPTIONS = [
  "discord.mention",
  "discord.message",
  "discord.message.keyword",
  "discord.message.mention",
  "discord.reaction",
  "discord.image-attachment",
  "discord.text-attachment",
  "github.issues.opened",
  "github.issues.closed",
  "github.pr.opened",
  "github.pr.merged",
  "github.push",
  "cron.tick",
  "manual.invoke",
];

export const MODEL_OPTIONS = [
  "glm-5",
  "glm-5-plus",
  "gpt-5.4",
  "gpt-5.4-mini",
  "claude-4-sonnet",
  "claude-4-opus",
  "kimi-k2.5",
];

export const ROLE_OPTIONS = [
  "system_admin",
  "knowledge_worker",
  "executive",
  "analyst",
  "editor",
  "contract_librarian",
];

export const TRIGGER_KIND_OPTIONS = ["event", "cron", "manual"] as const;
export const SOURCE_KIND_OPTIONS = [
  "discord",
  "github",
  "cron",
  "manual",
] as const;
export const THINKING_OPTIONS = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
] as const;

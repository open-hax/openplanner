import type { SdkMutable } from "./types.js";
import {
  parseModelMap as parsePolicyMap,
  resolveEmbeddingModel as resolvePolicyModel,
} from "@open-hax/openplanner-embedding-model-policy";

export type EmbeddingScope = Partial<SdkMutable<{
  readonly source: string;
  readonly kind: string;
  readonly project: string;
}>>;

export type EmbeddingModelConfig = SdkMutable<{
  readonly defaultModel: string;
  readonly bySource: Readonly<Record<string, string>>;
  readonly byKind: Readonly<Record<string, string>>;
  readonly byProject: Readonly<Record<string, string>>;
}>;

// Synchronous SDK bridge; policy and native JSON/property access live in CLJS.
export function parseModelMap(raw: string | undefined): Record<string, string> {
  return parsePolicyMap(raw);
}

export function resolveEmbeddingModel(config: EmbeddingModelConfig, scope: EmbeddingScope): string {
  return resolvePolicyModel(config, scope);
}

// Public DTOs stay writable; this is the existing SDK mutation boundary.
// eslint-disable-next-line functional/prefer-readonly-type -- SDK public mutation ABI; guarded by compile fixture.
export type SdkMutable<T> = { -readonly [Key in keyof T]: T[Key] };
export type SdkArray<T> = SdkMutable<readonly T[]>;

export type BlobRef = SdkMutable<{
  readonly blob: string; // sha256 hex
  readonly mime: string;
  readonly name?: string;
  readonly size?: number;
}>;

export type SourceRef = Partial<SdkMutable<{
  readonly project: string;
  readonly session: string;
  readonly message: string;
  readonly turn: string;
}>>;

export type EventEnvelopeV1 = SdkMutable<{
  readonly schema: "openplanner.event.v1";
  readonly schema_version?: number;
  readonly id: string;
  readonly ts: string; // ISO
  readonly source: string;
  readonly kind: string;
  readonly source_ref?: SourceRef;
  readonly text?: string;
  readonly attachments?: SdkArray<BlobRef>;
  readonly meta?: Record<string, unknown>;
  readonly extra?: Record<string, unknown>;
  readonly migration_state?: Record<string, unknown>;
}>;

export type EventIngestRequest = SdkMutable<{ readonly events: SdkArray<EventEnvelopeV1> }>;

export type SearchTier = "hot" | "compact" | "both";

export type DocumentKind = "docs" | "code" | "config" | "data";
export type DocumentVisibility = "internal" | "review" | "public" | "archived";

export type DocumentRecord = SdkMutable<{
  readonly id: string;
  readonly title: string;
  readonly content: string;
  readonly project: string;
  readonly kind: DocumentKind;
  readonly visibility: DocumentVisibility;
  readonly source?: string;
  readonly sourcePath?: string;
  readonly domain?: string;
  readonly language?: string;
  readonly createdBy?: string;
  readonly publishedBy?: string;
  readonly publishedAt?: string | null;
  readonly aiDrafted?: boolean;
  readonly aiModel?: string | null;
  readonly aiPromptHash?: string | null;
  readonly metadata?: Record<string, unknown>;
  readonly ts?: string;
}>;

export type DocumentUpsertRequest = SdkMutable<{
  readonly document: DocumentRecord;
}>;

export type DocumentPatchRequest = SdkMutable<{
  readonly title?: string;
  readonly content?: string;
  readonly visibility?: DocumentVisibility;
  readonly sourcePath?: string | null;
  readonly domain?: string | null;
  readonly language?: string | null;
  readonly publishedBy?: string | null;
  readonly publishedAt?: string | null;
  readonly metadata?: Record<string, unknown>;
}>;

export type FtsSearchRequest = SdkMutable<{
  readonly q: string;
  readonly limit?: number;
  readonly source?: string;
  readonly kind?: string;
  readonly project?: string;
  readonly session?: string;
  readonly visibility?: DocumentVisibility;
  readonly tier?: SearchTier;
  readonly quality?: "good" | "not_bad" | "any" | "good_then_not_bad";
  readonly output_quality?: "good" | "not_bad" | "any" | "good_then_not_bad";
}>;

export type VectorSearchRequest = SdkMutable<{
  readonly q: string;
  readonly k?: number;
  readonly source?: string;
  readonly kind?: string;
  readonly project?: string;
  readonly visibility?: DocumentVisibility;
  readonly where?: Record<string, unknown>;
  readonly tier?: SearchTier;
  readonly quality?: "good" | "not_bad" | "any" | "good_then_not_bad";
  readonly output_quality?: "good" | "not_bad" | "any" | "good_then_not_bad";
}>;

// Translation types

export type TranslationSegmentSource = "mt" | "human" | "import";
export type TranslationStatus = "pending" | "in_review" | "approved" | "rejected";

export type TranslationSegmentEvent = SdkMutable<{
  readonly schema: "openplanner.event.v1";
  readonly id: string;
  readonly ts: string;
  readonly source: TranslationSegmentSource;
  readonly kind: "translation.segment";
  readonly source_ref: SdkMutable<{
    readonly project: string;
    readonly document_id: string;
    readonly segment_index: number;
  }>;
  readonly text: string;
  readonly meta: SdkMutable<{
    readonly source_lang: string;
    readonly target_lang: string;
    readonly source_text: string;
    readonly mt_model?: string;
    readonly confidence?: number;
    readonly status: TranslationStatus;
  }>;
  readonly extra: SdkMutable<{
    readonly tenant_id: string;
    readonly org_id: string;
    readonly domain?: string;
    readonly content_type?: string;
    readonly url_context?: string;
  }>;
}>;

export type TranslationLabelEvent = SdkMutable<{
  readonly schema: "openplanner.event.v1";
  readonly id: string;
  readonly ts: string;
  readonly source: "shibboleth";
  readonly kind: "translation.label";
  readonly source_ref: SdkMutable<{
    readonly project: string;
    readonly segment_id: string;
    readonly document_id: string;
  }>;
  readonly meta: SdkMutable<{
    readonly labeler_id: string;
    readonly labeler_email: string;
    readonly label_version: number;
  }>;
  readonly extra: SdkMutable<{
    readonly tenant_id: string;
    readonly org_id: string;
    readonly adequacy: "excellent" | "good" | "adequate" | "poor" | "unusable";
    readonly fluency: "excellent" | "good" | "adequate" | "poor" | "unusable";
    readonly terminology: "correct" | "minor_errors" | "major_errors";
    readonly risk: "safe" | "sensitive" | "policy_violation";
    readonly overall: "approve" | "needs_edit" | "reject";
    readonly corrected_text?: string;
    readonly editor_notes?: string;
  }>;
}>;

export type TranslationSegmentResponse = SdkMutable<{
  readonly id: string;
  readonly source_text: string;
  readonly translated_text: string;
  readonly source_lang: string;
  readonly target_lang: string;
  readonly status: TranslationStatus;
  readonly confidence?: number;
  readonly mt_model?: string;
  readonly document_id: string;
  readonly segment_index: number;
  readonly domain?: string;
  readonly tenant_id: string;
  readonly org_id: string;
  readonly labels: SdkArray<TranslationLabelResponse>;
  readonly ts: string;
}>;

export type TranslationLabelResponse = SdkMutable<{
  readonly id: string;
  readonly segment_id: string;
  readonly labeler_id: string;
  readonly labeler_email: string;
  readonly adequacy: string;
  readonly fluency: string;
  readonly terminology: string;
  readonly risk: string;
  readonly overall: string;
  readonly corrected_text?: string;
  readonly editor_notes?: string;
  readonly ts: string;
}>;

export type TranslationSegmentListRequest = SdkMutable<{
  readonly project: string;
  readonly status?: TranslationStatus;
  readonly source_lang?: string;
  readonly target_lang?: string;
  readonly domain?: string;
  readonly limit?: number;
  readonly offset?: number;
}>;

export type TranslationLabelSubmitRequest = SdkMutable<{
  readonly adequacy: "excellent" | "good" | "adequate" | "poor" | "unusable";
  readonly fluency: "excellent" | "good" | "adequate" | "poor" | "unusable";
  readonly terminology: "correct" | "minor_errors" | "major_errors";
  readonly risk: "safe" | "sensitive" | "policy_violation";
  readonly overall: "approve" | "needs_edit" | "reject";
  readonly corrected_text?: string;
  readonly editor_notes?: string;
}>;

export type TranslationBatchImportRequest = SdkMutable<{
  readonly segments: SdkArray<SdkMutable<{
    readonly source_text: string;
    readonly translated_text: string;
    readonly source_lang: string;
    readonly target_lang: string;
    readonly document_id: string;
    readonly segment_index: number;
    readonly mt_model?: string;
    readonly confidence?: number;
    readonly domain?: string;
    readonly project?: string;
    readonly tenant_id?: string;
    readonly org_id?: string;
  }>>;
}>;

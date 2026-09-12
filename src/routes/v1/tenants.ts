/**
 * Tenants API — Native OpenPlanner implementation replacing Python km_labels.
 *
 * Stores tenant records in MongoDB collection `tenants`.
 * Stores tenant policies in MongoDB collection `tenant_policies`.
 *
 * Enhanced with status, isolation_mode, and policy management.
 */

import type { FastifyInstance } from "fastify";
import { createProtocols } from "../../lib/protocol-adapters.js";
import type { TenantStatus, IsolationMode } from "../../lib/tenant-types.js";

// ── Types ────────────────────────────────────────────────────────────

interface CreateTenantPayload {
  tenant_id: string;
  slug?: string;
  name: string;
  domains?: string[];
  config?: Record<string, unknown>;
  status?: TenantStatus;
  isolation_mode?: IsolationMode;
  owner_id?: string;
}

interface UpdateTenantPayload {
  name?: string;
  slug?: string;
  domains?: string[];
  config?: Record<string, unknown> | null;
  status?: TenantStatus;
  isolation_mode?: IsolationMode;
  model_profile_id?: string;
  policy_id?: string;
}

interface CreatePolicyPayload {
  tenant_id: string;
  retention_days?: number;
  review_threshold?: number;
  pii_rules?: {
    detect?: boolean;
    redact?: boolean;
    reject?: boolean;
  };
  translation_config?: {
    glossary_id?: string;
    default_target_langs?: string[];
  };
  rate_limits?: {
    requests_per_minute?: number;
    tokens_per_day?: number;
  };
}

function formatTenant(row: any) {
  return {
    tenant_id: row.tenant_id,
    slug: row.slug,
    name: row.name,
    status: row.status ?? "active",
    isolation_mode: row.isolation_mode ?? "shared",
    domains: row.domains ?? [],
    config: row.config ?? null,
    model_profile_id: row.model_profile_id,
    policy_id: row.policy_id,
    owner_id: row.owner_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

// ── Tenant Routes ───────────────────────────────────────────────────

export async function tenantsRoutes(app: FastifyInstance) {
  const protocols = createProtocols(app);

  // List all tenants
  app.get("/", async () => {
    const rows = await protocols.tenantManagement.listTenants();
    return rows.map(formatTenant);
  });

  // Get a tenant by ID
  app.get<{ Params: { tenant_id: string } }>("/:tenant_id", async (req, reply) => {
    const { tenant_id } = req.params;
    const row = await protocols.tenantManagement.getTenant(tenant_id);
    if (!row) return reply.code(404).send({ detail: "Tenant not found" });
    return formatTenant(row);
  });

  // Create a tenant
  app.post("/", async (req, reply) => {
    const payload = req.body as CreateTenantPayload;

    const existing = await protocols.tenantManagement.getTenant(payload.tenant_id);
    if (existing) {
      return reply.code(409).send({ detail: "Tenant already exists" });
    }

    const doc = await protocols.tenantManagement.createTenant({
      tenant_id: payload.tenant_id,
      slug: payload.slug ?? payload.tenant_id.toLowerCase().replace(/[^a-z0-9-]/g, "-"),
      name: payload.name,
      status: payload.status ?? "active",
      isolation_mode: payload.isolation_mode ?? "shared",
      domains: payload.domains ?? [],
      config: payload.config ?? {},
      owner_id: payload.owner_id,
    });

    return reply.code(201).send(formatTenant(doc));
  });

  // Update a tenant
  app.patch<{ Params: { tenant_id: string } }>("/:tenant_id", async (req, reply) => {
    const { tenant_id } = req.params;
    const payload = req.body as UpdateTenantPayload;

    const updates: Record<string, unknown> = {};
    if (payload.name !== undefined) updates.name = payload.name;
    if (payload.slug !== undefined) updates.slug = payload.slug;
    if (payload.domains !== undefined) updates.domains = payload.domains;
    if (payload.config !== undefined) updates.config = payload.config;
    if (payload.status !== undefined) updates.status = payload.status;
    if (payload.isolation_mode !== undefined) updates.isolation_mode = payload.isolation_mode;
    if (payload.model_profile_id !== undefined) updates.model_profile_id = payload.model_profile_id;
    if (payload.policy_id !== undefined) updates.policy_id = payload.policy_id;

    const result = await protocols.tenantManagement.updateTenant(tenant_id, updates);
    if (!result) return reply.code(404).send({ detail: "Tenant not found" });

    return formatTenant(result);
  });

  // Delete a tenant and all associated data
  app.delete<{ Params: { tenant_id: string } }>("/:tenant_id", async (req, reply) => {
    const { tenant_id } = req.params;
    const deleted = await protocols.tenantManagement.deleteTenant(tenant_id);
    if (!deleted) {
      return reply.code(404).send({ detail: "Tenant not found" });
    }
    return reply.code(204).send();
  });

  // ── Policy Routes ─────────────────────────────────────────────────

  // Get tenant policy
  app.get<{ Params: { tenant_id: string } }>("/:tenant_id/policy", async (req, reply) => {
    const { tenant_id } = req.params;
    const policy = await protocols.tenantManagement.getPolicy(tenant_id);
    if (!policy) return reply.code(404).send({ detail: "Policy not found" });

    return {
      tenant_id: policy.tenant_id,
      retention_days: policy.retention_days ?? 30,
      review_threshold: policy.review_threshold ?? 0.7,
      pii_rules: policy.pii_rules ?? { detect: true, redact: false, reject: false },
      translation_config: policy.translation_config,
      rate_limits: policy.rate_limits,
      created_at: policy.created_at,
      updated_at: policy.updated_at,
    };
  });

  // Create or update tenant policy
  app.put<{ Params: { tenant_id: string } }>("/:tenant_id/policy", async (req, reply) => {
    const { tenant_id } = req.params;
    const payload = req.body as CreatePolicyPayload;

    // Verify tenant exists
    const tenant = await protocols.tenantManagement.getTenant(tenant_id);
    if (!tenant) return reply.code(404).send({ detail: "Tenant not found" });

    const doc = await protocols.tenantManagement.setPolicy(tenant_id, {
      retention_days: payload.retention_days ?? 30,
      review_threshold: payload.review_threshold ?? 0.7,
      pii_rules: payload.pii_rules ?? { detect: true, redact: false, reject: false },
      translation_config: payload.translation_config,
      rate_limits: payload.rate_limits,
    });

    // Update tenant with policy reference
    await protocols.tenantManagement.updateTenant(tenant_id, { policy_id: tenant_id });

    return reply.code(200).send(doc);
  });
}

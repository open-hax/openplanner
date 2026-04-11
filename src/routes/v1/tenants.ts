/**
 * Tenants API — Native OpenPlanner implementation replacing Python km_labels.
 *
 * Stores tenant records in MongoDB collection `tenants`.
 * API shape matches the legacy Python /api/tenants contract.
 */

import type { FastifyInstance } from "fastify";

// ── Types ────────────────────────────────────────────────────────────

interface Tenant {
  tenant_id: string;
  name: string;
  domains: string[];
  config: Record<string, any> | null;
  created_at?: string;
}

interface CreateTenantPayload {
  tenant_id: string;
  name: string;
  domains?: string[];
  config?: Record<string, any>;
}

function tenantsCollection(app: FastifyInstance) {
  return app.mongo.db.collection("tenants");
}

// ── Routes ───────────────────────────────────────────────────────────

export async function tenantsRoutes(app: FastifyInstance) {
  // List all tenants
  app.get("/", async () => {
    const rows = await tenantsCollection(app)
      .find({})
      .sort({ created_at: -1 })
      .toArray();

    return rows.map((r) => ({
      tenant_id: r.tenant_id,
      name: r.name,
      domains: r.domains ?? [],
      config: r.config ?? null,
      created_at: r.created_at,
    }));
  });

  // Get a tenant by ID
  app.get<{ Params: { tenant_id: string } }>("/:tenant_id", async (req, reply) => {
    const { tenant_id } = req.params;
    const row = await tenantsCollection(app).findOne({ tenant_id });
    if (!row) return reply.code(404).send({ detail: "Tenant not found" });

    return {
      tenant_id: row.tenant_id,
      name: row.name,
      domains: row.domains ?? [],
      config: row.config ?? null,
      created_at: row.created_at,
    };
  });

  // Create a tenant
  app.post("/", async (req, reply) => {
    const payload = req.body as CreateTenantPayload;
    const now = new Date().toISOString();

    const existing = await tenantsCollection(app).findOne({ tenant_id: payload.tenant_id });
    if (existing) {
      return reply.code(409).send({ detail: "Tenant already exists" });
    }

    const doc = {
      tenant_id: payload.tenant_id,
      name: payload.name,
      domains: payload.domains ?? [],
      config: payload.config ?? {},
      created_at: now,
    };

    await tenantsCollection(app).insertOne(doc);

    return reply.code(201).send({
      tenant_id: payload.tenant_id,
      name: payload.name,
      domains: payload.domains ?? [],
      config: payload.config ?? null,
    });
  });

  // Delete a tenant and all associated labels
  app.delete<{ Params: { tenant_id: string } }>("/:tenant_id", async (req, reply) => {
    const { tenant_id } = req.params;

    // Delete labels first
    await app.mongo.db.collection("km_labels").deleteMany({ tenant_id });

    const result = await tenantsCollection(app).deleteOne({ tenant_id });
    if (result.deletedCount === 0) {
      return reply.code(404).send({ detail: "Tenant not found" });
    }

    return reply.code(204).send();
  });
}

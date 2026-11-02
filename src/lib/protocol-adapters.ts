/**
 * Protocol adapters for OpenPlanner routes.
 * 
 * These adapters wrap MongoDB (or REST) operations behind protocol interfaces,
 * allowing routes to delegate to protocols instead of direct DB access.
 * 
 * env var PROTOCOL_IMPL: "mongo" (default) | "rest"
 */

import type { FastifyInstance } from "fastify";

export interface EventAdmission {
  appendEvent(event: any): Promise<any>;
  appendEvents(events: any[]): Promise<any[]>;
  queryEvents(filter: any): Promise<any[]>;
}

export interface SessionManagement {
  createSession(opts: any): Promise<any>;
  getSession(sessionId: string): Promise<any>;
  updateSession(sessionId: string, updates: any): Promise<any>;
  closeSession(sessionId: string): Promise<void>;
  listSessions(opts: { project?: string; limit: number; offset: number }): Promise<{ rows: any[]; total: number }>;
  getSessionEvents(sessionId: string, opts: any): Promise<any[]>;
}

export interface TenantManagement {
  listTenants(): Promise<any[]>;
  getTenant(tenantId: string): Promise<any | null>;
  createTenant(tenant: any): Promise<any>;
  updateTenant(tenantId: string, updates: any): Promise<any | null>;
  deleteTenant(tenantId: string): Promise<boolean>;
  getPolicy(tenantId: string): Promise<any | null>;
  setPolicy(tenantId: string, policy: any): Promise<any>;
}

const PROTOCOL_IMPL = process.env.PROTOCOL_IMPL ?? "mongo";

// ── MongoDB Implementations ─────────────────────────────────────────

class MongoEventAdmission implements EventAdmission {
  constructor(private app: FastifyInstance) {}

  async appendEvent(event: any): Promise<any> {
    await this.app.mongo.events.insertOne(event);
    return event;
  }

  async appendEvents(events: any[]): Promise<any[]> {
    if (events.length > 0) {
      await this.app.mongo.events.insertMany(events);
    }
    return events;
  }

  async queryEvents(filter: any): Promise<any[]> {
    return this.app.mongo.events.find(filter).sort({ ts: -1 }).toArray();
  }
}

class MongoSessionManagement implements SessionManagement {
  constructor(private app: FastifyInstance) {}

  async createSession(opts: any): Promise<any> {
    const doc = { ...opts, kind: "session", createdAt: new Date(), updatedAt: new Date() };
    await this.app.mongo.events.insertOne(doc);
    return doc;
  }

  async getSession(sessionId: string): Promise<any> {
    return this.app.mongo.events.findOne({ session: sessionId, kind: "session" });
  }

  async updateSession(sessionId: string, updates: any): Promise<any> {
    await this.app.mongo.events.updateOne(
      { session: sessionId, kind: "session" },
      { $set: { ...updates, updatedAt: new Date() } }
    );
    return this.getSession(sessionId);
  }

  async closeSession(sessionId: string): Promise<void> {
    await this.app.mongo.events.deleteMany({ session: sessionId, kind: "session" });
  }

  async listSessions(opts: { project?: string; limit: number; offset: number }): Promise<{ rows: any[]; total: number }> {
    const match: Record<string, unknown> = { session: { $type: "string", $ne: "" } };
    if (opts.project) match.project = opts.project;

    const groupedStages = [
      { $match: match },
      {
        $group: {
          _id: { project: { $ifNull: ["$project", ""] }, session: { $ifNull: ["$session", ""] } },
          last_ts: { $max: "$ts" },
          event_count: { $sum: 1 },
        },
      },
      {
        $project: {
          _id: 0,
          project: "$_id.project",
          session: "$_id.session",
          last_ts: "$last_ts",
          event_count: "$event_count",
        },
      },
      { $sort: { last_ts: -1 } },
    ];

    const [rawRows, totalRows] = await Promise.all([
      this.app.mongo.events.aggregate([...groupedStages, { $skip: opts.offset }, { $limit: opts.limit }]).toArray(),
      this.app.mongo.events.aggregate([...groupedStages, { $count: "total" }]).toArray(),
    ]);

    const rows = rawRows.map((row: any) => ({
      ...row,
      last_ts: row.last_ts instanceof Date ? row.last_ts.toISOString() : row.last_ts,
      event_count: typeof row.event_count === "bigint" ? Number(row.event_count) : row.event_count,
    }));

    const total = Number(totalRows[0]?.total ?? 0);

    return { rows, total };
  }

  async getSessionEvents(sessionId: string, opts: any): Promise<any[]> {
    const filter: Record<string, unknown> = { session: sessionId };
    if (opts.project) filter.project = opts.project;
    if (opts.kind) filter.kind = opts.kind;

    let cursor = this.app.mongo.events.find(filter);
    if (opts.projection) cursor = cursor.project(opts.projection);
    return cursor
      .sort({ ts: opts.sort === "asc" ? 1 : -1 })
      .limit(opts.limit ?? 1000)
      .toArray();
  }
}

class MongoTenantManagement implements TenantManagement {
  constructor(private app: FastifyInstance) {}

  private collection() {
    return this.app.mongo.db.collection("tenants");
  }

  private policiesCollection() {
    return this.app.mongo.db.collection("tenant_policies");
  }

  async listTenants(): Promise<any[]> {
    return this.collection().find({}).sort({ created_at: -1 }).toArray();
  }

  async getTenant(tenantId: string): Promise<any | null> {
    return this.collection().findOne({ tenant_id: tenantId });
  }

  async createTenant(tenant: any): Promise<any> {
    const now = new Date().toISOString();
    const doc = {
      ...tenant,
      created_at: now,
      updated_at: now,
    };
    await this.collection().insertOne(doc);
    return doc;
  }

  async updateTenant(tenantId: string, updates: any): Promise<any | null> {
    const result = await this.collection().findOneAndUpdate(
      { tenant_id: tenantId },
      { $set: { ...updates, updated_at: new Date().toISOString() } },
      { returnDocument: "after" }
    );
    return result;
  }

  async deleteTenant(tenantId: string): Promise<boolean> {
    await this.app.mongo.db.collection("km_labels").deleteMany({ tenant_id: tenantId });
    await this.policiesCollection().deleteOne({ tenant_id: tenantId });
    const result = await this.collection().deleteOne({ tenant_id: tenantId });
    return result.deletedCount > 0;
  }

  async getPolicy(tenantId: string): Promise<any | null> {
    return this.policiesCollection().findOne({ tenant_id: tenantId });
  }

  async setPolicy(tenantId: string, policy: any): Promise<any> {
    const now = new Date();
    const doc = {
      tenant_id: tenantId,
      ...policy,
      created_at: now,
      updated_at: now,
    };
    await this.policiesCollection().updateOne(
      { tenant_id: tenantId },
      { $set: doc },
      { upsert: true }
    );
    return doc;
  }
}

// ── Factory ─────────────────────────────────────────────────────────

export function createProtocols(app: FastifyInstance) {
  if (PROTOCOL_IMPL === "rest") {
    throw new Error("REST protocol implementation not yet available");
  }

  return {
    eventAdmission: new MongoEventAdmission(app),
    sessionManagement: new MongoSessionManagement(app),
    tenantManagement: new MongoTenantManagement(app),
  };
}

export type Protocols = ReturnType<typeof createProtocols>;

// Moved to the SDK package (detached from Fastify). This shim preserves the
// route-facing createProtocols(app) signature over the SDK's ProtocolContext.
import type { FastifyInstance } from "fastify";
import { createProtocols as createSdkProtocols } from "@open-hax/openplanner-sdk/protocol-adapters";

export type {
  EventAdmission,
  SessionManagement,
  TenantManagement,
  ProtocolContext,
  Protocols,
} from "@open-hax/openplanner-sdk/protocol-adapters";

export function createProtocols(app: FastifyInstance) {
  return createSdkProtocols({ mongo: app.mongo });
}

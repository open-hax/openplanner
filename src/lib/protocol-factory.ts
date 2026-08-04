/**
 * Protocol factory for OpenPlanner routes.
 * 
 * Creates protocol implementations based on PROTOCOL_IMPL env var:
 * - "mongo" (default): Uses MongoDB-backed protocol records
 * - "rest": Uses REST API-backed protocol records
 * 
 * The protocols are defined in packages/openplanner-protocols/ and compiled
 * by shadow-cljs to packages/openplanner-protocols/dist/
 */

// Lazy-loaded protocol modules
let protocolModule: any = null;

function getProtocols() {
  if (!protocolModule) {
    // Load the compiled CLJS module
    protocolModule = require("../../packages/openplanner-protocols/dist/main.js");
  }
  return protocolModule;
}

const PROTOCOL_IMPL = process.env.PROTOCOL_IMPL ?? "mongo";

export function createEventAdmission(db: any) {
  const protos = getProtocols();
  if (PROTOCOL_IMPL === "rest") {
    const baseUrl = process.env.OPENPLANNER_REST_URL ?? "http://localhost:3000";
    const authToken = process.env.OPENPLANNER_AUTH_TOKEN;
    return new protos.promethean.records.rest.event_admission.RestEventAdmission(baseUrl, authToken);
  }
  // Mongo (default)
  return new protos.promethean.records.mongo.event_admission.MongoEventAdmission(db);
}

export function createSessionManagement(db: any) {
  const protos = getProtocols();
  if (PROTOCOL_IMPL === "rest") {
    const baseUrl = process.env.OPENPLANNER_REST_URL ?? "http://localhost:3000";
    const authToken = process.env.OPENPLANNER_AUTH_TOKEN;
    return new protos.promethean.records.rest.session_management.RestSessionManagement(baseUrl, authToken);
  }
  // Mongo (default)
  return new protos.promethean.records.mongo.session_management.MongoSessionManagement(db);
}

export function createDocumentStorage(db: any, collectionName: string) {
  const protos = getProtocols();
  return new protos.promethean.records.mongo.document_storage.MongoDocumentStorage(db, collectionName);
}

export function createUserManagement(db: any) {
  const protos = getProtocols();
  if (PROTOCOL_IMPL === "rest") {
    const baseUrl = process.env.OPENPLANNER_REST_URL ?? "http://localhost:3000";
    const authToken = process.env.OPENPLANNER_AUTH_TOKEN;
    return new protos.promethean.records.rest.user_management.RestUserManagement(baseUrl, authToken);
  }
  return new protos.promethean.records.mongo.user_management.MongoUserManagement(db);
}

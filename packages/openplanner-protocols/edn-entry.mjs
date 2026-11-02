// Re-export from compiled CLJS
// This file bridges the shadow-cljs compiled output to standard ESM exports

import "./dist/main.js";

// The CLJS namespace promethean.records.edn.event-admission is loaded by the entry module.
// Access it through the global scope that shadow-cljs uses.
const mod = globalThis.promethean?.records?.edn?.event_admission;

export function createEdnEventAdmission(ledgerDir) {
  if (!mod) throw new Error("EdnFileEventAdmission not loaded — ensure dist/main.js is imported first");
  return mod["create-edn-event-admission"](ledgerDir);
}

export { createEdnEventAdmission as default };

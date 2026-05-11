# @open-hax/openplanner-document-hydration

ClojureScript pure transformation and cache protocol package for OpenPlanner document hydration.

This package owns the transformation boundary between MongoDB event rows and HTTP document responses:

- detect redacted source/document rows
- derive source refs and cache keys
- merge rehydrated source text back into rows
- convert rows to the public document API shape
- expose cache protocol wrappers for JS callers
- provide memory LRU, Redis-client, LMDB-handle, and layered cache implementations

I/O remains outside this package. Callers fetch source text from filesystem/URL/etc, then pass it into `hydrateDocumentRow`. Redis and LMDB drivers wrap caller-owned clients/handles so connection lifecycle stays at the application edge.

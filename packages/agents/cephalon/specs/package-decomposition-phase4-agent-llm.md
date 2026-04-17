# Package Decomposition Phase 4 — Extract Agent LLM

**Parent:** `package-decomposition-roadmap.md`
**Story Points:** 2
**Status:** todo

## Goal

Extract LLM providers and context assembly into `@promethean-os/agent-llm`.

## Scope

### In Scope
- Create `@promethean-os/agent-llm` package
- Move TS `llm/provider.ts`, `context/assembler.ts`
- Move CLJS `llm/openai.cljs`
- Define unified LLM provider interface

### Out of Scope
- Tool executor (depends on tools)
- Tool registry

## Tasks

- [ ] Create `packages/agent-llm/`
- [ ] Move TS provider and context files
- [ ] Move CLJS OpenAI client
- [ ] Define `LLMProvider` interface/protocol
- [ ] Export Ollama/OpenAI implementations
- [ ] Update imports in `cephalon-ts` and `cephalon-cljs`
- [ ] Add provider tests

## Acceptance Criteria

- [ ] `@promethean-os/agent-llm` exists with interface
- [ ] Ollama and OpenAI implementations available
- [ ] Context assembler available
- [ ] Provider tests pass

## Dependencies

- Phase 3 (agent-memory) — context assembler may use memory

## Blocking

- Blocks tool executor (needs LLM provider)

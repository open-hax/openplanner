# Package Decomposition Phase 2 — Extract Discord Adapter

**Parent:** `package-decomposition-roadmap.md`
**Story Points:** 3
**Status:** todo

## Goal

Extract Discord gateway integration into a dedicated adapter package.

## Scope

### In Scope
- Create `@promethean-os/discord-bot-adapter` package
- Move TS `discord/integration.ts` and `discord/api-client.ts`
- Move CLJS `adapters/discord.cljs`
- Consolidate normalization logic

### Out of Scope
- Discord tools (Phase 5)
- Bot personalities (Phase 1)
- IRC adapter

## Tasks

- [ ] Create `packages/discord-bot-adapter/`
- [ ] Move `cephalon-ts/src/discord/*` to new package
- [ ] Move `cephalon-cljs/src/promethean/adapters/discord.cljs`
- [ ] Move `normalization/discord-message.ts` and `discord_message.cljs`
- [ ] Export unified adapter interface
- [ ] Update imports in `cephalon-ts` and `cephalon-cljs`
- [ ] Add integration tests

## Acceptance Criteria

- [ ] `@promethean-os/discord-bot-adapter` exists and exports adapter
- [ ] TS and CLJS implementations consolidated or co-located
- [ ] `cephalon-ts` imports adapter from new package
- [ ] Discord integration tests pass

## Dependencies

- Phase 0 (CLJS canonical establishment)

## Blocking

- Blocks Discord tools extraction (Phase 5)

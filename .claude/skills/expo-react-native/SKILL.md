---
name: expo-react-native
description: Use when modifying Expo / React Native code or configuration in apps/partner-agent-frontend, especially routing and platform-specific modules.
---

# Expo / React Native Development (apps/partner-agent-frontend)

This repo's frontend is a monorepo workspace at `apps/partner-agent-frontend`; documentation lookup follows its [AGENTS.md](../../../apps/partner-agent-frontend/AGENTS.md). Check `package.json` when changing dependencies; the current stack uses Expo SDK 57, React Native 0.86.3, and React 19.2.3.

## Stack facts (verified in app.json / package.json)

- Router: `expo-router` v57 (file-based routing, `typedRoutes` + `reactCompiler` experiments enabled).
- State: `zustand` v5. Stores live in `src/features/<feature>/`.
- Streaming: `socket.io-client` for chat, wired through `src/api/agent-stream.ts`.
- Auth/secure storage: `expo-secure-store`, token core split by platform (see below).
- Theming: `src/theme/{colors,typography,spacing}` — import from there, do not hardcode values.
- UI primitives: `src/components/ui/` (app-button, app-header, app-icon, feedback-state, status-badge).
- Commands, run from `apps/partner-agent-frontend/`:
  - Type check / build: `npm run build` (tsc --noEmit)
  - Lint: `npm run lint`
  - Test: `npm run test` (vitest run)
  - Dev: `npx expo start` (add `--web`, `--ios`, `--android` for a specific target)

## Routing

Routes are files under `src/app/`. The root `_layout.tsx` handles authentication navigation, owns the `Stack`, and mounts `FloatingNavigation` from `src/components/navigation/floating-menu.tsx`.

- Add screens under `src/app/`; inspect `floating-menu.tsx` when adding a navigation entry. The current `(tabs)/_layout.tsx` hides the tab bar with `display: 'none'`.
- New routes use generated types (`typedRoutes`). Refresh declarations through Expo CLI, for example with `npx expo start`, before checking new route references. `tsc --noEmit` checks types but does not generate Expo route declarations; do not hide missing declarations with casts.

## Platform split files

Several modules use React Native's platform-extension resolution (`token-storage.native.ts` / `.web.ts`, `refresh-credential.native.ts` / `refresh-credential.web.ts`). When a behavior differs across platforms:

- Split the file into `<name>.native.ts`, `<name>.web.ts` — and only add `<name>.ios.ts` / `<name>.android.ts` when iOS and Android genuinely diverge.
- Keep a shared `token-storage-core.ts` for logic both platforms use, and re-export from a base `<name>.ts` if an import needs a default target.
- Verify the split file is actually resolvable for the active platform before assuming it took effect.

## Types & conventions

- No `any` unless strictly necessary.
- Top-level imports only; `tsconfig.json` maps `@/*` to `src/*`.

## Always verify before claiming done

- Choose checks that cover the change: run `npm run build` for TypeScript changes; run affected tests for logic or test changes (for example `npm run test -- src/api/server-url.spec.ts`). Broaden to the frontend suite when shared behavior is affected. Verify UI or platform changes on the affected surface; report any unverified platform explicitly. Documentation-only edits need content and link checks. Do not report verification you did not run.
- Env vars / API config live in `src/api/config.ts` — check there before assuming a base URL or a missing endpoint is a bug in the component.

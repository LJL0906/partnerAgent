---
name: expo-react-native
description: Workflow for the Expo / React Native app at apps/partner-agent-frontend. Covers version-locked docs, expo-router file routing, platform split files, the SDK 57 stack, and the verify-before-claiming rule. Use for any frontend, mobile, or Expo/RN task in this repo.
---

# Expo / React Native Development (apps/partner-agent-frontend)

This repo's frontend is a monorepo workspace at `apps/partner-agent-frontend`. Root convention in that app's `AGENTS.md` is a hard rule:

> **Expo HAS CHANGED. Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing any code.**

The stack is pinned to Expo SDK 57, React Native 0.86.3, React 19.2.3. Do not copy patterns from older tutorials or from memory — APIs drift across SDK majors. Check the versioned page for anything you touch.

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

Routes are files under `src/app/`. The root `_layout.tsx` owns auth gating and the `Stack`; `(tabs)/_layout.tsx` owns the tab bar.

- Adding a screen = adding a file under `src/app/`. Adding a tab = adding a `Tabs.Screen` in `(tabs)/_layout.tsx`.
- New routes are typed (typedRoutes experiment) — after adding a route the generated types update on next `expo start` / `tsc`. Type errors on `router.push('/new-route')` until then are expected; do not work around them with casts.
- `href: null` in a `Tabs.Screen` hides a tab from the bar while keeping the file routable (a pattern already used for `today`, `execute`, `memory`).

## Platform split files

Several modules use React Native's platform-extension resolution (`token-storage.native.ts` / `.web.ts`, `refresh-credential.native.ts` / `refresh-credential.web.ts`). When a behavior differs across platforms:

- Split the file into `<name>.native.ts`, `<name>.web.ts` — and only add `<name>.ios.ts` / `<name>.android.ts` when iOS and Android genuinely diverge.
- Keep a shared `token-storage-core.ts` for logic both platforms use, and re-export from a base `<name>.ts` if an import needs a default target.
- Verify the split file is actually resolvable for the active platform before assuming it took effect.

## Types & conventions

- No `any` unless strictly necessary.
- Top-level imports only; `tsconfig.json` maps `@/*` to `src/*`.

## Always verify before claiming done

- After any change that touches code: run type check (`npm run build`) and, if you modified tests or logic, `npm run test`. Do not report a change as verified unless you ran the check that covers it.
- Env vars / API config live in `src/api/config.ts` — check there before assuming a base URL or a missing endpoint is a bug in the component.

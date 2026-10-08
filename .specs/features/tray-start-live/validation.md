# tray-start-live Validation

**Date**: 2026-10-07
**Spec**: `.specs/features/tray-start-live/spec.md`
**Diff range**: `4c6c234..HEAD` (HEAD = 3716e06), `src` and `src-tauri/src`
**Verifier**: independent sub-agent (author != verifier)
**Verdict**: PASS (implementation matches spec by code reading; no behavioral bug found). Coverage caveat: the whole frontend tray flow is code-only, with no automated test. There is no tasks.md for this feature, so Task Completion is N/A.

---

## Gate Check

| Gate | Result |
| --- | --- |
| `npx tsc --noEmit` | exit 0 |
| `npm run lint` | exit 0 |
| `npm test` | 15 files, 52 passed, 0 failed, 0 skipped |
| `cargo test --lib menu_` (src-tauri) | 3 passed, 0 failed (6 other lib tests filtered out) |

New tests in this feature: 2 TS (`src/lib/trayLive.test.ts`) + 3 Rust (`src-tauri/src/lib.rs:253-282`). No existing test was removed or weakened (diff touches no existing test).

## Discrimination Sensor (lightweight, in-place mutation, reverted via `git checkout --`)

| # | File:line | Mutation | Result |
| --- | --- | --- | --- |
| 1 | `src-tauri/src/lib.rs:72` | `if sharing` flipped to `if !sharing` | Killed (3/3 menu_ tests fail) |
| 2 | `src-tauri/src/lib.rs:77` | dropped `entries.push(CopyCode)` | Killed (2 fail) |
| 3 | `src-tauri/src/lib.rs:75` | `room_active \|\| sharing` changed to `sharing` | Killed (menu_with_room_offers_start_and_copy fails) |
| 4 | `src/lib/trayLive.ts:2` | link gets `?name=x` appended | Killed (2/2 fail) |

Result: 4/4 killed. Working tree clean afterwards (`git status --short` empty). The `room_active=false, sharing=true` branch (the `|| sharing` half) has no dedicated test. It is unreachable in practice.

---

## Spec-Anchored Acceptance Criteria

"Test" = automated test asserting the spec outcome. "Code-only" = implemented, no automated test (no component test infra).

| Req | AC | Spec outcome | Evidence | Coverage | Result |
| --- | --- | --- | --- | --- | --- |
| TRAYLIVE-01 | Start, no room: create room with saved name, enter, open picker | `createRoom(displayName())`, `adoptSession`, picker | `src/App.tsx:111-117` (`createRoom(displayName())` then `adoptSession(next); setTrayStartRequest(true)`), `src/screens/RoomScreen.tsx:123-128` (`setPickerOpen(true)`) | Code-only | PASS |
| TRAYLIVE-02 | Start, room active: keep room, open picker | no `createRoom` | `src/App.tsx:107-110` (`if (sessionRef.current) { setTrayStartRequest(true); return; }`) | Code-only | PASS |
| TRAYLIVE-03 | Start shows and focuses window | `show()` + `set_focus()` | `src-tauri/src/lib.rs:180-186` (before the emit) | Code-only (Rust, no test) | PASS |
| TRAYLIVE-04 | Link copied after live starts | `telinha://join/CODE` after `startShare` | `src/screens/RoomScreen.tsx:442-446` (`fromTray` read before `await startShare`, then `copyWithToast(inviteLink(session.code))`). `startShare` throws on failure (`useTelinhaRoom.ts:686-690`), so no copy on failed start. Format: `src/lib/trayLive.test.ts:6` `expect(inviteLink("AB23CD")).toBe("telinha://join/AB23CD")` | Link format: test. Timing and wiring: code-only | PASS |
| TRAYLIVE-05 | Toast on copy | "Link copiado" toast | `RoomScreen.tsx:341-344` (`pushToast("copied", ...)`) and `ToastStack` fallback render (`:832-840`) | Code-only | PASS |
| TRAYLIVE-06 | Cancel keeps room, no copy or toast | picker cancel resets flag, no copy | `RoomScreen.tsx:118-120` (reset when `!pickerOpen`), `:440` (`onCancel` only closes picker). The copy lives only in `onShare`. | Code-only | PASS |
| TRAYLIVE-07 | Room creation fails: home screen with error, no picker | `setJoinError(err.message)`, no request | `App.tsx:119` (`.catch(... setJoinError(err.message))`); `setTrayStartRequest(true)` is only in the success branch; `HomeScreen error={joinError}` at `App.tsx:394` | Code-only | PASS (message is the server's `err.message`; HomeScreen's own fallback "Não foi possível criar a sala." applies only to non-Error throws, which is minor) |
| TRAYLIVE-08 | Ignore duplicate while creating | no second room | `App.tsx:106` (`trayCreatingRef.current` guard), set at `:111`, reset in `.finally` at `:120-122` | Code-only | PASS |
| TRAYLIVE-09 | Menu items per state | 3 layouts | `lib.rs:71-82` (`tray_layout`). Tests: `lib.rs:258-263` `assert_eq!(tray_layout(false,false), vec![StartLive,Separator,Show,Quit])`; `:266-271` `tray_layout(true,false)`; `:274-279` `tray_layout(true,true) == [StopLive,CopyLink,CopyCode,Separator,Show,Quit]`. Order matches the spec | Test (layout). Labels and ids at `lib.rs:58-67` are unasserted. | PASS |
| TRAYLIVE-10 | Menu refresh on live, room, restored session | `set_tray_state` on `session` / `isSharing` change | `App.tsx:92-95` (effect on `[session, isSharing]`). `setIsSharing(false)` on leave at `App.tsx:76`. `isSharing` comes from `RoomScreen.tsx:87-89`. A restored session goes through `adoptSession` and then the effect. Arg `roomActive` is camelCase for Rust `room_active` (`lib.rs:103`); Tauri 2 converts args by default | Code-only | PASS (runtime invoke naming not exercised) |
| TRAYLIVE-11 | Show and Quit preserved | present in every layout, handlers intact | `lib.rs:79` (every layout ends with `Separator, Show, Quit`), tests above; handlers `lib.rs:172-178` unchanged | Test (layout) | PASS |
| TRAYLIVE-12 | Copy link, uses current code | `inviteLink(codeRef.current)` | `RoomScreen.tsx:353`. `codeRef` is refreshed on every render (`:112-116`), so no stale value. `lib.rs:190` emits | Link format: test. Handler: code-only | PASS |
| TRAYLIVE-13 | Copy code only | `codeRef.current` | `RoomScreen.tsx:354`, `lib.rs:193` | Code-only | PASS |
| TRAYLIVE-14 | Copy does not show window, with toast | no `show()` in copy arms | `lib.rs:190-195` (emit only), toast via `copyWithToast` | Code-only | PASS (toast is visible only if the window is already visible, as the spec allows) |
| TRAYLIVE-15 | Clipboard fails in both | error toast, room untouched | `RoomScreen.tsx:328-339` (invoke, fallback `navigator.clipboard`, `false`), `:343` (`"copy-failed"`, "Não foi possível copiar"). Style `App.css` `.room-toast.copy-failed` | Code-only | PASS |
| TRAYLIVE-16 | Stop from tray: stops, keeps room, no window | `stopShareRef.current()` if sharing | `RoomScreen.tsx:355-359`, `lib.rs:187-189` (no show). Menu returns to Start via TRAYLIVE-10 | Code-only | PASS |
| TRAYLIVE-17 | Edge: already sharing / required update blocks | no picker, no room | `App.tsx:106` (`isSharingRef` / `updateRequiredRef` guards), `RoomScreen.tsx:125` (`if (isSharingRef.current) return`) | Code-only | PASS |

Other edge cases: `pendingInvite` stays displayed (`inviteBanner` is rendered independently, `App.tsx:366`). Hidden window: `lib.rs:181-184` shows it before the emit. Rapid trigger: same as TRAYLIVE-08.

**Status**: all ACs implemented. Only the menu layout (09, 11) and the link format (04, 12) have automated tests. Roughly 14 of 17 requirements are code-only.

---

## Behavioral risk review (no real bug found)

- **trayStartRef reset on cancel**: the `[pickerOpen]` effect resets the ref only when the picker closes. `onShare` reads `trayStartRef.current` synchronously at the start, before any close, so the cancel race does not apply. On a mount with an immediate request, effects run in order (reset first at `:118`, then set at `:123`), so the set wins.
- **Stale closures**: handlers use refs (`codeRef`, `isSharingRef`, `stopShareRef`, `copyWithToastRef`) refreshed each render. `sessionRef` and `isSharingRef` in App are refreshed by effects.
- **Toast while the picker is shown**: toast state lives in `RoomScreen`, which stays mounted. The toast is queued before `setPickerOpen(false)` and stays visible for roughly 3s afterwards (the timer starts at push, effectively at close). A `tray-copy-*` event while the picker is open would be mostly invisible, because the 3s timer runs while the toast is not rendered. This is minor and low probability.
- **Handler registration after `set_menu`**: `on_menu_event` is registered on the tray builder (`lib.rs:172`). Menu items use stable ids. It is plausible that this survives `tray.set_menu` in Tauri 2. **Not verified at runtime**; this is the single biggest unverified assumption (needs a manual UAT).
- **Duplicate pickers**: if the user opened the picker manually and then triggers Start, `trayStartRef=true` makes the link get copied too. This is harmless.
- **Manual create racing a tray create**: Home "Create" while `trayCreatingRef` is in flight could adopt two sessions. Edge of an edge, not in the spec.

---

## Code Quality

| Principle | Status |
| --- | --- |
| Minimum code / no scope creep | OK (the `PredefinedMenuItem` separator and `TrayEntry` enum exist for testability) |
| Surgical changes, matches patterns | OK (reuses `copy_to_clipboard` + `navigator.clipboard` fallback, the toast stack and the `RoomToast` kind) |
| Spec-anchored outcome check | OK for the tested items. The remaining ACs are code-only, flagged above |
| Every test maps to a spec requirement | OK (5 new tests all map to 04, 09, 11, 12) |
| Documented guidelines | none, strong defaults applied |

---

## Requirement Traceability Update

| Requirement | New Status |
| --- | --- |
| TRAYLIVE-01..17 | Verified by code review (09, 11 and the link-format part of 04/12 also by test). Runtime UAT still recommended: 03, 10, 14, 16, and the `set_menu` plus menu-event wiring |

## Summary

**Overall**: PASS. **Gate**: 52 TS + 3 Rust passed, tsc and lint clean. **Sensor**: 4/4 killed.

**Coverage gaps (no fix required to pass)**:
1. App.tsx / RoomScreen.tsx tray flow (01-08, 10, 12-17) has zero automated tests. Extracting the decision logic into pure functions, or adding a component test harness, would allow assertions.
2. The `room_active=false, sharing=true` layout case, the tray menu event-to-emit mapping (ids and event names), and the labels (`id_and_label`) are untested.
3. The `set_tray_state` camelCase-to-snake_case invoke and the handler survival after `set_menu` are unverified at runtime.

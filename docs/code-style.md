# Parking Finder Code Style Guide

## 1. Formatting

Prettier is our formatter.

- Format code before committing.
- Follow the Prettier output instead of hand-formatting debates.
- Use normal TypeScript and React Native style with semicolons and single quotes.

## 2. File Roles

Files should have a clear main job.

- Screens: own screen flow, wire hooks together, and connect UI to actions.
- Components: render focused pieces of UI such as cards, modals, buttons, and overlays.
- Hooks: handle state, subscriptions, side effects, and shared app behavior.
- Services: handle Firebase and Firestore reads and writes.
- Utils: hold shared helper functions.
- Types: hold shared types and storage keys.

This is a guide, not a hard wall. Small amounts of nearby logic are fine if they keep the code easier to follow.

## 3. Naming

Use names that explain what something is or does.

- Prefer `selectedMarker` over `item`.
- Prefer `userLocation` over `loc`.
- Prefer `isLoading` and `hasPermission` for booleans.
- Prefer action names like `createParkingReport`, `markReportTaken`, and `reopenReport`.

Short names are fine when the meaning is obvious in a very small scope.

## 4. Functions

Prefer functions that are easy to scan.

- Keep functions focused when practical.
- Use early returns when they make code easier to read.
- If a function becomes hard to follow, split it up.
- If a function has side effects, make that clear in the name, comments, or surrounding code.

## 5. Shared Logic

When logic is reused, large, or hard to read inline, move it to a better place.

- Move reusable side effects into hooks.
- Move database access into services.
- Move repeated calculations into utils.
- Keep one-off screen flow in the screen if that is the clearest place for it.

## 6. Constants

Avoid unexplained numbers and strings.

- Use named constants for important values like distances, timers, and limits.
- Keep constants close to the code that uses them unless they are shared.

## 7. Components

Components should stay readable and focused on UI behavior.

- It is fine for a component to contain light UI logic.
- It is fine for a screen component to coordinate app flow.
- If a component grows too large or handles too many concerns, split it.

## 8. Error Handling

Do not ignore errors.

- Show user-friendly feedback for expected failures.
- Log unexpected failures so they can be debugged.
- Do not leave empty `catch` blocks.

## 9. Comments

Use comments when they help a future reader.

- Explain intent, assumptions, or why something is done a certain way.
- Avoid comments that only repeat the code.
- Keep comments short and practical.

## 10. General Rule

Prefer clarity over cleverness.

When updating code:

- keep the existing style consistent
- improve readability when touching messy code
- choose the simpler approach unless there is a clear reason not to

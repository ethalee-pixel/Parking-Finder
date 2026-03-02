# Parking Finder Code Style Guide

This document defines the coding standards for Parking Finder.

The goal of this guide is consistency, readability, and maintainability across the codebase.  
Code should be easy for any team member to understand, modify, and debug without needing the original author.

This guide applies to all TypeScript, TSX (React Native), and Firebase-related code.

---

## 1. Guiding Principles

We optimize for long-term maintainability rather than short-term speed.

Code should be:

- easy to read
- easy to modify
- predictable
- safe to refactor

Prefer clarity over cleverness.

---

## 2. Formatting

Formatting is automated and not debated.

We use **Prettier**.

### Required settings

- 2 space indentation
- semicolons enabled
- single quotes
- trailing commas allowed
- 100 character line width

All code should be formatted before committing.

---

## 3. File Organization

Each file should have a clear purpose.

| File Type       | Responsibility                         |
| --------------- | -------------------------------------- |
| Screen          | Page layout and high-level UI flow     |
| Component       | Reusable UI element                    |
| Hook            | State, subscriptions, and side effects |
| Firebase module | Database access                        |
| Utility         | Pure helper functions                  |
| Types           | Shared data models                     |

### Rules

- A file should not mix UI and database logic
- Firestore queries must not exist inside UI components
- Shared logic should move to hooks or utilities

---

## 4. Naming

Good naming is required. Code should be understandable without external explanation.

### Variables

Use descriptive names that reflect meaning.

Bad:

```
data
val
thing
flag
temp
```

Good:

```
selectedReport
userLocation
reportDurationSeconds
hasLocationPermission
```

### Boolean Variables

Must read naturally in an `if` statement.

```
isLoading
hasPermission
canDeleteReport
shouldCenterMap
```

Avoid abbreviations and generic terms.

---

### Functions

Functions must be named after what they do.

Good:

```
createParkingReport
deleteParkingReport
markReportTaken
subscribeToParkingReports
calculateDistanceMeters
```

Bad:

```
handleData
processReport
update
runLogic
```

---

## 5. Functions

### Size

Functions should be small and focused.

A function should perform a single task.  
If it performs multiple logical operations, it should be split.

### Structure

Prefer early returns to nested conditionals.

Bad:

```
if (user) {
  if (location) {
    ...
  }
}
```

Good:

```
if (!user) return;
if (!location) return;
```

### Side Effects

Functions should not secretly change state, show alerts, or write to the database unless their name clearly indicates it.

---

## 6. Duplication

Duplicated code must be removed.

If similar logic appears in multiple places:

- extract a function
- create a hook
- move to a utility module

Copy-paste is not allowed as a long-term solution.

---

## 7. Constants

Avoid unexplained numbers or strings.

Bad:

```
if (distance < 50)
```

Good:

```
const ARRIVAL_DISTANCE_METERS = 50;
if (distance < ARRIVAL_DISTANCE_METERS)
```

Constants should be named after their purpose.

---

## 8. React Native Components

Components should focus on rendering.

Components may:

- display data
- receive props
- emit events

Components should not:

- query Firestore
- manage subscriptions
- perform heavy calculations

Large components should be split into smaller components.

---

## 9. Hooks

Hooks handle stateful logic and external interactions.

Hooks should:

- subscribe to data
- manage side effects
- expose simple values to UI

Standard pattern:

```
const { reports, loading, error } = useParkingReports();
```

All subscriptions must be cleaned up when a component unmounts.

---

## 10. Firestore Access

All database operations must exist in a Firebase module (e.g., `parkingReports.ts`).

UI code must never directly interact with Firestore collections.

Reasons:

- centralized validation
- easier debugging
- consistent behavior
- safer refactoring

All Firestore functions should be action-oriented:

```
createParkingReport
deleteParkingReport
markReportTaken
subscribeToMyParkingReports
```

---

## 11. Error Handling

Errors must never be silently ignored.

Expected failures:
→ show user feedback

Unexpected failures:
→ log to console

Empty catch blocks are prohibited.

---

## 12. Comments

Comments should explain intent, not restate code.

Avoid:

```
i++; // increment i
```

Prefer comments only when necessary to explain reasoning, assumptions, or non-obvious behavior.

---

## 13. Layout and Readability

Code should be visually organized.

Rules:

- separate logical sections with blank lines
- avoid long functions
- avoid dense blocks of code
- keep related logic together

Variables should be declared close to where they are used.

---

## 14. Refactoring

Improving code clarity is part of normal development.

Refactor when:

- a function becomes long
- naming is unclear
- duplication appears
- nested conditionals grow

Working code is not considered finished if it is difficult to understand.

---

## 15. Code Reviews

During review, check for:

- readability
- clear naming
- duplication
- separation of concerns
- safe error handling

Reviews are not for style preference; they are for maintainability and correctness.

---

## 16. Final Rule

Code is written for other developers first and the computer second.

Any team member should be able to open a file and quickly determine:

- what the code does
- why it exists
- how to modify it safely

If this is not possible, the code should be simplified.

---

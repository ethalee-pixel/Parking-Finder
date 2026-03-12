# ParkingFinder

ParkingFinder is a real-time community parking availability app built with React Native (Expo) and Firebase.
Users report open spots on a live map, and other users can mark them as taken when they arrive.

## Current Feature Set

- Email/password authentication (sign up + login)
- Live map centered on user location
- Long-press spot reporting with free/paid + duration
- Placement validation:
  - Must be near current user location
  - Must be near a road/parking area (OSM Overpass validation)
- Spot lifecycle:
  - Active, expiring, and expired states
  - Auto-expiration of stale reports
  - Manual and automatic mark-as-taken flows with confirmation
- Reliability features:
  - Undo window after mark-as-taken
  - Unstuck action for stale lock recovery
  - Local fallback queue + cloud sync retry
- Report history with filtering and sorting

## Tech Stack

- React Native (Expo SDK 54)
- TypeScript
- React Navigation
- React Native Maps
- Firebase Auth + Firestore (web SDK)
- Expo Location + Expo Notifications
- Overpass API (road/parking validation)

## Repository Layout

- `ParkingFinderApp/` - mobile app source
- `docs/` - project documentation assets

Inside `ParkingFinderApp/`:

- `app/screens/` - screen-level UI (`Login`, `Map`)
- `components/` - modals and overlay UI
- `hooks/` - business logic hooks
- `services/` - Firestore repository logic
- `utils/` - geo/time/notification helpers
- `types/` - shared TypeScript types

## Local Development

1. Open terminal at:
   - `C:\Users\kylep\Downloads\Parking-Finder\ParkingFinderApp`
2. Install dependencies:
   - `npm install`
3. Start Expo:
   - `npm start`
4. Optional shortcuts:
   - `npm run android`
   - `npm run ios`

## Code Style and Validation

Prettier is the project formatter (`.prettierrc.json`).

Run style check:

```bash
npx prettier --check .
```

Run type check:

```bash
npx tsc --noEmit
```

## Android APK Build (EAS)

`eas.json` already includes:

- `preview-apk` profile (builds installable APK)
- `production` profile (builds AAB for Play Store)

Before building Android, ensure `expo.android.config.googleMaps.apiKey` is set in `ParkingFinderApp/app.json`.

**IT WILL CRASH WITHOUT AN API KEY!!!**

Build APK:

```bash
npx eas-cli@latest login
npx eas-cli@latest build -p android --profile preview-apk --clear-cache
```

After build completes, download APK from the EAS build URL.

## GitHub Release Flow (APK)

Recommended: attach APK to a GitHub Release (do not commit APK into source tree).

1. Commit code and push `main`
2. Tag release (example `v1.0.0`)
3. Create GitHub Release for that tag
4. Upload the APK as a release asset

## iOS Release Path (When Ready)

iOS does not use APK. You will build an IPA and distribute through TestFlight/App Store Connect.

`eas.json` includes:

- `preview-ios` profile (internal iOS build)
- `production-ios` profile (store/TestFlight iOS build)

High-level steps:

1. Build iOS artifact:
   - Internal: `npx eas-cli@latest build -p ios --profile preview-ios`
   - TestFlight-ready: `npx eas-cli@latest build -p ios --profile production-ios`
2. Submit latest iOS build to App Store Connect:
   - `npx eas-cli@latest submit -p ios --latest`

Requires Apple Developer Program access.

## Release 1.0.0 Quick Gate

Run before tagging release:

```bash
npx prettier --check .
npx tsc --noEmit
npx expo config --json
npx expo-doctor
```

## Notes

- Android icon updates may require uninstall/reinstall due launcher cache.
- Expo Go has limitations for some notification features.
- Live availability quality depends on active user reporting and location accuracy.

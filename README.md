# ParkingFinder

ParkingFinder is a real-time community parking availability app built with **React Native (Expo)** and **Firebase/Firestore**.
Users can report when they leave a parking spot, and nearby drivers can see and claim that spot on a live map.

---

## Features

### Core Functionality

- Live map showing nearby parking spots
- Free and paid parking spot reporting
- Real-time Firestore synchronization
- Auto-expiration of old parking spots
- "Mark as Taken" system to prevent stale spots

### Smart Behavior

- Auto-take detection when a user arrives at a reported spot
- Distance validation (must be near the spot to claim it)
- Expiration warning notifications
- Undo system (45-second grace period)
- Local fallback if the network fails

### User Experience

- Color-coded markers:
  - 🟢 Active
  - 🔴 Expiring Soon
  - ⚫ Expired
  - 🔴 **T** = Taken

- History of user-reported spots
- Filters and sorting in history view
- Persistent login using Firebase Auth
- Notifications for expiring spots

---

## Tech Stack

**Frontend**

- React Native (Expo)
- TypeScript
- React Navigation
- React Native Maps

**Backend**

- Firebase Authentication
- Firebase Firestore (real-time database)
- Geohash queries for location filtering

**APIs & Services**

- Expo Location
- Expo Notifications
- OpenStreetMap Overpass API (road validation)

---

## How It Works

1. A user leaves a parking spot and long-presses the map.
2. The app verifies the location is near a road or parking area.
3. The spot is uploaded to Firestore.
4. Nearby users see the spot instantly.
5. When someone parks, they mark it as taken (or it auto-detects arrival).
6. The marker disappears for other users.

Spots automatically expire after their timer finishes.

---

## Project Structure

```
app/screens/      Main screens (Map, Login)
components/       UI modals and overlays
hooks/            Custom logic hooks (tracking, undo, firestore)
utils/            Shared utilities (geo, time, notifications)
types/            Shared TypeScript types
parkingReports.ts Firestore repository layer
```

---

## Installation

### 1. Clone the repository

```
git clone <your-repo-url>
cd Parking-Finder/ParkingFinderApp
```

### 2. Install dependencies

```
npm install
```

### 3. Start the app

```
npx expo start
```

Then open **Expo Go** on your phone and scan the QR code.

---

## Notifications

Android devices support scheduled notifications.

Expo Go on iOS does **not** support local scheduled notifications, so expiration alerts will only appear on Android or a development build.

---

## Known Limitations

- Requires internet connection for shared spots
- Location accuracy depends on device GPS
- iOS Expo Go cannot schedule background notifications
- Parking availability depends on active users

---

## Authors

Developed as a university software project using Agile methodology and iterative testing.

---

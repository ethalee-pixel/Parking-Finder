// FirebaseConfig.ts
// Initializes Firebase App, Auth (with React Native persistence),
// and Firestore for use across the app.

import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getReactNativePersistence, initializeAuth } from 'firebase/auth';

import AsyncStorage from '@react-native-async-storage/async-storage';

const firebaseConfig = {
  apiKey: 'AIzaSyBi-I1xo3z43wFlwwcPewCbD0Ivk6O3wgM',
  authDomain: 'parkingfinder-f1459.firebaseapp.com',
  projectId: 'parkingfinder-f1459',
  storageBucket: 'parkingfinder-f1459.firebasestorage.app',
  messagingSenderId: '705550185091',
  appId: '1:705550185091:web:da7fb78ea187cb5c41e1b6',
  measurementId: 'G-2319ZXG844',
};

// Initialize the core Firebase app instance
export const FIREBASE_APP = initializeApp(firebaseConfig);

// Initialize Firebase Auth with AsyncStorage persistence
// so login state survives app restarts.
// user story 1.4
export const FIREBASE_AUTH = initializeAuth(FIREBASE_APP, {
  persistence: getReactNativePersistence(AsyncStorage),
});

// Initialize Firestore database
export const FIRESTORE_DB = getFirestore(FIREBASE_APP);

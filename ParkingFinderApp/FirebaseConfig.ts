import { initializeApp } from "firebase/app";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { initializeAuth } from "firebase/auth";
import { getReactNativePersistence } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyBi-I1xo3z43wFlwwcPewCbD0Ivk6O3wgM",
  authDomain: "parkingfinder-f1459.firebaseapp.com",
  projectId: "parkingfinder-f1459",
  storageBucket: "parkingfinder-f1459.firebasestorage.app",
  messagingSenderId: "705550185091",
  appId: "1:705550185091:web:da7fb78ea187cb5c41e1b6",
  measurementId: "G-2319ZXG844",
};

export const FIREBASE_APP = initializeApp(firebaseConfig);

export const FIREBASE_AUTH = initializeAuth(FIREBASE_APP, {
  persistence: getReactNativePersistence(AsyncStorage),
});

export const FIRESTORE_DB = getFirestore(FIREBASE_APP);

import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import AsyncStorage from '@react-native-async-storage/async-storage';

// need to add firebase config
  const firebaseConfig = {
    apiKey: "AIzaSyBi-I1xo3z43wFlwwcPewCbD0Ivk6O3wgM",
    authDomain: "parkingfinder-f1459.firebaseapp.com",
    projectId: "parkingfinder-f1459",
    storageBucket: "parkingfinder-f1459.firebasestorage.app",
    messagingSenderId: "705550185091",
    appId: "1:705550185091:web:da7fb78ea187cb5c41e1b6",
    measurementId: "G-2319ZXG844"
  };

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Firebase Auth
const auth = getAuth(app);

// Set persistence manually (if needed in your auth logic)
export { auth, app };
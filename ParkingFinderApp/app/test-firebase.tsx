import { useEffect } from 'react';
import { auth } from './config/firebase';
import { onAuthStateChanged } from 'firebase/auth';

export function TestFirebase() {
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      console.log('Firebase Auth State:', user ? 'Logged in' : 'Not logged in');
      if (user) {
        console.log('User email:', user.email);
      }
    });

    return () => unsubscribe();
  }, []);

  return null;
}
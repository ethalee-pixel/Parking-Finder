// App.tsx
// App entry point. Sets up navigation and routes users to Login or Map
// based on Firebase Auth state.
import { useEffect, useState } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { onAuthStateChanged, type User } from 'firebase/auth';

import { FIREBASE_AUTH } from './FirebaseConfig';
import Login from './app/screens/Login';
import MapScreen from './app/screens/Map';

type RootStackParamList = {
  Login: undefined;
  Map: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function App() {
  // Current Firebase Auth user (null when signed out)
  const [user, setUser] = useState<User | null>(null);
  // True while we are waiting for the initial auth state callback
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // user story 1.4
    const unsubscribe = onAuthStateChanged(FIREBASE_AUTH, (u) => {
      setUser(u);
      setLoading(false);
    });

    return unsubscribe;
  }, []);

  // Avoid rendering screens until we know whether the user is signed in.
  // Replace with a LoadingScreen later if you want.
  if (loading) return null;

  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {user ? (
          <Stack.Screen name="Map" component={MapScreen} />
        ) : (
          // user story 1.4
          <Stack.Screen name="Login" component={Login} />
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}

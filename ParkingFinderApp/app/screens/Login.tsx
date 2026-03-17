// Login.tsx
// Authentication screen: allows existing users to sign in or create an account.

import React, { useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Button,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import { createUserWithEmailAndPassword, signInWithEmailAndPassword } from 'firebase/auth';
import { FIREBASE_AUTH } from '../../FirebaseConfig';

const BUTTON_SPACING = 10;

type AuthErrorLike = {
  message?: string;
};

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  // Prevents duplicate requests and disables inputs while authenticating
  const [isLoading, setIsLoading] = useState(false);

  // Reference used to move focus from email input → password input
  const passwordRef = useRef<TextInput>(null);

  // Displays a user-friendly error message for Firebase auth failures
  const showAuthError = (title: string, err: unknown) => {
    const message = (err as AuthErrorLike)?.message ?? 'Unknown error';
    console.error(err);
    Alert.alert(title, message);
  };

  // Attempts to sign in an existing user
  const handleSignIn = async () => {
    setIsLoading(true);

    try {
      // user story 1.4
      await signInWithEmailAndPassword(FIREBASE_AUTH, email.trim(), password);
    } catch (err: unknown) {
      showAuthError('Login failed', err);
    } finally {
      setIsLoading(false);
    }
  };

  // Creates a new user account
  const handleSignUp = async () => {
    setIsLoading(true);

    try {
      // user story 1.4
      await createUserWithEmailAndPassword(FIREBASE_AUTH, email.trim(), password);
    } catch (err: unknown) {
      showAuthError('Sign up failed', err);
    } finally {
      setIsLoading(false);
    }
  };

  // After submitting the email field, move cursor to password field
  const handleSubmitEmail = () => {
    passwordRef.current?.focus();
  };

  return (
    // Dismiss keyboard when tapping outside input fields
    <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
      <View style={styles.screen}>
        <KeyboardAvoidingView
          style={styles.screen}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <ScrollView
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.card}>
              <Text style={styles.title}>ParkingFinder</Text>
              <Text style={styles.subtitle}>Log in to find and share parking</Text>

              <Text style={styles.label}>Email</Text>
              <TextInput
                value={email}
                style={styles.input}
                placeholder="you@example.com"
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                returnKeyType="next"
                editable={!isLoading}
                onChangeText={setEmail}
                onSubmitEditing={handleSubmitEmail}
              />

              <Text style={styles.label}>Password</Text>
              <TextInput
                ref={passwordRef}
                value={password}
                style={styles.input}
                placeholder="••••••••"
                autoCapitalize="none"
                autoCorrect={false}
                secureTextEntry
                returnKeyType="done"
                editable={!isLoading}
                onChangeText={setPassword}
                // Pressing "done" on keyboard attempts login
                onSubmitEditing={handleSignIn}
              />

              <View style={styles.buttons}>
                {isLoading ? (
                  <ActivityIndicator size="large" />
                ) : (
                  <>
                    <Button title="Login" onPress={handleSignIn} />
                    <View style={{ height: BUTTON_SPACING }} />
                    <Button title="Create Account" onPress={handleSignUp} />
                  </>
                )}
              </View>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </View>
    </TouchableWithoutFeedback>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#F6F7FB',
  },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 16,
  },
  // Card container for the login form
  card: {
    width: '100%',
    maxWidth: 420,
    alignSelf: 'center',
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 18,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
  },
  subtitle: {
    marginTop: 6,
    marginBottom: 18,
    color: '#667085',
    fontSize: 14,
  },
  label: {
    fontSize: 13,
    color: '#344054',
    marginBottom: 6,
    marginTop: 10,
    fontWeight: '600',
  },
  input: {
    marginVertical: 4,
    height: 50,
    borderWidth: 1,
    borderColor: '#D0D5DD',
    borderRadius: 12,
    paddingHorizontal: 12,
    backgroundColor: '#fff',
  },
  buttons: {
    marginTop: 14,
  },
});

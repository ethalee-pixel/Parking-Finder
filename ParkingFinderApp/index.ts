// index.ts
// Expo entry point. Registers the root React component so the app can run
// in Expo Go and native builds.

import { registerRootComponent } from 'expo';
import App from './App';

// Equivalent to:
// AppRegistry.registerComponent("main", () => App);
// Ensures the environment is correctly configured for Expo.
registerRootComponent(App);

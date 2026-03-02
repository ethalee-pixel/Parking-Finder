// metro.config.js
// Custom Metro configuration for Expo.
// See: https://docs.expo.dev/guides/customizing-metro/

const { getDefaultConfig } = require('expo/metro-config');

// Get Expo's default Metro config
const config = getDefaultConfig(__dirname);

// Ensure React Native entry points are prioritized correctly
config.resolver.resolverMainFields = ['react-native', 'browser', 'main'];

module.exports = config;

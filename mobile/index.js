// The app's entry: what the shared code expects from a browser
// (localStorage, crypto.randomUUID, Buffer…) goes in before any screen
// module is loaded — Expo Router loads them all up front.
import './lib/polyfills';
import 'expo-router/entry';

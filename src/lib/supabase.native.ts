// The phone app's Supabase client (mobile/): the same project as the
// desktop app, with the session kept in the device's storage. Every
// src/lib module that imports './supabase' gets this one on iOS/Android.
import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import Constants from 'expo-constants';

const extra = (Constants.expoConfig?.extra ?? {}) as Record<string, string | undefined>;

export const supabase = createClient(extra.supabaseUrl ?? '', extra.supabaseAnonKey ?? '', {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

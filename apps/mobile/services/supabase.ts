import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Public client values (the same ones the web and creator portals ship), so a
// cloud build without a .env still signs in.
const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://xttgnswgeffyybjfjlkp.supabase.co';
const SUPABASE_ANON_KEY =
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh0dGduc3dnZWZmeXliamZqbGtwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY0NjIzMzMsImV4cCI6MjA5MjAzODMzM30.RWUrrTINfqPJ_H6vbFtLZ7uf0okWb5gUYJy9LK9NlCQ';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
  realtime: {
    params: {
      eventsPerSecond: 10,
    },
  },
});

export type Database = any; // Replace with generated types from Supabase CLI

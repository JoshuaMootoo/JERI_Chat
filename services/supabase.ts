
import { createClient } from '@supabase/supabase-js';

/**
 * JERI Chat Supabase Configuration
 * 
 * To protect your credentials on GitHub:
 * 1. Ensure SUPABASE_URL and SUPABASE_ANON_KEY are set in your environment variables.
 * 2. This file no longer contains hardcoded fallbacks.
 */

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.warn(
    "JERI Warning: Supabase environment variables are missing. " +
    "Sync and Auth features will not work until SUPABASE_URL and SUPABASE_ANON_KEY are configured."
  );
}

// Client initialization using environment variables.
export const supabase = createClient(
  SUPABASE_URL || '', 
  SUPABASE_ANON_KEY || ''
);

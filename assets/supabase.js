import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

const url = String(SUPABASE_URL || '').trim().replace(/\/+$/, '');
const key = String(SUPABASE_KEY || '').trim();

const urlLooksReal = /^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(url);
const keyLooksReal = key.length > 30 && !key.includes('TU-');
const libraryAvailable = typeof window.supabase?.createClient === 'function';

export const isConfigured = urlLooksReal && keyLooksReal && libraryAvailable;

export const supabase = isConfigured
  ? window.supabase.createClient(url, key, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
      },
    })
  : null;

export async function callRpc(functionName, params = {}) {
  if (!supabase) {
    throw new Error(
      'La conexión con Supabase no está configurada. Revisa assets/config.js.'
    );
  }

  const { data, error } = await supabase.rpc(functionName, params);

  if (error) {
    throw error;
  }

  return data;
}

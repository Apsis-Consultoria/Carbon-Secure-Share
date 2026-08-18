// -----------------------------------------------------------------------------
// Client Supabase de servidor. Uso EXCLUSIVO dentro das Edge Functions.
// -----------------------------------------------------------------------------
// Ignora RLS. Existe so aqui, no runtime Deno, lendo a chave de variavel de
// ambiente injetada pela plataforma. Nunca hardcoded, nunca no bundle do
// frontend - o navegador do cliente externo so conhece a anon key.
//
// As tabelas do Secure Share tem RLS ativa e NENHUMA policy: sem service_role,
// nem o dono da anon key le uma linha. E por isso que todo acesso passa por
// aqui.

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

function lerChaveDeServidor(): string {
  const legada = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (legada) return legada;

  // Modelo novo de chaves do Supabase: dicionario JSON.
  const dicionario = Deno.env.get('SUPABASE_SECRET_KEYS');
  if (dicionario) {
    try {
      const chaves = JSON.parse(dicionario) as Record<string, string>;
      if (chaves.default) return chaves.default;
    } catch {
      throw new Error('SUPABASE_SECRET_KEYS existe mas nao e JSON valido.');
    }
  }

  throw new Error(
    'Chave de servidor ausente. Defina SUPABASE_SERVICE_ROLE_KEY nos secrets das Edge Functions.',
  );
}

let cache: SupabaseClient | null = null;

/**
 * Instancia unica do isolate, criada na primeira chamada.
 *
 * Preguicosa de proposito: se faltar variavel de ambiente, o erro estoura DENTRO
 * do try/catch do handler e o cliente recebe JSON com CORS, em vez de um crash
 * de boot sem cabecalho, que no navegador aparece como erro de CORS e esconde a
 * causa real.
 */
export function obterAdmin(): SupabaseClient {
  if (cache) return cache;

  const url = Deno.env.get('SUPABASE_URL');
  if (!url) throw new Error('SUPABASE_URL ausente no ambiente da Edge Function.');

  cache = createClient(url, lerChaveDeServidor(), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { 'x-application-name': 'secure-share-carbon' } },
  });
  return cache;
}

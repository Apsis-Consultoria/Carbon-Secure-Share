/**
 * Endereco das Edge Functions do Secure Share Carbon.
 *
 * O frontend conhece DUAS variaveis, as duas publicas por design:
 *
 *   VITE_SUPABASE_URL
 *   VITE_SUPABASE_ANON_KEY
 *
 * Nada que comece com VITE_ e secreto: entra no bundle e qualquer pessoa le no
 * DevTools. A anon key so identifica o projeto no gateway do Supabase; a
 * protecao real e a RLS (as tabelas do Secure Share nao tem policy nenhuma) e o
 * token de sessao exigido por cada funcao.
 *
 * NAO existe cliente supabase-js aqui de proposito. Este portal nunca fala com o
 * banco direto: tudo passa por Edge Function, que e onde a permissao por item e
 * conferida. Um cliente supabase no bundle so criaria a tentacao de consultar
 * uma tabela "de leitura" e pular essa checagem.
 */

export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || '';
export const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

/** Placeholders do .env.example. Se chegarem aqui, ninguem preencheu o arquivo. */
const PLACEHOLDERS = ['SEU-PROJETO', 'SEU_PROJETO', 'COLE_A_ANON_KEY_AQUI'];

export function configuracaoIncompleta() {
  const alvo = `${SUPABASE_URL} ${SUPABASE_ANON_KEY}`.toUpperCase();
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return true;
  return PLACEHOLDERS.some((p) => alvo.includes(p));
}

/** URL de uma Edge Function: urlFuncao('carbon-ss-login'). */
export function urlFuncao(nome) {
  const base = SUPABASE_URL.replace(/\/+$/, '');
  return `${base}/functions/v1/${nome}`;
}

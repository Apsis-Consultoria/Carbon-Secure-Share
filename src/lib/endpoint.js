/**
 * Endereco das funcoes de backend.
 *
 * ------------------------------------------------------------------------
 * O FRONTEND NAO TEM NENHUMA VARIAVEL DE AMBIENTE. NENHUMA.
 * ------------------------------------------------------------------------
 * Nao existe `import.meta.env` em lugar nenhum de src/. O bundle nao carrega
 * URL de projeto Supabase, nao carrega anon key, nao carrega chave de coisa
 * alguma. Quem abrir o DevTools no navegador de um cliente nao descobre nem em
 * que projeto Supabase o sistema roda.
 *
 * COMO: todas as chamadas vao para `/api/<funcao>`, um caminho RELATIVO na
 * mesma origem do site. Quem traduz `/api/*` para as Edge Functions e a camada
 * de HOSPEDAGEM, por um rewrite de proxy:
 *
 *   producao (AWS Amplify)  regra de rewrite no console:
 *       origem  /api/<*>
 *       destino https://<ref>.supabase.co/functions/v1/<*>
 *       tipo    200 (rewrite / proxy)
 *
 *   desenvolvimento         server.proxy do vite.config.js, alimentado pela
 *                           variavel de ambiente SUPABASE_FUNCTIONS_URL. Ela e
 *                           lida pelo processo do Vite, NAO pelo navegador:
 *                           sem o prefixo VITE_, o Vite se recusa a expor a
 *                           variavel ao cliente. Ela nunca entra no bundle.
 *
 * POR QUE ISSO IMPORTA, e nao e preciosismo: com a URL no bundle, qualquer
 * pessoa que abra a tela de login descobre o endereco do projeto e passa a
 * poder bater direto nas Edge Functions, fora do nosso dominio, sem passar por
 * nenhum log, WAF ou limite de taxa da hospedagem. Com o proxy, a unica porta
 * publica e o nosso proprio dominio.
 *
 * SEM ANON KEY. As funcoes sao publicadas com --no-verify-jwt (ver
 * .github/workflows/deploy-functions.yml): quem autoriza nao e o JWT do
 * Supabase, e sim o token de sessao assinado com SESSION_SECRET, conferido
 * dentro de cada funcao. Logo nao ha por que mandar apikey nenhuma.
 */

/** Prefixo servido pelo rewrite. Relativo de proposito: nunca absoluto. */
const PREFIXO = '/api';

/** Caminho de uma funcao: caminhoFuncao('carbon-ss-login') -> '/api/carbon-ss-login'. */
export function caminhoFuncao(nome) {
  return `${PREFIXO}/${nome}`;
}

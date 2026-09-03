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
 *                           variavel de ambiente SUPABASE_API_URL. Ela e
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

/**
 * Prefixo das chamadas. `/api` (relativo) quando houver rewrite na hospedagem,
 * e o endereco absoluto do Supabase quando NAO houver.
 *
 * `__BASE_API__` e injetada pelo `define` do vite.config.js e vale:
 *   '/api'  em desenvolvimento SEMPRE, e em producao quando SUPABASE_API_URL
 *           nao esta no ambiente do build;
 *   'https://<ref>.supabase.co/functions/v1'  em producao quando esta.
 *
 * POR QUE EXISTE. Em 02/09/2026 secureshare.apsiscarbon.com subiu sem a regra de
 * rewrite de /api, que so se configura no console do Amplify. O POST do login
 * levava 301 para /api/carbon-ss-codigo/, o navegador seguia virando GET, perdia
 * o corpo e recebia 404. Nenhuma mudanca de codigo alcancava o problema enquanto
 * o caminho fosse relativo.
 *
 * O CUSTO, por inteiro: com o endereco no bundle, quem abrir o codigo-fonte da
 * pagina descobre o projeto Supabase e pode chamar as Edge Functions fora do
 * nosso dominio, sem log, WAF nem limite de taxa - exatamente o que o desenho
 * relativo evitava, e o texto acima ainda descreve. O que NAO muda: quem
 * autoriza e o token de sessao assinado com SESSION_SECRET, conferido dentro de
 * cada funcao, entao conhecer o endereco nao da acesso a nada.
 *
 * COMO DESFAZER: apague SUPABASE_API_URL do ambiente de BUILD da Amplify. O
 * proximo build volta para '/api'. Nao ha codigo para mexer, e e por isso que o
 * valor nao esta escrito aqui.
 *
 * O `typeof` protege quem importar este modulo fora do build do Vite.
 */
const PREFIXO = typeof __BASE_API__ === 'string' && __BASE_API__ ? __BASE_API__ : '/api';

/**
 * Verdadeiro quando as chamadas saem pelo caminho relativo. O aviso de rewrite
 * faltando em src/lib/api.js so faz sentido nesse caso.
 */
export const USA_CAMINHO_RELATIVO = PREFIXO === '/api';

/** Caminho de uma funcao: caminhoFuncao('carbon-ss-login') -> '/api/carbon-ss-login'. */
export function caminhoFuncao(nome) {
  return `${PREFIXO}/${nome}`;
}

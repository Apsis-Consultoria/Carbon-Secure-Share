import path from 'path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * O FRONTEND NAO TEM VARIAVEL DE AMBIENTE NENHUMA.
 *
 * Nao existe `import.meta.env` em src/, e nao existe `.env`. Todas as chamadas
 * vao para o caminho relativo `/api/<funcao>`, e quem sabe onde ficam as Edge
 * Functions e a camada de hospedagem (ver src/lib/endpoint.js).
 *
 * As duas variaveis lidas AQUI sao do processo do Vite, nao do navegador. Elas
 * NAO tem o prefixo VITE_, e essa ausencia e a garantia: o Vite so expoe ao
 * cliente o que comeca com VITE_, entao e impossivel qualquer uma delas vazar
 * para o bundle, mesmo por engano.
 *
 *   SUPABASE_API_URL         endereco do projeto Supabase, em desenvolvimento.
 *                            Ex.: https://<ref>.supabase.co
 *   EXPOR_REDE               'true' escuta em toda a rede local (testar no
 *                            celular). Por padrao so em 127.0.0.1, para o
 *                            codigo-fonte servido em dev nao ficar legivel por
 *                            outras maquinas.
 */

/**
 * Caminho das Edge Functions. Convencao do Supabase, igual em todo projeto, e
 * por isso vive no CODIGO: a variavel guarda so o que muda de ambiente para
 * ambiente, e quem a preenche nao precisa saber a convencao - logo, nao pode
 * erra-la. Mesma divisao do Portal Apsis Carbon.
 */
const CAMINHO_FUNCOES = '/functions/v1';

/**
 * O nome atual e SUPABASE_API_URL. SUPABASE_FUNCTIONS_URL era o nome ate
 * 28/08/2026 e continua aceito, com aviso: derrubar o ambiente de quem ja tinha
 * a variavel exportada trocaria um problema de nome por um 404 em /api que nao
 * se explica sozinho. O aviso importa tanto quanto o fallback - compatibilidade
 * silenciosa vira permanente.
 */
function lerEnderecoDoProjeto() {
  const bruto = (process.env.SUPABASE_API_URL || process.env.SUPABASE_FUNCTIONS_URL || '').trim();
  if (!bruto) return '';

  if (!process.env.SUPABASE_API_URL && process.env.SUPABASE_FUNCTIONS_URL) {
    console.warn(
      '\n[Secure Share] SUPABASE_FUNCTIONS_URL e o nome antigo e vai deixar de funcionar.\n' +
        '  Renomeie para SUPABASE_API_URL.\n',
    );
  }

  /* O valor antigo terminava em /functions/v1 e o novo nao. Sem esta limpeza,
     quem tiver o valor completo anotado geraria caminho DUPLICADO e toda chamada
     de /api daria 404, sem nada apontar para a variavel. */
  const semBarra = bruto.replace(/\/+$/, '');
  if (semBarra.toLowerCase().endsWith(CAMINHO_FUNCOES)) {
    const origem = semBarra.slice(0, -CAMINHO_FUNCOES.length);
    console.warn(
      `\n[Secure Share] SUPABASE_API_URL agora leva SO o endereco do projeto.\n` +
        `  Remova o "${CAMINHO_FUNCOES}" do fim: use ${origem}\n`,
    );
    return origem;
  }
  return semBarra;
}

const DESTINO_FUNCOES = lerEnderecoDoProjeto();

// Aviso no boot do dev server. Sem o proxy, `/api/*` cai no index.html e o erro
// chega ao desenvolvedor como "o sistema nao esta configurado" na tela, sem
// dizer o que fazer. Melhor gritar aqui, uma vez.
if (!DESTINO_FUNCOES && process.env.NODE_ENV !== 'production') {
  console.warn(
    '\n[Secure Share] SUPABASE_API_URL nao definida: o proxy /api nao vai funcionar.\n' +
      '  Rode assim (PowerShell):\n' +
      '    $env:SUPABASE_API_URL="https://<ref>.supabase.co"; npm run dev\n',
  );
}

/**
 * Base das chamadas de API, injetada no bundle em tempo de BUILD.
 *
 * -----------------------------------------------------------------------------
 * ISTO AFROUXA UMA DECISAO DE SEGURANCA, e o afrouxamento e CONDICIONAL
 * -----------------------------------------------------------------------------
 * O desenho original e: o frontend so conhece o caminho relativo /api/<funcao>,
 * e quem sabe o endereco do Supabase e a hospedagem, por rewrite. Assim o
 * endereco do projeto nunca entra no bundle, e a unica porta publica e o nosso
 * dominio - com log, WAF e limite de taxa na frente.
 *
 * Em 02/09/2026 secureshare.apsiscarbon.com subiu SEM a regra de rewrite, e a
 * Amplify servia /api/<funcao> como arquivo estatico: 301 para /api/<funcao>/ e
 * depois 404. O POST do login virava GET no redirecionamento, perdia o corpo, e
 * o console mostrava exatamente isso. A regra e de console e nao existe arquivo
 * de repositorio que a substitua.
 *
 * A SAIDA, e o custo dela: com SUPABASE_API_URL no ambiente do BUILD, o endereco
 * absoluto entra no bundle e o navegador chama o Supabase direto. O custo e o
 * que o desenho evitava: quem abrir o codigo-fonte da pagina ve o endereco. O
 * que NAO muda: quem autoriza e o token de sessao assinado com SESSION_SECRET,
 * conferido dentro de cada funcao, entao conhecer o endereco nao da acesso.
 *
 * ELA SE DESFAZ SOZINHA: no dia em que a regra de rewrite existir, apague a
 * variavel SUPABASE_API_URL do ambiente de build da Amplify. O proximo build
 * volta a `/api` e o endereco sai do bundle, sem tocar em uma linha de codigo.
 *
 * EM DESENVOLVIMENTO CONTINUA `/api`, sempre: ali o proxy resolve.
 */
function baseDaApi(comando) {
  if (comando !== 'build') return '/api';
  if (!DESTINO_FUNCOES) return '/api';
  // DESTINO_FUNCOES e SO a origem do projeto: `lerEnderecoDoProjeto` corta o
  // /functions/v1 do fim, de proposito, para a variavel carregar so o que muda
  // de ambiente. O caminho e convencao do Supabase e mora em CAMINHO_FUNCOES.
  return DESTINO_FUNCOES + CAMINHO_FUNCOES;
}

export default defineConfig(({ command }) => ({
  /*
   * Vai para src/lib/endpoint.js. Precisa de JSON.stringify: `define` faz
   * substituicao TEXTUAL, entao sem as aspas sairia um identificador solto.
   */
  define: {
    __BASE_API__: JSON.stringify(baseDaApi(command)),
  },
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(process.cwd(), './src') },
  },
  server: {
    // 5174 e do Portal Apsis e 5175 do Portal Apsis Carbon. strictPort faz o
    // comando FALHAR com a porta ocupada, em vez de subir em outra em silencio.
    port: 5176,
    strictPort: true,
    host: process.env.EXPOR_REDE === 'true' ? true : '127.0.0.1',
    proxy: DESTINO_FUNCOES
      ? {
          '/api': {
            target: DESTINO_FUNCOES,
            changeOrigin: true,
            // Espelha o rewrite da producao: /api/carbon-ss-login vira
            // <endereco>/functions/v1/carbon-ss-login.
            rewrite: (caminho) => caminho.replace(/^\/api/, CAMINHO_FUNCOES),
          },
        }
      : undefined,
  },
}));

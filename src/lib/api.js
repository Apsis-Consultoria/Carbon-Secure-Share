import { caminhoFuncao } from '@/lib/endpoint';
import {
  MODO_DEMO,
  demoArvore,
  demoBaixar,
  demoEntrar,
  demoEnviar,
  demoListar,
  demoTrocarSenha,
} from '@/lib/demo';
import { lerSessao, limparSessao } from '@/lib/sessao';

/**
 * api - chamadas as Edge Functions do Secure Share Carbon.
 *
 * Uma funcao por operacao, todas com o token de sessao no Authorization. Nenhuma
 * fala com o banco: quem confere a permissao por item e o servidor, a cada
 * requisicao.
 *
 * ESTE MODULO NAO TEM TEXTO DE INTERFACE. Ele lanca ErroApi carregando o CODIGO
 * do erro, e quem traduz e a tela, por textoDoErro() de src/lib/i18n.jsx.
 *
 * Por que assim: a interface tem dois idiomas (ingles por padrao, portugues por
 * escolha). Se a mensagem fosse formada aqui, ela nasceria no idioma vigente no
 * instante da falha e NAO mudaria quando a pessoa trocasse o seletor - um erro
 * em ingles ficaria preso na tela em portugues. Alem disso, este arquivo nao e
 * um componente e nao pode usar o hook do React que conhece o idioma.
 *
 * A `message` do ErroApi existe so para log e para o console. Nunca a mostre ao
 * cliente: use textoDoErro(t, erro).
 */

const TIMEOUT_MS = 20000;

export class ErroApi extends Error {
  constructor(codigo, { status = null, detalhe = null, mensagem = null } = {}) {
    super(mensagem || codigo || 'erro_api');
    this.name = 'ErroApi';
    this.codigo = codigo;
    this.status = status;
    this.detalhe = detalhe;
  }
}

/**
 * Sem `apikey`: as funcoes sao publicadas com --no-verify-jwt e quem autoriza e
 * o nosso token de sessao, conferido dentro de cada uma. Nao ha chave de
 * Supabase neste bundle. Ver src/lib/endpoint.js.
 */
function cabecalhos(comToken = true) {
  const saida = { Accept: 'application/json' };
  if (comToken) {
    const sessao = lerSessao();
    if (sessao?.token) saida.Authorization = `Bearer ${sessao.token}`;
  }
  return saida;
}

/**
 * Detecta o rewrite `/api/*` faltando na hospedagem.
 *
 * SAO DUAS FORMAS DIFERENTES, e cobrir so uma nao adianta:
 *
 *   producao (Amplify)  sem a regra de /api, o caminho cai no catch-all da SPA
 *                       e volta o index.html com status 200 e content-type
 *                       text/html;
 *   dev (Vite)          o fallback de SPA do Vite so vale para GET de
 *                       navegacao. Um POST /api/... sem proxy volta 404 SEM
 *                       CORPO - foi exatamente o que aconteceu no teste, e a
 *                       checagem por content-type sozinha deixou passar.
 *
 * Sem isto, os dois casos aparecem como "algo deu errado do nosso lado" e a
 * causa real (falta uma regra na hospedagem) fica escondida por horas.
 *
 * O criterio de corpo vazio e seguro porque TODA funcao deste sistema responde
 * JSON, inclusive nos erros: um 404 nosso traz `{erro:'nao_encontrado'}`. Corpo
 * ausente num 200 ou num 404 significa que a requisicao nem chegou a uma funcao.
 */
function proxyAusente(resposta, dados) {
  const tipo = resposta.headers.get('content-type') || '';
  if (tipo.includes('text/html')) return true;
  return dados === null && (resposta.status === 404 || resposta.status === 200);
}

async function chamar(funcao, { metodo = 'GET', corpo = null, consulta = null, comToken = true, signal = null } = {}) {
  const controlador = new AbortController();
  const timer = setTimeout(() => controlador.abort(), TIMEOUT_MS);
  if (signal) signal.addEventListener('abort', () => controlador.abort(), { once: true });

  const params = consulta ? `?${new URLSearchParams(consulta)}` : '';

  let resposta;
  try {
    resposta = await fetch(`${caminhoFuncao(funcao)}${params}`, {
      method: metodo,
      headers: {
        ...cabecalhos(comToken),
        ...(corpo ? { 'Content-Type': 'application/json' } : {}),
      },
      body: corpo ? JSON.stringify(corpo) : undefined,
      signal: controlador.signal,
    });
  } catch (e) {
    if (e?.name === 'AbortError') {
      throw new ErroApi('timeout');
    }
    throw new ErroApi('falha_rede');
  } finally {
    clearTimeout(timer);
  }

  let dados = null;
  try {
    const texto = await resposta.text();
    dados = texto ? JSON.parse(texto) : null;
  } catch {
    dados = null;
  }

  if (proxyAusente(resposta, dados)) {
    // Detalhe tecnico no console, nunca na tela: quem le a tela e um cliente,
    // que nao tem como configurar rewrite nenhum.
    console.error(
      `[Secure Share] ${caminhoFuncao(funcao)} nao chegou a uma Edge Function ` +
        `(HTTP ${resposta.status}). Falta o rewrite de /api/* na hospedagem. ` +
        'Producao: Amplify > App settings > Rewrites and redirects, antes do catch-all da SPA. ' +
        'Desenvolvimento: defina SUPABASE_FUNCTIONS_URL no ambiente do Vite.',
    );
    throw new ErroApi('proxy_nao_configurado', { status: resposta.status });
  }

  // 207 = envio parcial. Nao e erro: quem chamou precisa da lista do que subiu.
  if (!resposta.ok && resposta.status !== 207) {
    // Sessao invalida: limpamos aqui para a proxima renderizacao cair no login,
    // em vez de a tela ficar tentando com um token morto.
    if (resposta.status === 401) limparSessao();
    throw new ErroApi(dados?.erro ?? null, {
      status: resposta.status,
      detalhe: dados?.detalhe ?? null,
    });
  }

  return { status: resposta.status, dados };
}

/* ===== Modo demonstracao ================================================== */

/**
 * O modo demonstracao esta ATIVO nesta sessao?
 *
 * Duas condicoes, e as duas importam:
 *
 *   MODO_DEMO         constante de build (import.meta.env.DEV). Em producao ela
 *                     e false, o `&&` curto-circuita e o Rollup remove tanto a
 *                     chamada quanto o modulo src/lib/demo.js do bundle;
 *   sessao.demo       ligado apenas por entrarDemo(). Sem ele, uma sessao de
 *                     desenvolvimento contra um Supabase de verdade continuaria
 *                     chamando a rede, que e o que se quer ao testar de fato.
 *
 * E funcao, e nao constante, porque a segunda condicao muda em tempo de
 * execucao: a pessoa entra em demonstracao, sai, e entra de novo com credencial.
 */
function MODO_DEMO_ATIVO() {
  return MODO_DEMO && lerSessao()?.demo === true;
}

/* ===== Sessao ============================================================= */

/**
 * Entra em modo demonstracao. So existe em desenvolvimento.
 *
 * Devolve a mesma forma que entrar(), mais `demo: true`, que e o que faz as
 * demais chamadas desta camada usarem o dataset ficticio.
 */
export async function entrarDemo() {
  if (!MODO_DEMO) throw new ErroApi('demo_indisponivel');
  const dados = await demoEntrar();
  return { ...dados, demo: true };
}

/** POST carbon-ss-login -> { token, projetos, nome } */
export async function entrar(email, senha) {
  const { dados } = await chamar('carbon-ss-login', {
    metodo: 'POST',
    corpo: { email, senha },
    comToken: false,
  });
  return dados;
}

/** POST carbon-ss-senha -> { trocada: true } */
export async function trocarSenha(senhaAtual, senhaNova) {
  if (MODO_DEMO_ATIVO()) return demoTrocarSenha();
  const { dados } = await chamar('carbon-ss-senha', {
    metodo: 'POST',
    corpo: { senha_atual: senhaAtual, senha_nova: senhaNova },
  });
  return dados;
}

/* ===== Arquivos =========================================================== */

/** GET carbon-ss-listar -> { itens, caminho }. Um nível por chamada. */
export async function listar(projetoId, sub = '') {
  if (MODO_DEMO_ATIVO()) return demoListar(projetoId, sub);
  const { dados } = await chamar('carbon-ss-listar', {
    consulta: { projeto_id: projetoId, sub },
  });
  return dados;
}

/** GET carbon-ss-arvore -> { arquivos, total, bytes, ignorados, truncado } */
export async function arvore(projetoId, sub = '') {
  if (MODO_DEMO_ATIVO()) return demoArvore(projetoId, sub);
  const { dados } = await chamar('carbon-ss-arvore', {
    consulta: { projeto_id: projetoId, sub },
  });
  return dados;
}

/**
 * URL de um arquivo, com o token na query.
 *
 * O token vai na URL porque `<iframe>` e `<a download>` nao mandam header. E
 * aceitavel: ele dura 8 horas, a resposta vai com Cache-Control: no-store e o
 * servidor confere a permissao do item a cada requisicao. Ainda assim, esta URL
 * NAO deve ser colada em lugar nenhum - quem a tiver, tem a sessão.
 */
export function urlArquivo(projetoId, caminho, modo = 'download') {
  const sessao = lerSessao();
  const params = new URLSearchParams({
    projeto_id: projetoId,
    caminho,
    modo,
    token: sessao?.token ?? '',
  });
  return `${caminhoFuncao('carbon-ss-baixar')}?${params}`;
}

/** Bytes de um arquivo, para montar o ZIP no navegador. */
export async function baixarBytes(projetoId, caminho, signal) {
  if (MODO_DEMO_ATIVO()) return demoBaixar(projetoId, caminho);
  const resposta = await fetch(urlArquivo(projetoId, caminho, 'download'), {
    headers: cabecalhos(),
    signal,
  });
  if (!resposta.ok) {
    throw new ErroApi(null, { status: resposta.status });
  }
  return resposta;
}

/**
 * POST carbon-ss-enviar (multipart) -> { enviados, falhas, pasta }
 *
 * Sem Content-Type na mao: o navegador precisa montar o boundary do multipart.
 * Sem o timeout padrao: um envio grande passa de 20 segundos com folga.
 */
export async function enviar(projetoId, itens, { signal } = {}) {
  if (MODO_DEMO_ATIVO()) return demoEnviar(projetoId, itens);
  const formulario = new FormData();
  formulario.append('projeto_id', projetoId);
  for (const { arquivo, subPath } of itens) {
    formulario.append('arquivo', arquivo, arquivo.name);
    formulario.append('caminho', subPath || '');
  }

  let resposta;
  try {
    resposta = await fetch(caminhoFuncao('carbon-ss-enviar'), {
      method: 'POST',
      headers: cabecalhos(),
      body: formulario,
      signal,
    });
  } catch {
    throw new ErroApi('falha_rede');
  }

  const dados = await resposta.json().catch(() => null);

  if (!resposta.ok && resposta.status !== 207) {
    if (resposta.status === 401) limparSessao();
    throw new ErroApi(dados?.erro ?? null, { status: resposta.status });
  }

  return { status: resposta.status, ...(dados ?? {}) };
}

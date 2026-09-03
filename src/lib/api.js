import { caminhoFuncao, USA_CAMINHO_RELATIVO } from '@/lib/endpoint';
import {
  MODO_DEMO,
  demoArvore,
  demoBaixar,
  demoEntrar,
  demoEntrarComCodigo,
  demoEnviar,
  demoListar,
  demoPedirCodigo,
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
  constructor(codigo, { status = null, detalhe = null, mensagem = null, espere = null } = {}) {
    super(mensagem || codigo || 'erro_api');
    this.name = 'ErroApi';
    this.codigo = codigo;
    this.status = status;
    this.detalhe = detalhe;
    /**
     * Segundos que o servidor pediu para esperar antes do proximo pedido de
     * codigo. So o freio de reenvio preenche isto; nas demais falhas fica null.
     * E numero, e nao texto: quem o consome e um contador regressivo.
     */
    this.espere = espere;
  }
}

/* ===== Codigo de entrada ================================================== */

/**
 * Quantos digitos tem o codigo que chega por e-mail.
 *
 * ESTA CONSTANTE MANDA NA SEGURANCA DA ENTRADA. A conta, para ninguem
 * "simplificar" depois:
 *
 *   espaco de busca            10^6 = 1.000.000 combinacoes
 *   palpites por codigo vivo   5 (carbon_secure_share_conferir_codigo)
 *   codigos vivos por endereco ate 3 (p_vivos de carbon_secure_share_codigo_registrar)
 *   pedidos por endereco/dia   20 (p_teto_dia de carbon_secure_share_pedido_registrar)
 *
 * Com 5 pedidos por dia na caixa da vitima (ataque ja barulhento), sao 25
 * palpites por dia: 25/10^6 por dia, cerca de 1% de chance por endereco por ano.
 * Com o teto diario cheio, 20 pedidos, sao 100 palpites por dia e a conta sobe
 * para cerca de 3,6% ao ano.
 *
 * Ou seja: com 6 digitos o TETO DIARIO NAO E CONFORTO, E DEFESA. Nao aumente o
 * teto sem refazer esta conta; se precisar de folga, aumente os digitos - cada
 * digito a mais divide a chance por dez. Foram 6 por decisao do dono; o plano
 * recomendava 8.
 *
 * ATENCAO: existe uma SEGUNDA copia deste numero em
 * supabase/functions/_shared/otp.ts (Deno, outro runtime, sem import possivel
 * daqui). As duas precisam bater. Se o servidor gerar mais digitos do que o
 * campo aceita, ninguem entra e o sintoma e "codigo invalido" para todo mundo.
 */
export const DIGITOS_CODIGO = 6;

/** Validade do codigo, quando o servidor nao disser outra. Espelha p_minutos. */
export const MINUTOS_CODIGO_PADRAO = 10;

/** Freio entre dois pedidos, quando o servidor nao disser outro. Espelha p_seg_freio. */
export const SEGUNDOS_REENVIO_PADRAO = 60;

/** Teto do contador regressivo, em segundos. Ver normalizarEspera(). */
const ESPERA_MAXIMA_S = 15 * 60;

/**
 * Traz o `espere` do servidor para uma faixa que faz sentido na tela.
 *
 * Existe porque o numero vem de fora e alimenta um contador: um valor absurdo
 * (negativo, texto, 10^9) travaria o botao de reenvio para sempre sem nenhum
 * aviso, e a pessoa ficaria sem caminho de saida numa tela que nao tem senha.
 */
function normalizarEspera(bruto) {
  const n = Number(bruto);
  if (!Number.isFinite(n) || n <= 0) return SEGUNDOS_REENVIO_PADRAO;
  return Math.min(Math.ceil(n), ESPERA_MAXIMA_S);
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
    /*
     * A CAUSA DEPENDE DE COMO O BUILD SAIU, e mandar conferir a coisa errada
     * custa horas. Com caminho relativo, o suspeito e o rewrite da hospedagem.
     * Com endereco absoluto no bundle, o rewrite nem participa da chamada: o
     * suspeito passa a ser a funcao nao publicada ou o endereco errado na
     * variavel de build.
     */
    console.error(
      USA_CAMINHO_RELATIVO
        ? `[Secure Share] ${caminhoFuncao(funcao)} nao chegou a uma Edge Function ` +
            `(HTTP ${resposta.status}). Falta o rewrite de /api/* na hospedagem. ` +
            'Producao: Amplify > App settings > Rewrites and redirects, antes do catch-all da SPA. ' +
            'Desenvolvimento: defina SUPABASE_API_URL no ambiente do Vite.'
        : `[Secure Share] a chamada de ${funcao} nao chegou a uma Edge Function ` +
            `(HTTP ${resposta.status}). Este build chama o Supabase DIRETO, entao ` +
            'nao e rewrite: confira se a funcao esta publicada e se SUPABASE_API_URL ' +
            'do build aponta para o projeto certo.',
    );
    throw new ErroApi('proxy_nao_configurado', { status: resposta.status });
  }

  // 207 = envio parcial. Nao e erro: quem chamou precisa da lista do que subiu.
  if (!resposta.ok && resposta.status !== 207) {
    // Sessao invalida: limpamos aqui para a proxima renderizacao cair no login,
    // em vez de a tela ficar tentando com um token morto.
    if (resposta.status === 401) limparSessao();
    // `motivo` alem de `erro`: o corpo de freio de carbon-ss-codigo tem a MESMA
    // forma do corpo de sucesso ({ enviado, ... }), de proposito, e por isso
    // nomeia o codigo como `motivo`. Ler os dois campos evita que uma diferenca
    // de nome vire "erro generico" justamente no caminho que precisa dizer
    // quantos segundos faltam.
    throw new ErroApi(dados?.erro ?? dados?.motivo ?? null, {
      status: resposta.status,
      detalhe: dados?.detalhe ?? null,
      espere: dados?.espere ?? null,
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

/**
 * Trinco da demonstracao NA TELA DE LOGIN.
 *
 * MODO_DEMO_ATIVO() depende de `sessao.demo`, que so existe DEPOIS de entrar -
 * por isso a tela de login era a unica que a demonstracao nao alcancava. Com a
 * entrada em duas etapas isso deixou de ser aceitavel: o pedido de codigo e a
 * conferencia do codigo sao metade do fluxo e precisam ser revisaveis sem rede.
 *
 * E `let` de modulo, e nao storage: some no F5. Isso e proposital - uma
 * demonstracao esquecida ligada faria uma tentativa de login de verdade cair no
 * dataset ficticio em silencio. O outro lado da mesma trava e
 * desligarDemoAntesDoLogin(), que a tela chama ao montar.
 *
 * Em producao o trinco nao existe: ligarDemoNoLogin() grava MODO_DEMO, que e
 * false, e DEMO_NO_LOGIN() comeca por MODO_DEMO, entao o Rollup dobra a condicao
 * e elimina os ramos junto com src/lib/demo.js.
 */
let demoNoLogin = false;

/** Liga a demonstracao para esta tentativa de login. So vale em desenvolvimento. */
export function ligarDemoNoLogin() {
  demoNoLogin = MODO_DEMO;
}

/** Desliga o trinco. A tela de login chama ao montar, para nao herdar estado. */
export function desligarDemoAntesDoLogin() {
  demoNoLogin = false;
}

function DEMO_NO_LOGIN() {
  return MODO_DEMO && demoNoLogin;
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

/**
 * Etapa 1: POST carbon-ss-codigo { email }.
 *
 * O SERVIDOR RESPONDE A MESMA COISA PARA ENDERECO COM E SEM CADASTRO - 200 com
 * corpo identico, inclusive quando o envio falha. Confirmar que um e-mail tem
 * cadastro ja diria que aquela pessoa e cliente da APSIS num projeto de carbono.
 * Esta funcao existe para preservar isso do lado de ca.
 *
 * POR QUE O FREIO VOLTA COMO DADO, E NAO COMO EXCECAO. Os dois 429
 * (`espere` e `teto_diario`) sao contados por resumo do endereco e existem para
 * endereco com e sem cadastro, entao nao sao falha da pessoa nem oraculo: a tela
 * precisa avancar para a etapa do codigo do mesmo jeito, porque quem pediu de
 * novo em menos de um minuto provavelmente ja tem um codigo valido na caixa.
 * Devolvendo dado, existe UM caminho no chamador. Se fosse excecao, avancar
 * dependeria de alguem lembrar de repetir a transicao dentro do `catch`, e o
 * esquecimento apareceria como comportamento diferente por endereco - que e
 * exatamente o vazamento que este endpoint foi desenhado para nao ter.
 *
 * Devolve sempre:
 *   { enviado, minutos, freio: null|'espere'|'teto_diario', espere: numero|null }
 * Em demonstracao vem tambem `codigoDemo`, que em producao nao existe (o ramo
 * inteiro sai do bundle).
 *
 * Continua lancando ErroApi em 400 `email_invalido`, falha de rede, timeout e
 * rewrite ausente: nesses casos nao houve resposta do fluxo, e a tela fica onde
 * esta.
 */
export async function pedirCodigo(email) {
  if (DEMO_NO_LOGIN()) {
    const ficticio = await demoPedirCodigo(email, DIGITOS_CODIGO);
    return {
      enviado: true,
      minutos: ficticio.minutos,
      freio: null,
      espere: null,
      codigoDemo: ficticio.codigo,
    };
  }

  try {
    const { dados } = await chamar('carbon-ss-codigo', {
      metodo: 'POST',
      corpo: { email },
      comToken: false,
    });
    const minutos = Number(dados?.minutos);
    return {
      enviado: dados?.enviado === true,
      minutos: Number.isFinite(minutos) && minutos > 0 ? minutos : MINUTOS_CODIGO_PADRAO,
      freio: null,
      espere: null,
    };
  } catch (e) {
    const freio = e?.status === 429 && (e.codigo === 'espere' || e.codigo === 'teto_diario');
    if (!freio) throw e;
    return {
      enviado: false,
      minutos: MINUTOS_CODIGO_PADRAO,
      freio: e.codigo,
      espere: e.codigo === 'espere' ? normalizarEspera(e.espere) : null,
    };
  }
}

/**
 * Etapa 2: POST carbon-ss-entrar { email, codigo } -> { token, projetos, nome }.
 *
 * O codigo vai no CORPO, nunca em query string: URL entra no historico do
 * navegador, no log da hospedagem e no Referer, e a maquina do cliente costuma
 * ser compartilhada.
 *
 * Erros esperados, todos traduzidos por textoDoErro():
 *   401 codigo_invalido      errado, inexistente, expirado ou pausado - UM erro
 *                            so, porque distinguir "muitas tentativas" ja diria
 *                            que existe codigo vivo para aquele endereco;
 *   403 acesso_indisponivel  o codigo conferiu e a autorizacao nao veio.
 */
export async function entrarComCodigo(email, codigo) {
  if (DEMO_NO_LOGIN()) {
    const dados = await demoEntrarComCodigo(email, codigo, DIGITOS_CODIGO);
    // `demo: true` marcado AQUI, igual a entrarDemo(): e o que faz as demais
    // chamadas desta camada usarem o dataset ficticio e a faixa de "isto e
    // ficticio" aparecer na tela de arquivos. Sem ele, um F5 prenderia a aba
    // numa sessao ficticia que a proxima chamada tentaria usar contra a rede.
    return { ...dados, demo: true };
  }
  const { dados } = await chamar('carbon-ss-entrar', {
    metodo: 'POST',
    corpo: { email, codigo },
    comToken: false,
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
export async function enviar(projetoId, itens, { destino = '', signal } = {}) {
  if (MODO_DEMO_ATIVO()) return demoEnviar(projetoId, itens, destino);
  const formulario = new FormData();
  formulario.append('projeto_id', projetoId);
  // Pasta de destino, relativa a raiz do projeto. '' = raiz.
  formulario.append('destino', destino);
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

import { caminhoFuncao } from '@/lib/endpoint';
import { lerSessao, limparSessao } from '@/lib/sessao';

/**
 * api - chamadas as Edge Functions do Secure Share Carbon.
 *
 * Uma funcao por operacao, todas com o token de sessao no Authorization. Nenhuma
 * fala com o banco: quem confere a permissao por item e o servidor, a cada
 * requisicao.
 */

const TIMEOUT_MS = 20000;

export class ErroApi extends Error {
  constructor(mensagem, { codigo = null, status = null, detalhe = null } = {}) {
    super(mensagem);
    this.name = 'ErroApi';
    this.codigo = codigo;
    this.status = status;
    this.detalhe = detalhe;
  }
}

/**
 * Texto de interface para cada codigo do contrato.
 *
 * Escritos para um LEITOR EXTERNO. Ele nao sabe o que e Edge Function, Graph nem
 * SharePoint, e nao pode fazer nada a respeito: a mensagem diz o que aconteceu e
 * a quem recorrer, sem termo interno.
 */
const MENSAGENS = {
  credenciais_obrigatorias: 'Informe o e-mail e a senha.',
  credenciais_invalidas: 'E-mail ou senha incorretos.',
  muitas_tentativas:
    'Muitas tentativas seguidas. Aguarde alguns minutos antes de tentar de novo.',
  nao_autenticado: 'Sua sessão expirou. Entre novamente.',
  sem_acesso_ao_projeto: 'Você não tem acesso a este projeto.',
  sem_acesso_ao_arquivo: 'Você não tem acesso a este arquivo.',
  somente_visualizacao:
    'Este arquivo é somente para visualização. O download não está liberado para você.',
  nao_encontrado: 'O arquivo não foi encontrado. Ele pode ter sido movido ou removido.',
  item_e_pasta: 'O item pedido é uma pasta.',
  caminho_obrigatorio: 'Arquivo não informado.',
  previa_indisponivel:
    'Não foi possível gerar a visualização deste arquivo. Baixe o arquivo para abrir.',
  armazenamento_indisponivel:
    'O sistema está temporariamente indisponível. Tente novamente em alguns minutos.',
  sharepoint_falhou: 'O sistema não conseguiu acessar os arquivos agora. Tente novamente.',
  falha_ao_buscar: 'Não foi possível baixar o arquivo agora. Tente novamente.',
  arquivo_obrigatorio: 'Selecione ao menos um arquivo.',
  arquivos_demais: 'Muitos arquivos de uma vez. Envie em lotes menores.',
  campos_obrigatorios: 'Preencha todos os campos.',
  senha_curta: 'A nova senha precisa de pelo menos 12 caracteres.',
  senha_igual_a_atual: 'A nova senha precisa ser diferente da atual.',
  senha_atual_incorreta: 'A senha atual está incorreta.',
  erro_interno: 'Algo deu errado do nosso lado. Tente novamente em alguns instantes.',
};

function mensagem(codigo, status) {
  if (MENSAGENS[codigo]) return MENSAGENS[codigo];
  if (status === 401) return MENSAGENS.nao_autenticado;
  if (status === 403) return 'Você não tem permissão para esta ação.';
  return MENSAGENS.erro_interno;
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
      throw new ErroApi('A operação demorou demais. Verifique a conexão e tente de novo.', {
        codigo: 'timeout',
      });
    }
    throw new ErroApi('Não foi possível falar com o servidor. Verifique a conexão.', {
      codigo: 'falha_rede',
    });
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
    throw new ErroApi(
      'O sistema não está configurado corretamente. Avise a pessoa da APSIS responsável pelo seu projeto.',
      { codigo: 'proxy_nao_configurado', status: resposta.status },
    );
  }

  // 207 = envio parcial. Nao e erro: quem chamou precisa da lista do que subiu.
  if (!resposta.ok && resposta.status !== 207) {
    // Sessao invalida: limpamos aqui para a proxima renderizacao cair no login,
    // em vez de a tela ficar tentando com um token morto.
    if (resposta.status === 401) limparSessao();
    throw new ErroApi(mensagem(dados?.erro, resposta.status), {
      codigo: dados?.erro ?? null,
      status: resposta.status,
      detalhe: dados?.detalhe ?? null,
    });
  }

  return { status: resposta.status, dados };
}

/* ===== Sessao ============================================================= */

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
  const { dados } = await chamar('carbon-ss-senha', {
    metodo: 'POST',
    corpo: { senha_atual: senhaAtual, senha_nova: senhaNova },
  });
  return dados;
}

/* ===== Arquivos =========================================================== */

/** GET carbon-ss-listar -> { itens, caminho }. Um nível por chamada. */
export async function listar(projetoId, sub = '') {
  const { dados } = await chamar('carbon-ss-listar', {
    consulta: { projeto_id: projetoId, sub },
  });
  return dados;
}

/** GET carbon-ss-arvore -> { arquivos, total, bytes, ignorados, truncado } */
export async function arvore(projetoId, sub = '') {
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
  const resposta = await fetch(urlArquivo(projetoId, caminho, 'download'), {
    headers: cabecalhos(),
    signal,
  });
  if (!resposta.ok) {
    throw new ErroApi(mensagem(null, resposta.status), { status: resposta.status });
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
    throw new ErroApi('Não foi possível enviar agora. Verifique a conexão.', {
      codigo: 'falha_rede',
    });
  }

  const dados = await resposta.json().catch(() => null);

  if (!resposta.ok && resposta.status !== 207) {
    if (resposta.status === 401) limparSessao();
    throw new ErroApi(mensagem(dados?.erro, resposta.status), {
      codigo: dados?.erro ?? null,
      status: resposta.status,
    });
  }

  return { status: resposta.status, ...(dados ?? {}) };
}

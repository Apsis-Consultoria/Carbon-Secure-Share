// -----------------------------------------------------------------------------
// Token de sessao assinado (HMAC-SHA256) do cliente externo.
// -----------------------------------------------------------------------------
// O cliente NAO tem conta no Azure AD: ele entra com e-mail e senha. Em vez de
// confiar em "email/projeto" enviados pelo navegador a cada chamada, a funcao de
// login emite um token assinado com SESSION_SECRET que ja carrega os projetos
// autorizados. As demais funcoes so validam a assinatura e DERIVAM o projeto do
// proprio token.
//
// Foi assim que o secure_share fechou o IDOR original, e a regra continua valendo
// aqui: nenhuma funcao aceita projeto vindo do corpo ou da query como verdade.
//
// DIFERENCA EM RELACAO AO secure_share: la o projeto no token e o par
// (ap_os, empresa) em texto, e as funcoes casam por `ap_os` string. Aqui e o
// UUID de carbon_secure_share_projetos. Dois ganhos concretos:
//
//   1. renomear o AP/OS ou a empresa nao invalida a sessao aberta nem, pior,
//      faz o token casar com OUTRO projeto que passou a ter aquele ap_os;
//   2. projeto sem AP/OS (que existe: a caixa "Nao ha AP/OS") tem chave vazia no
//      modelo antigo, e `authorizedProject('')` devolve null - ou seja, cliente
//      de projeto sem AP/OS simplesmente nao conseguiria abrir arquivo nenhum.
//
// Formato: base64url(JSON) + "." + base64url(HMAC).

const codificador = new TextEncoder();
const decodificador = new TextDecoder();

/**
 * Identificador reservado da pasta GERAL.
 *
 * Nao e um uuid de proposito: nenhum projeto real pode colidir com ele, e a
 * diferenca salta aos olhos em log e em URL. A Geral entra na sessao como se
 * fosse um projeto, e por isso listar, visualizar e baixar funcionam sem
 * nenhuma ramificacao. O que ela NAO permite - enviar - e barrado em um unico
 * ponto, no carbon-ss-enviar.
 */
export const ID_GERAL = 'geral';

export interface ProjetoSessao {
  projeto_id: string;
  empresa: string;
  ap_os: string | null;
  /** Nome da pasta no SharePoint, calculado no banco. Autoritativo. */
  pasta: string;
  /**
   * true na Geral: o cliente le, nao escreve.
   *
   * Viaja DENTRO do token assinado, entao o navegador nao consegue forja-la.
   * Ainda assim o servidor nao confia so nela: carbon-ss-enviar tambem compara
   * com ID_GERAL, porque duas checagens independentes e o que separa um bug de
   * um vazamento.
   */
  somenteLeitura?: boolean;
}

export interface PayloadSessao {
  email: string;
  nome: string;
  projetos: ProjetoSessao[];
  iat: number;
  exp: number;
}

function b64urlCodificar(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecodificar(texto: string): Uint8Array {
  const norm = texto.replace(/-/g, '+').replace(/_/g, '/');
  const pad = norm.length % 4 ? '='.repeat(4 - (norm.length % 4)) : '';
  const bin = atob(norm + pad);
  const saida = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) saida[i] = bin.charCodeAt(i);
  return saida;
}

function segredo(): string {
  const valor = Deno.env.get('SESSION_SECRET');
  // 32 caracteres, e nao 16: este segredo protege o acesso a documento de
  // cliente sob NDA, e e o unico fator entre um token forjado e a pasta inteira.
  if (!valor || valor.length < 32) {
    throw new Error('SESSION_SECRET ausente ou com menos de 32 caracteres.');
  }
  return valor;
}

async function importarChave(): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    codificador.encode(segredo()),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

/**
 * Assina a sessao. TTL padrao de 8 horas: um dia util, sem obrigar o cliente a
 * relogar no meio de uma revisao de documentos.
 */
export async function assinarSessao(
  dados: { email: string; nome: string; projetos: ProjetoSessao[] },
  ttlSegundos = 60 * 60 * 8,
): Promise<string> {
  const agora = Math.floor(Date.now() / 1000);
  const payload: PayloadSessao = {
    email: dados.email,
    nome: dados.nome,
    projetos: dados.projetos,
    iat: agora,
    exp: agora + ttlSegundos,
  };

  const corpo = b64urlCodificar(codificador.encode(JSON.stringify(payload)));
  const chave = await importarChave();
  const assinatura = new Uint8Array(
    await crypto.subtle.sign('HMAC', chave, codificador.encode(corpo)),
  );
  return `${corpo}.${b64urlCodificar(assinatura)}`;
}

/** Valida assinatura e validade. Devolve o payload ou null. */
export async function verificarSessao(token: string): Promise<PayloadSessao | null> {
  if (!token || typeof token !== 'string') return null;

  const ponto = token.indexOf('.');
  if (ponto <= 0) return null;

  const corpo = token.slice(0, ponto);
  const assinatura = token.slice(ponto + 1);

  let valida = false;
  try {
    const chave = await importarChave();
    valida = await crypto.subtle.verify(
      'HMAC',
      chave,
      b64urlDecodificar(assinatura),
      codificador.encode(corpo),
    );
  } catch {
    return null;
  }
  if (!valida) return null;

  let payload: PayloadSessao;
  try {
    payload = JSON.parse(decodificador.decode(b64urlDecodificar(corpo)));
  } catch {
    return null;
  }

  if (!payload?.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
  if (!Array.isArray(payload.projetos)) return null;
  return payload;
}

/**
 * Token do header Authorization: Bearer, ou de ?token=.
 *
 * O query param existe porque `<iframe>` e `<img>` nao mandam header, e a
 * visualizacao de PDF depende disso. E aceitavel porque o token e de vida curta
 * e a resposta vai com Cache-Control: no-store; ainda assim, use o header
 * sempre que houver escolha.
 */
export function extrairToken(req: Request): string {
  const auth = req.headers.get('authorization') || '';
  const casou = auth.match(/^Bearer\s+(.+)$/i);
  if (casou) return casou[1].trim();
  try {
    return new URL(req.url).searchParams.get('token') || '';
  } catch {
    return '';
  }
}

/**
 * Projeto autorizado pelo id pedido, ou null.
 *
 * Devolve a entrada DO TOKEN, nunca o que veio na requisicao: e daqui que sai o
 * nome da pasta usado para montar o caminho no SharePoint.
 */
export function projetoAutorizado(
  payload: PayloadSessao,
  projetoId: string,
): ProjetoSessao | null {
  const alvo = (projetoId || '').trim();
  if (!alvo) return null;
  return (payload.projetos || []).find((p) => p.projeto_id === alvo) || null;
}

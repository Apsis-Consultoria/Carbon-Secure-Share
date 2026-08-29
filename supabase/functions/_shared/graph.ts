// -----------------------------------------------------------------------------
// Microsoft Graph app-only: SharePoint do Secure Share Carbon.
// -----------------------------------------------------------------------------
// O cliente externo nao tem conta no tenant da APSIS, entao nao existe token
// delegado possivel: o acesso ao SharePoint e SEMPRE com credencial de
// aplicativo (client credentials), que vive como secret da Edge Function.
//
// E por isso que a autorizacao tem de ser nossa, a cada requisicao: o Graph vai
// dizer sim para tudo que o aplicativo pode ler, e quem decide o que ESTE
// cliente pode ver e o par sessao + carbon_secure_share_permissoes.
//
// SECRETS, com prefixo AZURE_:
//   AZURE_PORTAL_TENANT_ID
//   AZURE_PORTAL_CLIENT_ID
//   AZURE_PORTAL_CLIENT_SECRET
//
// POR QUE O PREFIXO, e nao os nomes curtos AZURE_PORTAL_*: este sistema e o Portal
// Apsis Carbon rodam no MESMO projeto Supabase, e secret de Edge Function e por
// PROJETO. Com os dois lendo `AZURE_PORTAL_CLIENT_ID`, so um registro de aplicativo
// caberia no projeto e o outro ficaria morto - o sintoma seria um dos dois
// sistemas usando silenciosamente a credencial do outro.
//
// Sao dois registros no Azure de proposito. Este aqui atende o portal do
// CLIENTE, que e a superficie exposta na internet: isolar a credencial dele
// permite rotacionar e revogar sem derrubar o portal interno, e o log de entrada
// do Azure passa a dizer QUAL sistema fez cada chamada.
//
// Permissoes de APLICATIVO neste registro, com admin consent:
//   Sites.Selected   ler e escrever a biblioteca (autorizada site a site)
//   Mail.Send        enviar o codigo de acesso ao cliente
//
// Sem fallback para os nomes antigos de proposito: cair no secret do outro
// sistema em silencio e pior do que falhar com o nome exato na mensagem.

const GRAPH = 'https://graph.microsoft.com/v1.0';
const FOLGA_MS = 5 * 60 * 1000;

let tokenCache: { valor: string; expiraEm: number } | null = null;

export class ErroGraph extends Error {
  codigo: string;
  status: number;

  constructor(codigo: string, mensagem: string, status = 502) {
    super(mensagem);
    this.name = 'ErroGraph';
    this.codigo = codigo;
    this.status = status;
  }
}

function exigirEnv(nome: string): string {
  const valor = Deno.env.get(nome);
  if (!valor) throw new ErroGraph('graph_nao_configurado', `Secret ${nome} ausente.`, 503);
  return valor;
}

/** true quando os tres secrets do Azure existem. Usado para responder 503 cedo. */
export function temConfigAzure(): boolean {
  return Boolean(
    Deno.env.get('AZURE_PORTAL_TENANT_ID') &&
      Deno.env.get('AZURE_PORTAL_CLIENT_ID') &&
      Deno.env.get('AZURE_PORTAL_CLIENT_SECRET'),
  );
}

export async function obterToken(): Promise<string> {
  const agora = Date.now();
  if (tokenCache && tokenCache.expiraEm - FOLGA_MS > agora) return tokenCache.valor;

  const tenant = exigirEnv('AZURE_PORTAL_TENANT_ID');
  const corpo = new URLSearchParams({
    client_id: exigirEnv('AZURE_PORTAL_CLIENT_ID'),
    client_secret: exigirEnv('AZURE_PORTAL_CLIENT_SECRET'),
    // .default pede as permissoes de APLICATIVO ja consentidas. Listar escopo a
    // escopo nao funciona em client credentials: o Azure recusa com invalid_scope.
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials',
  });

  const resposta = await fetch(
    `https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: corpo,
    },
  );

  const dados = await resposta.json().catch(() => ({}));
  if (!resposta.ok || !dados.access_token) {
    // A descricao do Azure cita tenant, clientId e permissao faltante: vai para
    // o LOG, nunca para a resposta ao cliente externo.
    console.error('Falha no token app-only:', dados.error_description || dados.error);
    throw new ErroGraph('graph_sem_token', 'Falha ao autenticar no armazenamento.');
  }

  tokenCache = {
    valor: dados.access_token as string,
    expiraEm: agora + Number(dados.expires_in ?? 3600) * 1000,
  };
  return tokenCache.valor;
}

async function chamar(caminho: string, init: RequestInit = {}): Promise<Response> {
  const token = await obterToken();
  const url = caminho.startsWith('http') ? caminho : `${GRAPH}${caminho}`;
  return fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
  });
}

/**
 * Codifica um caminho para a sintaxe `/root:/<caminho>:`.
 *
 * Segmento a segmento: encodeURIComponent no caminho inteiro transformaria as
 * barras em %2F e o Graph procuraria um unico arquivo cujo nome contem barras,
 * em vez de descer na arvore.
 */
export function caminhoGraph(caminho: string): string {
  return caminho.split('/').filter(Boolean).map(encodeURIComponent).join('/');
}

// -----------------------------------------------------------------------------
// Site e biblioteca
// -----------------------------------------------------------------------------

export type ConfigSharePoint = {
  siteHost: string;
  sitePath: string;
  biblioteca: string;
  /**
   * Id da biblioteca no Graph, quando ja resolvido antes.
   *
   * NAO e configuracao que alguem preenche: e um valor DESCOBERTO, guardado
   * para nao ser redescoberto. Ver obterDriveId para o porque.
   */
  driveId?: string;
  /**
   * Pasta dentro da biblioteca onde TUDO do Carbon vive ('' = raiz).
   *
   * Existe porque o Carbon divide a biblioteca "Secure Share" com o Portal
   * Apsis: sem o prefixo, os projetos dos dois se misturariam na raiz. Use
   * sempre caminhoNaBiblioteca() de _shared/config.ts para monta-lo.
   */
  pastaBase: string;
  /**
   * Pasta, dentro da base, visivel a TODOS os clientes ('Geral').
   *
   * Somente leitura para o cliente. Quem escreve nela e a equipe da APSIS, pelo
   * Portal Carbon. Atencao operacional: o que entra aqui aparece para todos os
   * clientes de todos os projetos.
   */
  pastaGeral: string;
};

const cacheDrive = new Map<string, string>();

// Import de FUNCAO (nao so de tipo) de config.ts. Nao cria ciclo em tempo de
// execucao porque config.ts importa apenas `type ConfigSharePoint` daqui, e
// import de tipo desaparece na compilacao.
import { gravarDriveId } from './config.ts';


/**
 * TRAVA: nenhum caminho pode sair da pasta base.
 *
 * Chamada no topo de TODA funcao que toca um caminho. Nao e conveniencia, e
 * contencao: o consentimento do Azure (Sites.Selected) e por SITE, nao por
 * pasta, entao a credencial tecnicamente alcanca a biblioteca inteira -
 * inclusive os projetos do Portal Apsis, que dividem a mesma biblioteca
 * "Secure Share". O que impede o Carbon de escrever la e ESTE codigo.
 *
 * Por isso a checagem fica aqui embaixo, no unico ponto por onde todo caminho
 * passa, e nao em cada chamador. Esquecer o prefixo passa a ser um erro
 * barulhento em vez de uma escrita silenciosa na pasta errada.
 *
 * pastaBase vazia significa "a biblioteca inteira e o escopo": nesse caso nao
 * ha o que conferir.
 */
function exigirDentroDaBase(cfg: ConfigSharePoint, caminho: string): void {
  const base = (cfg.pastaBase ?? '').trim().replace(/^\/+|\/+$/g, '');
  if (!base) return;

  const alvo = String(caminho ?? '').replace(/^\/+/, '');
  if (alvo === base || alvo.startsWith(`${base}/`)) return;

  console.error(`Caminho fora da pasta base: "${alvo}" nao esta em "${base}".`);
  throw new ErroGraph(
    'fora_da_pasta_base',
    'Operacao recusada: o caminho esta fora da pasta do Apsis Carbon.',
    500,
  );
}

/**
 * Id da biblioteca no Graph, com TRES niveis de cache.
 *
 * O CUSTO QUE ISSO EVITA: resolver do zero sao DUAS idas ao Graph em serie -
 * `/sites/{host}:{path}` e depois `/sites/{id}/drives`, que lista todas as
 * bibliotecas do site so para achar uma pelo nome. Perto de 700 ms, e antes de
 * a requisicao comecar o trabalho que o cliente pediu.
 *
 * E isso acontecia em TODO isolate frio, de CADA uma das seis funcoes. O cache
 * de memoria (cacheDrive) so ajudava a partir da segunda chamada no mesmo
 * isolate, e o Supabase derruba isolate ocioso rapido - entao, na pratica, o
 * cliente pagava os 700 ms quase toda vez que voltava ao portal.
 *
 * Os tres niveis, do mais barato ao mais caro:
 *
 *   1. memoria     cacheDrive, valido enquanto o isolate viver;
 *   2. banco       cfg.driveId, que ja veio junto da configuracao, sem UMA
 *                  consulta a mais: lerConfigSharePoint sempre roda antes;
 *   3. Graph       so quando ninguem sabe, e o resultado e GRAVADO no banco.
 *
 * O id de uma biblioteca do SharePoint nao muda; ele so deixa de valer se a
 * biblioteca for apagada e recriada. Para esse caso existe esquecerDriveId, que
 * a funcao de chamada invoca ao receber 404 do Graph.
 */
export async function obterDriveId(cfg: ConfigSharePoint): Promise<string> {
  const chave = `${cfg.siteHost}${cfg.sitePath}::${cfg.biblioteca}`;

  const emMemoria = cacheDrive.get(chave);
  if (emMemoria) return emMemoria;

  if (cfg.driveId) {
    cacheDrive.set(chave, cfg.driveId);
    return cfg.driveId;
  }

  const respSite = await chamar(`/sites/${cfg.siteHost}:${cfg.sitePath}`, {
    headers: { Accept: 'application/json' },
  });
  if (!respSite.ok) {
    console.error('Site do SharePoint nao resolvido:', respSite.status);
    throw new ErroGraph('sharepoint_falhou', 'Armazenamento indisponivel.');
  }
  const site = await respSite.json();

  const respDrives = await chamar(`/sites/${site.id}/drives`, {
    headers: { Accept: 'application/json' },
  });
  if (!respDrives.ok) throw new ErroGraph('sharepoint_falhou', 'Armazenamento indisponivel.');

  const drives = await respDrives.json();
  const drive = (drives.value ?? []).find(
    (d: { name: string }) => d.name === cfg.biblioteca,
  );
  if (!drive) {
    console.error(`Biblioteca "${cfg.biblioteca}" nao existe em ${cfg.sitePath}.`);
    throw new ErroGraph('sharepoint_falhou', 'Armazenamento indisponivel.');
  }

  cacheDrive.set(chave, drive.id);
  // Grava para os proximos isolates. Falha aqui NAO derruba a requisicao: o id
  // ja esta em memoria e o pior caso e redescobrir na proxima partida fria.
  void gravarDriveId(drive.id);
  return drive.id;
}

/**
 * Descarta o driveId guardado, na memoria e no banco.
 *
 * Chamado quando o Graph responde 404 para a propria biblioteca, o que so
 * acontece se ela tiver sido apagada e recriada - o id novo e diferente. Sem
 * isto, o valor gravado no banco manteria o sistema quebrado ate alguem editar
 * a linha a mao, e o sintoma seria "o portal parou de achar os arquivos" sem
 * nada no codigo ter mudado.
 */
/** A biblioteca ainda existe com este id? Uma chamada, so usada no caminho 404. */
async function driveAindaExiste(driveId: string): Promise<boolean> {
  const r = await chamar(`/drives/${driveId}?$select=id`, {
    headers: { Accept: 'application/json' },
  });
  // Qualquer coisa que nao seja 404 conta como "existe": um 500 transitorio do
  // Graph nao pode fazer o sistema jogar fora um id que esta correto.
  return r.status !== 404;
}

export async function esquecerDriveId(cfg: ConfigSharePoint): Promise<void> {
  cacheDrive.delete(`${cfg.siteHost}${cfg.sitePath}::${cfg.biblioteca}`);
  await gravarDriveId(null);
}

// -----------------------------------------------------------------------------
// Itens
// -----------------------------------------------------------------------------

export type ItemGraph = {
  nome: string;
  tipo: 'pasta' | 'arquivo';
  tamanho: number | null;
  atualizadoEm: string | null;
};

/**
 * Conteudo de uma pasta.
 *
 * O `$select` NAO pede downloadUrl de proposito, e nenhuma funcao deste
 * repositorio a solicita. Ela e pre-autenticada: quem a recebesse baixaria o
 * arquivo cru, sem marca d'agua, contornando "somente visualizar". Todo byte
 * passa por carbon-ss-baixar.
 *
 * Pasta inexistente devolve lista vazia: projeto recem-criado, sem envio, nao e
 * erro.
 */
export async function listarPasta(
  cfg: ConfigSharePoint,
  caminho: string,
): Promise<ItemGraph[]> {
  exigirDentroDaBase(cfg, caminho);
  const driveId = await obterDriveId(cfg);
  const alvo = caminho
    ? `/drives/${driveId}/root:/${caminhoGraph(caminho)}:/children`
    : `/drives/${driveId}/root/children`;

  const resposta = await chamar(
    `${alvo}?$select=name,size,folder,file,lastModifiedDateTime&$top=999`,
    { headers: { Accept: 'application/json' } },
  );

  if (resposta.status === 404) {
    // 404 aqui tem DUAS causas, e elas pedem respostas opostas:
    //
    //   a pasta nao existe   -> lista vazia e a resposta certa (projeto novo
    //                           cuja pasta ainda nao foi criada, subpasta que o
    //                           cliente digitou na URL);
    //   o driveId envelheceu -> lista vazia seria MENTIRA. O cliente veria
    //                           "nenhum arquivo" num projeto cheio deles, e
    //                           ninguem procuraria defeito, porque a tela nao
    //                           errou visivelmente.
    //
    // O segundo caso so passou a existir quando o driveId virou valor guardado
    // no banco. Uma consulta barata separa os dois, e ela so acontece no 404.
    if (!(await driveAindaExiste(driveId))) {
      console.error('O driveId guardado nao vale mais; descartando para redescobrir.');
      await esquecerDriveId(cfg);
      throw new ErroGraph('sharepoint_falhou', 'Nao foi possivel listar os arquivos.');
    }
    return [];
  }
  if (!resposta.ok) {
    console.error('Falha ao listar pasta:', resposta.status);
    throw new ErroGraph('sharepoint_falhou', 'Nao foi possivel listar os arquivos.');
  }

  const dados = await resposta.json();
  return ((dados.value ?? []) as Record<string, unknown>[])
    .map((item) => ({
      nome: String(item.name ?? ''),
      tipo: (item.folder ? 'pasta' : 'arquivo') as 'pasta' | 'arquivo',
      tamanho: typeof item.size === 'number' ? item.size : null,
      atualizadoEm: (item.lastModifiedDateTime as string) ?? null,
    }))
    .sort((a, b) => {
      if (a.tipo !== b.tipo) return a.tipo === 'pasta' ? -1 : 1;
      return a.nome.localeCompare(b.nome, 'pt-BR');
    });
}

/** Metadados de um item pelo caminho. null quando nao existe. */
export async function obterItem(
  cfg: ConfigSharePoint,
  caminho: string,
): Promise<{ nome: string; tamanho: number; ehPasta: boolean } | null> {
  exigirDentroDaBase(cfg, caminho);
  const driveId = await obterDriveId(cfg);
  const resposta = await chamar(
    `/drives/${driveId}/root:/${caminhoGraph(caminho)}?$select=name,size,folder,file`,
    { headers: { Accept: 'application/json' } },
  );

  if (resposta.status === 404) return null;
  if (!resposta.ok) throw new ErroGraph('sharepoint_falhou', 'Arquivo indisponivel.');

  const item = await resposta.json();
  return {
    nome: String(item.name ?? ''),
    tamanho: Number(item.size) || 0,
    ehPasta: Boolean(item.folder),
  };
}

/**
 * Bytes de um arquivo. `formato: 'pdf'` pede a conversao do Graph.
 *
 * A conversao existe para o Office receber marca d'agua: sem ela, a alternativa
 * seria mandar o cliente para um visualizador externo, o que significa entregar
 * a URL do documento a um terceiro e nao poder estampar nada no arquivo.
 */
export async function obterConteudo(
  cfg: ConfigSharePoint,
  caminho: string,
  formato?: 'pdf',
): Promise<Response> {
  exigirDentroDaBase(cfg, caminho);
  const driveId = await obterDriveId(cfg);
  const consulta = formato ? `?format=${formato}` : '';
  return chamar(`/drives/${driveId}/root:/${caminhoGraph(caminho)}:/content${consulta}`);
}

/** Cria a pasta se faltar, nivel a nivel. Idempotente. */
export async function garantirPasta(cfg: ConfigSharePoint, caminho: string): Promise<void> {
  exigirDentroDaBase(cfg, caminho);
  const driveId = await obterDriveId(cfg);
  const segmentos = caminho.split('/').filter(Boolean);

  for (let i = 0; i < segmentos.length; i++) {
    const atual = segmentos.slice(0, i + 1).join('/');
    const existe = await chamar(`/drives/${driveId}/root:/${caminhoGraph(atual)}`);
    if (existe.ok) continue;

    const pai = segmentos.slice(0, i).join('/');
    const alvo = pai
      ? `/drives/${driveId}/root:/${caminhoGraph(pai)}:/children`
      : `/drives/${driveId}/root/children`;

    const criacao = await chamar(alvo, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: segmentos[i],
        folder: {},
        // 'fail' e nao 'rename': com rename o Graph criaria "Anexos 1" em
        // silencio e o arquivo iria para uma pasta que ninguem procura.
        '@microsoft.graph.conflictBehavior': 'fail',
      }),
    });

    // 409 = criada por outra requisicao entre o GET e o POST. Nao e erro.
    if (!criacao.ok && criacao.status !== 409) {
      console.error('Falha ao criar pasta:', criacao.status);
      throw new ErroGraph('sharepoint_falhou', 'Nao foi possivel preparar a pasta.');
    }
  }
}

/**
 * Envia um arquivo por upload simples (PUT de conteudo).
 *
 * NUNCA SOBRESCREVE. O PUT de conteudo do Graph substitui o arquivo existente
 * por padrao, e isso e inaceitavel aqui: o cliente escolhe a pasta de destino, e
 * um arquivo dele chamado "Relatorio.pdf" apagaria o "Relatorio.pdf" que a APSIS
 * enviou. Numa pasta de due diligence isso e perda de evidencia, silenciosa.
 *
 * Com conflictBehavior=rename o SharePoint cria "Relatorio 1.pdf" e devolve o
 * nome final, que subimos ate a tela para a pessoa saber que houve renomeacao em
 * vez de procurar um arquivo que "sumiu".
 *
 * @returns o nome final gravado, ou null se falhou.
 */
export async function enviarArquivo(
  cfg: ConfigSharePoint,
  caminho: string,
  corpo: ReadableStream | ArrayBuffer | Uint8Array,
  tipo: string,
): Promise<string | null> {
  exigirDentroDaBase(cfg, caminho);
  const driveId = await obterDriveId(cfg);
  const resposta = await chamar(
    `/drives/${driveId}/root:/${caminhoGraph(caminho)}:/content` +
      '?%40microsoft.graph.conflictBehavior=rename',
    {
      method: 'PUT',
      headers: { 'Content-Type': tipo || 'application/octet-stream' },
      body: corpo as BodyInit,
    },
  );

  if (!resposta.ok) {
    console.error('Falha no envio ao SharePoint:', resposta.status);
    await resposta.body?.cancel();
    return null;
  }

  // O Graph devolve o item criado. Lemos o nome final para detectar renomeacao;
  // o corpo precisa ser consumido de qualquer forma para liberar o socket.
  const item = await resposta.json().catch(() => null);
  return typeof item?.name === 'string' ? item.name : caminho.split('/').pop() ?? null;
}

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
// SECRETS: AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET.
// Permissoes de APLICATIVO no registro do app, com admin consent:
// Sites.ReadWrite.All. (Mail.Send fica no Portal Carbon, que e quem envia
// convite; este repositorio nao manda e-mail de acesso.)

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
    Deno.env.get('AZURE_TENANT_ID') &&
      Deno.env.get('AZURE_CLIENT_ID') &&
      Deno.env.get('AZURE_CLIENT_SECRET'),
  );
}

export async function obterToken(): Promise<string> {
  const agora = Date.now();
  if (tokenCache && tokenCache.expiraEm - FOLGA_MS > agora) return tokenCache.valor;

  const tenant = exigirEnv('AZURE_TENANT_ID');
  const corpo = new URLSearchParams({
    client_id: exigirEnv('AZURE_CLIENT_ID'),
    client_secret: exigirEnv('AZURE_CLIENT_SECRET'),
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

export async function obterDriveId(cfg: ConfigSharePoint): Promise<string> {
  const chave = `${cfg.siteHost}${cfg.sitePath}::${cfg.biblioteca}`;
  const emCache = cacheDrive.get(chave);
  if (emCache) return emCache;

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
  return drive.id;
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

  if (resposta.status === 404) return [];
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

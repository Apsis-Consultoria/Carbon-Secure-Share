// Cria a pasta "Geral" dentro da pasta base do Carbon no SharePoint.
//
// A "Geral" e a unica pasta que TODO cliente enxerga, e a unica que e somente
// leitura para o cliente: quem escreve nela e a equipe, pelo Portal Apsis
// Carbon. Ela nao e um projeto, e sim um pseudo-projeto de id reservado
// ('geral', em supabase/functions/_shared/sessao.ts), justamente para as
// funcoes de listar, baixar e arvore nao precisarem de um ramo separado.
//
// Nada no sistema cria esta pasta sozinho, e de proposito: se a criacao fosse
// automatica no primeiro acesso, um erro de digitacao na configuracao criaria
// uma "Geral" no lugar errado e ninguem perceberia. Ela nasce uma vez, aqui.
//
// COMO RODAR. As credenciais ficam so na sessao do terminal, nunca em arquivo.
//
//   PowerShell (o Read-Host evita o segredo cair no historico do PSReadLine):
//
//     $env:AZURE_PORTAL_TENANT_ID     = Read-Host "Tenant ID"
//     $env:AZURE_PORTAL_CLIENT_ID     = Read-Host "Client ID"
//     $env:AZURE_PORTAL_CLIENT_SECRET = Read-Host "Client Secret"
//     node scripts/criar-pasta-geral.mjs
//
// EXISTE UMA CREDENCIAL SO, desde 24/08/2026: AZURE_PORTAL_* sem prefixo, usada pelos
// dois sistemas. Os nomes AZURE_PORTAL_* e AZURE_SECURE_SHARE_* foram unificados
// porque passaram a guardar o mesmo valor, e dois nomes com o mesmo valor
// aparentam um isolamento que nao existe.
//
// E IDEMPOTENTE. Rodar duas vezes nao duplica nem apaga nada: usa
// conflictBehavior 'fail' e trata o 409 como "ja existe, tudo certo".
//
// No PowerShell 5.1 o separador de comandos e ';' - o '&&' nao funciona.

const GRAPH = 'https://graph.microsoft.com/v1.0';

// Mesmos defaults de supabase/functions/_shared/config.ts. Em producao vem da
// linha `secure_share` de carbon_app_config.
const SP_HOST = process.env.SP_HOST || 'apsisconsult.sharepoint.com';
const SP_SITE_PATH = process.env.SP_SITE_PATH || '/sites/Projetos';
const SP_BIBLIOTECA = process.env.SP_BIBLIOTECA || 'Secure Share';
const SP_PASTA_BASE = process.env.SP_PASTA_BASE || 'Apsis Carbon';
const SP_PASTA_GERAL = process.env.SP_PASTA_GERAL || 'Geral';

const cor = (c, s) => `\x1b[${c}m${s}\x1b[0m`;
const ok = (s) => console.log(`${cor(32, '  OK  ')} ${s}`);
const aviso = (s) => console.log(`${cor(33, ' AVISO')} ${s}`);
const erro = (s) => console.log(`${cor(31, ' ERRO ')} ${s}`);
const dica = (s) => console.log(`        ${cor(90, s)}`);

/** Codifica caminho segmento a segmento: encodeURIComponent inteiro comeria as barras. */
const caminhoSeg = (c) => c.split('/').filter(Boolean).map(encodeURIComponent).join('/');

// Dentro de main() para poder sair com `return` em vez de process.exit(): no
// Windows, process.exit() com socket de fetch aberto faz o libuv imprimir
// "Assertion failed" depois do resumo, o que parece defeito da ferramenta.
async function main() {
  /* ===== Credenciais ====================================================== */

  const { AZURE_PORTAL_TENANT_ID: TENANT, AZURE_PORTAL_CLIENT_ID: CLIENT, AZURE_PORTAL_CLIENT_SECRET: SEGREDO } =
    process.env;

  if (!TENANT || !CLIENT || !SEGREDO) {
    erro('Faltam as credenciais no ambiente.');
    dica('Veja o cabecalho deste arquivo para o comando do seu terminal.');
    process.exitCode = 1;
    return;
  }

  /* ===== Token ============================================================ */

  const respToken = await fetch(
    `https://login.microsoftonline.com/${encodeURIComponent(TENANT)}/oauth2/v2.0/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: CLIENT,
        client_secret: SEGREDO,
        scope: 'https://graph.microsoft.com/.default',
        grant_type: 'client_credentials',
      }),
    },
  );

  const dadosToken = await respToken.json();
  if (!respToken.ok || !dadosToken.access_token) {
    erro(`O Azure recusou a credencial: ${dadosToken.error || respToken.status}`);
    if (dadosToken.error_description) {
      dica(String(dadosToken.error_description).split('\n')[0]);
    }
    process.exitCode = 1;
    return;
  }
  const token = dadosToken.access_token;
  ok('Token de aplicativo obtido.');

  const graph = (caminho, init = {}) =>
    fetch(caminho.startsWith('http') ? caminho : `${GRAPH}${caminho}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
    });

  /* ===== Site e biblioteca ================================================ */

  const respSite = await graph(`/sites/${SP_HOST}:${SP_SITE_PATH}`);
  if (!respSite.ok) {
    erro(`Nao foi possivel abrir ${SP_SITE_PATH} (${respSite.status}).`);
    if (respSite.status === 403) dica('O app nao tem acesso a este site.');
    process.exitCode = 1;
    return;
  }
  const site = await respSite.json();
  ok(`Site: ${site.displayName ?? SP_SITE_PATH}`);

  const respDrives = await graph(`/sites/${site.id}/drives?$select=id,name`);
  const drives = respDrives.ok ? (await respDrives.json()).value ?? [] : [];
  const biblioteca = drives.find((d) => d.name === SP_BIBLIOTECA);

  if (!biblioteca) {
    erro(`A biblioteca "${SP_BIBLIOTECA}" nao existe neste site.`);
    dica(`Existem: ${drives.map((d) => d.name).join(', ') || '(nenhuma)'}`);
    process.exitCode = 1;
    return;
  }
  ok(`Biblioteca: ${SP_BIBLIOTECA}`);

  /* ===== Pastas =========================================================== */

  /**
   * Cria uma pasta e trata 409 como sucesso.
   *
   * conflictBehavior 'fail' e nao 'replace': 'replace' numa pasta que ja tem
   * conteudo e destrutivo no Graph. Aqui queremos exatamente o contrario -
   * se ja existe, deixe como esta.
   */
  async function garantirPasta(pastaPai, nome) {
    const alvo = pastaPai
      ? `/drives/${biblioteca.id}/root:/${caminhoSeg(pastaPai)}:/children`
      : `/drives/${biblioteca.id}/root/children`;

    const resp = await graph(alvo, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: nome,
        folder: {},
        '@microsoft.graph.conflictBehavior': 'fail',
      }),
    });

    const caminho = pastaPai ? `${pastaPai}/${nome}` : nome;

    if (resp.status === 409) {
      ok(`Ja existia: ${caminho}`);
      return true;
    }
    if (resp.ok) {
      ok(`Criada: ${caminho}`);
      return true;
    }

    erro(`Falha ao criar ${caminho} (${resp.status}).`);
    if (resp.status === 403) {
      dica('O app le mas nao escreve neste site. Falta permissao de escrita.');
    }
    if (resp.status === 404 && pastaPai) {
      dica(`A pasta "${pastaPai}" nao existe na biblioteca.`);
    }
    return false;
  }

  if (!(await garantirPasta('', SP_PASTA_BASE))) {
    process.exitCode = 1;
    return;
  }
  if (!(await garantirPasta(SP_PASTA_BASE, SP_PASTA_GERAL))) {
    process.exitCode = 1;
    return;
  }

  /* ===== Confirmacao ====================================================== */

  const respLista = await graph(
    `/drives/${biblioteca.id}/root:/${caminhoSeg(SP_PASTA_BASE)}:/children` +
      '?$select=name,folder,file&$top=50',
  );

  if (!respLista.ok) {
    aviso(`As pastas foram criadas, mas a leitura de volta falhou (${respLista.status}).`);
    return;
  }

  const itens = (await respLista.json()).value ?? [];
  console.log(`\nConteudo de ${SP_BIBLIOTECA}/${SP_PASTA_BASE}:`);
  if (!itens.length) console.log('        (vazia)');
  for (const item of itens) {
    console.log(`        ${item.folder ? '[pasta]' : '[arq]  '} ${item.name}`);
  }

  const temGeral = itens.some((i) => i.name === SP_PASTA_GERAL && i.folder);
  console.log('');
  if (temGeral) {
    ok(`"${SP_PASTA_GERAL}" confirmada dentro de "${SP_PASTA_BASE}".`);
    dica('Ela e somente leitura para o cliente. Quem escreve e o Portal Apsis Carbon.');
  } else {
    erro(`"${SP_PASTA_GERAL}" nao aparece na listagem. Confira no SharePoint.`);
    process.exitCode = 1;
  }
}

await main();

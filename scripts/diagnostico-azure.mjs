// Diagnostico do Azure AD e do SharePoint do Secure Share Carbon.
//
// Prova, ANTES de qualquer deploy, que a credencial de aplicativo funciona e que
// ela alcanca a biblioteca certa. Sem isto, o primeiro erro so apareceria com o
// sistema no ar, como "o armazenamento recusou o arquivo", sem dizer se o
// problema e o consentimento, o site, a biblioteca ou a permissao.
//
// Usa a identidade de APLICATIVO (client credentials), a mesma que as Edge
// Functions usam. E independente do seu usuario: se o app enxerga e o seu login
// nao, o que mudou foi o seu acesso, nao a pasta.
//
// COMO RODAR. As credenciais ficam so na sessao do terminal, nunca em arquivo.
//
//   PowerShell (o Read-Host evita o segredo cair no historico do PSReadLine):
//
//     $env:AZURE_SECURE_SHARE_TENANT_ID     = Read-Host "Tenant ID"
//     $env:AZURE_SECURE_SHARE_CLIENT_ID     = Read-Host "Client ID"
//     $env:AZURE_SECURE_SHARE_CLIENT_SECRET = Read-Host "Client Secret"
//     node scripts/diagnostico-azure.mjs --escrita
//
//   Git Bash:
//
//     read -s -p "Client Secret: " AZURE_SECURE_SHARE_CLIENT_SECRET
//     export AZURE_SECURE_SHARE_CLIENT_SECRET
//     export AZURE_SECURE_SHARE_TENANT_ID=...; export AZURE_SECURE_SHARE_CLIENT_ID=...
//     node scripts/diagnostico-azure.mjs --escrita
//
// Por padrao faz SOMENTE LEITURA. Para incluir o teste de escrita (cria uma
// pasta temporaria, envia um arquivo, le de volta e apaga tudo):
//
//     node scripts/diagnostico-azure.mjs --escrita
//
// ESTE DIAGNOSTICO E DO APP DO PORTAL DO CLIENTE. Sao DOIS registros no Azure,
// um por sistema, e por isso os secrets tem prefixo: AZURE_SECURE_SHARE_* aqui,
// AZURE_PORTAL_* no Portal Apsis Carbon. Os dois rodam no mesmo projeto
// Supabase, onde secret e por projeto: sem prefixo, um usaria a credencial do
// outro em silencio.
//
// O segredo NUNCA e impresso, nem em erro. Atencao: no PowerShell 5.1 o
// separador de comandos e ';' - o '&&' nao funciona.

const GRAPH = 'https://graph.microsoft.com/v1.0';

// Os mesmos valores default de supabase/functions/_shared/config.ts. Em
// producao eles vem da linha `secure_share` de carbon_app_config.
const SP_HOST = process.env.SP_HOST || 'apsisconsult.sharepoint.com';
const SP_SITE_PATH = process.env.SP_SITE_PATH || '/sites/Projetos';
const SP_BIBLIOTECA = process.env.SP_BIBLIOTECA || 'Secure Share';
// Pasta dentro da biblioteca onde tudo do Carbon vive. O teste de escrita
// acontece DENTRO dela, para nao sujar a raiz que o Portal Apsis usa.
const SP_PASTA_BASE = process.env.SP_PASTA_BASE ?? 'Apsis Carbon';

const TESTAR_ESCRITA = process.argv.includes('--escrita');

const {
  AZURE_SECURE_SHARE_TENANT_ID: AZURE_TENANT_ID,
  AZURE_SECURE_SHARE_CLIENT_ID: AZURE_CLIENT_ID,
  AZURE_SECURE_SHARE_CLIENT_SECRET: AZURE_CLIENT_SECRET,
} = process.env;

let falhou = false;

/* ===== Saida ============================================================== */

const cor = (c, s) => `\x1b[${c}m${s}\x1b[0m`;
const ok = (s) => console.log(`${cor(32, '  OK  ')} ${s}`);
const aviso = (s) => console.log(`${cor(33, ' AVISO')} ${s}`);
const erro = (s) => { falhou = true; console.log(`${cor(31, ' ERRO ')} ${s}`); };
const dica = (s) => console.log(`        ${cor(90, s)}`);

/** Codifica caminho segmento a segmento: encodeURIComponent inteiro comeria as barras. */
const caminhoSeg = (c) => c.split('/').filter(Boolean).map(encodeURIComponent).join('/');

function titulo(t) {
  console.log(`\n${cor(36, '='.repeat(66))}\n${cor(36, t)}\n${cor(36, '='.repeat(66))}`);
}

/**
 * Todo o diagnostico vive dentro de main().
 *
 * POR QUE NAO NO TOPO DO MODULO: para poder encerrar com `return` em vez de
 * process.exit(). No Windows, process.exit() com socket de fetch ainda aberto
 * faz o libuv imprimir "Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)"
 * DEPOIS do nosso resumo - o que parece defeito da ferramenta bem no momento em
 * que a pessoa esta tentando descobrir se o defeito e dela. Com exitCode o Node
 * drena as conexoes e sai limpo.
 */
async function main() {

/* ===== 1. Variaveis ======================================================= */

titulo('1. Credenciais no ambiente');

const faltando = [
  !AZURE_TENANT_ID && 'AZURE_SECURE_SHARE_TENANT_ID',
  !AZURE_CLIENT_ID && 'AZURE_SECURE_SHARE_CLIENT_ID',
  !AZURE_CLIENT_SECRET && 'AZURE_SECURE_SHARE_CLIENT_SECRET',
].filter(Boolean);

if (faltando.length) {
  erro(`Faltando no ambiente: ${faltando.join(', ')}`);
  dica('Veja o cabecalho deste arquivo para o comando do seu terminal.');
  process.exitCode = 1;
  return;
}

ok(`Tenant  ${AZURE_TENANT_ID}`);
ok(`Client  ${AZURE_CLIENT_ID}`);
// Do segredo mostramos apenas o comprimento: o suficiente para pegar o erro mais
// comum (colar o ID do segredo em vez do VALOR dele), sem revelar o conteudo.
ok(`Secret  ${AZURE_CLIENT_SECRET.length} caracteres`);
if (AZURE_CLIENT_SECRET.length < 30) {
  aviso('Segredo curto demais para um client secret do Azure.');
  dica('No portal, o campo que serve e o "Value", nao o "Secret ID".');
}

/* ===== 2. Token =========================================================== */

titulo('2. Token de aplicativo (client credentials)');

let token;
try {
  const resposta = await fetch(
    `https://login.microsoftonline.com/${encodeURIComponent(AZURE_TENANT_ID)}/oauth2/v2.0/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: AZURE_CLIENT_ID,
        client_secret: AZURE_CLIENT_SECRET,
        scope: 'https://graph.microsoft.com/.default',
        grant_type: 'client_credentials',
      }),
    },
  );

  const dados = await resposta.json();

  if (!resposta.ok || !dados.access_token) {
    erro(`O Azure recusou: ${dados.error || resposta.status}`);
    if (dados.error_description) dica(String(dados.error_description).split('\n')[0]);
    if (dados.error === 'invalid_client') {
      dica('Segredo errado, expirado, ou o Client ID nao e deste tenant.');
    }
    if (dados.error === 'unauthorized_client') {
      dica('O registro do app nao permite client credentials.');
    }
    process.exitCode = 1;
    return;
  }

  token = dados.access_token;
  ok(`Token obtido, valido por ${Math.round((dados.expires_in ?? 3600) / 60)} minutos`);
} catch (e) {
  erro(`Nao foi possivel falar com o login.microsoftonline.com: ${e.message}`);
  process.exitCode = 1;
  return;
}

/* ===== 3. Permissoes concedidas =========================================== */

titulo('3. Permissoes que o consentimento realmente concedeu');

// O payload do token de aplicativo traz a claim `roles` com as permissoes de
// APLICATIVO efetivamente consentidas. E a unica forma confiavel de saber se o
// "Grant admin consent" foi mesmo clicado: sem ele a lista vem vazia, ainda que
// o portal mostre as permissoes como "adicionadas".
let papeis = [];
try {
  const corpo = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
  const payload = JSON.parse(Buffer.from(corpo, 'base64').toString('utf8'));
  papeis = payload.roles ?? [];
} catch {
  aviso('Nao foi possivel ler as permissoes de dentro do token.');
}

if (!papeis.length) {
  erro('O token nao traz permissao de aplicativo NENHUMA.');
  dica('As permissoes foram adicionadas mas o consentimento do administrador');
  dica('nao foi concedido. No registro do app: API permissions > Grant admin consent.');
} else {
  for (const papel of papeis) ok(`Concedida: ${papel}`);

  const temSelected = papeis.includes('Sites.Selected');
  const temTudo = papeis.some((p) => p === 'Sites.ReadWrite.All' || p === 'Sites.FullControl.All');

  if (temTudo) {
    aviso('Sites.ReadWrite.All da acesso de escrita a TODOS os sites do tenant.');
    dica('Este segredo vai viver no Supabase. Se vazar, o alcance e a APSIS inteira.');
    dica('Prefira Sites.Selected e autorize apenas o site do Secure Share.');
    dica('Ver docs/configurar-azure.md, secao "Permissao minima".');
  } else if (temSelected) {
    ok('Sites.Selected: o alcance esta limitado aos sites autorizados um a um.');
    dica('Se o passo 4 der 403, falta autorizar ESTE site para o app.');
  } else {
    erro('Nenhuma permissao de SharePoint entre as concedidas.');
    dica('Falta Sites.Selected (preferido) ou Sites.ReadWrite.All.');
  }
}

/* ===== 4. Site e biblioteca =============================================== */

titulo('4. Site e biblioteca no SharePoint');

async function graph(caminho, init = {}) {
  return fetch(caminho.startsWith('http') ? caminho : `${GRAPH}${caminho}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
  });
}

let siteId = null;
let driveId = null;

const respSite = await graph(`/sites/${SP_HOST}:${SP_SITE_PATH}`);
if (respSite.status === 403) {
  erro(`403 ao abrir ${SP_SITE_PATH}: o app nao tem acesso a ESTE site.`);
  dica('Com Sites.Selected, um administrador precisa autorizar o app neste site.');
  dica('Ver docs/configurar-azure.md, secao "Permissao minima".');
} else if (respSite.status === 404) {
  erro(`404: o site ${SP_HOST}${SP_SITE_PATH} nao existe.`);
  dica('Confira o caminho. Ele tambem vive em carbon_app_config, chave secure_share.');
} else if (!respSite.ok) {
  erro(`O Graph respondeu ${respSite.status} ao abrir o site.`);
} else {
  const site = await respSite.json();
  siteId = site.id;
  ok(`Site encontrado: ${site.displayName ?? SP_SITE_PATH}`);

  const respDrives = await graph(`/sites/${siteId}/drives?$select=id,name`);
  if (!respDrives.ok) {
    erro(`Nao foi possivel listar as bibliotecas (${respDrives.status}).`);
  } else {
    const drives = (await respDrives.json()).value ?? [];
    const alvo = drives.find((d) => d.name === SP_BIBLIOTECA);

    if (!alvo) {
      erro(`A biblioteca "${SP_BIBLIOTECA}" nao existe neste site.`);
      dica(`Existem: ${drives.map((d) => d.name).join(', ') || '(nenhuma)'}`);
      dica('Crie no SharePoint e mantenha o nome IGUAL, inclusive maiusculas.');
    } else {
      driveId = alvo.id;
      ok(`Biblioteca encontrada: ${SP_BIBLIOTECA}`);
      if (SP_PASTA_BASE) dica(`Pasta base do Carbon: ${SP_PASTA_BASE}`);
    }
  }
}

/* ===== 5. Leitura ========================================================= */

if (driveId) {
  titulo('5. Leitura da biblioteca');

  const resp = await graph(`/drives/${driveId}/root/children?$select=name,folder&$top=20`);
  if (!resp.ok) {
    erro(`Leitura recusada (${resp.status}).`);
  } else {
    const itens = (await resp.json()).value ?? [];
    ok(`Leitura funcionou. ${itens.length} item(ns) na raiz.`);
    for (const item of itens.slice(0, 8)) {
      dica(`${item.folder ? '[pasta]' : '[arq]  '} ${item.name}`);
    }
    if (itens.length > 8) dica(`... e mais ${itens.length - 8}`);
  }
}

/* ===== 6. Escrita ========================================================= */

if (driveId && TESTAR_ESCRITA) {
  titulo('6. Escrita (cria, envia, le e apaga)');

  // Nome improvavel de colidir com pasta real, e apagado no fim de qualquer jeito.
  const nomeTemp = `_diagnostico-apsis-${Date.now()}`;
  const pasta = SP_PASTA_BASE ? `${SP_PASTA_BASE}/${nomeTemp}` : nomeTemp;
  let criou = false;

  // Cria dentro da pasta base. Se ela nao existir, o Graph devolve 404 aqui, e
  // e exatamente o aviso que queremos: a pasta precisa existir antes.
  const alvoCriacao = SP_PASTA_BASE
    ? `/drives/${driveId}/root:/${encodeURIComponent(SP_PASTA_BASE)}:/children`
    : `/drives/${driveId}/root/children`;

  const respPasta = await graph(alvoCriacao, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: nomeTemp,
      folder: {},
      '@microsoft.graph.conflictBehavior': 'fail',
    }),
  });

  if (!respPasta.ok) {
    erro(`Nao foi possivel criar pasta (${respPasta.status}).`);
    if (respPasta.status === 404 && SP_PASTA_BASE) {
      dica(`A pasta base "${SP_PASTA_BASE}" nao existe na biblioteca. Crie-a primeiro.`);
    }
    if (respPasta.status === 403) {
      dica('O app le mas nao escreve: falta permissao de ESCRITA neste site.');
      dica('Com Sites.Selected, o papel concedido precisa ser "write", nao "read".');
    }
  } else {
    criou = true;
    ok(`Pasta criada: ${pasta}`);

    const respUp = await graph(
      `/drives/${driveId}/root:/${caminhoSeg(pasta)}/teste.txt:/content` +
        '?%40microsoft.graph.conflictBehavior=rename',
      {
        method: 'PUT',
        headers: { 'Content-Type': 'text/plain' },
        body: 'diagnostico do Secure Share Carbon',
      },
    );

    if (!respUp.ok) {
      erro(`Envio recusado (${respUp.status}).`);
    } else {
      ok('Arquivo enviado.');

      const respLer = await graph(
        `/drives/${driveId}/root:/${caminhoSeg(pasta)}/teste.txt:/content`,
      );
      if (!respLer.ok) {
        erro(`Nao foi possivel ler o arquivo de volta (${respLer.status}).`);
      } else {
        const texto = await respLer.text();
        if (texto.includes('Secure Share Carbon')) ok('Arquivo lido de volta, conteudo confere.');
        else erro('O conteudo lido nao confere com o enviado.');
      }
    }
  }

  if (criou) {
    const respDel = await graph(`/drives/${driveId}/root:/${caminhoSeg(pasta)}`, {
      method: 'DELETE',
    });
    if (respDel.ok || respDel.status === 204) ok('Pasta de teste removida.');
    else {
      aviso(`A pasta de teste NAO foi removida (${respDel.status}). Apague a mao: ${pasta}`);
    }
  }
} else if (driveId) {
  titulo('6. Escrita');
  dica('Nao testada. Rode com --escrita para incluir (cria e apaga uma pasta temporaria).');
}

/* ===== Resumo ============================================================= */

titulo(falhou ? 'Resultado: HA PROBLEMAS' : 'Resultado: tudo certo');

if (falhou) {
  console.log('Corrija os itens marcados como ERRO acima.');
  console.log('O passo a passo esta em docs/configurar-azure.md.');
  process.exitCode = 1;
  return;
}

console.log('A credencial de aplicativo funciona e alcanca a biblioteca certa.');
console.log('Proximo passo: gravar os mesmos tres valores como secrets das Edge');
console.log('Functions no Supabase, com os nomes AZURE_SECURE_SHARE_TENANT_ID,');
console.log('AZURE_SECURE_SHARE_CLIENT_ID e AZURE_SECURE_SHARE_CLIENT_SECRET.');
console.log('Nunca em arquivo do repositorio.');

}

await main();

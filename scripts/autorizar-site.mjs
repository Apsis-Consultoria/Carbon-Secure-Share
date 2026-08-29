// Autoriza um aplicativo a escrever em UM site do SharePoint (Sites.Selected).
//
// POR QUE ESTE SCRIPT EXISTE
//
// `Sites.Selected` nao da acesso a nada sozinha: um administrador precisa
// autorizar o app site a site. Essa autorizacao e um `POST /sites/{id}/permissions`
// no Graph, e ela NAO tem tela no portal do Azure.
//
// Pior: esse endpoint nao aceita chamada DELEGADA. Ele exige `Sites.FullControl.All`
// como permissao de APLICATIVO. Por isso o Graph Explorer devolve 403 mesmo para
// quem e Global Administrator - o Explorer age em nome do usuario, e o endpoint
// so responde a token de aplicativo.
//
// A saida e o proprio app se autorizar, com `Sites.FullControl.All` LIGADA
// TEMPORARIAMENTE. E o que este script faz.
//
// -----------------------------------------------------------------------------
// COMO USAR - leia inteiro antes, o passo 3 nao e opcional
// -----------------------------------------------------------------------------
//
// 1. No Azure, no app que vai rodar isto (o "app de bootstrap"), acrescente
//    `Sites.FullControl.All` como permissao de APLICATIVO e clique em
//    "Conceder consentimento do administrador".
//
// 2. Rode este script. Ele autoriza no site os apps que voce listar.
//
//    PowerShell:
//      $env:AZURE_PORTAL_TENANT_ID     = Read-Host "Tenant ID"
//      $env:AZURE_PORTAL_CLIENT_ID     = Read-Host "Client ID (bootstrap)"
//      $env:AZURE_PORTAL_CLIENT_SECRET = Read-Host "Client Secret (bootstrap)"
//      node scripts/autorizar-site.mjs `
//        --app "<client-id>=<nome que aparece na permissao>" `
//        --app "<outro-client-id>=<outro nome>"
//
//    Sem `--app`, ele autoriza o proprio app de bootstrap.
//
// 3. VOLTE AO AZURE E REMOVA `Sites.FullControl.All` do app de bootstrap, e
//    conceda o consentimento de novo. Se voce pular este passo, o app fica com
//    controle total de TODO o SharePoint da APSIS - exatamente o que o
//    `Sites.Selected` existe para evitar, e o script vira um jeito elaborado de
//    nao ganhar nada. O script lembra disso no fim.
//
// `--listar` mostra quem ja esta autorizado no site, sem alterar nada.
// `--remover <id-da-permissao>` revoga uma autorizacao.

const GRAPH = 'https://graph.microsoft.com/v1.0';

const SP_HOST = process.env.SP_HOST || 'apsisconsult.sharepoint.com';
const SP_SITE_PATH = process.env.SP_SITE_PATH || '/sites/Projetos';

const {
  AZURE_PORTAL_TENANT_ID: TENANT,
  AZURE_PORTAL_CLIENT_ID: CLIENT_ID,
  AZURE_PORTAL_CLIENT_SECRET: CLIENT_SECRET,
} = process.env;

const cor = (c, s) => `\x1b[${c}m${s}\x1b[0m`;
const ok = (s) => console.log(`${cor(32, '  OK  ')} ${s}`);
const aviso = (s) => console.log(`${cor(33, ' AVISO')} ${s}`);
const erro = (s) => console.log(`${cor(31, ' ERRO ')} ${s}`);
const dica = (s) => console.log(`        ${cor(90, s)}`);
const titulo = (t) =>
  console.log(`\n${cor(36, '='.repeat(66))}\n${cor(36, t)}\n${cor(36, '='.repeat(66))}`);

/** `--app "<id>=<nome>"`, repetivel. */
function lerAlvos(argv) {
  const alvos = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] !== '--app') continue;
    const bruto = argv[i + 1] ?? '';
    const igual = bruto.indexOf('=');
    if (igual <= 0) {
      erro(`--app precisa do formato "<client-id>=<nome>". Recebido: ${bruto}`);
      return null;
    }
    alvos.push({ id: bruto.slice(0, igual).trim(), nome: bruto.slice(igual + 1).trim() });
  }
  return alvos;
}

async function main() {
  const LISTAR = process.argv.includes('--listar');
  const iRemover = process.argv.indexOf('--remover');
  const REMOVER = iRemover >= 0 ? process.argv[iRemover + 1] : null;

  titulo('1. Credenciais do app de bootstrap');

  const faltando = [
    !TENANT && 'AZURE_PORTAL_TENANT_ID',
    !CLIENT_ID && 'AZURE_PORTAL_CLIENT_ID',
    !CLIENT_SECRET && 'AZURE_PORTAL_CLIENT_SECRET',
  ].filter(Boolean);

  if (faltando.length) {
    erro(`Faltando no ambiente: ${faltando.join(', ')}`);
    dica('Veja o cabecalho deste arquivo.');
    process.exitCode = 1;
    return;
  }
  ok(`Bootstrap: ${CLIENT_ID}`);

  const alvos = lerAlvos(process.argv);
  if (alvos === null) {
    process.exitCode = 1;
    return;
  }
  if (!alvos.length && !LISTAR && !REMOVER) {
    alvos.push({ id: CLIENT_ID, nome: 'app de bootstrap' });
    dica('Sem --app: autorizando o proprio app de bootstrap.');
  }

  // ---- Token -----------------------------------------------------------
  titulo('2. Token de aplicativo');

  const respToken = await fetch(
    `https://login.microsoftonline.com/${encodeURIComponent(TENANT)}/oauth2/v2.0/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        scope: 'https://graph.microsoft.com/.default',
        grant_type: 'client_credentials',
      }),
    },
  );
  const dadosToken = await respToken.json();

  if (!respToken.ok || !dadosToken.access_token) {
    erro(`O Azure recusou: ${dadosToken.error || respToken.status}`);
    if (dadosToken.error_description) {
      dica(String(dadosToken.error_description).split('\n')[0]);
    }
    process.exitCode = 1;
    return;
  }
  const token = dadosToken.access_token;
  ok('Token obtido.');

  // A claim `roles` diz o que o consentimento concedeu de verdade. Sem
  // Sites.FullControl.All o passo 4 vai dar 403, e e melhor avisar agora.
  let papeis = [];
  try {
    const corpo = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    papeis = JSON.parse(Buffer.from(corpo, 'base64').toString('utf8')).roles ?? [];
  } catch {
    aviso('Nao foi possivel ler as permissoes de dentro do token.');
  }

  if (!papeis.includes('Sites.FullControl.All')) {
    erro('O app de bootstrap NAO tem Sites.FullControl.All de aplicativo.');
    dica(`Concedidas: ${papeis.join(', ') || '(nenhuma)'}`);
    dica('Sem ela o Graph recusa POST /sites/{id}/permissions com 403.');
    dica('Acrescente no Azure, conceda o consentimento, e rode de novo.');
    dica('E LEMBRE de remover depois. Ver o passo 3 no cabecalho deste arquivo.');
    process.exitCode = 1;
    return;
  }
  ok('Sites.FullControl.All presente (temporaria, ver o passo 3).');

  const chamar = (caminho, init = {}) =>
    fetch(`${GRAPH}${caminho}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        ...(init.headers ?? {}),
      },
    });

  // ---- Site ------------------------------------------------------------
  titulo('3. Site');

  const respSite = await chamar(`/sites/${SP_HOST}:${SP_SITE_PATH}`);
  if (!respSite.ok) {
    erro(`Nao foi possivel abrir ${SP_SITE_PATH} (${respSite.status}).`);
    process.exitCode = 1;
    return;
  }
  const site = await respSite.json();
  ok(`${site.displayName ?? SP_SITE_PATH}`);
  dica(site.id);

  // ---- Remover ---------------------------------------------------------
  if (REMOVER) {
    titulo('4. Revogar autorizacao');
    const resp = await chamar(`/sites/${site.id}/permissions/${REMOVER}`, { method: 'DELETE' });
    if (resp.ok || resp.status === 204) ok(`Autorizacao ${REMOVER} removida.`);
    else erro(`Nao foi possivel remover (${resp.status}).`);
  }

  // ---- Conceder --------------------------------------------------------
  if (alvos.length) {
    titulo('4. Autorizar no site');

    for (const alvo of alvos) {
      const resp = await chamar(`/sites/${site.id}/permissions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // 'write' e nao 'read': o cliente ENVIA arquivos, entao o app precisa
          // escrever. Com 'read' a listagem funciona e o envio falha, que e o
          // tipo de erro que so aparece no fim do teste.
          roles: ['write'],
          grantedToIdentities: [{ application: { id: alvo.id, displayName: alvo.nome } }],
        }),
      });

      if (resp.ok) {
        const criada = await resp.json();
        ok(`${alvo.nome} (${alvo.id}) autorizado com 'write'.`);
        dica(`id da permissao: ${criada.id}`);
      } else {
        const corpo = await resp.json().catch(() => ({}));
        erro(`${alvo.nome}: ${resp.status} ${corpo?.error?.code ?? ''}`);
        if (corpo?.error?.message) dica(corpo.error.message);
        process.exitCode = 1;
      }
    }
  }

  // ---- Listar ----------------------------------------------------------
  titulo('5. Quem esta autorizado neste site');

  const respLista = await chamar(`/sites/${site.id}/permissions`);
  if (!respLista.ok) {
    erro(`Nao foi possivel listar (${respLista.status}).`);
  } else {
    const itens = (await respLista.json()).value ?? [];
    if (!itens.length) aviso('Nenhuma autorizacao de aplicativo neste site.');
    for (const p of itens) {
      const apps = (p.grantedToIdentitiesV2 ?? p.grantedToIdentities ?? [])
        .map((g) => `${g.application?.displayName ?? '?'} (${g.application?.id ?? '?'})`)
        .join(', ');
      ok(`[${(p.roles ?? []).join(',')}] ${apps}`);
      dica(`id da permissao: ${p.id}`);
    }
  }

  titulo('NAO ESQUECA');
  console.log('Volte ao Azure e REMOVA Sites.FullControl.All do app de bootstrap,');
  console.log(`que e o ${CLIENT_ID}, e conceda o consentimento de novo.`);
  console.log('');
  console.log('Sem isso ele fica com controle total de TODO o SharePoint da APSIS,');
  console.log('e o Sites.Selected que voce acabou de configurar nao protege nada.');
  console.log('');
  console.log('Confira depois com: node scripts/diagnostico-azure.mjs --escrita');
}

await main();

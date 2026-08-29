// Diagnostico do envio de e-mail pelo Microsoft Graph.
//
// POR QUE ELE EXISTE, e por que roda ANTES de a autenticacao por codigo ser
// escrita: no modelo sem senha, o e-mail deixa de ser conveniencia e vira a
// UNICA forma de o cliente entrar. Se o Mail.Send de aplicativo nao estiver
// concedido, nao existe caminho alternativo - o portal fica inteiramente
// inacessivel para quem e de fora da APSIS.
//
// A unica "prova" que havia no repositorio de que essa permissao existe era um
// comentario em _shared/graph.ts dizendo o que e EXIGIDO. Exigido nao e
// concedido: uma permissao adicionada no portal do Azure e indistinguivel de
// uma permissao consentida, do lado de fora. Quem sabe a diferenca e a claim
// `roles` de dentro do token, que e o que este script le.
//
// COMO RODAR. As credenciais ficam so na sessao do terminal, nunca em arquivo.
//
//   PowerShell:
//     $env:AZURE_PORTAL_TENANT_ID     = Read-Host "Tenant ID"
//     $env:AZURE_PORTAL_CLIENT_ID     = Read-Host "Client ID"
//     $env:AZURE_PORTAL_CLIENT_SECRET = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR((Read-Host "Client Secret" -AsSecureString)))
//     node scripts/diagnostico-email.mjs
//
// EXISTE UMA CREDENCIAL SO, desde 24/08/2026: os secrets se chamam AZURE_PORTAL_* sem
// prefixo, e os dois sistemas usam o registro [Carbon] Portal. Antes havia
// AZURE_PORTAL_* e AZURE_SECURE_SHARE_*, mas os dois passaram a guardar o MESMO
// valor - e dois nomes com o mesmo valor aparentam um isolamento que nao existe,
// o que e pior do que assumir o compartilhamento.
//
// Por padrao NAO envia nada. Para incluir o envio de teste:
//
//     node scripts/diagnostico-email.mjs --enviar destinatario@apsis.com.br
//
// O destinatario tem que ser uma caixa do PROPRIO tenant, e de preferencia a
// sua. Nunca use e-mail de cliente real (LGPD).
//
// No PowerShell 5.1 o separador de comandos e ';' - o '&&' nao funciona.

const GRAPH = 'https://graph.microsoft.com/v1.0';

// Mesmo default de carbon_app_config, chave secure_share, campo remetente.
const REMETENTE = process.env.SP_REMETENTE || 'portal@apsis.com.br';

const cor = (c, s) => `\x1b[${c}m${s}\x1b[0m`;
const ok = (s) => console.log(`${cor(32, '  OK  ')} ${s}`);
const aviso = (s) => console.log(`${cor(33, ' AVISO')} ${s}`);
const erro = (s) => console.log(`${cor(31, ' ERRO ')} ${s}`);
const dica = (s) => console.log(`        ${cor(90, s)}`);

function titulo(t) {
  console.log(`\n${cor(36, '='.repeat(66))}\n${cor(36, t)}\n${cor(36, '='.repeat(66))}`);
}

// Dentro de main() para sair com `return` em vez de process.exit(): no Windows,
// process.exit() com socket de fetch aberto faz o libuv imprimir "Assertion
// failed" depois do resumo, o que parece defeito da ferramenta.
async function main() {
  const alvo = (() => {
    const i = process.argv.indexOf('--enviar');
    return i >= 0 ? process.argv[i + 1] : null;
  })();

  /* ===== Credenciais ====================================================== */

  titulo('1. Credencial');

  const { AZURE_PORTAL_TENANT_ID: TENANT, AZURE_PORTAL_CLIENT_ID: CLIENT, AZURE_PORTAL_CLIENT_SECRET: SEGREDO } =
    process.env;

  if (!TENANT || !CLIENT || !SEGREDO) {
    erro('Faltam as credenciais no ambiente.');
    dica('Veja o cabecalho deste arquivo para o comando do seu terminal.');
    process.exitCode = 1;
    return;
  }

  ok(`Client  ${CLIENT}`);

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

  /* ===== A permissao foi CONCEDIDA? ======================================= */

  titulo('2. Mail.Send esta na claim roles do token?');

  // A claim `roles` do token de aplicativo lista as permissoes efetivamente
  // CONSENTIDAS. E a unica forma confiavel: sem o "Grant admin consent" a lista
  // vem sem a permissao, ainda que o portal a mostre como adicionada.
  let papeis = [];
  try {
    const corpo = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    papeis = JSON.parse(Buffer.from(corpo, 'base64').toString('utf8')).roles ?? [];
  } catch {
    aviso('Nao foi possivel ler as permissoes de dentro do token.');
  }

  for (const papel of papeis) console.log(`        ${papel}`);
  if (!papeis.length) console.log('        (nenhuma)');

  const temMailSend = papeis.includes('Mail.Send');
  if (temMailSend) {
    ok('Mail.Send CONCEDIDA. A autenticacao por codigo tem como entregar o codigo.');
  } else {
    erro('Mail.Send NAO esta concedida neste registro.');
    dica('Sem ela o cliente nao recebe o codigo e, sem senha, nao entra de jeito nenhum.');
    dica('Pedido pronto ao TI em docs/pedido-ao-ti.md, item do Mail.Send.');
  }

  /* ===== A caixa remetente existe? ======================================== */

  titulo('3. A caixa remetente existe?');

  const respCaixa = await fetch(`${GRAPH}/users/${encodeURIComponent(REMETENTE)}?$select=mail,userPrincipalName,displayName`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (respCaixa.status === 404) {
    erro(`A caixa ${REMETENTE} NAO existe no tenant.`);
    dica('Opcoes: apontar `remetente` de carbon_app_config para uma caixa que ja');
    dica('exista (e so UPDATE, sem redeploy), ou pedir ao TI uma caixa');
    dica('COMPARTILHADA, que nao consome licenca e ainda recebe as respostas.');
  } else if (respCaixa.status === 403) {
    aviso('Sem permissao para consultar usuarios (User.Read.All ausente).');
    dica('Isso NAO impede o envio. So nao da para confirmar a caixa por aqui.');
  } else if (!respCaixa.ok) {
    aviso(`O Graph respondeu ${respCaixa.status} ao consultar a caixa.`);
  } else {
    const caixa = await respCaixa.json();
    ok(`Caixa encontrada: ${caixa.displayName ?? REMETENTE}`);
  }

  /* ===== Envio de teste =================================================== */

  titulo('4. Envio de teste');

  if (!alvo) {
    dica('Nao executado. Para incluir:');
    dica('  node scripts/diagnostico-email.mjs --enviar voce@apsis.com.br');
    dica('Use a SUA caixa. Nunca e-mail de cliente real (LGPD).');
  } else if (!temMailSend) {
    dica('Pulado: sem Mail.Send o envio falharia de qualquer forma.');
  } else {
    const resp = await fetch(`${GRAPH}/users/${encodeURIComponent(REMETENTE)}/sendMail`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: {
          subject: 'Apsis Carbon - teste de envio',
          body: {
            contentType: 'Text',
            content:
              'Mensagem de teste do diagnostico do Secure Share Carbon.\n' +
              'Se voce recebeu isto, o envio de codigo de acesso vai funcionar.',
          },
          toRecipients: [{ emailAddress: { address: alvo } }],
        },
        saveToSentItems: false,
      }),
    });

    if (resp.status === 202) {
      ok(`Aceito pelo Graph (202). Confira a caixa de ${alvo}.`);
      dica('202 significa aceito para entrega, nao entregue. Se nao chegar em');
      dica('alguns minutos, o problema passa a ser de Exchange, nao de permissao.');
    } else {
      const detalhe = await resp.text();
      erro(`O envio falhou (${resp.status}).`);
      if (resp.status === 403) {
        dica('403 aqui tem DUAS causas possiveis, e elas exigem acoes diferentes:');
        dica('  - Mail.Send ausente (mas o passo 2 disse que existe), ou');
        dica('  - Application Access Policy do Exchange restringindo este appId.');
      }
      if (resp.status === 404) {
        dica(`A caixa ${REMETENTE} nao existe. Ver o passo 3.`);
      }
      dica(detalhe.slice(0, 300));
    }
  }

  /* ===== Resumo =========================================================== */

  titulo(temMailSend ? 'Resultado: o caminho do e-mail existe' : 'Resultado: BLOQUEADO');

  if (!temMailSend) {
    console.log('A autenticacao por codigo depende desta permissao. Enquanto ela');
    console.log('nao vier, o codigo pode ser escrito, mas nao pode ser usado por');
    console.log('cliente nenhum. Rode com o outro prefixo antes de abrir chamado.');
    process.exitCode = 1;
    return;
  }

  console.log('Com Mail.Send concedida e a caixa remetente resolvida, a entrada');
  console.log('por codigo tem como entregar o codigo. Proximo passo: a migration');
  console.log('e as Edge Functions carbon-ss-codigo e carbon-ss-entrar.');
}

await main();

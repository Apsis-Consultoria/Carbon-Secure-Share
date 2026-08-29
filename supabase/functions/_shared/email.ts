// -----------------------------------------------------------------------------
// Envio de e-mail pelo Microsoft Graph (Mail.Send de APLICATIVO).
// -----------------------------------------------------------------------------
// Esta e a UNICA porta de entrada do cliente externo desde que a senha saiu de
// cena: se este arquivo falhar, ninguem entra no portal. Por isso cada modo de
// falha tem codigo proprio e log gritado - "email_falhou" generico faria a causa
// (consent ausente, caixa inexistente, secret nao configurado) custar uma tarde.
//
// TOKEN: reaproveita obterToken() de _shared/graph.ts, que ja le
// AZURE_PORTAL_* e mantem cache proprio DESTE repositorio. O risco que o
// plano levantou - dois conjuntos de credencial dividindo um cache de modulo, e
// o primeiro chamador do isolate vencendo por ate uma hora - nao existe aqui:
// no Secure Share ha um par de credenciais so, e um segundo cache apenas dobraria
// as idas ao Azure AD e criaria dois lugares para o token expirar.
//
// A CAIXA REMETENTE vem de carbon_app_config, nao de constante: ela ainda vai
// mudar, e trocar de caixa precisa ser UPDATE no banco, sem publicar codigo.
//
// LGPD: o endereco do destinatario aparece no corpo da chamada ao Graph, o que e
// inevitavel, e NUNCA em console. O conteudo enviado nao cita empresa, projeto,
// AP/OS nem nome de arquivo (ver carbon-ss-codigo).

import { ErroGraph, obterToken, temConfigAzure } from './graph.ts';
import { obterAdmin } from './supabase.ts';

const GRAPH = 'https://graph.microsoft.com/v1.0';

/**
 * Caixa de envio quando carbon_app_config nao disser outra coisa.
 *
 * MESMO valor que CONFIG_PADRAO.remetente do Portal (carbon-api/rotas/
 * secureshare.ts): os dois lados escrevem em nome da mesma marca e o cliente
 * precisa ver o mesmo remetente no convite e no codigo. Se um dia divergirem, o
 * convite vem de um endereco e o codigo de outro, e a mensagem do codigo cai em
 * spam por parecer imitacao.
 */
const REMETENTE_PADRAO = 'portal@apsis.com.br';

/**
 * Cache do remetente COM PRAZO, e nao cache eterno de modulo.
 *
 * Sessenta segundos porque `remetente` e justamente o campo que a operacao muda
 * por UPDATE (a caixa definitiva ainda nao existe). Com cache eterno, o UPDATE so
 * valeria quando o isolate morresse - sem hora marcada e diferente em cada
 * isolate, entao parte dos e-mails sairia da caixa velha por tempo indeterminado.
 * O mesmo numero que a rota app-config ja usa no max-age.
 */
const TTL_MS = 60_000;
let cache: { valor: string; ate: number } | null = null;

/** Aceita so o que tem cara de endereco: um valor torto vira 404 do Graph. */
function remetentePlausivel(bruto: unknown): bruto is string {
  return typeof bruto === 'string' && /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(bruto.trim());
}

/**
 * Caixa remetente configurada, ou o padrao.
 *
 * Le a MESMA linha `secure_share` de carbon_app_config que o Portal escreve.
 * Falha de leitura cai no padrao em vez de estourar: um erro transitorio de banco
 * nao pode ser o motivo de um cliente nao conseguir entrar, e o pior caso e
 * enviar da caixa certa mesmo assim.
 */
export async function lerRemetente(): Promise<string> {
  const agora = Date.now();
  if (cache && cache.ate > agora) return cache.valor;

  let valor = REMETENTE_PADRAO;
  try {
    const { data, error } = await obterAdmin()
      .from('carbon_app_config')
      .select('valor')
      .eq('chave', 'secure_share')
      .maybeSingle();

    if (error) {
      console.error('Falha ao ler o remetente em carbon_app_config:', error.message);
    } else {
      const bruto = (data?.valor as Record<string, unknown> | undefined)?.remetente;
      if (remetentePlausivel(bruto)) valor = bruto.trim().toLowerCase();
    }
  } catch (e) {
    console.error('Falha inesperada ao ler o remetente:', e);
  }

  cache = { valor, ate: agora + TTL_MS };
  return valor;
}

/**
 * Envia um e-mail como a caixa institucional.
 *
 * saveToSentItems = false, SEM EXCECAO neste repositorio: o corpo carrega o
 * codigo em claro, e guardar uma copia em Itens Enviados criaria um arquivo
 * permanente de codigos de acesso de clientes numa caixa compartilhada. O convite
 * do Portal, que nao tem codigo nenhum, e quem pode se dar ao luxo de gravar a
 * copia como evidencia de envio.
 *
 * Lanca ErroGraph. Quem chama decide o que o cliente ve - e no caso do codigo a
 * resposta e 200 mesmo assim, para nao virar oraculo (regra 2).
 */
export async function enviarEmail(opcoes: {
  para: string;
  assunto: string;
  html: string;
  remetente?: string;
  /**
   * Imagens que viajam JUNTO com a mensagem, referenciadas no HTML por
   * `cid:<contentId>`. E o unico caminho para a marca: nao ha endereco publico
   * para o PNG, `data:` base64 e removido por Gmail e Outlook web, e imagem
   * remota e bloqueada por padrao pela maioria dos clientes - justamente na
   * primeira leitura. `contentBytes` e base64 SEM o prefixo data:.
   */
  imagens?: { contentId: string; nome: string; tipo: string; contentBytes: string }[];
}): Promise<void> {
  if (!temConfigAzure()) {
    // Gritado de proposito: sem os tres secrets nenhum cliente entra no portal, e
    // o sintoma visivel e "pedi o codigo e nao chegou", que parece problema de
    // e-mail do cliente.
    console.error(
      'ENVIO IMPOSSIVEL: AZURE_PORTAL_TENANT_ID / _CLIENT_ID / _CLIENT_SECRET ' +
        'ausentes nas Edge Functions. Sem elas o codigo nao sai e NENHUM cliente ' +
        'consegue entrar no portal.',
    );
    throw new ErroGraph('email_sem_credencial', 'Envio de e-mail nao configurado.', 503);
  }

  const remetente = opcoes.remetente ?? (await lerRemetente());
  const token = await obterToken();

  const resposta = await fetch(`${GRAPH}/users/${encodeURIComponent(remetente)}/sendMail`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: {
        subject: opcoes.assunto,
        body: { contentType: 'HTML', content: opcoes.html },
        toRecipients: [{ emailAddress: { address: opcoes.para } }],
        ...(opcoes.imagens?.length
          ? {
            // isInline + contentId tiram a imagem da lista de anexos visivel:
            // ela aparece no corpo, e nao como arquivo para baixar.
            attachments: opcoes.imagens.map((img) => ({
              '@odata.type': '#microsoft.graph.fileAttachment',
              name: img.nome,
              contentType: img.tipo,
              contentBytes: img.contentBytes,
              contentId: img.contentId,
              isInline: true,
            })),
          }
          : {}),
      },
      saveToSentItems: false,
    }),
  });

  if (resposta.ok) return;

  const corpo = await resposta.json().catch(() => ({}));
  const mensagem = corpo?.error?.message || `HTTP ${resposta.status}`;
  // A mensagem do Graph cita tenant, aplicativo e caixa. Vai para o log; nunca
  // para a resposta HTTP, que e lida por um cliente externo (regra 8).
  console.error(`Falha no sendMail (HTTP ${resposta.status}):`, mensagem);

  if (resposta.status === 403) {
    throw new ErroGraph(
      'email_sem_permissao',
      'O aplicativo nao pode enviar como a caixa configurada. Confira o consent de ' +
        'Mail.Send (permissao de APLICATIVO) e a Application Access Policy do Exchange.',
      502,
    );
  }

  if (resposta.status === 404) {
    // Antes este caso caia no generico e parecia falha transitoria. E o modo de
    // falha mais provavel de todos, porque a caixa remetente e configuracao.
    throw new ErroGraph(
      'remetente_inexistente',
      'A caixa configurada em carbon_app_config (chave secure_share, campo remetente) ' +
        'nao existe no tenant ou nao tem licenca de caixa postal.',
      502,
    );
  }

  throw new ErroGraph('email_falhou', 'Nao foi possivel enviar o e-mail.');
}

// -----------------------------------------------------------------------------
// carbon-ss-codigo - pede o codigo de uso unico por e-mail.
// -----------------------------------------------------------------------------
// POST { email } -> 200 { enviado: true, minutos: 10 }
//
// A REGRA QUE MANDA NESTE ARQUIVO INTEIRO: a resposta NAO pode revelar se o
// endereco tem cadastro. Confirmar que um e-mail e conhecido ja e informacao
// vazada - diria que aquela pessoa e cliente da APSIS num projeto de carbono,
// que e coberto por acordo de confidencialidade.
//
// Por isso o 200 acima e devolvido, byte a byte igual, em TODOS estes casos:
//   - endereco elegivel e e-mail enviado com sucesso;
//   - endereco sem cadastro, revogado, fora da janela de datas ou sem convite;
//   - falha do Microsoft Graph no envio;
//   - teto global de envios por hora atingido;
//   - erro de banco, colisao de resumo e qualquer excecao inesperada.
//
// NAO EXISTE codigo de erro 'envio_indisponivel', e a ausencia dele e decisao
// tomada e revisada, nao esquecimento: um 503 de "nao consegui enviar" so seria
// alcancavel para endereco ELEGIVEL, ou seja, seria exatamente o oraculo que o
// resto do arquivo existe para evitar. O custo aceito por escrito: uma pessoa
// pode ficar esperando um e-mail que nao vem. A APSIS enxerga esse caso em
// carbon_secure_share_pedidos, com desfecho 'envio_falhou', e o caminho de saida
// e o botao "Reenviar convite" do Portal.
//
// Os UNICOS nao-200 sao:
//   400 email_invalido   endereco que nem tem forma de endereco;
//   429 espere           freio de 60 segundos entre pedidos;
//   429 teto_diario      teto de pedidos por endereco em 24 horas.
// Os dois 429 sao contados por HMAC DO ENDERECO em carbon_secure_share_pedidos,
// e portanto existem igualmente para endereco com e sem cadastro. Se algum dia
// alguem trocar esse contador por uma consulta a carbon_secure_share_clientes, a
// regra cai pela interface, com cinco requisicoes por endereco.
//
// O CODIGO NUNCA APARECE: nao vai para console (nem em falha), nem para a URL,
// nem para query string, nem para o Postgres em claro - o banco recebe so o HMAC
// (ver _shared/otp.ts). Nao acrescente `console.log(codigo)` "so para depurar":
// o log das Edge Functions e legivel por mais gente do que o banco.

import { tratarOptions, respostaErro, respostaJson } from '../_shared/cors.ts';
import { obterAdmin } from '../_shared/supabase.ts';
import { enviarEmail } from '../_shared/email.ts';
import { LOGO_CARBON_CID, LOGO_CARBON_PNG_BASE64 } from '../_shared/marcaEmail.ts';
import {
  PISO_CODIGO_MS,
  TETO_DIA_CODIGOS,
  VALIDADE_MIN,
  emailPlausivel,
  gerarCodigo,
  normalizarEmail,
  respeitarPiso,
  resumoCodigo,
  resumoEmail,
} from '../_shared/otp.ts';

const METODOS = 'POST, OPTIONS';

/**
 * O corpo unico de sucesso. Constante de modulo, e nao objeto montado em cada
 * caminho: dois literais parecidos escritos em pontos diferentes divergem no
 * primeiro refactor, e a diferenca de um byte no corpo e um oraculo.
 */
const RESPOSTA_UNICA = Object.freeze({ enviado: true, minutos: VALIDADE_MIN });

/**
 * Quantas vezes sorteamos de novo quando o insert do resumo colide.
 *
 * A colisao e possivel porque `carbon_ss_codigos_resumo_uk` e unico entre os
 * codigos VIVOS. Com 10^6 codigos e no maximo tres vivos por endereco, ela e
 * praticamente impossivel; as tres tentativas existem para o caso improvavel nao
 * virar "nao recebi o e-mail" sem explicacao.
 */
const TENTATIVAS_SORTEIO = 3;

type RespostaRpc = { data: unknown; error: { message: string } | null };

/**
 * So o que este arquivo usa do cliente Supabase.
 *
 * Tipo estrutural minimo em vez de SupabaseClient para o teste poder passar um
 * duble sem subir Postgres nem rede.
 */
export type ClienteRpc = {
  rpc(nome: string, args?: Record<string, unknown>): PromiseLike<RespostaRpc>;
};

export interface DepsCodigo {
  admin?: ClienteRpc;
  enviar?: (o: {
    para: string;
    assunto: string;
    html: string;
    imagens?: { contentId: string; nome: string; tipo: string; contentBytes: string }[];
  }) => Promise<void>;
  gerar?: () => string;
  /** Piso de tempo. So o teste muda, e so para nao esperar 1,5 s por caso. */
  pisoMs?: number;
}

// -----------------------------------------------------------------------------
// O e-mail
// -----------------------------------------------------------------------------
/**
 * Assunto SEM o codigo, de proposito.
 *
 * O assunto e a parte da mensagem que aparece na notificacao da tela bloqueada
 * do celular e na lista de mensagens por cima do ombro de quem estiver ao lado.
 * O corpo exige abrir a mensagem.
 *
 * Bilingue porque o portal e bilingue e nao ha coluna de idioma no cadastro do
 * cliente: quem le pode ser um auditor de VVB ou um comprador de credito que nao
 * fala portugues (ver src/lib/i18n.jsx, ingles e o padrao da interface).
 */
const ASSUNTO = 'APSIS - access code / código de acesso';

/**
 * Corpo do e-mail. Ingles em cima, portugues embaixo, o codigo uma vez so.
 *
 * O QUE ELE NAO CONTEM, e cada ausencia e deliberada:
 *   - LINK e BOTAO: o endereco do portal do cliente ainda nao existe
 *     (carbon_app_config.portalUrl esta vazio) e nao se inventa URL num e-mail
 *     que sai com a marca da APSIS. Alem disso, e-mail de codigo sem link e
 *     imune a phishing por link parecido: nao ha nada para clicar;
 *   - EMPRESA, projeto, AP/OS, nome de arquivo e nome de pessoa: um erro de
 *     digitacao no cadastro entregaria a um estranho a informacao de que aquela
 *     empresa e cliente da APSIS num projeto de carbono;
 *   - PIXEL DE RASTREIO e IMAGEM REMOTA: pixel e rastreio de leitura sem base
 *     legal declarada, e imagem remota faz o cliente de e-mail pedir bloqueio de
 *     conteudo. A MARCA e a excecao e entra como anexo EMBUTIDO (cid:), que nao
 *     busca nada na rede, nao rastreia nada e nao dispara esse bloqueio. Ver
 *     _shared/marcaEmail.ts.
 *
 * Nao ha interpolacao de dado do usuario aqui: a unica coisa que entra e o
 * codigo, que e `[0-9]{DIGITOS}` gerado por nos. Superficie de injecao em HTML,
 * portanto, zero - e e assim que precisa continuar.
 */
function montarHtml(codigo: string): string {
  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#F3F5F3">
<div style="padding:26px 12px;font-family:Segoe UI,Arial,sans-serif">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="width:100%;max-width:520px;border-collapse:collapse">

    <tr>
      <td align="center" style="background:#1A4731;border-radius:14px 14px 0 0;padding:26px 24px 22px">
        <img src="cid:${LOGO_CARBON_CID}" width="176" alt="APSIS Carbon"
             style="display:block;width:176px;max-width:70%;height:auto;border:0;outline:none;text-decoration:none" />
        <div style="color:#ffffff;font-size:17px;font-weight:700;margin-top:18px">Seu código de entrada</div>
        <div style="color:#A8C4B4;font-size:12px;margin-top:5px">Secure Share · APSIS Consultoria</div>
      </td>
    </tr>

    <tr>
      <td style="background:#ffffff;border-radius:0 0 14px 14px;padding:28px 26px 24px;color:#1A2B1F;font-size:14px;line-height:1.65">

        <p style="margin:0 0 20px">
          Use the code below to sign in. It is valid for ${VALIDADE_MIN} minutes.<br />
          Use o código abaixo para entrar. Ele vale por ${VALIDADE_MIN} minutos.
        </p>

        <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;border:1px solid #DDE3DE;border-radius:10px;margin:0 0 22px">
          <tr>
            <td align="center" style="padding:18px 16px 4px;font-size:10px;font-weight:700;letter-spacing:1.2px;color:#8A9990">
              YOUR CODE · SEU CÓDIGO
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:0 16px 20px;font-size:34px;font-weight:800;letter-spacing:7px;color:#1A4731;font-family:Consolas,Menlo,monospace">
              ${codigo}
            </td>
          </tr>
        </table>

        <div style="padding:13px 16px;background:#FDF6E7;border:1px solid #E8D7AE;border-radius:10px;font-size:12px;color:#8A5A12;line-height:1.6;margin:0 0 20px">
          <strong>Security</strong> · this code is yours alone and works only once.
          APSIS will never ask you for this code by phone or message.<br />
          <strong>Segurança</strong> · este código é só seu e serve
          uma vez só. A APSIS nunca vai pedir este código por telefone ou mensagem.
        </div>

        <p style="margin:0;font-size:13px;color:#8A9990;line-height:1.6">
          If you did not ask for this code, ignore this message.<br />
          Se você não pediu este código, ignore esta mensagem.
        </p>

      </td>
    </tr>

  </table>
</div>
</body></html>`;
}

// -----------------------------------------------------------------------------
// Trilha em carbon_secure_share_pedidos
// -----------------------------------------------------------------------------
/**
 * Fecha a linha do pedido com o desfecho real.
 *
 * E o unico lugar onde a APSIS enxerga o que aconteceu, porque a resposta ao
 * cliente e sempre a mesma. Falha ao gravar o desfecho NAO derruba a requisicao:
 * a pessoa ja tem (ou nao tem) o codigo dela, e trocar isso por um erro so
 * pioraria o dia dela.
 *
 * `p_email` so viaja nos desfechos 'enviado' e 'envio_falhou', que sao os dois
 * em que o endereco ja e comprovadamente de um cliente cadastrado - e e a propria
 * funcao do banco que descarta o parametro nos demais. Nos outros caminhos
 * chamamos com DOIS argumentos, e e por isso que `p_email` tem default no SQL:
 * sem o default, o PostgREST responderia PGRST202 exatamente nos caminhos de
 * falha, que sao os que ninguem testa.
 */
async function registrarDesfecho(
  admin: ClienteRpc,
  pedidoId: string,
  motivo: string,
  email?: string,
): Promise<void> {
  if (!pedidoId) return;
  const args: Record<string, unknown> = { p_pedido_id: pedidoId, p_motivo: motivo };
  if (email) args.p_email = email;

  const { error } = await admin.rpc('carbon_secure_share_pedido_desfecho', args);
  if (error) console.error(`Falha ao registrar o desfecho "${motivo}":`, error.message);
}

// -----------------------------------------------------------------------------
// Handler
// -----------------------------------------------------------------------------
export async function tratar(req: Request, deps: DepsCodigo = {}): Promise<Response> {
  const preflight = tratarOptions(req, METODOS);
  if (preflight) return preflight;
  if (req.method !== 'POST') return respostaErro('metodo_nao_permitido', 405, METODOS);

  // O cronometro comeca ANTES de qualquer I/O. Ele nao mede trabalho: ele iguala
  // o tempo total dos caminhos "mandei um e-mail" e "nao mandei nada".
  const inicio = Date.now();
  const piso = deps.pisoMs ?? PISO_CODIGO_MS;

  /** A resposta de sucesso, sempre a mesma, sempre depois do piso. */
  const mesmaResposta = async (): Promise<Response> => {
    await respeitarPiso(inicio, piso);
    return respostaJson(RESPOSTA_UNICA, 200, METODOS);
  };

  try {
    const corpo = await req.json().catch(() => ({}));
    const email = normalizarEmail((corpo as Record<string, unknown>)?.email);

    if (!emailPlausivel(email)) {
      // O unico 400. Ele NAO e oraculo: depende so da forma do que foi digitado,
      // nao de existir cadastro. Passa pelo piso do mesmo jeito, para o tempo nao
      // separar "recusei na entrada" de "fui ate o fim".
      await respeitarPiso(inicio, piso);
      return respostaErro('email_invalido', 400, METODOS);
    }

    const admin = deps.admin ?? (obterAdmin() as unknown as ClienteRpc);
    const enviar = deps.enviar ?? enviarEmail;
    const chaveEmail = await resumoEmail(email);

    // ---- Freios (valem para endereco com e sem cadastro) -------------------
    const { data: freio, error: erroFreio } = await admin.rpc(
      'carbon_secure_share_pedido_registrar',
      {
        p_resumo_email: chaveEmail,
        // Explicito, e nao o default do SQL: com codigo de SEIS digitos este teto
        // e defesa critica, nao conforto. A conta esta em _shared/otp.ts.
        p_teto_dia: TETO_DIA_CODIGOS,
      },
    );

    if (erroFreio) {
      // Sem os freios nao ha como seguir com seguranca, e o motivo tecnico nao
      // pode virar status diferente. Loga o resumo (HMAC), nunca o endereco.
      console.error('Falha em carbon_secure_share_pedido_registrar:', erroFreio.message);
      return await mesmaResposta();
    }

    const pedido = (freio ?? {}) as { ok?: boolean; motivo?: string; espere?: number; pedido_id?: string };

    if (pedido.ok !== true) {
      if (pedido.motivo === 'freio_minuto') {
        const espere = Number(pedido.espere ?? 60);
        await respeitarPiso(inicio, piso);
        // DOIS contratos no mesmo corpo, de proposito:
        //   `erro` e `detalhe` porque src/lib/api.js monta o codigo do ErroApi a
        //     partir de `dados.erro` - sem ele a tela cai na mensagem generica;
        //   `enviado`, `motivo` e `espere` porque e o contrato escrito no plano e
        //     e o que o contador de reenvio da tela consome.
        // Redundante e barato; divergir custaria uma tela sem mensagem.
        return respostaJson(
          { erro: 'espere', detalhe: String(espere), enviado: false, motivo: 'espere', espere },
          429,
          METODOS,
        );
      }

      if (pedido.motivo === 'teto_diario') {
        await respeitarPiso(inicio, piso);
        return respostaJson(
          { erro: 'teto_diario', enviado: false, motivo: 'teto_diario' },
          429,
          METODOS,
        );
      }

      // 'teto_global' e 'formato' caem aqui. O teto global e 200 IDENTICO de
      // proposito: ele nao depende do endereco, entao um status proprio diria ao
      // atacante que ele derrubou o sistema, e ao cliente legitimo diria que
      // existe cadastro. Quem enxerga o caso e o alerta gravado pela propria
      // funcao do banco.
      return await mesmaResposta();
    }

    const pedidoId = String(pedido.pedido_id ?? '');

    // ---- Elegibilidade -----------------------------------------------------
    const { data: elegivel, error: erroElegivel } = await admin.rpc(
      'carbon_secure_share_elegivel',
      { p_email: email },
    );

    if (erroElegivel) {
      console.error('Falha em carbon_secure_share_elegivel:', erroElegivel.message);
      await registrarDesfecho(admin, pedidoId, 'erro_elegibilidade');
      return await mesmaResposta();
    }

    // `!== true` e nao `!elegivel`: a funcao devolve BOOLEAN justamente para esta
    // comparacao ser possivel. Se um dia ela voltar a devolver jsonb, um teste de
    // veracidade em JavaScript passaria sempre (objeto e truthy) e esta funcao
    // viraria relay aberto de mensagens com a marca da APSIS.
    if (elegivel !== true) {
      await registrarDesfecho(admin, pedidoId, 'sem_acesso');
      return await mesmaResposta();
    }

    // ---- Sorteia e grava ---------------------------------------------------
    let codigo = '';
    let resumo = '';

    for (let i = 0; i < TENTATIVAS_SORTEIO && !codigo; i++) {
      const candidato = deps.gerar ? deps.gerar() : gerarCodigo();
      const resumoCandidato = await resumoCodigo(email, candidato);

      const { data, error } = await admin.rpc('carbon_secure_share_codigo_registrar', {
        p_email: email,
        p_resumo: resumoCandidato,
        p_minutos: VALIDADE_MIN,
      });

      if (error) {
        // Falha de banco NAO e colisao: repetir o sorteio nao conserta e so
        // esconderia a causa. Sai do laco com o motivo no log.
        console.error('Falha em carbon_secure_share_codigo_registrar:', error.message);
        break;
      }

      if ((data as { ok?: boolean } | null)?.ok === true) {
        codigo = candidato;
        resumo = resumoCandidato;
      }
    }

    if (!codigo) {
      await registrarDesfecho(admin, pedidoId, 'envio_falhou');
      return await mesmaResposta();
    }

    // ---- Envia, SINCRONO ---------------------------------------------------
    // Nada de EdgeRuntime.waitUntil: ele e melhor esforco e nao tem declaracao de
    // tipo no Deno. Se o isolate for recolhido logo depois da resposta, nao roda
    // nem o envio nem o descarte compensatorio - e a pessoa fica presa num codigo
    // que existe no banco, nao existe na caixa dela e ainda gastou a cota do dia.
    try {
      await enviar({
      para: email,
      assunto: ASSUNTO,
      html: montarHtml(codigo),
      // A marca viaja com a mensagem. Ver _shared/marcaEmail.ts.
      imagens: [{
        contentId: LOGO_CARBON_CID,
        nome: 'apsis-carbon.png',
        tipo: 'image/png',
        contentBytes: LOGO_CARBON_PNG_BASE64,
      }],
    });
    } catch (e) {
      // A mensagem aqui e sempre escrita por nos (_shared/email.ts) e nunca cita
      // o codigo nem o endereco do cliente.
      console.error(
        'Falha ao enviar o codigo:',
        e instanceof Error ? e.message : String(e),
      );

      // Compensatorio: apaga o codigo que ninguem recebeu. Sem isto a pessoa fica
      // travada por dez minutos num codigo inexistente e o proximo pedido dela
      // ainda disputa a cota de tres codigos vivos.
      const { error: erroDescarte } = await admin.rpc('carbon_secure_share_codigo_descartar', {
        p_resumo: resumo,
      });
      if (erroDescarte) {
        console.error('Falha ao descartar o codigo nao enviado:', erroDescarte.message);
      }

      await registrarDesfecho(admin, pedidoId, 'envio_falhou', email);
      return await mesmaResposta();
    }

    await registrarDesfecho(admin, pedidoId, 'enviado', email);
    return await mesmaResposta();
  } catch (e) {
    // Ate a excecao inesperada responde 200 com o mesmo corpo. Um 500 aqui seria
    // observavel e, dependendo de onde estourasse, correlacionado com o cadastro.
    // O diagnostico vive no log; a resposta continua muda.
    console.error('Falha inesperada em carbon-ss-codigo:', e);
    return await mesmaResposta();
  }
}

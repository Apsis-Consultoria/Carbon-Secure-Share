// -----------------------------------------------------------------------------
// carbon-ss-entrar - troca o codigo de uso unico pelo token de sessao.
// -----------------------------------------------------------------------------
// POST { email, codigo } -> { token, projetos, nome }
//
// A SESSAO NAO MUDOU: continua sendo o mesmo token HMAC de _shared/sessao.ts,
// com os projetos autorizados dentro, valido por 8 horas e guardado em
// sessionStorage no navegador. O que mudou e QUEM a emite: antes, quem provava a
// posse de uma senha; agora, quem prova a posse da caixa de e-mail.
//
// A sessao continua em sessionStorage DE PROPOSITO, e isso e decisao registrada,
// nao pendencia: o cliente costuma acessar de maquina compartilhada, e a sessao
// deve morrer quando a aba fechar. "Lembrar este dispositivo" esta fora de escopo
// por decisao do dono - nao ha cookie de dispositivo, nao ha tabela para isso, e
// nao ha nada meio-pronto neste arquivo esperando ser ligado.
//
// UM UNICO ERRO PARA QUATRO CAUSAS: codigo errado, codigo inexistente, codigo
// expirado e codigo em pausa por excesso de tentativas respondem todos
// 401 codigo_invalido, com o mesmo corpo. Distinguir "muitas tentativas" de
// "codigo invalido" revelaria que existe codigo VIVO para aquele endereco, ou
// seja, que aquele endereco pediu acesso e portanto e cliente da APSIS num
// projeto de carbono. O motivo real vai para o log, que so nos lemos.
//
// O 403 acesso_indisponivel e a UNICA excecao, e ela e segura: para chegar la a
// pessoa ja apresentou um codigo valido, ou seja, ja provou que a caixa e dela.
// Nao ha o que revelar a quem ja provou.

import { tratarOptions, respostaErro, respostaJson } from '../_shared/cors.ts';
import { obterAdmin } from '../_shared/supabase.ts';
import { assinarSessao } from '../_shared/sessao.ts';
import { montarProjetos } from '../_shared/sessaoProjetos.ts';
import {
  DIGITOS,
  PISO_ENTRAR_MS,
  emailPlausivel,
  normalizarEmail,
  respeitarPiso,
  resumoCodigo,
} from '../_shared/otp.ts';

const METODOS = 'POST, OPTIONS';

type RespostaRpc = { data: unknown; error: { message: string } | null };

export type ClienteRpc = {
  rpc(nome: string, args?: Record<string, unknown>): PromiseLike<RespostaRpc>;
};

export interface DepsEntrar {
  admin?: ClienteRpc;
  /** Injetavel so para o teste nao precisar do SharePoint para montar a Geral. */
  lerConfig?: () => Promise<{ pastaGeral: string }>;
  pisoMs?: number;
}

/**
 * Deixa so os digitos.
 *
 * O campo da tela ja sanea, mas o servidor nao confia na tela: alguem colando
 * "Codigo: 12 34 56" direto num cliente HTTP tem a mesma intencao de quem digita
 * certo, e recusar isso so gera chamado de suporte. O que NAO acontece aqui e
 * completar, cortar do meio ou adivinhar: se sobrarem digitos demais ou de menos,
 * a resposta e o mesmo 401 de codigo errado.
 */
function digitos(bruto: unknown): string {
  return String(bruto ?? '').replace(/\D/g, '');
}

export async function tratar(req: Request, deps: DepsEntrar = {}): Promise<Response> {
  const preflight = tratarOptions(req, METODOS);
  if (preflight) return preflight;
  if (req.method !== 'POST') return respostaErro('metodo_nao_permitido', 405, METODOS);

  const inicio = Date.now();
  const piso = deps.pisoMs ?? PISO_ENTRAR_MS;

  /** Recusa unica. Sempre depois do piso, sempre com o mesmo corpo. */
  const recusar = async (): Promise<Response> => {
    await respeitarPiso(inicio, piso);
    return respostaErro('codigo_invalido', 401, METODOS);
  };

  try {
    const corpo = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const email = normalizarEmail(corpo?.email);
    const codigo = digitos(corpo?.codigo);

    // Recusa local, sem tocar o banco. Nao e oraculo: depende so da FORMA do que
    // foi enviado, nunca de existir cadastro ou codigo vivo.
    if (!emailPlausivel(email) || codigo.length !== DIGITOS) return await recusar();

    const admin = deps.admin ?? (obterAdmin() as unknown as ClienteRpc);

    // ---- Confere o codigo --------------------------------------------------
    // O codigo em claro NAO viaja ate aqui: o que vai para o Postgres e o HMAC
    // com pepper (_shared/otp.ts), entao os digitos nao entram em log_statement,
    // em pg_stat_statements nem no backup.
    const { data: conferido, error: erroConferir } = await admin.rpc(
      'carbon_secure_share_conferir_codigo',
      { p_email: email, p_resumo: await resumoCodigo(email, codigo) },
    );

    if (erroConferir) {
      console.error('Falha em carbon_secure_share_conferir_codigo:', erroConferir.message);
      await respeitarPiso(inicio, piso);
      return respostaErro('erro_interno', 500, METODOS);
    }

    const resultado = (conferido ?? {}) as { ok?: boolean; motivo?: string };

    if (resultado.ok !== true) {
      // O motivo ('errado', 'inexistente', 'pausado', 'formato') e trilha, nao
      // resposta. Ele nao cita o codigo nem o endereco.
      console.error(`Codigo recusado, motivo: ${resultado.motivo ?? 'desconhecido'}`);
      return await recusar();
    }

    // ---- Autoriza ----------------------------------------------------------
    // Roda DEPOIS de o codigo ser consumido, e o codigo continua consumido mesmo
    // que a autorizacao falhe. E o certo: uso unico e uso unico, e um codigo que
    // "volta a valer" quando a autorizacao nega e um codigo reaproveitavel.
    const { data: autorizacao, error: erroAutorizar } = await admin.rpc(
      'carbon_secure_share_autorizar',
      { p_email: email },
    );

    if (erroAutorizar) {
      console.error('Falha em carbon_secure_share_autorizar:', erroAutorizar.message);
      await respeitarPiso(inicio, piso);
      return respostaErro('erro_interno', 500, METODOS);
    }

    const dados = (autorizacao ?? {}) as { autorizado?: boolean; projetos?: unknown };

    if (dados.autorizado !== true) {
      // Acontece de verdade: o acesso foi revogado, o prazo venceu ou o projeto
      // foi encerrado entre o pedido do codigo e a digitacao dele.
      await respeitarPiso(inicio, piso);
      return respostaErro('acesso_indisponivel', 403, METODOS);
    }

    const { projetos, nome } = await montarProjetos(
      dados.projetos,
      deps.lerConfig,
    );

    // Cinto e suspensorio: `autorizado: true` sem projeto nenhum nao deveria
    // existir (a funcao do banco devolve false quando a agregacao vem vazia), mas
    // uma sessao com lista vazia seria um token valido que nao abre nada e daria
    // "tela em branco depois de entrar", que e o pior sintoma possivel.
    if (!projetos.length) {
      console.error('Autorizacao sem projetos: carbon_secure_share_autorizar devolveu lista vazia.');
      await respeitarPiso(inicio, piso);
      return respostaErro('acesso_indisponivel', 403, METODOS);
    }

    const token = await assinarSessao({ email, nome, projetos });

    await respeitarPiso(inicio, piso);
    return respostaJson({ token, projetos, nome }, 200, METODOS);
  } catch (e) {
    console.error('Falha inesperada em carbon-ss-entrar:', e);
    await respeitarPiso(inicio, piso);
    return respostaErro('erro_interno', 500, METODOS);
  }
}

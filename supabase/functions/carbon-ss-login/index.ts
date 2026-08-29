// -----------------------------------------------------------------------------
// carbon-ss-login - entrada por SENHA. Caminho legado, em transicao.
// -----------------------------------------------------------------------------
// POST { email, senha } -> { token, projetos: [{ projeto_id, empresa, ap_os, pasta }], nome }
//
// ESTA FUNCAO ESTA SENDO APOSENTADA. A entrada nova nao tem senha: o cliente pede
// um codigo em carbon-ss-codigo e o troca por sessao em carbon-ss-entrar.
//
// POR QUE ELA CONTINUA VIVA NESTE RELEASE, e nao foi apagada junto:
//
//   1. O frontend e o backend nao viram a chave no mesmo instante. O GitHub
//      Actions publica as Edge Functions em cerca de dois minutos e o Amplify
//      reconstroi o frontend em alguns a mais. Nesse intervalo, o navegador de
//      quem ja estava com a tela de login aberta ainda posta { email, senha }
//      para uma funcao ja publicada. Sem este arquivo, essas pessoas veriam
//      "algo deu errado" sem entender por que;
//   2. quando o corte vier (passo separado), ela vira CASCA de 410
//      recurso_desativado - e nao um diretorio apagado. Apagar a pasta nao
//      despublica a funcao, e um `functions deploy` distraido a partir de um
//      checkout antigo republicaria a versao de hoje e a senha voltaria a valer
//      em silencio, sem ninguem perceber.
//
// A verificacao de credencial NAO acontece aqui: ela roda em
// public.carbon_secure_share_autenticar, que compara o bcrypt e checa, na mesma
// consulta, cliente ativo, projeto ativo e janela de datas. Concentrar as quatro
// condicoes numa funcao do banco e o que impede esta Edge Function de esquecer
// uma delas.
//
// A resposta e sempre a MESMA para e-mail inexistente e senha errada. Confirmar
// que um e-mail tem cadastro ja e informacao: diria que aquela pessoa e cliente
// da APSIS num projeto de carbono.

import { tratarOptions, respostaErro, respostaJson } from '../_shared/cors.ts';
import { obterAdmin } from '../_shared/supabase.ts';
import { assinarSessao } from '../_shared/sessao.ts';
import { montarProjetos } from '../_shared/sessaoProjetos.ts';

const METODOS = 'POST, OPTIONS';

/**
 * Anti forca bruta do caminho de SENHA. 8 falhas em 15 minutos por e-mail.
 *
 * FICA, e a permanencia e decisao. A migration da entrada por codigo tira
 * carbon_secure_share_tentativas do caminho de decisao do login NOVO - contar
 * falhas por e-mail num endpoint publico oferece a qualquer um a chance de
 * trancar um cliente, e quem freia palpite agora e o contador da propria linha do
 * codigo. Mas aqui, no caminho legado, do outro lado esta um bcrypt: removendo o
 * contador, esta funcao passaria os proximos dias como um oraculo de senha sem
 * freio nenhum. Trocar um risco de lockout que ja existe hoje por forca bruta
 * livre, num caminho que vai ser cortado, seria piorar para arrumar.
 *
 * NAO reintroduza esta contagem em carbon-ss-codigo nem em carbon-ss-entrar.
 */
const MAX_FALHAS = 8;
const JANELA_MIN = 15;

Deno.serve(async (req: Request): Promise<Response> => {
  const preflight = tratarOptions(req, METODOS);
  if (preflight) return preflight;

  if (req.method !== 'POST') return respostaErro('metodo_nao_permitido', 405, METODOS);

  try {
    const corpo = await req.json().catch(() => ({}));
    const email = String(corpo?.email ?? '').toLowerCase().trim();
    const senha = String(corpo?.senha ?? '');

    if (!email) return respostaErro('credenciais_obrigatorias', 400, METODOS);

    if (!senha) {
      /*
       * Corpo SEM senha: quem chamou e um frontend novo batendo no endpoint
       * velho, ou uma aba antiga com o campo em branco. Nao ha o que autenticar,
       * e emitir sessao daqui sem credencial nenhuma seria transformar esta
       * funcao numa porta aberta.
       *
       * 400 e nao 401: nao houve tentativa de credencial a recusar, houve corpo
       * incompleto. O codigo `recarregar_pagina` e novo, entao o frontend antigo
       * cai na mensagem generica dele - aceitavel, porque este caminho so e
       * alcancado por uma combinacao que nao deveria existir e que se resolve
       * exatamente com um F5.
       */
      return respostaErro('recarregar_pagina', 400, METODOS);
    }

    const admin = obterAdmin();

    // ---- Throttle ----------------------------------------------------------
    const desde = new Date(Date.now() - JANELA_MIN * 60_000).toISOString();
    const { count: falhas } = await admin
      .from('carbon_secure_share_tentativas')
      .select('id', { count: 'exact', head: true })
      .eq('email', email)
      .eq('sucesso', false)
      .gte('tentado_em', desde);

    if ((falhas ?? 0) >= MAX_FALHAS) {
      return respostaErro('muitas_tentativas', 429, METODOS, String(JANELA_MIN));
    }

    // ---- Credencial --------------------------------------------------------
    const { data, error } = await admin.rpc('carbon_secure_share_autenticar', {
      p_email: email,
      p_senha: senha,
    });

    if (error) {
      console.error('Falha ao chamar carbon_secure_share_autenticar:', error.message);
      return respostaErro('erro_interno', 500, METODOS);
    }

    if (!data?.autenticado) {
      // Registra a falha ANTES de responder, senao o throttle nao conta nada.
      await admin.from('carbon_secure_share_tentativas').insert({ email, sucesso: false });
      return respostaErro('credenciais_invalidas', 401, METODOS);
    }

    // Sucesso: registra e limpa as falhas antigas deste e-mail, para quem
    // acertou depois de errar tres vezes nao carregar o contador para sempre.
    await admin.from('carbon_secure_share_tentativas').insert({ email, sucesso: true });
    await admin
      .from('carbon_secure_share_tentativas')
      .delete()
      .eq('email', email)
      .eq('sucesso', false);

    // A montagem da lista de projetos (e a injecao da pasta Geral) MUDOU DE
    // ARQUIVO: ela mora em _shared/sessaoProjetos.ts desde que passou a existir
    // um segundo emissor de sessao. Duas copias divergiriam, e a divergencia
    // apareceria como a Geral existindo num caminho de login e sumindo no outro.
    const { projetos, nome } = await montarProjetos(data.projetos);

    const token = await assinarSessao({ email, nome, projetos });

    return respostaJson({ token, projetos, nome }, 200, METODOS);
  } catch (e) {
    console.error('Falha inesperada em carbon-ss-login:', e);
    return respostaErro('erro_interno', 500, METODOS);
  }
});

// -----------------------------------------------------------------------------
// carbon-ss-login - autentica o cliente externo e emite o token de sessao.
// -----------------------------------------------------------------------------
// POST { email, senha } -> { token, projetos: [{ projeto_id, empresa, ap_os, pasta }], nome }
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
import { assinarSessao, type ProjetoSessao } from '../_shared/sessao.ts';

const METODOS = 'POST, OPTIONS';

// Anti forca bruta. 8 falhas em 15 minutos por e-mail: folgado para quem erra a
// senha de verdade, apertado para script.
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

    if (!email || !senha) return respostaErro('credenciais_obrigatorias', 400, METODOS);

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

    const projetos: ProjetoSessao[] = (data.projetos ?? []).map(
      (p: Record<string, unknown>) => ({
        projeto_id: String(p.projeto_id),
        empresa: String(p.empresa ?? ''),
        ap_os: (p.ap_os as string) ?? null,
        // O nome da pasta vem do BANCO (carbon_secure_share_nome_pasta), nunca
        // recalculado aqui: duas implementacoes divergentes fariam o cliente
        // procurar uma pasta que nao existe.
        pasta: String(p.pasta ?? ''),
      }),
    );

    const nome = String(data.projetos?.[0]?.nome ?? '');
    const token = await assinarSessao({ email, nome, projetos });

    return respostaJson({ token, projetos, nome }, 200, METODOS);
  } catch (e) {
    console.error('Falha inesperada em carbon-ss-login:', e);
    return respostaErro('erro_interno', 500, METODOS);
  }
});

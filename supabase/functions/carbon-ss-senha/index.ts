// -----------------------------------------------------------------------------
// carbon-ss-senha - o cliente troca a propria senha.
// -----------------------------------------------------------------------------
// POST { senha_atual, senha_nova }   (exige sessao valida)
//   -> { trocada: true }
//
// A senha atual e exigida mesmo havendo sessao valida: sessao aberta em maquina
// compartilhada nao pode virar troca de credencial. E a mesma razao pela qual
// qualquer sistema pede a senha antiga numa tela de troca.
//
// A verificacao e a gravacao acontecem no banco
// (carbon_secure_share_trocar_senha), com bcrypt. Esta funcao nunca ve hash.
//
// NAO EXISTE "esqueci minha senha" AQUI. No Secure Share do Carbon quem emite
// credencial e a equipe da APSIS, pelo Portal Carbon (botao "Enviar acesso", que
// gera senha nova e manda por e-mail). Um fluxo de auto-recuperacao exigiria
// esta funcao mandar e-mail, o que traria Mail.Send para dentro de um sistema
// que hoje so le e escreve arquivo - e a recuperacao ja existe, do outro lado.

import { tratarOptions, respostaErro, respostaJson } from '../_shared/cors.ts';
import { obterAdmin } from '../_shared/supabase.ts';
import { extrairToken, verificarSessao } from '../_shared/sessao.ts';

const METODOS = 'POST, OPTIONS';

const MINIMO = 12;

Deno.serve(async (req: Request): Promise<Response> => {
  const preflight = tratarOptions(req, METODOS);
  if (preflight) return preflight;

  if (req.method !== 'POST') return respostaErro('metodo_nao_permitido', 405, METODOS);

  try {
    const sessao = await verificarSessao(extrairToken(req));
    if (!sessao) return respostaErro('nao_autenticado', 401, METODOS);

    const corpo = await req.json().catch(() => ({}));
    const atual = String(corpo?.senha_atual ?? '');
    const nova = String(corpo?.senha_nova ?? '');

    if (!atual || !nova) return respostaErro('campos_obrigatorios', 400, METODOS);
    if (nova.length < MINIMO) return respostaErro('senha_curta', 400, METODOS, String(MINIMO));
    if (nova === atual) return respostaErro('senha_igual_a_atual', 400, METODOS);

    const admin = obterAdmin();

    const { data, error } = await admin.rpc('carbon_secure_share_trocar_senha', {
      p_email: sessao.email,
      p_senha_atual: atual,
      p_senha_nova: nova,
    });

    if (error) {
      console.error('Falha ao trocar a senha:', error.message);
      return respostaErro('erro_interno', 500, METODOS);
    }

    if (!data?.trocada) {
      // O banco distingue "senha atual errada" de "nenhum cadastro ativo". Aqui
      // a resposta e a mesma nos dois casos: quem esta autenticado ja sabe que
      // tem cadastro, entao o unico erro util e o da senha.
      return respostaErro('senha_atual_incorreta', 401, METODOS);
    }

    return respostaJson({ trocada: true }, 200, METODOS);
  } catch (e) {
    console.error('Falha inesperada em carbon-ss-senha:', e);
    return respostaErro('erro_interno', 500, METODOS);
  }
});

/**
 * Sessao do cliente no navegador.
 *
 * ONDE GUARDAMOS: sessionStorage, nao localStorage.
 *
 * O portal interno usa localStorage porque a sessao e do Azure AD e a pessoa
 * volta ao sistema o dia inteiro, na propria maquina. Aqui e o oposto: quem abre
 * e um cliente, muitas vezes em maquina compartilhada do escritorio dele, para
 * baixar um documento e sair. Em sessionStorage a sessao morre ao fechar a aba,
 * que e o comportamento certo quando o proximo a sentar naquela maquina pode ser
 * outra pessoa.
 *
 * ISTO NAO MUDOU COM A ENTRADA POR CODIGO, e nao mudou DE PROPOSITO. A sessao
 * continua durando 8 horas e continua morrendo ao fechar a aba; "lembrar este
 * dispositivo" ficou FORA desta entrega por decisao do dono, entao nao existe
 * cookie de dispositivo, nao existe tabela para isso e nao ha nada meio-pronto
 * esperando ser ligado. Quem for tentado a "corrigir" isto para localStorage
 * achando que e o que o dono pediu, leia de novo o paragrafo acima: o motivo e a
 * maquina compartilhada, e ele nao tem nada a ver com senha.
 *
 * O token e assinado no servidor (HMAC) e carrega os projetos autorizados.
 * Alterar qualquer coisa dele aqui so faz a proxima chamada devolver 401.
 */

const CHAVE = 'carbon-ss-sessao';

/** Sessao guardada, ou null. Token expirado e descartado na leitura. */
export function lerSessao() {
  let bruto = null;
  try {
    bruto = sessionStorage.getItem(CHAVE);
  } catch {
    // Navegador com storage bloqueado (modo restrito, iframe de terceiro). Sem
    // sessao persistida o app ainda funciona ate a aba ser recarregada.
    return null;
  }
  if (!bruto) return null;

  let sessao;
  try {
    sessao = JSON.parse(bruto);
  } catch {
    limparSessao();
    return null;
  }

  if (!sessao?.token || !Array.isArray(sessao.projetos)) {
    limparSessao();
    return null;
  }

  // Expiracao conferida no cliente TAMBEM, para a tela mandar para o login em
  // vez de deixar a pessoa clicar e receber 401 em cada ação. Quem decide de
  // verdade continua sendo o servidor.
  if (sessao.expiraEm && Date.now() >= sessao.expiraEm) {
    limparSessao();
    return null;
  }

  return sessao;
}

/**
 * Grava a sessao.
 *
 * A validade e derivada do proprio token (claim `exp`), e nao de um numero
 * repetido aqui: duas fontes de verdade divergiriam na primeira vez que alguem
 * mudasse o TTL no servidor.
 */
export function gravarSessao({ token, projetos, nome, email, demo = false }) {
  const expiraEm = expiracaoDoToken(token);
  try {
    sessionStorage.setItem(
      CHAVE,
      // `demo` marca a sessao de demonstracao. Em producao ele nunca chega a ser
      // true: quem o liga e entrarDemo(), que so existe em desenvolvimento.
      JSON.stringify({ token, projetos, nome, email, demo, expiraEm }),
    );
  } catch {
    // Sem storage a sessao vive so em memoria, no estado do React.
  }
}

export function limparSessao() {
  try {
    sessionStorage.removeItem(CHAVE);
  } catch {
    /* nada a fazer */
  }
}

/**
 * Le o `exp` do payload do token, em milissegundos.
 *
 * Isto NAO e validacao: o payload e base64, nao criptografado, e qualquer um
 * pode reescreve-lo. Serve so para a tela saber quando mandar para o login. A
 * assinatura e conferida no servidor, a cada requisicao.
 */
function expiracaoDoToken(token) {
  try {
    const corpo = String(token).split('.')[0];
    const norm = corpo.replace(/-/g, '+').replace(/_/g, '/');
    const pad = norm.length % 4 ? '='.repeat(4 - (norm.length % 4)) : '';
    const payload = JSON.parse(atob(norm + pad));
    return payload?.exp ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

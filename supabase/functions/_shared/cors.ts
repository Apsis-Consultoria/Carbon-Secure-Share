// -----------------------------------------------------------------------------
// CORS e helpers de resposta das Edge Functions do Secure Share Carbon.
// -----------------------------------------------------------------------------
// Origin '*' porque o portal do cliente e servido de origens diferentes ao longo
// do ciclo de vida (localhost:5176 em dev, dominio de producao, previews do
// Amplify) e nao usamos cookie nem Access-Control-Allow-Credentials - a sessao
// viaja no header Authorization, que o navegador de terceiro nao consegue forjar
// sem o token.
//
// Isso NAO afrouxa nada: toda funcao daqui exige um token de sessao assinado com
// SESSION_SECRET, que so a funcao de login emite.

export function cabecalhosCors(metodos = 'GET, POST, OPTIONS'): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
    'Access-Control-Allow-Methods': metodos,
    'Access-Control-Max-Age': '86400',
  };
}

/** Responde ao preflight. Devolve null quando o metodo nao e OPTIONS. */
export function tratarOptions(req: Request, metodos?: string): Response | null {
  if (req.method !== 'OPTIONS') return null;
  return new Response(null, { status: 204, headers: cabecalhosCors(metodos) });
}

export function respostaJson(
  corpo: unknown,
  status = 200,
  metodos?: string,
  extra: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: {
      ...cabecalhosCors(metodos),
      'Content-Type': 'application/json; charset=utf-8',
      // Resposta de portal de documento nunca deve ficar em cache intermediario.
      'Cache-Control': 'no-store',
      ...extra,
    },
  });
}

/**
 * Erro padronizado: sempre { erro: 'codigo_em_snake_case' }.
 *
 * `detalhe` e opcional e SEMPRE generico. Nunca colocamos aqui mensagem do banco
 * nem do Graph: elas citam nome de tabela, de coluna e de biblioteca, e este
 * endpoint responde a um cliente externo.
 */
export function respostaErro(
  codigo: string,
  status: number,
  metodos?: string,
  detalhe?: string,
): Response {
  return respostaJson(detalhe ? { erro: codigo, detalhe } : { erro: codigo }, status, metodos);
}

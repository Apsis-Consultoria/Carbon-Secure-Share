// -----------------------------------------------------------------------------
// Montagem da lista de projetos que vai DENTRO do token de sessao.
// -----------------------------------------------------------------------------
// Este bloco morava dentro de carbon-ss-login. Ele saiu de la quando surgiu o
// segundo emissor de sessao (carbon-ss-entrar, a entrada por codigo): duas copias
// divergiriam, e a divergencia apareceria como a pasta Geral existindo num
// caminho de login e sumindo no outro - um bug que so o cliente ve, e so as
// vezes.
//
// E MOVIMENTO, nao copia. Se voce chegou aqui procurando por que carbon-ss-login
// ficou curto: e este arquivo.

import { lerConfigSharePoint } from './config.ts';
import { ID_GERAL, type ProjetoSessao } from './sessao.ts';

/** So o campo que interessa aqui. Existe para o teste poder dublar sem SharePoint. */
type ConfigComGeral = { pastaGeral: string };

/**
 * Converte a saida das funcoes do banco em `ProjetoSessao[]`, ja com a Geral.
 *
 * Entra o array `projetos` devolvido por `carbon_secure_share_autorizar` (entrada
 * por codigo) ou por `carbon_secure_share_autenticar` (senha, em transicao). As
 * duas devolvem o mesmo formato de item de proposito: cliente_id, projeto_id,
 * ap_os, empresa, pasta e nome.
 *
 * @param lerConfig injetavel so para teste. Em producao e sempre
 *   lerConfigSharePoint; um segundo chamador em producao seria sinal de que
 *   alguem esta montando a Geral por fora.
 */
export async function montarProjetos(
  brutos: unknown,
  lerConfig: () => Promise<ConfigComGeral> = lerConfigSharePoint,
): Promise<{ projetos: ProjetoSessao[]; nome: string }> {
  const lista = Array.isArray(brutos) ? (brutos as Record<string, unknown>[]) : [];

  const projetos: ProjetoSessao[] = lista.map((p) => ({
    projeto_id: String(p.projeto_id),
    empresa: String(p.empresa ?? ''),
    ap_os: (p.ap_os as string) ?? null,
    // O nome da pasta vem do BANCO (carbon_secure_share_nome_pasta), nunca
    // recalculado aqui: duas implementacoes divergentes fariam o cliente
    // procurar uma pasta que nao existe.
    pasta: String(p.pasta ?? ''),
  }));

  const nome = String(lista[0]?.nome ?? '');

  /*
   * A pasta GERAL entra na sessao como se fosse mais um projeto, marcada como
   * somente leitura.
   *
   * POR QUE ASSIM, e nao com um parametro `escopo` nas rotas: listar,
   * visualizar, baixar e montar o ZIP passam a funcionar sem NENHUMA
   * ramificacao - eles ja resolvem "o projeto do token". O unico lugar que
   * precisa saber que a Geral e diferente e o envio, que a recusa. Um caminho
   * a menos e um caminho a menos para esquecer de proteger.
   *
   * Ela so entra se o cliente tiver ao menos um projeto de verdade: quem nao
   * tem acesso a projeto nenhum tambem nao deve ver a Geral.
   */
  if (projetos.length) {
    const cfg = await lerConfig();
    if (cfg.pastaGeral) {
      projetos.unshift({
        projeto_id: ID_GERAL,
        empresa: cfg.pastaGeral,
        ap_os: null,
        pasta: cfg.pastaGeral,
        somenteLeitura: true,
      });
    }
  }

  return { projetos, nome };
}

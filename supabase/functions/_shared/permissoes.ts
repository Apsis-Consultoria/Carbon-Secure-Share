// -----------------------------------------------------------------------------
// Carrega as regras de permissao de um projeto e monta o resolvedor.
// -----------------------------------------------------------------------------
// A parte com I/O. A decisao em si vive em regrasPermissao.ts, que e pura.

import { obterAdmin } from './supabase.ts';
import { ID_GERAL } from './sessao.ts';
import { montarResolvedor, type LinhaPermissao, type Resolvedor } from './regrasPermissao.ts';

/**
 * Regras do projeto para um e-mail, ja resolvidas.
 *
 * Uma consulta por requisicao, e nao uma por arquivo: um pedido de ZIP percorre
 * centenas de itens, e consultar por item transformaria o download de uma pasta
 * em centenas de idas ao banco.
 *
 * FALHA FECHADA. Se a consulta der erro, devolvemos um resolvedor que NEGA tudo,
 * em vez de um que libera. Um erro transitorio de banco nao pode virar acesso a
 * documento que o cliente nao deveria ver: a tela mostra a pasta vazia, que e um
 * problema visivel, em vez de vazar, que e um problema invisivel.
 */
export async function carregarPermissoes(
  projetoId: string,
  email: string,
): Promise<Resolvedor> {
  /*
   * A pasta GERAL nao tem restricao por item, POR DEFINICAO: ela existe para
   * guardar o que todo cliente deve ver. Restringir um item dentro dela seria a
   * contradicao do proposito - se e restrito, o lugar e a pasta do projeto.
   *
   * O desvio tambem e NECESSARIO, e nao so conceitual: ID_GERAL nao e um uuid,
   * entao a consulta abaixo devolveria erro de tipo, cairia na falha fechada e
   * a Geral ficaria INVISIVEL para todo mundo. Sem este atalho o recurso
   * simplesmente nao funcionaria, e o sintoma seria uma pasta vazia sem erro.
   *
   * CONSEQUENCIA OPERACIONAL, que a equipe precisa entender: o que a APSIS
   * colocar na Geral aparece para TODOS os clientes de TODOS os projetos.
   */
  if (projetoId === ID_GERAL) {
    return { negado: () => false, somenteVer: () => false, nivel: () => 'total' };
  }

  const admin = obterAdmin();

  const { data, error } = await admin
    .from('carbon_secure_share_permissoes')
    .select('item_path, emails_negados, emails_sem_download')
    .eq('projeto_id', projetoId);

  if (error) {
    console.error('Falha ao carregar permissoes do Secure Share:', error.message);
    return {
      negado: () => true,
      somenteVer: () => true,
      nivel: () => 'nenhum',
    };
  }

  return montarResolvedor((data ?? []) as LinhaPermissao[], email);
}

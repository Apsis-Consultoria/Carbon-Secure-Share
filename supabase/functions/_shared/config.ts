// -----------------------------------------------------------------------------
// Configuracao do SharePoint, lida de carbon_app_config.
// -----------------------------------------------------------------------------
// MESMA linha `secure_share` que o Portal Apsis Carbon usa (criada na migration
// 20260817120000_secure_share.sql daquele repositorio). Os dois sistemas
// precisam apontar para a MESMA biblioteca: e a mesma pasta, vista dos dois
// lados. Duplicar a configuracao aqui, em variavel de ambiente, criaria a
// possibilidade de a equipe enviar para um lugar e o cliente ler de outro.
//
// A linha e `publico = false`: so as Edge Functions leem, com service_role.

import { obterAdmin } from './supabase.ts';
import type { ConfigSharePoint } from './graph.ts';

/**
 * ONDE OS ARQUIVOS FICAM, decidido em 2026-08-21.
 *
 *   https://apsisconsult.sharepoint.com/sites/Projetos
 *     biblioteca "Secure Share"        <- a MESMA do Portal Apsis
 *       pasta     "Apsis Carbon"       <- so o que e do Carbon
 *         "AP-10001-26-001 - Cliente"  <- uma por projeto
 *
 * Nao e biblioteca separada: e uma PASTA dentro da biblioteca que a APSIS ja
 * usa. Por isso existe `pastaBase`, e por isso todo caminho montado para o Graph
 * comeca por ela. Sem esse prefixo os projetos do Carbon cairiam na raiz da
 * biblioteca, misturados com os do Portal Apsis.
 *
 * `pastaBase` vazia significa "a raiz da biblioteca". Isso e suportado de
 * proposito: se um dia o Carbon ganhar biblioteca propria, basta limpar o campo
 * em carbon_app_config, sem tocar em codigo.
 */
const PADRAO: ConfigSharePoint = {
  siteHost: 'apsisconsult.sharepoint.com',
  sitePath: '/sites/Projetos',
  biblioteca: 'Secure Share',
  pastaBase: 'Apsis Carbon',
  pastaGeral: 'Geral',
};

let cache: ConfigSharePoint | null = null;

export async function lerConfigSharePoint(): Promise<ConfigSharePoint> {
  if (cache) return cache;

  const admin = obterAdmin();
  const { data } = await admin
    .from('carbon_app_config')
    .select('valor')
    .eq('chave', 'secure_share')
    .maybeSingle();

  const valor = (data?.valor ?? {}) as Record<string, unknown>;
  // Restrito as chaves OBRIGATORIAS. `driveId` e opcional e nao tem default em
  // PADRAO - ele e descoberto, nao configurado - entao inclui-lo aqui faria o
  // retorno virar `string | undefined` e contaminar os quatro campos que sao
  // sempre string.
  type ChaveTexto = 'siteHost' | 'sitePath' | 'biblioteca' | 'pastaGeral';
  const texto = (chave: ChaveTexto): string => {
    const v = valor[chave];
    return typeof v === 'string' && v.trim() ? v.trim() : PADRAO[chave];
  };

  cache = {
    // Descoberto, nao configurado: ver obterDriveId em graph.ts.
    driveId: typeof valor.driveId === 'string' && valor.driveId.trim()
      ? valor.driveId.trim()
      : undefined,
    siteHost: texto('siteHost'),
    sitePath: texto('sitePath'),
    biblioteca: texto('biblioteca'),
    // String vazia e valor VALIDO aqui (raiz da biblioteca), entao ela nao pode
    // cair no default pelo caminho de texto() acima.
    pastaBase: typeof valor.pastaBase === 'string' ? valor.pastaBase.trim() : PADRAO.pastaBase,
    pastaGeral: texto('pastaGeral'),
  };
  return cache;
}

/**
 * Caminho absoluto de um item dentro da biblioteca, ja com a pasta base.
 *
 * TODO caminho enviado ao Graph precisa passar por aqui. Montar
 * `${projeto.pasta}/${sub}` a mao esquece o prefixo e escreve na raiz da
 * biblioteca do Portal Apsis, no meio dos projetos de M&A.
 */
export function caminhoNaBiblioteca(
  cfg: ConfigSharePoint,
  ...partes: (string | null | undefined)[]
): string {
  return [cfg.pastaBase, ...partes].filter((p) => p && String(p).trim()).join('/');
}

/**
 * Grava (ou apaga) o driveId descoberto na linha `secure_share`.
 *
 * MERGE em jsonb, e nao substituicao do objeto: a linha guarda tambem siteHost,
 * biblioteca, remetente e portalUrl, e sobrescrever o valor inteiro apagaria
 * tudo isso. O `||` do Postgres mescla no nivel de cima, que e o que queremos.
 *
 * NAO LANCA. Isto e otimizacao, nao correcao: se a gravacao falhar, o proximo
 * isolate frio simplesmente redescobre pelo Graph, como fazia antes. Derrubar a
 * requisicao do cliente por causa de um cache seria trocar lentidao por erro.
 *
 * Atualiza o cache de memoria junto, para a mesma requisicao ja enxergar.
 */
export async function gravarDriveId(driveId: string | null): Promise<void> {
  try {
    const admin = obterAdmin();
    const { error } = await admin.rpc('carbon_secure_share_gravar_drive_id', {
      p_drive_id: driveId,
    });
    if (error) {
      console.warn('Nao foi possivel guardar o driveId:', error.message);
      return;
    }
    if (cache) cache = { ...cache, driveId: driveId ?? undefined };
  } catch (e) {
    console.warn('Nao foi possivel guardar o driveId:', e instanceof Error ? e.message : e);
  }
}

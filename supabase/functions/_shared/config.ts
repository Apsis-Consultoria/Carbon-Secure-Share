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

const PADRAO: ConfigSharePoint = {
  siteHost: 'apsisconsult.sharepoint.com',
  sitePath: '/sites/Projetos',
  biblioteca: 'Secure Share Carbon',
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
  const texto = (chave: keyof ConfigSharePoint) => {
    const v = valor[chave];
    return typeof v === 'string' && v.trim() ? v.trim() : PADRAO[chave];
  };

  cache = {
    siteHost: texto('siteHost'),
    sitePath: texto('sitePath'),
    biblioteca: texto('biblioteca'),
  };
  return cache;
}

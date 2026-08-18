// -----------------------------------------------------------------------------
// Regras de permissao por item. Logica PURA, sem I/O.
// -----------------------------------------------------------------------------
// Separada de permissoes.ts (que consulta o banco) porque e o codigo que decide
// quem ve e quem baixa o que: precisa ser lido e testado sozinho, sem subir
// banco.
//
// Duas restricoes por item_path, cada uma com uma lista de e-mails:
//   emails_negados       o cliente nem enxerga o item
//   emails_sem_download  o cliente visualiza, mas nao baixa
//
// AS REGRAS SAO HERDADAS PELOS DESCENDENTES. Marcar a pasta "Confidencial" como
// negada vale para tudo dentro dela. Sem heranca, uma regra em pasta nao teria
// efeito nenhum sobre o conteudo e o download da pasta em ZIP viraria a brecha
// que anula todas as restricoes de uma vez.
//
// O MAIS RESTRITIVO GANHA quando varias regras alcancam o mesmo item (a dele, a
// da pasta, a da pasta da pasta). A alternativa - a regra mais especifica ganha -
// permitiria liberar um arquivo dentro de uma pasta negada, e a tela do Portal
// Carbon nao tem como representar essa sutileza.
//
// Espelha public.carbon_secure_share_nivel_item. Se um mudar, o outro tem de
// mudar: as duas implementacoes existem porque o banco decide na consulta e esta
// aqui decide sobre a arvore inteira, em memoria, num pedido de ZIP.

export interface LinhaPermissao {
  item_path: string;
  emails_negados?: unknown;
  emails_sem_download?: unknown;
}

export interface Resolvedor {
  /** true quando o cliente nao pode nem ver o item (ou um ancestral dele). */
  negado(caminho: string): boolean;
  /** true quando pode ver mas nao baixar o item (ou um ancestral dele). */
  somenteVer(caminho: string): boolean;
  /** 'total' | 'visualizar' | 'nenhum'. Mesmos nomes usados no Portal Carbon. */
  nivel(caminho: string): 'total' | 'visualizar' | 'nenhum';
}

/** Caminho e todos os ancestrais: "a/b/c.pdf" -> ["a/b/c.pdf", "a/b", "a"]. */
export function comAncestrais(caminho: string): string[] {
  const partes = (caminho || '').split('/').filter(Boolean);
  const saida: string[] = [];
  for (let i = partes.length; i > 0; i--) saida.push(partes.slice(0, i).join('/'));
  return saida;
}

/** Comparacao em minusculas e sem barra nas pontas, acompanhando o SharePoint. */
function chave(itemPath: unknown): string {
  return String(itemPath || '').toLowerCase().replace(/^\/+|\/+$/g, '');
}

export function montarResolvedor(linhas: LinhaPermissao[], email: string): Resolvedor {
  const alvo = (email || '').toLowerCase().trim();

  const negados = new Set<string>();
  const semDownload = new Set<string>();

  const contem = (lista: unknown) =>
    (Array.isArray(lista) ? lista : []).some(
      (e: unknown) => String(e).toLowerCase().trim() === alvo,
    );

  for (const linha of linhas || []) {
    const k = chave(linha?.item_path);
    if (!k) continue;
    if (contem(linha.emails_negados)) negados.add(k);
    if (contem(linha.emails_sem_download)) semDownload.add(k);
  }

  const casa = (conjunto: Set<string>, caminho: string) =>
    conjunto.size > 0 &&
    comAncestrais(String(caminho || '').toLowerCase()).some((p) => conjunto.has(p));

  const negado = (caminho: string) => casa(negados, caminho);
  const somenteVer = (caminho: string) => casa(semDownload, caminho);

  return {
    negado,
    somenteVer,
    nivel: (caminho: string) =>
      negado(caminho) ? 'nenhum' : somenteVer(caminho) ? 'visualizar' : 'total',
  };
}

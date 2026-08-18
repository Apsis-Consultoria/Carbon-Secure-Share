// -----------------------------------------------------------------------------
// Sanitizacao de caminho antes de montar a URL do SharePoint.
// -----------------------------------------------------------------------------
// Tudo que chega do navegador e entrada nao confiavel. Um "../" aqui sai da
// pasta do projeto e alcanca a biblioteca inteira, ou seja os documentos de
// TODOS os clientes.
//
// A defesa e remover os SEPARADORES e descartar segmentos que sejam apenas
// pontos. NAO removemos ".." de dentro de um nome: sem separador ele nao sobe
// diretorio nenhum, e remover destruiria nome legitimo ("Balanco..2024.pdf"
// viraria "Balanco.2024.pdf", um arquivo que nao existe - ele apareceria na
// listagem e falharia ao abrir).

// Separadores e caracteres invalidos no Windows/SharePoint.
// NAO inclui espaco nem hifen: eles sao legitimos e aparecem em toda pasta
// ("AP-12345-26-001 - Empresa XYZ").
const INVALIDOS = /[/\\<>:"|?*]/g;

/** true quando o segmento e so pontos (".", "..", "...."), nunca um nome real. */
function soPontos(seg: string): boolean {
  return seg.length > 0 && /^\.+$/.test(seg);
}

function limparSegmento(seg: string): string {
  let s = seg || '';
  s = s.replace(INVALIDOS, '');
  // Caracteres de controle, sem usar regex de controle (que o lint reclama).
  s = Array.from(s).filter((c) => c.charCodeAt(0) >= 32).join('');
  s = s.trim();
  return soPontos(s) ? '' : s;
}

/** Sanitiza um unico nome, sem barras. */
export function limparNome(valor: string): string {
  return limparSegmento(valor);
}

/**
 * Sanitiza um caminho relativo preservando a estrutura de pastas.
 *
 * A contrabarra e normalizada para barra ANTES de dividir, de proposito: sem
 * isso, "..\..\x.pdf" nao seria dividido em segmentos e viraria o nome
 * "....x.pdf" em vez de cair no descarte.
 */
export function limparCaminho(valor: string): string {
  return (valor || '')
    .replace(/\\/g, '/')
    .split('/')
    .map(limparSegmento)
    .filter(Boolean)
    .join('/');
}

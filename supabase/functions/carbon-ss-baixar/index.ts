// -----------------------------------------------------------------------------
// carbon-ss-baixar - o UNICO caminho pelo qual bytes de arquivo chegam ao cliente.
// -----------------------------------------------------------------------------
// GET ?projeto_id=<uuid>&caminho=<relativo>&modo=preview|download
//
// Regra central do sistema: a downloadUrl do SharePoint nunca sai do servidor, e
// nenhuma funcao daqui a pede ao Graph. Ela e pre-autenticada - quem a recebesse
// baixaria o arquivo cru, sem marca d'agua, contornando "somente visualizar".
//
// Dois modos:
//   preview   permitido inclusive para "somente visualizar". Content-Disposition
//             inline. Office e convertido em PDF pelo Graph, para tambem receber
//             marca d'agua em vez de depender de visualizador externo.
//   download  403 para "somente visualizar". Content-Disposition attachment.
//
// A permissao e conferida A CADA REQUISICAO, pelo caminho pedido, com heranca de
// pasta. Nao existe atalho: pedir o arquivo pelo caminho completo nao contorna a
// regra da pasta que o contem.

import { cabecalhosCors, tratarOptions, respostaErro } from '../_shared/cors.ts';
import { extrairToken, verificarSessao, projetoAutorizado } from '../_shared/sessao.ts';
import { carregarPermissoes } from '../_shared/permissoes.ts';
import { lerConfigSharePoint, caminhoNaBiblioteca } from '../_shared/config.ts';
import { ErroGraph, obterConteudo, obterItem, temConfigAzure } from '../_shared/graph.ts';
import { limparCaminho } from '../_shared/caminho.ts';
import { marcarPdf } from '../_shared/marcaDagua.ts';

const METODOS = 'GET, OPTIONS';

// Acima disso o PDF sai SEM marca d'agua. O pdf-lib precisa do arquivo inteiro
// em memoria e a Edge Function tem por volta de 256 MB: melhor entregar sem
// marca do que estourar a memoria e derrubar tambem o ZIP da pasta.
const LIMITE_MARCA_BYTES = 120 * 1024 * 1024;

const EXT_OFFICE = new Set([
  'doc', 'docx', 'xls', 'xlsx', 'xlsb', 'csv', 'ppt', 'pptx', 'odt', 'ods', 'odp', 'rtf',
]);

function extensao(nome: string): string {
  return (nome.split('.').pop() || '').toLowerCase();
}

/**
 * Tipos que NAO podem ser servidos como si mesmos: eles executam script no
 * navegador.
 *
 * POR QUE ISTO E CRITICO AQUI, e nao era antes: desde que o frontend passou a
 * falar por /api/* (caminho relativo, resolvido por rewrite da hospedagem),
 * esta resposta chega ao navegador na MESMA ORIGEM do portal. Antes ela vinha
 * de <ref>.supabase.co, uma origem separada, e o isolamento era automatico.
 *
 * Com mesma origem, um arquivo .html enviado por um cliente e aberto no painel
 * de visualizacao rodaria script COM ACESSO ao sessionStorage do portal, ou
 * seja, ao token de sessao de quem o abriu. Um cliente conseguiria roubar a
 * sessao de outra pessoa da mesma empresa apenas subindo um arquivo.
 *
 * A defesa e servir esses tipos como text/plain: o navegador mostra o codigo em
 * vez de executa-lo. Junto com X-Content-Type-Options: nosniff, nao ha caminho
 * de volta para text/html. O download (attachment) nao e afetado no conteudo,
 * so no rotulo do tipo, e o arquivo salvo em disco continua identico.
 *
 * SVG entra na lista: <svg> aceita <script> e handlers de evento. Ele continua
 * seguro dentro de <img>, que desliga script, e e assim que o frontend o exibe.
 */
const EXT_EXECUTAVEIS = new Set([
  'html', 'htm', 'xhtml', 'shtml', 'svg', 'xml', 'xsl', 'xslt', 'mhtml', 'mht',
]);

function tipoPerigoso(ext: string, tipo: string): boolean {
  if (EXT_EXECUTAVEIS.has(ext)) return true;
  const t = tipo.toLowerCase();
  return t.includes('text/html') || t.includes('xhtml') || t.includes('svg') || t.includes('xml');
}

/** Content-Disposition com nome compativel com acento (RFC 5987). */
function disposicao(nome: string, inline: boolean): string {
  const ascii = nome.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_');
  return `${inline ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(nome)}`;
}

Deno.serve(async (req: Request): Promise<Response> => {
  const preflight = tratarOptions(req, METODOS);
  if (preflight) return preflight;

  const cors = cabecalhosCors(METODOS);

  if (req.method !== 'GET') return respostaErro('metodo_nao_permitido', 405, METODOS);

  try {
    const url = new URL(req.url);

    const sessao = await verificarSessao(extrairToken(req));
    if (!sessao) return respostaErro('nao_autenticado', 401, METODOS);

    const projeto = projetoAutorizado(sessao, url.searchParams.get('projeto_id') ?? '');
    if (!projeto) return respostaErro('sem_acesso_ao_projeto', 403, METODOS);

    const relativo = limparCaminho(url.searchParams.get('caminho') ?? '');
    if (!relativo) return respostaErro('caminho_obrigatorio', 400, METODOS);

    const preview = url.searchParams.get('modo') === 'preview';

    if (!temConfigAzure()) return respostaErro('armazenamento_indisponivel', 503, METODOS);

    // ---- Permissao, com heranca de pasta -----------------------------------
    const permissoes = await carregarPermissoes(projeto.projeto_id, sessao.email);
    if (permissoes.negado(relativo)) return respostaErro('sem_acesso_ao_arquivo', 403, METODOS);
    if (!preview && permissoes.somenteVer(relativo)) {
      return respostaErro('somente_visualizacao', 403, METODOS);
    }

    const cfg = await lerConfigSharePoint();
    const completo = caminhoNaBiblioteca(cfg, projeto.pasta, relativo);

    const item = await obterItem(cfg, completo);
    if (!item) return respostaErro('nao_encontrado', 404, METODOS);
    if (item.ehPasta) return respostaErro('item_e_pasta', 400, METODOS);

    const nome = item.nome || relativo.split('/').pop() || 'arquivo';
    const ext = extensao(nome);

    const base: Record<string, string> = {
      ...cors,
      'Cache-Control': 'no-store, no-cache',
      'X-Content-Type-Options': 'nosniff',
    };

    // ---- Office na visualizacao: Graph converte em PDF e marcamos -----------
    if (preview && EXT_OFFICE.has(ext)) {
      const resposta = await obterConteudo(cfg, completo, 'pdf');
      if (!resposta.ok) {
        await resposta.body?.cancel();
        // Dizer que a previa falhou e melhor do que cair para "abra no
        // SharePoint", que entregaria a URL do documento.
        return respostaErro('previa_indisponivel', 502, METODOS);
      }

      const bytes = await resposta.arrayBuffer();
      let saida: ArrayBuffer | Uint8Array = bytes;
      try {
        saida = await marcarPdf(bytes, projeto.empresa, sessao.email);
      } catch (e) {
        // Sem marca e pior do que com marca, mas muito melhor do que negar o
        // acesso a um documento que a pessoa tem direito de ver.
        console.error('Marca d agua falhou na previa:', e);
      }

      return new Response(saida, {
        headers: {
          ...base,
          'Content-Type': 'application/pdf',
          'Content-Disposition': disposicao(`${nome}.pdf`, true),
        },
      });
    }

    const resposta = await obterConteudo(cfg, completo);
    if (!resposta.ok || !resposta.body) {
      await resposta.body?.cancel();
      return respostaErro('falha_ao_buscar', 502, METODOS);
    }

    const tipo = resposta.headers.get('content-type') || 'application/octet-stream';
    const ehPdf = tipo.includes('pdf') || ext === 'pdf';

    if (ehPdf && item.tamanho <= LIMITE_MARCA_BYTES) {
      const bytes = await resposta.arrayBuffer();
      let saida: ArrayBuffer | Uint8Array = bytes;
      try {
        saida = await marcarPdf(bytes, projeto.empresa, sessao.email);
      } catch (e) {
        console.error('Marca d agua falhou no PDF:', e);
      }

      return new Response(saida, {
        headers: {
          ...base,
          'Content-Type': 'application/pdf',
          'Content-Disposition': disposicao(nome, preview),
        },
      });
    }

    // Tipo que executa script vira text/plain. Ver a nota de EXT_EXECUTAVEIS:
    // esta resposta e servida na MESMA ORIGEM do portal, entao um .html de
    // cliente aberto no visualizador leria o token de sessao de quem o abriu.
    const tipoSeguro = tipoPerigoso(ext, tipo) ? 'text/plain; charset=utf-8' : tipo;

    // Demais arquivos: repasse em streaming, sem bufferizar.
    // Sem Content-Length de proposito: se a plataforma comprimir a resposta, o
    // valor herdado do upstream nao bateria com os bytes entregues e o navegador
    // cortaria o download no meio.
    return new Response(resposta.body, {
      headers: {
        ...base,
        'Content-Type': tipoSeguro,
        'Content-Disposition': disposicao(nome, preview),
        // Segunda camada, para o caso de um tipo perigoso que a lista nao
        // preveja: proibe script, plugin e navegacao de topo a partir deste
        // documento. Nao substitui o text/plain acima, reforca.
        'Content-Security-Policy': "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox",
      },
    });
  } catch (e) {
    if (e instanceof ErroGraph) return respostaErro(e.codigo, e.status, METODOS);
    console.error('Falha inesperada em carbon-ss-baixar:', e);
    return respostaErro('erro_interno', 500, METODOS);
  }
});

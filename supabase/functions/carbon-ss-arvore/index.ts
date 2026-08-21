// -----------------------------------------------------------------------------
// carbon-ss-arvore - manifesto recursivo do que o cliente pode BAIXAR.
// -----------------------------------------------------------------------------
// GET ?projeto_id=<uuid>&sub=<pasta relativa>
//   -> { arquivos: [{ caminho, nome, tamanho }], total, bytes, ignorados }
//
// Alimenta o download de pasta em ZIP. O ZIP e montado NO NAVEGADOR, em
// streaming: esta funcao so diz quais arquivos entram, e carbon-ss-baixar
// entrega os bytes de um por vez.
//
// POR QUE O ZIP NAO E MONTADO AQUI: Edge Function tem limite de tempo de
// execucao e de memoria. Uma pasta de due diligence com alguns GB falharia no
// meio e o cliente receberia um ZIP corrompido - pior do que nao ter o recurso,
// porque o erro so aparece na hora de abrir.
//
// A MESMA regra de permissao dos arquivos avulsos vale aqui: item negado nao
// entra e nem e contado; item "somente visualizar" fica FORA do ZIP e entra em
// `ignorados`, para a tela poder dizer quantos arquivos ficaram de fora e por
// que, em vez de entregar um ZIP silenciosamente incompleto.

import { tratarOptions, respostaErro, respostaJson } from '../_shared/cors.ts';
import { extrairToken, verificarSessao, projetoAutorizado } from '../_shared/sessao.ts';
import { carregarPermissoes } from '../_shared/permissoes.ts';
import { lerConfigSharePoint, caminhoNaBiblioteca } from '../_shared/config.ts';
import { ErroGraph, listarPasta, temConfigAzure, type ConfigSharePoint } from '../_shared/graph.ts';
import { limparCaminho } from '../_shared/caminho.ts';
import type { Resolvedor } from '../_shared/regrasPermissao.ts';

const METODOS = 'GET, OPTIONS';

// Teto de seguranca: uma pasta com mais que isso vira um ZIP que o navegador nao
// dá conta de montar, e a varredura recursiva sozinha ja estouraria o tempo da
// funcao. Quando o teto e atingido, avisamos em vez de truncar em silencio.
const MAX_ARQUIVOS = 2000;
const MAX_PROFUNDIDADE = 12;

type Arquivo = { caminho: string; nome: string; tamanho: number };

async function percorrer(
  cfg: ConfigSharePoint,
  raiz: string,
  relativo: string,
  permissoes: Resolvedor,
  saida: Arquivo[],
  estado: { ignorados: number; truncado: boolean },
  profundidade: number,
): Promise<void> {
  if (estado.truncado || profundidade > MAX_PROFUNDIDADE) return;

  const itens = await listarPasta(cfg, relativo ? `${raiz}/${relativo}` : raiz);

  for (const item of itens) {
    if (saida.length >= MAX_ARQUIVOS) {
      estado.truncado = true;
      return;
    }

    const caminho = relativo ? `${relativo}/${item.nome}` : item.nome;
    const nivel = permissoes.nivel(caminho);

    // Negado nao existe para este cliente: nao entra e nao e contado como
    // ignorado, porque contar ja revelaria que ha algo ali.
    if (nivel === 'nenhum') continue;

    if (item.tipo === 'pasta') {
      await percorrer(cfg, raiz, caminho, permissoes, saida, estado, profundidade + 1);
      continue;
    }

    if (nivel === 'visualizar') {
      estado.ignorados += 1;
      continue;
    }

    saida.push({ caminho, nome: item.nome, tamanho: item.tamanho ?? 0 });
  }
}

Deno.serve(async (req: Request): Promise<Response> => {
  const preflight = tratarOptions(req, METODOS);
  if (preflight) return preflight;

  if (req.method !== 'GET') return respostaErro('metodo_nao_permitido', 405, METODOS);

  try {
    const url = new URL(req.url);

    const sessao = await verificarSessao(extrairToken(req));
    if (!sessao) return respostaErro('nao_autenticado', 401, METODOS);

    const projeto = projetoAutorizado(sessao, url.searchParams.get('projeto_id') ?? '');
    if (!projeto) return respostaErro('sem_acesso_ao_projeto', 403, METODOS);

    if (!temConfigAzure()) return respostaErro('armazenamento_indisponivel', 503, METODOS);

    const sub = limparCaminho(url.searchParams.get('sub') ?? '');

    // A propria pasta pedida pode estar negada: sem esta checagem, pedir o ZIP
    // de uma pasta negada varreria o conteudo dela antes de o filtro por item
    // agir, e o custo (e o vazamento de estrutura) ja teria acontecido.
    const permissoes = await carregarPermissoes(projeto.projeto_id, sessao.email);
    if (sub && permissoes.negado(sub)) return respostaErro('sem_acesso_ao_arquivo', 403, METODOS);

    const cfg = await lerConfigSharePoint();

    const arquivos: Arquivo[] = [];
    const estado = { ignorados: 0, truncado: false };
    await percorrer(cfg, caminhoNaBiblioteca(cfg, projeto.pasta), sub, permissoes, arquivos, estado, 0);

    return respostaJson(
      {
        arquivos,
        total: arquivos.length,
        bytes: arquivos.reduce((soma, a) => soma + a.tamanho, 0),
        // Quantos ficaram de fora por serem "somente visualizar".
        ignorados: estado.ignorados,
        // Nunca truncamos em silencio: a tela avisa que o ZIP nao esta completo.
        truncado: estado.truncado,
        limite: MAX_ARQUIVOS,
      },
      200,
      METODOS,
    );
  } catch (e) {
    if (e instanceof ErroGraph) return respostaErro(e.codigo, e.status, METODOS);
    console.error('Falha inesperada em carbon-ss-arvore:', e);
    return respostaErro('erro_interno', 500, METODOS);
  }
});

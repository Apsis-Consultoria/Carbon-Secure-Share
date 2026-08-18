// -----------------------------------------------------------------------------
// carbon-ss-listar - conteudo de uma pasta, ja filtrado pelas permissoes.
// -----------------------------------------------------------------------------
// GET ?projeto_id=<uuid>&sub=<caminho relativo>
//   -> { itens: [{ nome, tipo, tamanho, atualizadoEm, nivel }], caminho }
//
// O projeto vem do TOKEN, nao do parametro: `projeto_id` so seleciona qual das
// entradas autorizadas usar. Um id que nao esta no token da 403.
//
// Item negado NAO aparece na lista. Item "somente visualizar" aparece com
// nivel = 'visualizar', e a tela esconde o botao de baixar - mas a decisao real
// e refeita em carbon-ss-baixar a cada byte, porque esconder botao no navegador
// nao e autorizacao.
//
// Nenhuma downloadUrl sai daqui. Ver a nota em _shared/graph.ts.

import { tratarOptions, respostaErro, respostaJson } from '../_shared/cors.ts';
import { extrairToken, verificarSessao, projetoAutorizado } from '../_shared/sessao.ts';
import { carregarPermissoes } from '../_shared/permissoes.ts';
import { lerConfigSharePoint } from '../_shared/config.ts';
import { ErroGraph, listarPasta, temConfigAzure } from '../_shared/graph.ts';
import { limparCaminho } from '../_shared/caminho.ts';

const METODOS = 'GET, OPTIONS';

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
    const cfg = await lerConfigSharePoint();
    const caminho = sub ? `${projeto.pasta}/${sub}` : projeto.pasta;

    const [itens, permissoes] = await Promise.all([
      listarPasta(cfg, caminho),
      carregarPermissoes(projeto.projeto_id, sessao.email),
    ]);

    const visiveis = itens
      .map((item) => {
        // O caminho da REGRA e relativo a raiz do projeto, sem o nome da pasta
        // do projeto: e assim que ela sobrevive a uma renomeacao do cliente.
        const relativo = sub ? `${sub}/${item.nome}` : item.nome;
        return { ...item, caminho: relativo, nivel: permissoes.nivel(relativo) };
      })
      .filter((item) => item.nivel !== 'nenhum');

    return respostaJson({ itens: visiveis, caminho: sub }, 200, METODOS);
  } catch (e) {
    if (e instanceof ErroGraph) return respostaErro(e.codigo, e.status, METODOS);
    console.error('Falha inesperada em carbon-ss-listar:', e);
    return respostaErro('erro_interno', 500, METODOS);
  }
});

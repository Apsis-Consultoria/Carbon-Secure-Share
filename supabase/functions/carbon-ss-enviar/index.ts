// -----------------------------------------------------------------------------
// carbon-ss-enviar - o cliente envia arquivos para a pasta do projeto.
// -----------------------------------------------------------------------------
// POST multipart/form-data
//   projeto_id  uuid (obrigatorio, precisa estar no token)
//   destino     pasta de destino, relativa a raiz do projeto ('' = raiz)
//   arquivo     um ou mais
//   caminho     um por arquivo, na MESMA ordem, com a subpasta de origem
//               (preserva a estrutura quando se arrasta uma pasta inteira)
//
// DESTINO ESCOLHIDO PELO CLIENTE, e nao mais uma pasta fixa.
//
// A versao anterior forcava tudo para "Enviados pelo cliente". Isso dava duas
// garantias: a equipe sabia o que veio de fora, e nenhum envio podia sobrescrever
// documento da APSIS. O pedido do dono foi arrastar e soltar em QUALQUER pasta,
// como no explorador de arquivos, e isso e incompativel com a pasta fixa.
//
// A garantia contra sobrescrita NAO foi abandonada, foi trocada de lugar: o
// upload usa conflictBehavior=rename (ver _shared/graph.ts), entao um arquivo de
// nome repetido vira copia em vez de substituir o original, e o nome final volta
// para a tela avisar. Perda de evidencia por sobrescrita continua impossivel.
//
// O que se perdeu: a separacao automatica entre o que a APSIS enviou e o que o
// cliente enviou. Se isso voltar a ser necessario, o lugar e uma coluna de
// procedencia no banco, nao a pasta.
//
// `destino` e sempre RELATIVO a pasta do projeto e passa por limparCaminho, que
// descarta ".." e separadores: nao ha como escrever fora do projeto.

import { tratarOptions, respostaErro, respostaJson } from '../_shared/cors.ts';
import { extrairToken, verificarSessao, projetoAutorizado, ID_GERAL } from '../_shared/sessao.ts';
import { lerConfigSharePoint, caminhoNaBiblioteca } from '../_shared/config.ts';
import { ErroGraph, enviarArquivo, garantirPasta, temConfigAzure } from '../_shared/graph.ts';
import { limparCaminho, limparNome } from '../_shared/caminho.ts';

const METODOS = 'POST, OPTIONS';

// Upload simples do Graph. Acima disso seria preciso sessao resumavel
// (createUploadSession), que e trabalho proprio; recusamos com mensagem clara em
// vez de falhar no meio e deixar arquivo parcial na pasta.
const LIMITE_ARQUIVO_BYTES = 200 * 1024 * 1024;
const LIMITE_ARQUIVOS = 30;

Deno.serve(async (req: Request): Promise<Response> => {
  const preflight = tratarOptions(req, METODOS);
  if (preflight) return preflight;

  if (req.method !== 'POST') return respostaErro('metodo_nao_permitido', 405, METODOS);

  try {
    const sessao = await verificarSessao(extrairToken(req));
    if (!sessao) return respostaErro('nao_autenticado', 401, METODOS);

    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return respostaErro('corpo_invalido', 400, METODOS);
    }

    const projetoIdPedido = String(form.get('projeto_id') ?? '');
    const projeto = projetoAutorizado(sessao, projetoIdPedido);
    if (!projeto) return respostaErro('sem_acesso_ao_projeto', 403, METODOS);

    /*
     * A pasta GERAL e somente leitura para o cliente. Quem escreve nela e a
     * equipe da APSIS, pelo Portal Carbon.
     *
     * DUAS checagens independentes de proposito: o id reservado (que nao pode
     * ser forjado, porque vem do token assinado) e a flag. Se um dia a flag
     * deixar de ser gravada por um bug no login, o id ainda barra; se o id
     * mudar, a flag ainda barra. Um vazamento aqui significaria um cliente
     * publicando arquivo na pasta que TODOS os outros clientes enxergam.
     */
    if (projetoIdPedido === ID_GERAL || projeto.projeto_id === ID_GERAL || projeto.somenteLeitura) {
      return respostaErro('pasta_somente_leitura', 403, METODOS);
    }

    if (!temConfigAzure()) return respostaErro('armazenamento_indisponivel', 503, METODOS);

    const arquivos = form.getAll('arquivo').filter((f): f is File => f instanceof File);
    if (!arquivos.length) return respostaErro('arquivo_obrigatorio', 400, METODOS);
    if (arquivos.length > LIMITE_ARQUIVOS) {
      return respostaErro('arquivos_demais', 400, METODOS, String(LIMITE_ARQUIVOS));
    }

    const caminhos = form.getAll('caminho').map((c) => String(c ?? ''));

    // Destino relativo a pasta do projeto. limparCaminho descarta '..' e
    // separadores tortos, entao nao ha como escrever fora do projeto.
    const destinoBruto = String(form.get('destino') ?? '').trim();
    const destinoRel = limparCaminho(destinoBruto);
    if (destinoBruto && !destinoRel) return respostaErro('destino_invalido', 400, METODOS);

    const cfg = await lerConfigSharePoint();
    const base = caminhoNaBiblioteca(cfg, projeto.pasta, destinoRel);

    const enviados: string[] = [];
    const renomeados: { pedido: string; gravado: string }[] = [];
    const falhas: { arquivo: string; motivo: string }[] = [];

    // Cada pasta e garantida UMA vez por requisicao: uma pasta arrastada com 30
    // arquivos faria 30 checagens identicas no Graph, e cada uma conta contra o
    // tempo de execucao.
    const pastasProntas = new Set<string>();

    for (let i = 0; i < arquivos.length; i++) {
      const arquivo = arquivos[i];
      const nome = limparNome(arquivo.name);

      if (!nome) {
        falhas.push({ arquivo: arquivo.name, motivo: 'Nome de arquivo invalido.' });
        continue;
      }
      if (arquivo.size > LIMITE_ARQUIVO_BYTES) {
        falhas.push({
          arquivo: arquivo.name,
          motivo: `Acima de ${Math.round(LIMITE_ARQUIVO_BYTES / 1024 / 1024)} MB.`,
        });
        continue;
      }

      const origem = limparCaminho(caminhos[i] ?? '');
      const destino = origem ? `${base}/${origem}` : base;

      try {
        if (!pastasProntas.has(destino)) {
          await garantirPasta(cfg, destino);
          pastasProntas.add(destino);
        }

        const nomeFinal = await enviarArquivo(
          cfg,
          `${destino}/${nome}`,
          arquivo.stream(),
          arquivo.type,
        );

        if (nomeFinal) {
          enviados.push(origem ? `${origem}/${nomeFinal}` : nomeFinal);
          // Nome diferente do pedido = ja existia um arquivo assim e o
          // SharePoint criou uma copia. A tela precisa dizer isso.
          if (nomeFinal !== nome) renomeados.push({ pedido: nome, gravado: nomeFinal });
        } else {
          falhas.push({ arquivo: arquivo.name, motivo: 'O armazenamento recusou o arquivo.' });
        }
      } catch (e) {
        console.error(`Envio de ${nome} falhou:`, e);
        falhas.push({ arquivo: arquivo.name, motivo: 'Falha inesperada no envio.' });
      }
    }

    // 207 quando parte subiu e parte nao: a tela precisa distinguir isso de um
    // sucesso liso, senao o cliente vai embora achando que mandou tudo.
    const status = falhas.length ? (enviados.length ? 207 : 502) : 200;
    return respostaJson({ enviados, renomeados, falhas, pasta: destinoRel }, status, METODOS);
  } catch (e) {
    if (e instanceof ErroGraph) return respostaErro(e.codigo, e.status, METODOS);
    console.error('Falha inesperada em carbon-ss-enviar:', e);
    return respostaErro('erro_interno', 500, METODOS);
  }
});

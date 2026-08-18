// -----------------------------------------------------------------------------
// carbon-ss-enviar - o cliente envia arquivos para a pasta do projeto.
// -----------------------------------------------------------------------------
// POST multipart/form-data
//   projeto_id  uuid (obrigatorio, precisa estar no token)
//   arquivo     um ou mais
//   caminho     um por arquivo, na MESMA ordem, com a subpasta de origem
//
// Os envios do cliente caem numa subpasta fixa "Enviados pelo cliente", e nao na
// raiz do projeto. Duas razoes:
//
//   1. a equipe da APSIS precisa distinguir o que ela mandou do que o cliente
//      mandou. Misturado na mesma arvore, ninguem sabe a origem de um arquivo
//      tres semanas depois;
//   2. sem isso, um envio do cliente com o mesmo nome de um documento da APSIS
//      SOBRESCREVERIA o documento, porque o PUT de conteudo do Graph substitui.
//      Numa pasta de due diligence, isso e perda de evidencia.
//
// O cliente nunca escolhe a pasta de destino, so a estrutura de dentro dela.

import { tratarOptions, respostaErro, respostaJson } from '../_shared/cors.ts';
import { extrairToken, verificarSessao, projetoAutorizado } from '../_shared/sessao.ts';
import { lerConfigSharePoint } from '../_shared/config.ts';
import { ErroGraph, enviarArquivo, garantirPasta, temConfigAzure } from '../_shared/graph.ts';
import { limparCaminho, limparNome } from '../_shared/caminho.ts';

const METODOS = 'POST, OPTIONS';

const PASTA_CLIENTE = 'Enviados pelo cliente';

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

    const projeto = projetoAutorizado(sessao, String(form.get('projeto_id') ?? ''));
    if (!projeto) return respostaErro('sem_acesso_ao_projeto', 403, METODOS);

    if (!temConfigAzure()) return respostaErro('armazenamento_indisponivel', 503, METODOS);

    const arquivos = form.getAll('arquivo').filter((f): f is File => f instanceof File);
    if (!arquivos.length) return respostaErro('arquivo_obrigatorio', 400, METODOS);
    if (arquivos.length > LIMITE_ARQUIVOS) {
      return respostaErro('arquivos_demais', 400, METODOS, String(LIMITE_ARQUIVOS));
    }

    const caminhos = form.getAll('caminho').map((c) => String(c ?? ''));

    const cfg = await lerConfigSharePoint();
    const base = `${projeto.pasta}/${PASTA_CLIENTE}`;

    const enviados: string[] = [];
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

        const ok = await enviarArquivo(
          cfg,
          `${destino}/${nome}`,
          arquivo.stream(),
          arquivo.type,
        );

        if (ok) enviados.push(origem ? `${origem}/${nome}` : nome);
        else falhas.push({ arquivo: arquivo.name, motivo: 'O armazenamento recusou o arquivo.' });
      } catch (e) {
        console.error(`Envio de ${nome} falhou:`, e);
        falhas.push({ arquivo: arquivo.name, motivo: 'Falha inesperada no envio.' });
      }
    }

    // 207 quando parte subiu e parte nao: a tela precisa distinguir isso de um
    // sucesso liso, senao o cliente vai embora achando que mandou tudo.
    const status = falhas.length ? (enviados.length ? 207 : 502) : 200;
    return respostaJson({ enviados, falhas, pasta: PASTA_CLIENTE }, status, METODOS);
  } catch (e) {
    if (e instanceof ErroGraph) return respostaErro(e.codigo, e.status, METODOS);
    console.error('Falha inesperada em carbon-ss-enviar:', e);
    return respostaErro('erro_interno', 500, METODOS);
  }
});

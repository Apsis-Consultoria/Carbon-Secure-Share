import { downloadZip } from 'client-zip';
import { arvore, baixarBytes } from '@/lib/api';

/**
 * Download de uma pasta em ZIP, montado NO NAVEGADOR e em streaming.
 *
 * POR QUE NAO NO SERVIDOR: Edge Function tem teto de tempo de execucao e de
 * memoria. Uma pasta de due diligence com alguns GB falharia no meio e o cliente
 * receberia um ZIP corrompido - pior do que nao ter o recurso, porque o defeito
 * so aparece na hora de abrir, depois de a pessoa ter esperado o download
 * inteiro.
 *
 * COMO FUNCIONA: `carbon-ss-arvore` devolve o manifesto do que este cliente pode
 * BAIXAR (a permissao por item ja aplicada, com heranca de pasta), e cada
 * arquivo e puxado por `carbon-ss-baixar`, um de cada vez. O client-zip vai
 * escrevendo o ZIP conforme os bytes chegam, entao a memoria usada e a de UM
 * arquivo, nao a da pasta.
 *
 * UM DE CADA VEZ, e nao em paralelo, de proposito: cada requisicao passa pela
 * Edge Function, e cinco downloads simultaneos multiplicam por cinco o consumo
 * de memoria dela (PDF com marca d'agua e bufferizado). O ganho de velocidade
 * nao compensa derrubar o download inteiro.
 */

/**
 * @param {string} projetoId
 * @param {string} sub        pasta relativa; '' baixa o projeto inteiro
 * @param {string} nomeZip    nome do arquivo gerado
 * @param {(p: {feitos:number,total:number,arquivo:string}) => void} aoProgresso
 * @param {AbortSignal} signal
 * @returns {Promise<{total:number, ignorados:number, truncado:boolean}>}
 */
export async function baixarPastaZip(projetoId, sub, nomeZip, aoProgresso, signal) {
  const manifesto = await arvore(projetoId, sub);
  const arquivos = manifesto?.arquivos ?? [];

  if (!arquivos.length) {
    return { total: 0, ignorados: manifesto?.ignorados ?? 0, truncado: false };
  }

  let feitos = 0;

  // Gerador: o client-zip consome sob demanda, entao so um arquivo fica em
  // memoria por vez. Trocar por um array de Promises anularia o streaming.
  async function* entradas() {
    for (const arquivo of arquivos) {
      if (signal?.aborted) return;

      aoProgresso?.({ feitos, total: arquivos.length, arquivo: arquivo.nome });

      let resposta;
      try {
        resposta = await baixarBytes(projetoId, arquivo.caminho, signal);
      } catch (e) {
        // Um arquivo que falhou nao derruba o ZIP inteiro: a pessoa recebe o
        // resto e percebe a ausencia. Derrubar tudo por causa de um arquivo
        // apagado no meio do caminho seria pior.
        if (signal?.aborted) return;
        console.error(`Arquivo fora do ZIP: ${arquivo.caminho}`, e);
        feitos += 1;
        continue;
      }

      yield {
        name: arquivo.caminho,
        input: resposta,
        lastModified: new Date(),
      };

      feitos += 1;
      aoProgresso?.({ feitos, total: arquivos.length, arquivo: arquivo.nome });
    }
  }

  const zip = downloadZip(entradas());
  const blob = await zip.blob();

  if (signal?.aborted) {
    return { total: 0, ignorados: manifesto?.ignorados ?? 0, truncado: false };
  }

  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = nomeZip.endsWith('.zip') ? nomeZip : `${nomeZip}.zip`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revogar imediatamente cancelaria o download em alguns navegadores; o atraso
  // curto e o suficiente para o clique ser processado.
  setTimeout(() => URL.revokeObjectURL(url), 10000);

  return {
    total: arquivos.length,
    ignorados: manifesto?.ignorados ?? 0,
    truncado: Boolean(manifesto?.truncado),
  };
}

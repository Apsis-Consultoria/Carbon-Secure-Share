// -----------------------------------------------------------------------------
// Marca d'agua em PDF.
// -----------------------------------------------------------------------------
// Aplicada na visualizacao E no download, inclusive nos PDFs que entram no ZIP
// de uma pasta e no PDF gerado a partir de um Office pelo Graph.
//
// A identidade estampada vem SEMPRE do token de sessao, nunca de parametro do
// cliente: e o que torna a marca uma evidencia de para quem o documento foi
// entregue, e nao um enfeite que o proprio destinatario escolhe.
//
// Sem logo remoto de proposito. O secure_share baixa um PNG do Storage de OUTRO
// projeto Supabase a cada PDF; isso e uma ida a rede por arquivo, quebra quando
// aquele projeto muda, e o CLAUDE.md do Carbon proibe apontar asset para o
// Storage de outro projeto. Aqui a marca e tipografica.

import { PDFDocument, rgb, StandardFonts, degrees } from 'https://esm.sh/pdf-lib@1.17.1';

/**
 * StandardFonts do pdf-lib e WinAnsi: nao tem glifo para acento.
 *
 * Passar "Reflorestadora Ltda. Ação" direto lanca erro de encoding e derruba a
 * marca inteira. Tiramos os acentos em vez de perder a estampa.
 */
function semAcento(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\x20-\x7E]/g, '?');
}

/**
 * Estampa a grade de marcas e o rodape em todas as paginas.
 *
 * @param bytes   PDF de origem
 * @param empresa quem recebeu (vem do token de sessao)
 * @param email   quem abriu, no rodape. E o que permite rastrear um vazamento
 *                ate a pessoa, e nao so ate a empresa.
 */
export async function marcarPdf(
  bytes: ArrayBuffer,
  empresa: string,
  email: string,
): Promise<Uint8Array> {
  // ignoreEncryption: PDF protegido so para leitura ainda pode ser estampado.
  // Sem isso, um unico PDF com dono definido derrubaria o download.
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const fonte = await doc.embedFont(StandardFonts.Helvetica);
  const fonteNegrito = await doc.embedFont(StandardFonts.HelveticaBold);

  const alvo = semAcento(empresa || 'APSIS');
  const quem = semAcento(email || '');
  const data = new Date().toLocaleDateString('pt-BR');

  const COLUNAS = 3;
  const LINHAS = 4;

  for (const pagina of doc.getPages()) {
    const { width, height } = pagina.getSize();
    const larguraCelula = width / COLUNAS;
    const alturaCelula = height / LINHAS;

    for (let linha = 0; linha < LINHAS; linha++) {
      for (let coluna = 0; coluna < COLUNAS; coluna++) {
        const cx = larguraCelula * coluna + larguraCelula / 2;
        const cy = height - (alturaCelula * linha + alturaCelula / 2);

        const rotulo = 'Compartilhado com';
        const larguraRotulo = fonte.widthOfTextAtSize(rotulo, 6.5);
        pagina.drawText(rotulo, {
          x: cx - larguraRotulo / 2,
          y: cy + 4,
          size: 6.5,
          font: fonte,
          color: rgb(0.3, 0.3, 0.3),
          opacity: 0.18,
          rotate: degrees(-28),
        });

        const larguraNome = fonteNegrito.widthOfTextAtSize(alvo, 8);
        pagina.drawText(alvo, {
          x: cx - larguraNome / 2,
          y: cy - 6,
          size: 8,
          font: fonteNegrito,
          color: rgb(0.3, 0.3, 0.3),
          opacity: 0.18,
          rotate: degrees(-28),
        });
      }
    }

    const rodape = `APSIS Carbon | Compartilhado com ${alvo}${quem ? ` | ${quem}` : ''} | ${data}`;
    pagina.drawText(rodape, {
      x: 30,
      y: 10,
      size: 6,
      font: fonte,
      color: rgb(0.45, 0.45, 0.45),
      opacity: 0.65,
    });
    pagina.drawLine({
      start: { x: 30, y: 19 },
      end: { x: width - 30, y: 19 },
      thickness: 0.25,
      color: rgb(0.6, 0.6, 0.6),
      opacity: 0.35,
    });
  }

  return doc.save();
}

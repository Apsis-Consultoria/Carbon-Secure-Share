/**
 * Carregando - espera anunciável.
 *
 * O spinner sozinho é invisível para quem usa leitor de tela: o rótulo é
 * OBRIGATÓRIO e o bloco é uma região `role="status"` com `aria-live="polite"`, para
 * que "Carregando projetos" seja falado quando o bloco aparece. O ícone fica com
 * aria-hidden porque a informação já está no texto.
 */

import { Loader2 } from 'lucide-react';

const TAMANHOS = {
  sm: { icone: 13, classe: 'px-4 py-6 text-[11px] gap-2' },
  md: { icone: 16, classe: 'px-5 py-12 text-xs gap-2' },
  lg: { icone: 20, classe: 'px-5 py-16 text-sm gap-2.5' },
};

/**
 * @param {object} props
 * @param {string} props.rotulo o que está sendo carregado, ex.: 'Carregando projetos'
 * @param {'sm'|'md'|'lg'} [props.tamanho='md']
 * @param {boolean} [props.linha=false] versão em linha (inline-flex), para dentro de
 *        um botão ou ao lado de um título, sem ocupar o bloco inteiro
 * @param {string} [props.className]
 */
export default function Carregando({
  rotulo = 'Carregando',
  tamanho = 'md',
  linha = false,
  className = '',
}) {
  const t = TAMANHOS[tamanho] || TAMANHOS.md;
  if (linha) {
    return (
      <span role="status" aria-live="polite" className={`inline-flex items-center gap-1.5 text-[11px] text-[#8A9990] ${className}`}>
        <Loader2 size={12} className="animate-spin flex-shrink-0" aria-hidden="true" />
        {rotulo}
      </span>
    );
  }
  return (
    <div
      role="status"
      aria-live="polite"
      className={`flex items-center justify-center text-[#8A9990] ${t.classe} ${className}`}
    >
      <Loader2 size={t.icone} className="animate-spin flex-shrink-0" aria-hidden="true" />
      <span>{rotulo}</span>
    </div>
  );
}

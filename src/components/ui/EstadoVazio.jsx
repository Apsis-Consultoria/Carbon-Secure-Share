/**
 * EstadoVazio - "não há nada aqui ainda", com o próximo passo à mão.
 *
 * Extraído de ListaVazia (Projetos), PddVazio (PDD) e ModulosVazio (Boas-Vindas):
 * caixa de ícone cinza rounded-2xl, título forte, um parágrafo explicando POR QUE
 * vale a pena preencher, e a ação. O texto nunca é só "Nenhum registro": a tela vazia
 * é o momento em que a pessoa mais precisa entender para que serve aquilo.
 *
 * Não desenha a superfície branca de propósito - normalmente já vive dentro de um
 * Cartao (ou dentro do estado vazio da Tabela). Passe `comSuperficie` quando estiver
 * solto na página.
 */

import { Inbox } from 'lucide-react';
import { CLASSE_CARTAO } from './Cartao';

/**
 * @param {object} props
 * @param {React.ComponentType<{size?: number, className?: string}>} [props.icone=Inbox]
 * @param {string} props.titulo
 * @param {React.ReactNode} [props.texto]
 * @param {React.ReactNode} [props.acao] normalmente um BotaoPrimario
 * @param {boolean} [props.compacto=false] menos respiro vertical, para dentro de
 *        cartão pequeno ou de uma coluna estreita
 * @param {boolean} [props.comSuperficie=false] acrescenta fundo branco e borda
 * @param {string} [props.className]
 * @param {React.ReactNode} [props.children] conteúdo extra abaixo do texto
 */
export default function EstadoVazio({
  icone: Icone = Inbox,
  titulo,
  texto,
  acao,
  compacto = false,
  comSuperficie = false,
  className = '',
  children,
}) {
  return (
    <div
      className={`px-5 text-center ${compacto ? 'py-8' : 'py-14'} ${comSuperficie ? CLASSE_CARTAO : ''} ${className}`}
    >
      <div
        className={`bg-[#F4F6F4] rounded-2xl flex items-center justify-center mx-auto ${compacto ? 'w-11 h-11 mb-3' : 'w-14 h-14 mb-4'}`}
      >
        <Icone size={compacto ? 18 : 22} className="text-[#8A9990]" aria-hidden="true" />
      </div>
      {titulo && <p className="text-sm font-semibold text-[#1A2B1F]">{titulo}</p>}
      {texto && (
        <p className="text-xs text-[#5C7060] mt-1 max-w-md mx-auto leading-relaxed">{texto}</p>
      )}
      {children}
      {acao && <div className="flex items-center justify-center gap-2 mt-5">{acao}</div>}
    </div>
  );
}

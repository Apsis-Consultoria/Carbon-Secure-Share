/**
 * BotaoSecundario - ação de apoio: editar, cancelar, filtrar, voltar.
 *
 * Duas variantes, as duas já nas telas de referência:
 * - `contorno` (padrão): borda #DDE3DE que escurece para verde no hover. É o "Editar"
 *   do cartão de projeto.
 * - `fantasma`: sem borda nem fundo, só texto. É o "Cancelar" do rodapé do formulário,
 *   onde uma segunda borda ao lado do botão principal poluiria.
 *
 * A cor e o peso são deliberadamente mais fracos que os do BotaoPrimario: dois botões
 * com o mesmo peso na mesma linha fazem a pessoa parar para decidir qual é o caminho.
 */

import { BaseBotao } from './BotaoPrimario';

const VARIANTES = {
  contorno:
    'bg-white border border-[#DDE3DE] text-[#5C7060] hover:text-[#1A4731] hover:border-[#1A4731]/40 font-semibold',
  fantasma: 'text-[#5C7060] hover:text-[#1A4731] hover:bg-[#F4F6F4] font-semibold',
  perigo:
    'bg-white border border-[#F1C9C3] text-[#8F2A1E] hover:bg-[#FCEBE9] hover:border-[#C0392B]/40 font-semibold',
};

/**
 * @param {object} props todas as props de BaseBotao, menos `classeCor`
 * @param {'contorno'|'fantasma'|'perigo'} [props.variante='contorno']
 */
export default function BotaoSecundario({ variante = 'contorno', className = '', ...resto }) {
  return (
    <BaseBotao
      classeCor={VARIANTES[variante] || VARIANTES.contorno}
      className={className}
      {...resto}
    />
  );
}

/**
 * BarraProgresso - percentual de conclusão.
 *
 * Extraída da barra do PDD: trilha #E8EDE9, preenchimento laranja durante o caminho e
 * verde ao fechar 100%, com transição na largura.
 *
 * Duas regras que não são estéticas:
 *
 * 1. O valor é sempre normalizado para 0..100. Dado nulo, texto e número fora de faixa
 *    viram um número válido em vez de uma barra com largura "NaN%", que o navegador
 *    ignora deixando a barra vazia sem ninguém perceber que o dado estava quebrado.
 * 2. `role="progressbar"` com aria-valuenow e um rótulo acessível. Barra é informação:
 *    sem isso, quem usa leitor de tela não recebe o progresso de forma alguma, já que
 *    a largura em CSS não é anunciada.
 */

import { useId } from 'react';
import { corSolidaDoTom } from './Badge';

/** Percentual sempre entre 0 e 100, mesmo com dado nulo ou fora de faixa. */
export function pctSeguro(valor) {
  const n = Number(valor);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, n));
}

/**
 * @param {object} props
 * @param {number|string|null} props.valor 0 a 100
 * @param {React.ReactNode} [props.rotulo] texto à esquerda, acima da barra
 * @param {React.ReactNode} [props.detalhe] texto à direita, acima da barra,
 *        ex.: '12/34 concluídos'
 * @param {string} [props.rotuloAcessivel] usado quando não há `rotulo` visível
 * @param {boolean} [props.alta=false] trilha de 10px em vez de 6px
 * @param {boolean} [props.mostrarValor=false] acrescenta o "NN%" à direita
 * @param {'laranja'|'verde'|'azul'|'ambar'|'vermelho'|'neutro'} [props.tom='laranja']
 * @param {'verde'|null} [props.tomCompleto='verde'] tom ao atingir 100; `null` mantém
 *        o tom normal
 * @param {string} [props.className]
 */
export default function BarraProgresso({
  valor,
  rotulo,
  detalhe,
  rotuloAcessivel,
  alta = false,
  mostrarValor = false,
  tom = 'laranja',
  tomCompleto = 'verde',
  className = '',
}) {
  const pct = pctSeguro(valor);
  const completo = pct >= 100;
  const tomAtual = completo && tomCompleto ? tomCompleto : tom;
  const idRotulo = useId();
  const temRotuloVisivel = rotulo !== undefined && rotulo !== null && rotulo !== '';

  return (
    <div className={className}>
      {(temRotuloVisivel || detalhe || mostrarValor) && (
        <div className="flex items-center justify-between gap-3 mb-1.5">
          {temRotuloVisivel ? (
            <span id={idRotulo} className="text-[11px] font-semibold text-[#5C7060] min-w-0 truncate">
              {rotulo}
            </span>
          ) : (
            <span />
          )}
          {(detalhe || mostrarValor) && (
            <span className="text-[11px] font-semibold text-[#5C7060] whitespace-nowrap flex-shrink-0 tabular-nums">
              {detalhe}
              {detalhe && mostrarValor ? ' · ' : ''}
              {mostrarValor ? `${pct}%` : ''}
            </span>
          )}
        </div>
      )}

      <div
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuetext={`${pct}%`}
        aria-labelledby={temRotuloVisivel ? idRotulo : undefined}
        aria-label={temRotuloVisivel ? undefined : rotuloAcessivel || 'Progresso'}
        className={`w-full rounded-full bg-[#E8EDE9] overflow-hidden ${alta ? 'h-2.5' : 'h-1.5'}`}
      >
        <div
          className="h-full rounded-full transition-all duration-300"
          style={{ width: `${pct}%`, background: corSolidaDoTom(tomAtual) }}
        />
      </div>
    </div>
  );
}

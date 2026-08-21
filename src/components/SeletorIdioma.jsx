import { Languages } from 'lucide-react';
import { IDIOMAS, useIdioma } from '@/lib/i18n';

/**
 * Seletor de idioma. Dois botoes lado a lado, EN e PT, com o ativo preenchido.
 *
 * POR QUE DOIS BOTOES E NAO UM INTERRUPTOR: um toggle de dois estados obriga a
 * pessoa a descobrir para onde ele leva antes de clicar, e o rotulo de um
 * interruptor mostra ou o estado atual ou o destino - nunca os dois. Aqui os
 * dois idiomas ficam visiveis o tempo todo e o ativo e obvio, que e o pedido de
 * "um toggle bem claro na pagina".
 *
 * Fica na tela de login E no cabecalho de dentro: quem chega pelo e-mail cai no
 * login, e trocar o idioma so depois de entrar seria tarde.
 *
 * `variante`:
 *   'claro'  sobre o painel escuro do login (texto branco)
 *   'escuro' sobre o cabecalho verde de dentro
 *
 * Acessibilidade: os botoes formam um `radiogroup`, com `aria-checked` no ativo.
 * O rotulo de cada um diz o idioma por extenso ("Switch to Português"), porque
 * "PT" sozinho nao e pronunciavel por leitor de tela. O `lang` em cada botao faz
 * o leitor pronunciar o nome do idioma na lingua certa.
 */
export default function SeletorIdioma({ variante = 'escuro', className = '' }) {
  const { idioma, setIdioma, t } = useIdioma();

  const claro = variante === 'claro';

  const base =
    'px-2 py-0.5 rounded-md text-[11px] font-semibold transition focus:outline-none ' +
    'focus-visible:ring-2 focus-visible:ring-[#F48126]/60';

  const ativo = claro ? 'bg-white/90 text-[#1A4731]' : 'bg-white text-[#1A4731]';
  const inativo = claro
    ? 'text-white/60 hover:text-white'
    : 'text-white/70 hover:text-white';

  return (
    <div
      role="radiogroup"
      aria-label={t('idioma.rotulo')}
      className={`inline-flex items-center gap-1 rounded-lg border px-1 py-0.5 ${
        claro ? 'border-white/20 bg-white/10' : 'border-white/25'
      } ${className}`}
    >
      <Languages
        size={12}
        className={claro ? 'text-white/50 ml-0.5' : 'text-white/60 ml-0.5'}
        aria-hidden="true"
      />
      {IDIOMAS.map((item) => {
        const selecionado = item.codigo === idioma;
        return (
          <button
            key={item.codigo}
            type="button"
            role="radio"
            aria-checked={selecionado}
            lang={item.codigo === 'pt' ? 'pt-BR' : 'en'}
            title={t('idioma.trocarPara', { nome: item.nome })}
            aria-label={t('idioma.trocarPara', { nome: item.nome })}
            onClick={() => setIdioma(item.codigo)}
            className={`${base} ${selecionado ? ativo : inativo}`}
          >
            {item.rotulo}
          </button>
        );
      })}
    </div>
  );
}

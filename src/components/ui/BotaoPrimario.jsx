/**
 * BotaoPrimario - a ação principal do bloco. Um por bloco.
 *
 * Laranja #F47920 é o padrão (criar, salvar, gerar), verde #1A4731 é a ação de
 * navegação forte que já existe em Projetos ("PDD ->"). O raio segue as telas de
 * referência: rounded-xl no tamanho md e rounded-lg no sm (que é o botão-chip
 * pequeno, do tipo "Carregar arquivo").
 *
 * BaseBotao é exportado aqui e reaproveitado pelo BotaoSecundario: o que muda entre
 * os dois é só a classe de cor, e duplicar a lógica de <button> vs <Link> vs <a>
 * garantiria que um dos dois esquecesse o `rel="noopener"` ou o `aria-busy`.
 */

import { Link } from 'react-router-dom';
import { Loader2 } from 'lucide-react';

const TAMANHOS = {
  sm: { classe: 'px-3 py-1.5 text-[11px] rounded-lg gap-1.5', icone: 12 },
  md: { classe: 'px-4 py-2 text-xs rounded-xl gap-2', icone: 14 },
  lg: { classe: 'px-5 py-2.5 text-sm rounded-xl gap-2', icone: 16 },
};

/**
 * Invólucro polimórfico. Não use direto na tela: use BotaoPrimario ou BotaoSecundario.
 *
 * @param {object} props
 * @param {string} props.classeCor classes de cor, borda e hover
 * @param {'button'|'link'|'externo'} [props.como='button']
 * @param {'button'|'submit'|'reset'} [props.tipo='button'] só vale para como='button'
 * @param {string} [props.para] destino interno quando como='link' (react-router)
 * @param {string} [props.href] destino quando como='externo' (abre em outra aba)
 */
export function BaseBotao({
  classeCor,
  como = 'button',
  tipo = 'button',
  para,
  href,
  onClick,
  desabilitado = false,
  carregando = false,
  icone: Icone,
  iconeDireita: IconeDireita,
  tamanho = 'md',
  larguraTotal = false,
  rotuloAcessivel,
  titulo,
  className = '',
  children,
}) {
  const t = TAMANHOS[tamanho] || TAMANHOS.md;
  const bloqueado = desabilitado || carregando;
  /* O PESO DA FONTE NÃO ENTRA AQUI de propósito: quem define é a classe de cor de cada
     variante (font-bold no primário, font-semibold no secundário). Se a base trouxesse
     font-bold, acrescentar font-semibold depois não resolveria - entre duas utilitárias
     de mesma especificidade vence a que o Tailwind emite por último na folha, e
     font-bold é emitida depois de font-semibold. O bug seria silencioso. */
  const base = `inline-flex items-center justify-center whitespace-nowrap transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1A4731]/30 focus-visible:ring-offset-1 ${t.classe} ${larguraTotal ? 'w-full' : ''}`;
  const classeBloqueio = bloqueado ? 'opacity-60 cursor-not-allowed' : '';

  const conteudo = (
    <>
      {carregando ? (
        <Loader2 size={t.icone} className="animate-spin flex-shrink-0" aria-hidden="true" />
      ) : (
        Icone && <Icone size={t.icone} className="flex-shrink-0" aria-hidden="true" />
      )}
      {children}
      {IconeDireita && !carregando && (
        <IconeDireita size={t.icone - 2} className="flex-shrink-0" aria-hidden="true" />
      )}
    </>
  );

  const comuns = {
    'aria-label': rotuloAcessivel || undefined,
    'aria-busy': carregando || undefined,
    title: titulo || undefined,
    className: `${base} ${classeCor} ${classeBloqueio} ${className}`,
  };

  if (como === 'link' || como === 'externo') {
    // Link e <a> não aceitam `disabled`: sem pointer-events-none o clique ainda
    // navegaria, e o aria-disabled sozinho só informaria o leitor de tela.
    const bloqueioLink = bloqueado ? 'pointer-events-none' : '';
    const props = {
      ...comuns,
      'aria-disabled': bloqueado || undefined,
      tabIndex: bloqueado ? -1 : undefined,
      className: `${comuns.className} ${bloqueioLink}`,
    };
    if (como === 'externo') {
      return (
        <a {...props} href={href} target="_blank" rel="noopener noreferrer">
          {conteudo}
        </a>
      );
    }
    return (
      <Link {...props} to={para || '#'}>
        {conteudo}
      </Link>
    );
  }

  return (
    <button {...comuns} type={tipo} onClick={onClick} disabled={bloqueado}>
      {conteudo}
    </button>
  );
}

const CORES = {
  laranja: 'font-bold bg-[#F47920] text-white hover:bg-[#e06810]',
  verde: 'font-bold bg-[#1A4731] text-white hover:bg-[#245E40]',
  vermelho: 'font-bold bg-[#C0392B] text-white hover:bg-[#a52f23]',
};

/**
 * @param {object} props todas as props de BaseBotao, menos `classeCor`
 * @param {'laranja'|'verde'|'vermelho'} [props.tom='laranja']
 */
export default function BotaoPrimario({ tom = 'laranja', ...resto }) {
  return <BaseBotao classeCor={CORES[tom] || CORES.laranja} {...resto} />;
}

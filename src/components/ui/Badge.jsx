/**
 * Badge - selo de estado, curto e sem interação.
 *
 * ESTE ARQUIVO É A FONTE DE VERDADE DOS TONS da interface. SeletorStatus,
 * AvisoDiscreto e BarraProgresso importam as tabelas daqui de propósito: um mesmo
 * "ambar" tem de ser o mesmo amarelo no selo, no seletor e na barra, e três cópias
 * do mapa divergiriam na primeira mudança.
 *
 * Os tons NÃO usam as cores cruas do Tailwind (amber-50, sky-700 e afins). As telas
 * de referência começaram assim e o resultado é um azul de badge que não conversa
 * com o verde #1A4731 da marca. Aqui cada tom é um hex escolhido para conviver com a
 * paleta APSIS, mantendo contraste de texto sobre o fundo claro correspondente.
 */

/** Nomes de tom aceitos por todas as primitivas. Ordem: neutro primeiro. */
export const TONS = ['neutro', 'verde', 'ambar', 'vermelho', 'azul', 'laranja'];

/**
 * Paleta por tom.
 *
 * - `pilula`: fundo + texto + borda do selo (superfície clara).
 * - `solido`: hex para preenchimento cheio (barra de progresso, pontos, marcadores).
 * - `icone`: hex para ícone sobre a superfície clara.
 */
const PALETA = {
  neutro:   { pilula: 'bg-[#F1F4F1] text-[#5C7060] border-[#DDE3DE]', solido: '#8A9990', icone: '#5C7060' },
  verde:    { pilula: 'bg-[#E8F1EA] text-[#1A4731] border-[#BFD8C6]', solido: '#2F8F5B', icone: '#1A4731' },
  ambar:    { pilula: 'bg-[#FDF3E3] text-[#8A5A12] border-[#F2DDB4]', solido: '#D98A15', icone: '#8A5A12' },
  vermelho: { pilula: 'bg-[#FCEBE9] text-[#8F2A1E] border-[#F1C9C3]', solido: '#C0392B', icone: '#8F2A1E' },
  azul:     { pilula: 'bg-[#E9F0F7] text-[#1F4A6B] border-[#C6D9E8]', solido: '#2F6D96', icone: '#1F4A6B' },
  laranja:  { pilula: 'bg-[#FDEEE1] text-[#A34F0C] border-[#F7D3B4]', solido: '#F47920', icone: '#A34F0C' },
};

/** Tom desconhecido cai em neutro em vez de renderizar sem classe de cor. */
function tomValido(tom) {
  return PALETA[tom] ? tom : 'neutro';
}

/** Classes da superfície clara (fundo, texto e borda) de um tom. */
export function classesDoTom(tom) {
  return PALETA[tomValido(tom)].pilula;
}

/** Hex de preenchimento cheio de um tom. Usado onde não cabe classe do Tailwind. */
export function corSolidaDoTom(tom) {
  return PALETA[tomValido(tom)].solido;
}

/** Hex de ícone sobre superfície clara de um tom. */
export function corIconeDoTom(tom) {
  return PALETA[tomValido(tom)].icone;
}

const TAMANHOS = {
  sm: 'px-2 py-0.5 text-[10px] gap-1',
  md: 'px-2.5 py-1 text-[11px] gap-1.5',
};

/**
 * @param {object} props
 * @param {'neutro'|'verde'|'ambar'|'vermelho'|'azul'|'laranja'} [props.tom='neutro']
 * @param {'sm'|'md'} [props.tamanho='md']
 * @param {React.ComponentType<{size?: number, className?: string}>} [props.icone] ícone do lucide
 * @param {string} [props.rotuloAcessivel] obrigatório quando o selo só tem ícone
 * @param {string} [props.className]
 * @param {React.ReactNode} props.children
 */
export default function Badge({
  tom = 'neutro',
  tamanho = 'md',
  icone: Icone,
  rotuloAcessivel,
  className = '',
  children,
}) {
  const classeTamanho = TAMANHOS[tamanho] || TAMANHOS.md;
  return (
    <span
      // `aria-label` só entra quando informado: em selo com texto ele SUBSTITUIRIA o
      // texto para o leitor de tela, o que é pior do que não ter rótulo nenhum.
      aria-label={rotuloAcessivel || undefined}
      className={`inline-flex items-center rounded-full border font-semibold whitespace-nowrap ${classeTamanho} ${classesDoTom(tom)} ${className}`}
    >
      {Icone && <Icone size={tamanho === 'sm' ? 10 : 12} className="flex-shrink-0" aria-hidden="true" />}
      {children}
    </span>
  );
}

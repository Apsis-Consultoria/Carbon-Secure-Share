/**
 * Cartao - a superfície branca padrão do Apsis Carbon.
 *
 * Todo bloco de conteúdo das telas vive dentro de um destes: fundo branco, borda
 * #DDE3DE, canto rounded-2xl e sombra discreta. O cabeçalho com caixa de ícone,
 * título e ação à direita repete em Projetos, PDD e Boas-Vindas, então virou prop
 * em vez de ser remontado em cada tela.
 *
 * A classe crua é exportada (CLASSE_CARTAO) porque alguns blocos precisam da mesma
 * superfície sem a estrutura de cabeçalho e corpo (por exemplo o invólucro de um
 * <form>, que tem de ser o próprio elemento de formulário).
 */

export const CLASSE_CARTAO = 'bg-white border border-[#DDE3DE] rounded-2xl shadow-sm';

/** Caixa de ícone do cabeçalho. Verde para conteúdo, laranja para ação e aviso. */
const TONS_ICONE = {
  verde: 'bg-[#1A4731]/10 text-[#1A4731]',
  laranja: 'bg-[#F47920]/10 text-[#F47920]',
  neutro: 'bg-[#F4F6F4] text-[#8A9990]',
};

/**
 * @param {object} props
 * @param {string} [props.titulo]
 * @param {React.ReactNode} [props.subtitulo] texto de apoio sob o título
 * @param {React.ComponentType<{size?: number, className?: string}>} [props.icone] ícone do lucide
 * @param {'verde'|'laranja'|'neutro'} [props.tomIcone='verde']
 * @param {React.ReactNode} [props.acao] botão ou link no canto direito do cabeçalho
 * @param {2|3} [props.nivelTitulo=2] nível do heading; nenhuma tela renderiza h1
 *        própria (o h1 é o título da topbar do Layout)
 * @param {boolean} [props.semPaddingCorpo=false] corpo encostado nas bordas, para
 *        lista com divisórias ou tabela
 * @param {React.ReactNode} [props.rodape]
 * @param {string} [props.className] classes no invólucro
 * @param {string} [props.classeCorpo] classes extras no corpo
 * @param {React.ReactNode} props.children
 */
export default function Cartao({
  titulo,
  subtitulo,
  icone: Icone,
  tomIcone = 'verde',
  acao,
  nivelTitulo = 2,
  semPaddingCorpo = false,
  rodape,
  className = '',
  classeCorpo = '',
  children,
}) {
  const temCabecalho = Boolean(titulo || Icone || acao);
  const Titulo = nivelTitulo === 3 ? 'h3' : 'h2';
  const classeIcone = TONS_ICONE[tomIcone] || TONS_ICONE.verde;

  return (
    // overflow-hidden garante que a divisória do cabeçalho e a primeira linha de uma
    // lista respeitem o canto arredondado.
    <div className={`${CLASSE_CARTAO} overflow-hidden ${className}`}>
      {temCabecalho && (
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-[#F4F6F4]">
          <div className="flex items-center gap-3 min-w-0">
            {Icone && (
              <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${classeIcone}`}>
                <Icone size={17} aria-hidden="true" />
              </div>
            )}
            <div className="min-w-0">
              {titulo && (
                <Titulo className="text-sm font-bold text-[#1A2B1F] break-words">{titulo}</Titulo>
              )}
              {subtitulo && <p className="text-xs text-[#5C7060] mt-0.5">{subtitulo}</p>}
            </div>
          </div>
          {acao && <div className="flex items-center gap-2 flex-shrink-0">{acao}</div>}
        </div>
      )}

      <div className={`${semPaddingCorpo ? '' : 'px-5 py-4'} ${classeCorpo}`}>{children}</div>

      {rodape && (
        <div className="px-5 py-4 border-t border-[#F4F6F4] bg-[#F4F6F4]/40">{rodape}</div>
      )}
    </div>
  );
}

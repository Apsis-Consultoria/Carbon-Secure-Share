/**
 * Campo - rótulo, controle, dica e erro, amarrados corretamente.
 *
 * Substitui o `Campo` local de Projetos.jsx, que envolvia o input num <label> sem id.
 * Aqui o vínculo é explícito por `htmlFor`/`id`, e isso resolve três coisas de uma vez:
 *
 * - clicar no rótulo foca o controle certo mesmo com o controle dentro de outra caixa;
 * - o leitor de tela anuncia rótulo, dica e mensagem de erro juntos, via aria-describedby;
 * - deixa de existir o caso de <label> dentro de <label> (que é HTML inválido e fazia o
 *   botão de carregar arquivo abrir o seletor e focar o textarea ao mesmo tempo).
 *
 * O erro tem `role="alert"`: aparece depois da tentativa de salvar, e sem isso quem não
 * vê a tela só percebe que algo deu errado quando o foco chega no campo.
 *
 * onChange RECEBE O VALOR, não o evento: `onChange={(v) => setForm({...form, nome: v})}`.
 * Em checkbox o valor é booleano. O evento original vem no segundo argumento, para os
 * casos raros que precisam dele.
 */

import { useId } from 'react';

/* A cor da borda fica FORA da classe base e é escolhida por estado (normal ou erro).
   Empilhar 'border-[#C0392B]' depois de 'border-[#DDE3DE]' na mesma string não é
   confiável: são duas utilitárias de mesma especificidade, e quem vence é a que o
   Tailwind emitir por último na folha, não a que aparece por último no atributo. */
/* O tamanho da fonte também fica fora, pelo mesmo motivo: 'text-[11px]' do modo
   monoespaçado não pode depender de vencer o 'text-sm' da base. */
const CLASSE_CAMPO_BASE =
  'w-full px-3 py-2 bg-white border rounded-xl text-[#1A2B1F] placeholder:text-[#A8B4AC] focus:outline-none focus:ring-2 disabled:bg-[#F4F6F4] disabled:text-[#8A9990] disabled:cursor-not-allowed transition-colors';

const BORDA_NORMAL = 'border-[#DDE3DE] focus:border-[#1A4731] focus:ring-[#1A4731]/10';
const BORDA_ERRO = 'border-[#C0392B] focus:border-[#C0392B] focus:ring-[#C0392B]/10';

/** Classe do controle no estado normal. Exportada para telas que montam um controle
 *  próprio (um combobox, um campo de arquivo) e precisam do mesmo visual. */
export const CLASSE_CAMPO = `${CLASSE_CAMPO_BASE} text-sm ${BORDA_NORMAL}`;

/** Tipos com controle próprio. Qualquer outro valor de `tipo` vira o type nativo do
 *  <input> (email, hora, mes, url e afins funcionam sem mudança aqui). */
const TIPOS_NATIVOS = { texto: 'text', numero: 'number', data: 'date' };

/**
 * @param {object} props
 * @param {string} props.rotulo
 * @param {'texto'|'numero'|'decimal'|'data'|'select'|'textarea'|'checkbox'|string} [props.tipo='texto']
 * @param {string|number|boolean|null} [props.valor]
 * @param {(valor: any, evento: Event) => void} [props.onChange] recebe o VALOR
 * @param {boolean} [props.obrigatorio=false] marca o rótulo com * e exige no submit
 * @param {string} [props.erro] mensagem de erro; presença deixa o campo aria-invalid
 * @param {React.ReactNode} [props.dica] texto de apoio sob o controle
 * @param {string} [props.placeholder]
 * @param {boolean} [props.desabilitado=false]
 * @param {boolean} [props.somenteLeitura=false]
 * @param {{valor: string, rotulo: string}[]|string[]} [props.opcoes] para tipo select
 * @param {string} [props.rotuloVazio] primeira opção do select ('Selecione...'); ausente
 *        significa que o select não oferece opção vazia
 * @param {number} [props.linhas=4] rows do textarea
 * @param {boolean} [props.monoespacado=false] fonte mono e menor, para JSON e código
 * @param {string} [props.id] gerado automaticamente quando ausente
 * @param {string} [props.nome] atributo name
 * @param {string} [props.className] classes no invólucro (use para col-span da grade)
 * @param {string} [props.classeControle] classes extras no controle
 * @param {React.ReactNode} [props.acao] bloco abaixo do controle (botão de upload etc.)
 * @param {React.ReactNode|((infos: {id: string, classeCampo: string, descritoPor: string|undefined, invalido: boolean}) => React.ReactNode)} [props.children]
 *        controle customizado; como função, recebe o id e as classes já prontas
 * @param {object} [props.extras] props extras repassadas ao controle nativo
 *        (maxLength, min, max, step, inputMode, autoComplete, spellCheck...)
 */
export default function Campo({
  rotulo,
  tipo = 'texto',
  valor,
  onChange,
  obrigatorio = false,
  erro,
  dica,
  placeholder,
  desabilitado = false,
  somenteLeitura = false,
  opcoes = [],
  rotuloVazio,
  linhas = 4,
  monoespacado = false,
  id,
  nome,
  className = '',
  classeControle = '',
  acao,
  children,
  extras = {},
}) {
  const idGerado = useId();
  const idCampo = id || `campo-${idGerado}`;
  const idDica = `${idCampo}-dica`;
  const idErro = `${idCampo}-erro`;

  const invalido = Boolean(erro);
  const descritoPor = [dica ? idDica : null, erro ? idErro : null].filter(Boolean).join(' ') || undefined;

  const classeCampo = `${CLASSE_CAMPO_BASE} ${invalido ? BORDA_ERRO : BORDA_NORMAL} ${monoespacado ? 'font-mono text-[11px] leading-relaxed' : 'text-sm'} ${classeControle}`;

  const comuns = {
    id: idCampo,
    name: nome,
    disabled: desabilitado,
    required: obrigatorio,
    'aria-invalid': invalido || undefined,
    'aria-describedby': descritoPor,
    ...extras,
  };

  /* `readOnly` só existe em input e textarea. Em <select> o React o repassaria como
     atributo desconhecido (aviso no console) sem impedir a troca de opção; o jeito
     correto de travar um select é `desabilitado`. */
  const soLeitura = somenteLeitura ? { readOnly: true } : null;

  const emitir = (evento, valorNovo) => onChange?.(valorNovo, evento);

  const Rotulo = (
    <label htmlFor={idCampo} className="text-[11px] font-semibold uppercase tracking-wider text-[#5C7060]">
      {rotulo}
      {/* O asterisco fica com aria-hidden e a obrigatoriedade é dita pelo `required`,
          que o leitor de tela já anuncia: senão a pessoa ouviria "asterisco" solto. */}
      {obrigatorio && (
        <span className="text-[#C0392B] ml-0.5" aria-hidden="true">
          *
        </span>
      )}
    </label>
  );

  const Apoio = (
    <>
      {dica && (
        <span id={idDica} className="text-[11px] text-[#8A9990] leading-relaxed">
          {dica}
        </span>
      )}
      {erro && (
        <span id={idErro} role="alert" className="text-[11px] font-semibold text-[#8F2A1E] leading-relaxed">
          {erro}
        </span>
      )}
    </>
  );

  /* ===== Checkbox: o rótulo fica À DIREITA do controle, não acima ===== */
  if (tipo === 'checkbox') {
    return (
      <div className={`flex flex-col gap-1.5 ${className}`}>
        <div className="flex items-start gap-2.5">
          <input
            {...comuns}
            type="checkbox"
            checked={Boolean(valor)}
            onChange={(evento) => emitir(evento, evento.target.checked)}
            className={`mt-0.5 w-4 h-4 rounded border-[#DDE3DE] text-[#1A4731] accent-[#1A4731] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1A4731]/30 disabled:cursor-not-allowed ${classeControle}`}
          />
          <label htmlFor={idCampo} className="text-xs text-[#1A2B1F] leading-relaxed cursor-pointer">
            {rotulo}
            {obrigatorio && (
              <span className="text-[#C0392B] ml-0.5" aria-hidden="true">
                *
              </span>
            )}
          </label>
        </div>
        <div className="flex flex-col gap-1 pl-6">{Apoio}</div>
        {acao}
      </div>
    );
  }

  /* ===== Controle ===== */
  let Controle = null;

  if (typeof children === 'function') {
    Controle = children({ id: idCampo, classeCampo, descritoPor, invalido });
  } else if (children) {
    Controle = children;
  } else if (tipo === 'select') {
    const lista = opcoes.map((o) => (typeof o === 'string' ? { valor: o, rotulo: o } : o));
    Controle = (
      <select
        {...comuns}
        value={valor ?? ''}
        onChange={(evento) => emitir(evento, evento.target.value)}
        className={classeCampo}
      >
        {rotuloVazio !== undefined && <option value="">{rotuloVazio}</option>}
        {lista.map((o) => (
          <option key={o.valor} value={o.valor}>
            {o.rotulo}
          </option>
        ))}
      </select>
    );
  } else if (tipo === 'textarea') {
    Controle = (
      <textarea
        {...comuns}
        {...soLeitura}
        rows={linhas}
        value={valor ?? ''}
        placeholder={placeholder}
        onChange={(evento) => emitir(evento, evento.target.value)}
        className={`${classeCampo} resize-y`}
      />
    );
  } else if (tipo === 'decimal') {
    /* Número em pt-BR: type="text" com inputMode decimal, e NÃO type="number".
       O campo aceita vírgula (é o separador do teclado brasileiro) e a conversão fica
       com a tela, que sabe recusar ponto de milhar ambíguo - o mesmo cuidado do campo
       de área em Projetos, onde ler "13.250" como 13,25 falsearia a checagem de 5%. */
    Controle = (
      <input
        {...comuns}
        {...soLeitura}
        type="text"
        inputMode={extras.inputMode || 'decimal'}
        value={valor ?? ''}
        placeholder={placeholder}
        onChange={(evento) => emitir(evento, evento.target.value)}
        className={classeCampo}
      />
    );
  } else {
    const tipoHtml = TIPOS_NATIVOS[tipo] || tipo;
    Controle = (
      <input
        {...comuns}
        {...soLeitura}
        type={tipoHtml}
        value={valor ?? ''}
        placeholder={placeholder}
        onChange={(evento) =>
          emitir(
            evento,
            // type="number" devolve string: o vazio precisa continuar vazio (e não virar
            // 0) para "campo não preenchido" ser distinguível de "zero".
            tipoHtml === 'number' && evento.target.value === '' ? '' : evento.target.value,
          )
        }
        className={classeCampo}
      />
    );
  }

  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      {Rotulo}
      {Controle}
      {Apoio}
      {acao}
    </div>
  );
}

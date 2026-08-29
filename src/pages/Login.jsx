import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Info, KeyRound, LogIn, Mail, Send, TriangleAlert } from 'lucide-react';

import CarbonLoginLayout from '@/components/CarbonLoginLayout';
import SeletorIdioma from '@/components/SeletorIdioma';
import {
  DIGITOS_CODIGO,
  MINUTOS_CODIGO_PADRAO,
  SEGUNDOS_REENVIO_PADRAO,
  desligarDemoAntesDoLogin,
  entrarComCodigo,
  pedirCodigo,
} from '@/lib/api';
import { MODO_DEMO } from '@/lib/demo';
import { gravarSessao } from '@/lib/sessao';
import { useIdioma, textoDoErro } from '@/lib/i18n';

// Mesma pilha de fontes do CarbonLoginLayout: Sora para titulo, no padrao dos
// reports da APSIS.
const SORA = "'Sora', 'Segoe UI', sans-serif";

/**
 * Formato do e-mail, so para pegar erro de digitacao antes de gastar uma
 * requisicao. Nao e validacao de verdade - quem decide e o servidor, e a
 * resposta dele e a mesma para endereco com e sem cadastro.
 */
const FORMATO_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Login do CLIENTE, em duas etapas: e-mail, depois o codigo que chega por e-mail.
 *
 * NAO HA SENHA. Quem tem acesso e quem a APSIS alocou a um projeto no Portal
 * Carbon, e a prova de identidade e a posse da caixa de e-mail cadastrada.
 *
 * ------------------------------------------------------------------------
 * UMA ROTA, DOIS ESTADOS - e nao duas rotas
 * ------------------------------------------------------------------------
 * Tres motivos, todos verificaveis no codigo:
 *   1. App.jsx manda toda rota profunda para `/` enquanto nao ha sessao, entao
 *      uma segunda rota so existiria para ser redirecionada;
 *   2. o e-mail teria de viajar entre as rotas, e na URL ele viraria dado
 *      pessoal no historico do navegador e no log da hospedagem;
 *   3. CarbonLoginLayout guarda o indice do slideshow em estado proprio
 *      (useState no proprio componente). Trocar de rota o remontaria e a foto de
 *      fundo daria um salto no meio do login.
 *
 * ------------------------------------------------------------------------
 * O QUE A TELA NAO PODE REVELAR
 * ------------------------------------------------------------------------
 * Se um endereco tem cadastro. Confirmar isso ja diria que aquela pessoa e
 * cliente da APSIS num projeto de carbono, o que e informacao sobre o cliente e
 * sobre o negocio. Por isso:
 *   - o servidor responde 200 igual em todos os caminhos, inclusive quando o
 *     envio falha;
 *   - a TELA AVANCA para a etapa do codigo em toda resposta do fluxo, inclusive
 *     nos dois 429 de freio. So ficam na etapa 1 o e-mail malformado e as falhas
 *     que nao sao resposta do fluxo (rede, timeout, rewrite ausente);
 *   - o texto da etapa 2 enuncia a regra ("todo endereco cadastrado recebe um
 *     codigo"), que e verdadeira para os dois casos, em vez de afirmar um envio
 *     que pode nao ter acontecido.
 *
 * O SELETOR DE IDIOMA FICA AQUI, e nao so depois de entrar: a interface nasce em
 * ingles, e quem prefere portugues precisa poder trocar ANTES de ler o
 * formulario, nao depois.
 */
export default function Login({ aoEntrar }) {
  const { t } = useIdioma();

  const [passo, setPasso] = useState('email');
  const [email, setEmail] = useState('');
  /**
   * O endereco como foi DIGITADO (so com as pontas aparadas), para ecoar na
   * etapa 2. Sem mascara e sem minusculas: e a digitacao da pessoa voltando para
   * a tela, e resolve a causa numero um de "nao recebi" - o erro de digitacao.
   * Ao servidor vai a versao normalizada; ao olho volta o que ele escreveu.
   */
  const [emailEcoado, setEmailEcoado] = useState('');
  const [codigo, setCodigo] = useState('');
  const [minutos, setMinutos] = useState(MINUTOS_CODIGO_PADRAO);
  /** { tom: 'erro' | 'aviso', texto } - uma mensagem por vez. */
  const [mensagem, setMensagem] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const [alvoReenvio, setAlvoReenvio] = useState(0);
  const [restante, setRestante] = useState(0);
  const [limiteDiario, setLimiteDiario] = useState(false);

  const refEmail = useRef(null);
  const refCodigo = useRef(null);
  const primeiroRender = useRef(true);

  /**
   * O trinco da demonstracao e estado de MODULO em src/lib/api.js: ele sobrevive
   * a sair e voltar para o login dentro da mesma aba. Desligar ao montar impede
   * que uma tentativa de login de verdade, depois de uma demonstracao, caia no
   * dataset ficticio em silencio. Em producao a funcao nao existe: MODO_DEMO e
   * false e o Rollup remove o bloco.
   */
  useEffect(() => {
    if (MODO_DEMO) desligarDemoAntesDoLogin();
  }, []);

  /**
   * Foco na troca de etapa, e SO na troca: o campo de codigo recebe o foco quando
   * a etapa 2 aparece, e o de e-mail quando se volta. No primeiro render nao
   * mexemos - roubar o foco no carregamento faz o leitor de tela pular o titulo
   * da pagina, e ninguem pediu para pular.
   */
  useEffect(() => {
    if (primeiroRender.current) {
      primeiroRender.current = false;
      return;
    }
    const alvo = passo === 'codigo' ? refCodigo : refEmail;
    alvo.current?.focus();
  }, [passo]);

  /**
   * Contador regressivo do reenvio, contra um ALVO no relogio e nao decrementando
   * uma variavel: o navegador estrangula setInterval em aba de segundo plano, e
   * um contador que "conta ticks" ficaria parado nos 40 segundos enquanto a
   * pessoa esta na caixa de e-mail dela lendo o codigo - que e exatamente o que
   * ela vai fazer.
   */
  useEffect(() => {
    if (!alvoReenvio) {
      setRestante(0);
      return undefined;
    }
    const calcular = () => Math.max(0, Math.ceil((alvoReenvio - Date.now()) / 1000));
    setRestante(calcular());
    const timer = setInterval(() => {
      const segundos = calcular();
      setRestante(segundos);
      if (segundos === 0) clearInterval(timer);
    }, 1000);
    return () => clearInterval(timer);
  }, [alvoReenvio]);

  function voltarParaEmail() {
    setPasso('email');
    setCodigo('');
    setMensagem(null);
    setAlvoReenvio(0);
    setLimiteDiario(false);
  }

  /** Etapa 1, e tambem o reenvio da etapa 2 - e a mesma requisicao. */
  async function pedir({ reenvio }) {
    if (enviando) return;

    const digitado = email.trim();
    if (!digitado) {
      setMensagem({ tom: 'erro', texto: t('login.emailObrigatorio') });
      return;
    }
    if (!FORMATO_EMAIL.test(digitado)) {
      setMensagem({ tom: 'erro', texto: t('erro.email_invalido') });
      return;
    }

    setEnviando(true);
    setMensagem(null);

    try {
      const resposta = await pedirCodigo(digitado.toLowerCase());

      setEmailEcoado(digitado);
      setMinutos(resposta.minutos);

      if (resposta.freio === 'teto_diario') {
        setLimiteDiario(true);
        setAlvoReenvio(0);
        setMensagem({ tom: 'aviso', texto: t('erro.teto_diario') });
      } else {
        const segundos = resposta.espere ?? SEGUNDOS_REENVIO_PADRAO;
        setAlvoReenvio(Date.now() + segundos * 1000);
        if (resposta.freio === 'espere') {
          setMensagem({ tom: 'aviso', texto: t('erro.espere', { n: segundos }) });
        } else if (reenvio) {
          setMensagem({ tom: 'aviso', texto: t('login.codigoReenviado', { email: digitado }) });
        }
      }

      // Depois de qualquer resposta do fluxo, inclusive freio. Ver o cabecalho.
      setPasso('codigo');
    } catch (e) {
      setMensagem({ tom: 'erro', texto: textoDoErro(t, e) });
    } finally {
      setEnviando(false);
    }
  }

  /** Etapa 2. */
  async function entrar() {
    if (enviando) return;

    if (codigo.length !== DIGITOS_CODIGO) {
      setMensagem({ tom: 'erro', texto: t('login.codigoObrigatorio', { n: DIGITOS_CODIGO }) });
      return;
    }

    setEnviando(true);
    setMensagem(null);

    const alvo = emailEcoado.toLowerCase();
    try {
      const dados = await entrarComCodigo(alvo, codigo);
      const sessao = {
        token: dados.token,
        projetos: dados.projetos ?? [],
        nome: dados.nome ?? '',
        email: alvo,
        // Em producao nunca e true: quem liga e o fluxo de demonstracao, que so
        // existe em desenvolvimento.
        demo: dados.demo === true,
      };
      gravarSessao(sessao);
      // O codigo sai da memoria assim que deixa de ser necessario. Nao impede um
      // despejo de memoria determinado, mas nao ha razao para mante-lo no estado
      // do React depois de usado - ele ainda vale por ate 10 minutos.
      setCodigo('');
      aoEntrar(sessao);
    } catch (e) {
      setMensagem({ tom: 'erro', texto: textoDoErro(t, e) });
      setEnviando(false);
    }
  }

  const campo =
    'w-full rounded-xl border border-white/20 bg-white/10 pl-10 pr-3 py-3 text-sm text-white ' +
    'placeholder:text-white/45 focus:outline-none focus:border-[#F48126] focus:ring-2 ' +
    'focus:ring-[#F48126]/25 transition disabled:opacity-60';

  const botaoPrincipal =
    'w-full flex items-center justify-center gap-2 rounded-xl bg-[#F48126] px-4 py-3 ' +
    'text-sm font-semibold text-white transition hover:bg-[#e06810] ' +
    'disabled:opacity-60 disabled:cursor-not-allowed';

  const noCodigo = passo === 'codigo';
  const contando = restante > 0 && !limiteDiario;
  const podeReenviar = !enviando && !limiteDiario && restante === 0;

  return (
    <CarbonLoginLayout
      cantoSuperior={<SeletorIdioma variante="claro" />}
      headline={t('login.headline')}
      subheadline={t('login.subheadline')}
      categories={[
        t('login.categoria.projetos'),
        t('login.categoria.contratos'),
        t('login.categoria.gee'),
        t('login.categoria.certificacao'),
        t('login.categoria.esg'),
      ]}
      copyright={t('login.copyright')}
    >
      <div className="w-full">
        {/*
          Titulo no MESMO padrao do login do secure_share: Sora, font-black,
          tracking-tight, text-3xl / lg:text-4xl, caixa alta, centralizado, em
          duas cores.

          A UNICA divergencia e a cor da primeira palavra. La ela e o verde
          #1A4731 sobre painel BRANCO; aqui o painel e verde, e o topo do
          gradiente e rgba(26,71,49,.95) - exatamente o mesmo #1A4731. A palavra
          sumiria no fundo. Trocamos por branco, que reproduz o par de cores do
          logo logo acima (APSIS laranja + CARBON branco) e mantem a leitura.

          O h1 NAO muda entre as etapas: ele e a identidade da pagina, e trocar o
          cabecalho de nivel 1 no meio do fluxo faria o leitor de tela anunciar
          uma pagina nova onde nao houve navegacao nenhuma.
        */}
        <h1
          className="text-3xl lg:text-4xl font-black tracking-tight text-center"
          style={{ fontFamily: SORA }}
        >
          <span className="text-white">SECURE</span>{' '}
          <span style={{ color: '#F48126' }}>SHARE</span>
        </h1>

        <p className="text-white/70 text-sm text-center mt-2 mb-6">
          {noCodigo ? t('login.codigoTitulo') : t('login.chamada')}
        </p>

        <form
          onSubmit={(evento) => {
            evento.preventDefault();
            if (noCodigo) entrar();
            else pedir({ reenvio: false });
          }}
          className="space-y-3"
          noValidate
        >
          {!noCodigo && (
            <>
              <div>
                <label htmlFor="ss-email" className="sr-only">
                  {t('login.email')}
                </label>
                <div className="relative">
                  <Mail
                    size={16}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-white/45"
                    aria-hidden="true"
                  />
                  <input
                    id="ss-email"
                    ref={refEmail}
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder={t('login.emailPlaceholder')}
                    autoComplete="username"
                    disabled={enviando}
                    className={campo}
                  />
                </div>
              </div>

              {mensagem && <Mensagem {...mensagem} comPapelAlerta />}

              <button type="submit" disabled={enviando} className={botaoPrincipal}>
                <Send size={16} aria-hidden="true" />
                {enviando ? t('login.enviandoCodigo') : t('login.pedirCodigo')}
              </button>
            </>
          )}

          {noCodigo && (
            <>
              {/*
                UMA UNICA regiao aria-live no passo 2, e o contador regressivo
                fica FORA dela. Dentro, ele seria lido a cada segundo e a tela
                viraria inutilizavel com leitor de tela. Aqui dentro entram as
                duas mensagens que mudam: o paragrafo do envio (anunciado uma vez,
                na troca de etapa) e o erro ou aviso da vez.
              */}
              <div aria-live="polite" className="space-y-3">
                <p
                  id="ss-codigo-explica"
                  className="text-white/70 text-[13px] leading-relaxed"
                >
                  {t('login.codigoEnviado', {
                    email: emailEcoado,
                    n: DIGITOS_CODIGO,
                    minutos,
                  })}
                </p>
                {mensagem && <Mensagem {...mensagem} />}
              </div>

              <div>
                <label htmlFor="ss-codigo" className="sr-only">
                  {t('login.codigo')}
                </label>
                <div className="relative">
                  <KeyRound
                    size={16}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-white/45"
                    aria-hidden="true"
                  />
                  {/*
                    UM campo com cara de caixinhas, e nao seis campos separados:
                      - colar funciona sozinho. "Codigo: 123 456" cai no onChange
                        inteiro e o saneamento devolve os digitos limpos. Com seis
                        campos, colar exige espalhar o texto na mao e cada
                        navegador se comporta de um jeito;
                      - o leitor de tela anuncia UM rotulo, e nao "campo 1 de 6"
                        seis vezes;
                      - autocomplete="one-time-code" so preenche um campo, que e
                        como o iOS oferece o codigo do e-mail e do SMS.

                    NAO TEM maxLength de proposito: ele cortaria a colagem ANTES
                    do onChange, e "Codigo: 123456" viraria vazio (os primeiros
                    caracteres nao sao digitos). Quem limita e o slice abaixo.

                    type="text", nunca "number": number perde zero a esquerda,
                    monta setinhas de incremento e aceita "e", "+" e ",".

                    O placeholder e uma fileira de HIFENS montada a partir da
                    constante: qualquer literal com cara de codigo ("000000")
                    ficaria no bundle publicado e faria a conferencia de release
                    acusar um codigo em producao para sempre.
                  */}
                  <input
                    id="ss-codigo"
                    ref={refCodigo}
                    type="text"
                    value={codigo}
                    onChange={(e) =>
                      setCodigo(e.target.value.replace(/\D/g, '').slice(0, DIGITOS_CODIGO))
                    }
                    placeholder={'-'.repeat(DIGITOS_CODIGO)}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    autoCorrect="off"
                    autoCapitalize="off"
                    spellCheck={false}
                    aria-describedby="ss-codigo-explica"
                    disabled={enviando}
                    className={`${campo} text-center font-mono text-2xl tracking-[0.45em] pl-10 pr-3`}
                  />
                </div>
              </div>

              {/* Sem envio automatico ao completar os digitos: um digito errado no
                  meio queimaria uma das cinco tentativas sem a pessoa pedir. */}
              <button type="submit" disabled={enviando} className={botaoPrincipal}>
                <LogIn size={16} aria-hidden="true" />
                {enviando ? t('login.entrando') : t('login.entrar')}
              </button>

              <div className="flex items-center justify-between gap-3 pt-1">
                <button
                  type="button"
                  onClick={voltarParaEmail}
                  disabled={enviando}
                  className="flex items-center gap-1.5 text-[12px] text-white/60 hover:text-white/90
                    underline underline-offset-2 transition disabled:opacity-50"
                >
                  <ArrowLeft size={13} aria-hidden="true" />
                  {t('login.outroEmail')}
                </button>

                <button
                  type="button"
                  onClick={() => pedir({ reenvio: true })}
                  disabled={!podeReenviar}
                  className="flex items-center gap-1.5 text-[12px] text-white/60 hover:text-white/90
                    underline underline-offset-2 transition disabled:no-underline
                    disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <span>{limiteDiario ? t('login.reenviarBloqueado') : t('login.reenviar')}</span>
                  {/* O numero e aria-hidden e o rotulo acessivel do botao NAO
                      muda: um nome que muda a cada segundo faria o leitor de tela
                      reanunciar o botao a cada foco. Para quem nao ve o numero,
                      o texto estatico abaixo diz o que precisa ser dito. */}
                  {contando && (
                    <>
                      <span aria-hidden="true" className="text-white/40">
                        {t('login.reenviarEspera', { n: restante })}
                      </span>
                      <span className="sr-only">{t('login.reenviarEmBreve')}</span>
                    </>
                  )}
                </button>
              </div>
            </>
          )}
        </form>

        <p className="text-white/45 text-[11px] leading-relaxed mt-5">
          {noCodigo ? t('login.naoChegou') : t('login.semAcesso')}
        </p>
      </div>
    </CarbonLoginLayout>
  );
}

/**
 * Caixa de mensagem da tela.
 *
 * `comPapelAlerta` existe porque o papel muda com o lugar: na etapa 1 a caixa e a
 * unica coisa que muda, entao ela mesma precisa ser anunciada (role="alert"); na
 * etapa 2 ela vive DENTRO da regiao aria-live, e um role="alert" ali dentro faria
 * o leitor de tela anunciar a mesma frase duas vezes.
 */
function Mensagem({ tom, texto, comPapelAlerta = false }) {
  const ehErro = tom === 'erro';
  const Icone = ehErro ? TriangleAlert : Info;
  const cores = ehErro
    ? 'border-red-300/30 bg-red-500/15 text-red-100'
    : 'border-amber-200/25 bg-amber-400/10 text-amber-50';

  return (
    <div
      {...(comPapelAlerta ? { role: 'alert' } : {})}
      className={`flex items-start gap-2 rounded-xl border px-3 py-2.5 text-sm ${cores}`}
    >
      <Icone size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
      <span>{texto}</span>
    </div>
  );
}

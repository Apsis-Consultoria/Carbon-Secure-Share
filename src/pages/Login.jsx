import { useState } from 'react';
import { FlaskConical, LogIn, Lock, Mail, TriangleAlert } from 'lucide-react';

import CarbonLoginLayout from '@/components/CarbonLoginLayout';
import SeletorIdioma from '@/components/SeletorIdioma';
import { entrar, entrarDemo } from '@/lib/api';
import { MODO_DEMO } from '@/lib/demo';
import { gravarSessao } from '@/lib/sessao';
import { useIdioma, textoDoErro } from '@/lib/i18n';

// Mesma pilha de fontes do CarbonLoginLayout: Sora para titulo, no padrao dos
// reports da APSIS.
const SORA = "'Sora', 'Segoe UI', sans-serif";

/**
 * Login do CLIENTE (e-mail e senha).
 *
 * Reaproveita o CarbonLoginLayout do Portal Apsis Carbon: quem chega aqui veio
 * de um e-mail da APSIS, e a tela precisa parecer da APSIS logo no primeiro
 * segundo. O que muda e o miolo - la e um botao da Microsoft, aqui e um
 * formulario, porque o cliente nao tem conta no tenant.
 *
 * O SELETOR DE IDIOMA FICA AQUI, e nao so depois de entrar: a interface nasce em
 * ingles, e quem prefere portugues precisa poder trocar ANTES de ler o
 * formulario, nao depois.
 *
 * O erro exibido e sempre o que o servidor mandou, e o servidor nao distingue
 * "e-mail nao existe" de "senha errada". Isso e deliberado: confirmar que um
 * e-mail tem cadastro ja diria que aquela pessoa e cliente da APSIS num projeto
 * de carbono, o que e informacao sobre o cliente e sobre o negocio.
 *
 * Sem "esqueci minha senha": quem emite credencial e a equipe da APSIS, pelo
 * Portal Carbon. O texto do rodape diz isso, para a pessoa nao ficar procurando
 * um link que nao existe.
 */
export default function Login({ aoEntrar }) {
  const { t } = useIdioma();

  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState(null);
  const [enviando, setEnviando] = useState(false);

  async function submeter(evento) {
    evento.preventDefault();
    if (enviando) return;

    const alvo = email.trim().toLowerCase();
    if (!alvo || !senha) {
      setErro(t('login.camposObrigatorios'));
      return;
    }

    setEnviando(true);
    setErro(null);

    try {
      const dados = await entrar(alvo, senha);
      const sessao = {
        token: dados.token,
        projetos: dados.projetos ?? [],
        nome: dados.nome ?? '',
        email: alvo,
      };
      gravarSessao(sessao);
      // A senha sai da memoria assim que deixa de ser necessaria. Nao impede um
      // despejo de memoria determinado, mas nao ha razao para mante-la no estado
      // do React depois do login.
      setSenha('');
      aoEntrar(sessao);
    } catch (e) {
      setErro(textoDoErro(t, e));
      setEnviando(false);
    }
  }

  async function abrirDemonstracao() {
    if (enviando) return;
    setEnviando(true);
    setErro(null);
    try {
      const dados = await entrarDemo();
      const sessao = {
        token: dados.token,
        projetos: dados.projetos ?? [],
        nome: dados.nome ?? '',
        email: 'demo@example.com',
        demo: true,
      };
      gravarSessao(sessao);
      aoEntrar(sessao);
    } catch (e) {
      setErro(textoDoErro(t, e));
      setEnviando(false);
    }
  }

  const campo =
    'w-full rounded-xl border border-white/20 bg-white/10 pl-10 pr-3 py-3 text-sm text-white ' +
    'placeholder:text-white/45 focus:outline-none focus:border-[#F48126] focus:ring-2 ' +
    'focus:ring-[#F48126]/25 transition disabled:opacity-60';

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
        */}
        <h1
          className="text-3xl lg:text-4xl font-black tracking-tight text-center"
          style={{ fontFamily: SORA }}
        >
          <span className="text-white">SECURE</span>{' '}
          <span style={{ color: '#F48126' }}>SHARE</span>
        </h1>

        <p className="text-white/70 text-sm text-center mt-2 mb-6">{t('login.chamada')}</p>

        <form onSubmit={submeter} className="space-y-3" noValidate>
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

          <div>
            <label htmlFor="ss-senha" className="sr-only">
              {t('login.senha')}
            </label>
            <div className="relative">
              <Lock
                size={16}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-white/45"
                aria-hidden="true"
              />
              <input
                id="ss-senha"
                type="password"
                value={senha}
                onChange={(e) => setSenha(e.target.value)}
                placeholder={t('login.senhaPlaceholder')}
                autoComplete="current-password"
                disabled={enviando}
                className={campo}
              />
            </div>
          </div>

          {erro && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-xl border border-red-300/30 bg-red-500/15 px-3 py-2.5 text-sm text-red-100"
            >
              <TriangleAlert size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
              <span>{erro}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={enviando}
            className="w-full flex items-center justify-center gap-2 rounded-xl bg-[#F48126] px-4 py-3
              text-sm font-semibold text-white transition hover:bg-[#e06810]
              disabled:opacity-60 disabled:cursor-not-allowed"
          >
            <LogIn size={16} aria-hidden="true" />
            {enviando ? t('login.entrando') : t('login.entrar')}
          </button>
        </form>

        {/*
          Botao de demonstracao. O ramo inteiro SOME do build de producao:
          MODO_DEMO e import.meta.env.DEV, que o Vite substitui por false, e o
          Rollup elimina o bloco junto com o modulo src/lib/demo.js. Nao e um
          botao escondido - ele nao existe no bundle publicado.
        */}
        {MODO_DEMO && (
          <div className="mt-5 pt-5 border-t border-white/10">
            <button
              type="button"
              disabled={enviando}
              onClick={abrirDemonstracao}
              className="w-full flex items-center justify-center gap-2 rounded-xl border border-white/25
                bg-white/5 px-4 py-2.5 text-sm font-medium text-white/90 transition
                hover:bg-white/10 disabled:opacity-60"
            >
              <FlaskConical size={15} aria-hidden="true" />
              {t('demo.entrar')}
            </button>
            <p className="text-white/40 text-[11px] leading-relaxed mt-2 text-center">
              {t('demo.explica')}
            </p>
          </div>
        )}

        <p className="text-white/45 text-[11px] leading-relaxed mt-5">{t('login.semAcesso')}</p>
      </div>
    </CarbonLoginLayout>
  );
}

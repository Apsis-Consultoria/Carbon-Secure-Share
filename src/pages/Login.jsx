import { useState } from 'react';
import { LogIn, Lock, Mail, TriangleAlert } from 'lucide-react';

import CarbonLoginLayout from '@/components/CarbonLoginLayout';
import { entrar } from '@/lib/api';
import { gravarSessao } from '@/lib/sessao';

/**
 * Login do CLIENTE (e-mail e senha).
 *
 * Reaproveita o CarbonLoginLayout do Portal Apsis Carbon: quem chega aqui veio
 * de um e-mail da APSIS, e a tela precisa parecer da APSIS logo no primeiro
 * segundo. O que muda e o miolo - la e um botao da Microsoft, aqui e um
 * formulario, porque o cliente nao tem conta no tenant.
 *
 * O erro exibido e SEMPRE o que o servidor mandou, e o servidor nao distingue
 * "e-mail nao existe" de "senha errada". Isso e deliberado: confirmar que um
 * e-mail tem cadastro ja diria que aquela pessoa e cliente da APSIS num projeto
 * de carbono, o que e informacao sobre o cliente e sobre o negocio.
 *
 * Sem "esqueci minha senha": quem emite credencial e a equipe da APSIS, pelo
 * Portal Carbon. O texto do rodape diz isso, para a pessoa nao ficar procurando
 * um link que nao existe.
 */
export default function Login({ aoEntrar }) {
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState(null);
  const [enviando, setEnviando] = useState(false);

  async function submeter(evento) {
    evento.preventDefault();
    if (enviando) return;

    const alvo = email.trim().toLowerCase();
    if (!alvo || !senha) {
      setErro('Informe o e-mail e a senha.');
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
      setErro(e.message);
      setEnviando(false);
    }
  }

  const campo =
    'w-full rounded-xl border border-white/20 bg-white/10 pl-10 pr-3 py-3 text-sm text-white ' +
    'placeholder:text-white/45 focus:outline-none focus:border-[#F48126] focus:ring-2 ' +
    'focus:ring-[#F48126]/25 transition disabled:opacity-60';

  return (
    <CarbonLoginLayout>
      <div className="w-full">
        <h1 className="text-white text-lg font-semibold">Secure Share</h1>
        <p className="text-white/70 text-sm mt-1 mb-6">
          Entre com o e-mail e a senha que você recebeu da APSIS.
        </p>

        <form onSubmit={submeter} className="space-y-3" noValidate>
          <div>
            <label htmlFor="ss-email" className="sr-only">
              E-mail
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
                placeholder="seu.email@empresa.com"
                autoComplete="username"
                disabled={enviando}
                className={campo}
              />
            </div>
          </div>

          <div>
            <label htmlFor="ss-senha" className="sr-only">
              Senha
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
                placeholder="Senha"
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
            {enviando ? 'Entrando...' : 'Entrar'}
          </button>
        </form>

        <p className="text-white/45 text-[11px] leading-relaxed mt-5">
          Esqueceu a senha ou não recebeu o acesso? Fale com a pessoa da APSIS
          responsável pelo seu projeto: é ela que emite uma nova.
        </p>
      </div>
    </CarbonLoginLayout>
  );
}

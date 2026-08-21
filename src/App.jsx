import { useCallback, useEffect, useState } from 'react';
import { Navigate, Route, Routes, useNavigate } from 'react-router-dom';

import Login from '@/pages/Login';
import Arquivos from '@/pages/Arquivos';
import TrocarSenha from '@/pages/TrocarSenha';
import { entrarDemo } from '@/lib/api';
import { MODO_DEMO } from '@/lib/demo';
import { gravarSessao, lerSessao, limparSessao } from '@/lib/sessao';

/**
 * App - roteamento e o portao de sessao.
 *
 * NAO existe mais checagem de configuracao no boot, porque nao existe mais
 * configuracao no frontend para checar: ele nao conhece URL nem chave nenhuma
 * (ver src/lib/endpoint.js). Se o rewrite de /api/* faltar na hospedagem, quem
 * detecta e a camada de API, na primeira chamada, com mensagem propria - e a
 * tela de login continua aparecendo normalmente em vez de virar um aviso.
 *
 * A sessao vive no estado daqui, e nao num contexto ou store: sao tres telas e
 * um unico consumidor real (Arquivos). Um provider aqui seria cerimonia sem
 * ganho.
 */
export default function App() {
  const [sessao, setSessao] = useState(() => lerSessao());
  const navegar = useNavigate();

  const sair = useCallback(() => {
    limparSessao();
    setSessao(null);
    navegar('/', { replace: true });
  }, [navegar]);

  /**
   * Em DEMONSTRACAO, refaz a sessao no boot.
   *
   * A sessao vive em sessionStorage e sobrevive ao recarregar. Isso e o certo em
   * producao, mas na revisao vira armadilha: mexer no dataset ficticio (incluir
   * a pasta Geral, por exemplo) nao aparece na tela, porque a lista de projetos
   * guardada continua sendo a antiga. Ja custou um "sumiu da tela" que era so
   * cache.
   *
   * Refazer o login aqui e barato (nao ha rede em demonstracao) e o bloco sai do
   * build de producao junto com MODO_DEMO.
   */
  useEffect(() => {
    if (!MODO_DEMO) return undefined;
    const atual = lerSessao();
    if (!atual?.demo) return undefined;

    let vivo = true;
    entrarDemo()
      .then((dados) => {
        if (!vivo) return;
        const nova = { ...atual, projetos: dados.projetos ?? [], nome: dados.nome ?? '' };
        gravarSessao(nova);
        setSessao(nova);
      })
      .catch(() => { /* segue com a sessao guardada */ });

    return () => { vivo = false; };
    // So no boot: com `sessao` nas dependencias isto entraria em laco.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * A sessao pode expirar com a aba aberta (TTL de 8 horas). Sem esta checagem,
   * a pessoa continuaria vendo a lista e receberia 401 em cada clique, sem
   * entender por que. Um minuto e frequencia suficiente para um TTL de horas.
   */
  useEffect(() => {
    if (!sessao) return undefined;
    const timer = setInterval(() => {
      if (!lerSessao()) {
        setSessao(null);
        navegar('/', { replace: true });
      }
    }, 60_000);
    return () => clearInterval(timer);
  }, [sessao, navegar]);

  if (!sessao) {
    return (
      <Routes>
        <Route path="/" element={<Login aoEntrar={setSessao} />} />
        {/* Qualquer rota profunda cai no login. Sem deep link guardado de
            proposito: o unico destino util depois de entrar e a lista de
            arquivos, e guardar caminho abriria espaco para redirect forjado. */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route path="/" element={<Arquivos sessao={sessao} aoSair={sair} />} />
      <Route path="/senha" element={<TrocarSenha aoSair={sair} />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

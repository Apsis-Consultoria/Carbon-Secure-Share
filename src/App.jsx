import { useCallback, useEffect, useState } from 'react';
import { Navigate, Route, Routes, useNavigate } from 'react-router-dom';

import Login from '@/pages/Login';
import Arquivos from '@/pages/Arquivos';
import TrocarSenha from '@/pages/TrocarSenha';
import ErroConfig from '@/pages/ErroConfig';
import { lerSessao, limparSessao } from '@/lib/sessao';
import { configuracaoIncompleta } from '@/lib/supabase';

/**
 * App - roteamento e o portao de sessao.
 *
 * NUNCA TELA BRANCA: configuracao ausente renderiza ErroConfig e para por ali,
 * em vez de deixar cada chamada falhar com "failed to fetch" e a pessoa olhando
 * para um retangulo vazio.
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

  if (configuracaoIncompleta()) return <ErroConfig />;

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

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { ArrowLeft, KeyRound, ShieldCheck } from 'lucide-react';

import { trocarSenha } from '@/lib/api';
import Cartao from '@/components/ui/Cartao';
import Campo from '@/components/ui/Campo';
import AvisoDiscreto from '@/components/ui/AvisoDiscreto';
import BotaoPrimario from '@/components/ui/BotaoPrimario';
import BotaoSecundario from '@/components/ui/BotaoSecundario';

const MINIMO = 12;

/**
 * Troca de senha pelo proprio cliente.
 *
 * A senha atual e exigida mesmo com sessao valida: sessao aberta em maquina
 * compartilhada nao pode virar troca de credencial.
 *
 * A validacao daqui e conveniencia (aviso imediato, sem ida ao servidor). Quem
 * decide e o banco, em carbon_secure_share_trocar_senha, com o MESMO minimo de
 * 12 caracteres. Se os dois divergirem, vale o do banco.
 */
export default function TrocarSenha({ aoSair }) {
  const navegar = useNavigate();

  const [atual, setAtual] = useState('');
  const [nova, setNova] = useState('');
  const [confirma, setConfirma] = useState('');
  const [erros, setErros] = useState({});
  const [enviando, setEnviando] = useState(false);

  function validar() {
    const novos = {};
    if (!atual) novos.atual = 'Informe a senha atual.';
    if (!nova) novos.nova = 'Informe a nova senha.';
    else if (nova.length < MINIMO) novos.nova = `A senha precisa de pelo menos ${MINIMO} caracteres.`;
    else if (nova === atual) novos.nova = 'A nova senha precisa ser diferente da atual.';
    if (confirma !== nova) novos.confirma = 'As senhas não conferem.';

    setErros(novos);
    return Object.keys(novos).length === 0;
  }

  async function submeter() {
    if (!validar() || enviando) return;

    setEnviando(true);
    try {
      await trocarSenha(atual, nova);
      // Sair depois de trocar e deliberado: a sessao continuaria valida, mas
      // voltar ao login com a senha nova e o que confirma para a pessoa que a
      // troca funcionou de verdade.
      toast.success('Senha alterada. Entre novamente com a nova senha.');
      aoSair();
    } catch (e) {
      if (e.codigo === 'senha_atual_incorreta') setErros({ atual: e.message });
      else toast.error(e.message);
      setEnviando(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#F4F6F4] py-10 px-4">
      <div className="max-w-md mx-auto space-y-4">
        <BotaoSecundario variante="fantasma" icone={ArrowLeft} como="link" para="/">
          Voltar aos documentos
        </BotaoSecundario>

        <Cartao
          icone={KeyRound}
          titulo="Trocar senha"
          subtitulo="Escolha uma senha que você não use em outro serviço."
        >
          <div className="space-y-4">
            <Campo
              rotulo="Senha atual"
              tipo="password"
              obrigatorio
              valor={atual}
              erro={erros.atual}
              onChange={setAtual}
              extras={{ autoComplete: 'current-password' }}
            />

            <Campo
              rotulo="Nova senha"
              tipo="password"
              obrigatorio
              valor={nova}
              erro={erros.nova}
              dica={`Pelo menos ${MINIMO} caracteres.`}
              onChange={setNova}
              extras={{ autoComplete: 'new-password' }}
            />

            <Campo
              rotulo="Repita a nova senha"
              tipo="password"
              obrigatorio
              valor={confirma}
              erro={erros.confirma}
              onChange={setConfirma}
              extras={{ autoComplete: 'new-password' }}
            />

            <AvisoDiscreto tom="azul" icone={ShieldCheck}>
              A troca vale para todos os projetos aos quais você tem acesso, e você
              precisará entrar de novo com a senha nova.
            </AvisoDiscreto>

            <div className="flex items-center justify-end gap-2">
              <BotaoSecundario variante="fantasma" onClick={() => navegar('/')}>
                Cancelar
              </BotaoSecundario>
              <BotaoPrimario carregando={enviando} onClick={submeter}>
                Salvar nova senha
              </BotaoPrimario>
            </div>
          </div>
        </Cartao>
      </div>
    </div>
  );
}

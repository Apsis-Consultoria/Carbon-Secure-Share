import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { ArrowLeft, KeyRound, ShieldCheck } from 'lucide-react';

import { trocarSenha } from '@/lib/api';
import { useIdioma, textoDoErro } from '@/lib/i18n';
import SeletorIdioma from '@/components/SeletorIdioma';
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
  const { t } = useIdioma();

  const [atual, setAtual] = useState('');
  const [nova, setNova] = useState('');
  const [confirma, setConfirma] = useState('');
  const [erros, setErros] = useState({});
  const [enviando, setEnviando] = useState(false);

  function validar() {
    const novos = {};
    if (!atual) novos.atual = t('senha.informeAtual');
    if (!nova) novos.nova = t('senha.informeNova');
    else if (nova.length < MINIMO) novos.nova = t('senha.curta', { n: MINIMO });
    else if (nova === atual) novos.nova = t('senha.igual');
    if (confirma !== nova) novos.confirma = t('senha.naoConfere');

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
      toast.success(t('senha.trocada'));
      aoSair();
    } catch (e) {
      const texto = textoDoErro(t, e);
      if (e.codigo === 'senha_atual_incorreta') setErros({ atual: texto });
      else toast.error(texto);
      setEnviando(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#F4F6F4] py-10 px-4">
      <div className="max-w-md mx-auto space-y-4">
        <div className="flex items-center justify-between gap-3">
          <BotaoSecundario variante="fantasma" icone={ArrowLeft} como="link" para="/">
            {t('senha.voltar')}
          </BotaoSecundario>
          {/* O seletor tambem aqui: esta tela e alcancavel por URL direta, e sem
              ele a pessoa teria de voltar so para trocar o idioma. */}
          <SeletorIdioma variante="escuro" className="!border-[#DDE3DE] bg-[#1A4731]" />
        </div>

        <Cartao icone={KeyRound} titulo={t('senha.titulo')} subtitulo={t('senha.subtitulo')}>
          <div className="space-y-4">
            <Campo
              rotulo={t('senha.atual')}
              tipo="password"
              obrigatorio
              valor={atual}
              erro={erros.atual}
              onChange={setAtual}
              extras={{ autoComplete: 'current-password' }}
            />

            <Campo
              rotulo={t('senha.nova')}
              tipo="password"
              obrigatorio
              valor={nova}
              erro={erros.nova}
              dica={t('senha.dicaMinimo', { n: MINIMO })}
              onChange={setNova}
              extras={{ autoComplete: 'new-password' }}
            />

            <Campo
              rotulo={t('senha.confirma')}
              tipo="password"
              obrigatorio
              valor={confirma}
              erro={erros.confirma}
              onChange={setConfirma}
              extras={{ autoComplete: 'new-password' }}
            />

            <AvisoDiscreto tom="azul" icone={ShieldCheck}>
              {t('senha.aviso')}
            </AvisoDiscreto>

            <div className="flex items-center justify-end gap-2">
              <BotaoSecundario variante="fantasma" onClick={() => navegar('/')}>
                {t('senha.cancelar')}
              </BotaoSecundario>
              <BotaoPrimario carregando={enviando} onClick={submeter}>
                {t('senha.salvar')}
              </BotaoPrimario>
            </div>
          </div>
        </Cartao>
      </div>
    </div>
  );
}

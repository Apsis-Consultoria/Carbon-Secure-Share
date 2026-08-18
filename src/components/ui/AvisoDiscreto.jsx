/**
 * AvisoDiscreto - recado curto que não é uma tela de erro.
 *
 * Tem DOIS visuais, os dois já existentes nas telas de referência:
 *
 * - tom `neutro`: linha cinza sem caixa (o "Não foi possível carregar agora" da
 *   Boas-Vindas). É o degrade de falha de rede: a tela continua utilizável e o aviso
 *   não pode competir com o conteúdo.
 * - qualquer outro tom: caixa com fundo, borda e texto do tom (o aviso de divergência
 *   de área em Projetos). É para regra de negócio que a pessoa precisa ler.
 *
 * Regra de acessibilidade: aviso em vermelho nasce como `role="alert"` (interrompe o
 * leitor de tela), o resto como `role="status"` (fala na próxima pausa). Passe
 * `papel="nenhum"` para texto explicativo permanente, que não é novidade nenhuma e
 * não deveria ser anunciado.
 */

import { Info, TriangleAlert, CircleAlert, CheckCircle2, WifiOff } from 'lucide-react';
import { classesDoTom } from './Badge';

const ICONE_PADRAO = {
  neutro: WifiOff,
  verde: CheckCircle2,
  ambar: TriangleAlert,
  vermelho: CircleAlert,
  azul: Info,
  laranja: Info,
};

/**
 * @param {object} props
 * @param {'neutro'|'verde'|'ambar'|'vermelho'|'azul'|'laranja'} [props.tom='neutro']
 * @param {React.ReactNode} [props.titulo] frase em negrito antes do texto
 * @param {React.ReactNode} [props.texto] alternativa a children
 * @param {React.ComponentType<{size?: number, className?: string}>|null} [props.icone]
 *        ícone do lucide; `null` remove o ícone, ausente usa o padrão do tom
 * @param {'status'|'alerta'|'nenhum'} [props.papel]
 * @param {React.ReactNode} [props.acao] link ou botão ao final do bloco
 * @param {string} [props.className]
 * @param {React.ReactNode} [props.children]
 */
export default function AvisoDiscreto({
  tom = 'neutro',
  titulo,
  texto,
  icone,
  papel,
  acao,
  className = '',
  children,
}) {
  const Icone = icone === null ? null : icone || ICONE_PADRAO[tom] || Info;
  const papelFinal = papel || (tom === 'vermelho' ? 'alerta' : 'status');
  const role = papelFinal === 'alerta' ? 'alert' : papelFinal === 'status' ? 'status' : undefined;
  const conteudo = children ?? texto;

  if (tom === 'neutro') {
    return (
      <div
        role={role}
        aria-live={role === 'status' ? 'polite' : undefined}
        className={`flex items-start gap-2 px-5 py-6 text-xs text-[#8A9990] ${className}`}
      >
        {Icone && <Icone size={14} className="flex-shrink-0 mt-0.5" aria-hidden="true" />}
        <div className="leading-relaxed">
          {titulo && <span className="font-semibold text-[#5C7060]">{titulo} </span>}
          {conteudo}
          {acao && <div className="mt-2">{acao}</div>}
        </div>
      </div>
    );
  }

  return (
    <div
      role={role}
      aria-live={role === 'status' ? 'polite' : undefined}
      className={`flex items-start gap-2.5 px-4 py-3 border rounded-xl ${classesDoTom(tom)} ${className}`}
    >
      {Icone && <Icone size={16} className="flex-shrink-0 mt-0.5" aria-hidden="true" />}
      <div className="text-xs leading-relaxed">
        {titulo && <span className="font-bold">{titulo} </span>}
        {conteudo}
        {acao && <div className="mt-2">{acao}</div>}
      </div>
    </div>
  );
}

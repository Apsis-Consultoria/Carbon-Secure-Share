import { useEffect, useState } from 'react';
import { Download, ExternalLink, Eye, FileQuestion, MousePointerSquareDashed, ShieldCheck } from 'lucide-react';

import { baixarBytes, urlArquivo } from '@/lib/api';
import { useIdioma, textoDoErro } from '@/lib/i18n';
import Badge from '@/components/ui/Badge';
import Carregando from '@/components/ui/Carregando';
import EstadoVazio from '@/components/ui/EstadoVazio';
import AvisoDiscreto from '@/components/ui/AvisoDiscreto';
import BotaoSecundario from '@/components/ui/BotaoSecundario';

/**
 * Painel de visualizacao, no lugar do painel de previa do explorador do Windows.
 *
 * ------------------------------------------------------------------------
 * SEGURANCA: O QUE PODE E O QUE NAO PODE SER EXIBIDO
 * ------------------------------------------------------------------------
 * Desde que o frontend passou a falar por /api/* (caminho relativo, resolvido
 * por rewrite da hospedagem), o conteudo do arquivo chega na MESMA ORIGEM do
 * portal. Antes vinha de <ref>.supabase.co e o isolamento era automatico.
 *
 * Consequencia: um arquivo .html enviado por um cliente, aberto num <iframe>
 * daqui, rodaria script COM ACESSO ao sessionStorage do portal - ou seja, ao
 * token de sessao de quem o abriu. Um cliente roubaria a sessao de outra pessoa
 * da mesma empresa apenas subindo um arquivo.
 *
 * Por isso a exibicao e por LISTA BRANCA de extensao, e nao "tenta e ve no que
 * da". Formato fora da lista nao vira iframe: vira o aviso de "sem previa" com
 * o botao de baixar.
 *
 * Ha outras duas camadas, no servidor (carbon-ss-baixar): tipo executavel e
 * servido como text/plain, e a resposta leva Content-Security-Policy com
 * sandbox. As tres existem porque nenhuma sozinha e suficiente.
 *
 * IMAGEM VAI EM <img>, NAO EM IFRAME. Dentro de <img> o navegador desliga
 * script, o que torna ate SVG seguro; num iframe, um SVG com <script> executa.
 */

const IMAGENS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'avif']);

/**
 * Formatos que o navegador desenha num frame.
 *
 * Office entra porque o SERVIDOR converte para PDF no modo preview (o Graph faz
 * a conversao), entao o que chega aqui ja e application/pdf.
 */
const FRAME = new Set([
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'xlsb', 'csv', 'ppt', 'pptx', 'odt', 'ods', 'odp', 'rtf',
]);

/** Texto puro, exibido como texto. Nao vai a frame: nao precisa e nao deve. */
const TEXTO = new Set(['txt', 'md', 'log', 'json', 'yml', 'yaml', 'ini', 'sql']);

function extensaoDe(nome) {
  return String(nome ?? '').split('.').pop().toLowerCase();
}

export function temPrevia(nome) {
  const ext = extensaoDe(nome);
  return IMAGENS.has(ext) || FRAME.has(ext) || TEXTO.has(ext);
}

export default function Visualizador({ arquivo, projetoId, emDemo, tamanhoLegivel, aoVoltar }) {
  const { t } = useIdioma();

  const [fonte, setFonte] = useState(null);
  const [texto, setTexto] = useState(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState(null);

  const ext = extensaoDe(arquivo?.nome);
  const ehImagem = IMAGENS.has(ext);
  const ehFrame = FRAME.has(ext);
  const ehTexto = TEXTO.has(ext);
  const exibivel = ehImagem || ehFrame || ehTexto;
  const soVer = arquivo?.nivel === 'visualizar';

  /**
   * Monta a fonte do preview e a desmonta ao trocar de arquivo.
   *
   * Em producao a fonte e a propria URL de /api/carbon-ss-baixar em modo
   * preview, que o navegador busca sozinho. Em demonstracao nao ha backend,
   * entao geramos um blob - e ele PRECISA ser revogado na limpeza, senao cada
   * arquivo aberto vaza memoria enquanto a aba estiver viva.
   */
  useEffect(() => {
    let vivo = true;
    let urlBlob = null;

    setFonte(null);
    setTexto(null);
    setErro(null);

    if (!arquivo || !exibivel) return undefined;

    async function preparar() {
      setCarregando(true);
      try {
        if (emDemo) {
          const resposta = await baixarBytes(projetoId, arquivo.caminho);
          if (ehTexto) {
            const conteudo = await resposta.text();
            if (vivo) setTexto(conteudo);
          } else {
            const blob = await resposta.blob();
            urlBlob = URL.createObjectURL(blob);
            if (vivo) setFonte(urlBlob);
          }
        } else if (ehTexto) {
          const resposta = await baixarBytes(projetoId, arquivo.caminho);
          const conteudo = await resposta.text();
          if (vivo) setTexto(conteudo);
        } else {
          if (vivo) setFonte(urlArquivo(projetoId, arquivo.caminho, 'preview'));
        }
      } catch (e) {
        if (vivo) setErro(textoDoErro(t, e));
      } finally {
        if (vivo) setCarregando(false);
      }
    }

    preparar();

    return () => {
      vivo = false;
      if (urlBlob) URL.revokeObjectURL(urlBlob);
    };
  }, [arquivo, projetoId, emDemo, exibivel, ehTexto, t]);

  /* ---- Nada selecionado -------------------------------------------------- */

  if (!arquivo) {
    return (
      <div className="h-full flex items-center justify-center p-8">
        <EstadoVazio
          icone={MousePointerSquareDashed}
          titulo={t('visual.vazioTitulo')}
          texto={t('visual.vazioTexto')}
        />
      </div>
    );
  }

  /* ---- Corpo ------------------------------------------------------------- */

  let corpo;
  if (!exibivel) {
    corpo = (
      <div className="h-full flex items-center justify-center p-8">
        <EstadoVazio
          icone={FileQuestion}
          titulo={t('visual.semPreviaTitulo')}
          texto={t('visual.semPreviaTexto')}
        />
      </div>
    );
  } else if (carregando) {
    corpo = (
      <div className="h-full flex items-center justify-center p-8">
        <Carregando rotulo={t('visual.carregando')} />
      </div>
    );
  } else if (erro) {
    corpo = (
      <div className="p-5">
        <AvisoDiscreto tom="vermelho" titulo={t('visual.erro')}>
          {erro}
        </AvisoDiscreto>
      </div>
    );
  } else if (ehTexto) {
    corpo = (
      <pre className="h-full overflow-auto p-4 text-[12px] leading-relaxed text-[#1A2B1F] whitespace-pre-wrap break-words font-mono">
        {texto}
      </pre>
    );
  } else if (ehImagem) {
    corpo = (
      <div className="h-full overflow-auto p-4 flex items-center justify-center bg-[#F4F6F4]">
        {/* <img> e nao iframe: aqui o navegador desliga script, o que torna
            seguro ate um SVG malicioso. */}
        <img
          src={fonte}
          alt={arquivo.nome}
          className="max-w-full max-h-full object-contain rounded-lg shadow-sm bg-white"
        />
      </div>
    );
  } else {
    corpo = (
      <iframe
        // O `sandbox` sem allow-same-origin joga o documento numa origem opaca:
        // mesmo que algo escape das defesas do servidor, ele nao alcanca o
        // sessionStorage do portal. allow-popups fica de fora de proposito.
        sandbox=""
        src={fonte}
        title={arquivo.nome}
        className="w-full h-full border-0 bg-[#F4F6F4]"
      />
    );
  }

  /* ---- Cabecalho e moldura ----------------------------------------------- */

  return (
    <div className="h-full flex flex-col bg-white">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-[#DDE3DE] flex-shrink-0">
        {/* Voltar so aparece no empilhamento (telas estreitas), onde o painel
            ocupa a tela inteira e a lista fica escondida. */}
        {aoVoltar && (
          <BotaoSecundario
            variante="fantasma"
            tamanho="sm"
            onClick={aoVoltar}
            rotuloAcessivel={t('visual.voltar')}
            className="lg:hidden"
          >
            ‹
          </BotaoSecundario>
        )}

        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-[#1A2B1F] truncate">{arquivo.nome}</p>
          <p className="text-[11px] text-[#8A9990]">
            {tamanhoLegivel?.(arquivo.tamanho)}
            {ext === 'pdf' && (
              <>
                {' · '}
                <span className="inline-flex items-center gap-1">
                  <ShieldCheck size={10} /> {t('visual.protegido')}
                </span>
              </>
            )}
          </p>
        </div>

        {soVer && (
          <Badge tom="azul" tamanho="sm" icone={Eye}>
            {t('docs.soVisualizar')}
          </Badge>
        )}

        {/* Abrir em outra aba so no caminho real: em demonstracao o blob e
            revogado ao trocar de arquivo e a aba ficaria em branco. */}
        {exibivel && !emDemo && (
          <BotaoSecundario
            como="externo"
            href={urlArquivo(projetoId, arquivo.caminho, 'preview')}
            icone={ExternalLink}
            tamanho="sm"
            titulo={t('visual.abrirNovaAba')}
            rotuloAcessivel={t('visual.abrirNovaAba')}
          />
        )}

        {!soVer && (
          <BotaoSecundario
            {...(arquivo.aoBaixar
              ? { onClick: arquivo.aoBaixar }
              : { como: 'externo', href: urlArquivo(projetoId, arquivo.caminho, 'download') })}
            icone={Download}
            tamanho="sm"
            titulo={t('docs.baixar')}
            rotuloAcessivel={t('docs.baixarItem', { nome: arquivo.nome })}
          />
        )}
      </div>

      {soVer && (
        <p className="px-4 py-2 text-[11px] text-[#1F4A6B] bg-[#EAF2F8] border-b border-[#D3E3EF] flex-shrink-0">
          {t('visual.soVisualizacao')}
        </p>
      )}

      <div className="flex-1 min-h-0">{corpo}</div>
    </div>
  );
}

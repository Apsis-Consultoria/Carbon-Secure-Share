import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import {
  Folder, FolderOpen, ChevronRight, ChevronDown, Download, Loader2, RefreshCw, LogOut,
  KeyRound, UploadCloud, FileText, FileSpreadsheet, Image as IconeImagem,
  File as IconeArquivo, FolderArchive, Lock, Inbox, FlaskConical, FolderInput,
} from 'lucide-react';

import { listar, enviar, urlArquivo, baixarBytes } from '@/lib/api';
import { baixarPastaZip } from '@/lib/pastaZip';
import { MODO_DEMO } from '@/lib/demo';
import { useIdioma, textoDoErro } from '@/lib/i18n';
import SeletorIdioma from '@/components/SeletorIdioma';
import Visualizador from '@/components/Visualizador';
import Carregando from '@/components/ui/Carregando';
import EstadoVazio from '@/components/ui/EstadoVazio';
import AvisoDiscreto from '@/components/ui/AvisoDiscreto';
import BarraProgresso from '@/components/ui/BarraProgresso';
import BotaoSecundario from '@/components/ui/BotaoSecundario';

/**
 * Arquivos - navegacao em DUAS COLUNAS, no formato do explorador do Windows.
 *
 * POR QUE: o Secure Share do Carbon nao e um envio pontual. A pasta e alimentada
 * ao longo do contrato e o cliente volta muitas vezes durante meses. Uma lista
 * unica serve para "baixar e sair"; para navegar e alimentar toda semana o que
 * serve e explorador.
 *
 * Esquerda: arvore de pastas e arquivos, com selecao.
 * Direita:  o arquivo selecionado, aberto ali mesmo.
 *
 * ARRASTAR E SOLTAR EM CIMA DA PASTA. Cada pasta da arvore e um alvo: soltar
 * arquivos sobre ela envia PARA ELA, na hora, sem fila e sem botao de confirmar,
 * que e o gesto do explorador. Soltar no fundo da arvore envia para a raiz do
 * projeto. Pasta arrastada inteira preserva a estrutura.
 *
 * O servidor NUNCA sobrescreve: nome repetido vira copia (conflictBehavior
 * rename) e a tela avisa quais foram renomeados. Sem isso, um arquivo do cliente
 * com o mesmo nome apagaria um documento da APSIS - perda de evidencia
 * silenciosa numa pasta de due diligence.
 *
 * EM TELA ESTREITA nao ha duas colunas: a lista ocupa tudo e o visualizador cobre
 * a tela com um botao de voltar.
 */

/* ===== Apoio ============================================================== */

function criarFormatador(idioma) {
  const local = idioma === 'pt' ? 'pt-BR' : 'en-US';
  return (bytes) => {
    if (bytes === null || bytes === undefined) return '';
    const fmt = (n, casas) =>
      n.toLocaleString(local, { minimumFractionDigits: casas, maximumFractionDigits: casas });
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${fmt(bytes / 1024, 1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${fmt(bytes / (1024 * 1024), 1)} MB`;
    return `${fmt(bytes / (1024 * 1024 * 1024), 2)} GB`;
  };
}

function IconeDoArquivo({ nome }) {
  const ext = String(nome ?? '').split('.').pop().toLowerCase();
  if (ext === 'pdf') return <FileText size={15} className="text-[#B4453C] shrink-0" />;
  if (['xls', 'xlsx', 'xlsb', 'csv'].includes(ext)) {
    return <FileSpreadsheet size={15} className="text-[#2F8F5B] shrink-0" />;
  }
  if (['doc', 'docx'].includes(ext)) return <FileText size={15} className="text-[#1F4A6B] shrink-0" />;
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif'].includes(ext)) {
    return <IconeImagem size={15} className="text-[#7A4FA3] shrink-0" />;
  }
  return <IconeArquivo size={15} className="text-[#8A9990] shrink-0" />;
}

/* ===== Leitura do que foi arrastado ======================================= */
// A FileSystem API e a unica forma de ler uma PASTA solta na tela.
//
// `webkitGetAsEntry` precisa ser chamado de forma SINCRONA no handler do drop:
// os DataTransferItem sao invalidados assim que o handler cede o controle, e um
// `await` antes disso faz a leitura devolver vazio, sem erro nenhum. Por isso a
// coleta e a travessia estao separadas em duas funcoes.

function coletarDoEvento(evento) {
  const entradas = [];
  for (const item of evento.dataTransfer?.items ?? []) {
    const entrada = item.webkitGetAsEntry?.();
    if (entrada) entradas.push(entrada);
  }
  return { entradas, simples: Array.from(evento.dataTransfer?.files ?? []) };
}

async function lerTodasAsEntradas(leitor) {
  const todas = [];
  const lote = () => new Promise((ok, falha) => leitor.readEntries(ok, falha));
  let atual;
  do {
    atual = await lote();
    todas.push(...atual);
  } while (atual.length > 0);
  return todas;
}

async function percorrer(entradas, prefixo = '') {
  const saida = [];
  for (const entrada of entradas) {
    if (entrada.isFile) {
      const arquivo = await new Promise((ok, falha) => entrada.file(ok, falha));
      saida.push({ arquivo, subPath: prefixo });
    } else if (entrada.isDirectory) {
      const filhos = await lerTodasAsEntradas(entrada.createReader());
      saida.push(
        ...(await percorrer(filhos, prefixo ? `${prefixo}/${entrada.name}` : entrada.name)),
      );
    }
  }
  return saida;
}

/** Resolve o que foi solto em `[{arquivo, subPath}]`, com pasta ou sem. */
async function resolverSoltos({ entradas, simples }) {
  if (entradas.length) {
    try {
      const itens = await percorrer(entradas);
      if (itens.length) return itens;
    } catch {
      // cai no fallback de arquivos simples
    }
  }
  return simples.map((arquivo) => ({ arquivo, subPath: '' }));
}

/** Ha arquivo sendo arrastado? Evita destacar pasta ao arrastar texto. */
function arrastandoArquivo(evento) {
  return Array.from(evento.dataTransfer?.types ?? []).includes('Files');
}

/* ===== Tela =============================================================== */

export default function Arquivos({ sessao, aoSair }) {
  const { t, idioma } = useIdioma();
  const fmtTamanho = criarFormatador(idioma);

  const projetos = sessao.projetos ?? [];
  const [projetoId, setProjetoId] = useState(projetos[0]?.projeto_id ?? '');
  const projeto = projetos.find((p) => p.projeto_id === projetoId) ?? projetos[0];

  const [raiz, setRaiz] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState(null);
  const [conteudo, setConteudo] = useState({});
  const [abertas, setAbertas] = useState(new Set());
  const [ocupadas, setOcupadas] = useState(new Set());
  const [selecionado, setSelecionado] = useState(null);

  // Pasta que recebe o envio pelo BOTAO (o arrastar usa a pasta sob o cursor).
  const [pastaAtual, setPastaAtual] = useState('');
  // Pasta sob o cursor durante o arraste. null = nenhuma; '' = raiz.
  const [alvoSoltar, setAlvoSoltar] = useState(null);
  const [enviando, setEnviando] = useState(null);

  const [zip, setZip] = useState(null);
  const abortarZip = useRef(null);
  const refInput = useRef(null);

  const emDemo = MODO_DEMO && sessao.demo;

  const carregarRaiz = useCallback(async () => {
    if (!projetoId) return;
    setCarregando(true);
    setErro(null);
    setConteudo({});
    setAbertas(new Set());
    setSelecionado(null);
    setPastaAtual('');
    try {
      const r = await listar(projetoId, '');
      setRaiz(r.itens ?? []);
    } catch (e) {
      setErro(textoDoErro(t, e));
    } finally {
      setCarregando(false);
    }
  }, [projetoId, t]);

  useEffect(() => { carregarRaiz(); }, [carregarRaiz]);

  /** Relê UMA pasta e deixa ela aberta. Usado depois de um envio. */
  const recarregarPasta = useCallback(
    async (caminho) => {
      const r = await listar(projetoId, caminho);
      if (!caminho) {
        setRaiz(r.itens ?? []);
        return;
      }
      setConteudo((a) => ({ ...a, [caminho]: r.itens ?? [] }));
      setAbertas((a) => new Set([...a, caminho]));
    },
    [projetoId],
  );

  async function alternarPasta(caminho) {
    // Clicar numa pasta tambem a torna a pasta ATUAL, como no explorador: o
    // proximo envio pelo botao vai para ela.
    setPastaAtual(caminho);

    if (abertas.has(caminho)) {
      setAbertas((a) => { const n = new Set(a); n.delete(caminho); return n; });
      return;
    }
    setAbertas((a) => new Set([...a, caminho]));
    if (conteudo[caminho] !== undefined) return;

    setOcupadas((a) => new Set([...a, caminho]));
    try {
      const r = await listar(projetoId, caminho);
      setConteudo((a) => ({ ...a, [caminho]: r.itens ?? [] }));
    } catch (e) {
      toast.error(t('pasta.naoAbriu', { nome: caminho.split('/').pop() }), {
        description: textoDoErro(t, e),
      });
      setAbertas((a) => { const n = new Set(a); n.delete(caminho); return n; });
    } finally {
      setOcupadas((a) => { const n = new Set(a); n.delete(caminho); return n; });
    }
  }

  /* ---- Envio ------------------------------------------------------------- */

  const rotuloPasta = (caminho) =>
    caminho ? caminho.split('/').pop() : t('envio.paraRaiz');

  async function enviarPara(itens, destino) {
    if (!itens.length || enviando) return;

    setEnviando({ n: itens.length, destino });
    try {
      const r = await enviar(projetoId, itens, { destino });

      if (r.falhas?.length) {
        toast.warning(
          t('envio.parcial', { enviados: r.enviados.length, falhas: r.falhas.length }),
          {
            description: r.falhas.map((f) => `${f.arquivo}: ${f.motivo}`).join(' | '),
            duration: 12000,
          },
        );
      } else {
        toast.success(t('envio.sucesso', { n: r.enviados.length }), {
          // Renomeacao nao e detalhe: quem enviou precisa saber que o arquivo
          // ficou com outro nome, senao vai procurar o original e nao achar.
          description: r.renomeados?.length
            ? t('envio.renomeados', { n: r.renomeados.length })
            : undefined,
          duration: r.renomeados?.length ? 12000 : 5000,
        });
      }

      await recarregarPasta(destino);
    } catch (e) {
      toast.error(t('envio.falhou'), { description: textoDoErro(t, e) });
    } finally {
      setEnviando(null);
    }
  }

  /** Handlers de soltar, iguais para uma pasta e para o fundo da arvore. */
  function alvoDeSolta(caminho) {
    return {
      onDragOver: (e) => {
        if (!arrastandoArquivo(e) || enviando) return;
        e.preventDefault();
        e.stopPropagation();
        setAlvoSoltar(caminho);
      },
      onDragLeave: (e) => {
        e.stopPropagation();
        setAlvoSoltar((a) => (a === caminho ? null : a));
      },
      onDrop: async (e) => {
        if (!arrastandoArquivo(e)) return;
        e.preventDefault();
        e.stopPropagation();
        setAlvoSoltar(null);
        // Coleta SINCRONA: ver a nota em "Leitura do que foi arrastado".
        const coletado = coletarDoEvento(e);
        const itens = await resolverSoltos(coletado);
        if (itens.length) enviarPara(itens, caminho);
        else toast.error(t('envio.falhou'));
      },
    };
  }

  /* ---- ZIP de pasta ------------------------------------------------------ */

  async function baixarPasta(sub, rotulo) {
    if (zip) return;

    const controlador = new AbortController();
    abortarZip.current = controlador;
    setZip({ feitos: 0, total: 0, arquivo: '', rotulo });

    try {
      const r = await baixarPastaZip(
        projetoId,
        sub,
        rotulo,
        (p) => setZip((atual) => (atual ? { ...atual, ...p } : atual)),
        controlador.signal,
      );

      if (controlador.signal.aborted) {
        toast.info(t('zip.cancelado'));
      } else if (r.total === 0) {
        toast.info(t('zip.semArquivos'), {
          description: r.ignorados ? t('zip.somenteVisualizacao', { n: r.ignorados }) : undefined,
        });
      } else {
        const partes = [];
        if (r.ignorados) partes.push(t('zip.foraSoVisualizar', { n: r.ignorados }));
        if (r.truncado) partes.push(t('zip.truncado'));
        toast.success(t('zip.pronto', { n: r.total }), {
          description: partes.length ? `${partes.join('. ')}.` : undefined,
          duration: partes.length ? 12000 : 5000,
        });
      }
    } catch (e) {
      toast.error(t('zip.falhou'), { description: textoDoErro(t, e) });
    } finally {
      abortarZip.current = null;
      setZip(null);
    }
  }

  /* ---- Download em demonstracao ------------------------------------------ */

  async function baixarNoDemo(caminho, nome) {
    try {
      const resposta = await baixarBytes(projetoId, caminho);
      const blob = await resposta.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      // .txt porque o conteudo ficticio e texto: salvar como .pdf faria o leitor
      // de PDF acusar corrupcao e parecer defeito nosso.
      link.download = `${nome}.txt`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      toast.info(t('demo.arquivoAviso'));
    } catch (e) {
      toast.error(textoDoErro(t, e));
    }
  }

  /* ---- Árvore ------------------------------------------------------------ */

  function linhas(itens, profundidade, pai) {
    return (itens ?? []).flatMap((item) => {
      const caminho = pai ? `${pai}/${item.nome}` : item.nome;
      const recuo = 8 + profundidade * 14;

      if (item.tipo === 'pasta') {
        const aberta = abertas.has(caminho);
        const ocupada = ocupadas.has(caminho);
        const filhos = conteudo[caminho];
        const sobrePasta = alvoSoltar === caminho;
        const ehAtual = pastaAtual === caminho;

        const linha = (
          <li
            key={caminho}
            className={`group flex items-center rounded-md transition ${
              sobrePasta ? 'bg-[#F48126]/15 ring-2 ring-inset ring-[#F48126]' : ''
            }`}
            {...alvoDeSolta(caminho)}
          >
            <button
              type="button"
              onClick={() => alternarPasta(caminho)}
              aria-expanded={aberta}
              title={sobrePasta ? t('envio.soltarNaPasta', { nome: item.nome }) : item.nome}
              style={{ paddingLeft: `${recuo}px` }}
              className={`flex items-center gap-1.5 flex-1 min-w-0 py-1.5 pr-2 text-left rounded-md transition ${
                sobrePasta ? '' : ehAtual ? 'bg-[#F4F6F4]' : 'hover:bg-[#F4F6F4]'
              }`}
            >
              <span className="w-4 h-4 flex items-center justify-center shrink-0 text-[#8A9990]">
                {ocupada ? <Loader2 size={12} className="animate-spin" />
                  : aberta ? <ChevronDown size={13} />
                  : <ChevronRight size={13} />}
              </span>
              {sobrePasta
                ? <FolderInput size={14} className="text-[#F48126] shrink-0" />
                : aberta
                  ? <FolderOpen size={14} className="text-[#C98A2B] shrink-0" />
                  : <Folder size={14} className="text-[#C98A2B] shrink-0" />}
              <span
                className={`text-[13px] truncate ${
                  sobrePasta ? 'text-[#8A5A12] font-semibold' : 'font-medium text-[#1A2B1F]'
                }`}
              >
                {item.nome}
              </span>
            </button>

            <BotaoSecundario
              variante="fantasma"
              icone={FolderArchive}
              tamanho="sm"
              titulo={t('docs.baixarPasta')}
              rotuloAcessivel={t('docs.baixarPastaItem', { nome: item.nome })}
              desabilitado={Boolean(zip)}
              className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 shrink-0"
              onClick={() => baixarPasta(caminho, item.nome)}
            />
          </li>
        );

        const filhosRender =
          aberta && filhos !== undefined
            ? filhos.length === 0
              ? [
                  <li
                    key={`${caminho}::vazia`}
                    style={{ paddingLeft: `${recuo + 32}px` }}
                    className="py-1.5 text-[12px] text-[#8A9990] italic"
                  >
                    {t('docs.pastaVazia')}
                  </li>,
                ]
              : linhas(filhos, profundidade + 1, caminho)
            : [];

        return [linha, ...filhosRender];
      }

      const soVer = item.nivel === 'visualizar';
      const ativo = selecionado?.caminho === caminho;

      return [
        <li key={caminho} className="group flex items-center">
          <button
            type="button"
            aria-current={ativo ? 'true' : undefined}
            onClick={() => setSelecionado({ ...item, caminho })}
            style={{ paddingLeft: `${recuo + 18}px` }}
            className={`flex items-center gap-2 flex-1 min-w-0 py-1.5 pr-2 text-left rounded-md transition ${
              ativo ? 'bg-[#1A4731]/10 ring-1 ring-inset ring-[#1A4731]/25' : 'hover:bg-[#F4F6F4]'
            }`}
          >
            <IconeDoArquivo nome={item.nome} />
            <span
              className={`text-[13px] truncate ${
                ativo ? 'text-[#1A4731] font-medium' : 'text-[#1A2B1F]'
              }`}
            >
              {item.nome}
            </span>
            <span className="text-[10px] text-[#8A9990] ml-auto shrink-0 tabular-nums">
              {fmtTamanho(item.tamanho)}
            </span>
            {/* Cadeado em vez de selo escrito: numa lista densa o texto "Só
                visualizar" em toda linha viraria ruido. O selo por extenso
                aparece no cabecalho do visualizador, onde ha espaco. */}
            {soVer && (
              <Lock size={11} className="text-[#1F4A6B] shrink-0" aria-label={t('docs.soVisualizar')} />
            )}
          </button>

          {!soVer && (
            <BotaoSecundario
              variante="fantasma"
              icone={Download}
              tamanho="sm"
              titulo={t('docs.baixar')}
              rotuloAcessivel={t('docs.baixarItem', { nome: item.nome })}
              className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 shrink-0"
              {...(emDemo
                ? { onClick: () => baixarNoDemo(caminho, item.nome) }
                : { como: 'externo', href: urlArquivo(projetoId, caminho, 'download') })}
            />
          )}
        </li>,
      ];
    });
  }

  /* ---- Render ------------------------------------------------------------ */

  const arquivoAberto = selecionado
    ? {
        ...selecionado,
        aoBaixar: emDemo ? () => baixarNoDemo(selecionado.caminho, selecionado.nome) : null,
      }
    : null;

  const sobreRaiz = alvoSoltar === '';

  return (
    <div className="h-screen flex flex-col bg-[#F4F6F4] overflow-hidden">
      {/* ---- Cabecalho ---- */}
      <header className="bg-[#1A4731] text-white flex-shrink-0">
        <div className="px-4 py-3 flex items-center gap-3 flex-wrap">
          <img
            src="/login/logo-apsis-carbon.png"
            alt="APSIS Carbon"
            className="h-7 w-auto"
            onError={(e) => { e.currentTarget.style.display = 'none'; }}
          />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold truncate">{t('app.nome')}</p>
            <p className="text-[11px] text-white/70 truncate">
              {sessao.nome ? `${sessao.nome} · ` : ''}{sessao.email}
            </p>
          </div>

          <SeletorIdioma variante="escuro" />

          <Link
            to="/senha"
            className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg
              border border-white/25 hover:bg-white/10 transition"
          >
            <KeyRound size={13} /> <span className="hidden sm:inline">{t('nav.trocarSenha')}</span>
          </Link>

          <button
            type="button"
            onClick={aoSair}
            className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg
              border border-white/25 hover:bg-white/10 transition"
          >
            <LogOut size={13} /> <span className="hidden sm:inline">{t('nav.sair')}</span>
          </button>
        </div>

        {projetos.length > 1 && (
          <div className="px-4 pb-2 flex items-center gap-1.5 flex-wrap">
            {projetos.map((p) => (
              <button
                key={p.projeto_id}
                type="button"
                onClick={() => setProjetoId(p.projeto_id)}
                className={`text-xs font-medium px-3 py-1 rounded-lg transition ${
                  p.projeto_id === projetoId
                    ? 'bg-white text-[#1A4731]'
                    : 'text-white/70 hover:text-white hover:bg-white/10'
                }`}
              >
                {p.ap_os ? `${p.ap_os} · ` : ''}{p.empresa}
              </button>
            ))}
          </div>
        )}
      </header>

      {MODO_DEMO && sessao.demo && (
        <div className="bg-[#FDF3E3] border-b border-[#F2DDB4] flex-shrink-0">
          <p className="px-4 py-1.5 text-[11px] text-[#8A5A12] flex items-center gap-2">
            <FlaskConical size={13} className="shrink-0" aria-hidden="true" />
            {t('demo.faixa')}
          </p>
        </div>
      )}

      {/* ---- Duas colunas ---- */}
      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[minmax(300px,32%)_1fr]">
        {/* Coluna 1: arvore */}
        <aside
          className={`h-full min-h-0 flex-col border-r border-[#DDE3DE] bg-white ${
            selecionado ? 'hidden lg:flex' : 'flex'
          }`}
        >
          <div className="flex items-center gap-1 px-3 py-2 border-b border-[#DDE3DE] flex-shrink-0">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-[#8A9990] flex-1 truncate">
              {projeto?.empresa ?? t('visual.arquivos')}
            </p>
            <BotaoSecundario
              variante="fantasma"
              icone={FolderArchive}
              tamanho="sm"
              titulo={t('docs.baixarTudo')}
              rotuloAcessivel={t('docs.baixarTudo')}
              desabilitado={Boolean(zip) || !raiz?.length}
              onClick={() => baixarPasta('', projeto?.empresa ?? 'documents')}
            />
            <BotaoSecundario
              variante="fantasma"
              icone={RefreshCw}
              tamanho="sm"
              carregando={carregando}
              titulo={t('docs.atualizar')}
              rotuloAcessivel={t('docs.atualizar')}
              onClick={carregarRaiz}
            />
          </div>

          {zip && (
            <div className="px-3 py-2.5 border-b border-[#DDE3DE] bg-[#FDF3E3] flex-shrink-0">
              <BarraProgresso
                valor={zip.total ? (zip.feitos / zip.total) * 100 : 0}
                rotulo={zip.arquivo || t('zip.preparando')}
                detalhe={zip.total ? `${zip.feitos}/${zip.total}` : ''}
              />
              <div className="flex items-center justify-between gap-2 mt-1.5">
                <span className="text-[10px] text-[#8A5A12] leading-snug">{t('zip.aviso')}</span>
                <BotaoSecundario
                  variante="perigo"
                  tamanho="sm"
                  onClick={() => abortarZip.current?.abort()}
                >
                  {t('zip.cancelar')}
                </BotaoSecundario>
              </div>
            </div>
          )}

          {enviando && (
            <p className="px-3 py-2 border-b border-[#DDE3DE] bg-[#1A4731]/5 text-[11px]
              text-[#1A4731] flex items-center gap-2 flex-shrink-0">
              <Loader2 size={13} className="animate-spin shrink-0" />
              {t('envio.enviando', {
                n: enviando.n,
                nome: rotuloPasta(enviando.destino),
              })}
            </p>
          )}

          {/* O fundo da arvore tambem e alvo: soltar aqui envia para a raiz. */}
          <div
            {...alvoDeSolta('')}
            className={`flex-1 min-h-0 overflow-auto py-1.5 px-1.5 transition ${
              sobreRaiz ? 'bg-[#F48126]/10 ring-2 ring-inset ring-[#F48126]' : ''
            }`}
          >
            {carregando ? (
              <div className="p-6"><Carregando rotulo={t('docs.carregando')} /></div>
            ) : erro ? (
              <div className="p-3">
                <AvisoDiscreto tom="vermelho" titulo={t('docs.erro')}>{erro}</AvisoDiscreto>
              </div>
            ) : (raiz ?? []).length === 0 ? (
              <div className="p-3">
                <EstadoVazio
                  compacto
                  icone={Inbox}
                  titulo={t('docs.vazioTitulo')}
                  texto={t('docs.vazioTexto')}
                />
              </div>
            ) : (
              <ul>{linhas(raiz, 0, '')}</ul>
            )}
          </div>

          {/* Barra de envio: diz PARA ONDE vai e abre o seletor de arquivos.
              Arrastar continua sendo o caminho principal; isto atende quem
              prefere clicar e quem usa teclado. */}
          <div className="border-t border-[#DDE3DE] p-2 flex-shrink-0 bg-[#F4F6F4]/50">
            <button
              type="button"
              disabled={Boolean(enviando)}
              onClick={() => refInput.current?.click()}
              className="w-full flex items-center gap-2 rounded-xl border border-dashed
                border-[#DDE3DE] bg-white px-3 py-2 text-[12px] text-[#5C7060]
                hover:border-[#1A4731]/40 hover:text-[#1A4731] transition
                disabled:opacity-60 disabled:cursor-not-allowed"
            >
              <UploadCloud size={15} className="shrink-0" />
              <span className="truncate">
                {t('envio.destino', { nome: rotuloPasta(pastaAtual) })}
              </span>
            </button>
            <input
              ref={refInput}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => {
                const itens = Array.from(e.target.files).map((arquivo) => ({
                  arquivo,
                  subPath: '',
                }));
                e.target.value = '';
                if (itens.length) enviarPara(itens, pastaAtual);
              }}
            />
          </div>
        </aside>

        {/* Coluna 2: visualizador */}
        <section
          className={`h-full min-h-0 ${selecionado ? 'flex' : 'hidden lg:flex'} flex-col bg-white`}
        >
          <Visualizador
            arquivo={arquivoAberto}
            projetoId={projetoId}
            emDemo={emDemo}
            tamanhoLegivel={fmtTamanho}
            aoVoltar={() => setSelecionado(null)}
          />
        </section>
      </div>
    </div>
  );
}

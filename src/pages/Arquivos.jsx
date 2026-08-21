import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import {
  Folder, FolderOpen, ChevronRight, ChevronDown, Download, Loader2, RefreshCw, LogOut,
  KeyRound, UploadCloud, FileText, FileSpreadsheet, Image as IconeImagem, Globe2,
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
 * Arquivos - explorador em duas colunas, com DUAS RAIZES.
 *
 * A arvore mostra, lado a lado:
 *
 *   Geral                 documentos que a APSIS publica para todos os clientes.
 *                         SOMENTE LEITURA: o cliente ve e baixa, nao envia.
 *   <Empresa do cliente>   a pasta do projeto dele, onde ele pode enviar.
 *
 * POR QUE DUAS RAIZES E NAO ABAS: sao dois lugares que a pessoa consulta na
 * mesma visita, e aba obriga a lembrar que a outra existe. No explorador do
 * Windows sao duas unidades na mesma lista, e e assim aqui.
 *
 * A Geral chega como um "projeto" reservado dentro do token de sessao (ver
 * carbon-ss-login), com somenteLeitura = true. Por isso listar, visualizar e
 * baixar funcionam sem nenhuma ramificacao: o que muda e so o que a tela
 * OFERECE. Quem realmente recusa o envio e o servidor, em carbon-ss-enviar.
 *
 * CHAVE DE ESTADO: `escopo::caminho`. Duas raizes podem ter pastas de mesmo
 * nome ("Documentos" na Geral e no projeto), e sem o prefixo de escopo as duas
 * compartilhariam o mesmo no da arvore - uma abriria o conteudo da outra.
 */

/* ===== Apoio ============================================================== */

const chaveDe = (escopo, caminho = '') => `${escopo}::${caminho}`;

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
// `webkitGetAsEntry` precisa ser chamado de forma SINCRONA no handler do drop:
// os DataTransferItem sao invalidados assim que o handler cede o controle, e um
// `await` antes disso faz a leitura devolver vazio, sem erro nenhum. Por isso a
// coleta e a travessia estao separadas.

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

function arrastandoArquivo(evento) {
  return Array.from(evento.dataTransfer?.types ?? []).includes('Files');
}

/* ===== Tela =============================================================== */

export default function Arquivos({ sessao, aoSair }) {
  const { t, idioma } = useIdioma();
  const fmtTamanho = criarFormatador(idioma);

  const escopos = sessao.projetos ?? [];

  const [raizes, setRaizes] = useState({});
  const [conteudo, setConteudo] = useState({});
  const [abertas, setAbertas] = useState(new Set());
  const [ocupadas, setOcupadas] = useState(new Set());
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState(null);
  const [selecionado, setSelecionado] = useState(null);

  // Onde o envio pelo BOTAO cai. O arrastar usa a pasta sob o cursor.
  const [pastaAtual, setPastaAtual] = useState(null);
  const [alvoSoltar, setAlvoSoltar] = useState(null);
  const [enviando, setEnviando] = useState(null);

  const [zip, setZip] = useState(null);
  const abortarZip = useRef(null);
  const refInput = useRef(null);

  const emDemo = MODO_DEMO && sessao.demo;

  /** Escopo gravavel padrao: o primeiro que nao seja somente leitura. */
  const escopoGravavel = escopos.find((e) => !e.somenteLeitura) ?? null;

  const carregarTudo = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    setConteudo({});
    setSelecionado(null);

    try {
      const respostas = await Promise.all(
        escopos.map((e) => listar(e.projeto_id, '').then((r) => [e.projeto_id, r.itens ?? []])),
      );
      setRaizes(Object.fromEntries(respostas));
      // Abre todas as raizes: sao duas, e deixar fechadas obrigaria dois cliques
      // so para ver que existe alguma coisa.
      setAbertas(new Set(escopos.map((e) => chaveDe(e.projeto_id))));
    } catch (e) {
      setErro(textoDoErro(t, e));
    } finally {
      setCarregando(false);
    }
    // escopos vem do token e nao muda durante a sessao; o eslint nao enxerga isso.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t]);

  useEffect(() => { carregarTudo(); }, [carregarTudo]);

  useEffect(() => {
    if (!pastaAtual && escopoGravavel) {
      setPastaAtual({ escopo: escopoGravavel.projeto_id, caminho: '' });
    }
  }, [pastaAtual, escopoGravavel]);

  /** Relê UMA pasta e a deixa aberta. Usado depois de um envio. */
  const recarregarPasta = useCallback(async (escopo, caminho) => {
    const r = await listar(escopo, caminho);
    if (!caminho) {
      setRaizes((a) => ({ ...a, [escopo]: r.itens ?? [] }));
    } else {
      setConteudo((a) => ({ ...a, [chaveDe(escopo, caminho)]: r.itens ?? [] }));
    }
    setAbertas((a) => new Set([...a, chaveDe(escopo, caminho)]));
  }, []);

  async function alternarPasta(escopo, caminho, gravavel) {
    const k = chaveDe(escopo, caminho);
    if (gravavel) setPastaAtual({ escopo, caminho });

    if (abertas.has(k)) {
      setAbertas((a) => { const n = new Set(a); n.delete(k); return n; });
      return;
    }
    setAbertas((a) => new Set([...a, k]));
    if (conteudo[k] !== undefined) return;

    setOcupadas((a) => new Set([...a, k]));
    try {
      const r = await listar(escopo, caminho);
      setConteudo((a) => ({ ...a, [k]: r.itens ?? [] }));
    } catch (e) {
      toast.error(t('pasta.naoAbriu', { nome: caminho.split('/').pop() }), {
        description: textoDoErro(t, e),
      });
      setAbertas((a) => { const n = new Set(a); n.delete(k); return n; });
    } finally {
      setOcupadas((a) => { const n = new Set(a); n.delete(k); return n; });
    }
  }

  /* ---- Envio ------------------------------------------------------------- */

  const rotuloDestino = (alvo) => {
    if (!alvo) return '';
    if (alvo.caminho) return alvo.caminho.split('/').pop();
    const escopo = escopos.find((e) => e.projeto_id === alvo.escopo);
    return escopo?.empresa ?? t('envio.paraRaiz');
  };

  async function enviarPara(itens, escopo, caminho) {
    if (!itens.length || enviando) return;

    setEnviando({ n: itens.length, destino: { escopo, caminho } });
    try {
      const r = await enviar(escopo, itens, { destino: caminho });

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
          description: r.renomeados?.length
            ? t('envio.renomeados', { n: r.renomeados.length })
            : undefined,
          duration: r.renomeados?.length ? 12000 : 5000,
        });
      }

      await recarregarPasta(escopo, caminho);
    } catch (e) {
      toast.error(t('envio.falhou'), { description: textoDoErro(t, e) });
    } finally {
      setEnviando(null);
    }
  }

  /**
   * Handlers de soltar. `gravavel` false devolve objeto vazio: a pasta deixa de
   * ser alvo, o cursor mostra "proibido" e nao ha destaque - a Geral nao aceita
   * envio, e a tela diz isso pelo gesto, nao por uma mensagem depois do erro.
   */
  function alvoDeSolta(escopo, caminho, gravavel) {
    if (!gravavel) return {};
    const k = chaveDe(escopo, caminho);
    return {
      onDragOver: (e) => {
        if (!arrastandoArquivo(e) || enviando) return;
        e.preventDefault();
        e.stopPropagation();
        setAlvoSoltar(k);
      },
      onDragLeave: (e) => {
        e.stopPropagation();
        setAlvoSoltar((a) => (a === k ? null : a));
      },
      onDrop: async (e) => {
        if (!arrastandoArquivo(e)) return;
        e.preventDefault();
        e.stopPropagation();
        setAlvoSoltar(null);
        const coletado = coletarDoEvento(e);
        const itens = await resolverSoltos(coletado);
        if (itens.length) enviarPara(itens, escopo, caminho);
        else toast.error(t('envio.falhou'));
      },
    };
  }

  /* ---- ZIP --------------------------------------------------------------- */

  async function baixarPasta(escopo, sub, rotulo) {
    if (zip) return;
    const controlador = new AbortController();
    abortarZip.current = controlador;
    setZip({ feitos: 0, total: 0, arquivo: '', rotulo });

    try {
      const r = await baixarPastaZip(
        escopo, sub, rotulo,
        (p) => setZip((atual) => (atual ? { ...atual, ...p } : atual)),
        controlador.signal,
      );

      if (controlador.signal.aborted) toast.info(t('zip.cancelado'));
      else if (r.total === 0) {
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

  async function baixarNoDemo(escopo, caminho, nome) {
    try {
      const resposta = await baixarBytes(escopo, caminho);
      const blob = await resposta.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
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

  function linhas(escopo, gravavel, itens, profundidade, pai) {
    return (itens ?? []).flatMap((item) => {
      const caminho = pai ? `${pai}/${item.nome}` : item.nome;
      const k = chaveDe(escopo, caminho);
      const recuo = 8 + profundidade * 14;

      if (item.tipo === 'pasta') {
        const aberta = abertas.has(k);
        const ocupada = ocupadas.has(k);
        const filhos = conteudo[k];
        const sobre = alvoSoltar === k;
        const ehAtual = pastaAtual?.escopo === escopo && pastaAtual?.caminho === caminho;

        const linha = (
          <li
            key={k}
            className={`group flex items-center rounded-md transition ${
              sobre ? 'bg-[#F48126]/15 ring-2 ring-inset ring-[#F48126]' : ''
            }`}
            {...alvoDeSolta(escopo, caminho, gravavel)}
          >
            <button
              type="button"
              onClick={() => alternarPasta(escopo, caminho, gravavel)}
              aria-expanded={aberta}
              style={{ paddingLeft: `${recuo}px` }}
              className={`flex items-center gap-1.5 flex-1 min-w-0 py-1.5 pr-2 text-left rounded-md transition ${
                sobre ? '' : ehAtual ? 'bg-[#F4F6F4]' : 'hover:bg-[#F4F6F4]'
              }`}
            >
              <span className="w-4 h-4 flex items-center justify-center shrink-0 text-[#8A9990]">
                {ocupada ? <Loader2 size={12} className="animate-spin" />
                  : aberta ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              </span>
              {sobre ? <FolderInput size={14} className="text-[#F48126] shrink-0" />
                : aberta ? <FolderOpen size={14} className="text-[#C98A2B] shrink-0" />
                : <Folder size={14} className="text-[#C98A2B] shrink-0" />}
              <span className={`text-[13px] truncate ${
                sobre ? 'text-[#8A5A12] font-semibold' : 'font-medium text-[#1A2B1F]'
              }`}>
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
              onClick={() => baixarPasta(escopo, caminho, item.nome)}
            />
          </li>
        );

        const filhosRender =
          aberta && filhos !== undefined
            ? filhos.length === 0
              ? [
                  <li key={`${k}::vazia`} style={{ paddingLeft: `${recuo + 32}px` }}
                    className="py-1.5 text-[12px] text-[#8A9990] italic">
                    {t('docs.pastaVazia')}
                  </li>,
                ]
              : linhas(escopo, gravavel, filhos, profundidade + 1, caminho)
            : [];

        return [linha, ...filhosRender];
      }

      const soVer = item.nivel === 'visualizar';
      const ativo = selecionado?.escopo === escopo && selecionado?.caminho === caminho;

      return [
        <li key={k} className="group flex items-center">
          <button
            type="button"
            aria-current={ativo ? 'true' : undefined}
            onClick={() => setSelecionado({ ...item, escopo, caminho })}
            style={{ paddingLeft: `${recuo + 18}px` }}
            className={`flex items-center gap-2 flex-1 min-w-0 py-1.5 pr-2 text-left rounded-md transition ${
              ativo ? 'bg-[#1A4731]/10 ring-1 ring-inset ring-[#1A4731]/25' : 'hover:bg-[#F4F6F4]'
            }`}
          >
            <IconeDoArquivo nome={item.nome} />
            <span className={`text-[13px] truncate ${
              ativo ? 'text-[#1A4731] font-medium' : 'text-[#1A2B1F]'
            }`}>
              {item.nome}
            </span>
            <span className="text-[10px] text-[#8A9990] ml-auto shrink-0 tabular-nums">
              {fmtTamanho(item.tamanho)}
            </span>
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
                ? { onClick: () => baixarNoDemo(escopo, caminho, item.nome) }
                : { como: 'externo', href: urlArquivo(escopo, caminho, 'download') })}
            />
          )}
        </li>,
      ];
    });
  }

  /** Um no de topo por escopo: a Geral e a pasta do projeto. */
  function raizDoEscopo(escopo) {
    const id = escopo.projeto_id;
    const gravavel = !escopo.somenteLeitura;
    const k = chaveDe(id);
    const aberta = abertas.has(k);
    const sobre = alvoSoltar === k;
    const itens = raizes[id];

    return (
      <li key={k} className="mb-1">
        <div
          className={`group flex items-center rounded-md transition ${
            sobre ? 'bg-[#F48126]/15 ring-2 ring-inset ring-[#F48126]' : ''
          }`}
          {...alvoDeSolta(id, '', gravavel)}
        >
          <button
            type="button"
            onClick={() => alternarPasta(id, '', gravavel)}
            aria-expanded={aberta}
            title={escopo.somenteLeitura ? t('geral.explica') : escopo.empresa}
            className="flex items-center gap-1.5 flex-1 min-w-0 py-1.5 px-2 text-left rounded-md
              hover:bg-[#F4F6F4] transition"
          >
            <span className="w-4 h-4 flex items-center justify-center shrink-0 text-[#8A9990]">
              {aberta ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            </span>
            {escopo.somenteLeitura
              ? <Globe2 size={15} className="text-[#1F4A6B] shrink-0" />
              : <FolderOpen size={15} className="text-[#1A4731] shrink-0" />}
            <span className="text-[13px] font-semibold text-[#1A2B1F] truncate">
              {escopo.empresa}
            </span>
            {escopo.somenteLeitura && (
              <Lock size={11} className="text-[#1F4A6B] shrink-0" aria-label={t('geral.explica')} />
            )}
          </button>

          <BotaoSecundario
            variante="fantasma"
            icone={FolderArchive}
            tamanho="sm"
            titulo={t('docs.baixarTudo')}
            rotuloAcessivel={t('docs.baixarTudo')}
            desabilitado={Boolean(zip) || !itens?.length}
            className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 shrink-0"
            onClick={() => baixarPasta(id, '', escopo.empresa)}
          />
        </div>

        {escopo.somenteLeitura && aberta && (
          <p className="text-[10px] text-[#5C7060] px-2 pl-9 pb-1 leading-snug">
            {t('geral.explica')}
          </p>
        )}

        {aberta && (
          itens === undefined ? (
            <div className="pl-9 py-2"><Carregando linha rotulo={t('docs.carregando')} /></div>
          ) : itens.length === 0 ? (
            <p className="pl-11 py-1.5 text-[12px] text-[#8A9990] italic">{t('docs.pastaVazia')}</p>
          ) : (
            <ul>{linhas(id, gravavel, itens, 1, '')}</ul>
          )
        )}
      </li>
    );
  }

  /* ---- Render ------------------------------------------------------------ */

  const arquivoAberto = selecionado
    ? {
        ...selecionado,
        aoBaixar: emDemo
          ? () => baixarNoDemo(selecionado.escopo, selecionado.caminho, selecionado.nome)
          : null,
      }
    : null;

  return (
    <div className="h-screen flex flex-col bg-[#F4F6F4] overflow-hidden">
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
      </header>

      {MODO_DEMO && sessao.demo && (
        <div className="bg-[#FDF3E3] border-b border-[#F2DDB4] flex-shrink-0">
          <p className="px-4 py-1.5 text-[11px] text-[#8A5A12] flex items-center gap-2">
            <FlaskConical size={13} className="shrink-0" aria-hidden="true" />
            {t('demo.faixa')}
          </p>
        </div>
      )}

      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[minmax(300px,32%)_1fr]">
        <aside
          className={`h-full min-h-0 flex-col border-r border-[#DDE3DE] bg-white ${
            selecionado ? 'hidden lg:flex' : 'flex'
          }`}
        >
          <div className="flex items-center gap-1 px-3 py-2 border-b border-[#DDE3DE] flex-shrink-0">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-[#8A9990] flex-1">
              {t('visual.arquivos')}
            </p>
            <BotaoSecundario
              variante="fantasma"
              icone={RefreshCw}
              tamanho="sm"
              carregando={carregando}
              titulo={t('docs.atualizar')}
              rotuloAcessivel={t('docs.atualizar')}
              onClick={carregarTudo}
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
                <BotaoSecundario variante="perigo" tamanho="sm"
                  onClick={() => abortarZip.current?.abort()}>
                  {t('zip.cancelar')}
                </BotaoSecundario>
              </div>
            </div>
          )}

          {enviando && (
            <p className="px-3 py-2 border-b border-[#DDE3DE] bg-[#1A4731]/5 text-[11px]
              text-[#1A4731] flex items-center gap-2 flex-shrink-0">
              <Loader2 size={13} className="animate-spin shrink-0" />
              {t('envio.enviando', { n: enviando.n, nome: rotuloDestino(enviando.destino) })}
            </p>
          )}

          <div className="flex-1 min-h-0 overflow-auto py-1.5 px-1.5">
            {carregando ? (
              <div className="p-6"><Carregando rotulo={t('docs.carregando')} /></div>
            ) : erro ? (
              <div className="p-3">
                <AvisoDiscreto tom="vermelho" titulo={t('docs.erro')}>{erro}</AvisoDiscreto>
              </div>
            ) : escopos.length === 0 ? (
              <div className="p-3">
                <EstadoVazio compacto icone={Inbox}
                  titulo={t('docs.vazioTitulo')} texto={t('docs.vazioTexto')} />
              </div>
            ) : (
              <ul>{escopos.map(raizDoEscopo)}</ul>
            )}
          </div>

          {/* O envio so existe se houver alguma pasta gravavel. Um cliente que so
              tivesse a Geral nao veria uma barra que nunca funcionaria. */}
          {escopoGravavel && (
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
                  {t('envio.destino', { nome: rotuloDestino(pastaAtual) })}
                </span>
              </button>
              <input
                ref={refInput}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => {
                  const itens = Array.from(e.target.files).map((arquivo) => ({
                    arquivo, subPath: '',
                  }));
                  e.target.value = '';
                  const alvo = pastaAtual ?? { escopo: escopoGravavel.projeto_id, caminho: '' };
                  if (itens.length) enviarPara(itens, alvo.escopo, alvo.caminho);
                }}
              />
            </div>
          )}
        </aside>

        <section
          className={`h-full min-h-0 ${selecionado ? 'flex' : 'hidden lg:flex'} flex-col bg-white`}
        >
          <Visualizador
            arquivo={arquivoAberto}
            projetoId={selecionado?.escopo}
            emDemo={emDemo}
            tamanhoLegivel={fmtTamanho}
            aoVoltar={() => setSelecionado(null)}
          />
        </section>
      </div>
    </div>
  );
}

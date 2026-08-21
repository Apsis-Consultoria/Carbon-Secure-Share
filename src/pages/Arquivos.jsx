import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import {
  Folder, ChevronRight, ChevronDown, Download, Eye, Loader2, RefreshCw, LogOut,
  KeyRound, UploadCloud, X, FileText, FileSpreadsheet, Image as IconeImagem,
  File as IconeArquivo, FolderArchive, Lock, Inbox, FlaskConical,
} from 'lucide-react';

import { listar, enviar, urlArquivo, baixarBytes } from '@/lib/api';
import { baixarPastaZip } from '@/lib/pastaZip';
import { MODO_DEMO } from '@/lib/demo';
import { useIdioma, textoDoErro } from '@/lib/i18n';
import SeletorIdioma from '@/components/SeletorIdioma';
import Cartao from '@/components/ui/Cartao';
import Badge from '@/components/ui/Badge';
import Carregando from '@/components/ui/Carregando';
import EstadoVazio from '@/components/ui/EstadoVazio';
import AvisoDiscreto from '@/components/ui/AvisoDiscreto';
import BarraProgresso from '@/components/ui/BarraProgresso';
import BotaoPrimario from '@/components/ui/BotaoPrimario';
import BotaoSecundario from '@/components/ui/BotaoSecundario';

/* ===== Apoio ============================================================== */

/**
 * Tamanho legivel. O separador decimal acompanha o idioma: em ingles "4.0 MB",
 * em portugues "4,0 MB". Numero formatado no idioma errado e o tipo de detalhe
 * que faz a traducao parecer inacabada.
 */
function tamanhoLegivel(bytes, idioma) {
  if (bytes === null || bytes === undefined) return '';
  const local = idioma === 'pt' ? 'pt-BR' : 'en-US';
  const fmt = (n, casas) => n.toLocaleString(local, {
    minimumFractionDigits: casas,
    maximumFractionDigits: casas,
  });

  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${fmt(bytes / 1024, 1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${fmt(bytes / (1024 * 1024), 1)} MB`;
  return `${fmt(bytes / (1024 * 1024 * 1024), 2)} GB`;
}

function IconeDoArquivo({ nome }) {
  const ext = String(nome ?? '').split('.').pop().toLowerCase();
  if (ext === 'pdf') return <FileText size={15} className="text-[#B4453C] shrink-0" />;
  if (['xls', 'xlsx', 'xlsb', 'csv'].includes(ext)) {
    return <FileSpreadsheet size={15} className="text-[#2F8F5B] shrink-0" />;
  }
  if (['doc', 'docx'].includes(ext)) return <FileText size={15} className="text-[#1F4A6B] shrink-0" />;
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext)) {
    return <IconeImagem size={15} className="text-[#7A4FA3] shrink-0" />;
  }
  return <IconeArquivo size={15} className="text-[#8A9990] shrink-0" />;
}

// Formatos que abrem no navegador. O restante nao ganha botao de visualizar: um
// "Visualizar" que dispara download confunde mais do que ajuda.
const VISUALIZAVEIS = new Set([
  'pdf', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'txt',
  'doc', 'docx', 'xls', 'xlsx', 'csv', 'ppt', 'pptx',
]);

function podeVisualizar(nome) {
  return VISUALIZAVEIS.has(String(nome ?? '').split('.').pop().toLowerCase());
}

/* ===== Tela =============================================================== */

export default function Arquivos({ sessao, aoSair }) {
  const { t, idioma } = useIdioma();

  const projetos = sessao.projetos ?? [];
  const [projetoId, setProjetoId] = useState(projetos[0]?.projeto_id ?? '');
  const projeto = projetos.find((p) => p.projeto_id === projetoId) ?? projetos[0];

  const [raiz, setRaiz] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState(null);
  const [conteudo, setConteudo] = useState({});
  const [abertas, setAbertas] = useState(new Set());
  const [ocupadas, setOcupadas] = useState(new Set());

  const [zip, setZip] = useState(null);
  const abortarZip = useRef(null);

  const carregarRaiz = useCallback(async () => {
    if (!projetoId) return;
    setCarregando(true);
    setErro(null);
    setConteudo({});
    setAbertas(new Set());
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

  async function alternarPasta(caminho) {
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
          description: r.ignorados
            ? t('zip.somenteVisualizacao', { n: r.ignorados })
            : undefined,
        });
      } else {
        // Nunca deixamos a ausência silenciosa: quem baixou precisa saber que o
        // ZIP não tem tudo que aparece na tela.
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

  /* ---- Abrir arquivo no modo demonstracao -------------------------------- */

  /**
   * Em demonstracao nao existe backend, entao o href real (/api/carbon-ss-baixar)
   * daria 404 e o botao pareceria quebrado. Aqui montamos um blob com o conteudo
   * ficticio e entregamos por ele, para o fluxo de abrir e baixar poder ser
   * revisado de ponta a ponta.
   */
  async function abrirNoDemo(caminho, nome, modo) {
    try {
      const resposta = await baixarBytes(projetoId, caminho);
      const blob = await resposta.blob();
      const url = URL.createObjectURL(blob);

      if (modo === 'preview') {
        window.open(url, '_blank', 'noopener');
      } else {
        const link = document.createElement('a');
        link.href = url;
        // .txt porque o conteudo e texto: baixar como .pdf um arquivo que nao e
        // PDF faria o leitor de PDF acusar corrupcao e parecer defeito nosso.
        link.download = `${nome}.txt`;
        document.body.appendChild(link);
        link.click();
        link.remove();
      }

      setTimeout(() => URL.revokeObjectURL(url), 10000);
      toast.info(t('demo.arquivoAviso'));
    } catch (e) {
      toast.error(textoDoErro(t, e));
    }
  }

  const emDemo = MODO_DEMO && sessao.demo;

  /* ---- Árvore ------------------------------------------------------------ */

  function linhas(itens, profundidade, pai) {
    return (itens ?? []).flatMap((item) => {
      const caminho = pai ? `${pai}/${item.nome}` : item.nome;
      const recuo = profundidade * 16;
      const soVer = item.nivel === 'visualizar';

      if (item.tipo === 'pasta') {
        const aberta = abertas.has(caminho);
        const ocupada = ocupadas.has(caminho);
        const filhos = conteudo[caminho];

        const linha = (
          <li
            key={caminho}
            style={{ paddingLeft: `${recuo}px` }}
            className="flex items-center gap-2 px-3 py-2.5 border-b border-[#F4F6F4] hover:bg-[#F4F6F4] transition"
          >
            <button
              type="button"
              onClick={() => alternarPasta(caminho)}
              className="flex items-center gap-2 flex-1 min-w-0 text-left"
              aria-expanded={aberta}
            >
              <span className="w-4 h-4 flex items-center justify-center shrink-0 text-[#8A9990]">
                {ocupada ? <Loader2 size={13} className="animate-spin" />
                  : aberta ? <ChevronDown size={14} />
                  : <ChevronRight size={14} />}
              </span>
              <Folder size={15} className="text-[#C98A2B] shrink-0" />
              <span className="text-sm font-medium text-[#1A2B1F] truncate">{item.nome}</span>
            </button>

            <BotaoSecundario
              icone={FolderArchive}
              tamanho="sm"
              titulo={t('docs.baixarPasta')}
              rotuloAcessivel={t('docs.baixarPastaItem', { nome: item.nome })}
              desabilitado={Boolean(zip)}
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
                    style={{ paddingLeft: `${recuo + 36}px` }}
                    className="py-2 px-3 text-xs text-[#8A9990] italic border-b border-[#F4F6F4]"
                  >
                    {t('docs.pastaVazia')}
                  </li>,
                ]
              : linhas(filhos, profundidade + 1, caminho)
            : [];

        return [linha, ...filhosRender];
      }

      return [
        <li
          key={caminho}
          style={{ paddingLeft: `${recuo}px` }}
          className="flex items-center gap-3 px-3 py-2.5 border-b border-[#F4F6F4] hover:bg-[#F4F6F4] transition"
        >
          <span className="w-4 shrink-0" />
          <IconeDoArquivo nome={item.nome} />

          <div className="flex-1 min-w-0">
            <p className="text-sm text-[#1A2B1F] truncate">{item.nome}</p>
            <p className="text-[11px] text-[#8A9990]">{tamanhoLegivel(item.tamanho, idioma)}</p>
          </div>

          {soVer && (
            <Badge tom="azul" tamanho="sm" icone={Lock}>
              {t('docs.soVisualizar')}
            </Badge>
          )}

          {podeVisualizar(item.nome) && (
            <BotaoSecundario
              {...(emDemo
                ? { onClick: () => abrirNoDemo(caminho, item.nome, 'preview') }
                : { como: 'externo', href: urlArquivo(projetoId, caminho, 'preview') })}
              icone={Eye}
              tamanho="sm"
              titulo={t('docs.visualizar')}
              rotuloAcessivel={t('docs.visualizarItem', { nome: item.nome })}
            />
          )}

          {/* Sem botão de baixar quando é "só visualizar": o servidor devolveria
              403 de qualquer forma, e oferecer um botão que sempre falha é pior
              do que não oferecer. */}
          {!soVer && (
            <BotaoSecundario
              {...(emDemo
                ? { onClick: () => abrirNoDemo(caminho, item.nome, 'download') }
                : { como: 'externo', href: urlArquivo(projetoId, caminho, 'download') })}
              icone={Download}
              tamanho="sm"
              titulo={t('docs.baixar')}
              rotuloAcessivel={t('docs.baixarItem', { nome: item.nome })}
            />
          )}
        </li>,
      ];
    });
  }

  /* ---- Render ------------------------------------------------------------ */

  return (
    <div className="min-h-screen bg-[#F4F6F4]">
      <header className="bg-[#1A4731] text-white">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center gap-3 flex-wrap">
          <img
            src="/login/logo-apsis-carbon.png"
            alt="APSIS Carbon"
            className="h-8 w-auto"
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
            <KeyRound size={13} /> {t('nav.trocarSenha')}
          </Link>

          <button
            type="button"
            onClick={aoSair}
            className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg
              border border-white/25 hover:bg-white/10 transition"
          >
            <LogOut size={13} /> {t('nav.sair')}
          </button>
        </div>
      </header>

      {/* Faixa de demonstracao. Fica no topo, larga e amarela, de proposito: sem
          ela e facil olhar a tela e achar que os documentos sao reais. Some do
          build de producao junto com o resto do modo demonstracao. */}
      {MODO_DEMO && sessao.demo && (
        <div className="bg-[#FDF3E3] border-b border-[#F2DDB4]">
          <p className="max-w-4xl mx-auto px-4 py-2 text-[12px] text-[#8A5A12] flex items-center gap-2">
            <FlaskConical size={14} className="shrink-0" aria-hidden="true" />
            {t('demo.faixa')}
          </p>
        </div>
      )}

      <main className="max-w-4xl mx-auto px-4 py-6 space-y-5">
        {/* Seletor de projeto: só aparece com mais de um. A mesma pessoa pode
            ser cliente de vários projetos de carbono. */}
        {projetos.length > 1 && (
          <div className="flex items-center gap-2 flex-wrap">
            {projetos.map((p) => (
              <button
                key={p.projeto_id}
                type="button"
                onClick={() => setProjetoId(p.projeto_id)}
                className={`text-sm font-medium px-3.5 py-1.5 rounded-xl transition ${
                  p.projeto_id === projetoId
                    ? 'bg-[#1A4731] text-white'
                    : 'bg-white border border-[#DDE3DE] text-[#5C7060] hover:border-[#1A4731]/40'
                }`}
              >
                {p.ap_os ? `${p.ap_os} · ` : ''}{p.empresa}
              </button>
            ))}
          </div>
        )}

        {zip && (
          <Cartao
            icone={FolderArchive}
            titulo={t('zip.montando', { nome: zip.rotulo })}
            tomIcone="laranja"
          >
            <BarraProgresso
              valor={zip.total ? (zip.feitos / zip.total) * 100 : 0}
              rotulo={zip.arquivo || t('zip.preparando')}
              detalhe={zip.total ? `${zip.feitos}/${zip.total}` : ''}
              mostrarValor
            />
            <p className="text-[11px] text-[#8A9990] mt-2">{t('zip.aviso')}</p>
            <BotaoSecundario
              variante="perigo"
              tamanho="sm"
              className="mt-3"
              onClick={() => abortarZip.current?.abort()}
            >
              {t('zip.cancelar')}
            </BotaoSecundario>
          </Cartao>
        )}

        <Envio projetoId={projetoId} aoTerminar={carregarRaiz} />

        <Cartao
          icone={Folder}
          titulo={projeto?.empresa ?? t('docs.titulo')}
          subtitulo={projeto?.ap_os ? t('docs.apOs', { ap_os: projeto.ap_os }) : t('docs.subtitulo')}
          semPaddingCorpo
          acao={
            <div className="flex items-center gap-2">
              <BotaoSecundario
                icone={FolderArchive}
                tamanho="sm"
                desabilitado={Boolean(zip) || !raiz?.length}
                onClick={() => baixarPasta('', projeto?.empresa ?? 'documents')}
              >
                {t('docs.baixarTudo')}
              </BotaoSecundario>
              <BotaoSecundario
                icone={RefreshCw}
                tamanho="sm"
                carregando={carregando}
                onClick={carregarRaiz}
                rotuloAcessivel={t('docs.atualizar')}
              />
            </div>
          }
        >
          {carregando ? (
            <div className="p-8"><Carregando rotulo={t('docs.carregando')} /></div>
          ) : erro ? (
            <div className="p-5">
              <AvisoDiscreto tom="vermelho" titulo={t('docs.erro')}>
                {erro}
              </AvisoDiscreto>
            </div>
          ) : (raiz ?? []).length === 0 ? (
            <div className="p-5">
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
        </Cartao>

        <p className="text-[11px] text-[#8A9990] text-center leading-relaxed pb-4">
          {t('docs.rodapeMarca')}
        </p>
      </main>
    </div>
  );
}

/* ===== Envio pelo cliente ================================================= */

function Envio({ projetoId, aoTerminar }) {
  const { t, idioma } = useIdioma();

  const [fila, setFila] = useState([]);
  const [arrastando, setArrastando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const refInput = useRef(null);

  function acrescentar(itens) {
    setFila((atual) => {
      const proxima = [...atual];
      for (const item of itens) {
        const repetido = proxima.some(
          (x) => x.arquivo.name === item.arquivo.name && x.arquivo.size === item.arquivo.size,
        );
        if (!repetido) proxima.push(item);
      }
      return proxima;
    });
  }

  async function despachar() {
    if (!fila.length || enviando) return;
    setEnviando(true);
    try {
      const r = await enviar(projetoId, fila);
      setFila([]);

      if (r.falhas?.length) {
        toast.warning(
          t('envio.parcial', { enviados: r.enviados.length, falhas: r.falhas.length }),
          {
            description: r.falhas.map((f) => `${f.arquivo}: ${f.motivo}`).join(' | '),
            duration: 12000,
          },
        );
      } else {
        toast.success(t('envio.sucesso', { n: r.enviados.length }));
      }
      aoTerminar?.();
    } catch (e) {
      toast.error(t('envio.falhou'), { description: textoDoErro(t, e) });
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Cartao
      icone={UploadCloud}
      titulo={t('envio.titulo')}
      subtitulo={t('envio.subtitulo')}
      tomIcone="laranja"
    >
      <div className="space-y-3">
        <div
          onDragOver={(e) => { e.preventDefault(); setArrastando(true); }}
          onDragLeave={() => setArrastando(false)}
          onDrop={(e) => {
            e.preventDefault();
            setArrastando(false);
            const arquivos = Array.from(e.dataTransfer.files ?? []);
            if (arquivos.length) acrescentar(arquivos.map((arquivo) => ({ arquivo, subPath: '' })));
          }}
          onClick={() => !enviando && refInput.current?.click()}
          className={`flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed
            px-6 py-8 cursor-pointer select-none transition ${
              arrastando
                ? 'border-[#1A4731] bg-[#1A4731]/5'
                : 'border-[#DDE3DE] bg-white hover:border-[#1A4731]/40 hover:bg-[#F4F6F4]'
            }`}
        >
          <UploadCloud size={26} className={arrastando ? 'text-[#1A4731]' : 'text-[#8A9990]'} />
          <p className="text-sm text-[#1A2B1F] font-medium">
            {arrastando ? t('envio.solte') : t('envio.arraste')}
          </p>
          <input
            ref={refInput}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              acrescentar(Array.from(e.target.files).map((arquivo) => ({ arquivo, subPath: '' })));
              e.target.value = '';
            }}
          />
        </div>

        {fila.length > 0 && (
          <>
            <ul className="space-y-1.5 max-h-48 overflow-y-auto">
              {fila.map(({ arquivo }, i) => (
                <li
                  key={`${arquivo.name}-${i}`}
                  className="flex items-center gap-3 px-3 py-2 rounded-xl bg-[#F4F6F4]"
                >
                  <IconeDoArquivo nome={arquivo.name} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-[#1A2B1F] truncate">{arquivo.name}</p>
                    <p className="text-[11px] text-[#8A9990]">
                      {tamanhoLegivel(arquivo.size, idioma)}
                    </p>
                  </div>
                  <BotaoSecundario
                    variante="fantasma"
                    icone={X}
                    tamanho="sm"
                    rotuloAcessivel={t('envio.remover', { nome: arquivo.name })}
                    onClick={() => setFila((a) => a.filter((_, j) => j !== i))}
                  />
                </li>
              ))}
            </ul>

            <BotaoPrimario
              larguraTotal
              icone={UploadCloud}
              carregando={enviando}
              onClick={despachar}
            >
              {t('envio.enviar', { n: fila.length })}
            </BotaoPrimario>
          </>
        )}
      </div>
    </Cartao>
  );
}

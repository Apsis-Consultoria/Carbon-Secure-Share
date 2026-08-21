/**
 * demo - dados ficticios para revisar as telas sem backend.
 *
 * ------------------------------------------------------------------------
 * SEM VARIAVEL DE AMBIENTE
 * ------------------------------------------------------------------------
 * O gatilho e `import.meta.env.DEV`, que NAO e configuracao nossa: e uma
 * constante que o proprio Vite substitui em tempo de build (true em `vite dev`,
 * false em `vite build`). Nao ha `.env`, nao ha `VITE_*`, e nao ha nada para
 * ninguem preencher.
 *
 * Consequencias, as duas desejadas:
 *   1. o botao de demonstracao NAO EXISTE no build publicado. Nao e escondido
 *      por CSS nem protegido por senha: o ramo inteiro e removido;
 *   2. `if (MODO_DEMO)` vira `if (false)` e o Rollup elimina as chamadas junto
 *      com este modulo. O dataset ficticio nao chega ao bundle de producao.
 *
 * ------------------------------------------------------------------------
 * O TOPO DESTE MODULO PRECISA SER PURO (nao mexa sem medir o bundle)
 * ------------------------------------------------------------------------
 * Nada de chamada de funcao em inicializador de topo. O Rollup nao consegue
 * provar que uma chamada e pura, marca o modulo como tendo efeito colateral e o
 * mantem no bundle MESMO com todos os `if (MODO_DEMO)` dobrados para false.
 * Isso ja aconteceu no repositorio irmao. Por isso o estado nasce dentro de
 * `bd()`, na primeira leitura, e o topo tem apenas declaracoes e `let estado = null`.
 *
 * LGPD: tudo aqui e inventado. Nenhum cliente real, nenhuma pessoa real. Os
 * e-mails usam `example.com`, reservado para documentacao pela RFC 2606,
 * justamente para nao existir a chance de alcancar uma caixa de verdade.
 */

/** Liga o modo demonstracao. Ver o cabecalho: constante de build, nao config. */
export const MODO_DEMO = import.meta.env.DEV;

/* ===== Sessao ficticia ==================================================== */

function b64url(objeto) {
  const json = JSON.stringify(objeto);
  const bytes = new TextEncoder().encode(json);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Token com a MESMA forma do real (payload base64url + ponto + assinatura).
 *
 * A assinatura e a palavra "demo" e nao passaria em verificacao nenhuma - o que
 * importa e que o `exp` seja legivel, porque `lerSessao()` conta com ele para
 * expirar a sessao. Um token de formato diferente faria a tela seguir um caminho
 * que a producao nunca segue, e a revisao deixaria de valer.
 */
function tokenFalso() {
  const agora = Math.floor(Date.now() / 1000);
  return `${b64url({ email: 'demo@example.com', exp: agora + 60 * 60 * 8 })}.demo`;
}

/* ===== Estado ============================================================= */

let estado = null;

function criarEstado() {
  const projetos = [
    {
      projeto_id: 'demo-projeto-1',
      empresa: 'Example Reforestation Ltd.',
      ap_os: 'AP-10001/26-001',
      pasta: 'AP-10001-26-001 - Example Reforestation Ltd.',
    },
    {
      projeto_id: 'demo-projeto-2',
      empresa: 'Example Valley Cooperative',
      ap_os: null,
      pasta: 'Example Valley Cooperative',
    },
  ];

  /**
   * Arvore por projeto. Chave '' e a raiz.
   *
   * O `nivel` de cada item cobre os tres estados de proposito, para a revisao
   * visual exercitar todos: 'total' (ve e baixa), 'visualizar' (ve, nao baixa,
   * fica fora do ZIP) e o 'nenhum', que na producao NAO chega ao cliente - o
   * servidor filtra antes. Por isso ele nao aparece aqui.
   */
  const arvore = {
    'demo-projeto-1': {
      '': [
        { nome: 'Project documents', tipo: 'pasta', tamanho: null, nivel: 'total' },
        { nome: 'Monitoring report 2025.pdf', tipo: 'arquivo', tamanho: 4215330, nivel: 'total' },
        { nome: 'Emissions worksheet.xlsx', tipo: 'arquivo', tamanho: 812004, nivel: 'total' },
        { nome: 'Draft valuation.pdf', tipo: 'arquivo', tamanho: 1204880, nivel: 'visualizar' },
      ],
      'Project documents': [
        { nome: 'Attachments', tipo: 'pasta', tamanho: null, nivel: 'total' },
        { nome: 'PDD version 3.docx', tipo: 'arquivo', tamanho: 1540992, nivel: 'total' },
      ],
      'Project documents/Attachments': [
        { nome: 'Area map.png', tipo: 'arquivo', tamanho: 3004112, nivel: 'total' },
        { nome: 'Field survey.pdf', tipo: 'arquivo', tamanho: 655360, nivel: 'total' },
      ],
    },
    // Projeto vazio: exercita o estado vazio da tela, que e facil de esquecer.
    'demo-projeto-2': { '': [] },
  };

  return { projetos, arvore };
}

function bd() {
  if (!estado) estado = criarEstado();
  return estado;
}

/** Pequeno atraso, para a revisao ver os estados de carregamento de verdade. */
function esperar(ms = 260) {
  return new Promise((r) => setTimeout(r, ms));
}

/* ===== Operacoes ========================================================== */

export async function demoEntrar() {
  await esperar(420);
  return {
    token: tokenFalso(),
    projetos: bd().projetos,
    nome: 'Demo User',
  };
}

export async function demoListar(projetoId, sub = '') {
  await esperar();
  const doProjeto = bd().arvore[projetoId] || { '': [] };
  const itens = (doProjeto[sub] || []).map((item) => ({
    ...item,
    caminho: sub ? `${sub}/${item.nome}` : item.nome,
    atualizadoEm: null,
  }));
  return { itens, caminho: sub };
}

/** Manifesto do ZIP: so o que tem nivel 'total', igual a regra do servidor. */
export async function demoArvore(projetoId, sub = '') {
  await esperar();
  const doProjeto = bd().arvore[projetoId] || { '': [] };

  const arquivos = [];
  let ignorados = 0;

  const percorrer = (relativo) => {
    for (const item of doProjeto[relativo] || []) {
      const caminho = relativo ? `${relativo}/${item.nome}` : item.nome;
      if (item.tipo === 'pasta') {
        percorrer(caminho);
        continue;
      }
      if (item.nivel === 'visualizar') {
        ignorados += 1;
        continue;
      }
      arquivos.push({ caminho, nome: item.nome, tamanho: item.tamanho ?? 0 });
    }
  };
  percorrer(sub);

  return {
    arquivos,
    total: arquivos.length,
    bytes: arquivos.reduce((s, a) => s + a.tamanho, 0),
    ignorados,
    truncado: false,
  };
}

/**
 * Conteudo ficticio de um arquivo, como Response.
 *
 * Devolvemos um texto curto explicando que e demonstracao, e nao os bytes
 * verdadeiros que o nome promete. E o suficiente para o download de pasta em
 * ZIP funcionar de ponta a ponta na revisao: o client-zip recebe um Response de
 * verdade, a barra de progresso anda e o arquivo baixa.
 */
export async function demoBaixar(projetoId, caminho) {
  await esperar(180);
  const corpo =
    `Secure Share Carbon - demonstration file\n\n` +
    `Path: ${caminho}\n` +
    `Project: ${projetoId}\n\n` +
    `This is placeholder content. In production this response carries the real\n` +
    `bytes from SharePoint, and PDFs are watermarked with the identity of the\n` +
    `person who opened them.\n`;
  return new Response(corpo, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}

export async function demoEnviar(_projetoId, itens) {
  await esperar(700);
  return {
    status: 200,
    enviados: itens.map(({ arquivo }) => arquivo.name),
    falhas: [],
    pasta: 'Sent by client',
  };
}

export async function demoTrocarSenha() {
  await esperar(500);
  return { trocada: true };
}

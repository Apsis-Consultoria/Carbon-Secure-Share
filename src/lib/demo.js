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
    // A Geral entra como projeto reservado e somente leitura, igual ao que a
    // Edge Function de login faz em producao.
    {
      projeto_id: 'geral',
      empresa: 'Geral',
      ap_os: null,
      pasta: 'Geral',
      somenteLeitura: true,
    },
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
        { nome: 'Aerial view.png', tipo: 'arquivo', tamanho: 2280104, nivel: 'total' },
        { nome: 'Field notes.txt', tipo: 'arquivo', tamanho: 4210, nivel: 'total' },
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
    geral: {
      '': [
        { nome: 'Metodologias', tipo: 'pasta', tamanho: null, nivel: 'total' },
        { nome: 'APSIS Carbon - institucional.pdf', tipo: 'arquivo', tamanho: 1820400, nivel: 'total' },
        { nome: 'Glossario do mercado de carbono.pdf', tipo: 'arquivo', tamanho: 640210, nivel: 'total' },
      ],
      Metodologias: [
        { nome: 'VM0007 REDD+.pdf', tipo: 'arquivo', tamanho: 3120044, nivel: 'total' },
        { nome: 'VCS Standard v4.pdf', tipo: 'arquivo', tamanho: 2410880, nivel: 'total' },
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

/**
 * A sessao ficticia, num lugar so.
 *
 * Os dois caminhos de entrada da demonstracao (o botao direto e o fluxo de
 * codigo) precisam produzir EXATAMENTE a mesma sessao. Duas construcoes
 * divergiriam, e a divergencia apareceria como um projeto que existe entrando
 * por um botao e some entrando pelo outro.
 */
function sessaoFicticia() {
  return {
    token: tokenFalso(),
    projetos: bd().projetos,
    nome: 'Demo User',
  };
}

export async function demoEntrar() {
  await esperar(420);
  return sessaoFicticia();
}

/**
 * Codigo ficticio do fluxo de demonstracao.
 *
 * DERIVADO de `digitos`, e nao um literal: a quantidade de digitos e uma
 * constante do protocolo (DIGITOS_CODIGO em src/lib/api.js) e pode mudar. Com um
 * literal de 6, o dia em que ela virasse 8 deixaria a demonstracao impossivel de
 * concluir, e o sintoma seria "codigo invalido" sem causa aparente.
 *
 * O numero vem daqui e nao de um sorteio para a revisao ser repetivel, e a tela
 * o exibe em desenvolvimento. Nao ha segredo nenhum nisto: este modulo inteiro e
 * removido do bundle publicado, e nao existe verificacao de verdade por tras.
 */
function codigoFicticio(digitos) {
  const seq = '1234567890';
  let saida = '';
  while (saida.length < digitos) saida += seq;
  return saida.slice(0, digitos);
}

/**
 * Etapa 1 em demonstracao.
 *
 * O atraso ESPELHA o piso de tempo do servidor (PISO_CODIGO_MS, 1500 ms), que
 * existe para o tempo de resposta nao denunciar se o endereco tem cadastro. Um
 * atraso curto aqui faria a revisao aprovar uma tela que na producao passa mais
 * de um segundo parada, que e justamente o estado dificil de acertar.
 */
export async function demoPedirCodigo(email, digitos) {
  await esperar(1500);
  return { enviado: true, minutos: 10, codigo: codigoFicticio(digitos) };
}

/**
 * Etapa 2 em demonstracao. Atraso espelhando PISO_ENTRAR_MS (400 ms).
 *
 * O codigo errado precisa FALHAR: sem isso a revisao nunca ve a mensagem de erro
 * da etapa 2, que e a que mais aparece na vida real. O erro carrega `codigo`
 * porque e assim que textoDoErro() traduz - mesma forma do erro de demoEnviar().
 */
export async function demoEntrarComCodigo(email, codigo, digitos) {
  await esperar(400);

  if (String(codigo) !== codigoFicticio(digitos)) {
    const e = new Error('codigo_invalido');
    e.codigo = 'codigo_invalido';
    throw e;
  }

  return sessaoFicticia();
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

  const nome = caminho.split('/').pop() || 'file';
  const ext = nome.split('.').pop().toLowerCase();

  // Para os nomes de imagem devolvemos uma IMAGEM de verdade, e nao texto: sem
  // isso o painel de visualizacao nao poderia ser revisado justamente no caso
  // que ele existe para resolver. SVG serve porque o visualizador exibe imagem
  // dentro de <img>, onde o navegador desliga script.
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'avif', 'svg'].includes(ext)) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="620" viewBox="0 0 900 620">
  <defs>
    <linearGradient id="ceu" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#CFE6D8"/><stop offset="1" stop-color="#F4F6F4"/>
    </linearGradient>
  </defs>
  <rect width="900" height="620" fill="url(#ceu)"/>
  <path d="M0 430 L150 300 L300 430 Z" fill="#1A4731" opacity=".85"/>
  <path d="M180 460 L360 270 L540 460 Z" fill="#245E40" opacity=".9"/>
  <path d="M430 470 L640 300 L850 470 Z" fill="#1A4731" opacity=".8"/>
  <rect y="460" width="900" height="160" fill="#0E241A"/>
  <circle cx="740" cy="130" r="52" fill="#F48126" opacity=".9"/>
  <text x="450" y="545" font-family="Segoe UI, sans-serif" font-size="26" font-weight="700"
        fill="#FFFFFF" text-anchor="middle">${nome}</text>
  <text x="450" y="580" font-family="Segoe UI, sans-serif" font-size="15"
        fill="#9FBCAB" text-anchor="middle">Demonstration image - not a real document</text>
</svg>`;
    return new Response(svg, { headers: { 'Content-Type': 'image/svg+xml' } });
  }

  const corpo =
    `Secure Share Carbon - demonstration file\n\n` +
    `File:    ${nome}\n` +
    `Path:    ${caminho}\n` +
    `Project: ${projetoId}\n\n` +
    `This is placeholder content. In production this response carries the real\n` +
    `bytes from SharePoint, and PDFs are watermarked with the identity of the\n` +
    `person who opened them.\n`;
  return new Response(corpo, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}

/**
 * Envio em demonstracao. Nada sai do navegador, mas os arquivos ENTRAM na arvore
 * ficticia, na pasta de destino: sem isso o arrastar-e-soltar nao poderia ser
 * revisado, porque a tela recarregaria a lista e o arquivo nao estaria la.
 */
export async function demoEnviar(projetoId, itens, destino = '') {
  await esperar(700);

  // Espelha a recusa do servidor: a Geral e somente leitura para o cliente.
  if (projetoId === 'geral') {
    const e = new Error('pasta_somente_leitura');
    e.codigo = 'pasta_somente_leitura';
    throw e;
  }

  const doProjeto = bd().arvore[projetoId];
  if (doProjeto) {
    const chave = destino || '';
    if (!doProjeto[chave]) doProjeto[chave] = [];
    for (const { arquivo } of itens) {
      const repetido = doProjeto[chave].some((x) => x.nome === arquivo.name);
      doProjeto[chave].push({
        // Espelha o rename do servidor: nome repetido vira copia, nunca
        // substitui o que ja estava la.
        nome: repetido ? `${arquivo.name} 1` : arquivo.name,
        tipo: 'arquivo',
        tamanho: arquivo.size,
        nivel: 'total',
      });
    }
  }

  return {
    status: 200,
    enviados: itens.map(({ arquivo }) => arquivo.name),
    renomeados: [],
    falhas: [],
    pasta: destino,
  };
}

// -----------------------------------------------------------------------------
// Testes de carbon-ss-codigo: o endpoint que PEDE o codigo.
// -----------------------------------------------------------------------------
// Rodar:  deno test --allow-env supabase/functions/testes/
//
// A pergunta central e uma so, em varias formas: alguem que nao conhece a
// carteira de clientes da APSIS consegue descobrir, por esta rota, que um
// endereco tem cadastro? Corpo, status, cabecalho e tempo precisam ser os mesmos.
//
// A segunda pergunta e mais simples e igualmente absoluta: o codigo de seis
// digitos escapa por algum lugar?

import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert@1';

import { tratar } from '../carbon-ss-codigo/tratar.ts';
import {
  DIGITOS,
  PISO_CODIGO_MS,
  TETO_DIA_CODIGOS,
  VALIDADE_MIN,
  gerarCodigo,
  resumoCodigo,
  resumoEmail,
} from '../_shared/otp.ts';
import {
  cabecalhos,
  capturarConsole,
  corpoCru,
  criarDuble,
  EMAIL_SEM_CADASTRO,
  EMAIL_TESTE,
  pedido,
  prepararAmbiente,
  type Duble,
  type Roteiro,
} from './apoio.ts';

prepararAmbiente();

const URL_FUNCAO = 'https://exemplo.test/carbon-ss-codigo';

/** Codigo fixo para os testes poderem procura-lo em toda saida. */
const CODIGO_FIXO = '042719';

/** Piso zerado: o teste de tempo e um so, e usa o piso de verdade. */
const SEM_PISO = 0;

/**
 * Roteiro do caminho feliz: passou nos freios, e elegivel, gravou o codigo.
 * Cada teste sobrescreve so o que quer mudar.
 */
function roteiroFeliz(extra: Record<string, Roteiro> = {}): Record<string, Roteiro> {
  return {
    carbon_secure_share_pedido_registrar: { data: { ok: true, pedido_id: 'ped-1' } },
    carbon_secure_share_elegivel: { data: true },
    carbon_secure_share_codigo_registrar: { data: { ok: true } },
    carbon_secure_share_pedido_desfecho: { data: null },
    carbon_secure_share_codigo_descartar: { data: null },
    ...extra,
  };
}

/** Chama a funcao com dependencias controladas. */
async function pedirCodigo(opcoes: {
  email: string;
  roteiros?: Record<string, Roteiro>;
  enviar?: (o: { para: string; assunto: string; html: string }) => Promise<void>;
  gerar?: () => string;
  pisoMs?: number;
}): Promise<{ resposta: Response; duble: Duble; enviados: { para: string; html: string }[] }> {
  const duble = criarDuble(opcoes.roteiros ?? roteiroFeliz());
  const enviados: { para: string; html: string }[] = [];

  const enviar =
    opcoes.enviar ??
    (async (o: { para: string; assunto: string; html: string }) => {
      enviados.push({ para: o.para, html: o.html });
      await Promise.resolve();
    });

  const resposta = await tratar(pedido(URL_FUNCAO, { email: opcoes.email }), {
    admin: duble.admin,
    enviar,
    gerar: opcoes.gerar ?? (() => CODIGO_FIXO),
    pisoMs: opcoes.pisoMs ?? SEM_PISO,
  });

  return { resposta, duble, enviados };
}

/* ===== 1. A resposta nao distingue quem tem cadastro de quem nao tem ====== */

Deno.test('endereco COM e SEM cadastro produzem a mesma resposta, byte a byte', async () => {
  const comCadastro = await pedirCodigo({ email: EMAIL_TESTE });

  // Sem cadastro: passa nos freios (eles valem para qualquer endereco) e a
  // elegibilidade devolve false. Nenhuma outra RPC deveria rodar.
  const semCadastro = await pedirCodigo({
    email: EMAIL_SEM_CADASTRO,
    roteiros: roteiroFeliz({ carbon_secure_share_elegivel: { data: false } }),
  });

  // Cada corpo e lido UMA vez: Response.text() consome o stream, e uma segunda
  // leitura lanca "Body already consumed". Guardar em variavel tambem deixa a
  // mensagem de falha mostrar os dois valores lado a lado.
  const corpoCom = await corpoCru(comCadastro.resposta);
  const corpoSem = await corpoCru(semCadastro.resposta);

  assertEquals(comCadastro.resposta.status, 200);
  assertEquals(semCadastro.resposta.status, 200);
  assertEquals(
    corpoSem,
    corpoCom,
    'o corpo precisa ser IDENTICO: qualquer diferenca enumera a carteira de clientes',
  );
  assertEquals(cabecalhos(semCadastro.resposta), cabecalhos(comCadastro.resposta));

  // E o corpo e o contrato: { enviado: true, minutos: 10 } tambem para quem nao
  // tem cadastro. "enviado: true" e mentira de propria vontade, e e o preco.
  assertEquals(corpoCom, JSON.stringify({ enviado: true, minutos: VALIDADE_MIN }));

  // Sem cadastro nao gera codigo nem envia nada.
  assert(!semCadastro.duble.nomes().includes('carbon_secure_share_codigo_registrar'));
  assertEquals(semCadastro.enviados.length, 0);
  assertEquals(comCadastro.enviados.length, 1);
});

Deno.test('falha de envio tambem responde 200 identico, e descarta o codigo', async () => {
  const referencia = await pedirCodigo({ email: EMAIL_TESTE });

  const falha = await pedirCodigo({
    email: EMAIL_TESTE,
    enviar: () => Promise.reject(new Error('502 do Graph')),
  });

  assertEquals(falha.resposta.status, 200);
  assertEquals(
    await corpoCru(falha.resposta),
    await corpoCru(referencia.resposta),
    'nao existe codigo de erro envio_indisponivel: ele so seria alcancavel para ' +
      'endereco elegivel, ou seja, seria o oraculo que a rota inteira evita',
  );

  // Compensatorio: o codigo gravado que ninguem recebeu precisa sumir, senao a
  // pessoa fica dez minutos presa num codigo inexistente.
  assert(
    falha.duble.nomes().includes('carbon_secure_share_codigo_descartar'),
    'o codigo nao enviado tem de ser descartado',
  );
  const desfechos = falha.duble.rpcs.filter(
    (c) => c.nome === 'carbon_secure_share_pedido_desfecho',
  );
  assertEquals(desfechos.at(-1)?.args.p_motivo, 'envio_falhou');
});

Deno.test('teto global responde 200 identico, e nao um status proprio', async () => {
  const referencia = await pedirCodigo({ email: EMAIL_TESTE });

  const global = await pedirCodigo({
    email: EMAIL_TESTE,
    roteiros: roteiroFeliz({
      carbon_secure_share_pedido_registrar: { data: { ok: false, motivo: 'teto_global' } },
    }),
  });

  assertEquals(global.resposta.status, 200);
  assertEquals(await corpoCru(global.resposta), await corpoCru(referencia.resposta));
  // Nao chega nem a perguntar se o endereco existe.
  assert(!global.duble.nomes().includes('carbon_secure_share_elegivel'));
});

Deno.test('erro de banco no freio responde 200 identico', async () => {
  const referencia = await pedirCodigo({ email: EMAIL_TESTE });

  const erro = await pedirCodigo({
    email: EMAIL_TESTE,
    roteiros: roteiroFeliz({
      carbon_secure_share_pedido_registrar: { error: { message: 'connection reset' } },
    }),
  });

  assertEquals(erro.resposta.status, 200);
  assertEquals(await corpoCru(erro.resposta), await corpoCru(referencia.resposta));
});

Deno.test('o piso de tempo vale para os dois caminhos', async () => {
  // O unico teste que paga o piso de verdade. Sem ele, a diferenca entre "mandei
  // um e-mail pelo Graph" e "nao mandei nada" e medida com um cronometro.
  const marcar = async (roteiros: Record<string, Roteiro>) => {
    const t = Date.now();
    await pedirCodigo({ email: EMAIL_TESTE, roteiros, pisoMs: PISO_CODIGO_MS });
    return Date.now() - t;
  };

  const comCadastro = await marcar(roteiroFeliz());
  const semCadastro = await marcar(
    roteiroFeliz({ carbon_secure_share_elegivel: { data: false } }),
  );

  // Tolerancia de 30 ms para baixo: o setTimeout do runtime pode acordar um
  // pouco antes do alvo.
  assert(comCadastro >= PISO_CODIGO_MS - 30, `caminho com cadastro levou ${comCadastro} ms`);
  assert(semCadastro >= PISO_CODIGO_MS - 30, `caminho sem cadastro levou ${semCadastro} ms`);
});

/* ===== 2. Os freios ======================================================= */

Deno.test('freio de minuto responde 429 e diz quantos segundos faltam', async () => {
  const { resposta, duble } = await pedirCodigo({
    email: EMAIL_SEM_CADASTRO,
    roteiros: roteiroFeliz({
      carbon_secure_share_pedido_registrar: {
        data: { ok: false, motivo: 'freio_minuto', espere: 41 },
      },
    }),
  });

  assertEquals(resposta.status, 429);
  const corpo = JSON.parse(await corpoCru(resposta));
  // `erro` para o ErroApi do frontend, `motivo`/`espere` para o contador da tela.
  assertEquals(corpo.erro, 'espere');
  assertEquals(corpo.motivo, 'espere');
  assertEquals(corpo.espere, 41);
  assertEquals(corpo.detalhe, '41');

  // SIMETRIA: o freio vale para endereco SEM cadastro. Se ele so existisse para
  // cliente, cinco requisicoes por endereco enumerariam a carteira pela
  // interface. A prova e que a elegibilidade nem chegou a ser consultada.
  assert(!duble.nomes().includes('carbon_secure_share_elegivel'));
});

Deno.test('teto diario responde 429 e vale para endereco sem cadastro', async () => {
  const { resposta, duble } = await pedirCodigo({
    email: EMAIL_SEM_CADASTRO,
    roteiros: roteiroFeliz({
      carbon_secure_share_pedido_registrar: { data: { ok: false, motivo: 'teto_diario' } },
    }),
  });

  assertEquals(resposta.status, 429);
  const corpo = JSON.parse(await corpoCru(resposta));
  assertEquals(corpo.erro, 'teto_diario');
  assertEquals(corpo.motivo, 'teto_diario');
  assert(!duble.nomes().includes('carbon_secure_share_elegivel'));
});

Deno.test('o teto diario mandado ao banco e o de otp.ts, nao o default do SQL', async () => {
  // Com codigo de SEIS digitos este numero e defesa critica: o default do SQL
  // (20) quadruplica a chance de invasao calculada em _shared/otp.ts.
  const { duble } = await pedirCodigo({ email: EMAIL_TESTE });
  assertEquals(
    duble.args('carbon_secure_share_pedido_registrar')?.p_teto_dia,
    TETO_DIA_CODIGOS,
  );
});

Deno.test('e-mail malformado responde 400 e nao toca o banco', async () => {
  const duble = criarDuble(roteiroFeliz());
  const resposta = await tratar(pedido(URL_FUNCAO, { email: 'nao-e-endereco' }), {
    admin: duble.admin,
    enviar: () => Promise.resolve(),
    pisoMs: SEM_PISO,
  });

  assertEquals(resposta.status, 400);
  assertEquals(JSON.parse(await corpoCru(resposta)).erro, 'email_invalido');
  assertEquals(duble.rpcs.length, 0, 'formato torto nao consome cota nem consulta cadastro');
});

/* ===== 3. O codigo nao vaza ============================================== */

Deno.test('o codigo nao aparece na resposta, no banco nem no console', async () => {
  const captura = capturarConsole();
  try {
    const feliz = await pedirCodigo({ email: EMAIL_TESTE });
    const falho = await pedirCodigo({
      email: EMAIL_TESTE,
      enviar: () => Promise.reject(new Error('502 do Graph')),
    });

    for (const caso of [feliz, falho]) {
      const corpo = await corpoCru(caso.resposta);
      assert(!corpo.includes(CODIGO_FIXO), `o codigo vazou na resposta: ${corpo}`);

      const argumentos = JSON.stringify(caso.duble.rpcs);
      assert(
        !argumentos.includes(CODIGO_FIXO),
        `o codigo em claro chegou ao banco: ${argumentos}`,
      );
    }

    // O caminho de FALHA e o mais perigoso: e onde alguem escreve
    // console.error('nao consegui enviar', codigo) e ninguem revisa.
    const saida = captura.texto();
    assert(saida.length > 0, 'a falha de envio precisa deixar rastro no log');
    assert(!saida.includes(CODIGO_FIXO), `o codigo vazou no console: ${saida}`);
    // O endereco do cliente tambem nao vai para o log.
    assert(!saida.includes(EMAIL_TESTE), `o endereco do cliente vazou no console: ${saida}`);

    // O que o banco recebe e so o resumo hexadecimal de 64.
    const resumoEsperado = await resumoCodigo(EMAIL_TESTE, CODIGO_FIXO);
    assertEquals(
      feliz.duble.args('carbon_secure_share_codigo_registrar')?.p_resumo,
      resumoEsperado,
    );
    assert(/^[0-9a-f]{64}$/.test(resumoEsperado));
  } finally {
    captura.restaurar();
  }
});

Deno.test('o freio e chaveado pelo resumo do endereco, nunca pelo endereco', async () => {
  const { duble } = await pedirCodigo({ email: EMAIL_TESTE });
  const args = duble.args('carbon_secure_share_pedido_registrar') ?? {};

  assertEquals(args.p_resumo_email, await resumoEmail(EMAIL_TESTE));
  assert(/^[0-9a-f]{64}$/.test(String(args.p_resumo_email)));
  assert(
    !JSON.stringify(args).includes(EMAIL_TESTE),
    'a tabela de pedidos existe para enderecos SEM cadastro: e-mail em claro ali ' +
      'transformaria a trilha numa lista de clientes da APSIS',
  );
});

Deno.test('o e-mail leva o codigo, e nao leva link, projeto nem nome de pessoa', async () => {
  const { enviados } = await pedirCodigo({ email: EMAIL_TESTE });
  assertEquals(enviados.length, 1);
  const { para, html } = enviados[0];

  assertEquals(para, EMAIL_TESTE);
  assertStringIncludes(html, CODIGO_FIXO);
  assertStringIncludes(html, 'nunca vai pedir este código');
  assertStringIncludes(html, 'will never ask you for this code');

  // Sem link: o endereco do portal do cliente ainda nao existe, e e-mail de
  // codigo sem link e imune a phishing por link parecido.
  assert(!/href=/i.test(html), 'o e-mail do codigo nao pode conter link');
  // Imagem REMOTA continua proibida: ela faz o cliente de e-mail pedir bloqueio
  // de conteudo, e um <img> de 1x1 apontando para servidor nosso seria rastreio
  // de leitura sem base legal declarada. A marca e a unica imagem, entra como
  // anexo EMBUTIDO (cid:) e por isso nao busca nada na rede.
  assert(!/src=["']https?:/i.test(html), 'imagem ou recurso remoto no e-mail do codigo');
  const imagens = html.match(/<img[^>]*>/gi) ?? [];
  assertEquals(imagens.length, 1, 'a unica imagem permitida e a marca');
  assertStringIncludes(imagens[0], 'src="cid:');
  // Sem o endereco do destinatario no corpo: um cadastro digitado errado
  // entregaria a um estranho a informacao de que aquilo e cliente da APSIS.
  assert(!html.includes(EMAIL_TESTE));
});

/* ===== 4. Colisao de resumo =============================================== */

Deno.test('colisao no insert do resumo sorteia de novo em vez de falhar', async () => {
  let vez = 0;
  const { resposta, duble, enviados } = await pedirCodigo({
    email: EMAIL_TESTE,
    gerar: () => (vez++ === 0 ? '111111' : CODIGO_FIXO),
    roteiros: roteiroFeliz({
      carbon_secure_share_codigo_registrar: (_args, chamada) =>
        chamada === 1 ? { data: { ok: false, motivo: 'colisao' } } : { data: { ok: true } },
    }),
  });

  assertEquals(resposta.status, 200);
  assertEquals(enviados.length, 1);
  assertStringIncludes(enviados[0].html, CODIGO_FIXO);
  assertEquals(
    duble.rpcs.filter((c) => c.nome === 'carbon_secure_share_codigo_registrar').length,
    2,
  );
});

Deno.test('erro de banco ao gravar o codigo NAO vira laco de tres tentativas', async () => {
  // Repetir o sorteio nao conserta uma conexao caida, e esconderia a causa.
  const { resposta, duble, enviados } = await pedirCodigo({
    email: EMAIL_TESTE,
    roteiros: roteiroFeliz({
      carbon_secure_share_codigo_registrar: { error: { message: 'deadlock detected' } },
    }),
  });

  assertEquals(resposta.status, 200);
  assertEquals(enviados.length, 0);
  assertEquals(
    duble.rpcs.filter((c) => c.nome === 'carbon_secure_share_codigo_registrar').length,
    1,
  );
});

/* ===== 5. O sorteio ======================================================= */

Deno.test('gerarCodigo devolve exatamente DIGITOS digitos, com zero a esquerda', () => {
  for (let i = 0; i < 500; i++) {
    const codigo = gerarCodigo();
    assertEquals(codigo.length, DIGITOS);
    assert(/^[0-9]+$/.test(codigo), `codigo fora do alfabeto: ${codigo}`);
  }
});

Deno.test('o resumo amarra o codigo ao endereco', async () => {
  // O e-mail entra DENTRO do MAC: um codigo interceptado no caminho de um
  // endereco e inutil em outro, mesmo com os dois vivos ao mesmo tempo.
  const um = await resumoCodigo(EMAIL_TESTE, CODIGO_FIXO);
  const outro = await resumoCodigo(EMAIL_SEM_CADASTRO, CODIGO_FIXO);
  assert(um !== outro);

  // E a normalizacao e a mesma do SQL (lower(btrim(...))), senao o cliente
  // digitaria o codigo certo e receberia "codigo invalido" para sempre.
  assertEquals(await resumoCodigo(`  ${EMAIL_TESTE.toUpperCase()} `, CODIGO_FIXO), um);
});

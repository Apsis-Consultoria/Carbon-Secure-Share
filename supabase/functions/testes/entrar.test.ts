// -----------------------------------------------------------------------------
// Testes de carbon-ss-entrar: o endpoint que TROCA o codigo por sessao.
// -----------------------------------------------------------------------------
// Rodar:  deno test --allow-env supabase/functions/testes/
//
// Duas perguntas:
//
//   1. as quatro causas de recusa (errado, inexistente, expirado, pausado)
//      respondem a MESMA coisa? Distinguir "muitas tentativas" de "codigo
//      invalido" contaria que existe codigo vivo para aquele endereco, ou seja,
//      que aquele endereco e cliente da APSIS num projeto de carbono;
//   2. a sessao emitida e a mesma de sempre - projetos dentro do token, pasta
//      Geral incluida, 8 horas?

import { assert, assertEquals } from 'jsr:@std/assert@1';

import { tratar } from '../carbon-ss-entrar/tratar.ts';
import { ID_GERAL, verificarSessao } from '../_shared/sessao.ts';
import { DIGITOS, resumoCodigo } from '../_shared/otp.ts';
import {
  capturarConsole,
  corpoCru,
  criarDuble,
  EMAIL_TESTE,
  pedido,
  prepararAmbiente,
  type Duble,
  type Roteiro,
} from './apoio.ts';

prepararAmbiente();

const URL_FUNCAO = 'https://exemplo.test/carbon-ss-entrar';
const CODIGO_FIXO = '042719';
const PROJETO = '22222222-2222-4222-8222-222222222222';

/** A pasta Geral vem da configuracao do SharePoint; aqui ela e dublada. */
const lerConfig = () => Promise.resolve({ pastaGeral: 'Geral' });

function roteiroFeliz(extra: Record<string, Roteiro> = {}): Record<string, Roteiro> {
  return {
    carbon_secure_share_conferir_codigo: { data: { ok: true } },
    carbon_secure_share_autorizar: {
      data: {
        autorizado: true,
        projetos: [
          {
            cliente_id: '33333333-3333-4333-8333-333333333333',
            projeto_id: PROJETO,
            ap_os: 'AP-00000-00-000',
            empresa: 'Empresa Ficticia S.A.',
            pasta: 'AP-00000-00-000 - Empresa Ficticia S.A.',
            nome: 'Contato Ficticio',
          },
        ],
      },
    },
    ...extra,
  };
}

async function entrar(opcoes: {
  codigo?: string;
  email?: string;
  roteiros?: Record<string, Roteiro>;
}): Promise<{ resposta: Response; duble: Duble }> {
  const duble = criarDuble(opcoes.roteiros ?? roteiroFeliz());
  const resposta = await tratar(
    pedido(URL_FUNCAO, {
      email: opcoes.email ?? EMAIL_TESTE,
      codigo: opcoes.codigo ?? CODIGO_FIXO,
    }),
    { admin: duble.admin, lerConfig, pisoMs: 0 },
  );
  return { resposta, duble };
}

/* ===== 1. As quatro recusas sao indistinguiveis ========================== */

Deno.test('errado, inexistente e pausado respondem a MESMA recusa', async () => {
  const captura = capturarConsole();
  try {
    const respostas: string[] = [];
    const status: number[] = [];

    for (const motivo of ['errado', 'inexistente', 'pausado']) {
      const { resposta } = await entrar({
        roteiros: roteiroFeliz({
          carbon_secure_share_conferir_codigo: { data: { ok: false, motivo } },
        }),
      });
      status.push(resposta.status);
      respostas.push(await corpoCru(resposta));
    }

    assertEquals(status, [401, 401, 401]);
    assertEquals(
      new Set(respostas).size,
      1,
      'os tres motivos precisam produzir o mesmo corpo: "pausado" diferente de ' +
        '"errado" revelaria que existe codigo vivo para aquele endereco',
    );
    assertEquals(JSON.parse(respostas[0]).erro, 'codigo_invalido');

    // O motivo real existe, mas so no log.
    const saida = captura.texto();
    assert(saida.includes('pausado'), 'o motivo tem de ficar registrado para nos');
  } finally {
    captura.restaurar();
  }
});

Deno.test('codigo expirado nao se distingue de codigo inexistente', async () => {
  // Expirado e inexistente sao o MESMO caso do lado do banco de proposito: a
  // consulta filtra por expira_em > now(), entao codigo vencido simplesmente nao
  // e encontrado e o motivo devolvido e 'inexistente'.
  const { resposta } = await entrar({
    roteiros: roteiroFeliz({
      carbon_secure_share_conferir_codigo: { data: { ok: false, motivo: 'inexistente' } },
    }),
  });

  assertEquals(resposta.status, 401);
  assertEquals(JSON.parse(await corpoCru(resposta)).erro, 'codigo_invalido');
});

Deno.test('codigo ja usado responde a mesma recusa e nao emite sessao', async () => {
  // Uso unico: depois de usado_em ser carimbado, a linha nao casa mais e o banco
  // devolve o mesmo 'inexistente'. O que este teste garante e que nenhum token
  // sai por esse caminho.
  const { resposta, duble } = await entrar({
    roteiros: roteiroFeliz({
      carbon_secure_share_conferir_codigo: { data: { ok: false, motivo: 'inexistente' } },
    }),
  });

  assertEquals(resposta.status, 401);
  const corpo = JSON.parse(await corpoCru(resposta));
  assertEquals(corpo.token, undefined);
  assert(
    !duble.nomes().includes('carbon_secure_share_autorizar'),
    'codigo recusado nao pode chegar a consultar autorizacao',
  );
});

Deno.test('codigo com tamanho errado nem toca o banco', async () => {
  for (const codigo of ['', '1', '1234567', 'abcdef']) {
    const { resposta, duble } = await entrar({ codigo });
    assertEquals(resposta.status, 401, `codigo "${codigo}" deveria ser recusado`);
    assertEquals(duble.rpcs.length, 0);
  }

  // E o tamanho conferido e o de otp.ts, nao um 6 solto escrito aqui.
  const { resposta } = await entrar({ codigo: '0'.repeat(DIGITOS) });
  assertEquals(resposta.status, 200);
});

Deno.test('espaco colado junto com os digitos e aceito', async () => {
  // Quem cola "Codigo: 04 27 19" tem a mesma intencao de quem digita certo.
  const { resposta, duble } = await entrar({ codigo: '04 27 19' });
  assertEquals(resposta.status, 200);
  assertEquals(
    duble.args('carbon_secure_share_conferir_codigo')?.p_resumo,
    await resumoCodigo(EMAIL_TESTE, CODIGO_FIXO),
  );
});

/* ===== 2. O acesso revogado no meio do caminho =========================== */

Deno.test('revogado entre o pedido e a confirmacao responde 403, nao 401', async () => {
  // Aqui a pessoa JA provou a posse da caixa, entao nao ha o que esconder dela.
  // E o unico caminho desta funcao em que o erro e especifico.
  const { resposta } = await entrar({
    roteiros: roteiroFeliz({
      carbon_secure_share_autorizar: { data: { autorizado: false } },
    }),
  });

  assertEquals(resposta.status, 403);
  assertEquals(JSON.parse(await corpoCru(resposta)).erro, 'acesso_indisponivel');
});

Deno.test('autorizacao sem projeto nenhum nao emite sessao vazia', async () => {
  // Token valido que nao abre nada daria "tela em branco depois de entrar", que e
  // o pior sintoma possivel para quem esta do outro lado.
  const { resposta } = await entrar({
    roteiros: roteiroFeliz({
      carbon_secure_share_autorizar: { data: { autorizado: true, projetos: [] } },
    }),
  });

  assertEquals(resposta.status, 403);
  assertEquals(JSON.parse(await corpoCru(resposta)).erro, 'acesso_indisponivel');
});

Deno.test('erro de banco ao conferir responde 500, e nao "codigo invalido"', async () => {
  // Aqui a distincao e desejada: mandar o cliente redigitar um codigo certo, para
  // sempre, por causa de uma queda de conexao, seria pior do que dizer que o
  // problema e nosso.
  const captura = capturarConsole();
  try {
    const { resposta } = await entrar({
      roteiros: roteiroFeliz({
        carbon_secure_share_conferir_codigo: { error: { message: 'connection reset' } },
      }),
    });
    assertEquals(resposta.status, 500);
    assertEquals(JSON.parse(await corpoCru(resposta)).erro, 'erro_interno');
  } finally {
    captura.restaurar();
  }
});

/* ===== 3. A sessao emitida ================================================ */

Deno.test('codigo certo emite o token de sempre, com a Geral dentro', async () => {
  const { resposta, duble } = await entrar({});

  assertEquals(resposta.status, 200);
  const corpo = JSON.parse(await corpoCru(resposta));
  assertEquals(corpo.nome, 'Contato Ficticio');

  const payload = await verificarSessao(corpo.token);
  assert(payload, 'o token emitido precisa ser valido para verificarSessao');
  assertEquals(payload?.email, EMAIL_TESTE);

  // A Geral entra na frente, como se fosse mais um projeto, somente leitura.
  assertEquals(payload?.projetos[0].projeto_id, ID_GERAL);
  assertEquals(payload?.projetos[0].somenteLeitura, true);
  assertEquals(payload?.projetos[1].projeto_id, PROJETO);
  assertEquals(payload?.projetos[1].pasta, 'AP-00000-00-000 - Empresa Ficticia S.A.');

  // 8 horas, como antes da senha sair. Sessao curta e deliberada: o cliente
  // costuma acessar de maquina compartilhada.
  assertEquals((payload?.exp ?? 0) - (payload?.iat ?? 0), 8 * 60 * 60);

  // O projeto sai do TOKEN, nunca do parametro: nada na requisicao citou projeto.
  assertEquals(duble.args('carbon_secure_share_autorizar')?.p_email, EMAIL_TESTE);
});

Deno.test('a ordem e conferir e DEPOIS autorizar', async () => {
  // Se a autorizacao viesse antes, um endereco elegivel receberia resposta
  // diferente de um nao elegivel mesmo com codigo errado.
  const { duble } = await entrar({});
  assertEquals(duble.nomes(), [
    'carbon_secure_share_conferir_codigo',
    'carbon_secure_share_autorizar',
  ]);
});

/* ===== 4. O codigo nao vaza ============================================== */

Deno.test('o codigo nao aparece na resposta, no banco nem no console', async () => {
  const captura = capturarConsole();
  try {
    const casos = [
      await entrar({}),
      await entrar({
        roteiros: roteiroFeliz({
          carbon_secure_share_conferir_codigo: { data: { ok: false, motivo: 'errado' } },
        }),
      }),
      await entrar({
        roteiros: roteiroFeliz({
          carbon_secure_share_conferir_codigo: { error: { message: 'connection reset' } },
        }),
      }),
    ];

    for (const { resposta, duble } of casos) {
      const corpo = await corpoCru(resposta);
      assert(!corpo.includes(CODIGO_FIXO), `o codigo vazou na resposta: ${corpo}`);

      const argumentos = JSON.stringify(duble.rpcs);
      assert(
        !argumentos.includes(CODIGO_FIXO),
        `o codigo em claro chegou ao banco: ${argumentos}`,
      );
    }

    const saida = captura.texto();
    assert(!saida.includes(CODIGO_FIXO), `o codigo vazou no console: ${saida}`);
  } finally {
    captura.restaurar();
  }
});

Deno.test('o que chega ao banco e o resumo hexadecimal de 64', async () => {
  const { duble } = await entrar({});
  const resumo = String(duble.args('carbon_secure_share_conferir_codigo')?.p_resumo);
  assert(/^[0-9a-f]{64}$/.test(resumo), `resumo fora do formato: ${resumo}`);
  assertEquals(resumo, await resumoCodigo(EMAIL_TESTE, CODIGO_FIXO));
});

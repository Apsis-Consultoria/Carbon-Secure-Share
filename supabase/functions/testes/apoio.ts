// -----------------------------------------------------------------------------
// Apoio dos testes das Edge Functions do Secure Share.
// -----------------------------------------------------------------------------
// POR QUE UM DUBLE E NAO UM BANCO: nao ha Postgres nem Docker nesta maquina, e o
// que precisa ser provado aqui nao e o comportamento do Postgres - e o da NOSSA
// camada. As perguntas sao outras: a resposta e byte a byte igual para endereco
// com e sem cadastro? O 429 do freio existe antes de a elegibilidade ser
// consultada? O codigo em claro sai por algum lugar?
//
// Todas se respondem inspecionando a resposta HTTP, os argumentos que foram
// mandados ao banco e o que caiu no console - e o duble responde melhor que um
// banco: com Postgres de verdade, um oraculo de tempo ou um console.error com o
// codigo passariam despercebidos, porque nenhum banco reclama disso.
//
// O QUE ESTE DUBLE NAO PROVA, e precisa ficar escrito para ninguem se enganar:
//   - que carbon_secure_share_conferir_codigo confere o acerto ANTES da pausa
//     (item 4 do roteiro manual: errar cinco vezes e em seguida acertar);
//   - que o unico parcial de carbon_secure_share_codigos se comporta como o
//     desenho supoe;
//   - que os freios contam o que dizem contar numa janela de 24 horas;
//   - que o Graph aceita o corpo do sendMail.
// Os quatro exigem Postgres ou rede. Ficam para o roteiro manual do plano.
//
// COMO RODAR (nao ha Deno instalado na maquina onde isto foi escrito):
//   deno test --allow-env supabase/functions/testes/
// O --allow-env e necessario porque os testes definem SESSION_SECRET, do qual o
// pepper dos resumos e derivado.

// -----------------------------------------------------------------------------
// Cliente Supabase falso
// -----------------------------------------------------------------------------

/** O que um roteiro de teste escreve. Os dois campos sao opcionais por conforto. */
export type Resposta = { data?: unknown; error?: { message: string } | null };

/**
 * O que o cliente Supabase de verdade devolve: os dois campos SEMPRE presentes.
 *
 * A distincao existe para o duble ser aceito no lugar do cliente real sem `any`:
 * um `error?: ...` opcional inclui `undefined`, que o codigo de producao nao
 * espera, e o typecheck reprovaria a injecao.
 */
export type RespostaResolvida = { data: unknown; error: { message: string } | null };

/** Resposta fixa, ou calculada a partir dos argumentos e da ordem da chamada. */
export type Roteiro = Resposta | ((args: Record<string, unknown>, chamada: number) => Resposta);

export type ChamadaRpc = { nome: string; args: Record<string, unknown> };

export type Duble = {
  admin: {
    rpc(nome: string, args?: Record<string, unknown>): Promise<RespostaResolvida>;
  };
  /** Toda chamada a .rpc(), em ordem. */
  rpcs: ChamadaRpc[];
  /** Nomes das RPCs chamadas, na ordem. Atalho para assercao legivel. */
  nomes(): string[];
  /** Argumentos da primeira chamada de uma RPC, ou undefined. */
  args(nome: string): Record<string, unknown> | undefined;
};

/**
 * Cliente falso que so sabe fazer `.rpc()`.
 *
 * As funcoes de autenticacao nao usam `.from()` de proposito: tudo passa por
 * funcao do banco, para as condicoes de acesso viverem num lugar so. Se um dia
 * um `.from()` aparecer aqui, este duble estoura com nome do metodo - o que e
 * melhor do que devolver null e o teste passar por engano.
 *
 * @param roteiros mapa nome da RPC -> resposta. Nome ausente devolve
 *   { data: null, error: null }, que e o caso "a funcao nem deveria ter sido
 *   chamada" e costuma quebrar o teste no lugar certo.
 */
export function criarDuble(roteiros: Record<string, Roteiro> = {}): Duble {
  const rpcs: ChamadaRpc[] = [];
  const contagem = new Map<string, number>();

  const admin = {
    rpc(nome: string, args: Record<string, unknown> = {}): Promise<RespostaResolvida> {
      rpcs.push({ nome, args });
      const chamada = (contagem.get(nome) ?? 0) + 1;
      contagem.set(nome, chamada);

      const roteiro = roteiros[nome];
      const bruta = typeof roteiro === 'function' ? roteiro(args, chamada) : roteiro;
      // Campo a campo, e nao por spread: `?? null` so troca null e undefined,
      // entao um roteiro que devolve `{ data: false }` (a elegibilidade negada,
      // que e o caso mais importante deste arquivo) continua sendo false.
      return Promise.resolve({ data: bruta?.data ?? null, error: bruta?.error ?? null });
    },
  };

  return {
    admin,
    rpcs,
    nomes: () => rpcs.map((c) => c.nome),
    args: (nome: string) => rpcs.find((c) => c.nome === nome)?.args,
  };
}

// -----------------------------------------------------------------------------
// Console capturado
// -----------------------------------------------------------------------------

export type Console = {
  /** Tudo que foi impresso, ja concatenado. */
  texto(): string;
  /** Devolve o console real. Chame sempre, e de dentro de um try/finally. */
  restaurar(): void;
};

/**
 * Captura console.error / warn / log.
 *
 * Existe por causa de uma exigencia especifica: o codigo de uso unico NAO pode
 * aparecer em saida nenhuma, inclusive nos console.error dos caminhos de FALHA,
 * que sao os que ninguem le antes de publicar. O log das Edge Functions e
 * legivel por mais gente do que o banco.
 */
export function capturarConsole(): Console {
  const original = { error: console.error, warn: console.warn, log: console.log };
  const linhas: string[] = [];

  const registrar = (...args: unknown[]) => {
    linhas.push(
      args
        .map((a) => {
          if (typeof a === 'string') return a;
          try {
            return JSON.stringify(a) ?? String(a);
          } catch {
            return String(a);
          }
        })
        .join(' '),
    );
  };

  console.error = registrar;
  console.warn = registrar;
  console.log = registrar;

  return {
    texto: () => linhas.join('\n'),
    restaurar: () => {
      console.error = original.error;
      console.warn = original.warn;
      console.log = original.log;
    },
  };
}

// -----------------------------------------------------------------------------
// Utilitarios
// -----------------------------------------------------------------------------

/**
 * Endereco OBVIAMENTE ficticio.
 *
 * LGPD: nenhum e-mail ou nome de pessoa real entra em teste, seed ou exemplo
 * deste repositorio. `.invalid` e reservado por RFC 2606 e nunca resolve, entao
 * um envio acidental nao chega a lugar nenhum.
 */
export const EMAIL_TESTE = 'cliente.ficticio@exemplo.invalid';
export const EMAIL_SEM_CADASTRO = 'ninguem.ficticio@exemplo.invalid';

/** Monta o POST que as funcoes esperam. */
export function pedido(url: string, corpo: unknown): Request {
  return new Request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(corpo),
  });
}

/** Corpo cru da resposta, para comparacao BYTE A BYTE (nao por objeto). */
export async function corpoCru(resposta: Response): Promise<string> {
  return await resposta.text();
}

/** Cabecalhos ordenados, para comparar dois caminhos sem depender da ordem. */
export function cabecalhos(resposta: Response): string {
  return [...resposta.headers.entries()]
    .map(([k, v]) => `${k}: ${v}`)
    .sort()
    .join('\n');
}

/**
 * Define o SESSION_SECRET dos testes.
 *
 * Valor obviamente de teste e com os 32 caracteres que sessao.ts e otp.ts
 * exigem. Nao e segredo de lugar nenhum.
 */
export function prepararAmbiente(): void {
  Deno.env.set('SESSION_SECRET', 'segredo-de-teste-com-32-caracteres-ou-mais');
}

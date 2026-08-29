// -----------------------------------------------------------------------------
// Codigo de uso unico enviado por e-mail: sorteio, resumo e piso de tempo.
// -----------------------------------------------------------------------------
// Este arquivo e o UNICO lugar onde mora o tamanho do codigo. Quem quiser mudar
// o numero de digitos muda aqui e le, uma linha abaixo, a conta que esse numero
// paga. Espalhar a constante por tres arquivos e como o teto vira "6" num lugar
// e "8" no outro.
//
// ROTACAO DE SESSION_SECRET (o numero que alguem vai procurar no meio de um
// incidente): o pepper destes resumos e DERIVADO de SESSION_SECRET, e o token de
// sessao e assinado com ele (_shared/sessao.ts). Rotacionar o segredo, portanto,
// invalida de uma vez:
//   - todos os codigos vivos, que duram no maximo 10 minutos;
//   - TODAS as sessoes abertas, que duram ate 8 horas.
// O primeiro efeito e barato. O segundo derruba todo cliente que estiver com o
// portal aberto, e ele nao aparece em teste nenhum.

const codificador = new TextEncoder();

// -----------------------------------------------------------------------------
// O tamanho do codigo, e a aritmetica que ele paga
// -----------------------------------------------------------------------------
/**
 * Digitos do codigo. **SEIS, por decisao do dono**, contra a recomendacao de oito.
 *
 * A CONSEQUENCIA, escrita aqui para nao ser redescoberta: com seis digitos o teto
 * diario de pedidos deixa de ser conforto operacional e vira DEFESA CRITICA. Ele
 * e o unico fator que separa um ataque dirigido de uma invasao provavel.
 *
 * A conta, para um atacante que sabe o endereco da vitima e pede codigo para ela
 * todo dia (ataque barulhento: a caixa da pessoa enche):
 *
 *   espaco de busca      = 10^DIGITOS                 = 1.000.000
 *   palpites por codigo  = PALPITES_POR_CODIGO        = 5
 *   codigos por dia      = TETO_DIA_CODIGOS           = 5
 *   palpites por ano     = 5 x 5 x 365                = 9.125
 *   chance por cliente/ano = 9.125 / 1.000.000        = ~0,91%
 *
 * Com oito digitos a mesma conta daria ~0,009%, e por isso oito era a
 * recomendacao. Com seis, os tres numeros acima passam a ser o controle.
 *
 * O QUE NAO PODE SER FEITO SEM REFAZER ESTA CONTA:
 *   - subir TETO_DIA_CODIGOS. Com o default do SQL (20) a chance vira ~3,6%
 *     por cliente por ano, quatro vezes o que foi apresentado a quem decidiu;
 *   - subir o teto de tentativas por codigo (o check de 5 em
 *     carbon_secure_share_codigos);
 *   - alongar a validade do codigo, que multiplica os codigos vivos ao mesmo
 *     tempo.
 */
export const DIGITOS = 6;

/** Quantos valores distintos o codigo pode assumir. */
const ESPACO = 10 ** DIGITOS;

/**
 * Palpites errados que uma linha de codigo aceita antes de pausar.
 *
 * NAO e configuravel daqui: quem aplica o limite e o check
 * `carbon_ss_codigos_tentativas_chk` em carbon_secure_share_codigos, no banco.
 * A constante existe para a conta acima poder ser conferida sem abrir o SQL.
 */
export const PALPITES_POR_CODIGO = 5;

/**
 * Teto de pedidos de codigo por endereco em 24 horas, passado explicitamente ao
 * `carbon_secure_share_pedido_registrar`.
 *
 * Passado de proposito, em vez de deixar o default do SQL (20) valer: o default
 * foi dimensionado para codigo de oito digitos, e com seis ele quadruplica o
 * risco calculado acima. Se um dia o codigo voltar a ter oito digitos, este e o
 * primeiro numero que pode ser afrouxado.
 *
 * O CUSTO, aceito por escrito: um cliente que feche a aba muitas vezes no mesmo
 * dia pode bater no teto e ficar sem entrar ate a janela de 24 horas correr. A
 * sessao dura 8 horas, entao cinco codigos cobrem um dia util com folga; quem
 * bater no teto tem o botao "Reenviar convite" do Portal como caminho de saida.
 *
 * O freio de 60 segundos entre pedidos e o teto global de 200 por hora ficam nos
 * defaults do SQL: nenhum dos dois muda com o numero de digitos.
 */
export const TETO_DIA_CODIGOS = 5;

/** Validade do codigo, em minutos. Vai para o banco E para o texto do e-mail. */
export const VALIDADE_MIN = 10;

// -----------------------------------------------------------------------------
// Pisos de tempo
// -----------------------------------------------------------------------------
/**
 * Piso do endpoint que PEDE codigo.
 *
 * 1500 ms porque o Graph responde tipicamente entre 300 e 700 ms: sem o piso, a
 * diferenca entre "mandei um e-mail" e "nao mandei nada" seria medida com um
 * cronometro e enumeraria a carteira de clientes da APSIS endereco a endereco.
 * O corpo e o status ja sao identicos nos dois casos (regra 2); o tempo e a
 * terceira face da mesma resposta.
 */
export const PISO_CODIGO_MS = 1500;

/**
 * Piso do endpoint que TROCA codigo por sessao.
 *
 * Menor porque aqui nao ha oraculo de existencia a esconder: quem chega neste
 * endpoint ja precisa apresentar um codigo, e a resposta e a mesma para codigo
 * errado, inexistente, expirado e pausado. Os 400 ms servem so para achatar a
 * diferenca entre "nem consultei" e "consultei e conferi".
 */
export const PISO_ENTRAR_MS = 400;

/**
 * Segura a resposta ate o piso.
 *
 * Chamada IMEDIATAMENTE antes do return, nunca no meio: um piso aplicado antes
 * do trabalho apenas adia o inicio e a diferenca de tempo continua visivel no
 * fim.
 */
export async function respeitarPiso(inicio: number, pisoMs: number): Promise<void> {
  const falta = pisoMs - (Date.now() - inicio);
  if (falta > 0) await new Promise((r) => setTimeout(r, falta));
}

// -----------------------------------------------------------------------------
// Sorteio
// -----------------------------------------------------------------------------
/**
 * Maior multiplo de ESPACO que cabe em 32 bits. Tudo acima dele e descartado.
 *
 * Sem essa rejeicao, `sorteio % ESPACO` enviesa os primeiros valores: 2^32 nao e
 * multiplo de 1.000.000, entao os 967.296 primeiros codigos sairiam com
 * probabilidade maior que os demais. Vies conhecido e busca reduzida.
 */
const TETO_SORTEIO = Math.floor(2 ** 32 / ESPACO) * ESPACO;

/**
 * Sorteia o codigo.
 *
 * crypto.getRandomValues, NUNCA Math.random: o Math.random do V8 e um xorshift128+
 * cujo estado interno pode ser recuperado a partir de poucas saidas observadas.
 * Como um atacante consegue pedir codigo para os proprios enderecos a vontade,
 * ele observaria saidas suficientes para prever o codigo da vitima sem chutar
 * nenhuma vez - e nenhum teto de tentativa protege contra isso.
 *
 * O zero a esquerda e preservado (padStart): '004271' e um codigo valido e tem os
 * mesmos DIGITOS de todos os outros. Tratar o codigo como numero em qualquer
 * ponto da cadeia mataria 10% do espaco de busca.
 */
export function gerarCodigo(): string {
  const buffer = new Uint32Array(1);
  let sorteio = 0;
  do {
    crypto.getRandomValues(buffer);
    sorteio = buffer[0];
  } while (sorteio >= TETO_SORTEIO);
  return String(sorteio % ESPACO).padStart(DIGITOS, '0');
}

// -----------------------------------------------------------------------------
// Resumos
// -----------------------------------------------------------------------------
/**
 * Mesma normalizacao que o SQL aplica (`lower(btrim(...))`).
 *
 * Precisa ser a MESMA, byte a byte: o e-mail entra dentro do MAC do codigo, e um
 * espaco a mais aqui produziria um resumo que nunca casa com o gravado - o
 * cliente digitaria o codigo certo e receberia "codigo invalido" para sempre.
 */
export function normalizarEmail(bruto: unknown): string {
  return String(bruto ?? '').trim().toLowerCase();
}

/**
 * Filtro barato de formato, so para recusar o que nem e endereco.
 *
 * NAO valida existencia e nao tenta ser RFC 5322: quem decide se o endereco
 * recebe alguma coisa e o Graph, e a resposta ao cliente e a mesma de qualquer
 * jeito. Serve para o 400 de digitacao obviamente errada nao consumir cota nem
 * um envio.
 */
export function emailPlausivel(email: string): boolean {
  return email.length <= 254 && /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(email);
}

/**
 * Pepper dos resumos, derivado de SESSION_SECRET com rotulo de dominio.
 *
 * DERIVADO, e nao um secret novo, por dois motivos: um segredo a menos para
 * faltar em producao (e a falta dele derrubaria a unica porta de entrada do
 * cliente), e quem vaza SESSION_SECRET ja forja sessao inteira - um segundo
 * segredo ao lado do primeiro nao compra defesa nenhuma.
 *
 * O rotulo existe para que este pepper nao seja igual a nenhuma outra chave
 * derivada do mesmo segredo no futuro.
 */
let pepperCache: CryptoKey | null = null;

async function importarHmac(bytes: Uint8Array | ArrayBuffer): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    bytes as BufferSource,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
}

async function pepper(): Promise<CryptoKey> {
  if (pepperCache) return pepperCache;

  const segredo = Deno.env.get('SESSION_SECRET');
  // Mesmo piso de _shared/sessao.ts, e pelo mesmo motivo: e o unico fator entre
  // um codigo forjado e a pasta de um cliente sob NDA.
  if (!segredo || segredo.length < 32) {
    throw new Error('SESSION_SECRET ausente ou com menos de 32 caracteres.');
  }

  const raiz = await importarHmac(codificador.encode(segredo));
  const derivada = await crypto.subtle.sign('HMAC', raiz, codificador.encode('carbon-ss/otp/v1'));
  pepperCache = await importarHmac(derivada);
  return pepperCache;
}

function hex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function resumir(mensagem: string): Promise<string> {
  return hex(await crypto.subtle.sign('HMAC', await pepper(), codificador.encode(mensagem)));
}

/**
 * Resumo do codigo, e o UNICO formato em que ele chega ao Postgres.
 *
 * O codigo em claro nunca sai desta Edge Function na direcao do banco, entao ele
 * nao entra em log_statement, nem em pg_stat_statements, nem no backup.
 *
 * O E-MAIL ENTRA DENTRO DO MAC de proposito: um codigo interceptado no caminho de
 * um endereco e inutil em outro, mesmo que os dois estejam vivos ao mesmo tempo.
 *
 * NAO E BCRYPT, e a escolha e deliberada: hash lento nao muda a conta de quem
 * tenha o dump de um segredo de seis digitos que vive dez minutos (o espaco
 * inteiro se percorre em qualquer hardware), e num endpoint publico e anonimo um
 * KDF caro vira alavanca de CPU contra nos. Quem protege o dump aqui e o PEPPER,
 * que nao esta no banco.
 *
 * COMPARACAO EM TEMPO CONSTANTE: nao existe, e nao e esquecimento. A comparacao
 * nao acontece em JavaScript - o resumo vai ao banco e casa por igualdade
 * indexada dentro de `carbon_secure_share_conferir_codigo`. Um atacante que
 * quisesse explorar o tempo dessa igualdade precisaria escolher o resumo
 * apresentado, e ele so consegue escolher o CODIGO: o resumo e a saida de um
 * HMAC com pepper que ele nao tem, ou seja, ele nao controla nem um bit do que e
 * comparado. Vazamento de tempo sobre um valor que o atacante nao controla nao
 * reduz busca nenhuma. Nao troque isto por um laco "em tempo constante" em JS:
 * seria teatro, e ainda por cima em cima de um valor publico.
 */
export async function resumoCodigo(email: string, codigo: string): Promise<string> {
  return resumir(`cod:${normalizarEmail(email)}:${codigo}`);
}

/**
 * Resumo do endereco, usado como chave dos freios em
 * carbon_secure_share_pedidos.
 *
 * Existe para que o contador de pedidos possa valer para endereco SEM cadastro:
 * um freio que so conhecesse clientes transformaria "espere 40 segundos" num
 * oraculo de existencia, que e exatamente o que a regra 2 proibe.
 *
 * Tambem e o resumo COM PEPPER, e nao um SHA-256 seco do endereco. O espaco de
 * e-mails plausiveis e pequeno e enumeravel: um SHA-256 seco na coluna seria
 * reversivel em minutos com uma lista de enderecos, e a tabela de pedidos
 * viraria uma lista de clientes da APSIS em projetos de carbono.
 */
export async function resumoEmail(email: string): Promise<string> {
  return resumir(`eml:${normalizarEmail(email)}`);
}

// -----------------------------------------------------------------------------
// carbon-ss-entrar - ponto de entrada.
// -----------------------------------------------------------------------------
// O handler vive em ./tratar.ts e este arquivo so o serve. A separacao existe
// para o teste poder importar o handler SEM subir um servidor: `Deno.serve` num
// modulo importado por um teste abre porta e prende o processo.
//
// Deno.serve((req) => tratar(req)) e nao Deno.serve(tratar): o runtime passa um
// segundo argumento (dados da conexao) que colidiria com o parametro de
// dependencias injetaveis do handler.

import { tratar } from './tratar.ts';

Deno.serve((req: Request) => tratar(req));

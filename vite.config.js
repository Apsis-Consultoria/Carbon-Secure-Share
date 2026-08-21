import path from 'path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * O FRONTEND NAO TEM VARIAVEL DE AMBIENTE NENHUMA.
 *
 * Nao existe `import.meta.env` em src/, e nao existe `.env`. Todas as chamadas
 * vao para o caminho relativo `/api/<funcao>`, e quem sabe onde ficam as Edge
 * Functions e a camada de hospedagem (ver src/lib/endpoint.js).
 *
 * As duas variaveis lidas AQUI sao do processo do Vite, nao do navegador. Elas
 * NAO tem o prefixo VITE_, e essa ausencia e a garantia: o Vite so expoe ao
 * cliente o que comeca com VITE_, entao e impossivel qualquer uma delas vazar
 * para o bundle, mesmo por engano.
 *
 *   SUPABASE_FUNCTIONS_URL   destino do proxy /api em desenvolvimento.
 *                            Ex.: https://<ref>.supabase.co/functions/v1
 *   EXPOR_REDE               'true' escuta em toda a rede local (testar no
 *                            celular). Por padrao so em 127.0.0.1, para o
 *                            codigo-fonte servido em dev nao ficar legivel por
 *                            outras maquinas.
 */

const DESTINO_FUNCOES = process.env.SUPABASE_FUNCTIONS_URL || '';

// Aviso no boot do dev server. Sem o proxy, `/api/*` cai no index.html e o erro
// chega ao desenvolvedor como "o sistema nao esta configurado" na tela, sem
// dizer o que fazer. Melhor gritar aqui, uma vez.
if (!DESTINO_FUNCOES && process.env.NODE_ENV !== 'production') {
  console.warn(
    '\n[Secure Share] SUPABASE_FUNCTIONS_URL nao definida: o proxy /api nao vai funcionar.\n' +
      '  Rode assim (PowerShell):\n' +
      '    $env:SUPABASE_FUNCTIONS_URL="https://<ref>.supabase.co/functions/v1"; npm run dev\n',
  );
}

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(process.cwd(), './src') },
  },
  server: {
    // 5174 e do Portal Apsis e 5175 do Portal Apsis Carbon. strictPort faz o
    // comando FALHAR com a porta ocupada, em vez de subir em outra em silencio.
    port: 5176,
    strictPort: true,
    host: process.env.EXPOR_REDE === 'true' ? true : '127.0.0.1',
    proxy: DESTINO_FUNCOES
      ? {
          '/api': {
            target: DESTINO_FUNCOES,
            changeOrigin: true,
            // Espelha o rewrite da producao: /api/carbon-ss-login vira
            // <target>/carbon-ss-login.
            rewrite: (caminho) => caminho.replace(/^\/api/, ''),
          },
        }
      : undefined,
  },
});

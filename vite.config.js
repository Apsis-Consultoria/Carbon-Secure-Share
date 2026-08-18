import path from 'path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * Porta 5176, e strictPort ligado.
 *
 * 5174 e do Portal Apsis e 5175 do Portal Apsis Carbon. Os tres precisam poder
 * rodar ao mesmo tempo. O strictPort faz o comando FALHAR quando a porta esta
 * ocupada, em vez de subir em outra: o redirect do login e por porta, e subir na
 * 5177 quebraria o retorno da autenticacao sem dizer por que.
 *
 * host 127.0.0.1 por padrao para o codigo-fonte servido em dev nao ficar legivel
 * por outras maquinas da rede. Para testar no celular:
 *
 *   VITE_EXPOR_REDE=true npm run dev
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(process.cwd(), './src') },
  },
  server: {
    port: 5176,
    strictPort: true,
    host: process.env.VITE_EXPOR_REDE === 'true' ? true : '127.0.0.1',
  },
});

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { Toaster } from 'sonner';

import App from '@/App';
import { ProvedorIdioma } from '@/lib/i18n';
import '@/index.css';

/**
 * Subcaminho em que o site e servido, injetado pelo `define` do vite.config.js.
 *
 * O `typeof` NAO E PARANOIA: sem ele, um servidor de desenvolvimento que subiu
 * ANTES desta constante existir serve o modulo com o identificador cru, o
 * navegador levanta ReferenceError e a tela fica BRANCA, sem nada na interface
 * dizendo o motivo. Aconteceu no portal em 02/09/2026.
 */
const BASE_ROTAS = typeof __BASE_ROTAS__ === 'string' ? __BASE_ROTAS__ : '/';


/* =====================================================================
   Blindagem contra extensoes que mutam o DOM (dom-guard)

   O Google Tradutor (e leitores de tema escuro) envolvem os textos em <font>
   POR FORA do React. Na proxima reconciliacao o React chama
   removeChild/insertBefore em nos que ja nao sao filhos de quem ele acha que
   sao, e o app cai com NotFoundError. Workaround consagrado
   (facebook/react#11538): se o filho nao pertence ao pai esperado, degrada com
   elegancia em vez de derrubar a tela.

   Aqui isso importa MAIS do que nos portais internos: quem abre esta tela e um
   cliente, em maquina que a APSIS nao administra, com as extensoes que ele
   tiver instalado. O <html lang="pt-BR" translate="no"> do index.html e a
   primeira camada; este guard e a segunda.

   O contador window.__domGuardHits e o console.warn sao OBRIGATORIOS: sem eles
   o guard mascararia em silencio um bug real de reconciliacao nosso.
   ===================================================================== */
if (typeof Node === 'function' && Node.prototype) {
  window.__domGuardHits = 0;

  const registrar = (metodo, no) => {
    window.__domGuardHits++;
    console.warn(
      `[dom-guard] ${metodo} em nó já movido por extensão (Google Tradutor?) - degradando sem crash`,
      no,
    );
  };

  const removeChildOriginal = Node.prototype.removeChild;
  Node.prototype.removeChild = function (child) {
    if (child && child.parentNode !== this) {
      registrar('removeChild', child);
      return child;
    }
    return removeChildOriginal.apply(this, arguments);
  };

  const insertBeforeOriginal = Node.prototype.insertBefore;
  Node.prototype.insertBefore = function (newNode, referenceNode) {
    if (referenceNode && referenceNode.parentNode !== this) {
      registrar('insertBefore', referenceNode);
      // Mantem o no no DOM (no fim do pai); se ate o append falhar, devolve sem inserir.
      try {
        return this.appendChild(newNode);
      } catch {
        return newNode;
      }
    }
    return insertBeforeOriginal.apply(this, arguments);
  };
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ProvedorIdioma>
      {/*
        basename: no dominio proprio vale '/' e nada muda. No GitHub Pages de
        repositorio de projeto o site e servido em /<repo>/, e sem o basename o
        Router acha que a rota atual e "/Carbon-Secure-Share/" - que nao casa com
        nenhuma <Route> - e a tela fica vazia sem erro no console. A constante e
        injetada pelo `define` do vite.config.js.
      */}
      <BrowserRouter basename={BASE_ROTAS}>
        <App />
        <Toaster position="top-right" richColors closeButton />
      </BrowserRouter>
    </ProvedorIdioma>
  </StrictMode>,
);

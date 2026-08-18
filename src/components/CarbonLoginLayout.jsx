import { useState, useEffect } from "react";

/**
 * CarbonLoginLayout - layout de login split no padrao APSIS, versao Apsis Carbon.
 *
 * Esquerda: fundo (slideshow com crossfade das fotos de floresta) + dois overlays escuros
 *   + headline/subheadline/categorias no canto inferior esquerdo.
 * Direita: painel branco com borda esquerda curva (clip-path) + linha laranja acompanhando
 *   a curva, logo grande e a area de login (children). No mobile, empilha.
 *
 * Se nenhuma foto carregar, o FlorestaFallback em SVG assume o fundo - nada quebra e o
 * console nao mostra imagem faltando (cada <img> se esconde no onError). As imagens sao
 * self-hosted em /public/login (CSP-safe, sem depender do Storage de outro projeto).
 *
 * A logica de autenticacao NAO vive aqui: o botao entra como children (AuthGuard).
 */

// Padrao de reports da APSIS: Sora para titulos/destaques; Inter para corpo. Fallback Segoe UI.
const SORA = "'Sora', 'Segoe UI', sans-serif";
const INTER = "'Inter', 'Segoe UI', sans-serif";

const BACKGROUNDS_DEFAULT = [
  "/login/amazonia-1.jpg",
  "/login/amazonia-2.jpg",
  "/login/amazonia-3.jpg",
  "/login/amazonia-4.jpg",
  "/login/amazonia-5.jpg",
];

const CATEGORIAS_DEFAULT = [
  "Projetos de Carbono",
  "Contratos de Emissão",
  "Inventário de GEE",
  "Certificação e Verificação",
  "Relatórios ESG",
];

/** Icone oficial da Microsoft (4 quadrados). */
export function MicrosoftIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 23 23" aria-hidden="true" className="flex-shrink-0">
      <rect x="1" y="1" width="10" height="10" fill="#F25022" />
      <rect x="12" y="1" width="10" height="10" fill="#7FBA00" />
      <rect x="1" y="12" width="10" height="10" fill="#00A4EF" />
      <rect x="12" y="12" width="10" height="10" fill="#FFB900" />
    </svg>
  );
}

/**
 * Fallback de FLORESTA em SVG - base sempre presente sob as fotos.
 * No lugar do skyline de predios do portal: quatro camadas de dossel em silhueta, com
 * nevoa entre elas para dar profundidade, sobre o gradiente dos verdes profundos, mais um
 * brilho quente no centro-direita superior sugerindo o sol atravessando a mata.
 */
function FlorestaFallback() {
  return (
    <svg
      className="absolute inset-0 w-full h-full"
      viewBox="0 0 1600 900"
      preserveAspectRatio="xMidYMax slice"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="carbon-ceu" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#10291c" />
          <stop offset="55%" stopColor="#0b1d14" />
          <stop offset="100%" stopColor="#07130d" />
        </linearGradient>

        {/* Sol: laranja APSIS em opacidade muito baixa, so para aquecer o canto */}
        <radialGradient id="carbon-sol" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0%" stopColor="#F47920" stopOpacity="0.26" />
          <stop offset="45%" stopColor="#F47920" stopOpacity="0.09" />
          <stop offset="100%" stopColor="#F47920" stopOpacity="0" />
        </radialGradient>

        {/* Nevoa reaproveitada entre as camadas: banda clara que some nas duas pontas */}
        <linearGradient id="carbon-nevoa" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#bfe0cc" stopOpacity="0" />
          <stop offset="55%" stopColor="#bfe0cc" stopOpacity="0.11" />
          <stop offset="100%" stopColor="#bfe0cc" stopOpacity="0" />
        </linearGradient>
      </defs>

      <rect width="1600" height="900" fill="url(#carbon-ceu)" />

      {/* Brilho do sol no centro-direita superior */}
      <ellipse cx="1120" cy="205" rx="520" ry="330" fill="url(#carbon-sol)" />
      <circle cx="1120" cy="205" r="46" fill="#F47920" opacity="0.14" />

      {/* Camada 1 - dossel mais distante (tom mais claro: mais nevoa entre ele e a camera) */}
      <path
        fill="#10291c"
        d="M0,540 C120,500 200,522 300,506 C400,490 470,516 560,500 C660,482 740,510 840,494 C950,477 1030,508 1130,492 C1240,476 1320,506 1420,491 C1500,480 1560,500 1600,493 L1600,900 L0,900 Z"
      />
      <rect x="0" y="470" width="1600" height="190" fill="url(#carbon-nevoa)" />

      {/* Camada 2 - copas intermediarias */}
      <path
        fill="#0e241a"
        d="M0,652 C90,610 150,642 230,626 C300,612 340,584 400,600 C460,616 500,652 570,638 C650,623 700,589 780,608 C860,627 900,656 980,642 C1060,628 1110,594 1190,612 C1270,630 1310,660 1390,645 C1470,631 1530,652 1600,640 L1600,900 L0,900 Z"
      />
      <rect x="0" y="590" width="1600" height="180" fill="url(#carbon-nevoa)" />

      {/* Camada 3 - mata proxima */}
      <path
        fill="#0b1d14"
        d="M0,762 C80,730 140,756 220,742 C300,728 350,698 430,718 C510,737 560,766 640,752 C720,738 770,706 850,726 C930,745 980,774 1060,760 C1140,747 1190,714 1270,734 C1350,753 1400,780 1480,766 C1540,756 1580,772 1600,764 L1600,900 L0,900 Z"
      />
      <rect x="0" y="710" width="1600" height="150" fill="url(#carbon-nevoa)" />

      {/* Camada 4 - primeiro plano, quase silhueta pura */}
      <path
        fill="#07130d"
        d="M0,862 C60,840 100,860 170,850 C240,840 280,818 350,834 C420,850 460,870 530,860 C600,850 640,826 710,842 C780,858 820,876 890,866 C960,856 1000,832 1070,848 C1140,864 1180,882 1250,872 C1320,862 1360,840 1430,856 C1500,872 1550,882 1600,874 L1600,900 L0,900 Z"
      />
    </svg>
  );
}

/** true quando o usuario pediu menos movimento no sistema operacional. */
function useMovimentoReduzido() {
  const [reduzido, setReduzido] = useState(() => {
    if (typeof window === "undefined" || !window.matchMedia) return false;
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  });

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const aoMudar = (e) => setReduzido(e.matches);
    mq.addEventListener("change", aoMudar);
    return () => mq.removeEventListener("change", aoMudar);
  }, []);

  return reduzido;
}

export default function CarbonLoginLayout({
  children,
  logoSrc = "/login/logo-apsis-carbon.png",
  backgrounds = BACKGROUNDS_DEFAULT,
  headline = "A APSIS leva para o mercado de carbono o mesmo rigor técnico de mais de três décadas em avaliações.",
  subheadline = "Estruturação, mensuração e validação de projetos de carbono.",
  categories = CATEGORIAS_DEFAULT,
  copyright = "© 2026 APSIS Consultoria. Todos os direitos reservados.",
}) {
  const imgs = backgrounds && backgrounds.length ? backgrounds : [];
  const [idx, setIdx] = useState(0);
  const movimentoReduzido = useMovimentoReduzido();

  // Slideshow com crossfade - so ativa com 2+ imagens e se o usuario nao pediu menos movimento
  useEffect(() => {
    if (imgs.length < 2 || movimentoReduzido) return;
    const t = setInterval(() => setIdx((i) => (i + 1) % imgs.length), 6500);
    return () => clearInterval(t);
  }, [imgs.length, movimentoReduzido]);

  return (
    <div className="relative min-h-screen bg-[#07130d] overflow-hidden" style={{ fontFamily: INTER }}>
      {/*
        PONTO ÚNICO DE CALIBRAGEM DO PAINEL DE LOGIN.

        Para ajustar o verde: abra o DevTools, selecione o elemento <html> e edite estas
        variáveis na regra :root. O efeito é imediato, vale para o painel curvo do desktop
        e para a coluna empilhada do mobile ao mesmo tempo, e nada precisa recompilar.

        --carbon-painel-fundo  gradiente do painel. Os alphas controlam quanto da foto de
                               floresta atravessa o vidro: quanto menor o alpha, mais a
                               mata aparece por baixo, e menos contraste sobra para o texto.
        --carbon-painel-blur   desfoque do que está atrás do painel (o portal usa 6px).

        Referência da paleta: #1A4731 verde APSIS, #10291c, #0e241a e #07130d os verdes
        profundos do Carbon. Com os valores atuais, texto branco sobre o painel fica em
        torno de 10:1 de contraste, bem acima do mínimo AA de 4,5:1.
      */}
      <style>{`
        :root {
          --carbon-painel-fundo: linear-gradient(
            165deg,
            rgba(26, 71, 49, 0.95) 0%,
            rgba(16, 41, 28, 0.96) 45%,
            rgba(7, 19, 13, 0.97) 100%
          );
          --carbon-painel-blur: 6px;
        }

        /* No mobile nao existe o painel curvo: a propria coluna da direita e o painel,
           empilhada abaixo da foto. Pinta com a MESMA variavel para as duas nunca
           divergirem. A partir de lg o painel curvo assume e a coluna volta a ser
           transparente. O breakpoint 1024px e o lg do Tailwind. */
        .carbon-coluna-login { background: var(--carbon-painel-fundo); }
        @media (min-width: 1024px) {
          .carbon-coluna-login { background: transparent; }
        }
      `}</style>

      {/* Base: floresta em SVG sempre presente */}
      <FlorestaFallback />

      {/* Fotos: camadas empilhadas com crossfade por opacidade.
          A duracao do crossfade usa a propriedade arbitraria
          [transition-duration:1500ms] e NAO o utilitario "duration" com valor
          arbitrario. Motivo: o plugin tailwindcss-animate tambem registra
          "duration" como animation-duration, o que torna o utilitario ambiguo -
          o Tailwind avisa "matches multiple utilities" e simplesmente NAO gera a
          regra, fazendo o crossfade cair no default de 150ms do
          transition-opacity (conferido no CSS buildado do portal, que tem zero
          ocorrencias de 1500ms). A propriedade arbitraria e inequivoca.
          Este comentario evita de proposito escrever o nome da classe ambigua,
          porque o scanner de conteudo do Tailwind le comentarios tambem e
          voltaria a emitir o warning. */}
      {imgs.map((src, i) => (
        <img
          key={src}
          src={src}
          alt=""
          aria-hidden="true"
          onError={(e) => { e.currentTarget.style.display = "none"; }}
          className={`absolute inset-0 w-full h-full object-cover transition-opacity [transition-duration:1500ms] ease-in-out ${i === idx ? "opacity-100" : "opacity-0"}`}
        />
      ))}

      {/* Overlays p/ legibilidade do texto a esquerda - nao encostam no painel (mata visivel a direita) */}
      <div className="absolute inset-0" style={{ background: "linear-gradient(to right, rgba(7,19,13,.92), rgba(7,19,13,.55) 45%, rgba(7,19,13,0) 72%)" }} />
      <div className="absolute inset-0" style={{ background: "linear-gradient(to top, rgba(7,19,13,.85), rgba(7,19,13,.25), transparent)" }} />

      {/* Painel VERDE recortado pela elipse.
          O portal usa branco 90%; aqui e verde porque a arte do Apsis Carbon tem a palavra
          CARBON em branco e desaparecia no fundo claro.
          O gradiente vive na variavel CSS --carbon-painel-fundo (declarada no <style> acima),
          para poder ser calibrada no DevTools sem editar arquivo: inspecione o elemento,
          ache a regra :root e mexa no valor. A mesma variavel pinta a coluna no mobile,
          entao as duas se mantem iguais automaticamente. */}
      <div
        className="hidden lg:block absolute inset-y-0 right-0 w-[37%]"
        style={{
          clipPath: "ellipse(85% 160% at 93% 50%)",
          background: "var(--carbon-painel-fundo)",
          backdropFilter: "blur(var(--carbon-painel-blur))",
          WebkitBackdropFilter: "blur(var(--carbon-painel-blur))",
        }}
      />
      {/* ...e a LINHA laranja de 10px acompanhando a curva.
          vectorEffect="non-scaling-stroke" e o que mantem a espessura uniforme apesar do
          preserveAspectRatio="none" (sem ele a linha fica grossa em cima e fina na lateral). */}
      <svg className="hidden lg:block absolute inset-y-0 right-0 w-[37%] h-full pointer-events-none" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <ellipse cx="93" cy="50" rx="85" ry="160" fill="none" stroke="#F48126" strokeWidth="10" vectorEffect="non-scaling-stroke" />
      </svg>

      {/* Conteudo */}
      <div className="relative z-10 min-h-screen flex flex-col lg:grid lg:grid-cols-[64%_36%]">
        {/* Esquerda: headline + subheadline + categorias */}
        <div className="flex flex-col justify-end gap-6 px-8 pt-16 pb-12 lg:pl-16 lg:pr-12 lg:pb-16 text-white">
          <div className="max-w-2xl space-y-5">
            {headline && <h1 className="text-2xl lg:text-4xl font-bold leading-[1.15]" style={{ fontFamily: SORA }}>{headline}</h1>}
            {subheadline && <p className="text-lg lg:text-2xl font-light text-white/90">{subheadline}</p>}
            {categories?.length > 0 && (
              <p className="text-sm lg:text-base font-semibold text-white/95 leading-relaxed max-w-xl">
                {categories.join("  •  ")}
              </p>
            )}
          </div>
        </div>

        {/* Direita: logo a 9vh do topo + bloco de login.
            Dimensionamento por LARGURA, e nao por altura como no portal: a arte do
            Apsis Carbon e horizontal (350x100, proporcao 3,5:1), enquanto a do portal e
            quadrada (500x500 com margens internas). Um h-[235px] aqui daria 823px de
            largura dentro de um painel de ~468px e estouraria a coluna. */}
        <div className="carbon-coluna-login relative flex flex-col items-center justify-start px-6 pt-[5vh] lg:pt-[9vh] pb-16 sm:px-10">
          {logoSrc && (
            /* SLOT do logo com a altura ORIGINAL do portal (h-44 / lg:h-[235px]), com a arte
               centrada dentro dele. O slot existe para que a troca de logo nao mova nada do
               que vem abaixo: a arte do Carbon e horizontal e rende 74px (mobile) / 90px
               (desktop) de altura, contra 176px / 235px da arte quadrada do portal. Sem o
               slot, o bloco de login subia 102px / 145px. */
            <div className="h-44 lg:h-[235px] flex items-center justify-center flex-shrink-0">
              <img
                src={logoSrc}
                alt="Apsis Carbon"
                className="w-[260px] lg:w-[340px] h-auto object-contain"
                onError={(e) => { e.currentTarget.style.display = "none"; }}
              />
            </div>
          )}
          {/* pt-[52px] lg:pt-[56px] devolve exatamente o espaco que o titulo "APSIS CARBON"
              em texto ocupava antes de sair (h1 de 36px/40px + o gap-4 de 16px do bloco,
              medido no navegador). Junto com o slot do logo acima, o botao de login volta a
              cair na mesma posicao de antes da troca de logo. */}
          <div className="w-full max-w-sm flex flex-col items-center gap-4 mt-8 pt-[52px] lg:mt-[11vh] lg:pt-[56px]">{children}</div>
          {copyright && (
            <p className="absolute bottom-5 inset-x-0 px-6 text-center text-[11px] text-white/45">{copyright}</p>
          )}
        </div>
      </div>
    </div>
  );
}

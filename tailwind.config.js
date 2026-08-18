/** @type {import('tailwindcss').Config} */
// CommonJS de proposito (igual ao portal): o Tailwind carrega o config com jiti,
// entao module.exports funciona mesmo com "type": "module" no package.json.
// Se algum dia o build reclamar, renomeie para tailwind.config.cjs em vez de
// converter para ESM sem testar.
module.exports = {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        // Sora para titulos e destaques, Inter para corpo. Fallback 'Segoe UI'
        // porque e a fonte padrao do Windows nas maquinas da APSIS.
        sora: ["'Sora'", "'Segoe UI'", 'sans-serif'],
        inter: ["'Inter'", "'Segoe UI'", 'sans-serif'],
        // Nao acrescente familia que nenhum componente usa: o @import do
        // src/index.css teria de baixar os pesos dela em toda visita.
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      colors: {
        // ─ Paleta APSIS em nomes semanticos (pt-BR) ─
        apsis: {
          verde: '#1A4731',
          verdeClaro: '#245E40',
          laranja: '#F47920',
          laranjaClaro: '#F9A15A',
          // ATENCAO: dois laranjas convivem de propósito no codigo.
          // #F47920 e o laranja do shell/padrao visual; #F48126 e o laranja
          // aprovado da tela de login (curva da elipse + palavra CARBON).
          // Nao unifique sem decisao explicita.
          laranjaLogin: '#F48126',
          cinza: '#E8EDE9',
          borda: '#DDE3DE',
          texto: '#1A2B1F',
          textoSecundario: '#5C7060',
          textoTerciario: '#8A9990',
          fundo: '#F4F6F4',
        },
        // ─ Verdes profundos do fundo da tela de login ─
        carbono: {
          900: '#07130d',
          800: '#0e241a',
          700: '#10291c',
        },
        // ─ Tokens shadcn: DEVEM permanecer mesmo sem shadcn instalado.
        //   O index.css aplica "@apply border-border outline-ring/50" no
        //   seletor universal; sem estes mapeamentos o build do Tailwind falha.
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
      },
      /**
       * FONTE DE VERDADE DAS ANIMACOES DO SHELL E DA BOAS-VINDAS: os blocos
       * <style> de src/Layout.jsx (fadeIn, logoSlideLR) e src/pages/BoasVindas.jsx
       * (fadeUp), no padrao herdado do portal. Nao redeclare fadeUp/fadeIn/
       * logoSlideLR aqui: as classes animate-* correspondentes nao eram usadas em
       * nenhum arquivo, e a duplicata fazia parecer que editar este arquivo mudava
       * a animacao da tela - nao mudava.
       */
      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
}

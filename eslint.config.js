import globals from 'globals'
import pluginJs from '@eslint/js'
import pluginReact from 'eslint-plugin-react'
import pluginReactHooks from 'eslint-plugin-react-hooks'
import pluginUnusedImports from 'eslint-plugin-unused-imports'

// IMPORTANTE: cada preset entra como um ITEM SEPARADO do array.
// O eslint.config.js do portal faz spread de pluginJs.configs.recommended E de
// pluginReact.configs.flat.recommended dentro do MESMO objeto - o segundo spread
// sobrescreve a chave "rules" do primeiro e as regras do js/recommended sao
// silenciosamente perdidas. Aqui isso nao acontece.
export default [
  {
    ignores: ['dist/**', 'node_modules/**', 'supabase/**', 'public/**'],
  },
  {
    files: ['src/**/*.{js,mjs,cjs,jsx}'],
    ...pluginJs.configs.recommended,
  },
  {
    files: ['src/**/*.{js,mjs,cjs,jsx}'],
    ...pluginReact.configs.flat.recommended,
  },
  {
    files: ['src/**/*.{js,mjs,cjs,jsx}'],
    languageOptions: {
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
        ecmaFeatures: { jsx: true },
      },
    },
    settings: {
      react: { version: 'detect' },
    },
    plugins: {
      react: pluginReact,
      'react-hooks': pluginReactHooks,
      'unused-imports': pluginUnusedImports,
    },
    rules: {
      // no-unused-vars nativo desligado: quem cuida disso e o unused-imports,
      // que sabe diferenciar import nao usado de variavel nao usada.
      'no-unused-vars': 'off',
      'unused-imports/no-unused-imports': 'error',
      'unused-imports/no-unused-vars': [
        'warn',
        {
          vars: 'all',
          varsIgnorePattern: '^_',
          args: 'after-used',
          argsIgnorePattern: '^_',
        },
      ],
      'react/jsx-uses-vars': 'error',
      'react/jsx-uses-react': 'error',
      // Sem PropTypes e sem import de React em escopo (JSX automatico do React 18).
      'react/prop-types': 'off',
      'react/react-in-jsx-scope': 'off',
      'react-hooks/rules-of-hooks': 'error',
    },
  },
]

// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'dist-electron/**',
      'release/**',
      'build/**',
      'public/**',
      'node_modules/**',
      'signaling/**',
      'scripts/**',
      '*.html',
      '*.log',
      'logo-options.html',
    ],
  },
  // Base recommended rules.
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: {
      'react-hooks': reactHooks,
    },
    languageOptions: {
      globals: {
        window: 'readonly',
        document: 'readonly',
        navigator: 'readonly',
        localStorage: 'readonly',
        crypto: 'readonly',
        console: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        fetch: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        Audio: 'readonly',
        AudioContext: 'readonly',
        AnalyserNode: 'readonly',
        MediaStream: 'readonly',
        MediaStreamAudioSourceNode: 'readonly',
        MediaStreamTrack: 'readonly',
        RTCPeerConnection: 'readonly',
        RTCDataChannel: 'readonly',
        RTCIceServer: 'readonly',
        WebSocket: 'readonly',
        AbortController: 'readonly',
        FileReader: 'readonly',
        Blob: 'readonly',
        File: 'readonly',
        FormData: 'readonly',
        DOMException: 'readonly',
        ErrorEvent: 'readonly',
        PromiseRejectionEvent: 'readonly',
        HTMLAudioElement: 'readonly',
        HTMLVideoElement: 'readonly',
        HTMLDivElement: 'readonly',
        HTMLInputElement: 'readonly',
        HTMLElement: 'readonly',
        Intl: 'readonly',
        performance: 'readonly',
        confirm: 'readonly',
        alert: 'readonly',
        prompt: 'readonly',
        process: 'readonly',
      },
    },
    rules: {
      // CRITICAL: prevents the v1.7.1 / v1.7.7 hook order bug from ever happening again.
      'react-hooks/rules-of-hooks': 'error',
      // Useful but not blocking — warns on missing deps in useEffect/useMemo.
      'react-hooks/exhaustive-deps': 'warn',
      // Disable rules that are too noisy for this codebase right now.
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-empty': 'off',
      'no-undef': 'off', // TS handles this
    },
  },
  {
    // App version is a Vite-injected global in the renderer.
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      globals: {
        __APP_VERSION__: 'readonly',
      },
    },
  }
);

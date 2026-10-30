import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import pkg from './package.json';

/**
 * 시그널링 주소(VITE_SIGNALING_URL)가 «이 PC 의 시험 서버»(ws://127.0.0.1:8787 같은) 일 때만, index.html 의 CSP connect-src 에
 * 그 주소를 더한다. 기본 CSP 는 wss:/https: 뿐이라 ws://·http:// 로의 연결을 막으므로, 그대로 두면 로컬 서버로 화면 시험을 할 때
 * 서버가 멀쩡해도 «연결 안 됨» 으로 보인다.
 * 운영 빌드(주소를 안 주거나 wss://)는 CSP 가 그대로다. 로컬이 아닌 ws:// 주소는 넣지 않는다.
 */
function localSignalingCsp(signalingUrl: string | undefined): Plugin {
  let extra: string[] = [];
  try {
    const u = new URL(signalingUrl ?? '');
    const local = u.hostname === '127.0.0.1' || u.hostname === 'localhost' || u.hostname === '[::1]';
    if (local && (u.protocol === 'ws:' || u.protocol === 'http:')) {
      extra = [`ws://${u.host}`, `http://${u.host}`];
    }
  } catch {
    // 주소가 없거나 올바르지 않다 — CSP 를 건드리지 않는다
  }
  return {
    name: 'pikmeeting-local-signaling-csp',
    transformIndexHtml(html) {
      if (extra.length === 0) return html;
      return html.replace("connect-src 'self' wss: https:", `connect-src 'self' wss: https: ${extra.join(' ')}`);
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  return {
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version),
    },
    plugins: [react(), localSignalingCsp(env.VITE_SIGNALING_URL)],
    base: './',
    server: {
      port: 5173,
      strictPort: true,
      // Test output and build folders are not app source. Excel holds its temp
      // files locked while rendering into mockups/, and watching them crashed
      // the dev server (EBUSY).
      watch: { ignored: ['**/mockups/**', '**/release/**', '**/signaling/**'] },
    },
    build: {
      outDir: 'dist',
      emptyOutDir: true,
    },
  };
});

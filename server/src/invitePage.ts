export const RELEASES_URL = "https://github.com/llorenzocardoso/telinha/releases/latest";

// O mesmo ícone de src/assets/telinha-logo.svg, embutido para a página não depender de arquivos.
const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" aria-hidden="true"><rect width="1024" height="1024" rx="196" fill="#111214"/><rect x="202" y="246" width="620" height="438" rx="92" fill="none" stroke="#F2F3F5" stroke-width="68"/><path d="M382 386H642V454H548V625H476V454H382Z" fill="#F2F3F5"/><path d="M512 684V752M396 776H628" fill="none" stroke="#F2F3F5" stroke-width="62" stroke-linecap="round"/><circle cx="716" cy="354" r="42" fill="#F04A50"/></svg>`;

/**
 * Página do link de convite. Com `webAppUrl`, quem não está num Windows de mesa (Mac, Linux,
 * celular) vai direto para a versão web, e no Windows o app abre com a web como alternativa.
 */
export function renderInvitePage(code: string, webAppUrl?: string): string {
  const deepLink = `telinha://join/${code}`;
  const webLink = webAppUrl ? `${webAppUrl.replace(/\/+$/, "")}/j/${code}` : null;
  const openApp = `window.location.href = ${JSON.stringify(deepLink)};`;
  const script = webLink
    ? `var ua = navigator.userAgent;
var windowsDesktop = /Windows NT/.test(ua) && !/Mobile|Android/.test(ua);
if (windowsDesktop) { ${openApp} } else { window.location.replace(${JSON.stringify(webLink)}); }`
    : openApp;
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Entrar na sala ${code} - Telinha</title>
<link rel="icon" href="data:image/svg+xml,${encodeURIComponent(LOGO_SVG)}">
<style>
  /* Mesmos tokens do app (src/styles/tokens.css), sem as fontes embutidas. */
  :root {
    color-scheme: dark;
    --bg: #0b0b0c; --surface-1: #151517; --surface-4: #2c2c30; --line: #3a3a3f;
    --text: #f5f5f5; --text-2: #c7c7cc; --muted: #8e8e93; --faint: #6e6e73;
    --font-sans: "Geist", "Segoe UI", system-ui, -apple-system, sans-serif;
    --font-mono: "JetBrains Mono", ui-monospace, "Cascadia Mono", Consolas, monospace;
  }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 24px; background: var(--bg); color: var(--text); font-family: var(--font-sans); -webkit-font-smoothing: antialiased; }
  main { display: flex; width: 100%; max-width: 400px; flex-direction: column; gap: 24px; }
  header { display: flex; flex-direction: column; align-items: center; gap: 8px; text-align: center; }
  header svg { width: 72px; height: 72px; margin-bottom: 8px; }
  h1 { margin: 0; font-family: var(--font-mono); font-size: 30px; font-weight: 500; letter-spacing: -0.02em; }
  header p { margin: 0; color: var(--muted); font-size: 14px; }
  .card { display: flex; flex-direction: column; gap: 12px; padding: 20px; border: 1px solid var(--line); border-radius: 14px; background: var(--surface-1); }
  .label { color: var(--faint); font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; }
  .code { font-family: var(--font-mono); font-size: 24px; font-weight: 500; letter-spacing: 0.1em; }
  .status { margin: 0 0 4px; color: var(--muted); font-size: 13px; line-height: 1.45; }
  .button { display: flex; align-items: center; justify-content: center; height: 44px; padding: 0 20px; border: 1px solid transparent; border-radius: 10px; font-size: 14px; font-weight: 500; text-decoration: none; transition: background 0.15s ease; }
  .button.primary { background: var(--text); color: var(--bg); }
  .button.primary:hover { background: var(--text-2); }
  .button.outline { border-color: var(--line); color: var(--text); }
  .button.outline:hover { background: var(--surface-4); }
  .note { margin: 0; color: var(--faint); font-size: 13px; text-align: center; }
  .note a { color: var(--text-2); }
</style>
</head>
<body>
<main>
  <header>
    ${LOGO_SVG}
    <h1>Telinha</h1>
    <p>Compartilhe sua tela em segundos.</p>
  </header>
  <section class="card" aria-labelledby="sala">
    <span class="label" id="sala">Convite para a sala</span>
    <span class="code">${code}</span>
    <p class="status" aria-live="polite">Abrindo o Telinha...</p>
    <a class="button primary" href="${deepLink}">Abrir no Telinha</a>${webLink ? `
    <a class="button outline" href="${webLink}">Entrar pelo navegador</a>` : ""}
  </section>
  <p class="note">Não abriu? <a href="${RELEASES_URL}">Baixe o Telinha</a></p>
</main>
<script>${script}</script>
</body>
</html>
`;
}

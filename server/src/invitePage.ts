export const RELEASES_URL = "https://github.com/llorenzocardoso/telinha/releases/latest";

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
<style>
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #1e1f22; color: #fff; font-family: system-ui, sans-serif; }
  main { text-align: center; padding: 24px; }
  .actions { display: flex; flex-wrap: wrap; gap: 12px; justify-content: center; margin: 16px 0; }
  a.open, a.web { display: inline-block; padding: 10px 20px; border-radius: 8px; color: #fff; text-decoration: none; font-weight: 600; }
  a.open { background: #5865f2; }
  a.web { background: #4e5058; }
  a.download { color: #b5bac1; font-size: 0.85rem; }
</style>
</head>
<body>
<main>
  <h1>Sala ${code}</h1>
  <p>Abrindo o Telinha...</p>
  <div class="actions">
    <a class="open" href="${deepLink}">Abrir no Telinha</a>${webLink ? `
    <a class="web" href="${webLink}">Entrar pelo navegador</a>` : ""}
  </div>
  <p><a class="download" href="${RELEASES_URL}">Não abriu? Baixe o Telinha</a></p>
</main>
<script>${script}</script>
</body>
</html>
`;
}

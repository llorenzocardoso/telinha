export const RELEASES_URL = "https://github.com/llorenzocardoso/telinha/releases/latest";

export function renderInvitePage(code: string): string {
  const deepLink = `telinha://join/${code}`;
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Entrar na sala ${code} - Telinha</title>
<style>
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #1e1f22; color: #fff; font-family: system-ui, sans-serif; }
  main { text-align: center; padding: 24px; }
  a.open { display: inline-block; margin: 16px 0; padding: 10px 20px; border-radius: 8px; background: #5865f2; color: #fff; text-decoration: none; font-weight: 600; }
  a.download { color: #b5bac1; font-size: 0.85rem; }
</style>
</head>
<body>
<main>
  <h1>Sala ${code}</h1>
  <p>Abrindo o Telinha...</p>
  <a class="open" href="${deepLink}">Abrir no Telinha</a>
  <p><a class="download" href="${RELEASES_URL}">Não abriu? Baixe o Telinha</a></p>
</main>
<script>window.location.href = ${JSON.stringify(deepLink)};</script>
</body>
</html>
`;
}

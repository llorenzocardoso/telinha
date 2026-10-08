# Fontes embutidas

A CSP do app é `font-src 'self'` (veja `src-tauri/tauri.conf.json`), então as fontes vêm do bundle,
nunca de um CDN.

| Arquivo | Origem | Licença |
| --- | --- | --- |
| `geist-variable.woff2` | pacote npm `geist@1.3.1`, `dist/fonts/geist-sans/Geist-Variable.woff2` | OFL 1.1 — `Geist-LICENSE.txt` |
| `jetbrains-mono-400.woff2` | pacote npm `@fontsource/jetbrains-mono@5.1.1`, subconjunto latin | OFL 1.1 — `JetBrainsMono-LICENSE.txt` |
| `jetbrains-mono-500.woff2` | idem, peso 500 | idem |

O Geist é variável: um arquivo cobre os pesos 400, 500 e 600 que a interface usa. Os pacotes npm
não são dependências do projeto — só a origem dos binários.

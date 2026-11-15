//! Discord Rich Presence: "Ao vivo no Telinha" no perfil, com um botão que abre o convite da sala.
//!
//! O frontend decide o texto e se o botão aparece (opção "Status do Discord" no seletor de tela);
//! aqui só validamos o que vai para o Discord e mantemos a conexão IPC viva.

use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};

use discord_rich_presence::{
    activity::{Activity, Assets, Button, Timestamps},
    DiscordIpc, DiscordIpcClient,
};
use serde::Deserialize;

/// ID do aplicativo do Discord embutido na build (variável do GitHub Actions na release).
const BUILD_APP_ID: Option<&str> = option_env!("TELINHA_DISCORD_APP_ID");

/// Chave da imagem enviada em Rich Presence → Art Assets no Developer Portal.
const LARGE_IMAGE_KEY: &str = "telinha";

/// Limites do Discord para os campos da atividade.
const MAX_DETAILS: usize = 128;
const MAX_BUTTON_LABEL: usize = 32;
const MAX_BUTTON_URL: usize = 512;

/// Sem mudança, a atividade é reenviada de tempos em tempos: é o único jeito de notar que o
/// Discord fechou e reconectar quando ele voltar. Fica bem abaixo do limite de 5 envios a cada 20 s.
const REFRESH_EVERY: Duration = Duration::from_secs(15);
const POLL_EVERY: Duration = Duration::from_secs(1);

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PresenceRequest {
    pub details: String,
    pub button_label: Option<String>,
    pub button_url: Option<String>,
    /// Início em segundos Unix (desde quando está ao vivo ou na sala).
    pub started_at: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct Presence {
    details: String,
    button: Option<(String, String)>,
    started_at: Option<i64>,
}

struct State {
    presence: Option<Presence>,
    generation: u64,
}

static STATE: Mutex<State> = Mutex::new(State {
    presence: None,
    generation: 0,
});

fn is_snowflake(value: &str) -> bool {
    (17..=20).contains(&value.len()) && value.bytes().all(|byte| byte.is_ascii_digit())
}

/// A variável de ambiente sobrescreve o ID da build (útil em desenvolvimento).
fn resolve_app_id(runtime: Option<String>, build: Option<&str>) -> Option<String> {
    let runtime = runtime.map(|value| value.trim().to_string());
    runtime.filter(|value| is_snowflake(value)).or_else(|| {
        build
            .map(str::trim)
            .filter(|value| is_snowflake(value))
            .map(str::to_string)
    })
}

fn app_id() -> Option<String> {
    resolve_app_id(std::env::var("TELINHA_DISCORD_APP_ID").ok(), BUILD_APP_ID)
}

fn truncate(value: &str, max: usize) -> String {
    value.trim().chars().take(max).collect()
}

/// Rejeita o que o Discord recusaria: um botão inválido derruba a atividade inteira.
fn sanitize(request: PresenceRequest) -> Option<Presence> {
    let details = truncate(&request.details, MAX_DETAILS);
    if details.chars().count() < 2 {
        return None;
    }
    let button = match (request.button_label, request.button_url) {
        (Some(label), Some(url)) => {
            let label = truncate(&label, MAX_BUTTON_LABEL);
            let url = url.trim().to_string();
            let valid_url = url.starts_with("https://")
                && url.len() <= MAX_BUTTON_URL
                && !url.chars().any(char::is_whitespace);
            (!label.is_empty() && valid_url).then_some((label, url))
        }
        _ => None,
    };
    let started_at = request.started_at.filter(|value| *value > 0);
    Some(Presence {
        details,
        button,
        started_at,
    })
}

#[tauri::command]
pub fn set_discord_presence(presence: Option<PresenceRequest>) -> Result<(), String> {
    let next = presence.and_then(sanitize);
    let mut state = STATE.lock().map_err(|e| e.to_string())?;
    if state.presence != next {
        state.presence = next;
        state.generation = state.generation.wrapping_add(1);
    }
    Ok(())
}

fn snapshot() -> (u64, Option<Presence>) {
    STATE
        .lock()
        .map(|state| (state.generation, state.presence.clone()))
        .unwrap_or((0, None))
}

fn send(client: &mut DiscordIpcClient, presence: Option<&Presence>) -> bool {
    let result = match presence {
        Some(presence) => {
            let mut activity = Activity::new().details(&presence.details).assets(
                Assets::new()
                    .large_image(LARGE_IMAGE_KEY)
                    .large_text("Telinha"),
            );
            if let Some(start) = presence.started_at {
                activity = activity.timestamps(Timestamps::new().start(start));
            }
            if let Some((label, url)) = &presence.button {
                activity = activity.buttons(vec![Button::new(label, url)]);
            }
            client.set_activity(activity)
        }
        None => client.clear_activity(),
    };
    result.is_ok()
}

pub fn start_presence_loop() {
    thread::spawn(|| {
        let Some(id) = app_id() else {
            return;
        };
        loop {
            let Ok(mut client) = DiscordIpcClient::new(&id) else {
                thread::sleep(Duration::from_secs(15));
                continue;
            };
            if client.connect().is_err() {
                thread::sleep(Duration::from_secs(8));
                continue;
            }

            let mut sent: Option<u64> = None;
            let mut last_send = Instant::now();
            loop {
                let (generation, presence) = snapshot();
                if sent != Some(generation) || last_send.elapsed() >= REFRESH_EVERY {
                    if !send(&mut client, presence.as_ref()) {
                        let _ = client.close();
                        break;
                    }
                    sent = Some(generation);
                    last_send = Instant::now();
                }
                thread::sleep(POLL_EVERY);
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    const ID: &str = "1234567890123456789";

    fn request(details: &str, label: Option<&str>, url: Option<&str>) -> PresenceRequest {
        PresenceRequest {
            details: details.into(),
            button_label: label.map(Into::into),
            button_url: url.map(Into::into),
            started_at: Some(1_700_000_000),
        }
    }

    #[test]
    fn app_id_prefers_runtime_then_build() {
        assert_eq!(
            resolve_app_id(Some(format!(" {ID} ")), None),
            Some(ID.into())
        );
        assert_eq!(resolve_app_id(None, Some(ID)), Some(ID.into()));
        assert_eq!(
            resolve_app_id(Some("98765432109876543".into()), Some(ID)),
            Some("98765432109876543".into())
        );
    }

    #[test]
    fn app_id_rejects_placeholders_and_garbage() {
        assert_eq!(
            resolve_app_id(Some("your_discord_app_id".into()), None),
            None
        );
        assert_eq!(resolve_app_id(Some(String::new()), Some("")), None);
        assert_eq!(resolve_app_id(Some("123".into()), None), None);
        // Um valor inválido em tempo de execução não esconde o ID bom da build.
        assert_eq!(
            resolve_app_id(Some("abc".into()), Some(ID)),
            Some(ID.into())
        );
    }

    #[test]
    fn keeps_https_button() {
        let presence = sanitize(request(
            "Ao vivo no Telinha",
            Some("Assistir no Telinha"),
            Some("https://telinha-server.onrender.com/j/ABC123"),
        ))
        .unwrap();
        assert_eq!(presence.details, "Ao vivo no Telinha");
        assert_eq!(
            presence.button,
            Some((
                "Assistir no Telinha".into(),
                "https://telinha-server.onrender.com/j/ABC123".into()
            ))
        );
        assert_eq!(presence.started_at, Some(1_700_000_000));
    }

    #[test]
    fn drops_button_the_discord_would_refuse() {
        for url in [
            "http://localhost:3001/j/ABC123",
            "telinha://join/ABC123",
            "https://a b",
        ] {
            let presence =
                sanitize(request("Ao vivo no Telinha", Some("Assistir"), Some(url))).unwrap();
            assert_eq!(presence.button, None, "{url}");
        }
        let long = format!("https://x.dev/{}", "a".repeat(600));
        assert_eq!(
            sanitize(request("Na sala", Some("Entrar"), Some(&long)))
                .unwrap()
                .button,
            None
        );
        let blank = sanitize(request("Na sala", Some("  "), Some("https://x.dev/j/A"))).unwrap();
        assert_eq!(blank.button, None);
        let no_url = sanitize(request("Na sala", Some("Entrar"), None)).unwrap();
        assert_eq!(no_url.button, None);
    }

    #[test]
    fn trims_to_discord_limits() {
        let presence = sanitize(request(
            &"x".repeat(200),
            Some(&"y".repeat(40)),
            Some("https://x.dev/j/A"),
        ))
        .unwrap();
        assert_eq!(presence.details.chars().count(), MAX_DETAILS);
        assert_eq!(presence.button.unwrap().0.chars().count(), MAX_BUTTON_LABEL);
    }

    #[test]
    fn rejects_empty_details_and_bad_start() {
        assert_eq!(sanitize(request(" ", None, None)), None);
        let mut req = request("Na sala", None, None);
        req.started_at = Some(0);
        assert_eq!(sanitize(req).unwrap().started_at, None);
    }
}

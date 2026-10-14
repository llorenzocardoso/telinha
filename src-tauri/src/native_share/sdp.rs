//! Small pure SDP edits for the native sender.

/// Max average bitrate offered for the stereo Opus stream, bits per second.
pub const OPUS_MAX_AVERAGE_BITRATE: u32 = 192_000;

/// Marks the Opus stream in an offer as stereo, high bitrate music-grade audio.
///
/// libwebrtc offers Opus as `minptime=10;useinbandfec=1`, which a browser answers (and the sender
/// then encodes) as mono. Desktop audio is stereo, so `stereo=1;sprop-stereo=1` and a higher
/// `maxaveragebitrate` go on the Opus `fmtp` line; the receiver's answer echoes them.
#[cfg_attr(not(windows), allow(dead_code))]
pub fn enable_opus_stereo(sdp: &str) -> String {
    let newline = if sdp.contains("\r\n") { "\r\n" } else { "\n" };
    let lines: Vec<&str> = sdp.split(newline).collect();
    let Some(payload_type) = lines.iter().find_map(|line| opus_payload_type(line)) else {
        return sdp.to_string();
    };
    let extra = format!("stereo=1;sprop-stereo=1;maxaveragebitrate={OPUS_MAX_AVERAGE_BITRATE}");
    let fmtp_prefix = format!("a=fmtp:{payload_type} ");
    let rtpmap_prefix = format!("a=rtpmap:{payload_type} ");

    let mut has_fmtp = false;
    let mut out: Vec<String> = Vec::with_capacity(lines.len() + 1);
    for line in &lines {
        if let Some(parameters) = line.strip_prefix(&fmtp_prefix) {
            has_fmtp = true;
            if parameters.contains("stereo=1") {
                out.push((*line).to_string());
            } else {
                out.push(format!("{line};{extra}"));
            }
        } else {
            out.push((*line).to_string());
        }
    }
    if !has_fmtp {
        // No fmtp line at all: add one right after the rtpmap line.
        if let Some(index) = out.iter().position(|line| line.starts_with(&rtpmap_prefix)) {
            out.insert(index + 1, format!("{fmtp_prefix}{extra}"));
        }
    }
    out.join(newline)
}

/// The payload type of an `a=rtpmap:<pt> opus/48000/2` line.
#[cfg_attr(not(windows), allow(dead_code))]
fn opus_payload_type(line: &str) -> Option<u32> {
    let rest = line.strip_prefix("a=rtpmap:")?;
    let (payload_type, codec) = rest.split_once(' ')?;
    codec
        .to_ascii_lowercase()
        .starts_with("opus/48000")
        .then(|| payload_type.parse().ok())
        .flatten()
}

#[cfg(test)]
mod tests {
    use super::*;

    const OFFER: &str = "v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=rtpmap:111 opus/48000/2\r\na=fmtp:111 minptime=10;useinbandfec=1\r\nm=video 9 UDP/TLS/RTP/SAVPF 102\r\na=rtpmap:102 H264/90000\r\na=fmtp:102 packetization-mode=1\r\n";

    #[test]
    fn appends_stereo_parameters_to_the_opus_fmtp_line() {
        let out = enable_opus_stereo(OFFER);
        assert!(out.contains(
            "a=fmtp:111 minptime=10;useinbandfec=1;stereo=1;sprop-stereo=1;maxaveragebitrate=192000\r\n"
        ));
    }

    #[test]
    fn leaves_other_codecs_and_line_endings_alone() {
        let out = enable_opus_stereo(OFFER);
        assert!(out.contains("a=fmtp:102 packetization-mode=1\r\n"));
        assert!(!out.contains("\r\n\n") && !out.replace("\r\n", "").contains('\n'));
        // Only the Opus line is touched (`sprop-stereo=1` contains `stereo=1`, so match the pair).
        assert_eq!(out.matches(";stereo=1;sprop-stereo=1").count(), 1);
    }

    #[test]
    fn is_idempotent() {
        let once = enable_opus_stereo(OFFER);
        assert_eq!(enable_opus_stereo(&once), once);
    }

    #[test]
    fn adds_an_fmtp_line_when_opus_has_none() {
        let sdp = "m=audio 9 UDP/TLS/RTP/SAVPF 111\na=rtpmap:111 opus/48000/2\na=sendonly\n";
        let out = enable_opus_stereo(sdp);
        assert_eq!(
            out,
            "m=audio 9 UDP/TLS/RTP/SAVPF 111\na=rtpmap:111 opus/48000/2\na=fmtp:111 stereo=1;sprop-stereo=1;maxaveragebitrate=192000\na=sendonly\n"
        );
    }

    #[test]
    fn without_opus_the_sdp_is_unchanged() {
        let sdp = "v=0\r\nm=video 9 UDP/TLS/RTP/SAVPF 102\r\na=rtpmap:102 H264/90000\r\n";
        assert_eq!(enable_opus_stereo(sdp), sdp);
    }
}

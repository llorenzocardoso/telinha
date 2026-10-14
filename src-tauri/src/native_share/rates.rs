//! Pure rate rules for the native sender: what the shared encoder is told, and what a viewer on a
//! relayed route may be sent.

/// The rate the (single, shared) encoder must produce.
///
/// Every viewer has its own congestion controller and asks for the rate its path can carry. One
/// encoder serves them all, so the slowest viewer sets the pace; anything faster would be sent to
/// a viewer that cannot take it and fill its queue. Viewers that have not asked yet (`0`) do not
/// count. `None` when nobody has asked.
pub fn combine_targets(targets: &[u64], min: u64, max: u64) -> Option<u64> {
    targets
        .iter()
        .copied()
        .filter(|target| *target > 0)
        .min()
        .map(|target| target.clamp(min, max.max(min)))
}

/// The most one viewer's estimator may reach. A viewer reached through a TURN relay is held to the
/// server's relay cap (relayed traffic is billed and often rate limited); everyone else gets `max`.
pub fn viewer_cap(max: u64, relay_cap: Option<u64>, relay: bool, min: u64) -> u64 {
    match (relay, relay_cap) {
        (true, Some(cap)) => cap.clamp(min, max.max(min)),
        _ => max,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const MIN: u64 = 500_000;
    const MAX: u64 = 10_000_000;

    #[test]
    fn the_slowest_viewer_sets_the_pace() {
        assert_eq!(
            combine_targets(&[8_000_000, 3_000_000, 6_000_000], MIN, MAX),
            Some(3_000_000)
        );
    }

    #[test]
    fn viewers_that_have_not_asked_yet_do_not_count() {
        assert_eq!(
            combine_targets(&[0, 4_000_000, 0], MIN, MAX),
            Some(4_000_000)
        );
        assert_eq!(combine_targets(&[0, 0], MIN, MAX), None);
        assert_eq!(combine_targets(&[], MIN, MAX), None);
    }

    #[test]
    fn the_result_stays_within_the_encoder_range() {
        assert_eq!(combine_targets(&[100_000], MIN, MAX), Some(MIN));
        assert_eq!(combine_targets(&[50_000_000], MIN, MAX), Some(MAX));
    }

    #[test]
    fn relayed_viewers_are_held_to_the_relay_cap() {
        assert_eq!(viewer_cap(MAX, Some(4_000_000), true, MIN), 4_000_000);
        // Direct routes ignore it.
        assert_eq!(viewer_cap(MAX, Some(4_000_000), false, MIN), MAX);
        // No cap configured: nothing changes on a relay.
        assert_eq!(viewer_cap(MAX, None, true, MIN), MAX);
    }

    #[test]
    fn a_relay_cap_never_goes_below_the_floor_or_above_the_share_maximum() {
        assert_eq!(viewer_cap(MAX, Some(100_000), true, MIN), MIN);
        assert_eq!(viewer_cap(2_000_000, Some(9_000_000), true, MIN), 2_000_000);
    }
}

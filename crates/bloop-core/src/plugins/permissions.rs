use url::Url;

use super::manifest::Permissions;
use crate::error::{EngineError, EngineResult};

pub fn assert_network(permissions: &Permissions, url: &str) -> EngineResult<Url> {
    let parsed = Url::parse(url).map_err(|error| EngineError::Network(error.to_string()))?;
    let host = parsed
        .host_str()
        .ok_or_else(|| EngineError::Permission("url has no host".into()))?;
    if !permissions
        .network
        .iter()
        .any(|allowed| host_matches(host, allowed))
    {
        return Err(EngineError::Permission(format!(
            "network access to {host} is not granted"
        )));
    }
    if parsed.scheme() != "https" && parsed.scheme() != "http" {
        return Err(EngineError::Permission("only http(s) is allowed".into()));
    }
    Ok(parsed)
}

pub fn assert_storage(permissions: &Permissions) -> EngineResult<()> {
    if permissions.storage {
        Ok(())
    } else {
        Err(EngineError::Permission("storage is not granted".into()))
    }
}

pub fn assert_media(permissions: &Permissions) -> EngineResult<()> {
    if permissions.media {
        Ok(())
    } else {
        Err(EngineError::Permission("media is not granted".into()))
    }
}

pub fn assert_audio(permissions: &Permissions) -> EngineResult<()> {
    if permissions.audio {
        Ok(())
    } else {
        Err(EngineError::Permission("audio is not granted".into()))
    }
}

pub fn assert_devices(permissions: &Permissions) -> EngineResult<()> {
    if permissions.devices {
        Ok(())
    } else {
        Err(EngineError::Permission("devices is not granted".into()))
    }
}

fn host_matches(host: &str, allowed: &str) -> bool {
    let allowed = allowed
        .trim()
        .trim_start_matches("https://")
        .trim_start_matches("http://");
    let allowed = allowed.split('/').next().unwrap_or(allowed);
    if let Some(rest) = allowed.strip_prefix("*.") {
        host == rest || host.ends_with(&format!(".{rest}"))
    } else {
        host.eq_ignore_ascii_case(allowed)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::plugins::manifest::Permissions;

    #[test]
    fn allowlist_is_enforced() {
        let permissions = Permissions {
            network: vec!["api.example.com".into(), "*.cdn.example".into()],
            ..Permissions::default()
        };
        assert!(assert_network(&permissions, "https://api.example.com/v1").is_ok());
        assert!(assert_network(&permissions, "https://img.cdn.example/x").is_ok());
        assert!(assert_network(&permissions, "https://evil.example").is_err());
    }

    #[test]
    fn storage_requires_grant() {
        assert!(assert_storage(&Permissions::default()).is_err());
        assert!(
            assert_storage(&Permissions {
                storage: true,
                ..Permissions::default()
            })
            .is_ok()
        );
    }

    #[test]
    fn media_requires_grant() {
        assert!(assert_media(&Permissions::default()).is_err());
        assert!(
            assert_media(&Permissions {
                media: true,
                ..Permissions::default()
            })
            .is_ok()
        );
    }

    #[test]
    fn audio_requires_grant() {
        assert!(assert_audio(&Permissions::default()).is_err());
        assert!(
            assert_audio(&Permissions {
                audio: true,
                ..Permissions::default()
            })
            .is_ok()
        );
    }

    #[test]
    fn devices_requires_grant() {
        assert!(assert_devices(&Permissions::default()).is_err());
        assert!(
            assert_devices(&Permissions {
                devices: true,
                ..Permissions::default()
            })
            .is_ok()
        );
    }
}

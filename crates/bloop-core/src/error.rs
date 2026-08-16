use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Debug, Error, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", content = "message", rename_all = "camelCase")]
pub enum EngineError {
    #[error("plugin error: {0}")]
    Plugin(String),
    #[error("permission denied: {0}")]
    Permission(String),
    #[error("network error: {0}")]
    Network(String),
    #[error("configuration error: {0}")]
    Configuration(String),
    #[error("compatibility error: {0}")]
    Compatibility(String),
    #[error("runtime error: {0}")]
    Runtime(String),
    #[error("unsupported: {0}")]
    Unsupported(String),
}

pub type EngineResult<T> = Result<T, EngineError>;

impl EngineError {
    pub fn user_message(&self) -> String {
        match self {
            Self::Plugin(_) => {
                "This feature ran into a problem. Try disabling and re-enabling the plugin.".into()
            }
            Self::Permission(_) => "This plugin does not have permission for that action.".into(),
            Self::Network(_) => {
                "A network request failed. Check your connection and try again.".into()
            }
            Self::Configuration(_) => {
                "This feature needs a setting updated before it can continue.".into()
            }
            Self::Unsupported(_) => {
                "This control is not available for the current media session.".into()
            }
            Self::Compatibility(_) => {
                "This plugin is not compatible with this version of Bloop.".into()
            }
            Self::Runtime(_) => "Something went wrong while running a plugin.".into(),
        }
    }
}

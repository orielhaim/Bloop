use std::sync::OnceLock;
use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::error::{EngineError, EngineResult};
use crate::plugins::{Permissions, assert_network};

pub mod audio;
#[cfg(windows)]
pub mod coreaudio;
pub mod devices;
pub mod gsmtc;
pub mod media;
#[cfg(windows)]
pub mod winbluetooth;

pub use audio::*;
pub use devices::*;
pub use media::*;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpRequest {
    pub method: String,
    pub url: String,
    #[serde(default)]
    pub headers: Vec<(String, String)>,
    pub body: Option<Vec<u8>>,
    pub timeout_ms: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpResponse {
    pub status: u16,
    pub headers: Vec<(String, String)>,
    pub body: Vec<u8>,
}

pub trait HttpBackend: Send + Sync {
    fn send(&self, request: HttpRequest) -> EngineResult<HttpResponse>;
}

pub struct ReqwestBackend;

impl ReqwestBackend {
    fn client() -> EngineResult<&'static reqwest::blocking::Client> {
        static CLIENT: OnceLock<reqwest::blocking::Client> = OnceLock::new();
        if let Some(client) = CLIENT.get() {
            return Ok(client);
        }
        let client = reqwest::blocking::Client::builder()
            .tls_backend_rustls()
            .build()
            .map_err(|error| EngineError::Network(error.to_string()))?;
        Ok(CLIENT.get_or_init(|| client))
    }
}

impl HttpBackend for ReqwestBackend {
    fn send(&self, request: HttpRequest) -> EngineResult<HttpResponse> {
        let method = reqwest::Method::from_bytes(request.method.as_bytes())
            .map_err(|error| EngineError::Network(error.to_string()))?;
        let timeout = Duration::from_millis(u64::from(request.timeout_ms.unwrap_or(15_000)));
        let mut builder = Self::client()?
            .request(method, &request.url)
            .timeout(timeout);
        for (name, value) in request.headers {
            builder = builder.header(name, value);
        }
        if let Some(body) = request.body {
            builder = builder.body(body);
        }
        let response = builder
            .send()
            .map_err(|error| EngineError::Network(error.to_string()))?;
        let status = response.status().as_u16();
        let headers = response
            .headers()
            .iter()
            .map(|(name, value)| {
                (
                    name.to_string(),
                    value.to_str().unwrap_or_default().to_string(),
                )
            })
            .collect();
        let body = response
            .bytes()
            .map_err(|error| EngineError::Network(error.to_string()))?
            .to_vec();
        Ok(HttpResponse {
            status,
            headers,
            body,
        })
    }
}

pub struct HttpService {
    backend: std::sync::Arc<dyn HttpBackend>,
}

impl HttpService {
    pub fn new(backend: std::sync::Arc<dyn HttpBackend>) -> Self {
        Self { backend }
    }

    pub fn request(
        &self,
        permissions: &Permissions,
        request: HttpRequest,
    ) -> EngineResult<HttpResponse> {
        let _url = assert_network(permissions, &request.url)?;
        if request
            .body
            .as_ref()
            .is_some_and(|body| body.len() > 1_000_000)
        {
            return Err(EngineError::Runtime("request body too large".into()));
        }
        self.backend.send(request)
    }
}

#[derive(Debug, Default)]
pub struct MemoryKv {
    values: parking_lot::Mutex<std::collections::BTreeMap<(String, String), String>>,
}

impl MemoryKv {
    pub fn get(&self, plugin_id: &str, key: &str) -> Option<String> {
        self.values
            .lock()
            .get(&(plugin_id.into(), key.into()))
            .cloned()
    }
}

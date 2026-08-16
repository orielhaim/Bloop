use std::sync::OnceLock;

use base64::Engine as _;
use base64::engine::general_purpose::PAD;

fn encode_base64(bytes: &[u8]) -> String {
    #[cfg(any(target_arch = "x86_64", target_arch = "aarch64"))]
    {
        use base64::engine::simd::Simd;
        static ENGINE: OnceLock<Simd> = OnceLock::new();
        return ENGINE.get_or_init(|| Simd::standard(PAD)).encode(bytes);
    }
    #[cfg(not(any(target_arch = "x86_64", target_arch = "aarch64")))]
    {
        base64::engine::general_purpose::STANDARD.encode(bytes)
    }
}

pub fn data_url(mime: &str, bytes: &[u8]) -> String {
    format!("data:{mime};base64,{}", encode_base64(bytes))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encodes_standard_base64() {
        assert_eq!(encode_base64(b"hello"), "aGVsbG8=");
    }

    #[test]
    fn builds_data_url() {
        assert_eq!(data_url("image/png", b"hi"), "data:image/png;base64,aGk=");
    }
}

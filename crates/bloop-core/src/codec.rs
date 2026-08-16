use std::sync::OnceLock;

use base64::Engine as _;
use base64::engine::general_purpose::PAD;
use sha2::{Digest, Sha256};

pub fn encode_base64(bytes: &[u8]) -> String {
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

pub fn sha256_hex(bytes: &[u8]) -> String {
    hex_lower(&Sha256::digest(bytes))
}

fn hex_lower(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for &byte in bytes {
        out.push(HEX[(byte >> 4) as usize] as char);
        out.push(HEX[(byte & 0x0f) as usize] as char);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use rand::RngExt as _;

    #[test]
    fn encodes_standard_base64() {
        assert_eq!(encode_base64(b"hello"), "aGVsbG8=");
    }

    #[test]
    fn hashes_known_bytes() {
        assert_eq!(
            sha256_hex(b"hello world"),
            "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9"
        );
    }

    #[test]
    fn hashes_distinct_random_payloads() {
        let mut rng = rand::rng();
        let a = [rng.random::<u8>(), rng.random()];
        let mut b = a;
        b[0] ^= 1;
        assert_ne!(sha256_hex(&a), sha256_hex(&b));
    }
}

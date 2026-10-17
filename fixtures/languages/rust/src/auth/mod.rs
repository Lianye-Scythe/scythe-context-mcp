pub mod token;
use crate::storage::ready;

pub fn validate_token(token: &str) -> bool { !token.is_empty() && ready() }

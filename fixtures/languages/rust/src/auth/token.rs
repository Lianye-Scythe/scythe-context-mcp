use super::validate_token;
use crate::{storage::ready, auth::validate_token as validate};
use std::fmt;

pub fn check(token: &str) -> bool { validate_token(token) && ready() }

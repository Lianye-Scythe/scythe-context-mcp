fn validate_token(token: &str) -> bool { shop::auth::validate_token(token) }

#[test]
fn validates() { assert!(validate_token("example")); }

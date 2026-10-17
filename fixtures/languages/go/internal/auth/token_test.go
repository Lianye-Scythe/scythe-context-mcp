package auth_test

import (
    "testing"
    "example.com/shop/internal/auth"
)

func ValidateToken(token string) bool { return auth.ValidateToken(token) }

func TestValidateToken(t *testing.T) {
    if !ValidateToken("example") { t.Fatal("expected valid token") }
}

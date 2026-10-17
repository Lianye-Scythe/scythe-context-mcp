package auth

import store "example.com/shop/internal/store"

func ValidateToken(token string) bool { return token != "" && store.Ready() }

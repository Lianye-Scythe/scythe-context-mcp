package main

import (
    "fmt"
    auth "example.com/shop/internal/auth"
    _ "example.org/telemetry"
)

func main() { fmt.Println(auth.ValidateToken("example")) }

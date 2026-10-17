#include "auth.hpp"
#include <string>
int main() { return shop::validate_token("token") ? 0 : 1; }

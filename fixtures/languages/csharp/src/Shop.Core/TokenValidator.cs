using System;
using Shop.Storage;
namespace Shop.Core;
public partial class TokenValidator
{
    public bool ValidateToken(string token) => !String.IsNullOrEmpty(token) && Storage.Ready();
}

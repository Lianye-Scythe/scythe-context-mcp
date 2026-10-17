using Shop.Core;
namespace Shop.Api
{
    public class Checkout
    {
        public bool Submit(string token) => new TokenValidator().ValidateToken(token);
    }
}

from shop.service import checkout

def validate_token(token):
    return True

def test_checkout():
    assert checkout("example")

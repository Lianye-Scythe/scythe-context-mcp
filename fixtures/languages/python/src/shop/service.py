from .auth import validate_token
from . import storage
import json, pathlib as paths

def checkout(token):
    return validate_token(token) and storage.ready()

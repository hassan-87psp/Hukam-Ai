"""Transport credential boundaries (no actual network traffic)."""
import pytest
from controller.security.transport import relay_origin
from controller.config import Config
from controller.communication.pairing import claim, PairingError, _NoRedirect

@pytest.mark.parametrize("url",["http://192.168.1.1","http://example.test","https://user:pass@example.test","https://example.test/path","https://example.test?x=y","https://example.test#x","https://example.test:invalid","https://example.test\\foo"])
def test_unsafe_relay_blocked_before_network(url):
    with pytest.raises(ValueError):
        relay_origin(url)
    with pytest.raises(ValueError):
        Config(server_url=url).ws_url()
    with pytest.raises(PairingError):
        claim(url,"synthetic-code")

def test_loopback_development_and_tls():
    assert Config(server_url="http://127.0.0.1:4000").ws_url()=="ws://127.0.0.1:4000/ws/device"
    assert Config(server_url="http://[::1]:4000/").ws_url()=="ws://[::1]:4000/ws/device"
    assert Config(server_url="https://example.test/").ws_url()=="wss://example.test/ws/device"

def test_pairing_rejects_redirect():
    with pytest.raises(PairingError,match="redirect"):
        _NoRedirect().redirect_request(None,None,307,"redirect",{},"https://other.example")

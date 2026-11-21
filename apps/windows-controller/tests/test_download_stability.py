import threading
import pytest
from controller.browser import chatgpt
from controller.system import desktop_input

def test_partial_download_check_is_bounded_and_cancelable(tmp_path):
    assert not chatgpt._partial_download_exists(tmp_path,"banner.png")
    (tmp_path/"banner.png.crdownload").write_bytes(b"x")
    assert chatgpt._partial_download_exists(tmp_path,"banner.png")
    stop=threading.Event()
    stop.set()
    with pytest.raises(desktop_input.DesktopInputError):
        chatgpt._partial_download_exists(tmp_path,"banner.png",stop)

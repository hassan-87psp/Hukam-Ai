import threading
from types import SimpleNamespace

import pytest

from controller.browser import chatgpt, calendar_draft, profiles, reviewed_input
from controller.system import desktop_input, launcher

def test_exact_project_url_rejects_port_credentials_query_and_fragment():
    expected="https://chatgpt.com/g/g-p-example"
    assert chatgpt.matches_project(expected+"/",expected)
    for bad in [expected+"?x=1",expected+"#other",expected.replace("chatgpt.com","chatgpt.com:8443"),
                expected.replace("chatgpt.com","user@chatgpt.com"),expected.replace("chatgpt.com","chatgpt.com.evil.test")]:
        assert not chatgpt.matches_project(bad,expected)

def test_calendar_editor_rejects_duplicate_parameters_and_port():
    expected="https://calendar.google.com/calendar/r/eventedit?text=Example&details="
    assert calendar_draft._same_prefilled_editor("https://calendar.google.com/calendar/r/eventedit?details=&text=Example",expected)
    assert not calendar_draft._same_prefilled_editor(expected+"&text=Example",expected)
    assert not calendar_draft._same_prefilled_editor(expected.replace("google.com","google.com:8443"),expected)

def test_download_snapshot_excludes_partial_and_stops_on_cancel(tmp_path):
    (tmp_path/"banner.png").write_bytes(b"sample")
    (tmp_path/"other.png.crdownload").write_bytes(b"x")
    assert set(chatgpt._files(tmp_path)) == {"banner.png"}
    stop=threading.Event();stop.set()
    with pytest.raises(desktop_input.DesktopInputError):
        chatgpt._files(tmp_path,stop)

def test_cancelled_integrations_do_not_execute_in_simulation(monkeypatch):
    monkeypatch.setattr(launcher,"SIMULATE",True)
    stop=threading.Event();stop.set()
    for fn,args in [(chatgpt.draft_prompt,("https://chatgpt.com/","sample")),
                    (chatgpt.submit_prompt,("https://chatgpt.com/","sample")),
                    (calendar_draft.save_reviewed,({},))]:
        with pytest.raises(desktop_input.DesktopInputError):
            fn(*args,cancel=stop)

def test_profile_rejects_nonstandard_provider_port(monkeypatch):
    monkeypatch.setattr(launcher,"SIMULATE",True)
    with pytest.raises(profiles.ProfileError):
        profiles.open_in_profile("https://mail.google.com:8443/","Default")

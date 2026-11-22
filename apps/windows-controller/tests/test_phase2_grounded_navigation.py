"""Synthetic Phase 2 screen-aware foreground navigation; no real input executed."""
import threading
from types import SimpleNamespace

import pytest

from controller.actions.executor import Executor
from controller.config import Config, ALL_CAPABILITIES
from controller.screen import accessibility as uia
from controller.security import validation
from controller.system import launcher, windows


def args(**extra):
    return {"process": "chrome.exe", "role": "ButtonControl", "label": "Settings",
            "expectRole": "TabItemControl", "expectLabel": "Privacy", **extra}


def test_controller_and_relay_shape_refuses_sensitive_controls_and_wrong_process():
    assert validation.validate("ui.navigate_verified", args()) == args()
    for data in (args(label="Send payment"), args(label="Delete"),
                 args(process="whatsapp.exe"), args(process="cmd.exe"),
                 args(expectLabel="Save"), args(expectRole="DocumentControl"),
                 args(expectLabel=""), args(expectRole="PasswordControl"),
                 args(expectLabel=None)):
        with pytest.raises(validation.ValidationError):
            validation.validate("ui.navigate_verified", data)
    assert validation.validate("ui.navigate_verified", {
        "process": "chrome.exe", "role": "ButtonControl", "label": "Settings"
    }) == {"process": "chrome.exe", "role": "ButtonControl", "label": "Settings"}


def test_simulated_action_cannot_claim_real_ui_verified(monkeypatch):
    monkeypatch.setattr(launcher, "SIMULATE", True)
    cfg=Config()
    ex=Executor(cfg,lambda:list(ALL_CAPABILITIES))
    result=ex.run("ui.navigate_verified", {
        "process":"chrome.exe","role":"ButtonControl","label":"Search"
    },threading.Event())
    assert result.ok
    assert result.result["inputDelivered"] is True
    assert result.result["verified"] is False
    assert result.result["simulated"] is True


def test_wrong_foreground_process_blocks_before_any_click(monkeypatch):
    seen=[]
    monkeypatch.setattr(launcher,"SIMULATE",False)
    monkeypatch.setattr(uia,"inspect",lambda:{
        "process":"firefox.exe","snapshot":"a"*64,
        "controls":[{"role":"ButtonControl","label":"Settings","canActivate":True}]})
    monkeypatch.setattr(uia,"activate_observed",lambda *a,**kw:seen.append("click"))
    with pytest.raises(uia.AccessibilityError,match="differs"):
        uia.navigate_verified(args())
    assert seen==[]


def test_expected_control_already_visible_blocks_false_proof(monkeypatch):
    seen=[]
    monkeypatch.setattr(launcher,"SIMULATE",False)
    monkeypatch.setattr(uia,"inspect",lambda:{
        "process":"chrome.exe","snapshot":"a"*64,"controls":[
            {"role":"ButtonControl","label":"Settings","canActivate":True},
            {"role":"TabItemControl","label":"Privacy","canActivate":True}]})
    monkeypatch.setattr(uia,"activate_observed",lambda *a,**kw:seen.append("click"))
    with pytest.raises(uia.AccessibilityError,match="already present"):
        uia.navigate_verified(args())
    assert seen==[]


def test_one_exact_click_then_unique_expected_control_is_verified(monkeypatch):
    import uiautomation as auto
    import win32gui
    active=windows.WindowInfo(888,"Settings — Chrome","chrome.exe",4000)
    clicks=[]
    monkeypatch.setattr(launcher,"SIMULATE",False)
    monkeypatch.setattr(uia,"inspect",lambda:{
        "process":"chrome.exe","snapshot":"a"*64,"controls":[
            {"role":"ButtonControl","label":"Settings","canActivate":True}]})
    monkeypatch.setattr(uia,"_active",lambda:active)
    monkeypatch.setattr(uia,"activate_observed",
        lambda *a,**kw:(clicks.append((a,kw)),{"inputDelivered":True})[1])
    monkeypatch.setattr(uia,"_visible_controls",lambda *a,**kw:[
        (object(),"TabItemControl","Privacy")])
    monkeypatch.setattr(auto,"ControlFromHandle",lambda hwnd:object())
    monkeypatch.setattr(win32gui,"GetForegroundWindow",lambda:888)
    monkeypatch.setattr(uia.time,"sleep",lambda _:None)
    result=uia.navigate_verified(args())
    assert result["verified"] is True
    assert result["navigationVerified"] is True
    assert result["evidence"]=="new_unique_visible_control"
    assert len(clicks)==1


def test_ambiguous_post_click_ui_is_unverified_and_never_reclicked(monkeypatch):
    import uiautomation as auto
    import win32gui
    active=windows.WindowInfo(888,"Settings — Chrome","chrome.exe",4000)
    attempts=[]
    monkeypatch.setattr(launcher,"SIMULATE",False)
    monkeypatch.setattr(uia,"inspect",lambda:{
        "process":"chrome.exe","snapshot":"b"*64,"controls":[
            {"role":"ButtonControl","label":"Settings","canActivate":True}]})
    monkeypatch.setattr(uia,"_active",lambda:active)
    monkeypatch.setattr(uia,"activate_observed",
        lambda *a,**kw:(attempts.append("click"),{"inputDelivered":True})[1])
    monkeypatch.setattr(uia,"_visible_controls",lambda *a,**kw:[
        (object(),"TabItemControl","Privacy"),(object(),"TabItemControl","Privacy")])
    monkeypatch.setattr(auto,"ControlFromHandle",lambda hwnd:object())
    monkeypatch.setattr(win32gui,"GetForegroundWindow",lambda:888)
    monkeypatch.setattr(uia.time,"sleep",lambda _:None)
    result=uia.navigate_verified(args())
    assert result["verified"] is False and result["inputDelivered"] is True
    assert "ambiguous" in result["note"]
    assert attempts==["click"]


def test_screen_permission_disabled_blocks_navigation_even_when_input_enabled(monkeypatch):
    monkeypatch.setattr(launcher,"SIMULATE",True)
    cfg=Config()
    out=Executor(cfg,lambda:[c for c in ALL_CAPABILITIES if c!="screen"]).run(
        "ui.navigate_verified",args(),threading.Event())
    assert out.ok is False
    assert out.error["code"]=="CAPABILITY_DISABLED"

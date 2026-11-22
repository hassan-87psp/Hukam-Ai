"""Visible cooperative pointer motion, no input events or blind clicks."""
import time

class PointerInterrupted(RuntimeError):
    pass

def move_visible(target, guard, *, steps=24, duration=0.60):
    import win32api
    target=tuple(target)
    guard()
    origin=tuple(win32api.GetCursorPos())
    expected=origin
    for i in range(1,steps+1):
        guard()
        if tuple(win32api.GetCursorPos())!=expected:
            raise PointerInterrupted("Mouse moved by the owner; click cancelled")
        fraction=i/steps
        ease=fraction*fraction*(3-2*fraction)
        expected=tuple(round(a+(b-a)*ease) for a,b in zip(origin,target))
        win32api.SetCursorPos(expected)
        time.sleep(duration/steps)
    guard()
    if tuple(win32api.GetCursorPos())!=target:
        raise PointerInterrupted("Mouse did not reach the verified target; click cancelled")

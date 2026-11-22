"""Shared native input checks for explicit owner-reviewed browser integrations."""
from ..system import desktop_input, windows


def check_window(active, cancel=None):
    desktop_input._check_cancel(cancel)
    current = windows.active_window()
    if not current or current.hwnd != active.hwnd or current.pid != active.pid:
        raise desktop_input.DesktopInputError("Original browser window changed")
    desktop_input._ensure_target(active.hwnd)


def click_reviewed(active, button, cancel=None):
    import win32api
    import win32con
    check_window(active, cancel)
    if button.IsOffscreen or not button.IsEnabled:
        raise desktop_input.DesktopInputError("Reviewed control is no longer visible and enabled")
    bounds = button.BoundingRectangle
    if bounds.right <= bounds.left or bounds.bottom <= bounds.top:
        raise desktop_input.DesktopInputError("Reviewed control has no visible bounds")
    point = ((bounds.left + bounds.right)//2, (bounds.top + bounds.bottom)//2)
    client = desktop_input._client_rect(active.hwnd)
    desktop_input._check_pointer(active.hwnd, point, client, cancel)
    win32api.SetCursorPos(point)
    desktop_input._check_pointer(active.hwnd, point, client, cancel)
    check_window(active, cancel)
    if win32api.GetCursorPos() != point:
        raise desktop_input.DesktopInputError("Pointer changed before reviewed input")
    win32api.mouse_event(win32con.MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0)
    win32api.mouse_event(win32con.MOUSEEVENTF_LEFTUP, 0, 0, 0, 0)

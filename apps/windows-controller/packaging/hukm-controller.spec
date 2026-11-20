# PyInstaller spec — builds a single portable hukm-controller.exe (no Python install needed on the laptop).
# Build:  packaging\build.bat
# -*- mode: python ; coding: utf-8 -*-
a = Analysis(
    ['../controller/__main__.py'],
    pathex=['..'],
    hiddenimports=['win32timezone', 'win32crypt', 'win32gui', 'win32process', 'win32con', 'win32api'],
    excludes=['tkinter', 'unittest', 'pydoc', 'test', 'numpy', 'pytest'],
    noarchive=False,
)
pyz = PYZ(a.pure)
exe = EXE(
    pyz, a.scripts, a.binaries, a.datas, [],
    name='hukm-controller',
    console=True,          # visible window = visible remote access
    upx=False,
    icon=None,
)

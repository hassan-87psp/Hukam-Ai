# PyInstaller spec — builds a single portable hukm-controller.exe (no Python install needed on the laptop).
# Build:  packaging\build.bat
# Use an absolute package import from hukm_entry.py, never controller/__main__.py
# as the PyInstaller script (relative imports fail outside a package).
# -*- mode: python ; coding: utf-8 -*-
from PyInstaller.utils.hooks import collect_submodules

a = Analysis(
    ['../hukm_entry.py'],
    pathex=['..'],
    hiddenimports=['win32timezone', 'win32crypt', 'win32gui', 'win32process', 'win32con', 'win32api',
                   'win32com.client'] + collect_submodules('uiautomation') + collect_submodules('winrt'),
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

"""Executable entry point for PyInstaller.

Do not package controller/__main__.py as a top-level script: it uses relative
imports and PyInstaller invokes its Analysis script as __main__ with no parent.
This wrapper imports the package by its absolute module name so both
python -m controller and the frozen Windows EXE work.
"""
from controller.cli import main

if __name__ == "__main__":
    raise SystemExit(main())

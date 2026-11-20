"""Optional AI adapter boundary (NOT active in Version 1).

Version 1 understands commands with the deterministic parser in packages/command-protocol.
A future adapter may turn free-form requests into the SAME structured actions, which are then
validated exactly like parsed ones (security/validation.py) — an AI can never add new powers.

Candidate: "Sign in with ChatGPT" with ChatGPT plan usage (announced Sept 2026). OpenAI documents a
self-serve flow for open-source / locally hosted apps; this controller runs locally, so it is the
natural place for such an adapter. It has NOT been implemented or tested here.
See docs/integration-status.md → "Optional AI connectivity" for the eligibility test steps.
"""
from __future__ import annotations

from typing import Protocol


class AIProvider(Protocol):
    id: str

    def available(self) -> bool: ...

    def interpret(self, text: str) -> dict:
        """Return {"action": str, "args": dict} or {"reply": str}. Output is validated before use."""
        ...


class ChatGPTPlanProvider:
    id = "chatgpt-plan"

    def available(self) -> bool:
        return False

    def interpret(self, text: str) -> dict:  # pragma: no cover - not implemented
        raise NotImplementedError("ChatGPT plan adapter is not implemented in Version 1")

"""Verify duplicate Windows Controllers cannot own the same computer session."""
import uuid
import pytest
from controller.config import IS_WINDOWS
from controller.system import single_instance

def test_mutex_name_is_session_local_and_constant():
    assert single_instance.MUTEX_NAME.startswith("Local\\")
    assert "HUKM_AI" in single_instance.MUTEX_NAME

@pytest.mark.skipif(not IS_WINDOWS, reason="Windows mutex is required")
def test_only_one_controller_can_acquire_named_mutex():
    name="Local\\HUKM_TEST_MUTEX_"+uuid.uuid4().hex
    first=single_instance.acquire(name)
    assert first is not None
    try:
        second=single_instance.acquire(name)
        assert second is None
    finally:
        single_instance.release(first)
    third=single_instance.acquire(name)
    assert third is not None
    single_instance.release(third)

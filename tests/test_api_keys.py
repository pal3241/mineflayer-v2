from llm import ApiKeyManager


def test_rotation_cycles():
    manager = ApiKeyManager(["a", "b", "c"])
    seq = [manager.get_available_key() for _ in range(4)]
    assert seq == ["a", "b", "c", "a"]


def test_dedupes_keys():
    manager = ApiKeyManager(["a", "a", "b"])
    assert manager.keys == ["a", "b"]


def test_failed_key_is_skipped():
    manager = ApiKeyManager(["a", "b"], max_failures=1)
    assert manager.get_available_key() == "a"
    manager.mark_failure("a")
    # 'a' kini mencapai batas -> rotasi ke 'b'
    assert manager.get_available_key() == "b"


def test_all_keys_exhausted_returns_none():
    manager = ApiKeyManager(["a", "b"], max_failures=1)
    manager.mark_failure("a")
    manager.mark_failure("b")
    assert manager.get_available_key() is None


def test_mark_success_resets_failures():
    manager = ApiKeyManager(["a"], max_failures=3)
    for _ in range(4):
        manager.mark_failure("a")
    assert manager.get_available_key() is None
    manager.mark_success("a")
    assert manager.get_available_key() == "a"


def test_available_flag():
    manager = ApiKeyManager(["a"], max_failures=1)
    assert manager.available is True
    manager.mark_failure("a")
    assert manager.available is False


def test_empty_manager():
    manager = ApiKeyManager([])
    assert manager.get_available_key() is None
    assert manager.available is False
